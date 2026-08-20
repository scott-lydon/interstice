import test from 'node:test';
import assert from 'node:assert/strict';
import { createMachine } from '../lib/focus/blocks.js';

// The block state machine, pure and testable. One star per unbroken block; a break
// forfeits the block (S2). These cover the required cases: exact-25 completion, 24m59s forfeiture,
// break at t=0, break at t=24m59s, back-to-back blocks, and two breaks in the same millisecond.

const OFF = '-07:00';
function at(msFromBase, base = Date.parse(`2026-08-19T09:00:00${OFF}`)) {
  return new Date(base + msFromBase).toISOString().replace('.000Z', 'Z');
}
const MIN = 60_000;

test('exactly 25 minutes completes a block, once', () => {
  const m = createMachine({ blockMinutes: 25 });
  assert.deepEqual(m.send({ type: 'start', at: at(0) }), []);
  assert.deepEqual(m.send({ type: 'tick', at: at(24 * MIN) }), [], 'not yet at 25');
  const out = m.send({ type: 'tick', at: at(25 * MIN) });
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'blockCompleted');
  assert.equal(out[0].startedAt, at(0));
  assert.equal(out[0].endedAt, at(25 * MIN));
});

test('24m59s then a break forfeits, earning no star', () => {
  const m = createMachine({ blockMinutes: 25 });
  m.send({ type: 'start', at: at(0) });
  m.send({ type: 'tick', at: at(24 * MIN + 59_000) });
  const out = m.send({ type: 'break', cause: 'app', at: at(24 * MIN + 59_000) });
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'blockForfeited');
  assert.equal(out[0].cause, 'app');
  assert.equal(out[0].elapsedMs, 24 * MIN + 59_000);
});

test('a break at t=0 forfeits with zero elapsed', () => {
  const m = createMachine({ blockMinutes: 25 });
  m.send({ type: 'start', at: at(0) });
  const out = m.send({ type: 'break', cause: 'lock', at: at(0) });
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'blockForfeited');
  assert.equal(out[0].elapsedMs, 0);
});

test('a break one millisecond before completion still forfeits', () => {
  const m = createMachine({ blockMinutes: 25 });
  m.send({ type: 'start', at: at(0) });
  const out = m.send({ type: 'break', cause: 'video', at: at(25 * MIN - 1) });
  assert.equal(out[0].type, 'blockForfeited');
  assert.equal(out[0].elapsedMs, 25 * MIN - 1);
});

test('back-to-back blocks earn consecutive stars from an unbroken run', () => {
  const m = createMachine({ blockMinutes: 25 });
  m.send({ type: 'start', at: at(0) });
  const first = m.send({ type: 'tick', at: at(25 * MIN) });
  assert.equal(first[0].type, 'blockCompleted');
  // the machine re-armed at t=25m; another 25 minutes completes a second block with no restart
  const second = m.send({ type: 'tick', at: at(50 * MIN) });
  assert.equal(second.length, 1);
  assert.equal(second[0].type, 'blockCompleted');
  assert.equal(second[0].startedAt, at(25 * MIN));
  assert.equal(second[0].endedAt, at(50 * MIN));
});

test('two breaks in the same millisecond forfeit once, then no-op', () => {
  const m = createMachine({ blockMinutes: 25 });
  m.send({ type: 'start', at: at(0) });
  const first = m.send({ type: 'break', cause: 'app', at: at(10 * MIN) });
  assert.equal(first.length, 1, 'the first break forfeits');
  const second = m.send({ type: 'break', cause: 'lock', at: at(10 * MIN) });
  assert.deepEqual(second, [], 'a break with no block in progress emits nothing');
});

test('a completed block records the local calendar day it completed on', () => {
  const m = createMachine({ blockMinutes: 25 });
  // start before local midnight, complete after: credited to the day it completed (S5)
  const base = Date.parse(`2026-08-19T23:50:00${OFF}`);
  m.send({ type: 'start', at: at(0, base) });
  const out = m.send({ type: 'tick', at: at(25 * MIN, base) });
  assert.equal(out[0].type, 'blockCompleted');
  assert.equal(out[0].day, '2026-08-20', 'a block spanning midnight is credited to the completion day');
});
