import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatency } from '../lib/latency.js';

const t = (ms) => new Date(Date.parse('2026-08-19T09:00:00-07:00') + ms).toISOString();

test('elapsed grows while waiting and is null before a submit (5.1)', () => {
  const l = createLatency();
  assert.equal(l.elapsedMs('s1', t(0)), null, 'no timer before submit');
  l.onSubmit({ sessionId: 's1', at: t(0) });
  assert.equal(l.elapsedMs('s1', t(3000)), 3000);
  assert.equal(l.elapsedMs('s1', t(9000)), 9000);
});

test('completion clears the timer and returns a delivery record (5.3)', () => {
  const l = createLatency();
  l.onSubmit({ sessionId: 's1', at: t(0) });
  const rec = l.onComplete({ sessionId: 's1', at: t(4200) });
  assert.deepEqual(rec, { sessionId: 's1', submittedAt: t(0), arrivedAt: t(4200), elapsedMs: 4200 });
  assert.equal(l.isWaiting('s1'), false, 'no longer waiting');
  assert.equal(l.elapsedMs('s1', t(9000)), null, 'cleared, not frozen');
});

test('a completion with no matching submit returns null (no phantom notification)', () => {
  const l = createLatency();
  assert.equal(l.onComplete({ sessionId: 'ghost', at: t(1) }), null);
});

test('two concurrent sessions do not collide; completing one clears only that one (5.6)', () => {
  const l = createLatency();
  l.onSubmit({ sessionId: 'a', at: t(0) });
  l.onSubmit({ sessionId: 'b', at: t(1000) });
  l.onComplete({ sessionId: 'a', at: t(5000) });
  assert.equal(l.isWaiting('a'), false);
  assert.equal(l.isWaiting('b'), true, "b's timer is untouched");
  assert.equal(l.elapsedMs('b', t(6000)), 5000);
});

test('a Cowork-shaped and a Claude-Code-shaped event drive identical behaviour (5.5)', () => {
  const cowork = createLatency();
  const claude = createLatency();
  cowork.onSubmit({ sessionId: 'cw', at: t(0) });   // from the Cowork watcher
  claude.onSubmit({ sessionId: 'cc', at: t(0) });   // from the UserPromptSubmit hook
  assert.equal(cowork.elapsedMs('cw', t(2000)), claude.elapsedMs('cc', t(2000)));
});
