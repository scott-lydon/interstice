import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { open, read, StarLogError } from '../lib/focus/store.js';

function tmp() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stars-')), 'stars.jsonl');
}

test('stars survive a store being killed and reconstructed, byte-exact including timestamps', () => {
  const p = tmp();
  const s1 = open(p);
  const a = s1.award({ startedAt: '2026-08-19T09:12:00-07:00', endedAt: '2026-08-19T09:37:00-07:00', day: '2026-08-19' });
  const b = s1.award({ startedAt: '2026-08-19T10:04:00-07:00', endedAt: '2026-08-19T10:29:00-07:00', day: '2026-08-19' });

  // "kill" the store: drop it and reopen from the file alone.
  const s2 = open(p);
  const recovered = s2.all();
  assert.equal(recovered.length, 2);
  assert.deepEqual(recovered[0], a, 'first star recovered exactly, timestamps and all');
  assert.deepEqual(recovered[1], b, 'second star recovered exactly');
  // and the on-disk bytes are exactly two JSON lines, nothing lossy
  const bytes = fs.readFileSync(p, 'utf8');
  assert.equal(bytes, JSON.stringify(a) + '\n' + JSON.stringify(b) + '\n');
});

test('a malformed line is reported with its line number, not silently skipped', () => {
  const p = tmp();
  const good = { id: 'x', startedAt: '2026-08-19T09:00:00-07:00', endedAt: '2026-08-19T09:25:00-07:00', day: '2026-08-19' };
  fs.writeFileSync(p, JSON.stringify(good) + '\n' + '{not json' + '\n');
  assert.throws(
    () => read(p),
    (err) => err instanceof StarLogError && err.line === 2 && /line 2/.test(err.message),
    'the second line is named in the error'
  );
});

test('a line that parses but lacks a timestamp is also reported', () => {
  const p = tmp();
  fs.writeFileSync(p, JSON.stringify({ id: 'x', day: '2026-08-19' }) + '\n');
  assert.throws(() => read(p), (err) => err instanceof StarLogError && /startedAt/.test(err.message));
});

test('starsForDay and starsForMonth filter correctly', () => {
  const p = tmp();
  const s = open(p);
  s.award({ startedAt: '2026-08-19T09:00:00-07:00', endedAt: '2026-08-19T09:25:00-07:00', day: '2026-08-19' });
  s.award({ startedAt: '2026-08-20T09:00:00-07:00', endedAt: '2026-08-20T09:25:00-07:00', day: '2026-08-20' });
  s.award({ startedAt: '2026-09-01T09:00:00-07:00', endedAt: '2026-09-01T09:25:00-07:00', day: '2026-09-01' });
  assert.equal(s.starsForDay('2026-08-19').length, 1);
  assert.equal(s.starsForMonth('2026-08').length, 2);
  assert.equal(s.starsForMonth('2026-09').length, 1);
});

test('a trailing newline is not treated as a malformed line', () => {
  const p = tmp();
  const s = open(p);
  s.award({ startedAt: '2026-08-19T09:00:00-07:00', endedAt: '2026-08-19T09:25:00-07:00', day: '2026-08-19' });
  assert.doesNotThrow(() => read(p));
  assert.equal(read(p).length, 1);
});
