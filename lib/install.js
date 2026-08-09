import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG_FILE, CONFIG_DEFAULT, CLAUDE_SETTINGS, LAUNCH_AGENT, ROOT, LOG_DIR } from './paths.js';

const run = promisify(execFile);
const HOOK_MARK = 'interstice';

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

  await run('/bin/launchctl', ['unload', LAUNCH_AGENT]).catch(() => {});
  await run('/bin/launchctl', ['load', LAUNCH_AGENT]).catch((err) => {
    console.log(`  launchctl    load failed: ${err.message}`);
  });
  console.log('  launchctl    loaded');
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
