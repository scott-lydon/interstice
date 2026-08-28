#!/usr/bin/env node
// A pre-commit and CI gate over the assertion side of the test suite.
//
// The failure it exists to stop is quiet. An assertion written as `assert.equal(out.length, 1)`
// is a claim about the fixture, not about the code, and the moment somebody adds a second row to
// the fixture the test fails for a reason that has nothing to do with the behaviour under test.
// A date re-typed on the assertion side is worse: it duplicates a value the fixture already
// states, so the two drift independently and the test that was meant to pin the behaviour ends up
// pinning a typo. `assert.equal(out.length, fixture.length)` and `assert.equal(day, DAY)` say the
// same things and stay true when the fixture moves.
//
// Two shapes are flagged, and both are drawn narrowly on purpose, because a gate that cries wolf
// is a gate somebody turns off:
//
//   date   a `YYYY-MM`, `YYYY-MM-DD`, or ISO stamp on the expected side WHOSE EXACT TEXT ALSO
//          APPEARS ON A NON-ASSERTION LINE OF THE SAME FILE. That second occurrence is the
//          fixture, and the assertion is a transcription of it, which is the pair that drifts.
//          A date that appears only in the assertion is the opposite case: in
//          `assert.equal(out[0].day, '2026-08-20')` against a block started at 23:50 on the
//          19th, the literal IS the specification, and deriving it from the fixture would mean
//          restating the very date arithmetic under test, which is how a test stops being able
//          to fail.
//   count  an integer of 2 or more on the expected side of a comparison whose actual side is a
//          size (`.length`, `.size`, or a name like `count`). 0 and 1 are shapes rather than
//          counts, they say "nothing came out" and "exactly one thing came out", and they do not
//          become wrong the way the rule describes when a fixture gains a row. 2 and up almost
//          always transcribe how many entries somebody typed into the array above, and that is
//          the number that goes stale. A bare `assert.equal(res.status, 200)` is a protocol
//          constant rather than a size, and is left alone.
//
// The escape hatch is a `literal-ok:` comment on the line or the line above, with a reason. Some
// literals genuinely are the point of the test, and those should be marked and readable rather
// than silently exempt.
//
// Usage:
//   node scripts/literal-detector.mjs            every test file in the repo
//   node scripts/literal-detector.mjs <files>    only these (what the pre-commit hook passes)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSERTIONS = /assert\.(?:equal|strictEqual|deepEqual|deepStrictEqual|notEqual)\s*\(/g;
const DATE = /^(['"])\d{4}-\d{2}(-\d{2}([T ][\d:.]+([+-]\d{2}:?\d{2}|Z)?)?)?\1$/;
const COUNT = /^\d+$/;
const SIZE = /\.length\b|\.size\b|\bcount\b|\bCount\b/;
const ALLOW = /literal-ok:/;

/**
 * Split the argument list that starts at `open` (the index of the `(`) into top-level arguments.
 *
 * A regex on the arguments would get this wrong the first time an assertion contains an object,
 * an array, or a comma inside a string, all of which this suite does, and a gate that misreads
 * its input is worse than no gate.
 */
function splitArgs(src, open) {
  const args = [];
  let depth = 0;
  let quote = null;
  let start = open + 1;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth += 1; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) { args.push(src.slice(start, i)); return args; }
      continue;
    }
    if (c === ',' && depth === 1) { args.push(src.slice(start, i)); start = i + 1; }
  }
  return null; // unbalanced, which the parser will complain about long before this gate does
}

/**
 * Which characters of the source are real code, as opposed to string or comment text.
 *
 * Without this, a file that quotes an assertion inside a string gets flagged for the quoted
 * text, which is exactly what this detector's own tests do and what any test asserting on source
 * would do. Template interpolations are treated as string too: that can only lose a finding,
 * never invent one, which is the right direction for a gate that blocks commits.
 */
function codeMask(src) {
  const mask = new Array(src.length).fill(true);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') mask[i++] = false;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      while (i < stop) mask[i++] = false;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      mask[i] = false;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { mask[i] = false; mask[i + 1] = false; i += 2; continue; }
        const done = src[i] === c;
        mask[i] = false;
        i += 1;
        if (done) break;
      }
      continue;
    }
    i += 1;
  }
  return mask;
}

/**
 * Whether the assertion on `line` carries a `literal-ok:` reason.
 *
 * The whole contiguous comment block above the assertion counts, not just the line immediately
 * above it, because a reason worth writing rarely fits on one line and a marker that has to be
 * the last word of the last line is a marker people put in the wrong place.
 */
function allowed(lines, line) {
  if (ALLOW.test(lines[line - 1] ?? '')) return true;
  for (let i = line - 2; i >= 0; i -= 1) {
    const text = (lines[i] ?? '').trim();
    if (!text.startsWith('//')) return false;
    if (ALLOW.test(text)) return true;
  }
  return false;
}

export function findLiterals(source, file) {
  const lines = source.split('\n');
  const lineOf = (index) => source.slice(0, index).split('\n').length;

  // Every line that carries an assertion, so "does this date also live in the fixture" can ignore
  // the assertions themselves and ask only about the lines that build the input.
  const isCode = codeMask(source);
  const assertions = [...source.matchAll(ASSERTIONS)].filter((m) => isCode[m.index]);
  const assertLines = new Set();
  for (const m of assertions) assertLines.add(lineOf(m.index));
  const inFixture = (literal) =>
    lines.some((text, i) => !assertLines.has(i + 1) && text.includes(literal));

  const found = [];
  for (const m of assertions) {
    const open = m.index + m[0].length - 1;
    const args = splitArgs(source, open);
    if (!args || args.length < 2) continue;
    const actual = args[0].trim();
    const expected = args[1].trim();
    const line = lineOf(m.index);
    if (allowed(lines, line)) continue;
    if (DATE.test(expected) && inFixture(expected)) {
      found.push({ file, line, kind: 'date', text: `${actual}, ${expected}` });
    } else if (COUNT.test(expected) && Number(expected) >= 2 && SIZE.test(actual)) {
      found.push({ file, line, kind: 'count', text: `${actual}, ${expected}` });
    }
  }
  return found;
}

function testFiles(argv) {
  if (argv.length) return argv.map((f) => path.resolve(ROOT, f));
  const dir = path.join(ROOT, 'test');
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(m?js|cjs)$/.test(f))
    .map((f) => path.join(dir, f));
}

function main() {
  const files = testFiles(process.argv.slice(2)).filter(
    (f) => fs.existsSync(f) && /(^|\/)test\//.test(f.replace(ROOT, ''))
  );
  const findings = files.flatMap((f) => findLiterals(fs.readFileSync(f, 'utf8'), path.relative(ROOT, f)));

  if (findings.length) {
    console.error(`\n${findings.length} bare literal${findings.length === 1 ? '' : 's'} on the assertion side:\n`);
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}  ${f.kind}  assert(${f.text})`);
    }
    console.error(
      '\nDerive the value from the fixture instead (a named constant for a date, `fixture.length` for\n' +
      'a count), or, when the literal IS the specification, mark it: // literal-ok: <why>\n'
    );
    process.exit(1);
}
console.log(`no bare literals in ${files.length} test files`);
}

// Importable for its own tests, executable as the gate. Without the guard, importing
// findLiterals would run the whole scan and exit the importing process.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
