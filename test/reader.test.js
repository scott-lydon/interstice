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
  assert.match(src, /retryBook[\s\S]{0,400}revive\(\{ clearFirst: true \}\)/);
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

  const out = await reader.capture({ force: true, probe: { label: '', bookError: false } });

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

test('a labelled page is still photographed', async () => {
  // The guard must not refuse the ordinary case, which is the mutation most likely to be made
  // by someone tightening it later.
  const { reader, shots } = wiredReader({ label: 'Page 80 of 220', bookError: false, painted: true });
  reader.frame = null;

  await reader.capture({ force: true, probe: { label: 'Page 80 of 220', bookError: false } });

  assert.equal(shots(), 1, 'a page of the book is photographed');
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
  assert.ok(PROBE.includes('spinner:'), 'and reports it as a field of its own');
  const paintedClause = PROBE.slice(PROBE.indexOf('painted:'));
  assert.ok(
    paintedClause.startsWith('painted: !document.querySelector'),
    'painted requires the absence of the spinner before it considers anything else'
  );
});
