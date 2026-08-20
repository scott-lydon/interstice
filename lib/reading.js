// The reading protocol: everything the HTTP layer is allowed to know about the book on screen.
//
// lib/server.js used to reach through the daemon into the Reader at dozens of call sites, and not
// only at methods: `daemon.reader.seq`, `daemon.reader.running` and `daemon.reader.signingIn` are
// plain fields of much the largest class in lib/. The cost was not stylistic. Fixing anything about the reading
// surface meant holding lib/server.js, lib/daemon.js and the whole of lib/reader.js in mind at
// once, because the route bodies were where the reader's own sequencing lived: which capture
// follows which input, when a redirect to Amazon's sign-in page is worth recovering from, how long
// to wait for a repaint. None of that is HTTP.
//
// So it lives here, stated as a protocol, in the shape the focus subtree already uses (see
// docs/FOCUS_MODULE_CONTRACTS.md): plain data crosses the boundary, and the caller on the far side
// names no field of the Reader.
//
//   status()                     -> { running, signingIn, seq }
//   view({ asin, width, height}) -> { ok, ready?, signedOut?, seq, ... }   (throws on a real failure)
//   frame()                      -> { seq, jpeg } | null
//   words({ fresh })             -> { ...text, seq, shelf }
//   input({ kind, ... })         -> { ok, seq, repainted?, waitedMs? }
//   carrySession()               -> { ok, seq, ... }
//   signIn({ asin }) / signInSafari({ asin }) / signInStatus()
//   retry() / close()
//
// It is a facade, deliberately, not a rewrite: splitting the Reader itself is a separate and much
// larger change, and the point of this one is that when that split happens, only
// this file has to move with it.

/**
 * How long an input is given to show up on the page before the frame is served anyway.
 *
 * A ceiling, not a measurement: `afterInput` below returns the instant the picture changes, so
 * this is reached when the input changed nothing on screen within the budget (a click on dead
 * space, a key the reader ignored), and also when a repaint was simply slower than that.
 */
const REPAINT_BUDGET_MS = 600;

/** How often the page is re-photographed while waiting for it to change. */
const REPAINT_POLL_MS = 60;

/**
 * The page as it looks after an input, rather than as it looked a fixed number of milliseconds
 * later.
 *
 * This replaces two unexplained sleeps in the route handler, 350ms after a click and 250ms after a
 * key, which differed from each other for no stated reason and were nobody's measurement of
 * anything. Both were the same guess at how long Amazon's reader takes to repaint, and a guess is
 * wrong in both directions: too short and the panel is handed the picture of the page before the
 * input landed, too long and every tap costs a third of a second it did not need.
 *
 * The reader already knows the answer. `capture` bumps `seq` only when the JPEG bytes differ, so
 * "the page has repainted" is exactly "seq moved". An input that genuinely changes nothing costs
 * the full budget and says so in `repainted: false`, which is the honest answer to "did that do
 * anything" and used to be indistinguishable from success.
 */
async function afterInput(reader) {
  const before = reader.seq;
  const started = Date.now();
  for (;;) {
    await reader.capture({ force: true });
    const waitedMs = Date.now() - started;
    if (reader.seq !== before) return { repainted: true, waitedMs };
    if (waitedMs >= REPAINT_BUDGET_MS) return { repainted: false, waitedMs };
    await new Promise((t) => setTimeout(t, REPAINT_POLL_MS));
  }
}

/** Thrown for an input kind the reader has no meaning for. Named so the route can answer 400. */
export class UnknownInputError extends Error {
  constructor(kind) {
    super(`unknown input "${kind}". Remedy: send kind "turn", "click", "key" or "text".`);
    this.name = 'UnknownInputError';
  }
}

/**
 * @param {{ reader: object }} deps the Reader instance, which nothing outside this file names.
 * @returns the reading protocol above
 */
export function createReadingSurface({ reader }) {
  return {
    /**
     * Plain data, safe to serialise: the three fields the routes actually decide on. Deliberately
     * three cheap reads and no call into the reader, because it is asked on every input.
     */
    status() {
      return { running: reader.running, signingIn: reader.signingIn, seq: reader.seq };
    },

    /**
     * The book laid out for the box the panel has, and a fresh picture of it.
     *
     * The sequencing is the reader's, not the route's: ensure, then read the state, then recover a
     * session if Amazon has redirected to its sign-in page since the book was opened, then take
     * the picture, then read ahead. Amazon can sign you out long after the book was open, which is
     * why the recovery cannot live only in the opening path.
     */
    async view({ asin, width, height }) {
      // A sign-in window is open and holding the profile. Say so, rather than reporting the reader
      // as broken for as long as the person takes to sign in.
      if (reader.signingIn) {
        return { ok: true, ready: false, signedOut: true, signin: reader.signInStatus(), seq: reader.seq };
      }
      await reader.ensure({ asin, width, height });
      let view = await reader.state();
      if (view.signedOut) {
        // Rate limited inside, and it does nothing at all when your own browser is signed out too.
        const carried = await reader.recoverIfPossible();
        if (carried?.carried > 0) view = await reader.state();
      }
      // The picture is pulled on the poll rather than pushed continuously, so this is where it is
      // taken. It costs one screenshot, and only bumps the sequence number when the page changed.
      await reader.capture();
      // Keep a page or two ahead of where you are reading. Not awaited: this poll must answer at
      // the speed of a
      // screenshot, and the whole point of reading ahead is that it happens while you are reading
      // something else. It is a no-op when the shelf is already full.
      reader.readAhead();
      return { ok: true, ...view, seq: reader.seq };
    },

    /** The last picture the reader drew, or null when it has nothing on screen yet. */
    frame() {
      return reader.capture();
    },

    /** The page as words, with the shelf beside it so the panel can say what is already read. */
    async words({ fresh = false } = {}) {
      const text = await reader.text({ fresh });
      return { ...text, seq: reader.seq, shelf: reader.shelf() };
    },

    /** Your hands, forwarded, and the page as it looks once they have landed. */
    async input({ kind, x, y, key, text, direction }) {
      if (kind === 'turn') return reader.turn(direction);
      // The repaint is awaited before `seq` is read, not inlined beside it: `seq` is the sequence
      // of the frame this answer is about, and reading it first would return the number of the
      // picture taken before the input landed, which is the exact bug the wait exists to prevent.
      if (kind === 'click') {
        const r = await reader.click(Number(x) || 0, Number(y) || 0);
        const repaint = await afterInput(reader);
        return { ...r, ...repaint, seq: reader.seq };
      }
      if (kind === 'key') {
        const r = await reader.key(String(key), { text: text ?? null });
        const repaint = await afterInput(reader);
        return { ...r, ...repaint, seq: reader.seq };
      }
      if (kind === 'text') {
        const r = await reader.type(String(text ?? ''));
        await reader.capture({ force: true });
        return { ...r, seq: reader.seq };
      }
      throw new UnknownInputError(kind);
    },

    /** Sign in without signing in: carry the session out of the browser you already use. */
    async carrySession() {
      const carried = await reader.reauthenticate();
      return {
        // Signed in, not "cookies moved". See `Reader.reauthenticate`.
        ok: carried.signedIn === true,
        ...carried,
        ...(await reader.state()),
        seq: reader.seq,
      };
    },

    signIn({ asin }) {
      return reader.startSignIn({ asin });
    },

    signInSafari({ asin }) {
      return reader.startSafariSignIn({ asin });
    },

    signInStatus() {
      return reader.signInStatus();
    },

    retry() {
      return reader.retryBook();
    },

    close() {
      return reader.close();
    },
  };
}
