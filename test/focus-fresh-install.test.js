import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { open } from '../lib/focus/store.js';

// 3.9: a fresh install renders zero stars, never a seeded or sample value. An empty history is an
// empty list, honestly, not a demo month.
test('a fresh star store has no stars at all', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-')), 's.jsonl');
  const s = open(p);
  assert.deepEqual(s.all(), [], 'no seeded stars');
  assert.deepEqual(s.starsForDay('2026-08-19'), []);
  assert.deepEqual(s.starsForMonth('2026-08'), []);
});
