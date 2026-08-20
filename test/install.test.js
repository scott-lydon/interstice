import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  mergeHooks,
  stripHooks,
  hookEntries,
  launchAgentPlist,
  resolveNode,
  parseLaunchctlList,
  reloadLaunchAgent,
  waitForDaemon,
  LAUNCH_LABEL,
} from '../lib/install.js';

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

/**
 * The plist is written once and read at every login for months. A versioned
 * Homebrew path survives exactly until the next `brew upgrade node`, and the
 * failure is silent: Interstice simply never appears.
 */
test('the LaunchAgent gets a node that survives a Homebrew upgrade', async () => {
  const node = await resolveNode({ execPath: '/opt/homebrew/Cellar/node/23.11.0/bin/node' });
  assert.ok(path.isAbsolute(node.path));
  if (node.stable) assert.ok(!node.path.includes('/Cellar/'), node.path);
  // Nothing stable installed is a real possibility, and then the honest answer is
  // the versioned path plus the flag that says so, not a path that does not exist.
  assert.equal(fs.existsSync(node.path), true, node.path);
});

test('the LaunchAgent plist is well formed and absolute', () => {
  const plist = launchAgentPlist({ nodePath: '/usr/local/bin/node' });
  assert.match(plist, /<key>Label<\/key><string>com\.interstice\.daemon<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.equal((plist.match(/<dict>/g) || []).length, (plist.match(/<\/dict>/g) || []).length);
  assert.ok(!/<string>(?!\/)[^<]*\/[^<]*<\/string>/.test(plist.split('ProgramArguments')[1] ?? ''), 'paths are absolute');
});

/**
 * The install used to print `launchctl load failed: ...` and then
 * `launchctl    loaded` on the very next line, and return true either way, so the one place
 * this project makes a shipped-claim asserted an outcome nothing had checked. These drive the
 * launchd query with a stub `exec`, because the real launchd on this machine is running the
 * operator's daemon and must not be unloaded to prove a point.
 */
const listOutput = (fields) =>
  `{\n${Object.entries(fields).map(([k, v]) => `\t"${k}" = ${v};`).join('\n')}\n};`;

/** exec doubles: `unload` and `load` succeed unless told otherwise, `list` answers with `job`. */
const launchctl = ({ loadFails = false, job = null } = {}) => async (_bin, args) => {
  if (args[0] === 'load' && loadFails) throw new Error('Load failed: 5: Input/output error');
  if (args[0] === 'list') {
    if (!job) throw new Error(`Could not find service "${LAUNCH_LABEL}"`);
    return { stdout: listOutput(job), stderr: '' };
  }
  return { stdout: '', stderr: '' };
};

test('a running job is read out of launchctl list, ignoring a stale exit status', () => {
  // The real agent on this machine reports LastExitStatus 9 next to a live PID, because KeepAlive
  // restarted it. Requiring a zero exit status would call a healthy daemon broken.
  const real = parseLaunchctlList(listOutput({ Label: '"com.interstice.daemon"', LastExitStatus: 9, PID: 77971 }));
  assert.equal(real.pid, 77971);
  assert.equal(real.lastExitStatus, 9);
  // A job launchd loaded but could not run has no PID at all, which is the only failure signal.
  assert.equal(parseLaunchctlList(listOutput({ LastExitStatus: 1 })).pid, null);
});

test('a launchctl load that fails is never reported as loaded', async () => {
  const r = await reloadLaunchAgent({ exec: launchctl({ loadFails: true }) });
  assert.equal(r.pid, null, 'no pid means install() returns false rather than printing "loaded"');
  assert.match(r.detail, /load failed/);
});

test('a job that loads but dies on startup is not reported as loaded either', async () => {
  const r = await reloadLaunchAgent({ exec: launchctl({ job: { LastExitStatus: 78 } }) });
  assert.equal(r.pid, null);
  assert.match(r.detail, /loaded but not running \(last exit status 78\)/);
});

test('a load launchd accepted but never registered is not reported as loaded', async () => {
  const r = await reloadLaunchAgent({ exec: launchctl({ job: null }) });
  assert.equal(r.loaded, false);
  assert.equal(r.pid, null);
  assert.match(r.detail, /not in launchctl list/);
});

test('only a job launchd is actually running counts as loaded', async () => {
  const r = await reloadLaunchAgent({ exec: launchctl({ job: { LastExitStatus: 9, PID: 4242 } }) });
  assert.equal(r.loaded, true);
  assert.equal(r.pid, 4242);
  assert.equal(r.detail, 'pid 4242');
});

test('the daemon poll gives the job time to bind, and gives up rather than hanging', async () => {
  let calls = 0;
  const slow = async () => (++calls < 3 ? null : 4242);
  assert.equal(await waitForDaemon(0, { attempts: 5, everyMs: 1, probe: slow }), 4242);
  assert.equal(calls, 3);
  assert.equal(await waitForDaemon(0, { attempts: 4, everyMs: 1, probe: async () => null }), null);
});
