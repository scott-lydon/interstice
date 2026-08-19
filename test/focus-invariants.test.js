import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMachine } from '../lib/focus/blocks.js';
import { open } from '../lib/focus/store.js';

const OFF = '-07:00';
const MIN = 60_000;
function at(ms, base = Date.parse(`2026-08-19T09:00:00${OFF}`)) {
  return new Date(base + ms).toISOString().replace('.000Z', 'Z');
}

// 3.5: no idle breaker. A 25-minute block with zero input events still completes and awards a star.
test('a 25-minute block with zero input events still completes (no idle breaker)', () => {
  const m = createMachine({ blockMinutes: 25 });
  m.send({ type: 'start', at: at(0) });
  // no keyboard/mouse events, only the passage of time
  const out = m.send({ type: 'tick', at: at(25 * MIN) });
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'blockCompleted');
});

// 3.6: the machine imports no breaker; it is driven by a fake breaker to prove substitutability.
test('the machine accepts any breaker that emits the plain {cause,at,detail} shape', () => {
  const fakeBreaker = {
    name: () => 'fake',
    probe: () => ({ cause: 'made-up-cause', at: at(5 * MIN), detail: 'a substitute breaker' }),
  };
  const m = createMachine({ blockMinutes: 25 });
  m.send({ type: 'start', at: at(0) });
  const ev = fakeBreaker.probe();
  const out = m.send({ type: 'break', cause: ev.cause, at: ev.at });
  assert.equal(out[0].type, 'blockForfeited');
  assert.equal(out[0].cause, 'made-up-cause', 'the machine forfeits on any cause, knowing no breaker');
});

// 3.7: aggregation across a month boundary, a DST boundary, and a midnight-spanning block,
// each credited to the day it completed in America/Los_Angeles (its carried offset).
test('stars aggregate to the local completion day across month, DST, and midnight boundaries', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stars-')), 's.jsonl');
  const s = open(p);
  // month boundary: completes Sep 1 just after midnight PDT
  s.award({ startedAt: '2026-08-31T23:50:00-07:00', endedAt: '2026-09-01T00:15:00-07:00', day: '2026-09-01' });
  // DST fall-back night (Nov 1 2026, PDT -07:00 -> PST -08:00): a block completing in PST
  s.award({ startedAt: '2026-11-01T01:10:00-08:00', endedAt: '2026-11-01T01:35:00-08:00', day: '2026-11-01' });
  // midnight-spanning: starts Aug 19 late, completes Aug 20
  s.award({ startedAt: '2026-08-19T23:50:00-07:00', endedAt: '2026-08-20T00:15:00-07:00', day: '2026-08-20' });

  assert.equal(s.starsForMonth('2026-09').length, 1, 'the month-boundary star lands in September');
  assert.equal(s.starsForDay('2026-09-01').length, 1);
  assert.equal(s.starsForDay('2026-11-01').length, 1, 'the DST-night star lands on Nov 1');
  assert.equal(s.starsForDay('2026-08-20').length, 1, 'the midnight-spanning star lands on the completion day');
  assert.equal(s.starsForDay('2026-08-19').length, 0, 'and not on the day it started');
});
