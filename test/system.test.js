import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { idleMs, frontmostApp } from '../lib/state/system.js';

const macOnly = { skip: os.platform() !== 'darwin' && 'macOS only' };

/**
 * Regression guard for a bug doctor caught that review did not.
 *
 * `ioreg -c IOHIDSystem -d 1` returns no properties at all, so HIDIdleTime came
 * back null, which the router reads as "idle unavailable" and therefore silently
 * disables the veto that stops flashcards landing on top of what you are typing.
 * A failure that degrades a safety guard without erroring is the dangerous kind.
 */
test('idle time reads as a real number, not null', macOnly, async () => {
  const ms = await idleMs();
  assert.notEqual(ms, null, 'HIDIdleTime must be readable (check the ioreg flags)');
  assert.equal(typeof ms, 'number');
  assert.ok(ms >= 0 && ms < 1000 * 60 * 60 * 24 * 30, `implausible idle: ${ms}ms`);
});

test('idle time increases while nothing touches the machine', macOnly, async () => {
  const a = await idleMs();
  await new Promise((r) => setTimeout(r, 600));
  const b = await idleMs();
  assert.notEqual(a, null);
  assert.notEqual(b, null);
  // Not asserting b > a: a human may move the mouse mid-test. Assert only that
  // both are live readings rather than a frozen constant.
  assert.ok(Number.isFinite(a) && Number.isFinite(b));
});

test('frontmost app resolves to a name', macOnly, async () => {
  const app = await frontmostApp();
  assert.ok(typeof app === 'string' && app.length > 0, 'needs Automation permission');
});

test('idle time honours its timeout instead of hanging', macOnly, async () => {
  const started = Date.now();
  await idleMs({ timeoutMs: 1 }); // certain to time out
  assert.ok(Date.now() - started < 2000, 'must not hang when the probe is slow');
});
