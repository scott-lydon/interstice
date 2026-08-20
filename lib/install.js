import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG_FILE, CONFIG_DEFAULT, CLAUDE_SETTINGS, LAUNCH_AGENT, ROOT, LOG_DIR } from './paths.js';
import { load as loadConfig } from './config.js';
import { readToken } from './auth.js';

const run = promisify(execFile);
const HOOK_MARK = 'interstice';
export const LAUNCH_LABEL = 'com.interstice.daemon';

/**
 * Install is deliberately conservative about ~/.claude/settings.json, because that
 * file is the user's, not ours: we merge our two hooks in and never rewrite the
 * rest, we back it up first, and uninstall removes exactly what we added.
 */

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const dest = `${file}.interstice-backup-${Date.now()}`;
  fs.copyFileSync(file, dest);
  return dest;
}

export function hookEntries() {
  const submit = path.join(ROOT, 'hooks', 'on-submit.sh');
  const stop = path.join(ROOT, 'hooks', 'on-stop.sh');
  return {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: submit }] }],
    Stop: [{ hooks: [{ type: 'command', command: stop }] }],
  };
}

export function mergeHooks(existing = {}, additions) {
  const out = { ...existing };
  for (const [event, entries] of Object.entries(additions)) {
    const current = Array.isArray(out[event]) ? out[event] : [];
    const withoutOurs = current.filter((e) => !JSON.stringify(e).includes(HOOK_MARK));
    out[event] = [...withoutOurs, ...entries];
  }
  return out;
}

export function stripHooks(existing = {}) {
  const out = {};
  for (const [event, entries] of Object.entries(existing)) {
    if (!Array.isArray(entries)) {
      out[event] = entries;
      continue;
    }
    const kept = entries.filter((e) => !JSON.stringify(e).includes(HOOK_MARK));
    if (kept.length) out[event] = kept;
  }
  return out;
}

/**
 * A node that will still be there next month.
 *
 * `process.execPath` under Homebrew is a versioned Cellar path
 * (`/opt/homebrew/Cellar/node/23.11.0/bin/node`). Baking that into the LaunchAgent
 * works until the next `brew upgrade node` removes the directory, and then the job
 * fails at every login with no visible symptom beyond Interstice never appearing,
 * which is indistinguishable from a quiet day. So a stable symlink is preferred,
 * and only if it is genuinely a node 20 or newer.
 */
export async function resolveNode({ execPath = process.execPath } = {}) {
  const stable = ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
  const versioned = execPath.includes('/Cellar/');
  for (const candidate of stable) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const { stdout } = await run(candidate, ['-v'], { timeout: 5000 });
      const major = Number(stdout.trim().replace(/^v/, '').split('.')[0]);
      if (major >= 20) return { path: candidate, stable: true, version: stdout.trim() };
    } catch {
      /* a symlink pointing at nothing is not a node */
    }
  }
  return { path: execPath, stable: !versioned, version: process.version };
}

export function launchAgentPlist({ nodePath = process.execPath } = {}) {
  const bin = path.join(ROOT, 'bin', 'interstice.js');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.interstice.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${bin}</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${path.join(LOG_DIR, 'launchd.out.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(LOG_DIR, 'launchd.err.log')}</string>
  <key>WorkingDirectory</key><string>${ROOT}</string>
</dict>
</plist>
`;
}

/**
 * What launchd actually says about one job.
 *
 * `launchctl list <label>` exits non-zero when the label is unknown and otherwise prints an
 * old-style plist dictionary. The key that matters is `PID`: launchd includes it only while the
 * job is running, so its presence is the difference between a plist that exists on disk and a
 * daemon that is up. `LastExitStatus` is deliberately NOT treated as a health signal on its own,
 * because a KeepAlive job that has been restarted carries the previous run's status forever: the
 * agent on this machine reports `LastExitStatus = 9` alongside a live `PID`. It is only worth
 * reporting when there is no pid, where it is the one clue about why the job died.
 *
 * `exec` is injectable so both failure shapes can be tested without a real launchd.
 */
export function parseLaunchctlList(stdout) {
  const num = (key) => {
    const m = String(stdout).match(new RegExp(`"${key}"\\s*=\\s*(-?\\d+)`));
    return m ? Number(m[1]) : null;
  };
  return { pid: num('PID'), lastExitStatus: num('LastExitStatus') };
}

export async function launchAgentJob({ label = LAUNCH_LABEL, exec = run } = {}) {
  try {
    const { stdout } = await exec('/bin/launchctl', ['list', label], { timeout: 5000 });
    return { loaded: true, ...parseLaunchctlList(stdout) };
  } catch {
    // A non-zero exit here means launchd has never heard of the label, which is the honest
    // answer to "is it loaded" and not an error worth throwing.
    return { loaded: false, pid: null, lastExitStatus: null };
  }
}

/**
 * Unload, load, and then ask launchd whether any of that worked.
 *
 * The exit status of the pair says almost nothing: unloading a job that was never loaded fails
 * and is deliberately swallowed, and `load` is quiet about a plist launchd accepted but could not
 * run. So the only evidence worth printing comes from querying the job afterwards. This used to
 * print "loaded" unconditionally, on the same code path that had just printed "load failed" one
 * line above, which asserted an outcome nothing had checked.
 */
export async function reloadLaunchAgent({ plist = LAUNCH_AGENT, label = LAUNCH_LABEL, exec = run } = {}) {
  await exec('/bin/launchctl', ['unload', plist]).catch(() => {});
  try {
    await exec('/bin/launchctl', ['load', plist]);
  } catch (err) {
    return { loaded: false, pid: null, lastExitStatus: null, detail: `load failed: ${err.message}` };
  }
  const job = await launchAgentJob({ label, exec });
  if (!job.loaded) {
    return { ...job, detail: `load reported success but ${label} is not in launchctl list` };
  }
  if (job.pid == null) {
    return { ...job, detail: `${label} is loaded but not running (last exit status ${job.lastExitStatus ?? 'unknown'})` };
  }
  return { ...job, detail: `pid ${job.pid}` };
}

/**
 * The pid the daemon on `port` reports for itself, or null if nothing usable answers.
 *
 * /api/health needs the control token now. The daemon mints that file before it listens, so by
 * the time anything answers the token on disk is the running daemon's.
 */
export async function daemonPidOnPort(port, { logDir = LOG_DIR } = {}) {
  const token = readToken(logDir);
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
    headers: token ? { 'x-interstice-token': token } : {},
    signal: AbortSignal.timeout(2000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const body = await res.json().catch(() => ({}));
  return typeof body.pid === 'number' ? body.pid : null;
}

/** Give the job launchd just started a few seconds to bind its port before calling it dead. */
export async function waitForDaemon(port, { attempts = 15, everyMs = 1000, probe = daemonPidOnPort } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const pid = await probe(port);
    if (pid != null) return pid;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return null;
}

export async function install({ force = false } = {}) {
  console.log('\ninterstice install\n');
  fs.mkdirSync(LOG_DIR, { recursive: true });

  if (!fs.existsSync(CONFIG_FILE) || force) {
    fs.copyFileSync(CONFIG_DEFAULT, CONFIG_FILE);
    console.log(`  config       ${CONFIG_FILE.replace(os.homedir(), '~')}`);
  } else {
    console.log(`  config       kept existing (--force to overwrite)`);
  }

  for (const h of ['on-submit.sh', 'on-stop.sh']) {
    fs.chmodSync(path.join(ROOT, 'hooks', h), 0o755);
  }

  const settingsDir = path.dirname(CLAUDE_SETTINGS);
  fs.mkdirSync(settingsDir, { recursive: true });
  const backedUp = backup(CLAUDE_SETTINGS);
  const settings = fs.existsSync(CLAUDE_SETTINGS)
    ? JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'))
    : {};
  settings.hooks = mergeHooks(settings.hooks, hookEntries());
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  console.log(`  hooks        UserPromptSubmit + Stop -> ~/.claude/settings.json`);
  if (backedUp) console.log(`  backup       ${path.basename(backedUp)}`);

  fs.mkdirSync(path.dirname(LAUNCH_AGENT), { recursive: true });
  const node = await resolveNode();
  fs.writeFileSync(LAUNCH_AGENT, launchAgentPlist({ nodePath: node.path }));
  console.log(`  launchagent  ${LAUNCH_AGENT.replace(os.homedir(), '~')}`);
  console.log(
    `  node         ${node.path} ${node.stable ? '' : '(versioned path: a node upgrade will break login start)'}`.trimEnd()
  );

  const agent = await reloadLaunchAgent();
  if (agent.pid == null) {
    console.log(`  launchctl    NOT loaded: ${agent.detail}`);
    return false;
  }
  console.log(`  launchctl    loaded, ${agent.detail}`);

  // (b) of the reload contract: prove the job launchd just started is the one answering the
  // port. "Something is listening" is not that proof, because a daemon started by hand in a
  // terminal answers /api/health exactly as well as the agent does, and then the agent can be
  // unloaded, dead, or running the previous copy of the code with nothing to say so. The pid
  // launchd reports and the pid the daemon reports for itself are the same number, or this is
  // not the agent's daemon.
  const { port } = loadConfig();
  const answering = await waitForDaemon(port);
  if (answering == null) {
    console.log(`  daemon       NOT answering on ${port}; see ${path.join(LOG_DIR, 'launchd.err.log')}`);
    return false;
  }
  if (answering !== agent.pid) {
    console.log(
      `  daemon       port ${port} is answered by pid ${answering}, not the agent's ${agent.pid} ` +
      `(a daemon started by hand is holding the port; stop it and re-run)`
    );
    return false;
  }
  console.log(`  daemon       answering as pid ${answering}, which is the agent's own process`);
  return true;
}

export async function uninstall() {
  console.log('\ninterstice uninstall\n');

  await run('/bin/launchctl', ['unload', LAUNCH_AGENT]).catch(() => {});
  if (fs.existsSync(LAUNCH_AGENT)) {
    fs.rmSync(LAUNCH_AGENT);
    console.log('  launchagent  removed');
  }

  if (fs.existsSync(CLAUDE_SETTINGS)) {
    backup(CLAUDE_SETTINGS);
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
    settings.hooks = stripHooks(settings.hooks);
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + '\n');
    console.log('  hooks        removed (only ours; the rest untouched)');
  }

  console.log('  logs         left in place\n');
  return true;
}
