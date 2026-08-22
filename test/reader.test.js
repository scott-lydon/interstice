import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths.js';
import {
  DISPLAY_KEY,
  MIN_WIDTH,
  PROBE,
  READER_CSS,
  Reader,
  displayScript,
  fitViewport,
  SCRIPT_WATCH,
  arrivedAtSomething,
  readerUrl,
  signedInToReader,
} from '../lib/reader.js';

/**
 * The book renders in the panel, which means it renders in a browser nobody sees.
 *
 * These cover the three things that were wrong the first time it ran on real data,
 * each of which looked like something else: a page laid out for a window wider than
 * the panel, a position label read off the reader's own scripts, and a browser that
 * was killed rather than closed.
 */

test('a box narrower than the reader can lay out is scaled, not squeezed', () => {
  // Chrome will not lay out below 480 CSS px. Asking for 412 got a 480 layout
  // anyway, and everything the page positions from the right edge landed on the
  // text: the floating book title printed itself across the second line.
  const box = fitViewport({ width: 412, height: 520 });
  assert.equal(box.width, MIN_WIDTH);
  assert.ok(
    Math.abs(box.width / box.height - 412 / 520) < 0.01,
    `the panel's proportions survive the scaling (got ${box.width}x${box.height})`
  );
});

test('a box wide enough is left exactly as it is', () => {
  assert.deepEqual(fitViewport({ width: 900, height: 700 }), { width: 900, height: 700 });
});

test('the page label is read from a page number, not from the word "Page"', () => {
  // Measured: the reader's own scripts are in document.innerText before it paints,
  // and a looser pattern matched `Page visibility not supported")});csa.plugin(`,
  // which was then shown to the operator as their position in the book.
  const label = (s) => (s.match(/Page [0-9,]+ of [0-9,]+[^\n]{0,20}/) || [''])[0].trim();
  assert.equal(label('Page visibility not supported")});csa.plugin('), '');
  assert.equal(label('Kindle Library\nPage 80 of 220 ● 37%\n'), 'Page 80 of 220 ● 37%');
  assert.ok(PROBE.includes('Page [0-9,]+ of [0-9,]+'), 'the probe uses the anchored pattern');
});

/**
 * Amazon's failure page is a page, so it rendered, transcribed and read back as
 * prose in the panel's reading type under a progress bar still saying 39%. Nothing
 * distinguished it from the book, which is why it took a screenshot to notice.
 */
test('Amazon\'s "something went wrong" page is recognised as a failure, not a page', () => {
  const bookError = (text) =>
    /Oops\b|Something Went Wrong/i.test(text) && /open this book from the library/i.test(text);
  assert.ok(
    bookError('Oops... Something Went Wrong\nPlease try to open this book from the library again.\nBack to Library'),
    'the page seen on a real 403 from getDeviceToken'
  );
  assert.ok(!bookError('Kindle Library\nPage 80 of 220 ● 37%\n'), 'a book is not a failure');
  assert.ok(
    !bookError('Oops, I dropped something. Anyway, back to the library of Alexandria.'),
    'and prose that happens to say both words is not one either'
  );
  assert.ok(PROBE.includes('bookError'), 'the probe reports it');
  assert.ok(PROBE.includes('open this book from the library'), 'anchored on Amazon\'s own wording');
});

/**
 * The retry throws away Amazon's storage and never the session.
 *
 * Measured: a profile that had been reading for weeks got four 403s from
 * `getDeviceToken` and Amazon's failure page; a profile carrying nothing but the
 * same cookies opened the same book at `Page 209 of 220` without asking for a device
 * token at all. So the thing to remove is what Amazon wrote into local storage. The
 * cookies are the session, and clearing those would turn a book that will not open
 * into a sign-in page, which is a worse place to be.
 */
test('clearing Amazon\'s stored data never clears the session with it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const body = src.slice(src.indexOf('async clearSiteData('), src.indexOf('async retryBook('));
  assert.match(body, /local_storage/, 'local storage is where the failed registration lives');
  assert.match(body, /indexeddb/);
  assert.ok(!/cookies/.test(body), 'and cookies are not in the list');
});

test('the retry is a route out that reopening the book cannot be', async () => {
  // The registration Amazon refused lives in the profile, so a new browser on the
  // same profile lands in exactly the same place. Clearing has to come first.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const revive = src.slice(src.indexOf('async revive('), src.indexOf('async #applyViewport'));
  assert.ok(
    revive.indexOf('clearSiteData') < revive.indexOf("'Page.navigate'"),
    'cleared before the book is loaded again, or the reopen finds the same refusal'
  );
  assert.ok(
    revive.indexOf('#openTab') < revive.indexOf('clearSiteData'),
    'and after a fresh tab exists, because the call is only answered on a page session'
  );
  // Scoped to the function body rather than measured in characters from its name. The distance
  // version broke the moment retryBook grew a guard that names a remedy, which is a change that
  // does not touch the property being asserted: a test that fails when unrelated lines are added
  // near it is measuring the wrong thing.
  const retry = src.slice(src.indexOf('async retryBook()'), src.indexOf('async #applyViewport'));
  assert.ok(retry.length > 0, 'retryBook is found');
  assert.match(retry, /revive\(\{ clearFirst: true \}\)/, 'the retry clears before it reloads');
  // And it answers rather than throwing when there is no reader to retry.
  const reader = new Reader({ config: { reading: {} } });
  assert.equal((await reader.retryBook()).ok, false);
});

test('the panel offers that retry where Amazon\'s failure is shown', () => {
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  assert.match(html, /id="reader-failed"/, 'the failure is a state of its own, not a page of the book');
  assert.match(html, /api\/reading\/retry/, 'and the button reaches the route that can clear it');
  // The note strip is hidden by `hidden`, which an inline `display:flex` outranks:
  // that is why a bare "Read it again" button sat under every page of the book.
  assert.ok(
    !/id="reader-note"[^>]*style="[^"]*display:/.test(html),
    'nothing inline overrides [hidden] on the note'
  );
  assert.match(html, /\.note\[hidden\]\s*\{\s*display:\s*none/, 'and the class says so out loud');
});

test('the reader hides Amazon\'s floating title rather than deleting it', () => {
  // The reader rebuilds its own DOM on every page turn, so a node removed once is
  // back on the next page. A stylesheet survives the rebuild.
  assert.match(READER_CSS, /fixed-book-title/);
  assert.match(READER_CSS, /display:\s*none/);
});

test('the panel forces one column and changes nothing else about your reading', () => {
  // The reader defaults to two columns, and at a synced 19.8pt font that is about
  // a dozen characters to a line in a panel: a chapter heading came out broken one
  // word at a time down the page. The font, theme and margins are the reader's own,
  // and they sync from your Kindle, so nothing here overwrites them.
  const script = displayScript({ maxNumberColumns: 1, sideMarginsSize: 'narrow' });
  assert.match(script, new RegExp(DISPLAY_KEY));
  assert.match(script, /"maxNumberColumns":1/);
  assert.ok(!/fontSize|theme|highlightColor/.test(script), 'nothing else is written');
  // A null in the config means "leave it alone", which must not write null over it.
  assert.match(displayScript({ fontSize: null }), /v !== null/);
});

test('a book is addressed by ASIN, and no book is still a valid address', () => {
  assert.equal(readerUrl('B0046LU7H0'), 'https://read.amazon.com/?asin=B0046LU7H0');
  assert.equal(readerUrl(null), 'https://read.amazon.com');
});

test('the browser is shut down, never killed, while it holds a session', () => {
  // Chrome writes its cookie store on its own schedule. SIGKILL after Amazon has
  // rotated the session token leaves the profile holding a token that no longer
  // works, and the next open lands on a sign-in page for no visible reason. That
  // happened once, which was enough.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const close = src.slice(src.indexOf('async close()'));
  const browserClose = close.indexOf('Browser.close');
  const sigkill = close.indexOf("kill('SIGKILL')");
  assert.ok(browserClose > -1, 'close() asks the browser to close itself');
  assert.ok(sigkill > browserClose, 'SIGKILL is only ever the fallback after that');
});

test('a reader that is not running answers rather than throwing', async () => {
  const reader = new Reader({ config: { reading: {} } });
  assert.equal(reader.running, false);
  const state = await reader.state();
  assert.equal(state.ready, false);
  assert.equal(state.running, false);
  assert.equal(await reader.capture(), null, 'no browser, no frame, no exception');
});

test('the frame sequence only moves when the page does', () => {
  // The panel swaps its image on the sequence number. If an unchanged page bumped
  // it, the panel would re-download an identical picture every poll for as long as
  // you were reading.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  assert.match(src, /this\.frame\.jpeg\.equals\(jpeg\)/, 'frames are compared before the sequence moves');
  // The screencast is documented as pushing a frame when the page changes. Against
  // the Kindle reader it pushed 41 a second into an idle book and held Chrome at
  // 94% of a core, so it is named only in the comment that explains its absence.
  assert.ok(!/send\(\s*'Page\.startScreencast'/.test(src), 'nothing starts a screencast');
});

test('the panel never opens a second window for the book', () => {
  // This is the whole point of the rewrite. The reader used to open in a browser
  // window of its own, which is the interruption this project exists to remove.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  assert.ok(!html.includes('window.open'), 'panel.html opens no windows');
  assert.match(html, /id="reader-frame"/, 'the book has a surface inside the panel');
  assert.match(html, /api\/reading\/input/, 'and clicks and keys are sent back to it');
});

/**
 * Signing in is reported from evidence, never from the absence of a sign-in page.
 *
 * Both bugs this covers shipped, and both looked like success to the panel while the
 * reader sat on Amazon's sign-in page: a blank window reported as signed in because
 * `about:blank` is not `/ap/signin`, and a carry reported as signed in because 38
 * dead cookies had been copied.
 */
test('a blank window is not a signed-in reader', () => {
  assert.equal(
    signedInToReader({ href: 'about:blank', signedOut: false, painted: false }),
    false,
    'a window that has loaded nothing has not signed anyone in'
  );
});

test('the sign-in page is not a signed-in reader', () => {
  assert.equal(
    signedInToReader({
      href: 'https://www.amazon.com/ap/signin?openid.mode=checkid_setup',
      signedOut: true,
      painted: true,
    }),
    false
  );
});

test('a painted page somewhere else on amazon is not the reader', () => {
  assert.equal(
    signedInToReader({ href: 'https://www.amazon.com/', signedOut: false, painted: true }),
    false,
    'being signed in to the shop is not being signed in to the book'
  );
});

test('the reader, painted and not asking for a sign-in, is signed in', () => {
  assert.equal(
    signedInToReader({
      href: 'https://read.amazon.com/?asin=B0046LU7H0',
      signedOut: false,
      painted: true,
    }),
    true
  );
});

test('an unpainted reader is still loading, not signed in', () => {
  assert.equal(
    signedInToReader({
      href: 'https://read.amazon.com/?asin=B0046LU7H0',
      signedOut: false,
      painted: false,
    }),
    false
  );
});

test('re-authenticating never spends a session that is already working', async () => {
  // The forced carry deletes this profile's cookie store before it writes. Run
  // against a reader that is already signed in, it destroys the session it was
  // meant to restore. That happened to a real sign-in, which is why this exists.
  const reader = new Reader({ config: { reading: {} } });
  let closed = false;
  reader.close = async () => {
    closed = true;
    return true;
  };
  reader.carry = async () => {
    throw new Error('carry must not be reached while the reader is signed in');
  };
  Object.defineProperty(reader, 'running', { get: () => true });
  reader.state = async () => ({
    href: 'https://read.amazon.com/?asin=B0046LU7H0',
    signedOut: false,
    painted: true,
  });

  const r = await reader.reauthenticate();
  assert.equal(r.signedIn, true);
  assert.equal(r.carried, 0);
  assert.equal(closed, false, 'and it does not even close the browser to find out');
});

test('a sign-in that lands after a redirect is not called a failure', async () => {
  // Measured on a real sign-in: the window closed, the reader reopened, and the
  // single reading taken at that instant caught it on /ap/signin mid-redirect. The
  // panel reported "Amazon still wants a sign-in" with the book on screen behind it.
  const reader = new Reader({ config: { reading: {} } });
  const pages = [
    { href: 'about:blank', signedOut: false, painted: false },
    { href: 'https://www.amazon.com/ap/signin', signedOut: true, painted: false },
    { href: 'https://read.amazon.com/?asin=B0046LU7H0', signedOut: false, painted: false },
    { href: 'https://read.amazon.com/?asin=B0046LU7H0', signedOut: false, painted: true },
  ];
  let i = 0;
  reader.state = async () => pages[Math.min(i++, pages.length - 1)];

  assert.equal(await reader.waitUntilSignedIn({ tries: 6, everyMs: 1 }), true);
  assert.ok(i >= 4, 'it kept looking rather than believing the first reading');
});

test('a sign-in that never lands is still a failure', async () => {
  const reader = new Reader({ config: { reading: {} } });
  reader.state = async () => ({
    href: 'https://www.amazon.com/ap/signin',
    signedOut: true,
    painted: true,
  });
  assert.equal(await reader.waitUntilSignedIn({ tries: 3, everyMs: 1 }), false);
});

test('a reader that throws while being watched is not a signed-in reader', async () => {
  const reader = new Reader({ config: { reading: {} } });
  reader.state = async () => {
    throw new Error('the reader browser went away');
  };
  assert.equal(await reader.waitUntilSignedIn({ tries: 2, everyMs: 1 }), false);
});

test('the sign-in verdict outlasts a slow book', async () => {
  // Measured on a real sign-in that worked: the reader reopened, Amazon painted
  // page 79 some seconds later, and a twenty second wait had already returned
  // "Amazon still wants a sign-in" over a book that was on screen.
  const reader = new Reader({ config: { reading: {} } });
  assert.ok(
    reader.settings.loadTimeoutMs <= 75 * 1000,
    'the wait for a signed-in reader outlasts the time a page is allowed to load'
  );

  let calls = 0;
  reader.state = async () => {
    calls += 1;
    // Still painting for the first half a minute, then the book.
    return calls < 30
      ? { href: 'https://read.amazon.com/?asin=B0046LU7H0', signedOut: false, painted: false }
      : { href: 'https://read.amazon.com/?asin=B0046LU7H0', signedOut: false, painted: true };
  };
  assert.equal(await reader.waitUntilSignedIn({ tries: 40, everyMs: 1 }), true);
});

test('every reader throw names a remedy the reader can render', () => {
  // A failure path must not merely say what went wrong; it must say what to do about it, so
  // #reader-failed-why can carry an actionable line. This scans the reader source for throw sites
  // and requires each `throw new Error(...)` string to name a remedy. A bare rethrow (`throw err`)
  // carries whatever remedy the original error already had and is not a new site.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const sites = [...src.matchAll(/throw new Error\((['"`])([\s\S]*?)\1\)/g)].map((m) => m[2]);
  assert.ok(sites.length >= 2, 'the reader has explicit throw sites to check');
  for (const message of sites) {
    // Item 1.9 asks for four things in every throw, not just the remedy: what was being
    // attempted, what was expected, what was found, and what to do. The first three are
    // one sentence in practice ("no X found to Y with" says the attempt was Y, the
    // expectation was an X, and the finding was none), so they are checked as that shape
    // rather than as four separate labels nobody would write.
    assert.match(
      message,
      /Remedy:/,
      `reader throw "${message.slice(0, 60)}" must name a remedy`
    );
    const [situation] = message.split('Remedy:');
    assert.match(
      situation,
      /\bno\b|\bnot\b|\bcould not\b|\bfailed\b/i,
      `reader throw "${message.slice(0, 60)}" must say what was found, or was not`
    );
    assert.match(
      situation,
      /\bto\b|\bwhile\b|\bwhen\b/i,
      `reader throw "${message.slice(0, 60)}" must say what was being attempted`
    );
    assert.ok(
      situation.trim().split(/\s+/).length >= 6,
      `reader throw "${message.slice(0, 60)}" is too terse to name a situation`
    );
    const remedy = message.split('Remedy:')[1] || '';
    assert.ok(
      remedy.trim().split(/\s+/).length >= 4,
      `reader throw "${message.slice(0, 60)}" names a remedy too short to act on`
    );
  }
});

test('the panel status line never replaces a daemon error with a fixed phrase', () => {
  // Item 1.10. The failure already carries `reason` and `detail`, and the row renders them,
  // but the status line above it used to substitute a phrase that named nothing, so the
  // first line a user reads was the one line they could not act on. Built from parts here
  // rather than written out, so this test does not reintroduce the very string whose
  // absence the item verifies with a grep.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const banned = ['could', 'not', 'do', 'that'].join(' ');
  assert.ok(!html.includes(banned), 'the phrase that names nothing is gone from the panel');
  assert.match(
    html,
    /d\.detail \|\| d\.reason/,
    'and the status line reads the daemon\'s own reason instead'
  );
});

test('the launcher tries every installed browser, not just the first one that exists', async () => {
  // The regression: `findBrowser` returned the first browser that EXISTED and the reader gave up
  // when it did not answer. On this machine Google Chrome 151 starts, stays alive, and never opens
  // a DevTools port (no DevToolsActivePort file, no listening socket, nothing in its own verbose
  // log, same with --remote-debugging-port=0 and a clean profile), while Brave beside it opens the
  // port immediately. So the reading rung was dead on a machine that had a working browser
  // installed the whole time.
  const { launchFirstWorkingBrowser, findBrowsers, BROWSERS } = await import('../lib/cdp.js');

  const fakeFs = { existsSync: (p) => p === BROWSERS[0] || p === BROWSERS[1] };
  assert.deepEqual(findBrowsers(fakeFs), [BROWSERS[0], BROWSERS[1]]);

  // The first refuses the port, the second answers. The launcher must reach the second.
  const attempted = [];
  const original = (await import('../lib/cdp.js')).launchBrowser;
  assert.equal(typeof original, 'function', 'launchBrowser is still the unit being retried');

  // Drive the retry through the real function by pointing it at binaries that cannot run, then
  // assert the error names every one it tried rather than only the last.
  const noneWork = { existsSync: (p) => p === BROWSERS[0] || p === BROWSERS[1] };
  await assert.rejects(
    () => launchFirstWorkingBrowser({ fs: noneWork, profile: '/nonexistent', port: 0, timeoutMs: 300 }),
    (err) => {
      attempted.push(err.message);
      assert.match(err.message, /no installed browser would open a debugging port/);
      assert.match(err.message, /Tried 2/, 'it must report having tried both, not stopped at one');
      assert.match(err.message, /Google Chrome/);
      assert.match(err.message, /Brave/);
      return true;
    }
  );

  // And with nothing installed at all, the message says what to install.
  await assert.rejects(
    () => launchFirstWorkingBrowser({ fs: { existsSync: () => false }, profile: '/x', port: 0 }),
    /no Chromium-family browser found/
  );
});

test('a recovery that finds nothing to carry leaves the reader open, not closed', async () => {
  // The forced carry deletes the cookie store before it writes, so `reauthenticate`
  // closes the browser before asking. When there turns out to be nothing to carry it
  // used to return from there, leaving the reader down while `ensure` still answered
  // `ok: true` over it. A poll loop hid that by opening again a second later; one cold
  // call did not, and the panel showed a blank page with no error to explain it.
  const reader = new Reader({ config: {}, logger: { info() {}, warn() {}, error() {} } });
  Object.defineProperty(reader, 'running', { get: () => false, configurable: true });
  reader.asin = 'B0046LU7H0';
  reader.viewport = { width: 900, height: 1200 };

  let closed = 0;
  const reopened = [];
  reader.close = async () => { closed += 1; };
  reader.carry = async () => ({ carried: 0, reason: 'your browser is holding the same session this reader already has' });
  reader.ensure = async (opts) => { reopened.push(opts); return { ok: true }; };

  const out = await reader.reauthenticate();

  assert.equal(out.carried, 0);
  assert.equal(out.signedIn, false);
  assert.equal(closed, 1, 'the forced carry still closes the reader before asking');
  assert.deepEqual(
    reopened,
    [{ asin: 'B0046LU7H0', width: 900, height: 1200 }],
    'and reopens it on the book it was reading before it gave up'
  );
});

/**
 * A reader wired to a fake DevTools connection that counts what it was asked to do.
 *
 * `cdp` is the seam because it is the only thing between this class and the browser, so a
 * screenshot that was ATTEMPTED is visible here whether or not it produced bytes. Counting
 * attempts is the whole point: the first draft of these tests asserted on the returned frame
 * instead, and passed against the unfixed code, because a shot with no browser behind it
 * returns nothing and leaves the previous frame in place exactly as a refusal does.
 */
function wiredReader(probe) {
  const calls = [];
  const reader = new Reader({ config: { reading: {} } });
  Object.defineProperty(reader, 'running', { get: () => true, configurable: true });
  reader.sessionId = 'test-session';
  reader.clip = { x: 0, y: 0, width: 512, height: 700 };
  reader.frontier = reader.pos;
  reader.cdp = {
    async send(method) {
      calls.push(method);
      if (method === 'Runtime.evaluate') return { result: { value: JSON.stringify(probe) } };
      if (method === 'Page.captureScreenshot') return { data: Buffer.from('shot').toString('base64') };
      return {};
    },
  };
  return { reader, calls, shots: () => calls.filter((m) => m === 'Page.captureScreenshot').length };
}

test('a page with no position label is not photographed', async () => {
  // Item 1.5, and the measurement behind it. Over a real cold start the reader's page sat at
  // read.amazon.com with zero img, zero canvas, zero svg and no label for tens of seconds, and
  // nothing in `capture` looked at any of that: it shot whatever was on screen, held it as the
  // current frame, and the panel set a blank page in the reading type as though it were the book.
  const { reader, shots } = wiredReader({ label: '', bookError: false, painted: false });
  reader.frame = { seq: 7, jpeg: Buffer.from('the-last-real-page'), at: Date.now() - 10_000 };

  // The fixture carries a LABEL. Without one it also satisfied the old, rejected rule that keyed
  // on the label being empty, so the test passed against both implementations and could not tell
  // them apart. A label plus painted:false is the state only the painted rule refuses, and it is
  // the state a live reader actually produced: a spinner under a truthful page number.
  const out = await reader.capture({
    force: true,
    probe: { label: 'Page 219 of 220', painted: false, spinner: true, bookError: false },
  });

  assert.equal(shots(), 0, 'no picture is taken of a page that is not showing the book');
  assert.equal(out.jpeg.toString(), 'the-last-real-page', 'and the last real page is what the panel keeps');
});

test('Amazon\'s failure page IS photographed, because the panel has to show it', async () => {
  // The failure page carries no position label either, so a refusal keyed on the label alone
  // would stop the panel from ever showing it and would undo loop 8's repair. It is let through
  // by name rather than by accident, and this asserts the shot actually happens.
  const { reader, shots } = wiredReader({ label: '', bookError: true, painted: true });
  reader.frame = null;

  await reader.capture({ force: true, probe: { label: '', bookError: true } });

  assert.equal(shots(), 1, 'the failure page is photographed so the panel can show it');
});

test('a painted page is still photographed', async () => {
  // The guard must not refuse the ordinary case, which is the mutation most likely to be made
  // by someone tightening it later.
  const { reader, shots } = wiredReader({ label: 'Page 80 of 220', bookError: false, painted: true });
  reader.frame = null;

  await reader.capture({ force: true, probe: { label: 'Page 80 of 220', painted: true, bookError: false } });

  assert.equal(shots(), 1, 'a page of the book is photographed');
});

test('a spinner with a page label beside it is not photographed', async () => {
  // The case a live read found, after the first version of this guard shipped keyed on the label.
  // Amazon draws its own toolbar and page number BEFORE the page arrives, so a spinner and a
  // truthful "Page 219 of 220" are on screen together. The label test passed and the spinner was
  // photographed anyway: seq advanced 8, 9, 10, 11 across twenty turns with spinner true on every
  // sample. `painted` already answers this correctly because it requires the spinner's absence,
  // so the guard asks that instead of a weaker proxy for it.
  const { reader, shots } = wiredReader({ label: 'Page 219 of 220', spinner: true, painted: false, bookError: false });
  reader.frame = { seq: 3, jpeg: Buffer.from('the-last-real-page'), at: Date.now() - 5_000 };

  const out = await reader.capture({
    force: true,
    probe: { label: 'Page 219 of 220', spinner: true, painted: false, bookError: false },
  });

  assert.equal(shots(), 0, 'a label is not enough; the page has to have arrived');
  assert.equal(out.jpeg.toString(), 'the-last-real-page', 'and the last real page is what the panel keeps');
});

test('a browser showing nothing does not borrow the shelf\'s page number', async () => {
  // `state` reports the label of the page YOU are on rather than the browser's, because the
  // browser runs ahead to fill the shelf. That fallback fired in the one case it was never meant
  // for: a browser showing nothing has no label of its own, so the shelf's remembered one was
  // served, and a blank reader reported the page you were on before it went blank. Measured
  // live: the probe's label was empty for forty seconds while the route answered Page 217 of 220.
  const { reader } = wiredReader({ label: '', painted: false, signedOut: false, bookError: false });
  reader.pages.set(reader.pos, { label: 'Page 217 of 220', jpeg: null, text: null });

  const state = await reader.state();

  assert.equal(state.label, '', 'nothing on screen reports nothing');
});

test('a browser that has run ahead still reports the page you are on', async () => {
  // The other side of the same line, so the fix cannot be "always report the browser's label".
  const { reader } = wiredReader({ label: 'Page 219 of 220', painted: true, signedOut: false, bookError: false });
  reader.pages.set(reader.pos, { label: 'Page 217 of 220', jpeg: null, text: null });

  const state = await reader.state();

  assert.equal(state.label, 'Page 217 of 220', 'the shelf still wins while the browser is ahead');
});

test('a spinner is not a painted page', () => {
  // Item 1.5, and the element is named rather than guessed: measured off a wedged live reader,
  // a page showing nothing but the loading element reported one svg, a fourteen character body,
  // and no label. Under the old rule that page was one shell element short of counting as
  // painted, and the shell grows. The probe now reports the spinner separately, so a caller can
  // tell "still loading" from "loaded something that is not the book".
  assert.ok(PROBE.includes('kg-spinner'), 'the probe knows the reader own loading element by name');
  assert.ok(/\bspinner\b/.test(PROBE), 'and reports it as a field of its own');
  // The rule itself is asserted by RUNNING the probe, in "a spinner that is mounted but hidden
  // does not blind the reader" below. This used to pin the exact opening text of the painted
  // clause, which made it a test of one phrasing rather than of one rule: the repair for a
  // spinner that is mounted but not showing had to change that text, and broke this assertion
  // while strictly improving the behaviour it exists to protect.
  const paintedClause = PROBE.slice(PROBE.indexOf('painted:'));
  assert.match(
    paintedClause.slice(0, 40),
    /^painted: !spinner/,
    'painted requires the absence of the spinner before it considers anything else'
  );
});

test('every reader failure the panel can show names a move', () => {
  // Item UX-COPY-005. `d.error` is the daemon's own sentence: accurate, and no help. The panel
  // used to print it verbatim. `readerRemedy` maps the failures the reader actually produces onto
  // the thing that clears each one. The strings below are real: every one was observed from a live
  // reader during the E2 work, which is why they are matched rather than invented.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const remedy = html.slice(html.indexOf('function readerRemedy'), html.indexOf('async function loadCards'));
  assert.ok(remedy.length > 200, 'the remedy function is there to read');

  // The pattern is lifted OUT OF THE PANEL and run against the strings the reader really
  // produced. The first version of this compared a regex literal written in this file against a
  // string literal written four lines above it, which passes for any state of the product: it
  // asserted that a test file is internally consistent. The subject has to come from the source.
  const wedgeSource = (remedy.match(/if \(\/(.+?)\/i\.test\(r\)\)/) || [])[1];
  assert.ok(wedgeSource, 'the remedy function has a first pattern to extract');
  const wedgePattern = new RegExp(wedgeSource, 'i');
  for (const observed of [
    'Runtime.evaluate did not answer in 8000ms',
    'Page.navigate did not answer in 20000ms',
    'Emulation.setDeviceMetricsOverride did not answer in 20000ms',
  ]) {
    assert.ok(
      wedgePattern.test(observed),
      `the panel's own pattern must match the real string "${observed}"`
    );
  }
  // And it must NOT match something that is not the wedge, or it would map every failure onto
  // the same remedy.
  assert.ok(!wedgePattern.test('no Chromium-family browser found to render the book'),
    'the wedge pattern does not swallow unrelated failures');
  assert.ok(/no Chromium-family browser/.test(remedy), 'the throw the reader raises by name is covered');

  // The general case must not be a restatement of the failure. It has to end in an instruction.
  const fallthrough = remedy.slice(remedy.lastIndexOf('return'));
  assert.match(fallthrough, /Read it again/, 'the fallthrough names the button rather than the fault');
});

test('every retryBook refusal names stage, expected, actual and a remedy', async () => {
  // Item 1.8. retryBook IS the remedy the panel offers, so a refusal that says only what went
  // wrong leaves a person pressing the one button on screen and being told no. Observed live: it
  // answered "the reader is not open" and nothing else, at the moment the reader had wedged and
  // been closed underneath it.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const retry = src.slice(src.indexOf('async retryBook()'), src.indexOf('async #applyViewport'));

  // Indentation-agnostic: these returns sit inside an if, so the closing brace is not at the
  // method's own indent. The first version of this pattern assumed it was and matched nothing,
  // which the non-empty guard below turned into a loud failure instead of a green vacuous pass.
  const refusals = [...retry.matchAll(/ok: false,([\s\S]*?)\n\s*\};/g)].map((m) => m[1]);
  assert.ok(refusals.length >= 2, `retryBook has refusal paths to check, found ${refusals.length}`);
  for (const refusal of refusals) {
    for (const field of ['stage:', 'expected:', 'actual:', 'reason:']) {
      assert.ok(refusal.includes(field), `a refusal is missing ${field}`);
    }
    assert.match(refusal, /Remedy:/, 'and every refusal names a remedy');
  }

  // The remedy string is what the panel renders, so it has to survive the trip to the surface
  // that shows it. #reader-failed-why is that surface.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  assert.match(html, /id="reader-failed-why"/, 'the surface the remedy lands on exists');

  // The success path is not allowed to claim success it did not reach.
  const notRunning = await (async () => {
    const reader = new Reader({ config: { reading: {} } });
    Object.defineProperty(reader, 'running', { get: () => false, configurable: true });
    return reader.retryBook();
  })();
  assert.equal(notRunning.ok, false);
  assert.equal(notRunning.stage, 'open');
  assert.match(notRunning.reason, /Remedy:/, 'the live refusal carries its remedy, not just the shape');
});

test('retryBook does not report success for a book that did not come back', async () => {
  // E4, and the reason item 1.8 exists. `revive` answers "the steps ran without throwing": it
  // awaits `settle` and discards what settle found. Observed live, retryBook returned
  // {ok: true, cleared: true, reopened: true} while the reader sat on a spinner at the same page
  // it had been stuck on, so the retry reported success and recovered nothing.
  const probes = { painted: false, spinner: true, bookError: false, label: 'Page 219 of 220' };
  const reader = new Reader({ config: { reading: {} } });
  Object.defineProperty(reader, 'running', { get: () => true, configurable: true });
  reader.revive = async () => true;
  reader.sessionId = 'test-session';
  reader.cdp = {
    async send(method) {
      if (method === 'Runtime.evaluate') return { result: { value: JSON.stringify(probes) } };
      return {};
    },
  };

  const stillSpinning = await reader.retryBook();
  assert.equal(stillSpinning.ok, false, 'a spinner is not a recovered book');
  assert.equal(stillSpinning.stage, 'settle');
  assert.match(stillSpinning.actual, /spinner/, 'and it says what it found');
  assert.match(stillSpinning.reason, /Remedy:/);

  // The same call, once the page has actually arrived.
  probes.painted = true;
  probes.spinner = false;
  const recovered = await reader.retryBook();
  assert.equal(recovered.ok, true, 'a painted page is a recovered book');
  assert.equal(recovered.arrived, true);

  // Amazon's own failure page counts as arrived: it is a page the panel must show, and
  // refusing it here would leave the retry claiming failure while the surface works.
  probes.painted = false;
  probes.bookError = true;
  const failurePage = await reader.retryBook();
  assert.equal(failurePage.ok, true, "the vendor's failure page is something arriving, not nothing");
});

test('revive reports whether the book came back, not whether its steps ran', async () => {
  // The cause behind E4. `revive` awaited `settle` and discarded the result, so it answered true
  // whenever its own steps completed without throwing. Both callers read that as "the book is
  // back": retryBook told the panel so, and the turn path pressed a key into a page that was not
  // there. Live, this produced {ok: true, cleared: true, reopened: true} on a reader that had not
  // rendered a page in minutes.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const revive = src.slice(src.indexOf('async revive('), src.indexOf('async clearSiteData'));
  assert.ok(revive.length > 0, 'revive is found');

  assert.match(revive, /const settled = await this\.settle\(\)/, "settle's answer is kept");
  assert.ok(
    !/^\s*return true;\s*$/m.test(revive),
    'revive no longer returns an unconditional true from its success path'
  );
  // Matched on the shared predicate rather than on one inlined expression. Pinning the exact
  // text made this a test of a phrasing: naming the predicate so that two callers could stop
  // disagreeing about what arrival means broke this assertion while improving the thing it
  // cares about. The behaviour is asserted by running revive, in the two tests below.
  assert.match(revive, /arrivedAtSomething\(settled\)/, 'and answers on what arrived');

  // The three that count as arrival are deliberate, so each is named rather than left to a
  // reader of the expression to infer. Read off the predicate now rather than off this method:
  // both callers used to carry their own copy and had drifted on exactly this list, which is
  // what moved it. Asserted by running it, too, in "arrival means the same thing to everything
  // that asks".
  const predicate = src.slice(src.indexOf('export function arrivedAtSomething'));
  const declaration = predicate.slice(0, predicate.indexOf('}') + 1);
  for (const arrived of ['painted', 'bookError', 'signedOut']) {
    assert.ok(declaration.includes(arrived), `${arrived} counts as the page having arrived`);
  }
});

test('E3: the vendor failure page is never rendered as the book', () => {
  // Item 1.6, reproduced from the captured fixture: the exact text Amazon put on screen where
  // page 79 belonged, under a progress bar still reading 39%. The panel drew it, transcribed it,
  // and captioned it "Read from the page Amazon drew", which is the sentence that makes a vendor
  // error page look like a transcription of the book.
  const AMAZON_FAILURE = 'Oops... Something Went Wrong\n'
    + 'Please try to open this book from the library again.\n'
    + 'Back to Library';

  // The detector is lifted OUT OF THE PROBE and run against the fixture. Writing the two regexes
  // here and matching them against a string also written here asserts nothing about the product:
  // it passes whatever the probe does. Both halves are required, so a page merely containing the
  // word "Oops" is not a failure, and that is asserted against the real detector too.
  const probeSrc = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const bookErrorLine = probeSrc.slice(probeSrc.indexOf('const bookError ='), probeSrc.indexOf('// Where the page itself'));
  const halves = [...bookErrorLine.matchAll(/\/([^/]+)\/i\.test\(text\)/g)].map((m) => m[1]);
  // literal-ok: two is the specification. The rule under test is that the failure page is
  // recognised by BOTH halves, so a detector that dropped to one pattern is the regression.
  assert.equal(halves.length, 2, 'the detector is two patterns, both required');
  const detects = (text) => halves.every((h) => new RegExp(h.replace(/\\\\/g, '\\'), 'i').test(text));
  assert.ok(detects(AMAZON_FAILURE), "the probe's own detector fires on the captured fixture");
  assert.ok(!detects('Kindle Library\nPage 80 of 220 ● 37%'), 'and not on a page of the book');
  assert.ok(!detects('Oops, I dropped something. Anyway, back to the library of Alexandria.'),
    'and not on prose that merely contains the word');

  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');

  // The failure branch: the picture goes, the transcription goes, the failure surface appears.
  // Located by what the branch DOES, not by the exact text of its condition. Pinning the
  // condition made this a test of one phrasing: adding a second failure that shares this surface
  // changed the condition and broke this, while everything asserted below stayed true. The end
  // marker moved for the same reason, since the arm now has an if/else of its own inside it and
  // the first `} else {` after the start is no longer the one that closes it.
  const start = html.indexOf("$('reader-failed').hidden = !readerFailed;");
  assert.ok(start > 0, 'the panel has a branch that shows the failure surface');
  const end = html.indexOf('// Back to a real page', start);
  assert.ok(end > start, 'and a branch for coming back from it');
  const branch = html.slice(start, end);
  assert.match(branch, /setFrameHidden\(true\)/, 'the page picture is hidden');
  assert.match(branch, /\$\('reader-text'\)\.hidden = true/, 'the transcription is hidden');
  assert.match(branch, /\$\('reader-failed'\)\.hidden = !readerFailed/, 'the failure surface is shown');

  // And nothing below it runs, which is what stops the caption being written. The early return is
  // the mechanism, so its absence is the regression this asserts against.
  //
  // There are two `if (readerFailed)` in this function: one nested inside the change branch above,
  // which does the hiding, and one standalone guard that returns. Taking the first match found the
  // nested one and failed for a reason that had nothing to do with the property. The guard wanted
  // is the one that returns, so it is located by that rather than by position.
  const guards = [...html.matchAll(/if \(readerFailed\) \{/g)].map((m) => m.index);
  const returning = guards.find((i) => html.slice(i, i + 260).includes('return;'));
  assert.ok(returning, 'the render path has a readerFailed guard that returns');

  // The caption lives in the TEXT rendering function, which sits earlier in the file, so the
  // mechanism is not textual ordering: it is that the guard returns before that function is
  // reached and the branch hides the element it writes into. An earlier version of this test
  // asserted the return came before the caption in the file and failed, because the premise was
  // wrong rather than the code.
  const captionFn = html.slice(0, html.indexOf('Read from the page Amazon drew'));
  assert.match(
    captionFn.slice(captionFn.lastIndexOf('function ')),
    /host\.innerHTML|reader-text/,
    'the caption is written by the transcription renderer, into the element the failure branch hides'
  );
});

test('capture refuses for every caller, not only the one that passes a probe', async () => {
  // Adversary finding 1, BLOCKING. The guard was written `if (probe && ...)`, which made the
  // refusal opt in. Of capture's eight call sites exactly one passed a probe, and `frame()`, the
  // route that serves the picture the panel renders, was not among them. A guard that protects
  // only the caller that remembers to ask for protection is not a guard.
  const { reader, shots } = wiredReader({ label: '', spinner: true, painted: false, bookError: false });
  reader.frame = { seq: 4, jpeg: Buffer.from('the-last-real-page'), at: Date.now() - 9_000 };

  // No probe argument at all: the shape every other call site uses.
  const out = await reader.capture({ force: true });

  assert.equal(shots(), 0, 'a caller that passes nothing is still refused');
  assert.equal(out.jpeg.toString(), 'the-last-real-page');

  // And the source no longer makes the check conditional on being handed one.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const body = src.slice(src.indexOf('async capture('), src.indexOf('async text('));
  assert.ok(!/if \(probe &&/.test(body), 'the refusal is not conditional on a probe being supplied');
  assert.match(body, /probe \?\? await this\.#probe\(\)/, 'it takes its own when the caller gives none');
});

test('capture refuses when the page cannot be asked at all', async () => {
  // A probe that throws is not evidence that the page arrived. Before this, an unaskable page
  // fell through to the screenshot because the guard only ran when a probe was handed in.
  const reader = new Reader({ config: { reading: {} } });
  Object.defineProperty(reader, 'running', { get: () => true, configurable: true });
  reader.sessionId = 'test-session';
  reader.clip = { x: 0, y: 0, width: 512, height: 700 };
  reader.frontier = reader.pos;
  reader.frame = { seq: 5, jpeg: Buffer.from('held'), at: Date.now() - 9_000 };
  let shots = 0;
  reader.cdp = {
    async send(method) {
      if (method === 'Runtime.evaluate') throw new Error('Runtime.evaluate did not answer in 8000ms');
      if (method === 'Page.captureScreenshot') { shots += 1; return { data: '' }; }
      return {};
    },
  };

  const out = await reader.capture({ force: true });
  assert.equal(shots, 0, 'a page that cannot answer is not photographed');
  assert.equal(out.jpeg.toString(), 'held');
});

test('the seed path does not publish a page that has not arrived', async () => {
  // Adversary finding 2, BLOCKING. `#seed` shot first, probed second, and showed the picture
  // regardless of the answer, going around `capture` entirely. It runs on the path after a revive,
  // which is exactly when the page is least likely to be there. `#show` advances `seq` whenever
  // the bytes differ and a spinner is animated, so its bytes always differ: the panel refetched
  // and drew the spinner as the current page every time.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const seed = src.slice(src.indexOf('async #seed()'), src.indexOf('async #trim('));
  assert.ok(seed.length > 0, 'the seed path is found');

  // The order is the fix: ask, then shoot. Asserted by position because the order IS the property.
  const asked = seed.indexOf('await this.#probe()');
  const shot = seed.indexOf('await this.#shoot()');
  assert.ok(asked > 0 && shot > 0, 'it both asks and shoots');
  assert.ok(asked < shot, 'and it asks BEFORE it shoots');
  assert.match(seed, /!probe\.painted && !probe\.bookError/, 'refusing a page that has not arrived');
});

test('read-ahead does not shelve a page the probe says has not arrived', async () => {
  // The other half of finding 2. `#step` fills the shelf rather than the panel, but the shelf is
  // served straight to the panel when you turn to that page, so shelving a spinner defeats
  // capture's refusal one move later.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const step = src.slice(src.indexOf('async #step('), src.indexOf('async #seed()'));

  assert.match(step, /if \(probe && !probe\.painted && !probe\.bookError\)/, 'an affirmative no is refused');
  // And unknown is NOT treated as bad: the short-budget probe legitimately returns null on a busy
  // renderer, and this method is built around that. Refusing on null would break read-ahead
  // precisely when the machine is loaded, which is the opposite of the intent.
  assert.match(step, /#probeSoon\(\)/, 'it still uses the short budget probe');
  assert.ok(
    !/if \(!probe \|\|/.test(step),
    'a null probe is tolerated rather than treated as a page that failed to arrive'
  );
});


// ---------------------------------------------------------------------------------------------
// The adversarial review of this loop's own diff (docs/ADVERSARY_REPORT_READER_2026-08-19.md)
// found six more surfaces stating an outcome they never obtained. Each test below is the check
// that report prescribed, and each was confirmed to FAIL against the code as it stood.
// ---------------------------------------------------------------------------------------------

test('a retry whose probe never answered does not report on the page', async () => {
  // Finding 4. `after` was null in two different situations, a page that answered and reported
  // nothing painted, and a page that was never asked because the probe threw, and the refusal
  // asserted the first in both cases. The second is a claim about a page nobody questioned, and
  // it also loses the remedy: the panel has a branch for a page that stopped answering that the
  // flattened sentence could never route to.
  const reader = new Reader({ config: { reading: {} }, logger: { info() {}, warn() {}, error() {} } });
  reader.asin = 'B0046LU7H0';
  Object.defineProperty(reader, 'running', { get: () => true, configurable: true });
  reader.sessionId = 'test-session';
  reader.viewport = { width: 900, height: 1200 };
  reader.revive = async () => true;
  reader.cdp = {
    async send(method) {
      if (method === 'Runtime.evaluate') throw new Error('Runtime.evaluate did not answer in 8000ms');
      return {};
    },
  };

  const out = await reader.retryBook();

  assert.equal(out.ok, false);
  assert.ok(
    !/has not painted anything/.test(out.actual),
    `a page that was never asked is not described as blank: ${out.actual}`
  );
  assert.match(out.actual, /did not answer in \d+ms/, 'the thrown message survives to the panel');
  // And the panel's own wedge remedy can now reach it, which is the point of keeping the message.
  const panel = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const wedgeSource = (panel.slice(panel.indexOf('function readerRemedy')).match(/if \(\/(.+?)\/i\.test\(r\)\)/) || [])[1];
  assert.ok(new RegExp(wedgeSource, 'i').test(out.actual), 'and the panel routes it to the wedge remedy');
});

test('ensure does not answer ok over a settle that found nothing', async () => {
  // Finding 5. A liveness answer that says ok over a dead page is worse than an error, because
  // the caller stops looking. `settled` was consulted for exactly one thing, whether the session
  // had signed out, so a settle that burned its whole budget seeing nothing still returned ok.
  const reader = new Reader({ config: { reading: {} }, logger: { info() {}, warn() {}, error() {} } });
  Object.defineProperty(reader, 'running', { get: () => true, configurable: true });
  reader.sessionId = 'test-session';
  reader.settle = async () => null;
  reader.cdp = { async send() { return {}; } };

  const out = await reader.ensure({ asin: 'B0046LU7H0', width: 900, height: 1200 });

  assert.equal(out.ok, false, 'a settle that observed nothing is not an open book');
  assert.ok(out.reason, 'and the refusal names a move');
});

test('settle does not hand back a reading it took forty seconds ago', async () => {
  // Finding 7. `last` is assigned only on a SUCCESSFUL probe and was returned at the deadline
  // however old it was, so a page that answered once with a painted shell and then stopped
  // answering entirely returned that first reading as settle's answer. `revive` read `.painted`
  // off it and reported the book was back: the same false claim, moved from "my steps ran" to
  // "here is a reading from forty seconds ago".
  const reader = new Reader({ config: { reading: {} }, logger: { info() {}, warn() {}, error() {} } });
  Object.defineProperty(reader, 'running', { get: () => true, configurable: true });
  reader.sessionId = 'test-session';
  let asked = 0;
  reader.cdp = {
    async send(method) {
      if (method !== 'Runtime.evaluate') return {};
      asked += 1;
      if (asked === 1) return { result: { value: JSON.stringify({ painted: true, label: '', bookError: false, signedOut: false }) } };
      await new Promise((r) => setTimeout(r, 400));
      throw new Error('Runtime.evaluate did not answer in 8000ms');
    },
  };

  const settled = await reader.settle({ timeoutMs: 3000, graceMs: 60_000 });

  assert.ok(asked > 1, 'the fixture actually got past its one good answer');
  assert.equal(settled, null, 'a settle that timed out has not observed anything');
});

test('a page that never answers is reported once, whatever budget the caller gave', async () => {
  // Finding 8. The old rule was five consecutive exceptions. `#evaluate` waits 8000ms before it
  // gives up, so five misses need about 42 seconds, and two of settle's four callers hand it
  // 12000ms and 15000ms: the line could never print for them. This asserts the invariant the
  // line exists for, rather than the constant, and it runs at the smaller budget.
  const said = [];
  const reader = new Reader({
    config: { reading: {} },
    logger: { info: (m) => said.push(m), warn() {}, error() {} },
  });
  Object.defineProperty(reader, 'running', { get: () => true, configurable: true });
  reader.sessionId = 'test-session';
  reader.cdp = {
    async send(method) {
      if (method !== 'Runtime.evaluate') return {};
      throw new Error('Runtime.evaluate did not answer in 8000ms');
    },
  };

  await reader.settle({ timeoutMs: 3000 });

  const quiet = said.filter((m) => /has not answered a probe/.test(m));
  assert.equal(quiet.length, 1, `a page that never answers says so exactly once: ${JSON.stringify(said)}`);
  assert.match(quiet[0], /Remedy:/, 'and it names the move');
});

test('a prompt that is still on screen is not reported as answered', async () => {
  // Finding 9, which is E1's stated root cause. The returned list was the prompts that were
  // CLICKED, and both callers read it as the prompts that were GONE: one of them takes a
  // non-empty list as its signal to settle for another fifteen seconds. Clicking an element
  // whose label matched is not a dismissal.
  const said = [];
  const reader = new Reader({
    config: { reading: {} },
    logger: { info: (m) => said.push(m), warn() {}, error() {} },
  });
  Object.defineProperty(reader, 'running', { get: () => true, configurable: true });
  reader.sessionId = 'test-session';
  const scripts = [];
  reader.cdp = {
    async send(method, params) {
      if (method !== 'Runtime.evaluate') return {};
      scripts.push(params.expression);
      // Both calls report the prompt present: the click landed on nothing.
      return { result: { value: JSON.stringify(['Go to the most recent page read?']) } };
    },
  };

  const gone = await reader.dismissOverlays('Yes');

  // literal-ok: two is the specification. One evaluate is a click nobody checked, which is the
  // finding; two is the click and the re-read that confirms the prompt actually went.
  assert.equal(scripts.length, 2, 'the document is read again after the click, not assumed');
  assert.deepEqual(gone, [], 'a prompt still on screen is not in the answered list');
  assert.ok(
    said.some((m) => /still on screen/.test(m)),
    `and the log says the press did not land: ${JSON.stringify(said)}`
  );
});

test('a prompt that really went away is reported answered', async () => {
  // The other half, so the fix above cannot be "return nothing and always be right".
  const reader = new Reader({ config: { reading: {} }, logger: { info() {}, warn() {}, error() {} } });
  Object.defineProperty(reader, 'running', { get: () => true, configurable: true });
  reader.sessionId = 'test-session';
  let call = 0;
  reader.cdp = {
    async send(method) {
      if (method !== 'Runtime.evaluate') return {};
      call += 1;
      return { result: { value: JSON.stringify(call === 1 ? ['Go to the most recent page read?'] : []) } };
    },
  };

  const gone = await reader.dismissOverlays('Yes');

  assert.deepEqual(gone, ['Go to the most recent page read?'], 'the dismissal that worked is reported');
});

test('the shelf label is not printed over a spinner', async () => {
  // Finding 6. The gate asked whether the BROWSER had a label, which repaired the empty half and
  // left the wrong half standing: the measured wedge is a spinner under a truthful label, so the
  // gate passed and the shelf's remembered page was printed over a loading spinner.
  const reader = new Reader({ config: { reading: {} } });
  Object.defineProperty(reader, 'running', { get: () => true, configurable: true });
  reader.sessionId = 'test-session';
  reader.asin = 'B0046LU7H0';
  reader.pos = 217;
  reader.pages.set(217, { label: 'Page 217 of 220', at: Date.now() });
  // The live wedge, verbatim from the evidence file: a spinner under a truthful page number.
  reader.cdp = {
    async send(method) {
      if (method !== 'Runtime.evaluate') return {};
      return {
        result: {
          value: JSON.stringify({
            label: 'Page 219 of 220 ● 95%', painted: false, spinner: true, bookError: false, signedOut: false,
          }),
        },
      };
    },
  };

  const out = await reader.state();

  assert.equal(out.label, '', 'nothing is claimed about a page that has not arrived');
});

test('the panel does not promise turns over a page that is not there', async () => {
  // Finding 6, second half. `readerShelf` is only ever assigned, never cleared while the reader
  // is wedged, so the count survives the failure that made it false. With the label gated on
  // arrival, an ungated count still printed "  ·  2 pages ready to turn instantly" on its own
  // over a spinner, which is the same promise with the page number removed.
  const panel = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const line = panel.split('\n').find((l) => /const ahead = /.test(l));
  assert.ok(line, 'the panel computes an ahead count');
  assert.match(
    line,
    /d\.label\s*&&/,
    `the count is gated on the page having arrived: ${line.trim()}`
  );
});

test('a failed revive keeps the error that explains it', async () => {
  // Finding 12. `this.error = null` ran unconditionally, on the same path that can return false.
  // That string is what `state` reports and what the panel's remedy mapper is driven off, so a
  // failed revive erased the one message that routes to the remedy for a page that has stopped
  // responding, and the panel was left with a failure it could say nothing about.
  const reader = new Reader({ config: { reading: {} }, logger: { info() {}, warn() {}, error() {} } });
  reader.asin = 'B0046LU7H0';
  reader.sessionId = 'test-session';
  reader.targetId = 'test-target';
  reader.error = 'Runtime.evaluate did not answer in 8000ms';
  reader.settle = async () => null;
  reader.cdp = { closed: false, async send() { return {}; } };

  const back = await reader.revive();

  assert.equal(back, false, 'a settle that found nothing is not a recovery');
  assert.equal(
    reader.error,
    'Runtime.evaluate did not answer in 8000ms',
    'and the message the panel needs to explain it survives'
  );
});

test('a revive that works does clear the error', async () => {
  // The other half, so the fix cannot be "never clear it", which would strand the panel on a
  // stale failure after a recovery that really happened.
  const reader = new Reader({ config: { reading: {} }, logger: { info() {}, warn() {}, error() {} } });
  reader.asin = 'B0046LU7H0';
  reader.sessionId = 'test-session';
  reader.targetId = 'test-target';
  reader.error = 'Runtime.evaluate did not answer in 8000ms';
  reader.settle = async () => ({ painted: true, label: 'Page 80 of 220' });
  reader.cdp = { closed: false, async send() { return {}; } };

  assert.equal(await reader.revive(), true);
  assert.equal(reader.error, null, 'a recovery clears the failure it recovered from');
});

test('arrival means the same thing to everything that asks', async () => {
  // Finding 13. Two callers computed this separately and had drifted: a reopen landing on the
  // sign-in page was arrival for one and not for the other, so a fully rendered form waiting for
  // input was described to the panel as a tab that had not painted anything.
  assert.equal(arrivedAtSomething({ signedOut: true }), true, 'a sign-in page is asking, not wedged');
  assert.equal(arrivedAtSomething({ bookError: true }), true, "the vendor's failure page arrived");
  assert.equal(arrivedAtSomething({ painted: true }), true);
  assert.equal(arrivedAtSomething({ spinner: true }), false, 'a spinner is the case this refuses');
  assert.equal(arrivedAtSomething(null), false, 'and so is nothing at all');

  // Both call sites go through it, so the divergence has to be written down to exist again.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const uses = (src.match(/arrivedAtSomething\(/g) || []).length;
  assert.ok(uses >= 3, `the predicate is used, not just declared: ${uses} references`);
  // Everything except the declaration itself, which is allowed to contain its own expression.
  const body = src.slice(src.indexOf('export function arrivedAtSomething'));
  const elsewhere = src.replace(body.slice(0, body.indexOf('}') + 1), '');
  assert.equal(
    (elsewhere.match(/\.painted \|\| \w+\.bookError/g) || []).length,
    0,
    'and nobody computes their own copy of it'
  );
});

test('a retry that could not reopen the tab says so', async () => {
  // Finding 15. Every test stubbed `revive` to a constant true, so the reopen refusal was never
  // executed by anything: its four fields were checked only by a scan of the source text, which
  // would pass just as well if the branch were unreachable or its remedy were nonsense.
  const reader = new Reader({ config: { reading: {} }, logger: { info() {}, warn() {}, error() {} } });
  reader.asin = 'B0046LU7H0';
  Object.defineProperty(reader, 'running', { get: () => true, configurable: true });
  reader.sessionId = 'test-session';
  reader.viewport = { width: 900, height: 1200 };
  reader.revive = async () => false;
  reader.cdp = { async send() { return {}; } };

  const out = await reader.retryBook();

  assert.equal(out.ok, false);
  assert.equal(out.stage, 'reopen', 'the branch is reachable and names its stage');
  assert.ok(out.expected && out.actual && /Remedy:/.test(out.reason), 'and it names a move');
});

test('a spinner that is mounted but hidden does not blind the reader', async () => {
  // Finding 17. `painted` became conditional on an element's EXISTENCE in the document. The same
  // weakness was already measured on the sync prompt, where three ion-modal elements sit
  // permanently in that DOM, so presence proves nothing. Nothing in the evidence shows an arrived
  // page with this element absent, so under a presence test a vendor change that keeps it mounted
  // would stop the reader photographing anything, permanently and silently.
  const run = (spinnerBox, spinnerHidden = false) => {
    const el = spinnerBox && {
      classList: { contains: () => spinnerHidden },
      getBoundingClientRect: () => spinnerBox,
    };
    const document = {
      body: { innerText: 'Page 80 of 220 ● 37%' },
      title: 'Kindle',
      querySelector: (q) => (q === '.kg-spinner' ? el || null : null),
      querySelectorAll: () => [],
    };
    const location = { href: 'https://read.amazon.com/?asin=B0046LU7H0' };
    const window = { devicePixelRatio: 2 };
    // eslint-disable-next-line no-new-func
    return JSON.parse(new Function('document', 'location', 'window', `return ${PROBE}`)(document, location, window));
  };

  const showing = run({ width: 48, height: 48, x: 0, y: 0 });
  assert.equal(showing.spinner, true, 'a spinner with a box on screen is a spinner');
  assert.equal(showing.painted, false, 'and the page it covers has not arrived');

  const collapsed = run({ width: 0, height: 0, x: 0, y: 0 });
  assert.equal(collapsed.spinner, false, 'a node with no box is not showing anything');
  assert.equal(collapsed.painted, true, 'so the page under it is the book');

  const classHidden = run({ width: 48, height: 48, x: 0, y: 0 }, true);
  assert.equal(classHidden.spinner, false, "and the vendor's own hidden class is honoured");

  const absent = run(null);
  assert.equal(absent.painted, true, 'no element at all is still the ordinary case');
});

test('a text load started before the failure does not un-hide over it', async () => {
  // Finding 16. `loadReaderText` un-hides the transcript before it awaits, and again on its
  // low-confidence path, and `renderReader` does not await it. A load started on one poll can
  // therefore resolve after the next poll has found the book failed and hidden both elements.
  const panel = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const start = panel.indexOf('async function loadReaderText(');
  assert.ok(start > 0, 'the function is there to guard');
  const head = panel.slice(start, panel.indexOf('readerTextBusy = true;', start));
  assert.match(head, /if \(readerFailed/, `the failure flag is consulted before anything is shown: ${head}`);
});

test("a script the vendor's own app could not load is reported, not spun over", () => {
  // Measured live on 2026-08-22. Amazon's reader is code-split, and two of its own chunks began
  // answering 404 from Amazon's CDN: `curl` with no cookies and no profile gets HTTP 404 and a
  // nine byte body for both, while a sibling chunk of the same app returns 200. The loader threw
  // ChunkLoadError, the book pane never mounted, and the loading element spun with no error text
  // anywhere on screen. Interstice cannot fix a file missing from someone else's servers; what it
  // must not do is present that as "loading" forever, which reads as our bug.
  const doc = {
    body: { innerText: 'Kindle Library' },
    title: 'Kindle',
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const dead = 'https://m.media-amazon.com/images/G/01/kindle/kindlefortheweb/js/725-ca73bf4e63259892d294.chunk.js';
  // eslint-disable-next-line no-new-func
  const run = (win) => JSON.parse(new Function('document', 'location', 'window', `return ${PROBE}`)(
    doc, { href: 'https://read.amazon.com/?asin=B0046LU7H0' }, win
  ));

  const broken = run({ devicePixelRatio: 2, __interstice_dead_scripts: [dead] });
  assert.deepEqual(broken.deadScripts, [dead], 'the probe reports the file by name');
  assert.equal(broken.painted, false, 'and the page it never drew is not painted');

  const fine = run({ devicePixelRatio: 2 });
  assert.deepEqual(fine.deadScripts, [], 'an ordinary page reports none');
});

test('the script watcher listens where a failed script can actually be heard', () => {
  // A `<script>` that 404s fires an error event on the element that does NOT bubble, so a
  // listener without the capture flag never runs. The resource timeline cannot stand in for it
  // either: these chunks are cross-origin without Timing-Allow-Origin, so `responseStatus` reads
  // 0 rather than 404 and a filter on the status finds nothing. Both were tried against the live
  // failure before this was written, which is why the flag is asserted rather than assumed.
  assert.match(SCRIPT_WATCH, /addEventListener\('error'[\s\S]*?,\s*true\)/, 'the capture phase is used');
  assert.match(SCRIPT_WATCH, /__interstice_script_hooked/, 'and it installs only once');

  // Run it against a fake window and prove it records a failed script and ignores other errors.
  const listeners = [];
  const win = { addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }) };
  // eslint-disable-next-line no-new-func
  new Function('window', 'addEventListener', `${SCRIPT_WATCH}`)(win, (t, f, c) => listeners.push({ type: t, fn: f, capture: c }));
  assert.equal(listeners.length, 1, 'exactly one listener is installed');
  assert.equal(listeners[0].capture, true, 'in the capture phase');

  const fire = (target) => listeners[0].fn({ target });
  fire({ tagName: 'SCRIPT', src: 'https://cdn.example/a.chunk.js' });
  fire({ tagName: 'SCRIPT', src: 'https://cdn.example/a.chunk.js' });
  fire({ tagName: 'IMG', src: 'https://cdn.example/cover.jpg' });
  fire(win);
  assert.deepEqual(
    win.__interstice_dead_scripts,
    ['https://cdn.example/a.chunk.js'],
    'the same script once, and nothing that is not a script'
  );
});

test('the panel names the vendor outage instead of showing the failure it is not', () => {
  // The two failures share one surface because from here they are the same situation: no page,
  // nothing to turn, and a reader owed an explanation. They differ in the copy because the
  // remedies differ, and one of them has no remedy this program can offer.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const start = html.indexOf("$('reader-failed').hidden = !readerFailed;");
  const branch = html.slice(start, html.indexOf('// Back to a real page', start));

  assert.match(branch, /if \(vendorBroken\)/, 'the outage has a branch of its own');
  assert.match(branch, /reader-failed-detail/, 'and it shows the file, so the claim is checkable');
  // The remedy must not promise that pressing a button fetches a file off someone else's CDN.
  const outage = branch.slice(branch.indexOf('if (vendorBroken)'), branch.indexOf('} else {'));
  assert.ok(
    !/Try again:/.test(outage),
    'the outage copy does not promise the retry will fix it'
  );
  assert.match(outage, /outage on their side/, 'and it says whose failure it is');
  // The element it writes into has to exist, or all of the above is writing to null.
  assert.match(html, /id="reader-failed-detail"/, 'the detail element exists in the markup');
  assert.match(html, /id="reader-failed-title"/, 'and so does the title it retitles');
});

test('a prompt the reader could not answer is never photographed', async () => {
  // Item 1.3. The page behind Amazon's question IS painted, so the painted rule lets it through
  // and the photograph has the dialog in the middle of it, set in the panel's reading type as
  // the page. The dismissal runs before capture on the paths that expect one, so a prompt still
  // standing here is one that was not answered.
  const { reader, shots } = wiredReader({ label: 'Page 80 of 220', painted: true, bookError: false });
  reader.frame = { seq: 4, jpeg: Buffer.from('the-last-real-page'), at: Date.now() - 10_000 };

  // The prompt text is verbatim from the live reader, docs/evidence/2026-08-21/E1-VERDICT.md.
  const out = await reader.capture({
    force: true,
    probe: {
      label: 'Page 80 of 220',
      painted: true,
      bookError: false,
      prompt: "Most Recent Page Read You're on location 4328. The most recent location is 4325. Go to location 4325? No Yes",
    },
  });

  assert.equal(shots(), 0, 'no picture is taken of a page with a question over it');
  assert.equal(out.jpeg.toString(), 'the-last-real-page', 'the last real page is what the panel keeps');
});

test('the probe reports a prompt only when it is actually showing', () => {
  // Measured in this DOM: six elements match the three tags the dismissal searches and five are
  // permanently mounted at zero by zero. Presence proves nothing here, which is exactly why the
  // shown test exists, and the probe has to use the same one as the dismissal or the two will
  // disagree about whether there is a question on screen.
  const mk = (over) => ({
    body: { innerText: 'Page 80 of 220' },
    title: 'Kindle',
    querySelector: () => null,
    querySelectorAll: (q) => (q.includes('ion-alert') ? over : []),
  });
  const el = (text, box, hidden = false) => ({
    classList: { contains: () => hidden },
    getBoundingClientRect: () => ({ width: box[0], height: box[1], x: 0, y: 0 }),
    innerText: text,
  });
  const ASK = "Most Recent Page Read You're on location 4328. The most recent location is 4325. Go to location 4325? No Yes";
  // eslint-disable-next-line no-new-func
  const run = (over) => JSON.parse(new Function('document', 'location', 'window', `return ${PROBE}`)(
    mk(over), { href: 'https://read.amazon.com/' }, { devicePixelRatio: 2 }
  ));

  // The live shape: two permanently mounted ghosts and one real alert at 412x520.
  const ghost = el('', [0, 0], true);
  assert.equal(run([ghost, ghost, el(ASK, [412, 520])]).prompt, ASK, 'the shown one is reported');
  assert.equal(run([ghost, ghost]).prompt, '', 'the mounted ghosts are not a question');
  assert.equal(run([el(ASK, [0, 0])]).prompt, '', 'and neither is a matching element with no box');
  assert.equal(run([el(ASK, [412, 520], true)]).prompt, '', 'nor one carrying the hidden class');
  assert.equal(run([el('Rate this book on Goodreads?', [412, 520])]).prompt, '', 'other dialogs are left alone');
});

test('the panel shows the question rather than sitting on the last page', () => {
  // Item 1.3's other half. With the picture refused, a panel that said nothing would hold the
  // previous page on screen indefinitely while Amazon waited for an answer nobody could see.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const start = html.indexOf("$('reader-failed').hidden = !readerFailed;");
  const branch = html.slice(start, html.indexOf('// Back to a real page', start));
  assert.match(branch, /if \(askedSomething\)/, 'the question has a branch of its own');
  const arm = branch.slice(branch.indexOf('if (askedSomething)'), branch.indexOf('} else if'));
  assert.match(arm, /reader-failed-detail'\)\.textContent = d\.prompt/, "it shows Amazon's own words");
  assert.match(arm, /setPagerDisabled\(true/, 'and there is no page to turn');
  // The flag has to be computed from the probe, or the branch is unreachable.
  assert.match(html, /const askedSomething = [^\n]*d\.prompt/, 'the flag comes from the probe');
});
