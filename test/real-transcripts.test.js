import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { classify, isHumanSubmit } from '../lib/transcript.js';
import { COWORK_SESSIONS_ROOT, CLAUDE_CODE_PROJECTS } from '../lib/paths.js';

/**
 * Integration check against transcripts actually on this machine.
 *
 * Fixtures prove the rules we wrote; this proves the rules match reality. It reads
 * only line structure and timestamps, never message content, and skips cleanly on a
 * machine that has no transcripts (CI, a fresh clone).
 */

function findTranscripts(root, limit = 40) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length && out.length < limit) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.jsonl') && e.name !== 'audit.jsonl') out.push(p);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function scan(files) {
  const stats = { lines: 0, submits: 0, ends: 0, userLines: 0, toolResults: 0, turns: [] };
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    let open = null;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      stats.lines += 1;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (d.type === 'user') {
        stats.userLines += 1;
        if ('toolUseResult' in d) stats.toolResults += 1;
      }
      const ev = classify(line, { surface: 'test', file: f });
      if (!ev) continue;
      if (ev.event === 'submit') {
        stats.submits += 1;
        open = ev.ts;
      } else if (ev.event === 'end') {
        stats.ends += 1;
        if (open !== null && ev.ts > open) {
          stats.turns.push((ev.ts - open) / 1000);
          open = null;
        }
      }
    }
  }
  return stats;
}

const cowork = findTranscripts(COWORK_SESSIONS_ROOT);
const cli = findTranscripts(CLAUDE_CODE_PROJECTS);
const files = [...cowork, ...cli];

test('classifier runs against real transcripts on this machine', { skip: files.length === 0 && 'no local transcripts' }, () => {
  const s = scan(files);
  assert.ok(s.lines > 0, 'read at least one line');
  assert.ok(s.submits > 0, 'found at least one real human submit');
  assert.ok(s.ends > 0, 'found at least one turn end');
});

test('tool-result lines are excluded from submits on real data', { skip: files.length === 0 && 'no local transcripts' }, () => {
  const s = scan(files);
  // Real transcripts contain many tool results wearing type "user". If our
  // discriminator regressed, submits would balloon toward userLines.
  assert.ok(s.toolResults > 0, 'sanity: real data contains tool-result user lines');
  assert.ok(
    s.submits < s.userLines,
    `submits (${s.submits}) must be fewer than raw user lines (${s.userLines})`
  );
});

test('measured turn durations are plausible, not tool round trips', { skip: files.length === 0 && 'no local transcripts' }, () => {
  const s = scan(files);
  if (s.turns.length < 5) return; // too little local history to judge
  const sorted = s.turns.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // A median in single-digit seconds is the signature of counting tool results as
  // prompts, which is the exact bug this discriminator exists to prevent.
  assert.ok(median > 10, `median turn ${median.toFixed(1)}s looks like tool round trips`);
});
