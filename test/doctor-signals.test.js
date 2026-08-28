import test from 'node:test';
import assert from 'node:assert/strict';
import { frontmostSignalDiagnosis, lockSignalDiagnosis, videoProbeDiagnosis } from '../lib/doctor.js';

// Each new dependency's signal has a doctor check that fails with a remedy-bearing message
// when the dependency is induced to fail.

test('the frontmost signal fails with a remedy when unreadable', () => {
  assert.equal(frontmostSignalDiagnosis('Claude').ok, true);
  const bad = frontmostSignalDiagnosis(null);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /Remedy:/);
  assert.match(bad.message, /lsappinfo/);
});

test('the screen-lock signal fails with a remedy when the probe errors', () => {
  assert.equal(lockSignalDiagnosis({ ok: true, value: false }).ok, true);
  const bad = lockSignalDiagnosis({ ok: false });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /Remedy:/);
  assert.match(bad.message, /ioreg/);
});

test('the video probe reports reachability without ever failing loudly on zero', () => {
  assert.equal(videoProbeDiagnosis(2).ok, true);
  assert.equal(videoProbeDiagnosis(0).ok, true, 'no browser is a warning state, not a hard failure');
});
