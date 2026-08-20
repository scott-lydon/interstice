import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisplayBreaker, decideLock } from '../lib/focus/breakers/display.js';

const AT = '2026-08-19T09:10:00-07:00';

test('a locked screen emits a break with cause lock', async () => {
  const breaker = createDisplayBreaker({ locked: async () => true });
  const ev = await breaker.probe(AT);
  assert.ok(ev);
  assert.equal(ev.cause, 'lock');
  assert.equal(ev.at, AT);
});

test('an unlocked screen emits no break', async () => {
  const breaker = createDisplayBreaker({ locked: async () => false });
  assert.equal(await breaker.probe(AT), null);
});

test('idle without a lock is not a break, because reading is focus', () => {
  // The decision keys only on the lock state; there is no idle input, by design.
  assert.equal(decideLock({ locked: false, at: AT }), null);
});
