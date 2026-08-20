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
    // `-r` roots the tree at matching nodes and `-w0` stops truncation. Note that
    // `-d 1` WITHOUT `-r` silently returns no properties at all, which reads as
    // "idle unavailable" and disables the veto. Caught by doctor, not by review.
    const { stdout } = await run('/usr/sbin/ioreg', ['-r', '-d', '1', '-w0', '-c', 'IOHIDSystem'], {
      timeout: timeoutMs,
    });
    const m = stdout.match(/"HIDIdleTime"\s*=\s*(\d+)/);
    if (!m) return null;
    return Number(m[1]) / 1e6; // nanoseconds to milliseconds
  } catch {
    return null;
  }
}

/**
 * The frontmost app's process id, or null.
 *
 * Separate from `frontmostApp` because the NAME is not enough to recognise our own panel. The
 * panel is a Chrome `--app=` window on a user-data-dir of its own, and `lsappinfo` reports the
 * owning application, so a frontmost panel reads as "Google Chrome" exactly like any other tab.
 * A user who blacklists their browser would forfeit a block by using the thing the block is for.
 * The pid is the one identifier that separates our Chrome from theirs.
 */
export async function frontmostAppPid({ timeoutMs = 1500 } = {}) {
  try {
    const { stdout: asn } = await run('/usr/bin/lsappinfo', ['front'], { timeout: timeoutMs });
    const id = asn.trim();
    if (!id) return null;
    const { stdout } = await run('/usr/bin/lsappinfo', ['info', '-only', 'pid', id], {
      timeout: timeoutMs,
    });
    const m = stdout.match(/"pid"\s*=\s*(\d+)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null; // no pid is not a break; it is an unreadable signal
  }
}

/**
 * Which app is in front, by its display name.
 *
 * Uses lsappinfo rather than System Events, for two reasons found on a real
 * machine rather than in docs:
 *
 *   1. System Events reports the *process* name. Anki runs inside a Python venv,
 *      so it reports as "python". The delivery guard compares this against a list
 *      of app names, so that mismatch quietly breaks the guard.
 *   2. lsappinfo needs no Automation or Accessibility grant, so it keeps working
 *      in contexts where osascript is refused assistive access.
 *
 * Verified to agree with System Events for Terminal, Claude and Finder, and to be
 * correct for Anki where System Events is not. System Events remains the fallback below, for a
 * machine where lsappinfo answers nothing at all; on that path reason 1 applies again.
 */
export async function frontmostApp({ timeoutMs = 1500 } = {}) {
  try {
    const { stdout: asn } = await run('/usr/bin/lsappinfo', ['front'], { timeout: timeoutMs });
    const id = asn.trim();
    if (id) {
      const { stdout } = await run('/usr/bin/lsappinfo', ['info', '-only', 'name', id], {
        timeout: timeoutMs,
      });
      const m = stdout.match(/"LSDisplayName"\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    }
  } catch {
    /* fall through to System Events */
  }
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

/**
 * Ask the application, not the process table. `application "Anki" is running`
 * resolves through the bundle, so it is correct for apps whose process name does
 * not match their display name.
 */
export async function isRunning(appName, { timeoutMs = 2500 } = {}) {
  try {
    const { stdout } = await run(
      '/usr/bin/osascript',
      ['-e', `application "${appName}" is running`],
      { timeout: timeoutMs }
    );
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Bring an app forward. The router's only activation, and the router never uses it on a
 * third-party app to deliver a rung: nothing is
 * ever quit or closed except the headless browser this tool opened itself, so your Cowork
 * window keeps its exact state and stays one
 * keystroke behind. The one thing ever hidden is an Anki this tool started itself,
 * which is `hideApp` below, because Anki's launcher ignores the flags asking it to
 * start behind everything.
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

/**
 * Start an app behind whatever you are looking at.
 *
 * `open -g` launches behind the front window, and `-j` keeps it out of the way if the app
 * supports being hidden. This is how Anki gets to be running, and therefore answering
 * AnkiConnect, without being raised on purpose. Anki's own launcher ignores both flags and can
 * raise its deck list once the collection loads; `hideApp` below is what puts it back.
 * If it is already running this is a no-op.
 */
export async function launchHeadless(appName, { timeoutMs = 8000 } = {}) {
  try {
    await run('/usr/bin/open', ['-g', '-j', '-a', appName], { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Put an app away again.
 *
 * `open -g -j` is supposed to start something behind everything else, and for most
 * apps it does. Anki is not most apps: current builds run under a launcher that
 * brings up the main window and takes the screen the moment the collection loads, so
 * "connect to Anki" ended with Anki's deck list sitting in front of the panel. Which
 * is precisely the interruption this whole project exists to delete, arriving from
 * the tool that deletes it.
 *
 * Hidden rather than quit. Quitting would put AnkiConnect back where it was before
 * the button was pressed, so the next question about your cards would start the app
 * all over again; hidden, it is running, answering, and not on your screen.
 *
 * Addressed by bundle identifier, never by name. This is the same trap `isRunning`
 * documents one screen above, and it was walked straight into: to System Events this
 * app is called `python`, because current builds run the collection out of a venv
 * under `/Applications/Anki.app/Contents/MacOS/launcher`. A hide aimed at a process
 * named "Anki" therefore matches nothing at all, succeeds, and reports that it put
 * away a window that is still sitting in front of you. Measured exactly that way:
 * `hidden: true` in the response, deck list on screen.
 *
 * So it reports whether it actually hid anything, rather than assuming it did. Best effort
 * still: an app that has
 * not finished launching has no process to hide yet, and a machine that has never
 * granted automation rights over it will refuse. Neither is a reason to call a
 * connection that worked a failure, but both are reasons not to claim a window was
 * put away when it was not.
 */
export async function hideApp(bundleIds, { timeoutMs = 4000, holdMs = 8000, everyMs = 900 } = {}) {
  const ids = (Array.isArray(bundleIds) ? bundleIds : [bundleIds]).map((id) =>
    String(id).replace(/[^A-Za-z0-9.\-_]/g, '')
  );
  if (!ids.length) return false;
  const clauses = ids
    .map(
      (id) => `repeat with p in (every application process whose bundle identifier is "${id}")
           try
             if visible of p then
               set visible of p to false
               set hid to hid + 1
             end if
             if visible of p then set showing to showing + 1
           end try
         end repeat`
    )
    .join('\n');
  const script = `tell application "System Events"
      set hid to 0
      set showing to 0
      ${clauses}
      return (hid as text) & "," & (showing as text)
    end tell`;

  // Held down for a few seconds rather than pressed once. Anki answers AnkiConnect
  // as soon as the collection is open and raises its main window a moment *after*
  // that, so a single hide at the instant the connection lands is a hide that lands
  // before there is a window, and the deck list arrives on screen straight after it.
  // Measured once here: `hidden: true` at 1858ms, window visible again two seconds later.
  const deadline = Date.now() + holdMs;
  let everHid = false;
  let quiet = 0;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await run('/usr/bin/osascript', ['-e', script], { timeout: timeoutMs });
      const [hid, showing] = String(stdout).trim().split(',').map(Number);
      if (hid > 0) everHid = true;
      // Two passes in a row with nothing left showing is a window that has stopped
      // coming back, rather than one that has not appeared yet.
      quiet = showing === 0 ? quiet + 1 : 0;
      if (everHid && quiet >= 2) return true;
    } catch {
      /* not up yet, or not ours to hide; keep trying until the clock runs out */
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return everHid && quiet > 0;
}

export async function openUrl(url, { timeoutMs = 4000 } = {}) {
  await run('/usr/bin/open', [url], { timeout: timeoutMs });
  return true;
}

/**
 * Open a page in one named browser rather than whichever is the default.
 *
 * The only caller is the Kindle sign-in, and it names Safari on purpose: the
 * account's passwords and passkeys live in iCloud Keychain, which Safari fills from
 * and Chrome cannot. This is one of the few places the project deliberately puts another app in front of you,
 * alongside the visible Chrome sign-in window and "Open the Kindle app instead", and none of
 * them happens except when you press something.
 */
export async function openIn(appName, url, { timeoutMs = 8000 } = {}) {
  await run('/usr/bin/open', ['-a', appName, url], { timeout: timeoutMs });
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

/**
 * Disable App Nap. Without this, macOS suspends backgrounded Anki and AnkiConnect
 * stops answering with no error at all.
 *
 * Anki ships two bundle ids: `net.ankiweb.dtop` for the app and
 * `net.ankiweb.launcher` for the wrapper that actually owns the running process on
 * current builds. Setting only the first looks correct and does nothing, so we set
 * every id we are given.
 */
export async function disableAppNap(bundleIds, { timeoutMs = 3000 } = {}) {
  const ids = Array.isArray(bundleIds) ? bundleIds : [bundleIds];
  const done = [];
  for (const id of ids) {
    try {
      await run('/usr/bin/defaults', ['write', id, 'NSAppSleepDisabled', '-bool', 'YES'], {
        timeout: timeoutMs,
      });
      done.push(id);
    } catch {
      /* a bundle id that does not exist yet is not an error */
    }
  }
  return done;
}

export async function readAppNap(bundleId, { timeoutMs = 3000 } = {}) {
  try {
    const { stdout } = await run('/usr/bin/defaults', ['read', bundleId, 'NSAppSleepDisabled'], {
      timeout: timeoutMs,
    });
    return stdout.trim() === '1';
  } catch {
    return false;
  }
}
