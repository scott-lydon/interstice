// TC-010, applied to the gate added for TC-008. A check that cannot fail when the thing it guards
// is broken is worse than no check, because it reads as evidence. So the detector is pinned in
// both directions: it must flag the shapes it exists for, and it must stay quiet on the ones it
// deliberately does not, or the first false positive gets it deleted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findLiterals } from '../scripts/literal-detector.mjs';

const kinds = (src) => findLiterals(src, 'probe.js').map((f) => `${f.kind}:${f.line}`);

test('a date re-typed from a fixture is flagged', () => {
  assert.deepEqual(
    kinds(["const fixture = { day: '2026-08-19' };", "assert.equal(body.day, '2026-08-19');"].join('\n')),
    ['date:2']
  );
});

test('a date that exists only in the assertion is left alone', () => {
  // Deriving it would mean restating the date arithmetic under test, which is how an assertion
  // stops being able to fail. A block started at 23:50 on the 19th completing on the 20th is
  // exactly that shape.
  const src = ["const base = Date.parse('2026-08-19T23:50:00-07:00');", "assert.equal(out[0].day, '2026-08-20');"].join('\n');
  assert.deepEqual(kinds(src), []);
});

test('a count of two or more against a size is flagged, and zero and one are not', () => {
  assert.deepEqual(kinds('assert.equal(rows.length, 3);'), ['count:1']);
  assert.deepEqual(kinds('assert.equal(pages.size, 9);'), ['count:1']);
  assert.deepEqual(kinds('assert.equal(seen.length, 0);\nassert.equal(out.length, 1);'), []);
});

test('a protocol constant is not a fixture count', () => {
  assert.deepEqual(kinds('assert.equal(res.status, 200);\nassert.equal(attack.status, 403);'), []);
});

test('a literal derived from the fixture passes, which is the fix the gate asks for', () => {
  assert.deepEqual(kinds('assert.equal(records.length, targets.length);\nassert.equal(day, DAY);'), []);
});

test('a marked literal is exempt, including from further up its comment block', () => {
  const src = [
    '// literal-ok: 64 is the specification, 32 random bytes rendered as hex.',
    "assert.equal(token.length, 64);",
  ].join('\n');
  assert.deepEqual(kinds(src), []);
  const block = [
    '// literal-ok: two paragraphs is the assertion itself.',
    '// There is nothing in the fixture to derive it from.',
    'assert.equal(blocks.length, 2);',
  ].join('\n');
  assert.deepEqual(kinds(block), []);
});

test('arguments are split at the top level, not by the first comma it sees', () => {
  // A regex over the arguments misreads every assertion containing an object, an array, or a
  // comma inside a string, all of which this suite has, and a gate that misreads its input is
  // worse than no gate.
  assert.deepEqual(kinds("assert.deepEqual(parse('a, b', { max: 3 }), ['a', 'b']);"), []);
  assert.deepEqual(kinds("assert.equal(parse('a, b', { max: 3 }).length, 2);"), ['count:1']);
});
