import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Milliseconds since the last keyboard or mouse input, from IOKit.
 *
 * This never starts a gap. It only vetoes one, so that a gap opened while you are
 * still typing does not throw a flashcard on top of what you are writing. Using
 * idle time as the *trigger* is the mistake this design specifically avoids: it
 * cannot tell waiting apart from reading, thinking, or being on a call.
 */
export async function idleMs({ timeoutMs = 1200 } = {}) {
  try {
    const { stdout } = await run('/usr/sbin/ioreg', ['-c', 'IOHIDSystem', '-d', '1'], {
      timeout: timeoutMs,
    });
    const m = stdout.match(/"HIDIdleTime"\s*=\s*(\d+)/);
    if (!m) return null;
    return Number(m[1]) / 1e6; // nanoseconds to milliseconds
  } catch {
    return null;
  }
}

export async function frontmostApp({ timeoutMs = 1500 } = {}) {
  try {
    const { stdout } = await run(
      '/usr/bin/osascript',
      ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'],
      { timeout: timeoutMs }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function isRunning(appName, { timeoutMs = 1500 } = {}) {
  try {
    const { stdout } = await run(
      '/usr/bin/osascript',
      ['-e', `tell application "System Events" to (name of processes) contains "${appName}"`],
      { timeout: timeoutMs }
    );
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Bring an app forward. Deliberately the only window operation in the codebase:
 * nothing is ever quit, hidden, or closed, so your Cowork window keeps its exact
 * state and stays one keystroke behind.
 */
export async function activate(appName, { timeoutMs = 4000 } = {}) {
  await run('/usr/bin/open', ['-a', appName], { timeout: timeoutMs });
  await run('/usr/bin/osascript', ['-e', `tell application "${appName}" to activate`], {
    timeout: timeoutMs,
  }).catch(() => {
    /* `open -a` already raised it; some apps refuse the AppleScript activate */
  });
  return true;
}

export async function openUrl(url, { timeoutMs = 4000 } = {}) {
  await run('/usr/bin/open', [url], { timeout: timeoutMs });
  return true;
}

export async function notify(title, message, { timeoutMs = 2000 } = {}) {
  const esc = (s) => String(s).replace(/["\\]/g, '\\$&');
  try {
    await run(
      '/usr/bin/osascript',
      ['-e', `display notification "${esc(message)}" with title "${esc(title)}"`],
      { timeout: timeoutMs }
    );
    return true;
  } catch {
    return false;
  }
}

/** Disable App Nap for a bundle id. Without this, backgrounded Anki stops answering. */
export async function disableAppNap(bundleId, { timeoutMs = 3000 } = {}) {
  await run('/usr/bin/defaults', ['write', bundleId, 'NSAppSleepDisabled', '-bool', 'YES'], {
    timeout: timeoutMs,
  });
  return true;
}
