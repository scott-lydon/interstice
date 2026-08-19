import test from 'node:test';
import assert from 'node:assert/strict';
import { readingRungDiagnosis } from '../lib/doctor.js';

// 1.6: the reading-rung check must fail loudly and specifically for each of the three silent
// failure modes. These induce each one and assert the message names that mode's remedy.

test('a missing browser fails the reading rung with a specific remedy', () => {
  const d = readingRungDiagnosis({ browserFound: false, portFree: true, sessionCarried: true });
  assert.equal(d.ok, false);
  assert.match(d.message, /browser/i);
  assert.match(d.message, /Remedy: install/i);
});

test('an occupied port fails the reading rung with a specific remedy', () => {
  const d = readingRungDiagnosis({ browserFound: true, portFree: false, sessionCarried: true });
  assert.equal(d.ok, false);
  assert.match(d.message, /port/i);
  assert.match(d.message, /Remedy:/);
});

test('an expired session fails the reading rung with a specific remedy', () => {
  const d = readingRungDiagnosis({ browserFound: true, portFree: true, sessionCarried: false });
  assert.equal(d.ok, false);
  assert.match(d.message, /session/i);
  assert.match(d.message, /Remedy: sign in/i);
});

test('all three present passes the reading rung', () => {
  const d = readingRungDiagnosis({ browserFound: true, portFree: true, sessionCarried: true });
  assert.equal(d.ok, true);
});
