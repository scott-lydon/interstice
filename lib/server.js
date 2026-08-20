import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, appendJsonl } from './logger.js';
import { GAPS_LOG, EVENTS_LOG, ROOT, QUEUED_PROMPTS, LOG_DIR } from './paths.js';
import { summarize } from './stats.js';
import { leastStudiedQueue, answerCard, reconnect as ankiReconnect } from './state/anki.js';
import { kindleState, openBook } from './state/kindle.js';
import { scrapeTodoLists } from './state/notes.js';
import { applyOverrides, setDone } from './todo-store.js';
import { invalidate, readingSnapshot } from './state/index.js';
import { readerUrl } from './reader.js';
import { companionsSnapshot, invalidateCompanions } from './state/companions.js';
import { playBinaural, startPomodoro } from './companions-control.js';

/**
 * Local control surface and dashboard. Binds to loopback only.
 *
 * The /debug routes exist because most interesting states are slow to reach by
 * hand: you cannot conjure a 12 minute agent turn on demand, and waiting for one
 * makes every iteration cost twelve minutes. Anything driven from /debug is tagged
 * `synthetic: true` and excluded from the statistics, so the debug surface can
 * never quietly inflate the numbers it is sitting next to.
 */

const json = (res, code, body) => {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(code, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * When the panel's source last changed.
 *
 * The panel is a long-lived window: it can sit open for days, and an edit to
 * panel.html would otherwise never reach it. Editing a file is not shipping it, and
 * the version you can see is the only one that counts, so the page watches this
 * stamp and reloads itself when it moves.
 */
function assetStamp() {
  try {
    return fs.statSync(path.join(ROOT, 'web', 'panel.html')).mtimeMs;
  } catch {
    return 0;
  }
}

import { starsHandler } from './focus/stars-routes.js';
import { localISO } from './focus/tracker.js';
import { readOrCreateToken, checkRequest, injectToken } from './auth.js';

export async function createServer({ daemon, config }) {
  // How many times the panel page has been handed out. This is the only external
  // evidence that an open window has picked up an edit, which is the difference
  // between a change being written and a change being live.
  let panelServes = 0;

  // Minted on first run and reused after, mode 0600 under logs/, which is gitignored. Generated
  // rather than configured so there is no default value anyone can forget to change.
  const controlToken = readOrCreateToken(LOG_DIR);

  // Forced companion verdicts, set from /debug. Reaching "off" for real means
  // stopping your own music, which is a silly price for looking at the banner.
  let companionOverrides = {};

  const routes = {
    'GET /api/health': (req, res) => json(res, 200, daemon.health()),

    'GET /api/status': (req, res) => json(res, 200, daemon.engine.status),

    'GET /api/gaps': (req, res, url) => {
      const limit = Number(url.searchParams.get('limit') || 500);
      const all = readJsonl(GAPS_LOG);
      json(res, 200, { count: all.length, gaps: all.slice(-limit) });
    },

    'GET /api/stats': (req, res) => {
      const gaps = readJsonl(GAPS_LOG);
      json(res, 200, summarize(gaps, config));
    },

    'GET /api/events': (req, res, url) => {
      const limit = Number(url.searchParams.get('limit') || 200);
      const gapId = url.searchParams.get('gapId');
      let all = readJsonl(EVENTS_LOG);
      if (gapId) all = all.filter((e) => e.gapId === gapId);
      json(res, 200, { events: all.slice(-limit) });
    },

    'GET /api/config': (req, res) => json(res, 200, config),

    'GET /api/queued': (req, res) => {
      const queued = readJsonl(QUEUED_PROMPTS).filter((q) => q.text);
      json(res, 200, { count: queued.length, queued: queued.slice(-50) });
    },

    'POST /api/queued': async (req, res) => {
      const body = await readBody(req);
      const text = String(body.text ?? '').trim();
      if (!text) return json(res, 400, { ok: false, error: 'empty' });
      const record = { ts: Date.now(), event: 'queued', text };
      appendJsonl(QUEUED_PROMPTS, record);
      json(res, 200, { ok: true, record });
    },

    // ---- the panel: one window, and everything the rungs put in it ----

    /**
     * The panel's heartbeat and its instructions, in one exchange. The page says it
     * is on screen, and the answer says which rung should be showing. That is why a
     * delivery into an open panel never opens a second window.
     */
    'POST /api/panel/ping': (req, res) => {
      daemon.panel.ping();
      const s = daemon.panel.state();
      // The focus block and the in-flight prompts ride the heartbeat rather than a poll of their
      // own. Without this the panel had no way to learn that a block forfeited: the banner and the
      // latency chip existed, were styled, and were reachable only from the test hooks, so in real
      // use a lost block was silent. One request already runs every 1500ms; a second would be a
      // second source of truth for the same instant.
      const at = localISO();
      json(res, 200, {
        ok: true,
        rung: s.rung,
        seq: s.seq,
        detail: s.detail,
        asset: assetStamp(),
        focus: daemon.focus.status(at),
        latency: { waiting: daemon.latency.active(at), lastDelivery: daemon.lastDelivery ?? null },
      });
    },

    'GET /api/panel': (req, res) => json(res, 200, daemon.panel.state()),

    'GET /api/stars/day': (req, res, url) => {
      const r = starsHandler(daemon.stars, 'day', url.searchParams.get('day'));
      json(res, r.status, r.body);
    },
    'GET /api/stars/month': (req, res, url) => {
      const r = starsHandler(daemon.stars, 'month', url.searchParams.get('month'));
      json(res, r.status, r.body);
    },

    // The live view of the two things the panel cannot know on its own: how far into the current
    // focus block we are (and what last broke one), and which prompts are still in flight. Both
    // are read straight off the daemon's own tracker and latency clock, so the number on screen
    // and the number that awards the star are the same number.
    'GET /api/focus': (req, res) => {
      // Local offset, not Z: every timestamp this surface reports is read back by slicing the
      // date out of it, so a UTC stamp files an evening block on tomorrow (S5).
      const at = localISO();
      json(res, 200, {
        ok: true,
        at,
        block: daemon.focus.status(at),
        latency: { waiting: daemon.latency.active(at), lastDelivery: daemon.lastDelivery ?? null },
      });
    },

    'POST /api/panel/show': async (req, res) => {
      const body = await readBody(req);
      const rung = String(body.rung || '');
      if (!['flashcards', 'reading', 'queue_prompt', 'todo'].includes(rung)) {
        return json(res, 400, { ok: false, error: `unknown rung "${rung}"` });
      }
      json(res, 200, { ok: true, ...(await daemon.panel.show(rung, body.detail ?? null)) });
    },

    /** The least studied deck with cards due, and its cards, ready to render. */
    'GET /api/cards': async (req, res) => {
      try {
        json(res, 200, await leastStudiedQueue(config));
      } catch (err) {
        json(res, 200, { deck: null, reason: err.message, cards: [], ranking: [] });
      }
    },

    'POST /api/cards/answer': async (req, res) => {
      const body = await readBody(req);
      try {
        const result = await answerCard(config, Number(body.cardId), Number(body.ease));
        json(res, 200, { ok: true, ...result });
      } catch (err) {
        json(res, 200, { ok: false, error: err.message });
      }
    },

    'GET /api/reading': async (req, res) => {
      // Through the cache, not straight at the store. This read crosses into
      // another application's container, which is what makes macOS ask whether to
      // allow it, and the panel polls this route: uncached, one open panel is a
      // permission prompt every few seconds.
      const state = await readingSnapshot(config);
      json(res, 200, {
        ...state,
        // Amazon's own reader, at the position Whispersync holds. It is the only
        // lawful way to show the text of an encrypted book, and it is rendered
        // headless and shown in the panel rather than opened in a window.
        //
        // `/?asin=` rather than `/reader?asin=`: the latter is what sign-in redirects
        // BACK to, so using it directly means the round trip through Amazon's login
        // lands you somewhere other than where you asked to go.
        cloudReaderUrl: readerUrl(state.book?.asin),
        book: state.book ? { ...state.book, cloudReaderUrl: readerUrl(state.book.asin) } : null,
        shelf: (state.shelf ?? []).map((b) => ({ ...b, cloudReaderUrl: readerUrl(b.asin) })),
      });
    },

    /**
     * What the sign-in page can be filled in with. Empty unless you have put an
     * address in the config: guessing an account name costs more time than typing
     * one, and it is the kind of wrong that looks like the tool is broken.
     *
     * On its own route rather than sharing `GET /api/reading/signin`, which it used
     * to: two identical keys in one object literal is one route, the second wins,
     * and this one never answered anything.
     */
    'GET /api/reading/account': (req, res) =>
      json(res, 200, { email: config.reading?.amazonEmail ?? null }),

    /**
     * The book itself, rendered where you cannot see it and shown here.
     *
     * The panel sends the size of the box it has, so the reader lays the page out
     * for that box rather than for a window nobody asked for. Called on every poll
     * while the book is on screen, which is why it is cheap when nothing changed.
     */
    'POST /api/reading/view': async (req, res) => {
      const body = await readBody(req);
      const state = await readingSnapshot(config);
      const asin = String(body.asin || state.book?.asin || '');
      if (!asin) {
        return json(res, 200, { ok: false, reason: state.reason ?? 'no_book', ready: false });
      }
      // A sign-in window is open and holding the profile. Say so, rather than
      // reporting the reader as broken for as long as the person takes to sign in.
      if (daemon.reader.signingIn) {
        return json(res, 200, {
          ok: true,
          ready: false,
          asin,
          signedOut: true,
          signin: daemon.reader.signInStatus(),
          seq: daemon.reader.seq,
        });
      }
      try {
        await daemon.reader.ensure({
          asin,
          width: Number(body.width) || undefined,
          height: Number(body.height) || undefined,
        });
        let view = await daemon.reader.state();
        // Amazon can redirect to its sign-in page long after the book was open, so
        // the recovery cannot live only in the opening path. Rate limited inside,
        // and it does nothing at all when your own browser is signed out too.
        if (view.signedOut) {
          const carried = await daemon.reader.recoverIfPossible();
          if (carried?.carried > 0) view = await daemon.reader.state();
        }
        // The picture is pulled on the poll rather than pushed continuously, so
        // this is where it is taken. It costs one screenshot, and only bumps the
        // sequence number when the page has actually changed.
        await daemon.reader.capture();
        // While the book is on screen, keep a page or two ahead of you read. Not
        // awaited: this poll must answer at the speed of a screenshot, and the whole
        // point of reading ahead is that it happens while you are reading something
        // else. It is a no-op when the shelf is already full.
        daemon.reader.readAhead();
        json(res, 200, {
          ok: true,
          ...view,
          asin,
          // After the probe, not before it: the page's own `document.title` is
          // "Kindle" for every book there is, and spreading it over this showed the
          // operator the name of the app where the name of the book belongs.
          title: state.book?.title ?? null,
          percent: state.book?.percent ?? null,
          seq: daemon.reader.seq,
        });
      } catch (err) {
        json(res, 200, { ok: false, ready: false, error: err.message, asin });
      }
    },

    /**
     * The current picture of the page. A frame rather than a snapshot: the reader
     * pushes one whenever it repaints, so this is usually the last thing it drew
     * rather than a fresh capture.
     */
    'GET /api/reading/frame': async (req, res) => {
      const frame = await daemon.reader.capture();
      if (!frame) return json(res, 404, { error: 'the reader has nothing on screen yet' });
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'content-length': frame.jpeg.length,
        'cache-control': 'no-store',
        'x-frame-seq': String(frame.seq),
      });
      res.end(frame.jpeg);
    },

    /**
     * The page as words.
     *
     * Amazon draws each page as one image with no text in it anywhere, so this is a
     * reading of that image, taken locally by the same engine macOS reads text out
     * of photographs with. It is what the book rung shows by default: a picture of
     * a book scaled into a panel is small, fixed and unselectable, and setting the
     * words in the panel's own type is the whole point of putting the book here.
     */
    'GET /api/reading/text': async (req, res, url) => {
      if (!daemon.reader.running) return json(res, 409, { ok: false, error: 'the reader is not open' });
      try {
        // `?fresh=1` is the "read it again" button. Everything else is served from
        // whatever this page was already read as, which after a forward turn is a
        // reading taken before you got here.
        const text = await daemon.reader.text({ fresh: url.searchParams.get('fresh') === '1' });
        json(res, 200, { ...text, seq: daemon.reader.seq, shelf: daemon.reader.shelf() });
      } catch (err) {
        json(res, 200, { ok: false, error: err.message });
      }
    },

    /**
     * Your hands, forwarded.
     *
     * The page is a picture, so a click on it has to be sent back to where the page
     * actually is. Everything the reader understands goes through here: turning,
     * tapping a footnote, and typing into a sign-in form.
     */
    'POST /api/reading/input': async (req, res) => {
      const body = await readBody(req);
      if (!daemon.reader.running) return json(res, 409, { ok: false, error: 'the reader is not open' });
      try {
        if (body.kind === 'turn') return json(res, 200, await daemon.reader.turn(body.direction));
        if (body.kind === 'click') {
          const r = await daemon.reader.click(Number(body.x) || 0, Number(body.y) || 0);
          await new Promise((t) => setTimeout(t, 350));
          await daemon.reader.capture({ force: true });
          return json(res, 200, { ...r, seq: daemon.reader.seq });
        }
        if (body.kind === 'key') {
          const r = await daemon.reader.key(String(body.key), { text: body.text ?? null });
          await new Promise((t) => setTimeout(t, 250));
          await daemon.reader.capture({ force: true });
          return json(res, 200, { ...r, seq: daemon.reader.seq });
        }
        if (body.kind === 'text') {
          const r = await daemon.reader.type(String(body.text ?? ''));
          await daemon.reader.capture({ force: true });
          return json(res, 200, { ...r, seq: daemon.reader.seq });
        }
        json(res, 400, { ok: false, error: `unknown input "${body.kind}"` });
      } catch (err) {
        json(res, 200, { ok: false, error: err.message });
      }
    },

    /**
     * Sign in without signing in: carry the session out of the browser you already
     * use. Nothing is typed, nothing is stored, and no window opens.
     */
    'POST /api/reading/session': async (req, res) => {
      const carried = await daemon.reader.reauthenticate();
      json(res, 200, {
        // Signed in, not "cookies moved". See `Reader.reauthenticate`.
        ok: carried.signedIn === true,
        ...carried,
        ...(await daemon.reader.state()),
        seq: daemon.reader.seq,
      });
    },

    /**
     * Sign in in a Chrome window you can see.
     *
     * Returns as soon as the window is on its way rather than when the sign-in is
     * done, because the sign-in takes as long as a person takes and a request that
     * waits for one is a request that times out. The panel polls the GET below.
     */
    'POST /api/reading/signin': async (req, res) => {
      // The book you are actually reading, so the window opens on its sign-in page
      // and comes back to it. The reader itself knows of no book until it opens one.
      const state = await readingSnapshot(config).catch(() => null);
      json(res, 200, { ok: true, ...daemon.reader.startSignIn({ asin: state?.book?.asin ?? null }) });
    },

    'GET /api/reading/signin': async (req, res) => {
      json(res, 200, { ok: true, ...daemon.reader.signInStatus() });
    },

    /**
     * Sign in in Safari, because that is where the keychain is.
     *
     * Returns as soon as Safari has been asked. There is nothing to wait for here:
     * unlike the Chrome window, this one is not instrumented and cannot be, so the
     * panel goes back to trying the silent carry rather than watching a window it
     * does not own. See `Reader.startSafariSignIn`.
     */
    'POST /api/reading/signin/safari': async (req, res) => {
      const state = await readingSnapshot(config).catch(() => null);
      try {
        json(res, 200, {
          ok: true,
          ...(await daemon.reader.startSafariSignIn({ asin: state?.book?.asin ?? null })),
        });
      } catch (err) {
        json(res, 200, { ok: false, error: err.message });
      }
    },

    /**
     * The book again, from nothing Amazon has stored here.
     *
     * What the panel's "Try again" presses when Amazon has answered with its own
     * failure page. Closing and reopening the reader is not this: the registration
     * that failed lives in the profile and survives a new browser, which is why
     * "please try to open this book from the library again" never works.
     */
    'POST /api/reading/retry': async (req, res) => {
      json(res, 200, await daemon.reader.retryBook());
    },

    /** Put the reader away now rather than waiting for it to go idle. */
    'POST /api/reading/close': async (req, res) => {
      await daemon.reader.close();
      json(res, 200, { ok: true });
    },

    /** Opening the Kindle app is a thing you ask for, never something we do to you. */
    'POST /api/reading/open': async (req, res) => {
      const state = await kindleState(config);
      if (!state.available) return json(res, 409, { ok: false, error: state.reason });
      json(res, 200, { ok: true, ...(await openBook(state)) });
    },

    'GET /api/todos': async (req, res) => {
      const scraped = await scrapeTodoLists(config);
      json(res, 200, { ...scraped, lists: applyOverrides(scraped.lists) });
    },

    'POST /api/todos/toggle': async (req, res) => {
      const body = await readBody(req);
      if (!body.key) return json(res, 400, { ok: false, error: 'key required' });
      const record = setDone({
        key: String(body.key),
        done: Boolean(body.done),
        noteId: body.noteId ?? null,
        text: body.text ?? null,
      });
      // The router asks "is anything still open"; that answer just changed.
      invalidate('todo');
      json(res, 200, { ok: true, record });
    },

    /**
     * The two things you meant to have running. Read on demand rather than in the
     * router's state snapshot: the pomodoro reading costs two screen captures a
     * second apart, and the gap decision has under a second to make itself.
     */
    'GET /api/companions': async (req, res, url) => {
      const force = url.searchParams.get('force') === '1';
      json(res, 200, await companionsSnapshot(config, { force, overrides: companionOverrides }));
    },

    /**
     * The setup check, made pressable.
     *
     * The banner used to be able only to tell you what was missing, which leaves the
     * work exactly where it was: you still have to go to Music, still have to find
     * the track, still have to come back. Both of these do the thing and then
     * re-read the companion, so what the banner says next is a fresh reading rather
     * than an assumption that the button worked.
     */
    'POST /api/companions/binaural/play': async (req, res) => {
      const result = await playBinaural(config);
      invalidateCompanions();
      json(res, 200, {
        ...result,
        ...(await companionsSnapshot(config, { force: true, overrides: companionOverrides })),
      });
    },

    'POST /api/companions/pomodoro/start': async (req, res) => {
      const body = await readBody(req);
      const result = await startPomodoro(config, { minutes: Number(body.minutes) || 25 });
      invalidateCompanions();
      json(res, 200, {
        ...result,
        ...(await companionsSnapshot(config, { force: true, overrides: companionOverrides })),
      });
    },

    /**
     * Get the cards rung answering again. Anki is started behind everything and
     * waited for; it never becomes something you see.
     */
    'POST /api/anki/reconnect': async (req, res) => {
      json(res, 200, await ankiReconnect(config));
    },

    'POST /api/advance': async (req, res) => json(res, 200, await daemon.engine.advance()),

    'POST /api/standdown': async (req, res) => {
      const body = await readBody(req);
      json(res, 200, daemon.engine.standDown({ forDay: Boolean(body.day) }));
    },

    /** The undo for `{ day: true }`, which nothing could clear before midnight. */
    'POST /api/standdown/clear': async (req, res) => json(res, 200, daemon.engine.resumeDay()),

    // ---- debug: drive the machine into states the happy path cannot reach ----

    'POST /debug/submit': async (req, res) => {
      const body = await readBody(req);
      const gap = daemon.engine.onSubmit({
        surface: body.surface || 'debug',
        ts: Date.now(),
        synthetic: true,
      });
      json(res, 200, { ok: true, gapId: gap.id });
    },

    'POST /debug/rung': async (req, res) => {
      const body = await readBody(req);
      if (!daemon.engine.gap) return json(res, 409, { ok: false, error: 'no open gap' });
      const r = await daemon.engine.advance();
      json(res, 200, r);
    },

    /**
     * Force a companion verdict, or send `{}` to go back to the real readings.
     * Forced readings are marked, so the banner never claims a fact it was handed.
     */
    'POST /debug/companions': async (req, res) => {
      const body = await readBody(req);
      const allowed = new Set(['on', 'off', 'paused', 'other', 'unknown']);
      companionOverrides = {};
      for (const key of ['binaural', 'pomodoro']) {
        if (allowed.has(body[key])) companionOverrides[key] = body[key];
      }
      invalidateCompanions();
      json(res, 200, {
        ok: true,
        overrides: companionOverrides,
        ...(await companionsSnapshot(config, { overrides: companionOverrides })),
      });
    },

    'POST /debug/end': async (req, res) => {
      const body = await readBody(req);
      const rec = await daemon.engine.onEnd({ reason: body.reason || 'complete' });
      json(res, 200, { ok: true, gap: rec });
    },
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${config.port}`);
    const key = `${req.method} ${url.pathname}`;

    // One gate, before dispatch, rather than a check inside each of the thirty-odd handlers:
    // a handler added later cannot forget to call something it never had to call.
    const refusal = checkRequest(req, { port: config.port, token: controlToken, pathname: url.pathname });
    if (refusal) {
      const { status, ...body } = refusal;
      return json(res, status, { ok: false, ...body });
    }

    try {
      if (routes[key]) return await routes[key](req, res, url);

      if (url.pathname === '/' || url.pathname === '/index.html') {
        return serveFile(res, path.join(ROOT, 'web', 'dashboard.html'), 'text/html');
      }
      if (url.pathname === '/panel') {
        panelServes += 1;
        return serveFile(res, path.join(ROOT, 'web', 'panel.html'), 'text/html');
      }
      if (url.pathname === '/debug' || url.pathname === '/debug/') {
        return serveFile(res, path.join(ROOT, 'web', 'debug.html'), 'text/html');
      }
      json(res, 404, { error: 'not found', path: url.pathname });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });

  function serveFile(res, file, type) {
    if (!fs.existsSync(file)) return json(res, 404, { error: `missing ${path.basename(file)}` });
    let body = fs.readFileSync(file);
    // Serving a page is how a browser is handed the control token, so the pages themselves are
    // the only unauthenticated route. Everything they then fetch carries it.
    if (type === 'text/html') body = Buffer.from(injectToken(body.toString('utf8'), controlToken));
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    // Loopback only. Nothing here should ever be reachable from the network.
    server.listen(config.port, '127.0.0.1', resolve);
  });

  return {
    server,
    port: config.port,
    stats: () => ({ panelServes, asset: assetStamp() }),
    token: controlToken,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
