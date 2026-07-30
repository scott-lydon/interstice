import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TranscriptWatcher } from '../lib/watcher.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-test-'));

function once(emitter, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    emitter.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

const submitLine = (ts) =>
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: 'hello' },
    promptId: 'p1',
    sessionId: 's1',
    timestamp: new Date(ts).toISOString(),
  }) + '\n';

const endLine = (ts) =>
  JSON.stringify({
    type: 'assistant',
    message: { stop_reason: 'end_turn', content: [] },
    sessionId: 's1',
    timestamp: new Date(ts).toISOString(),
  }) + '\n';

test('detects a submit in a session tree created AFTER the watch started', async () => {
  const root = tmp();
  const w = new TranscriptWatcher({ root, surface: 'cowork' }).start();
  const gotSubmit = once(w, 'submit');

  // Exactly the Cowork shape: six levels deep, none of it existing yet.
  const dir = path.join(root, 'space/proj/local_NEW/.claude/projects/slug');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'sid.jsonl');
  fs.writeFileSync(file, submitLine(1000));

  const ev = await gotSubmit;
  assert.equal(ev.event, 'submit');
  assert.equal(ev.surface, 'cowork');
  assert.equal(ev.promptId, 'p1');
  w.stop();
});

test('emits submit then end in order for one turn', async () => {
  const root = tmp();
  const dir = path.join(root, 'a/b');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, '');

  const w = new TranscriptWatcher({ root, surface: 'cowork' }).start();
  const seen = [];
  w.on('submit', (e) => seen.push(['submit', e.ts]));
  w.on('end', (e) => seen.push(['end', e.ts]));

  const done = once(w, 'end');
  fs.appendFileSync(file, submitLine(1000));
  await new Promise((r) => setTimeout(r, 120));
  fs.appendFileSync(file, endLine(5000));
  await done;

  assert.deepEqual(seen.map((s) => s[0]), ['submit', 'end']);
  assert.equal(seen[1][1] - seen[0][1], 4000);
  w.stop();
});

test('existing content is not replayed as a burst on start', async () => {
  const root = tmp();
  const dir = path.join(root, 'a');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, submitLine(1) + submitLine(2) + submitLine(3));

  const w = new TranscriptWatcher({ root, surface: 'cowork' }).start();
  const seen = [];
  w.on('submit', (e) => seen.push(e));
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(seen.length, 0, 'backlog must not be replayed');

  const next = once(w, 'submit');
  fs.appendFileSync(file, submitLine(4));
  await next;
  assert.equal(seen.length, 1, 'only the new line counts');
  w.stop();
});

test('a partially flushed line is not parsed until it is complete', async () => {
  const root = tmp();
  const dir = path.join(root, 'a');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, '');

  const w = new TranscriptWatcher({ root, surface: 'cowork' }).start();
  const seen = [];
  w.on('submit', (e) => seen.push(e));

  const whole = submitLine(1000);
  fs.appendFileSync(file, whole.slice(0, 20)); // no newline yet
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(seen.length, 0, 'must not emit on a partial line');

  const next = once(w, 'submit');
  fs.appendFileSync(file, whole.slice(20));
  await next;
  assert.equal(seen.length, 1);
  w.stop();
});

test('truncation resets the offset instead of wedging the watcher', async () => {
  const root = tmp();
  const dir = path.join(root, 'a');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, submitLine(1) + submitLine(2));

  const w = new TranscriptWatcher({ root, surface: 'cowork' }).start();
  await new Promise((r) => setTimeout(r, 100));

  const next = once(w, 'submit');
  fs.writeFileSync(file, submitLine(9)); // shorter than before
  const ev = await next;
  assert.equal(ev.event, 'submit');
  w.stop();
});

test('a missing root warns rather than throwing', () => {
  const w = new TranscriptWatcher({ root: '/nope/does/not/exist', surface: 'cowork' });
  let warned = null;
  w.on('warning', (x) => (warned = x));
  w.start();
  assert.equal(warned?.code, 'ROOT_MISSING');
  assert.equal(w.started, false);
});

test('does not poll: no interval timers are created', async () => {
  const root = tmp();
  const w = new TranscriptWatcher({ root, surface: 'cowork' });
  const realSetInterval = globalThis.setInterval;
  let intervals = 0;
  globalThis.setInterval = (...args) => {
    intervals += 1;
    return realSetInterval(...args);
  };
  try {
    w.start();
    fs.mkdirSync(path.join(root, 'x'), { recursive: true });
    fs.writeFileSync(path.join(root, 'x/t.jsonl'), submitLine(1));
    await new Promise((r) => setTimeout(r, 200));
  } finally {
    globalThis.setInterval = realSetInterval;
    w.stop();
  }
  assert.equal(intervals, 0, 'watcher must be event driven, not polled');
});
