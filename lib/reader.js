import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR } from './paths.js';
import { connect, findBrowser, launchFirstWorkingBrowser, requireWebSocket } from './cdp.js';
import { openIn } from './state/system.js';
import { pageText } from './ocr.js';
import {
  carryAmazonSession,
  defaultChromeCookies,
  hasAmazonSession,
  sessionMark,
} from './amazon-session.js';

/**
 * The book, inside the panel.
 *
 * Every earlier attempt at this put the reader in a window of its own, because the
 * three obvious routes are all closed: Amazon sends `x-frame-options: SAMEORIGIN`
 * so the reader cannot be framed, the text is encrypted so it cannot be re-rendered
 * from the file, and Chrome ignores `--load-extension` on current releases so the page
 * cannot be given furniture of ours. A second window was what was left, and a
 * second window is the interruption this project exists to delete.
 *
 * The fourth route is to run Amazon's reader where nobody is looking and bring back
 * only its picture. A headless Chromium holds the session, renders the book at the
 * exact size of the panel's content area, and hands over frames; clicks and keys go
 * the other way. Nothing is decoded, nothing is stored, and the page you see is the
 * page Amazon drew.
 *
 * Two things learned the hard way and encoded here:
 *
 *   1. **It must be shut down, not killed.** Chrome writes its cookie store on its
 *      own schedule. SIGKILL after Amazon has rotated the session token leaves the
 *      profile holding a token that no longer works, and the next open lands on a
 *      sign-in page for no visible reason. Observed exactly once, which was enough.
 *   2. **The profile is durable.** Rebuilding it from a copy of your browser's
 *      cookies on every run would re-sign-in every run. The session is carried once,
 *      when there is nothing there, and after that the profile is its own.
 */

export const READER_PROFILE = path.join(LOG_DIR, 'reader-profile');

/** The book, addressed the way Amazon's own sign-in redirect addresses it. */
export function readerUrl(asin) {
  return asin ? `https://read.amazon.com/?asin=${encodeURIComponent(asin)}` : 'https://read.amazon.com';
}

/**
 * Amazon's questions, answered without you.
 *
 * Whispersync holds one position per book across every device, and a reader that
 * turns pages is a device moving that position. When the panel is ahead of what the
 * account last recorded, Amazon puts up "Most Recent Page Read" over a blurred page
 * and waits: the page behind it is unreadable, the transcription reads the dialog
 * instead of the book, and the panel fell back to showing you the picture of a
 * modal. That is the regression this deletes.
 *
 * Which button depends on when it is asked. On the way into a book, the synced
 * position is the answer you want, so it takes it. After that, the position the
 * panel is showing is the one you are reading from, and jumping backwards to where
 * some other device left off is the last thing to do to a person mid-page.
 *
 * Matched on the wording, not on the element: Amazon has four hidden `ion-modal`
 * templates in that document and reuses them, so which one carries the question is
 * not a stable fact. Anything that is not this question is left alone.
 */
export const SYNC_PROMPT = /most recent (page|location)|furthest (page|location)|go to (page|location)/i;

// Declared above PROBE because PROBE interpolates it. It is one pattern with three users
// now, and a second copy written out for the probe is how two of them would come to
// disagree about what counts as the question.
/**
 * Where the reader currently is, read off the page rather than assumed.
 *
 * The page label, or the location line PROBE falls back to, is where the reader states its
 * position in words, and it
 * is the same string a Kindle shows, so it can be checked against the device rather
 * than trusted. A sign-in page is recognised by its address: `/ap/signin` and
 * `/landing` are both "you are not signed in", and they need very different copy
 * from "the book is loading".
 */
export const PROBE = `(() => {
  const text = document.body ? document.body.innerText : '';
  // Anchored on the shape of the label, not on the word: the reader's own scripts
  // are in the body before it paints, and "Page visibility not supported" matched a
  // looser pattern and was shown to the operator as their position in the book.
  const label = (text.match(/Page [0-9,]+ of [0-9,]+[^\\n]{0,20}/) || [''])[0].trim();
  const loc = (text.match(/Location [0-9,]+ of [0-9,]+[^\\n]{0,20}/) || [''])[0].trim();
  const href = location.href;
  const signedOut = /\\/ap\\/signin|\\/landing|\\/ap\\/cvf|\\/ap\\/mfa/.test(href)
    || /^Sign in\\b/.test(text.trim());
  // Amazon's own failure page, which is a page like any other and therefore gets
  // photographed, transcribed and set in the panel's reading type as though it were
  // the book. That is how it was found: "Oops... Something Went Wrong" arrived where
  // page 79 belonged, under a progress bar that still said 39%, and nothing anywhere
  // said the reader had failed. Named here so the panel can say so instead.
  const bookError = /Oops\\b|Something Went Wrong/i.test(text)
    && /open this book from the library/i.test(text);
  // Where the book itself is drawn, as opposed to where Amazon's furniture is. The
  // reader lays its own toolbar, chevrons, scrubber and page label around a single
  // inner rectangle, and that rectangle is the only part of the window that is the
  // book. Measured rather than assumed: it moves with the viewport, and a hardcoded
  // inset would crop the text the first time the panel is resized.
  // Amazon's own loading element, by its own class name, measured off a wedged reader rather
  // than guessed at: a page showing nothing but this reported one svg and a body fourteen
  // characters long. Asked as "is it SHOWING", not "is it in the document". Presence alone is
  // the weaker test, and that weakness was already measured on the sync prompt: three ion-modal
  // elements sit permanently in that DOM, so their presence proves nothing. There is no recorded
  // sample of an arrived page with this element absent, so if Amazon keeps it mounted and hidden
  // the presence test would blind the reader permanently. The size and class test is the one
  // dismissScript already applies for exactly that reason. No backticks in this comment: it
  // lives inside a template literal.
  // A dialog Amazon has put over the book. Nothing here reported one, so a page carrying the
  // sync prompt counted as painted, and it was photographed and set in the panel's reading type
  // with the dialog in it. Measured in this DOM: six elements match these three tags and five of
  // them are permanently mounted at zero by zero, so presence proves nothing and the shown test
  // is the whole of it. Same predicate as the dismissal, so the two cannot disagree about what
  // is on screen. No backticks in this comment: it lives inside a template literal, and putting
  // one here is the exact mistake the warning below is about.
  const shownEl = (el) => {
    if (!el || el.classList.contains('overlay-hidden')) return false;
    const b = el.getBoundingClientRect();
    return b.width > 8 && b.height > 8;
  };
  const promptEl = Array.from(document.querySelectorAll('ion-alert, ion-modal, ion-popover'))
    .find((el) => shownEl(el) && ${SYNC_PROMPT.toString()}.test((el.innerText || '').replace(/\\s+/g, ' ').trim()));
  const prompt = promptEl ? (promptEl.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : '';
  const spinnerEl = document.querySelector('.kg-spinner');
  const spinnerBox = spinnerEl ? spinnerEl.getBoundingClientRect() : null;
  const spinner = Boolean(spinnerEl)
    && !spinnerEl.classList.contains('overlay-hidden')
    && spinnerBox.width > 8 && spinnerBox.height > 8;
  const view = document.querySelector('.kg-view') || document.querySelector('#kr-renderer');
  const r = view ? view.getBoundingClientRect() : null;
  const clip = r && r.width > 40 && r.height > 40
    ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    : null;
  return JSON.stringify({
    href,
    title: document.title,
    label: label || loc,
    signedOut,
    bookError,
    clip,
    // The reader draws its text into positioned nodes rather than a flow, so a
    // page that has painted is not one whose innerText is long. This is the
    // cheapest honest signal that something is on screen.
    // Reported separately from painted so a caller can tell "still loading" from "loaded
    // something that is not the book", which are different failures with different remedies.
    spinner,
    // A spinner is not a painted page. Without the first clause a reader stuck on the
    // loading element counts as painted the moment its shell draws three of anything, and
    // the panel photographs the spinner and sets it in the reading type as the book.
    painted: !spinner
      && (Boolean(label || loc) || document.querySelectorAll('img,canvas,svg').length > 2),
    // How many device pixels the page already believes it has to a point. Reported for
    // diagnosis only: the clip scale is fixed at 1 (see captureScale), because the two would
    // multiply and a constant 2 against a page already at 2 gives a four-times-oversized
    // picture. No backticks in here: this comment lives inside a template literal.
    dpr: window.devicePixelRatio || 1,
    passkey: Boolean(window.__interstice_passkey),
    // Scripts the vendor's own app asked for and did not get. Reported as the list rather than
    // as a flag so the panel can name the file and the operator can check it themselves, which
    // is the difference between a claim and something they can verify. No backticks in here.
    deadScripts: (window.__interstice_dead_scripts || []).slice(0, 4),
    // Amazon's question, if one is up. The text, not a flag, so the panel can show the operator
    // what they are being asked rather than telling them something is in the way.
    prompt,
  });
})()`;

/**
 * Whether a probe shows a reader someone is actually signed in to.
 *
 * Not `signedOut === false`. That flag is a test for the sign-in page, so everything
 * which is not yet a page answers it the same way a book does: `about:blank` at the
 * moment a window opens is "not signed out", and treating that as signed in reports
 * success before the browser has loaded anything at all.
 *
 * So the question is asked the other way round, from evidence rather than from its
 * absence: the reader's own address, no sign-in on it, and something painted.
 */
export function signedInToReader(probe) {
  if (!probe) return false;
  return (
    /^https:\/\/read\.amazon\.com\//.test(String(probe.href || ''))
    && probe.signedOut === false
    && probe.painted === true
  );
}

/**
 * The narrowest page the reader will lay out.
 *
 * Chrome clamps a page below roughly this and does it quietly, so a panel 412
 * points wide gets a wider layout whether or not anyone accounted for it, and
 * everything the reader positions from the right edge lands on the text: the
 * floating book title printed itself across the second line of the page.
 */
export const MIN_WIDTH = 480;
export const MIN_HEIGHT = 400;

/**
 * The panel's rectangle, grown to a size the reader will lay out for, in the same
 * proportions.
 *
 * Grown rather than stretched, so the panel can scale the picture back down and
 * have it fill its box exactly, and so the page is paginated for the shape you are
 * actually looking at rather than for a squarer one.
 */
export function fitViewport({ width, height }) {
  const w = Math.round(width || MIN_WIDTH);
  const h = Math.round(height || MIN_HEIGHT);
  if (w >= MIN_WIDTH) return { width: w, height: Math.max(MIN_HEIGHT, h) };
  return { width: MIN_WIDTH, height: Math.max(MIN_HEIGHT, Math.round((h * MIN_WIDTH) / w)) };
}

/**
 * Amazon's own furniture, hidden.
 *
 * The reader keeps a floating copy of the book title that it positions for a full
 * window; in a panel-sized one it sits directly on top of the first lines of the
 * page. The title is already at the top of the panel, in our own type, so nothing
 * is lost by removing theirs.
 *
 * The rest of what is hidden here is the furniture that *overlaps the page*: the two
 * chevrons, the bookmark, and the "Back to 79" pill the scrubber leaves behind. The
 * capture is already clipped to the page rectangle (`PROBE` measures it, `clipNow` clamps
 * it), so the toolbar and
 * the scrubber never reach a frame at all; these four do, because they are drawn on
 * top of the text rather than around it. The pill is the one that mattered: it read
 * back as "ck to 79" and was set into the middle of a paragraph.
 *
 * The header and the footer are deliberately *not* hidden. The reader measures its
 * own page rectangle against them, so removing them moves the text, and the page
 * label in the footer is the only place the reader states its position in words.
 *
 * A stylesheet rather than a script that deletes nodes: the reader rebuilds its own
 * DOM on every page turn, and anything removed comes back on the next one.
 */
export const READER_CSS = [
  '.fixed-book-title, .top-chrome__book-title { display: none !important; }',
  // Hidden with `visibility`, not `display`. Hiding these with `display: none`
  // removes them from layout, and this reader recomputes its own page rectangle
  // against them continuously: the renderer went from its usual 96% of a core to
  // pegged-and-unresponsive, screenshots stopped being answered inside twenty
  // seconds, and the book could not be turned at all. `visibility: hidden` takes
  // them off the screen and leaves the layout exactly as the reader measured it.
  //
  // Only the ones that overlap the page rectangle need this at all. The toolbar and
  // the scrubber sit outside the clip and never reach a frame; the "Back to 79" pill
  // clips the corner of it, and it is the one that read back as "ck to 79" in the
  // middle of a paragraph.
  '#kra-scrubber-back-button, button.bookmark { visibility: hidden !important; }',
  '#kr-chevron-left, #kr-chevron-right { visibility: hidden !important; }',
].join('\n');


/**
 * How small a picture is worth taking purely to ask "has it turned yet".
 *
 * The turn has to be watched for, and what to watch is the question. Asking the
 * *document* is the obvious answer and the wrong one: this page pegs a core the
 * whole time it is open, which is a documented fact about it (see `capture`), and
 * under that load a `Runtime.evaluate` that measures two milliseconds when the page
 * is idle can take longer than its own twenty-second timeout. Turn detection built
 * on it therefore worked perfectly until the renderer got busy, at which point a
 * page turn took twenty-six seconds and then failed.
 *
 * A screenshot is served by the browser process rather than by that renderer, and it
 * stays fast regardless: 65ms measured while the renderer was at 96% of a core. It is taken at
 * the same scale as a real frame, because taking it at a quarter scale was the obvious economy
 * and it wedged the browser. It is a few kilobytes, which is nothing to encode and nothing to
 * compare, and it is only ever used to answer yes or no.
 *
 * The page *label* is not a signal at all, which is the trap worth naming. At a
 * panel-height viewport several screens share one "Page 79 of 220", so a turn that
 * plainly happened leaves the label exactly where it was.
 */
export const WATCH_SCALE = 1;

/**
 * Did the reopened tab come back as ANYTHING a person can act on?
 *
 * Named because two callers were computing it separately and had drifted: one counted a
 * sign-in page as arrival and the other did not, so a fully rendered sign-in form waiting for
 * input was reported as a tab that had not painted anything. The difference now has to be
 * written down to exist, and it is: `signedOut` is arrival, because the reader is not wedged,
 * it is asking for something, and the panel has a surface for it. Amazon's own failure page
 * counts for the same reason. Nothing arriving is the one case this exists to refuse.
 */
export function arrivedAtSomething(probe) {
  return Boolean(probe && (probe.painted || probe.bookError || probe.signedOut));
}

/**
 * How long `settle` waits between probes. Named because two separate rules are stated in terms
 * of it: how stale a reading may be and still count as current, and how a quiet stretch is
 * measured against the caller's budget.
 */
export const SETTLE_POLL_MS = 400;

export function dismissScript(answer = 'No') {
  return `(() => {
    const want = ${JSON.stringify(answer)}.toLowerCase();
    const shown = (el) => {
      if (!el || el.classList.contains('overlay-hidden')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 8;
    };
    const answered = [];
    for (const el of document.querySelectorAll('ion-alert, ion-modal, ion-popover')) {
      if (!shown(el)) continue;
      const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
      if (!${SYNC_PROMPT.toString()}.test(text)) continue;
      const buttons = Array.from(el.querySelectorAll('button, ion-button, [role="button"]'));
      const hit = buttons.find((b) => (b.innerText || '').trim().toLowerCase() === want);
      if (!hit) continue;
      hit.click();
      answered.push(text.slice(0, 120));
    }
    return JSON.stringify(answered);
  })()`;
}

/**
 * The same search as `dismissScript` with the clicking removed: which matching prompts are on
 * screen right now. It exists so a dismissal can be checked rather than assumed, and it shares
 * the shown/match predicate so the two cannot drift into disagreeing about what is a prompt.
 */
export function promptScript() {
  return `(() => {
    const shown = (el) => {
      if (!el || el.classList.contains('overlay-hidden')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 8;
    };
    const up = [];
    for (const el of document.querySelectorAll('ion-alert, ion-modal, ion-popover')) {
      if (!shown(el)) continue;
      const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
      if (!${SYNC_PROMPT.toString()}.test(text)) continue;
      up.push(text.slice(0, 120));
    }
    return JSON.stringify(up);
  })()`;
}

/**
 * One column, because the panel is one column wide.
 *
 * The reader defaults to two, and at your reading font that is about a dozen
 * characters to a line in a panel: a chapter heading came out broken one word at a
 * time down the page. Two settings are forced, both of them things a panel-sized page decides:
 * one column, and narrow side margins. The font and the theme are yours, they sync from your
 * Kindle, and a tool that quietly re-set those would be worse than one that renders badly.
 */
export const DISPLAY_KEY = 'KWR_Display_Settings';

export function displayScript(display) {
  return `(() => {
    try {
      const key = ${JSON.stringify(DISPLAY_KEY)};
      const want = ${JSON.stringify(display)};
      const now = JSON.parse(localStorage.getItem(key) || '{}');
      let changed = false;
      for (const [k, v] of Object.entries(want)) {
        if (v !== null && now[k] !== v) { now[k] = v; changed = true; }
      }
      if (changed) localStorage.setItem(key, JSON.stringify(now));
    } catch { /* a reader without storage keeps its own settings */ }
  })()`;
}

export const CSS_INJECT = `(() => {
  const apply = () => {
    if (document.getElementById('interstice-reader-css')) return;
    const s = document.createElement('style');
    s.id = 'interstice-reader-css';
    s.textContent = ${JSON.stringify(READER_CSS)};
    (document.head || document.documentElement).appendChild(s);
  };
  apply();
  document.addEventListener('DOMContentLoaded', apply);
})()`;

/**
 * Chrome's passkey prompt is drawn by the browser, not by the page, so a headless
 * browser has nowhere to put it and the call simply never resolves. Left alone that
 * is a sign-in page that does nothing when you press the button, which is the worst
 * of the possible failures: it looks like our bug.
 *
 * So the call is watched for. It still fails, but the panel can say why, and can
 * offer the one thing that does work.
 */
export const PASSKEY_WATCH = `
  (() => {
    if (window.__interstice_passkey_hooked) return;
    window.__interstice_passkey_hooked = true;
    const real = navigator.credentials && navigator.credentials.get;
    if (!real) return;
    navigator.credentials.get = function (...args) {
      if (args[0] && args[0].publicKey) window.__interstice_passkey = true;
      return real.apply(this, args);
    };
  })()
`;

/**
 * Amazon's reader is a code-split web app, and on 2026-08-22 two of its own chunks started
 * answering 404 from Amazon's CDN. Measured, not inferred: `curl` with no cookies and no
 * profile gets `HTTP 404, 9 bytes` for `725-ca73bf4e63259892d294.chunk.js` and
 * `789-ef89cfa2f84d6e6b0e8a.chunk.js`, while a sibling chunk of the same app returns 200. The
 * loader throws `ChunkLoadError`, the book pane never mounts, and the loading element spins
 * forever with no error anywhere on screen.
 *
 * Nothing here can fix a file missing from someone else's CDN. What it can do is stop calling
 * that "loading". Without this the panel waits on a spinner indefinitely and the reader looks
 * broken in the one way that reads as our fault, which is the same reason PASSKEY_WATCH exists.
 *
 * The capture phase is not optional. A `<script>` that fails to load fires an `error` event on
 * the element that does NOT bubble, so a listener on `window` sees it only while the event is
 * travelling down. This is also why the resource timeline cannot be used instead: these chunks
 * are cross-origin without `Timing-Allow-Origin`, so `responseStatus` reads 0 rather than 404,
 * and a filter on the status finds nothing at all. Both were tried against the live failure.
 */
export const SCRIPT_WATCH = `
  (() => {
    if (window.__interstice_script_hooked) return;
    window.__interstice_script_hooked = true;
    window.__interstice_dead_scripts = [];
    addEventListener('error', (e) => {
      const el = e.target;
      if (!el || el === window || el.tagName !== 'SCRIPT' || !el.src) return;
      const seen = window.__interstice_dead_scripts;
      if (seen.length < 8 && seen.indexOf(el.src) === -1) seen.push(el.src);
    }, true);
  })()
`;

/**
 * Amazon's own reader, driven where nobody can see it, and handed back as pictures and words.
 *
 * Owns one headless browser and one page, and everything that page is asked: opening a book at a
 * position, turning, clicking, typing, photographing, reading the picture back as text, and
 * keeping a small shelf of pages either side of you so a turn is instant.
 *
 * Three things it is careful about, each learned from a failure recorded in
 * `docs/BUG_ISSUE_PREVENTION.md`:
 *
 *   - It is shut down, never killed, while it holds a session. Chrome writes its cookie store on
 *     the way out, and a SIGKILL after Amazon rotates the token leaves a profile signed out.
 *   - It never photographs a page that is not the book. A page with no position label is a shell,
 *     a spinner, or Amazon's failure page, and the panel showing one as though it were page 79 is
 *     the bug this class exists to have stopped making.
 *   - It reports what it can see rather than what it last saw. A probe that cannot run does not
 *     get to answer with the previous answer.
 *
 * @see settle    for why a paint alone is not enough to stop waiting on.
 * @see capture   for the refusal above.
 * @see retryBook for the recovery a stuck book actually needs.
 */
export class Reader {
  constructor({ config, logger } = {}) {
    this.config = config;
    this.logger = logger;
    this.browser = null; // { child, port }
    this.cdp = null;
    this.sessionId = null;
    this.targetId = null;
    this.starting = null;
    this.frame = null; // { seq, jpeg, at }
    this.seq = 0;
    this.viewport = { width: 412, height: 520 };
    // The last box the panel asked for, which is what a resize is measured against.
    this.requested = null;
    this.asin = null;
    this.lastUsedAt = 0;
    this.carried = null;
    this.error = null;
    this.lastRecoveryAt = 0;
    // The last page read out of a picture, and which picture it came from.
    this.ocr = null;
    // A sign-in window, while one is open. See `startSignIn`.
    this.signin = null;
    // The page rectangle, and the density it is drawn at. See `PROBE`.
    this.clip = null;
    this.dpr = 1;
    // When reading ahead last failed, so the poll can retry it without hammering.
    this.readAheadFailedAt = 0;
    // Consecutive turns that did not happen. Two is a wedged renderer, not a slow
    // page, and the way out of that is `revive`.
    this.stuck = 0;
    this.revivedAt = 0;
    // Whether the last reopen also threw away what Amazon had stored here. Reported
    // rather than assumed: the clear is the half of a retry that can fail on its own.
    this.cleared = false;

    /* ------------------------------------------------------------- the shelf --- */
    /**
     * Pages are held, not fetched.
     *
     * Turning a page used to mean: press an arrow, wait for Amazon to repaint, take
     * a picture, read the picture. Between a second and two seconds of nothing, on
     * every press, in both directions, for a page that had already been read once on
     * the way past. That is the wait this deletes.
     *
     * `pos` is the page you are looking at. `frontier` is where the browser actually
     * is, which is ahead of you while it fills the shelf. They are different numbers
     * on purpose: turning forward into a page that is already on the shelf costs one
     * object lookup, and the browser never has to move at all.
     */
    this.pos = 0;
    this.frontier = 0;
    this.pages = new Map();
    // Every move of the browser goes through this, in order. Two arrow presses
    // racing each other lose count of where the browser is, and a shelf indexed by
    // a position that is wrong is worse than no shelf.
    this.chain = Promise.resolve();
    this.prefetching = null;
    // Bumped whenever you turn a page. The prefetcher checks it between steps and
    // gives up its slot rather than making you wait behind three speculative turns.
    this.demand = 0;
  }

  get settings() {
    const r = this.config?.reading ?? {};
    return {
      port: r.readerPort ?? 7421,
      quality: r.frameQuality ?? 72,
      idleCloseMs: r.idleCloseMs ?? 15 * 60 * 1000,
      loadTimeoutMs: r.loadTimeoutMs ?? 40000,
      // The sign-in window is a second browser on the same profile, so it needs a
      // debugging port of its own; sharing the reader's would collide.
      signinPort: r.signinPort ?? 7422,
      // Long enough to find your phone, unlock it, and scan. A passkey is not a
      // password you can type before a five minute clock runs out.
      signinTimeoutMs: r.signinTimeoutMs ?? 15 * 60 * 1000,
      carrySession: r.carrySession !== false,
      chromeCookies: r.chromeCookies ?? defaultChromeCookies(),
      // Only the ones a panel-sized page forces. Anything left null is the
      // reader's own, which for most of these is whatever your Kindle syncs.
      display: { maxNumberColumns: 1, sideMarginsSize: 'narrow', ...(r.display ?? {}) },
      // How far ahead the browser runs while you are reading, and how much of what
      // you have already passed is kept. Both small on purpose: every page ahead is
      // a page Amazon believes you have reached, and a shelf of twenty would report
      // you twenty pages further into the book than you are.
      readAhead: r.readAhead ?? 2,
      keepBehind: r.keepBehind ?? 4,
    };
  }

  get running() {
    return Boolean(this.cdp && !this.cdp.closed && this.browser);
  }

  /** True while a sign-in window owns the profile and the reader must keep off it. */
  get signingIn() {
    return Boolean(this.signin?.active);
  }

  /**
   * Sign in the way a person signs in: in a browser they can see.
   *
   * Carrying cookies only ever worked when there was a live session to carry, and a
   * session your own browser has already lost cannot be copied into existence. This
   * is the path that does not depend on one, and it is also the only path a cross-device passkey can take; one held in iCloud Keychain has
   * its own route, see `startSafariSignIn`: Chrome draws that QR code in its own window chrome, so a browser with
   * a window has somewhere to draw it and a headless one never did.
   *
   * The window is Chrome's, not ours, so every method Amazon offers works in it: a
   * password, an emailed code, or a passkey scanned with a phone.
   *
   * It runs on the reader's own profile rather than beside it, which is what makes
   * the sign-in stick without copying anything afterwards. Two browsers cannot hold
   * one profile, so the reader is closed first and reopened after, and the window
   * closes itself the moment the session lands.
   */
  startSignIn({ asin = null } = {}) {
    if (this.signingIn) return this.signInStatus();
    // Told which book rather than reading it off the reader, which knows of none
    // until it has opened one. A daemon restarted since you last read lands the
    // window on the Kindle landing page, one click short of the sign-in form, and
    // then has nowhere to go back to afterwards.
    this.signinAsin = asin ?? this.asin;
    this.signin = {
      active: true,
      phase: 'opening',
      reason: 'opening a Chrome window for you to sign in',
      startedAt: Date.now(),
      ok: null,
    };
    // Deliberately not awaited: signing in takes as long as a person takes, and the
    // press that starts it must come back at once. Progress is polled instead.
    this.#runSignIn().catch((err) => {
      this.signin = {
        active: false,
        phase: 'failed',
        reason: err.message,
        ok: false,
        endedAt: Date.now(),
      };
    });
    return this.signInStatus();
  }

  signInStatus() {
    if (!this.signin) return { active: false, phase: 'idle', reason: null, ok: null };
    const { active, phase, reason, ok } = this.signin;
    return { active, phase, reason, ok };
  }

  /**
   * Sign in in Safari, which is where the keychain is.
   *
   * Chrome cannot reach it. The passwords and passkeys are in iCloud Keychain, Safari
   * fills from it natively, and Chrome does not: the extension that would bridge the
   * two can only be loaded with `--load-extension`, which Chrome ignores on current
   * releases. So the sign-in that a person actually has to type goes where typing it is
   * one Touch ID press.
   *
   * What this cannot do is hand the session back. Safari keeps its cookies in a
   * container macOS refuses to read without Full Disk Access, which a launchd agent
   * cannot ask for, so there is no copying the result across the way `carry` does
   * from Chrome. Signing in here re-establishes the account on this machine; the
   * reader still takes its session from a Chrome profile.
   *
   * Which is why no panel control presses it. `reauthenticate` runs first and
   * silently, and it is enough on its own whenever your own Chrome is still signed
   * in. This is the path for when it is not.
   */
  async startSafariSignIn({ asin = null } = {}) {
    const url = readerUrl(asin ?? this.asin);
    // `open -a` rather than the default browser: the whole point is Safari.
    await openIn('Safari', url);
    this.safariSignInAt = Date.now();
    return { opened: true, browser: 'Safari', url };
  }

  async #runSignIn() {
    const s = this.settings;
    const asin = this.signinAsin ?? this.asin;
    const viewport = { ...this.viewport };
    if (!findBrowser(fs)) throw new Error('no Chromium-family browser found to sign in with. Remedy: install Google Chrome (or another Chromium-family browser) so the reader profile has one to drive.');

    // The reader has to let go of the profile before Chrome can take it: two
    // browsers on one user-data-dir is a profile-in-use error, and the cookies the
    // sign-in writes would be the ones that got thrown away.
    await this.close().catch(() => {});

    let browser = null;
    let cdp = null;
    try {
      browser = await launchFirstWorkingBrowser({
        fs,
        profile: READER_PROFILE,
        port: s.signinPort,
        headless: false,
        extraArgs: ['--window-size=980,860', '--window-position=80,60'],
      });
      cdp = await connect(browser.wsUrl);
      const { targetId } = await cdp.send('Target.createTarget', { url: readerUrl(asin) });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);

      this.signin.phase = 'waiting';
      this.signin.reason = 'sign in to Amazon in the Chrome window';

      const deadline = Date.now() + s.signinTimeoutMs;
      let signedIn = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1200));
        let probe = null;
        try {
          const { result } = await cdp.send(
            'Runtime.evaluate',
            { expression: PROBE, returnByValue: true },
            sessionId,
            { timeoutMs: 8000 }
          );
          probe = JSON.parse(result.value);
        } catch {
          // Either the page is mid-navigation, which is constant during a sign-in,
          // or the window is gone. Only the second one ends the wait.
          if (cdp.closed) break;
          const alive = await cdp
            .send('Target.getTargets', {}, undefined, { timeoutMs: 5000 })
            .then((t) => t.targetInfos.some((x) => x.targetId === targetId))
            .catch(() => false);
          if (!alive) break;
          continue;
        }
        if (signedInToReader(probe)) {
          signedIn = true;
          break;
        }
      }

      this.signin.phase = 'finishing';
      this.signin.reason = signedIn ? 'signed in, closing the window' : 'closing the window';

      // Closed rather than killed, and awaited: Chrome writes its cookie store on
      // the way out, and a session that is not on disk when the reader reopens is a
      // sign-in page all over again.
      await cdp.send('Browser.close', {}, undefined, { timeoutMs: 8000 }).catch(() => {});
      cdp.close();
      cdp = null;
      await this.#waitForExit(browser.child);
      browser = null;

      if (!signedIn) {
        this.signin = {
          active: false,
          phase: 'failed',
          ok: false,
          reason: 'the window closed before the sign-in finished',
          endedAt: Date.now(),
        };
        return;
      }

      // Reopened here rather than left to the next poll, so that the press that
      // started this ends with the book on screen instead of a spinner.
      await this.ensure({ asin, ...viewport });
      await this.capture({ force: true });
      // Asked of the reopened reader, not of the window that has gone: the sign-in
      // only counts if the thing you are going to read is the thing that is signed in.
      //
      // Watched rather than sampled. See `waitUntilSignedIn`.
      const ok = await this.waitUntilSignedIn();
      this.signin = {
        active: false,
        phase: ok ? 'done' : 'failed',
        ok,
        reason: ok ? 'signed in' : 'Amazon still wants a sign-in',
        endedAt: Date.now(),
      };
    } finally {
      // Never leave a window behind, whatever went wrong on the way here.
      try {
        if (cdp && !cdp.closed) {
          await cdp.send('Browser.close', {}, undefined, { timeoutMs: 5000 }).catch(() => {});
          cdp.close();
        }
        if (browser?.child) await this.#waitForExit(browser.child);
      } catch {
        /* the window is going away either way */
      }
      if (this.signin?.active) {
        this.signin = { active: false, phase: 'failed', ok: false, reason: 'the sign-in ended early' };
      }
    }
  }

  /**
   * Whether the reader arrives at the book, given a moment to get there.
   *
   * Watched rather than sampled. A reader reopened on a session that has just been
   * signed in bounces through `/ap/signin` on its way to the book, so the single
   * reading taken the instant it reopened reported a sign-in that had in fact
   * worked as a failure, with the book on screen behind the message saying so.
   *
   * Long enough to outlast a book, which is the second half of the same lesson.
   * Twenty seconds looked generous and was not: a real sign-in landed, the reader
   * reopened, and the wait ran out while Amazon was still painting page 79. The
   * verdict was "Amazon still wants a sign-in" over a legible book. This is past
   * `loadTimeoutMs`, because the thing being waited for is a page load.
   */
  async waitUntilSignedIn({ tries = 75, everyMs = 1000 } = {}) {
    for (let i = 0; i < tries; i += 1) {
      if (i) await new Promise((r) => setTimeout(r, everyMs));
      if (signedInToReader(await this.state().catch(() => null))) return true;
    }
    return false;
  }

  async #waitForExit(child, timeoutMs = 6000) {
    if (!child || child.exitCode !== null) return true;
    const gone = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref?.();
      child.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!gone) child.kill('SIGKILL');
    return gone;
  }

  /**
   * Sign the reader profile in by carrying the session you already have.
   *
   * Only when there is nothing there, unless `force` says otherwise: the forced path deletes the
   * store first, which is why `reauthenticate` checks the reader is signed out before asking for
   * it. A profile that has been signed in is left alone by the ordinary path: its cookies are
   * newer than the ones in your ordinary browser, and
   * overwriting them with older ones is how a working session becomes a sign-in
   * page.
   */
  async carry({ force = false } = {}) {
    const s = this.settings;
    if (!s.carrySession) return { carried: 0, reason: 'carrying the session is turned off' };
    const to = path.join(READER_PROFILE, 'Default', 'Cookies');
    if (!force && (await hasAmazonSession(to))) {
      return { carried: 0, reason: 'the reader is already signed in' };
    }
    if (force) {
      // Never throw away a session before knowing there is one to replace it with.
      // The forced path deletes the rows it is about to overwrite, and doing that
      // against a browser which is not signed in either turns a session that might
      // still have worked into a certain sign-in page.
      if (!(await hasAmazonSession(s.chromeCookies))) {
        return { carried: 0, reason: 'your own browser is not signed in to Amazon either' };
      }
      // Copying a session onto itself cannot fix anything, and the forced path pays
      // for the attempt by deleting the store first. Once you have signed in through
      // the Chrome window, the reader holds the newer session of the two, and this
      // is what stops the ten-minute recovery from overwriting it with the dead one
      // your ordinary browser is still carrying.
      const [mine, theirs] = await Promise.all([sessionMark(to), sessionMark(s.chromeCookies)]);
      if (mine && theirs && mine === theirs) {
        return { carried: 0, reason: 'your browser is holding the same session this reader already has' };
      }
      try {
        fs.rmSync(to, { force: true });
      } catch {
        /* a store we cannot remove is one the merge will have to live with */
      }
    }
    this.carried = await carryAmazonSession({ from: s.chromeCookies, to });
    return this.carried;
  }

  /**
   * Sign the reader back in, by carrying the session again.
   *
   * The browser has to be shut for this, and that is not an implementation detail:
   * Chrome reads its cookie store once at launch and rewrites it on its own
   * schedule, so writing rows underneath a running one changes nothing you can see
   * and is then overwritten. Close, carry, open.
   *
   * Amazon rotates that session, which is why this is needed at all: a reader that
   * was signed in yesterday can be signed out today, and the fix is a copy of the
   * session your own browser is holding right now.
   */
  async reauthenticate() {
    if (this.signingIn) return { carried: 0, signedIn: false, reason: 'a sign-in window is already open' };

    // Never spend a working session to go looking for one. The forced carry below
    // deletes this profile's cookie store before it writes, so running it against a
    // reader that is already signed in destroys the session it is trying to restore:
    // measured, once, on a session that had just been signed in through the window.
    //
    // Asked of the running reader rather than taken from the caller, because a
    // sign-out is also what a redirect looks like for the second it is happening.
    if (this.running && signedInToReader(await this.state().catch(() => null))) {
      return { carried: 0, signedIn: true, reason: 'the reader is already signed in' };
    }

    const asin = this.asin;
    await this.close();
    const carried = await this.carry({ force: true });
    if (carried.carried === 0) {
      // The close above is the price the forced carry charges, and here there was nothing
      // to carry. Leaving the reader down would be worse than the expired session it failed
      // to replace: `ensure` returns ok over a browser that is no longer running, so the
      // caller reads success and the page is blank with no error to explain it. A warm poll
      // loop hides that by opening again a second later; one cold call does not, and that is
      // the shape this was found in. Reopen on the way out so a failed recovery costs the
      // session it could not restore and nothing else.
      await this.ensure({ asin, ...this.viewport }).catch(() => {});
      return { ...carried, signedIn: false };
    }

    await this.ensure({ asin, ...this.viewport });
    await this.capture({ force: true });

    // Whether this worked is a question about the page, not about the copy. Cookie
    // rows moving is not the same fact as being signed in, and reporting the count
    // as success is how a dead session came back as "signed in from your own browser
    // session" while the reader sat on the sign-in page and the panel span forever.
    const view = await this.state();
    const signedIn = view.signedOut === false;
    return {
      ...carried,
      signedIn,
      reason: signedIn
        ? 'signed in from your own browser session'
        : 'your own browser’s Amazon session has expired too, so there was nothing live to carry',
    };
  }

  async #evaluate(expression, { returnByValue = true, timeoutMs = 8000 } = {}) {
    const { result } = await this.cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue, awaitPromise: false },
      this.sessionId,
      { timeoutMs }
    );
    return result?.value;
  }

  async #start() {
    requireWebSocket();
    if (!findBrowser(fs)) throw new Error('no Chromium-family browser found to render the book. Remedy: install Google Chrome (or another Chromium-family browser) so the reader has one to render into.');
    fs.mkdirSync(path.join(READER_PROFILE, 'Default'), { recursive: true });
    await this.carry();

    const s = this.settings;
    // Every installed browser, in turn, until one answers. Being installed is not the same as
    // working: some Chrome builds start and never open a DevTools port at all.
    const browser = await launchFirstWorkingBrowser({
      fs,
      profile: READER_PROFILE,
      port: s.port,
      // Roomier than the page will ever be asked to be. The viewport is set per
      // page; the window only has to be big enough not to constrain it, because a
      // window smaller than the override is a layout nobody asked for.
      extraArgs: ['--window-size=1200,1000'],
    });
    const cdp = await connect(browser.wsUrl);
    this.browser = browser;
    this.cdp = cdp;
    await this.#openTab();
    return browser;
  }

  /**
   * A fresh tab on the browser we already have, dressed the way the reader needs it.
   *
   * Split out of `#start` because it is also the only way back from a renderer that
   * has stopped answering. See `revive`.
   */
  async #openTab() {
    const s = this.settings;
    const cdp = this.cdp;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = sessionId;
    this.targetId = targetId;

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    // Both have to be in place before the page runs, not after it.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PASSKEY_WATCH }, sessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SCRIPT_WATCH }, sessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: CSS_INJECT }, sessionId);
    // Before the reader reads its own settings, not after: applied afterwards it
    // would take effect one page turn later, or not until the next reload.
    await cdp.send(
      'Page.addScriptToEvaluateOnNewDocument',
      { source: displayScript(s.display) },
      sessionId
    );

    await this.#applyViewport();
    return { targetId, sessionId };
  }

  /**
   * Come back from a renderer that has stopped answering.
   *
   * Amazon's reader burns a core the whole time it is open, which is a documented
   * fact about it and has always been true here. What is new is that a run of page
   * turns can tip it from busy into stuck: measured, repeatedly, the renderer goes to
   * 102% of a core and 600MB and then answers nothing at all. Not screenshots, not
   * evaluations, and not `Page.navigate` either, so a reload cannot be the way out:
   * the reload is itself a message to a renderer that has stopped reading its inbox.
   *
   * Closing the tab is a browser-process operation, so it works when everything
   * inside the tab does not. The dead renderer goes with it, a fresh one takes its
   * place, and the book reopens where Whispersync says you are, which is where you
   * were, because turning those pages is what told Amazon so.
   *
   * The cost is a page load, and it is paid where it is visible rather than hidden
   * behind a spinner that never ends. A book you can read with an occasional pause is
   * worth incomparably more than one that stops for good on page four.
   */
  async revive({ clearFirst = false } = {}) {
    if (!this.cdp || this.cdp.closed) return false;
    const asin = this.asin;
    this.cleared = false;
    this.logger?.warn?.('reader: the book stopped answering, reopening it');
    try {
      // Not awaited past a short budget: this is a message to a browser about a tab
      // whose renderer is wedged, and the browser answers, but there is no sense
      // waiting on it if it does not.
      await this.cdp
        .send('Target.closeTarget', { targetId: this.targetId }, undefined, { timeoutMs: 5000 })
        .catch(() => {});
      await this.#openTab();
      // In the gap, which is the only moment it can be done: the new tab is a page,
      // so the call is answered, and nothing has loaded into it to write it back.
      if (clearFirst) {
        this.cleared = await this.clearSiteData().catch((err) => {
          // Worth reopening anyway. Not every one of these failures is the stored
          // registration, and a fresh tab on the book is the cheaper half of the fix.
          this.logger?.warn?.(`reader: could not clear Amazon's stored data (${err.message})`);
          return false;
        });
      }
      await this.cdp.send('Page.navigate', { url: readerUrl(asin) }, this.sessionId);
      // What `settle` found, not merely that it ran. This return value was discarded, so `revive`
      // answered true whenever its steps completed without throwing, and a reopen that came back
      // to the same unresponsive page reported success. Both callers were reading that as "the
      // book is back": `retryBook` told the panel so, and the turn path below tried to press a
      // key into a page that was not there.
      const settled = await this.settle();
      // Redundant with the document-start hook `#openTab` just installed, so a
      // failure here usually costs nothing. Logged anyway: if this one failed the
      // hook may have failed too, and then every screenshot from the reopened tab
      // has Amazon's chrome in it, which is a puzzle worth one line of history.
      await this.#evaluate(CSS_INJECT).catch((err) => {
        this.logger?.info?.(`reader: could not restyle the reopened tab (${err.message})`);
      });
      await this.#seed();
      this.revivedAt = Date.now();
      const back = arrivedAtSomething(settled);
      // Cleared only on the path that succeeded. This ran unconditionally, on the same path
      // that can return false, and `this.error` is the string `state` reports and the panel's
      // remedy mapper is driven off: a failed revive erased the one message that would have
      // routed the reader to the remedy for a page that has stopped responding.
      if (back) this.error = null;
      return back;
    } catch (err) {
      this.error = err.message;
      return false;
    }
  }

  /**
   * Throw away what Amazon has stored here, and keep the session.
   *
   * Measured on 2026-08-17, on a profile that had been reading for weeks. Every
   * attempt at the book, by address and by clicking it in the library, drew "Oops...
   * Something Went Wrong. Please try to open this book from the library again", and
   * the network showed why: four 403s from
   * `service/mobile/register/getDeviceToken`. The library itself listed the book, so
   * the account was fine and the session was fine; what was not fine was this
   * profile's registration as a device, and no amount of reopening the book touches
   * that, which is why "open it from the library again" is advice that cannot work.
   *
   * The control was a profile carrying nothing but this one's cookies: same machine,
   * same browser, same book, and it opened at `Page 209 of 220` without calling
   * `getDeviceToken` at all. The difference between the two was everything Amazon had
   * written into local storage, so that is what this removes.
   *
   * Cookies are deliberately not in the list. They are the session, they are the one
   * thing here that a person would have to re-type, and clearing them would turn a
   * book that will not open into a sign-in page, which is worse.
   *
   * Sent on a page's session, which is not optional and is not obvious: on this
   * browser's own connection every one of these types, asked for one at a time, comes
   * back "Internal error ()", and so does `clearDataForStorageKey`. Given any page to
   * hang off, including `about:blank`, the same call succeeds. The caller therefore
   * opens the fresh tab first and clears from there, which also solves the other half
   * of it: the page behind a failed book is often the one that has stopped answering.
   */
  async clearSiteData(origin = 'https://read.amazon.com') {
    if (!this.cdp || this.cdp.closed || !this.sessionId) return false;
    await this.cdp.send(
      'Storage.clearDataForOrigin',
      { origin, storageTypes: 'local_storage,indexeddb,cache_storage,service_workers' },
      this.sessionId,
      { timeoutMs: 10000 }
    );
    return true;
  }

  /**
   * The way out of a book Amazon will not render, which is the one thing its own
   * error page does not offer.
   *
   * Clearing is not enough on its own: the document that failed is still the document
   * on screen, holding whatever it read before it gave up. `revive` closes the tab it
   * is in and opens the book again in a new one, which is the same route out that a
   * wedged renderer takes, and it does the clearing in the gap between the two, when
   * there is a fresh page to clear from and nothing has loaded into it yet.
   */
  async retryBook() {
    // Every exit names a remedy, because this method IS the remedy the panel offers: a refusal
    // here that says only what went wrong leaves a person pressing the one button on screen and
    // being told no. Observed live, this returned "the reader is not open" and nothing else, at
    // the exact moment the reader had wedged and been closed underneath it.
    if (!this.running) {
      return {
        ok: false,
        stage: 'open',
        expected: 'a running reader to clear and reopen',
        actual: 'the reader is not open',
        reason: 'The reader is not open, so there is nothing to reload yet. '
          + 'Remedy: press Book to open it, and if it does not come up, sign in to Amazon below.',
      };
    }
    const reopened = await this.revive({ clearFirst: true });
    // `revive` answers "the steps ran without throwing", not "the book came back": it awaits
    // `settle` and discards what settle found. Observed live, this reported
    // {ok: true, cleared: true, reopened: true} while the reader sat on a spinner at the same
    // page it was stuck on before, which is E4 exactly, a retry that reports success and
    // recovers nothing. So the page is asked, once, and the answer is what `ok` means.
    // The thrown message is KEPT. `#probe().catch(() => null)` used to discard it, and then
    // the refusal below said "the reopened tab has not painted anything" in both cases: when
    // the page answered and reported nothing, and when the page never answered at all. The
    // second is a statement about a page that was not asked. They also have different next
    // moves, and the panel has a remedy branch for a page that stopped answering that the
    // flattened message could never reach.
    let after = null;
    let probeErr = null;
    if (reopened) {
      try {
        after = await this.#probe();
      } catch (err) {
        probeErr = err;
      }
    }
    const arrived = arrivedAtSomething(after);
    this.logger?.info?.('reader: retried the book', { cleared: this.cleared, reopened, arrived });
    if (reopened && !arrived) {
      return {
        ok: false,
        stage: 'settle',
        expected: 'a page of the book, or Amazon\'s own failure page, after the reopen',
        actual: probeErr
          ? `the reopened tab stopped answering (${probeErr.message})`
          : after?.spinner
            ? 'the reader is still showing its loading spinner'
            : 'the reopened tab has not painted anything',
        cleared: this.cleared,
        reopened,
        reason: 'The book was reloaded and has not come back. '
          + 'Remedy: press Read it again once more, and if it stays like this, sign in to Amazon '
          + 'below, which replaces the session this reader is using.',
      };
    }
    if (!reopened) {
      return {
        ok: false,
        stage: 'reopen',
        expected: 'the book to come back after its site data was cleared',
        actual: 'the reopen did not reach a page',
        cleared: this.cleared,
        reopened,
        reason: 'Amazon did not reopen the book after its stored data here was cleared. '
          + 'Remedy: sign in to Amazon below, which replaces the session this reader holds, '
          + 'then press Read it again.',
      };
    }
    return { ok: true, cleared: this.cleared, reopened, arrived };
  }

  /**
   * Give the page a viewport, and leave the window alone.
   *
   * The window is deliberately not resized to match. Chrome clamps a window's width
   * at around 500 points and its height by more than it admits, so sizing the
   * window lands on a rectangle nobody asked for, and the reader puts anything that
   * is not clearly taller than it is wide into two columns thirty characters across,
   * which breaks a chapter heading one word to a line. Overriding the metrics of a
   * page inside a larger window gives exactly the rectangle requested.
   *
   * What the page ended up with is read back rather than assumed, because that is
   * the number a click in the panel is scaled against.
   */
  async #applyViewport() {
    const { width, height } = this.viewport;
    await this.cdp.send(
      'Emulation.setDeviceMetricsOverride',
      // Two device pixels per point, because the panel is on a Retina display and a
      // book captured at 1x inside it reads as a photograph of a book.
      { width, height, deviceScaleFactor: 2, mobile: false },
      this.sessionId
    );
    await new Promise((r) => setTimeout(r, 400));
    try {
      const real = JSON.parse(await this.#evaluate('JSON.stringify([innerWidth, innerHeight])'));
      if (real?.[0] > 0) this.viewport = { width: real[0], height: real[1] };
    } catch {
      /* still loading; the next poll asks again */
    }
  }

  /**
   * Have the reader open, at this book, at this size.
   *
   * Everything about this is idempotent on purpose: the panel calls it on every
   * poll while the book is on screen, and it must cost nothing when the reader is
   * already up and showing the right thing.
   */
  async ensure({ asin, width, height } = {}) {
    this.lastUsedAt = Date.now();
    // A sign-in window is holding the profile. Reopening the reader now would fight
    // it for the same user-data-dir and lose the sign-in being typed into it.
    if (this.signingIn) return { ok: false, signingIn: true };
    if (this.starting) return this.starting;

    const wanted = width && height ? fitViewport({ width, height }) : null;
    // Compared against the last box that was *asked for*, not against the viewport
    // the page ended up with. Those are not the same number: `#applyViewport` reads
    // the real one back off the page, Chrome clamps, and the difference then reads
    // as a fresh resize on the very next poll. Every poll repaginated the book and
    // threw the shelf away, which at a poll every 1.5 seconds is a reader that never
    // finishes laying out a page.
    const resized =
      wanted
      && (!this.requested
        || Math.abs(wanted.width - this.requested.width) > 8
        || Math.abs(wanted.height - this.requested.height) > 8);
    if (wanted) {
      this.requested = wanted;
      this.viewport = wanted;
    }

    const needsBook = asin && asin !== this.asin;
    if (this.running && !needsBook && !resized) return { ok: true, already: true };

    this.starting = (async () => {
      // What `settle` found, and whether there was a book to open at all. Two variables rather
      // than one null: a call with no book to open has established nothing and a settle that saw
      // nothing has established nothing, and collapsing those two onto `null` reads the second
      // as the first, which is the ok: true this is here to stop.
      let openedBook = false;
      let opened = null;
      try {
        if (!this.running) await this.#start();
        else if (resized) {
          await this.#applyViewport();
          // The reader repaginates on a resize and shows a spinner while it does.
          // Waiting here means the next frame is the page, not the spinner.
          await this.settle({ timeoutMs: 12000 });
        }

        if (needsBook || !this.asin) {
          this.asin = asin ?? this.asin;
          await this.cdp.send('Page.navigate', { url: readerUrl(this.asin) }, this.sessionId);
          const settled = await this.settle();
          openedBook = true;
          opened = settled;
          // Belt and braces: the document-start hook covers every page the reader
          // navigates to itself, and this covers a document that was already open.
          // Belt failing is survivable, and is still worth a line for the same
          // reason as in `revive`: it is the first sign the braces went too.
          await this.#evaluate(CSS_INJECT).catch((err) => {
            this.logger?.info?.(`reader: could not restyle the open document (${err.message})`);
          });
          // Signed out on arrival is nearly always a session Amazon has rotated
          // since the last time this profile ran, and the answer is a fresh copy of
          // the one your own browser is holding.
          if (settled?.signedOut) {
            // Cleared before the nested call, which awaits this same promise
            // otherwise and waits for itself forever.
            this.starting = null;
            const carried = await this.recoverIfPossible();
            return { ok: true, asin: this.asin, recarried: carried?.carried ?? null };
          }
          // A new book is a new shelf. Seeded here rather than on the first poll, so
          // that reading ahead has already started by the time the first page is on
          // screen and the second turn is instant rather than the third.
          // A failed seed is not a failed open. The book is on screen either way,
          // and the next poll seeds again, so this costs the instant second turn
          // rather than the session. Logged because a seed that keeps failing is
          // the reason someone would ask why turning got slow.
          await this.#seed().catch((err) => {
            this.logger?.info?.(`reader: could not read ahead on the new book (${err.message})`);
          });
        } else if (resized) {
          // The reader repaginates on a resize, so every page held is a picture of a
          // layout that no longer exists. Kept would be worse than slow.
          this.pages.clear();
          this.pos = 0;
          this.frontier = 0;
          this.demand += 1;
          await this.#seed().catch((err) => {
            this.logger?.info?.(`reader: could not read ahead after the resize (${err.message})`);
          });
        }
        this.error = null;
        // `ok` is what SETTLE found, not "the steps below ran without throwing". This used to
        // consult `settled` for exactly one thing, `signedOut`, so a settle that spent its whole
        // budget and never saw a painted page, a label, or an error page still fell through to
        // ok: true. A liveness answer that says ok over a dead page is worse than an error,
        // because the caller stops looking.
        // The same predicate as everywhere else. A settle that came back signed out has already
        // returned above, so this never sees one, but computing a private copy of "arrived" is
        // exactly how the two that drifted came to disagree.
        const arrived = !openedBook || arrivedAtSomething(opened);
        return arrived
          ? { ok: true, asin: this.asin }
          : {
            ok: false,
            asin: this.asin,
            stage: 'settle',
            expected: 'a page of the book, or Amazon\'s own failure page',
            actual: opened?.spinner
              ? 'the reader is still showing its loading spinner'
              : 'the tab has not painted anything',
            reason: 'The book was opened and has not come up. '
              + 'Remedy: press Read it again, which clears the site data and reopens it.',
          };
      } catch (err) {
        this.error = err.message;
        // A half-started browser is worse than none: it answers `running` and then
        // fails every call. Take it down so the next attempt is a clean one.
        await this.close().catch(() => {});
        throw err;
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  /**
   * Wait for the reader to be showing something, rather than for a fixed time.
   *
   * "Something has painted" is not enough to stop on. read.amazon.com paints its
   * own shell and only then redirects to the sign-in page, so a settle that
   * returned on the first paint reported a book that was about to become a login
   * form, and the sign-in was never noticed. The page label is the honest signal
   * that a book is up; a paint without one is given a few more seconds to become
   * either that or a redirect.
   */
  async settle({ timeoutMs, graceMs = 6000 } = {}) {
    const budgetMs = timeoutMs ?? this.settings.loadTimeoutMs;
    const deadline = Date.now() + budgetMs;
    let last = null;
    let lastAt = 0;
    let paintedAt = 0;
    let answeredAt = Date.now();
    let mutedUntilAnswer = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
      try {
        last = JSON.parse(await this.#evaluate(PROBE));
        lastAt = Date.now();
        answeredAt = lastAt;
        mutedUntilAnswer = false;
      } catch (err) {
        // Continuing is right: the page is mid-navigation for most of a load and a probe
        // that misses is normal. Continuing SILENTLY is not. This loop swallowed every
        // probe failure without a word, which is why a reader whose main thread had stopped
        // answering looked identical to one that was merely still loading: the operator saw
        // a spinner, the log said nothing, and the only difference was in the exceptions
        // nobody wrote down. Counted rather than logged per miss, so a normal load stays
        // quiet and a page that has stopped answering says so once.
        //
        // Counted in TIME, not in consecutive exceptions. Five-in-a-row was unreachable where
        // it mattered and noisy where it did not. `#evaluate` waits 8000ms before it gives up,
        // so five misses need about 42 seconds, and two of this method's four callers hand it
        // 12000ms and 15000ms: they can afford two attempts, so the line could never print for
        // them. Worse, the only trace of this failure anyone has captured ALTERNATES (miss,
        // answer, miss, miss, answer) and a counter that resets on every answer never passes
        // two on it. Meanwhile fast "no execution context" rejections during an ordinary
        // navigation reach five in about two seconds and print for a page that is perfectly
        // healthy. Elapsed-since-an-answer, measured against a quarter of the caller's own
        // budget, says the same thing in units that scale with the budget it was given.
        const quietMs = Date.now() - answeredAt;
        if (!mutedUntilAnswer && quietMs > budgetMs / 4) {
          mutedUntilAnswer = true;
          this.logger?.info?.(
            `reader: the page has not answered a probe in ${Math.round(quietMs / 1000)}s (${err.message}). `
            + 'Remedy: it is usually recoverable with the panel retry, which clears the site data and reopens the book.'
          );
        }
        continue;
      }
      // Amazon's failure page is a settled page. Waiting the full load budget out on
      // one costs forty seconds and arrives at the same answer.
      if (last.signedOut || last.bookError || last.label) return last;
      if (!last.painted) {
        paintedAt = 0;
        continue;
      }
      if (!paintedAt) paintedAt = Date.now();
      else if (Date.now() - paintedAt > graceMs) return last;
    }
    // The deadline expired. `last` is only assigned on a SUCCESSFUL probe, so returning it here
    // hands the caller a reading that can be the whole budget old: a page that answered once
    // with a painted shell and then stopped answering entirely returned that first reading as
    // settle's answer, and `revive` read `.painted` off it and reported the book was back. That
    // moves the false claim rather than removing it, from "my steps ran" to "here is a reading
    // from forty seconds ago". A settle that timed out has not observed anything, and its
    // callers need to be told that rather than shown a memory. Anything within one poll of the
    // deadline was genuinely just measured; anything older was not.
    if (!lastAt || Date.now() - lastAt > SETTLE_POLL_MS * 3) return null;
    return last;
  }

  /**
   * Signed out, so put it right if it can be put right from here.
   *
   * Rate limited, because recovering means opening a browser which lands back at
   * this same question, and an unguarded retry is an infinite one.
   */
  async recoverIfPossible({ everyMs = 10 * 60 * 1000 } = {}) {
    if (Date.now() - this.lastRecoveryAt < everyMs) return null;
    this.lastRecoveryAt = Date.now();
    const carried = await this.reauthenticate();
    this.logger?.info(`reader: ${carried.reason}`, { cookies: carried.carried });
    return carried;
  }

  async state() {
    if (!this.running) {
      return { ready: false, running: false, error: this.error, seq: this.seq };
    }
    let probe = {};
    try {
      probe = await this.#probe();
    } catch (err) {
      return { ready: false, running: true, error: err.message, seq: this.seq };
    }
    const page = this.pages.get(this.pos);
    return {
      ready: Boolean(probe.painted),
      running: true,
      seq: this.seq,
      frameAt: this.frame?.at ?? null,
      asin: this.asin,
      viewport: this.viewport,
      error: this.error,
      ...probe,
      // The label of the page *you* are looking at, which is not the browser's own
      // while the browser has run ahead to fill the shelf. Reporting the browser's
      // would show you a page number two ahead of the words on your screen.
      //
      // Gated on the page having ARRIVED, not on the browser having produced a string. Two
      // measurements bound this. During a cold start the probe's label was empty for forty
      // seconds while this line kept answering the shelf's `Page 217 of 220`, so an ungated
      // fallback reports the page you were on before the reader went blank. Gating on the
      // browser having a label fixes that half and leaves the other: the measured wedge is a
      // spinner UNDER a truthful label
      // ("Page 219 of 220 ● 95%" at painted=false, docs/evidence/2026-08-19/E2-...), so the
      // gate passed and the panel printed the shelf's remembered page over a spinner. This is
      // the same predicate `capture` refuses on, and moving one without the other was the split.
      label: probe.painted ? (page?.label ?? probe.label) : '',
      // Shown in the panel rather than kept private. How far ahead the book has
      // already been read is the difference between "it is fast" and "I can see
      // why it is fast", and it is the thing to look at when it is not.
      shelf: this.shelf(),
    };
  }

  /** Ask the reader where it is, and remember where on the page the book is drawn. */
  async #probe() {
    const probe = JSON.parse(await this.#evaluate(PROBE));
    if (probe?.clip) this.clip = probe.clip;
    if (probe?.dpr > 0) this.dpr = probe.dpr;
    return probe;
  }

  /**
   * Amazon's sync question, answered before it reaches a picture.
   *
   * See `dismissScript`. Returns what it answered, which is worth logging: a dialog
   * that keeps coming back is a reader fighting another device for the position, and
   * that is a thing to be able to see rather than guess at.
   */
  async dismissOverlays(answer = 'No') {
    try {
      // Short leash. This runs inside the wait for a page turn, on a renderer that
      // is permanently busy, and a check that can block for eight seconds is a check
      // that turns "answer the dialog quickly" into the delay it was meant to fix.
      const clicked = JSON.parse((await this.#evaluate(dismissScript(answer), { timeoutMs: 2500 })) || '[]');
      if (!clicked.length) return [];
      // The page behind that dialog is blurred while it is up and sharpens only
      // once it has gone. A picture taken in the gap is a picture of a blur.
      await new Promise((r) => setTimeout(r, 450));
      // Then the document is READ AGAIN, and only the prompts that are actually gone come back.
      // The list used to be the prompts that were CLICKED, and both callers treated it as the
      // prompts that were gone: one of them takes a non-empty list as its signal to settle for
      // another fifteen seconds. A click on an element whose label matched is not a dismissal.
      // These prompts live in three custom elements, the click can land on a button whose
      // handler never ran, and nothing here would have known.
      const still = new Set(JSON.parse((await this.#evaluate(promptScript(), { timeoutMs: 2500 })) || '[]'));
      const gone = clicked.filter((text) => !still.has(text));
      if (gone.length) {
        this.logger?.info?.(`reader: answered Amazon with "${answer}"`, { asked: gone[0] });
      } else {
        this.logger?.info?.(
          `reader: pressed "${answer}" on Amazon's prompt and it is still on screen`,
          { asked: clicked[0] }
        );
      }
      return gone;
    } catch {
      return [];
    }
  }

  /** The clip scale. Fixed at 1, because it multiplies with the override's `deviceScaleFactor`. */
  captureScale() {
    return 1;
  }

  /**
   * The page rectangle, kept inside the window it is being captured from.
   *
   * The reader sizes its own renderer to the height of the page it has laid out, and
   * in a squat panel that comes out taller than the viewport: 483 points of book
   * inside a 400 point window, measured. Asking Chrome for a clip that runs past the
   * bottom of the viewport does not crop and does not fail. It captures beyond the
   * viewport, and everything the reader pins to the window repeats down the picture
   * with it: the frame came back as the same page tiled four times, each tile with
   * its own Kindle Library button, its own scrubber and its own page label.
   *
   * Which is the cluttered picture this whole change set exists to delete, arriving
   * by a different route than the one it arrived by before.
   */
  clipNow() {
    if (!this.clip) return null;
    const { width: vw, height: vh } = this.viewport;
    const x = Math.max(0, Math.min(this.clip.x, vw - 1));
    const y = Math.max(0, Math.min(this.clip.y, vh - 1));
    const width = Math.max(1, Math.min(this.clip.width, vw - x));
    const height = Math.max(1, Math.min(this.clip.height, vh - y));
    return { x, y, width, height };
  }

  /**
   * One picture of the page, clipped to the page.
   *
   * The clip is the whole of the "remove the clutter" fix. Amazon's reader draws its
   * toolbar, its two chevrons, its scrubber and its own page label around a single
   * inner rectangle, and only that rectangle is the book. Capturing the window
   * captured all of it: a second set of page-turn arrows next to ours, a Kindle
   * Library button that does nothing useful in a panel, and a "Back to 79" pill that
   * the transcription read as "ck to 79" and set into the middle of a paragraph.
   *
   * The clip scale is 1, deliberately. `clip.scale` and the metrics override's
   * `deviceScaleFactor` multiply, so a clip at scale 2 on a page already at 2 comes back four
   * times oversized: measured, an unclipped shot of a 480x400 viewport came back 480x400, while
   * the same page clipped to 384x253 at scale 2 came back 768x506.
   */
  async #shoot({ scale = null, quality = null, timeoutMs = 12000 } = {}) {
    // Without a clip the shot is the whole viewport rather than the page, which is
    // a worse picture but still a picture, so the shot goes ahead. Logged because a
    // probe that never succeeds is exactly why the pages would look wrong.
    if (!this.clip) {
      await this.#probe().catch((err) => {
        this.logger?.info?.(`reader: could not find the page on screen (${err.message})`);
      });
    }
    const clip = this.clipNow();
    try {
      const shot = await this.cdp.send(
        'Page.captureScreenshot',
        {
          format: 'jpeg',
          quality: quality ?? this.settings.quality,
          // Belt as well as braces. The clip is already clamped to the viewport, and
          // this says out loud that a clip which somehow is not must be cropped
          // rather than tiled.
          captureBeyondViewport: false,
          ...(clip ? { clip: { ...clip, scale: scale ?? this.captureScale() } } : {}),
        },
        this.sessionId,
        { timeoutMs }
      );
      return Buffer.from(shot.data, 'base64');
    } catch {
      return null;
    }
  }

  /** The probe, with a budget that suits a renderer under load. */
  async #probeSoon() {
    const probe = JSON.parse(await this.#evaluate(PROBE, { timeoutMs: 3000 }));
    if (probe?.clip) this.clip = probe.clip;
    if (probe?.dpr > 0) this.dpr = probe.dpr;
    return probe;
  }

  /**
   * A picture taken only to be compared against the next one.
   *
   * Deliberately the *same* capture as a real frame, at the same scale. Taking these
   * at a quarter scale was the obvious economy and it wedged the browser: alternating
   * the rasterisation scale of a clip makes the compositor re-raster the page every
   * time it changes, and three or four page turns of that took the renderer from its
   * usual 96% of a core to pegged at 102% with 600MB resident, answering neither
   * screenshots nor navigations. One scale, always. A capture measured 65ms here while
   * the renderer was at 96% of a core, which is one reading and not a benchmark.
   */
  #watch() {
    return this.#shoot({ timeoutMs: 6000 });
  }

  /**
   * Put a picture on screen, moving the sequence number only when the bytes moved.
   *
   * The panel refetches on a new sequence number, so this is what decides whether an
   * unchanged page costs a download. It must stay that way: the panel polls.
   */
  #hold(jpeg) {
    if (this.frame && this.frame.jpeg.equals(jpeg)) {
      this.frame.at = Date.now();
      return false;
    }
    this.seq += 1;
    this.frame = { seq: this.seq, jpeg, at: Date.now() };
    return true;
  }

  /**
   * A picture of the page, taken when asked rather than streamed.
   *
   * `Page.startScreencast` was the obvious mechanism and the wrong one. It is
   * documented as pushing a frame when the page changes; measured against the
   * Kindle reader it pushed 41 frames a second into an idle book and held Chrome at
   * 94% of a core, because something on that page never stops repainting. A book
   * you are not turning must cost nothing.
   *
   * So frames are pulled, at the rate the panel polls, and the sequence number only
   * moves when the bytes do. An unchanged page is therefore one poll, one comparison
   * and no download: the panel keeps showing the image it already has.
   */
  async capture({ force = false, minIntervalMs = 350, probe = null } = {}) {
    this.lastUsedAt = Date.now();
    if (!this.running) return null;
    // A page with no position label is not the book. Amazon's reader shows a bare shell
    // for as long as it takes to load, and measured over a cold start that is tens of
    // seconds during which this method would happily photograph it, hold it as the
    // current frame, and hand it to the panel to set in the reading type. The caller
    // already probed to build its state, so the answer is passed in rather than asked
    // for again: a second round trip per poll is what wedges this browser.
    //
    // `bookError` is allowed through deliberately. That page has no position label
    // either, and refusing to photograph it would undo loop 8's repair, which exists so
    // the panel can show the failure rather than pretend it is a page.
    //
    // Gated on `painted`, not on the label. Keying on the label alone was wrong and a live
    // read found it: Amazon draws its own toolbar and page number BEFORE the page arrives,
    // so a spinner and a truthful "Page 219 of 220" are on screen together, the label test
    // passes, and the spinner gets photographed anyway. `painted` already answers this
    // exactly, because it requires the spinner's absence, so the question capture asks is
    // now the same question the probe answers rather than a weaker proxy for it.
    // The caller may hand in the probe it already took, and when it does not, this takes one
    // rather than skipping the check. The first version made the whole refusal conditional on a
    // probe having been supplied, which made it OPT IN, and of the eight call sites exactly one
    // opted in. `frame()`, the route that serves the picture the panel renders, was not among
    // them. A guard that only protects the caller that remembers to ask for protection is not a
    // guard.
    //
    // The discarded condition is described rather than quoted: a check that it is gone is a grep,
    // and this comment is inside that grep's reach. Fifth time in one session, and this one was
    // written after adding a prevention entry about it.
    //
    // A probe that THROWS refuses too. If the page cannot be asked whether it has arrived, the
    // honest answer is not to photograph it, which is the same rule the rest of this file now
    // follows.
    // The browser is parked ahead of you, filling the shelf. The page you are
    // looking at is already in hand, and a picture taken now would be a picture of
    // a page you have not turned to yet.
    if (this.frontier !== this.pos) return this.frame;
    if (!force && this.frame && Date.now() - this.frame.at < minIntervalMs) return this.frame;
    // Last, immediately before the shot, so the cheap refusals above cost nothing. Placing it
    // first made this ask the browser a question even when it was about to decline for an
    // unrelated reason, which a shelf test caught by asserting the browser is not addressed at
    // all when it has run ahead.
    const seen = probe ?? await this.#probe().catch(() => null);
    if (!seen || (!seen.painted && !seen.bookError)) return this.frame;
    // A question standing over the book is not the book. This page IS painted, so the rule above
    // lets it through, and the photograph then has Amazon's dialog in the middle of it and the
    // panel sets it in the reading type as the page. The dismissal runs before this on the paths
    // that expect one, so a prompt still here is one that was not answered: either the answer
    // did not land, or it is a question this program has no answer for. Item 1.3.
    if (seen.prompt && !seen.bookError) return this.frame;
    const jpeg = await this.#shoot();
    // The last frame is better than no frame.
    if (jpeg) this.#hold(jpeg);
    return this.frame;
  }

  /**
   * The page as words, not as a picture.
   *
   * Off the shelf when the page was read ahead of time, which after a forward turn
   * it usually was. Otherwise read now and kept, keyed to the frame it came from:
   * the panel polls, so the same page must not be read twice, and a page that has
   * turned must never serve the text of the one before it.
   */
  async text({ fresh = false } = {}) {
    const page = this.pages.get(this.pos);
    // Asked for again, by hand, because the reading of this page was poor enough
    // that the picture came forward instead. Worth doing rather than replaying: the
    // usual cause is a picture taken while one of Amazon's dialogs was still up, and
    // a second look at a page that has since settled is a different page.
    if (fresh) {
      if (page) page.text = null;
      this.ocr = null;
      await this.dismissOverlays('No');
      const jpeg = await this.#shoot();
      if (jpeg) {
        this.#hold(jpeg);
        if (page) page.jpeg = jpeg;
      }
    }
    if (page?.text) {
      this.ocr = { seq: this.seq, result: page.text };
      return { ok: true, cached: true, ...page.text };
    }
    const frame = await this.capture();
    if (!frame) return { ok: false, reason: 'nothing on screen yet' };
    if (this.ocr?.seq === frame.seq) return { ok: true, cached: true, ...this.ocr.result };
    const result = await pageText(frame.jpeg);
    this.ocr = { seq: frame.seq, result };
    if (page) page.text = result;
    return { ok: true, cached: false, ...result };
  }

  /* ---------------------------------------------------------------- the shelf --- */

  /**
   * Everything the browser does to the book, one at a time and in order.
   *
   * Two arrow presses racing each other lose count of where the browser is, and a
   * shelf indexed by a position that is wrong serves you the wrong page with total
   * confidence, which is worse than having no shelf at all.
   */
  #enqueue(fn) {
    const next = this.chain.then(fn, fn);
    // One failed step must not poison the queue for every step after it.
    this.chain = next.then(() => {}, () => {});
    return next;
  }

  /** Show a page that is already held. */
  #show(page) {
    this.#hold(page.jpeg);
    if (page.text) this.ocr = { seq: this.seq, result: page.text };
    return this.frame;
  }

  /**
   * Move the browser one page, and put what it lands on onto the shelf.
   *
   * The turn is watched for rather than waited out: the reader repaints
   * asynchronously, so a picture taken straight after the keypress is of the page
   * you just left, and the bytes changing is the only honest signal that it went.
   */
  async #step(direction, { timeoutMs = 6000 } = {}) {
    const key = direction === 'prev' ? 'ArrowLeft' : 'ArrowRight';
    const before = await this.#watch();
    if (!before) {
      this.stuck = (this.stuck ?? 0) + 1;
      return false;
    }
    await this.key(key);

    const deadline = Date.now() + timeoutMs;
    let turned = false;
    let askedAt = Date.now();
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 90));
      const now = await this.#watch();
      if (now && !now.equals(before)) {
        turned = true;
        break;
      }
      // Amazon's "Most Recent Page Read" comes up *on a turn*, over a blurred page,
      // and while it is up the arrow key does nothing: the turn never happens and
      // the reader sits behind a dialog until someone answers it. So it is answered
      // from inside the wait, which is also the only place it can be answered before
      // a picture is taken of it.
      //
      // And then the key is pressed again. The dialog ate the first one: dismissing
      // it leaves you on the page you were already on, and a step that returned
      // "did not turn" there was the read-ahead giving up for the whole session.
      if (Date.now() - askedAt > 700) {
        askedAt = Date.now();
        if ((await this.dismissOverlays('No')).length) await this.key(key);
      }
    }
    if (!turned) {
      this.stuck = (this.stuck ?? 0) + 1;
      return false;
    }
    this.stuck = 0;

    // One picture, once, of a page that has already arrived. This used to be up to
    // eight of them taken speculatively while waiting.
    const jpeg = await this.#shoot();
    if (!jpeg) return false;
    this.frontier += direction === 'prev' ? -1 : 1;
    // The label is a nicety; the page is already in hand. Asked with a short budget
    // so a busy renderer costs a missing page number rather than a missing page.
    const probe = await this.#probeSoon().catch(() => null);
    // Refused only on an AFFIRMATIVE no. A short-budget probe legitimately comes back null on a
    // busy renderer, and this method is designed around that, so treating unknown as bad would
    // break read-ahead exactly when the machine is loaded. But a probe that came back and said
    // the page has NOT arrived is different: storing that puts a spinner on the shelf, and the
    // shelf is served straight to the panel when you turn to it, which is `capture`'s refusal
    // defeated one move later.
    if (probe && !probe.painted && !probe.bookError) {
      this.frontier -= direction === 'prev' ? -1 : 1;
      return false;
    }
    this.pages.set(this.frontier, { label: probe?.label ?? null, jpeg, text: null, at: Date.now() });
    return true;
  }

  /**
   * The page the book opened on, put onto an empty shelf.
   *
   * `Yes` here and `No` everywhere else, and the difference is the point. On the way
   * into a book the position your Kindle synced is exactly the position you want, so
   * the question is taken. Once you are reading, the position the panel is showing is
   * yours, and jumping backwards to where another device left off is the last thing
   * to do to someone mid-page.
   */
  async #seed() {
    this.pos = 0;
    this.frontier = 0;
    this.pages.clear();
    this.demand += 1;
    this.readAheadFailedAt = 0;
    // Answering "Yes" is a jump: the reader goes off to the synced location and
    // re-renders, and for a second or so after that an arrow key does nothing at
    // all. Seeding into that window put a picture of a page mid-flight onto the
    // shelf and then failed its first read-ahead step, which used to be permanent.
    if ((await this.dismissOverlays('Yes')).length) await this.settle({ timeoutMs: 15000 });
    // Asked BEFORE the picture is taken, not after it is shown. This shot, and the `#show` below
    // it, went around `capture` entirely, so the refusal that stops a spinner reaching the panel
    // did not apply on the one path that runs after a revive. `#show` calls `#hold`, which
    // advances `seq` whenever the bytes differ, and a spinner is animated, so its bytes ALWAYS
    // differ: the panel refetched and drew the spinner as the current page every time.
    //
    // Same rule as `capture`: a page that has not arrived is not photographed, and Amazon's own
    // failure page is let through by name because the panel has a surface for it.
    const probe = await this.#probe().catch(() => null);
    if (!probe || (!probe.painted && !probe.bookError)) return null;
    const jpeg = await this.#shoot();
    if (!jpeg) return null;
    const page = { label: probe.label ?? null, jpeg, text: null, at: Date.now() };
    this.pages.set(0, page);
    this.#show(page);
    this.#prefetch();
    return page;
  }

  /**
   * Keep reading ahead, from the poll, without hammering a reader that will not turn.
   *
   * A step can fail for reasons that pass: the book is still laying itself out, or
   * Amazon has just jumped the position and the arrow keys are inert for a second.
   * The first version treated one failure as final, because nothing ever called the
   * prefetcher again until the next page turn, and the whole feature quietly did
   * nothing for the rest of the session on a reader that had merely been slow to
   * open. So the poll retries it, and a cooldown stops that becoming an arrow key
   * pressed into the void every second and a half.
   */
  readAhead() {
    if (Date.now() - (this.readAheadFailedAt ?? 0) < 5000) return null;
    if (this.frontier >= this.pos + this.settings.readAhead) return null;
    return this.#prefetch();
  }

  /**
   * Run the browser a little ahead of you, quietly, and read what it finds.
   *
   * This is the whole of the "it should feel seamless" fix. Turning used to mean
   * press an arrow, wait for Amazon to repaint, take a picture, read the picture:
   * between one and two seconds of nothing, on every press, in both directions, even
   * for a page that had already been read once on the way past. Now the picture and
   * the words for the next pages are already in hand when you ask for them, and the
   * browser does its waiting while you are still reading the page you are on.
   *
   * It gives up its slot the moment you turn a page: `demand` moves, the loop sees a
   * number that is not its own, and stops rather than making you queue behind the speculative turns already in flight.
   */
  #prefetch() {
    if (this.prefetching) return this.prefetching;
    const mine = this.demand;
    this.prefetching = (async () => {
      try {
        while (
          this.running
          && this.demand === mine
          && this.frontier < this.pos + this.settings.readAhead
        ) {
          if (!(await this.#enqueue(() => this.#step('next')))) {
            this.readAheadFailedAt = Date.now();
            // Reading ahead is speculative, so it does not get to reopen your book
            // on its own: a page load you did not ask for, while you are reading, is
            // exactly the interruption this project exists to remove. It records
            // that the reader is stuck and leaves the decision to your next press.
            break;
          }
          // Read now rather than when you arrive. This is the second half of the
          // wait: the picture is instant off the shelf, and the words would still
          // have cost six tenths of a second at the moment you looked at them.
          const page = this.pages.get(this.frontier);
          if (page && !page.text && this.demand === mine) {
            page.text = await pageText(page.jpeg).catch(() => null);
          }
        }
      } catch (err) {
        this.logger?.info?.(`reader: reading ahead stopped (${err.message})`);
      } finally {
        this.prefetching = null;
        this.#trim();
      }
    })();
    return this.prefetching;
  }

  /**
   * Keep what is near you and let go of the rest.
   *
   * A page is a hundred kilobytes of JPEG plus its transcription, and a reading
   * session is hundreds of pages. Holding all of them would be a leak with a
   * plausible excuse.
   */
  #trim() {
    const { readAhead, keepBehind } = this.settings;
    // The window ahead is the wider of the two numbers, not `readAhead`. Paging
    // backwards leaves the browser parked well in front of you, and trimming to
    // `pos + readAhead` threw away pages that had already been read and were still
    // in front: going back four and then forward again made the browser walk
    // backwards three pages to reach a page it had itself read a minute earlier.
    const ahead = Math.max(readAhead, keepBehind);
    for (const key of [...this.pages.keys()]) {
      if (key < this.pos - keepBehind || key > this.pos + ahead) this.pages.delete(key);
    }
  }

  /** Where the reader is, what it has ahead of you, and what it is holding. */
  shelf() {
    return {
      pos: this.pos,
      frontier: this.frontier,
      ahead: Math.max(0, this.frontier - this.pos),
      held: this.pages.size,
      readAhead: this.settings.readAhead,
    };
  }

  async click(x, y) {
    this.lastUsedAt = Date.now();
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.cdp.send(
        'Input.dispatchMouseEvent',
        { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 },
        this.sessionId
      );
    }
    return { ok: true, x, y };
  }

  async key(key, { text = null } = {}) {
    this.lastUsedAt = Date.now();
    const codes = {
      ArrowRight: 39, ArrowLeft: 37, ArrowUp: 38, ArrowDown: 40,
      Enter: 13, Backspace: 8, Tab: 9, Escape: 27,
    };
    const vk = codes[key] ?? (text ? text.charCodeAt(0) : 0);
    for (const type of ['keyDown', 'keyUp']) {
      await this.cdp.send(
        'Input.dispatchKeyEvent',
        {
          type: type === 'keyDown' && text ? 'keyDown' : type,
          key,
          code: key,
          text: type === 'keyDown' ? text ?? undefined : undefined,
          windowsVirtualKeyCode: vk,
          nativeVirtualKeyCode: vk,
        },
        this.sessionId
      );
    }
    return { ok: true, key };
  }

  async type(text) {
    this.lastUsedAt = Date.now();
    await this.cdp.send('Input.insertText', { text }, this.sessionId);
    return { ok: true, typed: text.length };
  }

  /**
   * Turn the page.
   *
   * Off the shelf whenever the page is there, which after a forward turn it usually
   * is and after a backward one it almost always is. That path touches the browser
   * not at all: no keypress, no waiting for Amazon to repaint, no transcription. It
   * is the difference between a page turn you notice and one you do not.
   *
   * When the page is not held, the browser is walked to it. Arrow keys rather than
   * the chevrons: the chevrons move with the layout and with the size of the panel,
   * and a page turn that depends on hitting a moving target is one that fails
   * silently the first time someone resizes the window. (They are also hidden now,
   * because they were the second pair of arrows in the picture.)
   */
  async turn(direction = 'next') {
    this.lastUsedAt = Date.now();
    // Said before anything is awaited, so a prefetch already in flight sees it and
    // stands down rather than making this press wait behind speculative turns.
    this.demand += 1;
    const target = direction === 'prev' ? this.pos - 1 : this.pos + 1;
    if (target < 0) {
      return { ok: true, direction, turned: false, atStart: true, seq: this.seq, shelf: this.shelf() };
    }

    const held = this.pages.get(target);
    if (held) {
      this.pos = target;
      this.#show(held);
      // Trimmed here rather than left to the prefetcher's `finally`. Reading forward
      // through a book with a prefetch already in flight never reaches that block,
      // and the shelf grew a page every turn for as long as you kept reading.
      this.#trim();
      this.#prefetch();
      return {
        ok: true,
        direction,
        turned: true,
        // Reported rather than hidden: "this page came off the shelf" is the fact
        // that explains why the turn was instant, and the panel says so.
        cached: true,
        label: held.label,
        seq: this.seq,
        shelf: this.shelf(),
      };
    }

    await this.#enqueue(async () => {
      // Nearly always one press. More than one only when you have gone back behind
      // everything held, and the browser has to walk back to meet you.
      let guard = 0;
      while (this.frontier !== target && guard < 12) {
        guard += 1;
        if (await this.#step(this.frontier < target ? 'next' : 'prev')) continue;
        // Twice in a row is not a slow page, it is a renderer that has stopped
        // answering. Reopened rather than reported: "the book will not turn" is a
        // true sentence nobody can act on, and the way out of it is one this can
        // take by itself. See `revive`.
        if ((this.stuck ?? 0) >= 2 && (await this.revive())) {
          await this.#step(this.frontier < target ? 'next' : 'prev').catch(() => false);
        }
        break;
      }
      this.pos = this.frontier;
      const landed = this.pages.get(this.pos);
      if (landed) this.#show(landed);
      else await this.capture({ force: true });
      this.#trim();
    });

    this.#prefetch();
    return {
      ok: true,
      direction,
      turned: this.pos === target,
      cached: false,
      label: this.pages.get(this.pos)?.label ?? null,
      seq: this.seq,
      shelf: this.shelf(),
    };
  }

  /** Nothing to read means nothing to keep a browser open for. */
  idleFor() {
    return Date.now() - this.lastUsedAt;
  }

  async closeIfIdle() {
    // Someone is signing in. The clock does not run while a person is typing.
    if (this.signingIn) return false;
    if (!this.running) return false;
    if (this.idleFor() < this.settings.idleCloseMs) return false;
    await this.close();
    return true;
  }

  /**
   * Shut the browser, do not kill it.
   *
   * `Browser.close` lets Chrome write its cookie store before it goes. Killing it
   * instead leaves the profile holding a session token Amazon has already replaced,
   * and the next time you open your book you are asked to sign in with no
   * explanation. SIGKILL is here only for a browser that will not answer.
   */
  async close() {
    const child = this.browser?.child;
    try {
      if (this.cdp && !this.cdp.closed) {
        await this.cdp.send('Browser.close', {}, undefined, { timeoutMs: 6000 }).catch(() => {});
      }
    } finally {
      this.cdp?.close();
      this.cdp = null;
      this.sessionId = null;
      this.targetId = null;
      this.frame = null;
      this.browser = null;
      this.asin = null;
      // The shelf belongs to a browser that has gone. Held pages would be served
      // against a reader that is somewhere else entirely when it comes back.
      this.pages.clear();
      this.pos = 0;
      this.frontier = 0;
      this.clip = null;
      this.ocr = null;
      this.requested = null;
      this.demand += 1;
    }
    if (child && child.exitCode === null) {
      const gone = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 4000);
        timer.unref?.();
        child.once('exit', () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
      if (!gone) child.kill('SIGKILL');
    }
    return true;
  }
}
