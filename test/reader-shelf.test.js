import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths.js';
import { PROBE, READER_CSS, Reader, SYNC_PROMPT, WATCH_SCALE, dismissScript } from '../lib/reader.js';

/**
 * The three things that made reading in the panel unusable, and what each one is now.
 *
 * All three were reported together and they were one failure wearing three faces:
 * the panel captured Amazon's whole window rather than the page in it, Amazon put a
 * sync dialog over that window on every page turn, and the transcription then read
 * the dialog, scored badly, and fell back to showing the picture. What the operator
 * saw was a clean page of text on arrival that "regressed to the old cluttered view"
 * the moment they pressed Next, with a second set of page-turn arrows in it.
 *
 * So: the capture is clipped to the page, the dialog is answered before a picture is
 * taken, and pages are read ahead so a turn does not wait for any of it.
 */

/* ------------------------------------------------------------------ the clip --- */

test('the reader measures where the book is drawn, rather than assuming an inset', () => {
  // Amazon lays its toolbar, its two chevrons, its scrubber and its own page label
  // around one inner rectangle. That rectangle is the only part of the window that
  // is the book, and it moves with the viewport: measured at 48,60 384x253 inside a
  // 480x400 panel, which is under half the pixels captured.
  assert.match(PROBE, /\.kg-view/, 'the page rectangle is read off the reader');
  assert.match(PROBE, /clip/, 'and travels with the probe');
});

test('the capture is clipped to the page, at two device pixels to the point', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  assert.match(src, /clip:\s*\{\s*\.\.\.clip,\s*scale:\s*scale \?\? this\.captureScale\(\)\s*\}/, 'clipped, and scaled');
  assert.match(src, /captureBeyondViewport: false/, 'and never beyond the window');
  assert.match(src, /deviceScaleFactor: 2/, 'the page still gets a retina layout');
});

test('the turn is watched for with a thumbnail, not with a question to the renderer', () => {
  // The renderer on this page holds a core at 96% for as long as the book is open,
  // which is a documented fact about it. Under that load a `Runtime.evaluate` that
  // measures 2ms on an idle page can outlast its own timeout, and a page turn that
  // depended on one took 26 seconds and then reported that it had not turned.
  // Screenshots are served by the browser process and stayed at 65ms throughout.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const step = src.slice(src.indexOf('async #step('), src.indexOf('async #seed()'));
  assert.match(step, /this\.#watch\(\)/, 'the turn is watched as a picture');
  assert.ok(!/#evaluate\(/.test(step), 'and nothing in the wait asks the renderer directly');
});

test('a dialog that ate the keypress gets the keypress again', () => {
  // Answering "Most Recent Page Read" leaves you on the page you were already on:
  // the arrow key went into the dialog, not into the book. A step that gave up there
  // reported "did not turn", and one such report used to disable reading ahead for
  // the rest of the session.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const step = src.slice(src.indexOf('async #step('), src.indexOf('async #seed()'));
  assert.match(step, /dismissOverlays\('No'\)\)\.length\) await this\.key\(key\)/, 'the turn is asked for again');
});

test('read-ahead that failed is retried later, not abandoned for the session', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  assert.match(src, /readAheadFailedAt = Date\.now\(\)/, 'a failure is remembered');
  assert.match(src, /readAhead\(\)\s*\{[\s\S]*?readAheadFailedAt[\s\S]*?5000/, 'and retried after a cooldown');
  // The poll is what retries it. That call moved out of the route body and into the reading
  // surface with the rest of the reader's sequencing; the route now names no member
  // of the Reader at all, so this looks where the sequencing actually lives.
  const reading = fs.readFileSync(path.join(ROOT, 'lib', 'reading.js'), 'utf8');
  assert.match(reading, /reader\.readAhead\(\)/, 'and the poll is what retries it');
});

test('every capture uses one rasterisation scale, because two wedged the browser', () => {
  // Watching for a page turn with cheap quarter-scale shots looked like an obvious
  // economy. Alternating the scale of a clipped capture makes the compositor
  // re-raster the page each time it changes, and three or four page turns of that
  // took this renderer from its usual 96% of a core to pegged at 102% with 600MB
  // resident, answering neither screenshots nor navigations: the book could not be
  // turned and could not be reloaded. A capture at one scale is 65ms. Use one.
  const reader = new Reader({ config: { reading: {} } });
  for (const dpr of [1, 2, 0]) {
    reader.dpr = dpr;
    assert.equal(reader.captureScale(), 1, 'one scale, whatever the page says its density is');
  }
  assert.equal(WATCH_SCALE, reader.captureScale(), 'and the watching capture uses that same one');
});

test('the furniture that sits on top of the page is hidden, and the rest is not', () => {
  // The chevrons were the "redundant buttons": a second pair of page-turn arrows
  // inside the picture, next to the panel's own. The scrubber's "Back to 79" pill
  // was worse, because it is not merely clutter: it read back as "ck to 79" and was
  // set into the middle of a paragraph as if it were the book.
  for (const gone of ['#kr-chevron-left', '#kr-chevron-right', '#kra-scrubber-back-button', 'button.bookmark']) {
    assert.ok(READER_CSS.includes(gone), `${gone} is hidden`);
  }
  // The header and the footer are NOT hidden. The reader measures its own page
  // rectangle against them, so removing them moves the text out from under the clip,
  // and the footer holds the only statement of position the reader makes in words.
  assert.ok(!READER_CSS.includes('#reader-header'), 'the header is left where it is');
  assert.ok(!READER_CSS.includes('reader-footer'), 'and so is the footer');
  // And nothing is taken out of layout. `display: none` on the chevron containers
  // drove this reader from its usual 96% of a core to pegged and unresponsive:
  // screenshots stopped being answered inside twenty seconds and the book could not
  // be turned at all. It recomputes its page rectangle against them continuously.
  assert.ok(!/display:\s*none/.test(READER_CSS.split('\n').slice(1).join('\n')), 'the furniture keeps its box');
  assert.match(READER_CSS, /visibility: hidden/, 'it is only taken off the screen');
});

/* ------------------------------------------------------------- the interruption --- */

test('Amazon\'s sync question is recognised by its wording, not by its element', () => {
  // That document holds four hidden `ion-modal` templates and reuses them, so which
  // one carries the question is not a stable fact to key on.
  assert.ok(SYNC_PROMPT.test('Most Recent Page Read'), 'the dialog that was on screen');
  assert.ok(SYNC_PROMPT.test("You're on location 1665. The most recent location is 1658."), 'and its body');
  assert.ok(!SYNC_PROMPT.test('Strategy, tactics, and guiding principles'), 'a page of the book is not a dialog');
  assert.ok(!SYNC_PROMPT.test('Delete this bookmark?'), 'and neither is every other question Amazon asks');
});

test('the dismissal presses the button it was told to, and nothing else', () => {
  const no = dismissScript('No');
  assert.match(no, /"No"\.toLowerCase\(\)/, 'the answer is carried into the script');
  // Compared case-insensitively because the button is Amazon's, and its label is
  // theirs to capitalise.
  assert.match(no, /\.trim\(\)\.toLowerCase\(\) === want/, 'and matched without caring about case');
  assert.match(no, /overlay-hidden/, 'a hidden Ionic overlay is not an open dialog');
  assert.match(no, /\.click\(\)/, 'and the button is actually pressed');
  assert.match(dismissScript('Yes'), /"Yes"\.toLowerCase\(\)/, 'the other answer is available too');
});

test('the book is opened on the synced position and read on from where you are', () => {
  // The difference between the two answers is the whole of the behaviour. On the
  // way in, the position your Kindle synced is what you want. Once you are reading,
  // being thrown back to where another device left off is the interruption.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const seed = src.slice(src.indexOf('async #seed()'), src.indexOf('#prefetch()'));
  assert.match(seed, /dismissOverlays\('Yes'\)/, 'opening a book takes the synced position');
  const step = src.slice(src.indexOf('async #step('), src.indexOf('async #seed()'));
  assert.match(step, /dismissOverlays\('No'\)/, 'turning a page keeps the one you are on');
  // Inside the turn, before the picture. Answered afterwards, the dialog is still in
  // the frame and still in the transcription, which is exactly what shipped.
  assert.ok(
    step.indexOf("dismissOverlays('No')") < step.indexOf('this.#shoot()', step.indexOf("dismissOverlays('No')")),
    'the dialog is answered before the picture is taken'
  );
});

/* ----------------------------------------------------------------- the shelf --- */

/** A reader that believes it has a browser, and records everything asked of one. */
function shelved({ readAhead = 0, keepBehind = 4 } = {}) {
  const calls = [];
  const reader = new Reader({ config: { reading: { readAhead, keepBehind } } });
  reader.browser = { child: null };
  reader.cdp = {
    closed: false,
    close() {},
    async send(method) {
      calls.push(method);
      throw new Error(`the test browser was asked for ${method}`);
    },
  };
  return { reader, calls };
}

const page = (n) => ({ label: `Page ${n} of 220`, jpeg: Buffer.from(`page-${n}`), text: null, at: Date.now() });

test('a page that is already held is turned to without touching the browser', async () => {
  // This is the fix, stated as plainly as it can be. A forward turn used to mean a
  // keypress, up to a second and a half of watching for the repaint, a screenshot,
  // and six tenths of a second of transcription. On a page that has been read ahead
  // it is now a lookup.
  const { reader, calls } = shelved();
  reader.pages.set(0, page(79));
  reader.pages.set(1, page(80));
  reader.frontier = 1;

  const turned = await reader.turn('next');

  assert.equal(turned.turned, true);
  assert.equal(turned.cached, true, 'and it says so, rather than looking fast for no stated reason');
  assert.equal(turned.label, 'Page 80 of 220');
  assert.equal(reader.pos, 1);
  assert.deepEqual(calls, [], 'the browser was not asked for anything at all');
  assert.deepEqual(reader.frame.jpeg, Buffer.from('page-80'), 'and the held picture is on screen');
});

test('the sequence moves on a held page, so the panel actually swaps the picture', async () => {
  // The panel refetches on the sequence number. A turn that served a different page
  // without moving it would leave the previous page's picture on screen.
  const { reader } = shelved();
  reader.pages.set(0, page(79));
  reader.pages.set(1, page(80));
  reader.frontier = 1;
  await reader.capture({ force: true }).catch(() => {});
  reader.frame = { seq: 1, jpeg: Buffer.from('page-79'), at: Date.now() };
  reader.seq = 1;

  const turned = await reader.turn('next');
  assert.equal(turned.seq, 2, 'the picture is a new one as far as the panel is concerned');
});

test('going back off the front of the shelf is said, not silently ignored', async () => {
  const { reader, calls } = shelved();
  reader.pages.set(0, page(79));
  const back = await reader.turn('prev');
  assert.equal(back.turned, false);
  assert.equal(back.atStart, true, 'the panel has something true to say about it');
  assert.deepEqual(calls, [], 'and no arrow key was sent into the void');
});

test('the words come off the shelf too, when the page was read ahead', async () => {
  // Half the wait was the transcription, not the picture. A page whose text was
  // read while you were still on the page before it costs nothing when you arrive.
  const { reader, calls } = shelved();
  const ahead = page(80);
  ahead.text = { blocks: [{ type: 'para', text: 'the guiding principles' }], confidence: 1 };
  reader.pages.set(0, page(79));
  reader.pages.set(1, ahead);
  reader.frontier = 1;

  await reader.turn('next');
  const text = await reader.text();

  assert.equal(text.ok, true);
  assert.equal(text.cached, true);
  assert.equal(text.blocks[0].text, 'the guiding principles');
  assert.deepEqual(calls, [], 'nothing was captured and nothing was transcribed');
});

test('no picture is taken of a browser that has run on ahead of you', async () => {
  // The browser parks two pages ahead while it fills the shelf. A capture taken
  // then is a capture of a page you have not turned to, and it would be served as
  // the page you are reading.
  const { reader, calls } = shelved();
  reader.pages.set(0, page(79));
  reader.frame = { seq: 1, jpeg: Buffer.from('page-79'), at: 0 };
  reader.pos = 0;
  reader.frontier = 2;

  const frame = await reader.capture({ force: true });

  assert.deepEqual(frame.jpeg, Buffer.from('page-79'), 'you are still looking at your own page');
  assert.deepEqual(calls, [], 'and the browser was not asked to draw one');
});

test('the shelf is a window around you, not a growing pile', async () => {
  // A page is roughly a hundred kilobytes of JPEG plus its transcription, and a
  // reading session is hundreds of pages.
  const READ_AHEAD = 2;
  const KEEP_BEHIND = 4;
  const { reader } = shelved({ readAhead: READ_AHEAD, keepBehind: KEEP_BEHIND });
  for (let i = 0; i < 40; i += 1) reader.pages.set(i, page(i));
  reader.pos = 30;
  reader.frontier = 30;
  await reader.turn('next'); // held: lands on 31 and trims on the way past

  // Four behind, four in front and the one you are on: bounded, and bounded by the
  // configured numbers rather than by a magic one. The window ahead is the wider of the two,
  // because paging backwards leaves the browser parked well in front of you.
  const window = KEEP_BEHIND + Math.max(READ_AHEAD, KEEP_BEHIND) + 1;
  assert.equal(reader.pages.size, window, `holds a window, not everything (held ${reader.pages.size})`);
  assert.ok(reader.pages.has(31), 'including where you are');
  assert.ok(reader.pages.has(27) && reader.pages.has(35), 'and its edges');
  assert.ok(!reader.pages.has(26) && !reader.pages.has(36), 'and nothing outside it');
  assert.ok(!reader.pages.has(0), 'certainly not where you were an hour ago');
});

test('the shelf is emptied when the browser goes, and when the page is repaginated', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const close = src.slice(src.indexOf('async close()'));
  assert.match(close, /this\.pages\.clear\(\)/, 'a closed browser leaves nothing behind to serve');
  // A resize repaginates the book, so every picture held is of a layout that no
  // longer exists. Keeping them would be worse than being slow.
  const ensure = src.slice(src.indexOf('async ensure('), src.indexOf('async settle('));
  assert.match(ensure, /this\.pages\.clear\(\)/, 'a repaginated book is a new shelf');
});

test('reading ahead stands down the moment you turn a page yourself', () => {
  // Otherwise a press queues behind up to three speculative turns, and the fix for
  // waiting becomes a new way to wait.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const turn = src.slice(src.indexOf('async turn('), src.indexOf('/** Nothing to read'));
  assert.match(turn, /this\.demand \+= 1/, 'a turn says so before it awaits anything');
  const prefetch = src.slice(src.indexOf('#prefetch()'), src.indexOf('#trim()'));
  assert.match(prefetch, /this\.demand === mine/, 'and reading ahead checks between every step');
});

/* --------------------------------------------------------------- the wedge --- */

test('a renderer that stops answering is reopened, not reported', () => {
  // Amazon's reader burns a core the whole time it is open, which has always been
  // true here. What a run of page turns can do is tip it from busy into stuck:
  // measured repeatedly at 102% of a core and 600MB, answering no screenshot, no
  // evaluation and no navigation. A reload is not the way out, because the reload is
  // itself a message to a renderer that has stopped reading its inbox. Closing the
  // tab is a browser-process operation and works when nothing inside the tab does.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const revive = src.slice(src.indexOf('async revive('), src.indexOf('async #applyViewport()'));
  assert.match(revive, /Target\.closeTarget/, 'the wedged tab is closed');
  assert.match(revive, /#openTab\(\)/, 'a fresh one takes its place');
  assert.match(revive, /Page\.navigate/, 'and the book is reopened');
  assert.ok(!/Page\.reload/.test(src), 'nothing tries to reload a renderer that cannot hear it');
});

test('reading ahead never reopens your book behind your back', () => {
  // A page load nobody asked for, arriving while you are reading, is precisely the
  // interruption this whole project exists to remove. Recovery is something a press
  // of yours can pay for; a speculative turn is not.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const prefetch = src.slice(src.indexOf('#prefetch()'), src.indexOf('#trim()'));
  assert.ok(!/revive\(\)/.test(prefetch), 'reading ahead only records that it is stuck');
  const turn = src.slice(src.indexOf('async turn('), src.indexOf('/** Nothing to read'));
  assert.match(turn, /this\.revive\(\)/, 'a press of yours is what pays for the reopen');
  assert.match(turn, /stuck \?\? 0\) >= 2/, 'and only after twice in a row, not once');
});

test('the clip never runs past the window it is captured from', () => {
  // The reader sizes its renderer to the page it has laid out, and in a squat panel
  // that is taller than the viewport: 483 points of book inside a 400 point window,
  // measured. A clip past the bottom of the viewport is not cropped and does not
  // fail. Chrome captures beyond the viewport, and everything the reader pins to the
  // window repeats down the picture with it: the frame came back as the same page
  // tiled four times, each tile carrying its own Kindle Library button, its own
  // scrubber and its own page label. Which is the cluttered picture this whole
  // change set exists to delete, arriving by a different route.
  const reader = new Reader({ config: { reading: {} } });
  reader.viewport = { width: 480, height: 400 };
  reader.clip = { x: 48, y: 60, width: 384, height: 483 };
  assert.deepEqual(reader.clipNow(), { x: 48, y: 60, width: 384, height: 340 }, 'cropped to what is there');

  reader.clip = { x: 48, y: 60, width: 384, height: 253 };
  assert.deepEqual(reader.clipNow(), { x: 48, y: 60, width: 384, height: 253 }, 'and left alone when it fits');

  reader.clip = { x: 900, y: 900, width: 100, height: 100 };
  const off = reader.clipNow();
  assert.ok(off.x < 480 && off.y < 400 && off.width >= 1 && off.height >= 1, 'a nonsense rectangle is still capturable');
  assert.equal(reader.clip = null, null);
  assert.equal(reader.clipNow(), null, 'and no rectangle means no clip at all');
});
