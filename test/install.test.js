import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeHooks, stripHooks, hookEntries, launchAgentPlist } from '../lib/install.js';

/**
 * ~/.claude/settings.json belongs to the user, not to us.
 *
 * This host already runs an unrelated PreToolUse hook there. Installing must add
 * our two entries and touch nothing else, and uninstalling must remove exactly
 * what we added and leave the rest intact. Getting this wrong silently breaks
 * someone's existing tooling, which is a far worse outcome than Interstice simply
 * not working.
 */

const existing = {
  PreToolUse: [
    {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'node ~/.claude/hooks/mv-absolute-path-block.js', if: 'Bash(mv *)' }],
    },
  ],
  Stop: [{ hooks: [{ type: 'command', command: '/opt/somebody-elses/notify.sh' }] }],
};

test('install preserves unrelated hooks', () => {
  const merged = mergeHooks(existing, hookEntries());
  assert.deepEqual(merged.PreToolUse, existing.PreToolUse, 'unrelated event untouched');
  assert.ok(
    merged.Stop.some((e) => JSON.stringify(e).includes('somebody-elses')),
    "another tool's Stop hook must survive"
  );
  assert.ok(
    merged.Stop.some((e) => JSON.stringify(e).includes('interstice')),
    'ours is added alongside'
  );
});

test('install adds both of our hooks', () => {
  const merged = mergeHooks(existing, hookEntries());
  assert.ok(JSON.stringify(merged.UserPromptSubmit).includes('on-submit.sh'));
  assert.ok(JSON.stringify(merged.Stop).includes('on-stop.sh'));
});

test('installing twice does not duplicate our hooks', () => {
  const once = mergeHooks(existing, hookEntries());
  const twice = mergeHooks(once, hookEntries());
  const count = (o) => JSON.stringify(o).split('on-submit.sh').length - 1;
  assert.equal(count(twice), 1, 'idempotent');
  assert.deepEqual(twice.PreToolUse, existing.PreToolUse);
});

test('uninstall removes only ours', () => {
  const merged = mergeHooks(existing, hookEntries());
  const stripped = stripHooks(merged);
  assert.deepEqual(stripped.PreToolUse, existing.PreToolUse, 'unrelated hook survives');
  assert.ok(
    stripped.Stop.some((e) => JSON.stringify(e).includes('somebody-elses')),
    "another tool's hook survives uninstall"
  );
  assert.ok(!JSON.stringify(stripped).includes('interstice'), 'ours is gone');
});

test('uninstall drops an event that becomes empty rather than leaving a husk', () => {
  const onlyOurs = mergeHooks({}, hookEntries());
  const stripped = stripHooks(onlyOurs);
  assert.equal(stripped.UserPromptSubmit, undefined);
});

test('uninstall on settings we never touched is a no-op', () => {
  assert.deepEqual(stripHooks(existing), existing);
});

test('the LaunchAgent plist is well formed and absolute', () => {
  const plist = launchAgentPlist({ nodePath: '/usr/local/bin/node' });
  assert.match(plist, /<key>Label<\/key><string>com\.interstice\.daemon<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.equal((plist.match(/<dict>/g) || []).length, (plist.match(/<\/dict>/g) || []).length);
  assert.ok(!/<string>(?!\/)[^<]*\/[^<]*<\/string>/.test(plist.split('ProgramArguments')[1] ?? ''), 'paths are absolute');
});
