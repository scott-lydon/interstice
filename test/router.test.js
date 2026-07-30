import test from 'node:test';
import assert from 'node:assert/strict';
import { choose, advance, DECLINE } from '../lib/router.js';

const config = {
  arm: 25,
  mid: 180,
  long: 720,
  cooldown: 90,
  idleVetoMs: 4000,
  ladder: ['flashcards', 'reading', 'queue_prompt', 'todo'],
  originApps: ['Claude', 'Ghostty'],
  anki: { midRungMinDue: 15 },
  quietHours: null,
};

const base = {
  now: 1_000_000,
  ankiDue: 32,
  bookInProgress: true,
  idleMs: 30_000,
  frontmostApp: 'Claude',
  current: null,
  stoodDown: false,
  cooldownUntil: 0,
  todoAvailable: true,
};

const at = (elapsed, over = {}) => choose({ elapsed, state: { ...base, ...over }, config });

test('holds below the arm threshold', () => {
  assert.equal(at(24).action, 'hold');
  assert.equal(at(24).reason, DECLINE.BELOW_THRESHOLD);
  assert.equal(at(0).action, 'hold');
});

test('delivers the top rung with work at the threshold', () => {
  const r = at(25);
  assert.equal(r.action, 'deliver');
  assert.equal(r.rung, 'flashcards');
});

test('falls through an empty deck instead of delivering into nothing', () => {
  const r = at(25, { ankiDue: 0 });
  assert.equal(r.rung, 'reading');
});

test('an unreachable Anki is not the same as an empty deck, but is still skipped', () => {
  assert.equal(at(25, { ankiDue: null }).rung, 'reading');
  assert.equal(at(25, { ankiDue: null, bookInProgress: false }).rung, 'queue_prompt');
});

test('falls all the way to queue_prompt when nothing above has work', () => {
  assert.equal(at(25, { ankiDue: 0, bookInProgress: false }).rung, 'queue_prompt');
});

test('holds when every rung is unavailable', () => {
  const r = at(25, {
    ankiDue: 0,
    bookInProgress: false,
    todoAvailable: false,
  });
  // queue_prompt is always available, so force it out of the ladder to test the floor
  const narrow = choose({
    elapsed: 25,
    state: { ...base, ankiDue: 0, bookInProgress: false },
    config: { ...config, ladder: ['flashcards', 'reading'] },
  });
  assert.equal(r.action, 'deliver');
  assert.equal(narrow.action, 'hold');
  assert.equal(narrow.reason, DECLINE.NOTHING_AVAILABLE);
});

test('idle veto blocks delivery when you are still typing', () => {
  const r = at(25, { idleMs: 500 });
  assert.equal(r.action, 'hold');
  assert.equal(r.reason, DECLINE.IDLE_VETO);
});

test('delivery is blocked when you already left for an unrelated app', () => {
  const r = at(25, { frontmostApp: 'Safari' });
  assert.equal(r.action, 'hold');
  assert.equal(r.reason, DECLINE.WRONG_APP);
});

test('cooldown suppresses delivery after a recent reclaim', () => {
  const r = at(25, { cooldownUntil: base.now + 5000 });
  assert.equal(r.reason, DECLINE.COOLDOWN);
});

test('stand down suppresses everything', () => {
  assert.equal(at(900, { stoodDown: true }).reason, DECLINE.STOOD_DOWN);
});

test('does not switch you off a deck that still has work', () => {
  const r = at(200, { current: 'flashcards', ankiDue: 30 });
  assert.equal(r.action, 'hold');
  assert.equal(r.reason, DECLINE.ALREADY_THERE);
});

test('escalates at the mid threshold once the deck runs dry', () => {
  const r = at(200, { current: 'flashcards', ankiDue: 3 });
  assert.equal(r.action, 'deliver');
  assert.equal(r.rung, 'reading');
});

test('does not escalate between thresholds even when the rung is dry', () => {
  const r = at(100, { current: 'flashcards', ankiDue: 0 });
  assert.equal(r.action, 'hold');
  assert.equal(r.reason, DECLINE.ALREADY_THERE);
});

test('escalates past a missing book to the next available rung', () => {
  const r = at(200, { current: 'flashcards', ankiDue: 0, bookInProgress: false });
  assert.equal(r.rung, 'queue_prompt');
});

test('long threshold escalates from queue_prompt', () => {
  const r = at(800, { current: 'queue_prompt' });
  assert.equal(r.action, 'deliver');
  assert.equal(r.rung, 'todo');
});

test('guards are not re-applied once you are already in an activity', () => {
  // Frontmost is Anki and your hands are busy; escalation must still work.
  const r = at(200, { current: 'flashcards', ankiDue: 1, frontmostApp: 'Anki', idleMs: 100 });
  assert.equal(r.action, 'deliver');
  assert.equal(r.rung, 'reading');
});

test('quiet hours suppress delivery when configured', () => {
  const night = { ...config, quietHours: { start: 0, end: 6 } };
  const at2am = new Date('2026-07-30T02:00:00').getTime();
  const r = choose({ elapsed: 60, state: { ...base, now: at2am }, config: night });
  assert.equal(r.reason, DECLINE.QUIET_HOURS);
  const noon = new Date('2026-07-30T12:00:00').getTime();
  assert.equal(choose({ elapsed: 60, state: { ...base, now: noon }, config: night }).action, 'deliver');
});

test('quiet hours wrapping midnight are handled', () => {
  const night = { ...config, quietHours: { start: 22, end: 6 } };
  const t = (h) => new Date(`2026-07-30T${String(h).padStart(2, '0')}:30:00`).getTime();
  assert.equal(choose({ elapsed: 60, state: { ...base, now: t(23) }, config: night }).reason, DECLINE.QUIET_HOURS);
  assert.equal(choose({ elapsed: 60, state: { ...base, now: t(3) }, config: night }).reason, DECLINE.QUIET_HOURS);
  assert.equal(choose({ elapsed: 60, state: { ...base, now: t(12) }, config: night }).action, 'deliver');
});

test('the router is pure: identical input gives identical output', () => {
  const a = at(200, { current: 'flashcards', ankiDue: 2 });
  const b = at(200, { current: 'flashcards', ankiDue: 2 });
  assert.deepEqual(a, b);
});

test('the router never returns a list of options', () => {
  for (const elapsed of [0, 25, 100, 200, 800, 5000]) {
    const r = at(elapsed);
    assert.ok(!Array.isArray(r.rung), 'rung must be a single value');
    assert.ok(!('options' in r) && !('choices' in r), 'no menus');
  }
});

test('property: a delivered rung always has work available', () => {
  let checked = 0;
  const bools = [true, false];
  for (const ankiDue of [null, 0, 1, 14, 15, 40]) {
    for (const bookInProgress of bools) {
      for (const todoAvailable of bools) {
        for (const current of [null, 'flashcards', 'reading', 'queue_prompt', 'todo']) {
          for (const elapsed of [25, 200, 800]) {
            const state = { ...base, ankiDue, bookInProgress, todoAvailable, current };
            const r = choose({ elapsed, state, config });
            if (r.action !== 'deliver') continue;
            checked += 1;
            if (r.rung === 'flashcards') assert.ok((ankiDue ?? 0) > 0, 'never an empty deck');
            if (r.rung === 'reading') assert.ok(bookInProgress, 'never a missing book');
            assert.notEqual(r.rung, current, 'never re-delivers the rung you are already in');
          }
        }
      }
    }
  }
  assert.ok(checked > 20, `expected many delivery cases, saw ${checked}`);
});

test('advance moves to the next rung and wraps', () => {
  assert.equal(advance({ state: { ...base, current: 'flashcards' }, config }).rung, 'reading');
  assert.equal(advance({ state: { ...base, current: 'reading' }, config }).rung, 'queue_prompt');
  assert.equal(advance({ state: { ...base, current: 'todo' }, config }).rung, 'flashcards');
});

test('advance skips rungs with no work', () => {
  const r = advance({ state: { ...base, current: 'flashcards', bookInProgress: false }, config });
  assert.equal(r.rung, 'queue_prompt');
});

test('advance ignores thresholds, cooldown and guards because it is deliberate', () => {
  const r = advance({
    state: { ...base, current: 'flashcards', cooldownUntil: base.now + 99999, idleMs: 0, frontmostApp: 'Safari' },
    config,
  });
  assert.equal(r.action, 'deliver');
});

test('advance never returns the rung you are already in', () => {
  for (const current of config.ladder) {
    const r = advance({ state: { ...base, current }, config });
    if (r.action === 'deliver') assert.notEqual(r.rung, current);
  }
});
