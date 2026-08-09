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
