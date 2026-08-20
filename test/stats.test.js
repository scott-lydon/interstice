// DI-006. lib/stats.js computes every figure the dashboard shows (gaps, delivered, minutes
// reclaimed, median and p90 turn, false-positive rate, stand-down rate, the rung bars) and no test
// in this tree loaded it. A wrong aggregate would therefore ship in silence, and the numbers on
// that page are the whole falsifiability claim the module's own header makes.
//
// The rule this is really pinning is the scripted-provider one: the /debug surface writes gaps
// tagged `synthetic: true`, and a debug surface that can inflate the statistics sitting beside it
// is worse than no statistics. So the headline assertion is that a scan of nothing but synthetic
// gaps aggregates to exactly zero while the rows are still there in the table.
//
// The fixtures are not invented shapes. `REAL_KEYS` and `REAL_DELIVERY_KEYS` below are asserted
// against the daemon's own logs/gaps.jsonl on this machine when it exists, so a fixture that
// drifted from what the engine actually writes fails here rather than passing against a fiction.
// Every fixture is written with `appendJsonl` and read back with `readJsonl`, the same path the
// routes use, rather than handed to `summarize` as an in-memory object the log never round-tripped.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { summarize, suggestThresholds, isFalsePositive } from '../lib/stats.js';
import { appendJsonl, readJsonl } from '../lib/logger.js';
import { GAPS_LOG } from '../lib/paths.js';

/** Every field the engine writes on a gap record, as observed in logs/gaps.jsonl. */
const REAL_KEYS = [
  'id', 'surface', 'sessionId', 'via', 'synthetic', 'submittedAt', 'endedAt',
  'durationSec', 'submits', 'delivered', 'finalRung', 'stoodDown', 'endReason',
];
/** And on one entry of `delivered`. `detail` varies by rung and is not read by stats.js. */
const REAL_DELIVERY_KEYS = ['rung', 'at', 'reason'];

/** A gap in the shape the engine writes, with the fields a test varies passed in. */
function gap({ id, surface = 'claude-code', synthetic = false, submittedAt, durationSec, delivered = null, stoodDown = false }) {
  return {
    id,
    surface,
    sessionId: 'unknown',
    via: 'hook',
    synthetic,
    submittedAt,
    endedAt: submittedAt + durationSec * 1000,
    durationSec,
    submits: 1,
    delivered,
    finalRung: delivered ? delivered[delivered.length - 1].rung : null,
    stoodDown,
    endReason: 'complete',
  };
}

const deliver = (rung, at) => ({ rung, at, reason: 'armed', detail: {} });

/**
 * Written and read back through the real log path, so the records under test have survived
 * JSON.stringify and JSON.parse exactly as the ones on disk have.
 */
function throughTheLog(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-stats-'));
  const file = path.join(dir, 'gaps.jsonl');
  for (const r of records) appendJsonl(file, r);
  return readJsonl(file);
}

test('the fixture shape is the shape the daemon actually writes', () => {
  const real = fs.existsSync(GAPS_LOG) ? readJsonl(GAPS_LOG) : [];
  if (!real.length) {
    // Nothing to check against on a fresh clone. Said out loud rather than passed off as checked.
    console.log('  (no logs/gaps.jsonl on this machine: the shape assertion below had nothing to compare against)');
    return;
  }
  for (const key of REAL_KEYS) {
    assert.ok(key in real[0], `the engine writes "${key}", so the fixture must carry it`);
  }
  for (const key of Object.keys(gap({ id: 'x', submittedAt: 0, durationSec: 1 }))) {
    assert.ok(REAL_KEYS.includes(key), `the fixture invents "${key}", which no real record carries`);
  }
  const withDelivery = real.find((r) => r.delivered?.length);
  if (withDelivery) {
    for (const key of REAL_DELIVERY_KEYS) {
      assert.ok(key in withDelivery.delivered[0], `a real delivery carries "${key}"`);
    }
  }
});

test('a scan of nothing but synthetic gaps aggregates to exactly zero, rows and all', () => {
  const written = [
    gap({ id: 's1', surface: 'debug', synthetic: true, submittedAt: 1_000_000, durationSec: 720, delivered: [deliver('flashcards', 1_000_500)] }),
    gap({ id: 's2', surface: 'debug', synthetic: true, submittedAt: 2_000_000, durationSec: 300, delivered: [deliver('reading', 2_000_500)] }),
    gap({ id: 's3', surface: 'debug', synthetic: true, submittedAt: 3_000_000, durationSec: 60, stoodDown: true }),
  ];
  const gaps = throughTheLog(written);
  const s = summarize(gaps, { arm: 25 });

  assert.equal(s.totals.gaps, 0, 'no synthetic gap is a gap');
  assert.equal(s.totals.minutesReclaimed, 0, 'and none of them reclaimed a minute');
  assert.equal(s.totals.delivered, 0);
  assert.equal(s.totals.deliveryRate, 0, 'a rate over zero gaps is zero, not NaN');
  assert.equal(s.totals.synthetic, written.length, 'they are counted as excluded rather than vanishing');
  assert.deepEqual(s.byRung, {}, 'a synthetic delivery never appears in the rung bars');
  assert.equal(s.quality.falsePositives, 0);
  assert.equal(s.quality.standDownRate, 0);
  assert.equal(s.duration.medianSec, 0);
  assert.deepEqual(s.bySurface, {}, 'and never in the per-surface counts');

  // The rows are still in the table below the tiles: excluded from the figures, not deleted.
  assert.equal(gaps.length, written.length);
});

test('the real log, if there is one, accounts for every record it holds', () => {
  const real = fs.existsSync(GAPS_LOG) ? readJsonl(GAPS_LOG) : [];
  if (!real.length) return;
  const s = summarize(real, { arm: 25 });
  assert.equal(
    s.totals.gaps + s.totals.synthetic,
    real.length,
    'every record on disk is either counted or explicitly excluded, never silently dropped'
  );
  assert.ok(s.totals.delivered <= s.totals.gaps, 'more deliveries than gaps would be a counting bug');
  assert.ok(s.duration.medianSec <= s.duration.p90Sec, 'the median cannot exceed the 90th percentile');
  assert.ok(s.duration.p90Sec <= s.duration.maxSec);
});

/**
 * One mixed scan, with every aggregate computed by hand in the comments so the expectation is
 * independent of the implementation rather than a copy of what it happened to return.
 */
test('every headline figure is the number it claims to be', () => {
  const gaps = throughTheLog([
    // 30s turn, delivered 10s in, ended 20s after the delivery: reclaimed 20s, not a false positive.
    gap({ id: 'g1', submittedAt: 1_000_000, durationSec: 30, delivered: [deliver('flashcards', 1_010_000)] }),
    // 60s turn on the other surface, two rungs, the last of them 5s before the end: a false positive.
    gap({ id: 'g2', surface: 'cowork', submittedAt: 2_000_000, durationSec: 60, delivered: [deliver('reading', 2_005_000), deliver('queue_prompt', 2_055_000)] }),
    // 10s turn, below the arm threshold, nothing delivered.
    gap({ id: 'g3', submittedAt: 3_000_000, durationSec: 10 }),
    // 300s turn, delivered 10s in and then stood down: reclaimed 290s, and a false positive.
    gap({ id: 'g4', submittedAt: 4_000_000, durationSec: 300, delivered: [deliver('todo', 4_010_000)], stoodDown: true }),
    // Synthetic, and large enough that including it would move every figure below.
    gap({ id: 's1', surface: 'debug', synthetic: true, submittedAt: 5_000_000, durationSec: 3600, delivered: [deliver('flashcards', 5_000_500)] }),
  ]);
  const s = summarize(gaps, { arm: 25 });

  assert.equal(s.totals.gaps, 4);
  assert.equal(s.totals.synthetic, 1);
  assert.equal(s.totals.delivered, 3);
  assert.equal(s.totals.deliveryRate, 0.75);
  // (20 + 55 + 290) seconds = 365s, which rounds to 6 minutes.
  assert.equal(s.totals.minutesReclaimed, 6);

  // Durations sorted: [10, 30, 60, 300]. The median index is floor(4 * 0.5) = 2, p90 is floor(4 * 0.9) = 3.
  assert.equal(s.duration.medianSec, 60);
  assert.equal(s.duration.p90Sec, 300);
  assert.equal(s.duration.maxSec, 300);
  assert.equal(s.duration.belowArm, 1, 'only the 10s turn is under the 25s arm threshold');

  assert.deepEqual(s.byRung, { flashcards: 1, reading: 1, queue_prompt: 1, todo: 1 },
    'both rungs of a two-delivery gap are counted, and the synthetic one is not');

  assert.equal(s.quality.falsePositives, 2, 'the stand-down and the delivery 5s before the end');
  assert.equal(s.quality.falsePositiveRate, 2 / 3, 'measured against deliveries, not against gaps');
  assert.equal(s.quality.standDowns, 1);
  assert.equal(s.quality.standDownRate, 0.25);

  assert.deepEqual(s.bySurface, { 'claude-code': 3, cowork: 1 });
});

test('a false positive is a delivery you rejected, and the window is what decides it', () => {
  const rejected = gap({ id: 'a', submittedAt: 0, durationSec: 30, delivered: [deliver('reading', 25_000)] });
  assert.equal(isFalsePositive(rejected), true, 'delivered 5s before the gap closed');
  assert.equal(isFalsePositive(rejected, { windowSec: 2 }), false, 'a narrower window says otherwise');

  const kept = gap({ id: 'b', submittedAt: 0, durationSec: 300, delivered: [deliver('reading', 10_000)] });
  assert.equal(isFalsePositive(kept), false);

  assert.equal(isFalsePositive(gap({ id: 'c', submittedAt: 0, durationSec: 30 })), false,
    'a gap with nothing delivered cannot be a false delivery');
  assert.equal(isFalsePositive(gap({ id: 'd', submittedAt: 0, durationSec: 300, delivered: [deliver('todo', 1000)], stoodDown: true })), true,
    'standing down rejects the delivery however long ago it arrived');
});

test('thresholds are suggested only from enough history, and never from synthetic gaps', () => {
  const gaps = throughTheLog([
    gap({ id: 'g1', submittedAt: 1_000_000, durationSec: 10 }),
    gap({ id: 'g2', submittedAt: 2_000_000, durationSec: 30 }),
    gap({ id: 'g3', submittedAt: 3_000_000, durationSec: 60 }),
    gap({ id: 'g4', submittedAt: 4_000_000, durationSec: 300 }),
    gap({ id: 's1', surface: 'debug', synthetic: true, submittedAt: 5_000_000, durationSec: 7200 }),
  ]);

  const thin = suggestThresholds(gaps);
  assert.equal(thin.enough, false, 'four turns is not a basis for changing anyone\'s thresholds');
  assert.equal(thin.sample, 4, 'and the synthetic 7200s turn is not one of the four');
  assert.equal(thin.needed, 50);

  // Sorted real durations [10, 30, 60, 300]; q(p) = durations[floor(4 * p)].
  const enough = suggestThresholds(gaps, { minSample: 3 });
  assert.equal(enough.enough, true);
  assert.equal(enough.sample, 4);
  assert.equal(enough.arm, 10, 'q(0.15) = 10s, rounded to 5s, floored at 10');
  assert.equal(enough.mid, 60, 'q(0.55) = 60s, rounded to 10s');
  assert.equal(enough.long, 300, 'q(0.85) = 300s, rounded to 30s');
});
