import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths.js';

/**
 * Structural guarantees, enforced by reading our own source.
 *
 * These are the promises the README makes to a user who is about to let a daemon
 * move windows around on their machine. A reviewer should not have to take them on
 * faith, and a future change should not be able to break them quietly.
 */

function sourceFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.js')) out.push(p);
    }
  }
  return out;
}

test('no actuator quits, hides, or closes an application', () => {
  const files = sourceFiles(path.join(ROOT, 'lib', 'actuators'));
  assert.ok(files.length > 0, 'there are actuators to check');
  const banned = /\b(quit|terminate|pkill|killall|\bhide\b|close window|set visible of)\b/i;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue;
      assert.ok(!banned.test(line), `${path.basename(f)}:${i + 1} performs a destructive window op: ${line.trim()}`);
    }
  }
});

test('reclaim never sends keystrokes to the delivered app', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reclaim.js'), 'utf8');
  const banned = /\b(keystroke|key code|System Events.*keystroke)\b/i;
  for (const [i, line] of src.split('\n').entries()) {
    if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue;
    assert.ok(!banned.test(line), `reclaim.js:${i + 1} types into an app: ${line.trim()}`);
  }
});

test('the delivery path presents no menu, list, picker or dialog', () => {
  const files = [
    path.join(ROOT, 'lib', 'router.js'),
    ...sourceFiles(path.join(ROOT, 'lib', 'actuators')),
  ];
  const banned = /\b(chooser|choose from list|display dialog|showPicker|selectFrom)\b/i;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue;
      assert.ok(!banned.test(line), `${path.basename(f)}:${i + 1} asks the user to choose: ${line.trim()}`);
    }
  }
});

test('no message content is read from transcripts', () => {
  // We read structure and timestamps. The one place message.content is touched is
  // the type check that separates a human prompt from a tool result, and it must
  // only ever inspect the type, never the value.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'transcript.js'), 'utf8');
  const uses = src.split('\n').filter((l) => /message\??\.content/.test(l) && !l.trim().startsWith('*'));
  for (const line of uses) {
    assert.ok(
      /typeof\s+content\s*===|const content =/.test(line),
      `transcript.js inspects message content beyond its type: ${line.trim()}`
    );
  }
});

test('the watcher does not poll the filesystem', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'watcher.js'), 'utf8');
  const code = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
    .join('\n');
  assert.ok(!/setInterval/.test(code), 'watcher must be event driven');
});
