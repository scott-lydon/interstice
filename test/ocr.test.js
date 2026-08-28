import test from 'node:test';
import assert from 'node:assert/strict';
import { CHROME_PATTERNS, VISION_JXA, WEAK_LINE, isChrome, toBlocks, toLines } from '../lib/ocr.js';

/**
 * The book arrives as a picture, so the words are read back off it. These cover the
 * shaping, which is where every mistake so far has been: text that is correct
 * word for word and wrong as prose.
 *
 * Vision's boxes are normalised with a bottom-left origin, so y counts up the page
 * and everything below sorts descending.
 */

/** What Vision returns: a box, normalised, origin bottom left. */
const obs = (text, { y, x = 0.14, w = 0.72, h = 0.02, conf = 1 }) => ({ text, y, x, w, h, conf });

/** What toLines produces and toBlocks consumes: a whole line, with its right edge. */
const line = (text, { y, x = 0.14, w = 0.72, h = 0.02, conf = 1 }) => ({
  text, y, x, right: x + w, height: h, conf,
});

test('a justified line broken into pieces is put back together, left to right', () => {
  // Measured: "first two levels, copying and" came back as five observations,
  // because justified text has word spacing wide enough for Vision to call each
  // run its own result.
  const lines = toLines([
    obs('levels,', { y: 0.773, x: 0.392, w: 0.1 }),
    obs('first', { y: 0.785, x: 0.138, w: 0.08 }),
    obs('two', { y: 0.785, x: 0.269, w: 0.06 }),
    obs('and', { y: 0.787, x: 0.748, w: 0.07 }),
    obs('copying', { y: 0.774, x: 0.550, w: 0.12 }),
  ]);
  assert.equal(lines.length, 1, 'one baseline is one line');
  assert.equal(lines[0].text, 'first two levels, copying and');
});

test('lines far enough apart stay separate', () => {
  const apart = [obs('one', { y: 0.8 }), obs('two', { y: 0.7 })];
  const lines = toLines(apart);
  assert.equal(lines.length, apart.length, 'nothing merged');
});

test('the reader\'s own furniture is dropped, but only where it lives', () => {
  assert.equal(isChrome({ text: 'Kindle Library ≡ Aa', y: 0.9 }), true);
  assert.equal(isChrome({ text: 'Page 79 of 220 • 37%', y: 0.035 }), true);
  // The same words in the middle of a page are the book talking about a Kindle.
  assert.equal(isChrome({ text: 'Kindle Library', y: 0.5 }), false);
  // And a chapter can open at the very top of a page.
  assert.equal(isChrome({ text: 'Strategy, tactics, and guiding', y: 0.9 }), false);
  assert.ok(CHROME_PATTERNS.length >= 3);
});

test('a heading spanning three lines is one heading, not three', () => {
  // Large type means wide line spacing, wider than the gap between paragraphs, so
  // splitting on gaps alone broke this title into three. Heading lines are found
  // by their height against the page's own median.
  const blocks = toBlocks([
    line('Strategy, tactics,', { y: 0.83, h: 0.055, w: 0.5 }),
    line('and guiding', { y: 0.72, h: 0.055, w: 0.4 }),
    line('principles', { y: 0.61, h: 0.055, w: 0.35 }),
    line('The development of a strategy follows', { y: 0.45, h: 0.02, w: 0.72 }),
    line('the progression given in Gauging', { y: 0.40, h: 0.02, w: 0.72 }),
  ]);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[0].text, 'Strategy, tactics, and guiding principles');
  assert.equal(blocks[1].type, 'para');
});

/**
 * The false heading, from the page it was found on.
 *
 * Real heights, measured off one page of Early Retirement Extreme at 92%: thirty
 * lines of a single unbroken passage, no heading anywhere on it, ranging 0.99x to
 * 1.40x of the same body type because Vision draws its box around whichever glyphs
 * a line happens to carry. The two that crossed the 1.35x threshold were carrying
 * "114" and "ff", and both were set in the panel as large bold headings in the
 * middle of the sentences they belonged to.
 */
test('a tall line in the middle of a sentence is prose, not a heading', () => {
  const blocks = toBlocks([
    line('should be understood--very often people make', { y: 0.80, h: 0.02035 }),
    line('simplifying assumptions to make a problem', { y: 0.76, h: 0.02207 }),
    // Tall enough to pass the height test, and mid-sentence, which is where no
    // heading has ever begun.
    line('mathematically tractable.114 This works well', { y: 0.72, h: 0.02826 }),
    line('in physics because the universe seems to be', { y: 0.68, h: 0.02035 }),
  ]);
  assert.equal(blocks.length, 1, 'one passage, not three');
  assert.equal(blocks[0].type, 'para');
  assert.match(blocks[0].text, /problem mathematically tractable\.114 This works well in physics/);
});

test('a tall line that starts a sentence in lower case is prose too', () => {
  // The second one from the same page: the previous line ended "copying requires",
  // and "no effort, the cost is zero and so the return" was set as a heading.
  const blocks = toBlocks([
    line('as the market index. Since copying requires', { y: 0.60, h: 0.02035 }),
    line('no effort, the cost is zero and so the return', { y: 0.56, h: 0.02890 }),
    line('on effort is undefined. In particular, "average"', { y: 0.52, h: 0.02495 }),
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'para');
});

test('a real heading after a finished sentence is still a heading', () => {
  // The rule must not cost us the thing the height test is for.
  const blocks = toBlocks([
    line('the progression given in Gauging mastery.', { y: 0.80, h: 0.02, w: 0.72 }),
    line('Strategy and tactics', { y: 0.70, h: 0.055, w: 0.5 }),
    line('The development of a strategy follows', { y: 0.60, h: 0.02, w: 0.72 }),
  ]);
  assert.equal(blocks[1].type, 'heading');
  assert.equal(blocks[1].text, 'Strategy and tactics');
});

test('on a justified page a short line ends the paragraph', () => {
  const blocks = toBlocks([
    line('a goal, such as getting out of debt,', { y: 0.60, w: 0.72 }),
    line('becoming a millionaire, retiring', { y: 0.55, w: 0.72 }),
    line('early.', { y: 0.50, w: 0.12 }),
    line('The next two levels, compiling and', { y: 0.45, w: 0.72 }),
    line('computing, correspond to strategy.', { y: 0.40, w: 0.72 }),
  ]);
  // literal-ok: two paragraphs is the assertion itself. The fixture is five lines, and the
  // number under test is how many of them the short line splits into, so there is nothing in
  // the fixture to derive it from.
  assert.equal(blocks.length, 2);
  assert.match(blocks[0].text, /early\.$/);
  assert.match(blocks[1].text, /^The next two levels/);
});

test('on a ragged page it does not, or every line becomes a paragraph', () => {
  // A list, a heading page or verse: most lines stop short of the margin, so
  // "stops short" says nothing at all and only the gaps can be trusted.
  const blocks = toBlocks([
    line('copying ->', { y: 0.60, w: 0.22 }),
    line('comparing ->', { y: 0.55, w: 0.26 }),
    line('compiling ->', { y: 0.50, w: 0.25 }),
    line('computing', { y: 0.45, w: 0.20 }),
  ]);
  assert.equal(blocks.length, 1, 'a ragged run is one block');
});

test('a word the renderer hyphenated is put back together; an em dash is left alone', () => {
  const [joined] = toBlocks([
    line('an objec-', { y: 0.6, w: 0.72 }),
    line('tive is a goal', { y: 0.55, w: 0.3 }),
  ]);
  assert.equal(joined.text, 'an objective is a goal');

  const [dashed] = toBlocks([
    line('an objective--that is,', { y: 0.6, w: 0.72 }),
    line('a goal', { y: 0.55, w: 0.2 }),
  ]);
  assert.equal(dashed.text, 'an objective--that is, a goal');
});

test('Vision is given the image path, not whatever is at a fixed argument', () => {
  // osascript's argv includes the script itself, at a position that moves depending
  // on whether it arrived as a file or after -e. Reading the wrong slot pointed
  // Vision at a path that does not exist, which it reports as no text found:
  // silently, for a page full of text.
  assert.match(VISION_JXA, /args\[args\.length - 1\]/);
  assert.match(VISION_JXA, /fileExistsAtPath/, 'and a missing file is an error, not an empty page');
});

/**
 * How sure the reading was, as one number the reader decides on.
 *
 * The number has to describe the page. Taking the worst line let two glyphs veto a
 * page that was otherwise perfect, and the reader's answer to a page it does not
 * trust is to show the picture instead: the nested Kindle view, its own toolbars,
 * the text in a fraction of the window. That is the failure this measures against.
 */
const PAGE_79 = [
  // Measured on this machine, `Early Retirement Extreme` page 79: eleven body lines,
  // nine perfect, two at 0.50 where Vision met the arrows in
  // `comparing -> compiling -> computing - coordinating ->`.
  ...Array.from({ length: 9 }, () => 1.0),
  0.5,
  0.5,
];

function summarise(confidences) {
  const cs = [...confidences].sort((a, b) => a - b);
  return {
    confidence: cs[Math.floor(cs.length / 2)],
    worst: cs[0],
    weak: cs.filter((c) => c < WEAK_LINE).length / cs.length,
  };
}

test('a page that reads well is not condemned by its two worst lines', () => {
  const s = summarise(PAGE_79);
  assert.equal(s.worst, 0.5, 'the worst line is still reported');
  assert.equal(s.confidence, 1.0, 'the typical line is what the page scores');
  assert.ok(s.weak < 0.5, 'a fifth of the page being shaky is not a shaky page');
  // The reader's own rule, applied to this page: it stays in text.
  assert.ok(!(s.confidence < 0.6 || s.weak > 0.5), 'page 79 renders as words, not as a picture');
});

test('a page that genuinely did not read still sends you to the picture', () => {
  // A diagram, or one of Amazon's dialogs over a blurred page: most lines doubted,
  // not two of them.
  const s = summarise([0.2, 0.3, 0.35, 0.4, 0.9]);
  assert.ok(s.confidence < 0.6 || s.weak > 0.5, 'the picture comes forward, as it should');
});
