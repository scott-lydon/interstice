import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);

/**
 * Reading the page, rather than showing a picture of it.
 *
 * Amazon's reader draws each page as a single image: the page area of that document
 * contains zero text nodes and one blob-backed `<img>`, and the image carries no
 * alt text. There is no accessibility layer to switch on and nothing in the DOM to
 * take, so a picture is all the reader will give anyone.
 *
 * A picture of a book is not a book. Scaled into a panel it is small, it cannot be
 * set in your own type, it does not reflow, and none of it can be selected. So the
 * text is read back off the picture, locally, by the same engine that reads text out
 * of photographs on this machine: Vision, over the ObjC bridge, no dependency and no
 * network. Timed on one book on one machine it took about half a second a page and
 * returned every line at full confidence, which is a single reading rather than a benchmark.
 *
 * What comes back is set in Interstice's own type. The picture stays one press away,
 * because a diagram, a table or an equation is a thing this cannot read, and being
 * able to see what the page really looked like is the check on everything here.
 */

/**
 * Vision, asked for one image.
 *
 * `recognitionLevel = 0` is accurate rather than fast: fast halves the time and
 * loses exactly the kind of small serif text this is pointed at. Language
 * correction is on for the same reason.
 *
 * The observations come back with normalised, bottom-left-origin boxes, which is
 * why everything downstream sorts by descending y.
 */
export const VISION_JXA = `
  ObjC.import('Vision');
  ObjC.import('Foundation');
  const args = ObjC.unwrap($.NSProcessInfo.processInfo.arguments);
  // The last argument, not a fixed index: osascript's argv includes the script
  // itself, at a different position depending on whether it arrived as a file or
  // after -e, and reading the wrong slot points Vision at a path that does not
  // exist. Which it reports as no text found, silently, for a page full of text.
  const file = ObjC.unwrap(args[args.length - 1]);
  if (!$.NSFileManager.defaultManager.fileExistsAtPath(file)) {
    throw new Error('no image at ' + file);
  }
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(file), $());
  const req = $.VNRecognizeTextRequest.alloc.init;
  req.recognitionLevel = 0;
  req.usesLanguageCorrection = true;
  req.recognitionLanguages = $(['en-US']);
  handler.performRequestsError($([req]), $());
  const out = [];
  const results = req.results;
  for (let i = 0; i < results.count; i++) {
    const obs = results.objectAtIndex(i);
    const cand = obs.topCandidates(1).objectAtIndex(0);
    const box = obs.boundingBox;
    out.push({
      text: ObjC.unwrap(cand.string),
      conf: cand.confidence,
      x: box.origin.x, y: box.origin.y, w: box.size.width, h: box.size.height,
    });
  }
  JSON.stringify(out);
`;

export async function recognize(imageFile, { timeoutMs = 20000 } = {}) {
  const { stdout } = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', VISION_JXA, imageFile], {
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [];
}

export async function recognizeBuffer(jpeg, opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-ocr-'));
  const file = path.join(dir, 'page.jpg');
  try {
    fs.writeFileSync(file, jpeg);
    return await recognize(file, opts);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ shaping --- */

/**
 * Justified text arrives in pieces.
 *
 * Vision returns one observation per run of text it is confident about, and a
 * justified line with wide word spacing comes back as several: "first" "two"
 * "levels," "copying" "and" were five observations of one line. Anything sharing a
 * baseline is therefore put back together, left to right, before anything else
 * looks at it.
 */
export function toLines(observations, { tolerance = 0.012 } = {}) {
  const sorted = [...observations].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const o of sorted) {
    const line = lines.find((l) => Math.abs(l.y - o.y) <= tolerance);
    if (line) {
      line.parts.push(o);
      line.y = (line.y * (line.parts.length - 1) + o.y) / line.parts.length;
    } else {
      lines.push({ y: o.y, parts: [o] });
    }
  }
  return lines.map((l) => {
    const parts = l.parts.sort((a, b) => a.x - b.x);
    return {
      y: l.y,
      x: parts[0].x,
      right: Math.max(...parts.map((p) => p.x + p.w)),
      height: Math.max(...parts.map((p) => p.h)),
      conf: Math.min(...parts.map((p) => p.conf)),
      text: parts.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim(),
    };
  });
}

/**
 * The reader's own furniture, which is not part of the book.
 *
 * Two tests, because either alone is wrong. Position, because the toolbar and the
 * progress line live in known bands. And content, because a band is a guess: a
 * chapter can begin at the very top of a page, and dropping it because of where it
 * sits would silently eat a line of the book.
 */
export const CHROME_PATTERNS = [
  /Kindle Library/i,
  /^Page [0-9,]+ of [0-9,]+/i,
  /^Location [0-9,]+ of [0-9,]+/i,
  // What the toolbar icons come back as: a stray glyph or two, never words. The
  // toolbar reads as one line once its pieces are joined, so this matches inside
  // the line rather than against the whole of it.
  /^[^\p{L}\p{N}]{0,4}(Aa|aA)?[^\p{L}\p{N}]{0,4}$/u,
];

export function isChrome(line, { top = 0.88, bottom = 0.09 } = {}) {
  const inBand = line.y >= top || line.y <= bottom;
  const looksLikeChrome = CHROME_PATTERNS.some((p) => p.test(line.text));
  return inBand && looksLikeChrome;
}

const percentile = (numbers, p) => {
  if (!numbers.length) return 0;
  const s = [...numbers].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

const median = (numbers) => percentile(numbers, 0.5);

/**
 * Lines back into blocks of prose.
 *
 * Three signals, none of which works alone on a justified page.
 *
 * **A short line ends a paragraph.** This is the reliable one. Justified text
 * reaches the right margin on every line but the last, so a line that stops well
 * short of it is the end of something. Gaps alone are not enough: a heading set in
 * large type has line spacing wider than the gap between paragraphs, and splitting
 * on gaps alone broke "Strategy, tactics, and guiding principles" into three
 * paragraphs.
 *
 * **Tall lines are a heading.** Measured against the page's own type size taken low in the
 * distribution rather than at the middle of it, because the type size is your setting and a
 * fixed threshold would call every line a heading at one size and none at another.
 *
 * **A trailing hyphen is a broken word**, so it is rejoined without the hyphen. An
 * em dash, which this book writes as `--`, is not that, and is left alone.
 */
export function toBlocks(lines) {
  const body = lines.filter((l) => !isChrome(l) && l.text);
  if (!body.length) return [];

  const rightEdge = Math.max(...body.map((l) => l.right));
  // Whether "this line stops short" means anything at all. On a justified page
  // almost every line reaches the margin, so one that does not is the end of a
  // paragraph. On a ragged page (a list, a heading, verse) most lines stop short
  // and the rule would break every line into a paragraph of its own.
  const reaching = body.filter((l) => l.right >= rightEdge - 0.03).length;
  const justified = reaching / body.length > 0.6;
  const gapAfter = (i) => (i + 1 < body.length ? body[i].y - body[i + 1].y : Infinity);
  // The body's type size, taken low in the distribution rather than at the middle
  // of it. A chapter opens with three lines of large type over four of prose, and
  // the median of those seven is the heading: measured against itself, nothing is
  // a heading, and the title joins the first paragraph.
  const typical = percentile(body.map((l) => l.height), 0.3);
  const tall = (l) => l.height > typical * 1.35;

  /**
   * A tall line in the middle of a sentence is not a heading.
   *
   * Height alone is not the clean signal it looks like. Vision's box is drawn around
   * the glyphs it found, so a line of ordinary prose measures taller for containing
   * a digit, a bracket or a run of ascenders; measured on one real page of this
   * book, thirty lines of a single unbroken passage ranged from 0.99x to 1.40x of
   * the same body type, and the two that crossed 1.35x did so for carrying "114" and
   * "ff". Both were set as headings, mid-sentence, in the middle of the paragraph
   * they belonged to: "mathematically tractable.114 This works well" arrived in
   * large bold type between the two halves of its own sentence.
   *
   * So the question asked of a tall line is whether a heading could *begin* there at
   * all. A heading never interrupts a sentence, which makes the line before it the
   * evidence: prose that has not finished carries on, and nothing starts a heading
   * in lower case. Raising the height threshold instead was the other option and the
   * worse one, because the noise here reaches 1.40x and a real chapter title is not
   * reliably above that.
   *
   * Asked only of the line that would *start* one, which is why this runs forward
   * over what it has already decided rather than over the raw heights. "Strategy,
   * tactics, and guiding principles" is three tall lines, and the second and third
   * are lower case following a line that ends in a comma: judged on their own they
   * are continuations, which is exactly what they are, of a heading rather than of a
   * paragraph. A heading already under way simply runs on.
   */
  const finished = (l) => /[.!?:;”’"')\]]$/.test(l.text.trim());
  const heads = [];
  for (let i = 0; i < body.length; i += 1) {
    const l = body[i];
    if (!tall(l)) heads.push(false);
    else if (i === 0 || heads[i - 1]) heads.push(true);
    else heads.push(finished(body[i - 1]) && !/^[a-z]/.test(l.text.trim()));
  }
  const isHeading = (i) => heads[i] ?? false;

  // Per kind, because line spacing follows type size: a heading's lines sit further
  // apart than a paragraph's, and one threshold for both splits every heading into
  // one block per line, which is what it did to "Strategy, tactics, and guiding
  // principles".
  const gapsOfKind = (heading) =>
    body
      .slice(0, -1)
      .map((l, i) => (isHeading(i) === heading && isHeading(i + 1) === heading ? gapAfter(i) : null))
      .filter((g) => g !== null && Number.isFinite(g));
  const typicalGapFor = { heading: median(gapsOfKind(true)), para: median(gapsOfKind(false)) };
  const blocks = [];
  let current = [];
  let kind = null;

  const flush = () => {
    if (!current.length) return;
    let text = '';
    for (const line of current) {
      if (!text) text = line.text;
      else if (/(?<!-)-$/.test(text)) text = text.slice(0, -1) + line.text;
      else text += ' ' + line.text;
    }
    if (text.trim()) blocks.push({ type: kind, text: text.trim() });
    current = [];
  };

  for (let i = 0; i < body.length; i += 1) {
    const line = body[i];
    const thisKind = isHeading(i) ? 'heading' : 'para';
    if (kind && thisKind !== kind) flush();
    kind = thisKind;
    current.push(line);
    // The short-line rule is about justified prose and only about that. A heading
    // is ragged by design, so applying it there breaks a three-line title into
    // three titles, and a threshold this loose does the same to a bulleted list.
    const short = justified && kind === 'para' && line.right < rightEdge - 0.1;
    const spacing = typicalGapFor[kind];
    const wideGap = spacing > 0 && gapAfter(i) > spacing * 1.6;
    if (short || wideGap) flush();
  }
  flush();
  return blocks;
}

/** The same thing, as plain strings, for anything that only wants the words. */
export function toParagraphs(lines) {
  return toBlocks(lines).map((b) => b.text);
}

/** Below this a line is doubted rather than trusted. */
export const WEAK_LINE = 0.6;

/** Everything, from an image to something you can read. */
export async function pageText(jpeg, opts) {
  const started = Date.now();
  const observations = await recognizeBuffer(jpeg, opts);
  const lines = toLines(observations);
  const blocks = toBlocks(lines);
  const confidences = lines.filter((l) => !isChrome(l)).map((l) => l.conf).sort((a, b) => a - b);
  const median = confidences.length ? confidences[Math.floor(confidences.length / 2)] : null;
  const weak = confidences.length
    ? confidences.filter((c) => c < WEAK_LINE).length / confidences.length
    : 0;
  return {
    blocks,
    paragraphs: blocks.map((b) => b.text),
    lines: lines.length,
    // Reported rather than hidden. This is a reading of a picture, and how sure the
    // reading was is the one number that says whether to go and look at the page.
    //
    // The typical line, not the worst one. Taking the minimum let a single line
    // condemn a page that was otherwise perfect, and on real pages it did: the page
    // this was found on read eleven lines, nine of them at 1.00, and scored 0.50
    // because Vision was unsure of the arrow glyphs in `comparing -> compiling ->`.
    // The words were right. The reader showed the picture anyway.
    confidence: median,
    // The minimum is still worth having, just not worth deciding on alone.
    worst: confidences.length ? confidences[0] : null,
    // How much of the page is shaky, which is the thing "should I look at the page
    // myself" actually turns on.
    weak,
    ms: Date.now() - started,
  };
}
