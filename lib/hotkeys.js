import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, LOG_DIR } from './paths.js';
import { tokenPath } from './auth.js';

const run = promisify(execFile);

/**
 * Global hotkeys for advance and stand down.
 *
 * macOS has no supported way for a plain daemon to register a system-wide hotkey
 * without either a signed native helper or Accessibility access, and both are a
 * heavier ask than this feature is worth. So we build two tiny apps that each fire
 * one command, and let macOS bind the keys, which is the mechanism the OS already
 * gives every user.
 *
 * Each app talks to the daemon over loopback HTTP rather than shelling into node,
 * so a keypress costs a few milliseconds instead of a runtime startup.
 */

export const APPS = [
  {
    name: 'Interstice Advance',
    endpoint: '/api/advance',
    body: '{}',
    why: 'move to the next rung',
  },
  {
    name: 'Interstice Stand Down',
    endpoint: '/api/standdown',
    body: '{}',
    why: 'stop routing for this gap',
  },
];

export function appsDir() {
  return path.join(ROOT, 'hotkeys');
}

function scriptFor(app, port) {
  // No osascript quoting hazards: the payload is a fixed literal, and the token is read by the
  // shell at fire time rather than baked into the app bundle, so rotating it does not require
  // rebuilding every hotkey app, and the secret never sits in a world-readable .app.
  const tokenRead = '$(cat ' + tokenPath(LOG_DIR).replace(/ /g, '\\ ') + ' 2>/dev/null)';
  return [
    `do shell script "curl -s -m 3 -X POST -H 'content-type: application/json' -H 'x-interstice-token: ${tokenRead}' -d '${app.body}' http://127.0.0.1:${port}${app.endpoint} > /dev/null 2>&1 || true"`,
  ].join('\n');
}

export async function buildHotkeyApps({ port }) {
  const dir = appsDir();
  fs.mkdirSync(dir, { recursive: true });
  const built = [];
  for (const app of APPS) {
    const src = path.join(dir, `${app.name}.applescript`);
    const out = path.join(dir, `${app.name}.app`);
    fs.writeFileSync(src, scriptFor(app, port));
    fs.rmSync(out, { recursive: true, force: true });
    await run('/usr/bin/osacompile', ['-o', out, src]);
    fs.rmSync(src, { force: true });
    built.push({ ...app, path: out });
  }
  return built;
}

export function instructions(built) {
  const home = os.homedir();
  const short = (p) => p.replace(home, '~');
  return [
    '',
    'Two apps were built. macOS binds the keys, so nothing here needs Accessibility access.',
    '',
    ...built.map((b) => `  ${b.name.padEnd(24)} ${short(b.path)}   (${b.why})`),
    '',
    'To bind a key to each:',
    '',
    '  1. Open Shortcuts.app and create a new shortcut.',
    '  2. Add the "Open App" action and pick one of the apps above.',
    '  3. In the shortcut details pane, set a keyboard shortcut.',
    '     Suggested: Control-Option-N to advance, Control-Option-. to stand down.',
    '  4. Repeat for the second app.',
    '',
    'Any launcher that can run an app on a hotkey works equally well (Raycast,',
    'Alfred, Karabiner, skhd). The apps are ordinary .app bundles.',
    '',
  ].join('\n');
}
