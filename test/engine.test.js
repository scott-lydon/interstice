import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Engine } from '../lib/engine.js';

const config = {
  arm: 25,
  mid: 180,
  long: 720,
  cooldown: 90,
  idleVetoMs: 4000,
  ladder: ['flashcards', 'reading', 'queue_prompt', 'todo'],
  originApps: ['Claude', 'Ghostty'],
  anki: { midRungMinDue: 15 },
  reading: { app: 'Kindle' },
  quietHours: null,
  notifications: false,
};

/** A controllable clock and timer queue so a 12 minute gap takes microseconds. */
function harness(stateOverrides = {}) {
  let clock = 1_000_000;
  const queue = [];
  const delivered = [];
  const reclaimed = [];

  const engine = new Engine({
    config,
    persist: false,
    now: () => clock,
    setTimer: (fn, ms) => {
      const entry = { at: clock + ms, fn, cancelled: false };
      queue.push(entry);
      return entry;
    },
    clearTimer: (t) => {
      if (t) t.cancelled = true;
    },
    getState: async () => ({
      now: clock,
      ankiDue: 32,
      bookInProgress: true,
      idleMs: 30_000,
      frontmostApp: 'Claude',
      todoAvailable: true,
      ...stateOverrides,
    }),
    doDeliver: async (rung) => {
      delivered.push(rung);
      return { ok: true, detail: { rung } };
    },
    doReclaim: async ({ reason }) => {
      reclaimed.push(reason);
      return { app: 'Claude', reason };
    },
  });

  /** Advance the clock, firing due timers in order. */
  async function tick(seconds) {
    const target = clock + seconds * 1000;
    for (;;) {
      const due = queue
        .filter((e) => !e.cancelled && e.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.cancelled = true;
      clock = due.at;
      await due.fn();
      await new Promise((r) => setImmediate(r));
    }
    clock = target;
    await new Promise((r) => setImmediate(r));
  }

  return { engine, tick, delivered, reclaimed, now: () => clock, setState: (o) => Object.assign(stateOverrides, o) };
}

test('a short turn delivers nothing', async () => {
  const h = harness();
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(10);
  await h.engine.onEnd({ reason: 'complete' });
  assert.deepEqual(h.delivered, []);
  assert.deepEqual(h.reclaimed, [], 'nothing to reclaim if nothing was delivered');
});

test('a qualifying gap delivers exactly one activity', async () => {
  const h = harness();
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(30);
  assert.deepEqual(h.delivered, ['flashcards']);
});

test('does not escalate while the current rung still has work', async () => {
  const h = harness();
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(800);
  assert.deepEqual(h.delivered, ['flashcards'], 'deck never ran dry, so no churn');
});

test('escalates through the ladder as rungs run dry', async () => {
  const h = harness();
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(30);
  h.setState({ ankiDue: 2 });
  await h.tick(200);
  assert.deepEqual(h.delivered, ['flashcards', 'reading']);
});

test('reclaims and records the gap on end', async () => {
  const h = harness();
  const closes = [];
  h.engine.on('gap:close', (r) => closes.push(r));
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(120);
  await h.engine.onEnd({ reason: 'permission' });
  assert.deepEqual(h.reclaimed, ['permission']);
  assert.equal(closes.length, 1);
  assert.equal(closes[0].durationSec, 120);
  assert.equal(closes[0].finalRung, 'flashcards');
  assert.equal(closes[0].endReason, 'permission');
});

test('cooldown suppresses the next gap, then expires', async () => {
  const h = harness();
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(60);
  await h.engine.onEnd({ reason: 'complete' });
  assert.equal(h.delivered.length, 1);

  h.engine.onSubmit({ surface: 'cowork' }); // immediately after
  await h.tick(30);
  assert.equal(h.delivered.length, 1, 'still in cooldown');
  await h.engine.onEnd({ reason: 'complete' });

  await h.tick(120); // let cooldown lapse
  const beforeLapse = h.delivered.length;
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(30);
  assert.equal(h.delivered.length, beforeLapse + 1, 'cooldown expired');
});

test('cooldown is not set when nothing was delivered', async () => {
  const h = harness();
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(5);
  await h.engine.onEnd({ reason: 'complete' });
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(30);
  assert.deepEqual(h.delivered, ['flashcards'], 'a short quiet turn must not suppress the next gap');
});

test('a second submit extends the open gap instead of starting a rival', async () => {
  const h = harness();
  const g1 = h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(5);
  const g2 = h.engine.onSubmit({ surface: 'cowork' });
  assert.equal(g1.id, g2.id);
  assert.equal(g2.submits, 2);
  const rec = (await h.tick(30), await h.engine.onEnd({ reason: 'complete' }));
  assert.equal(rec.submits, 2);
});

test('idle veto blocks delivery and is counted', async () => {
  const h = harness({ idleMs: 200 });
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(30);
  assert.deepEqual(h.delivered, []);
  assert.equal(h.engine.status.counters.vetoed, 1);
});

test('stand down stops routing for the rest of the gap', async () => {
  const h = harness();
  h.engine.onSubmit({ surface: 'cowork' });
  h.engine.standDown();
  await h.tick(800);
  assert.deepEqual(h.delivered, []);
});

test('stand down for the day survives across gaps and expires next day', async () => {
  const h = harness();
  h.engine.standDown({ forDay: true });
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(60);
  assert.deepEqual(h.delivered, []);
  await h.engine.onEnd({ reason: 'complete' });

  await h.tick(60 * 60 * 26); // next calendar day
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(30);
  assert.deepEqual(h.delivered, ['flashcards'], 'day-long stand down expires with the date');
});

test('advance moves down the ladder on demand', async () => {
  const h = harness();
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(30);
  const r = await h.engine.advance();
  assert.equal(r.ok, true);
  assert.equal(r.rung, 'reading');
  assert.deepEqual(h.delivered, ['flashcards', 'reading']);
});

test('advance with no open gap is a no-op, not a crash', async () => {
  const h = harness();
  const r = await h.engine.advance();
  assert.equal(r.ok, false);
});

test('a failing actuator falls through to the next rung', async () => {
  // The realistic case: App Nap has suspended Anki, so guiDeckReview throws at the
  // exact moment we need it. You must still end up somewhere, not nowhere.
  const h = harness();
  const attempted = [];
  h.engine.doDeliver = async (rung) => {
    attempted.push(rung);
    if (rung === 'flashcards') throw new Error('AnkiConnect timed out (App Nap?)');
    return { ok: true, detail: { rung } };
  };

  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(30); // crosses the arm threshold, fires the real timer path

  assert.deepEqual(attempted, ['flashcards', 'reading'], 'tried the top rung, then fell through');
  assert.equal(h.engine.status.gap.current, 'reading', 'you end up somewhere');
});

test('an actuator failure is recorded, not swallowed', async () => {
  const h = harness();
  const logs = [];
  h.engine.on('log', (r) => logs.push(r));
  h.engine.doDeliver = async (rung) => {
    if (rung === 'flashcards') throw new Error('boom');
    return { ok: true };
  };
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(30);
  const failure = logs.find((l) => l.kind === 'deliver_failed');
  assert.ok(failure, 'the failure must appear in the log');
  assert.equal(failure.rung, 'flashcards');
  assert.match(failure.error, /boom/);
});

test('timers are cleared when the gap closes so nothing fires late', async () => {
  const h = harness();
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(5);
  await h.engine.onEnd({ reason: 'complete' });
  await h.tick(2000);
  assert.deepEqual(h.delivered, [], 'no delivery after the gap closed');
});

test('status reports an accurate open gap', async () => {
  const h = harness();
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(30);
  const s = h.engine.status;
  assert.equal(s.open, true);
  assert.equal(s.gap.current, 'flashcards');
  assert.equal(s.gap.elapsed, 30);
  assert.equal(s.counters.delivered, 1);
});

test('synthetic gaps are tagged so they can be excluded from statistics', async () => {
  const h = harness();
  h.engine.onSubmit({ surface: 'cowork', synthetic: true });
  await h.tick(30);
  const rec = await h.engine.onEnd({ reason: 'complete' });
  assert.equal(rec.synthetic, true);
});

test('an idle veto retries shortly after, because it is transient', async () => {
  // You were mid-keystroke at the threshold, then you stop. Waiting until the
  // next declared threshold to look again throws away a catchable gap.
  const h = harness({ idleMs: 200 });
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(30);
  assert.deepEqual(h.delivered, [], 'vetoed at the threshold');

  h.setState({ idleMs: 30_000 }); // your hands come off the keyboard
  await h.tick(20);
  assert.deepEqual(h.delivered, ['flashcards'], 'retry caught the gap');
});

test('veto retries are bounded, not an infinite poll', async () => {
  const h = harness({ idleMs: 100 }); // never goes idle
  const logs = [];
  h.engine.on('log', (r) => logs.push(r));
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(300);
  const scheduled = logs.filter((l) => l.kind === 'retry_scheduled');
  assert.ok(scheduled.length <= 4, `expected at most 4 retries, saw ${scheduled.length}`);
  assert.deepEqual(h.delivered, []);
});

test('leaving for another app does NOT trigger retries', async () => {
  // wrong_app means you already went somewhere else. Chasing you there is the
  // interruption this whole system exists to avoid.
  const h = harness({ frontmostApp: 'Safari' });
  const logs = [];
  h.engine.on('log', (r) => logs.push(r));
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(120);
  assert.equal(logs.filter((l) => l.kind === 'retry_scheduled').length, 0);
  assert.deepEqual(h.delivered, []);
});

test('the retry counter resets between gaps', async () => {
  const h = harness({ idleMs: 100 });
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(120);
  await h.engine.onEnd({ reason: 'complete' });

  h.setState({ idleMs: 30_000 });
  h.engine.onSubmit({ surface: 'cowork' });
  await h.tick(30);
  assert.deepEqual(h.delivered, ['flashcards'], 'a fresh gap is not penalised by the last one');
});

test('a day-long stand down lasts until local midnight, not until UTC midnight', async () => {
  // The regression: #dayKey used toISOString(), which is UTC, so west of Greenwich a stand down
  // asked for "the rest of today" expired in the early evening and the router came back. The
  // focus tracker already had the same lesson written down for which day a star belongs to.
  const engineSrc = fs.readFileSync(new URL('../lib/engine.js', import.meta.url), 'utf8');
  assert.match(engineSrc, /localISO/, 'the day key must carry the local offset');
  assert.doesNotMatch(
    engineSrc.slice(engineSrc.indexOf('#dayKey'), engineSrc.indexOf('#dayKey') + 400),
    /toISOString/,
    'a UTC day key is exactly the bug this pins'
  );

  // And the key it produces is the local date, at an hour where UTC has already rolled over.
  const { localISO } = await import('../lib/focus/tracker.js');
  const lateEvening = new Date(2026, 7, 19, 23, 30, 0);
  assert.equal(localISO(lateEvening).slice(0, 10), '2026-08-19');
  assert.notEqual(localISO(lateEvening).slice(0, 10), lateEvening.toISOString().slice(0, 10));
});
