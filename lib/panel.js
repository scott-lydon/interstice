import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR, PANEL_PID } from './paths.js';

const run = promisify(execFile);

const BROWSERS = [
  { app: 'Google Chrome', bin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  { app: 'Brave Browser', bin: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
  { app: 'Microsoft Edge', bin: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
  { app: 'Chromium', bin: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
];

const FRAME_SCRIPT = `
  ObjC.import("AppKit");
  const s = $.NSScreen.mainScreen;
  const f = s.frame, v = s.visibleFrame;
  JSON.stringify({
    width: f.size.width, height: f.size.height,
    visibleX: v.origin.x, visibleY: v.origin.y,
    visibleWidth: v.size.width, visibleHeight: v.size.height,
  });
`;

/**
 * Screen geometry in points, already converted to the top-left origin that window
 * placement uses. AppKit measures from the bottom left, so `visibleFrame.origin.y`
 * is the height of the Dock, not a distance from the top; using it directly puts
 * the window under the menu bar instead of above the Dock.
 */
export async function screenFrame({ timeoutMs = 3000 } = {}) {
  try {
    const { stdout } = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', FRAME_SCRIPT], {
      timeoutMs,
      timeout: timeoutMs,
    });
    const frame = JSON.parse(stdout);
    const dock = frame.visibleY;
    const menuBar = frame.height - frame.visibleHeight - dock;
    return {
      width: frame.width,
      height: frame.height,
      top: menuBar,
      bottom: frame.height - dock,
      left: frame.visibleX,
      right: frame.visibleX + frame.visibleWidth,
      source: 'NSScreen',
    };
  } catch {
    // A guess is better than no window. 1440x900 is the smallest common Mac size,
    // so a panel placed for it is on-screen everywhere.
    return { width: 1440, height: 900, top: 25, bottom: 870, left: 0, right: 1440, source: 'fallback' };
  }
}

/** Bottom right, inset by a margin, never larger than the space available. */
export function placeBottomRight(frame, { width, height, margin }) {
  const clampedWidth = Math.min(width, frame.right - frame.left - margin * 2);
  const clampedHeight = Math.min(height, frame.bottom - frame.top - margin * 2);
  return {
    width: Math.round(clampedWidth),
    height: Math.round(clampedHeight),
    x: Math.round(frame.right - clampedWidth - margin),
    y: Math.round(frame.bottom - clampedHeight - margin),
  };
}

/**
 * The book used to open in a window of its own, and the way back from it was a
 * bookmarks bar seeded into this profile. Neither exists now: the reader runs
 * headless and only its picture arrives, so there is no second window to come back
 * from and no furniture to give it. See lib/reader.js.
 */

/** A remembered pid is only useful if the process is still there. */
export function readPanelPid() {
  try {
    const pid = Number(fs.readFileSync(PANEL_PID, 'utf8').trim());
    if (!pid) return null;
    process.kill(pid, 0); // throws if it is gone
    return pid;
  } catch {
    return null;
  }
}

/**
 * The window. One of them, bottom right, and it is the only thing you ever see.
 *
 * Everything the ladder delivers is rendered here: the cards, the book, the lists,
 * the capture box. Anki, Kindle and Notes are data sources reached over their own
 * interfaces and are never raised, never opened, never brought to the front. The
 * earlier build activated each app in turn, which is the behaviour this replaces:
 * four apps taking the screen in sequence is four interruptions, not one activity.
 *
 * It is a Chromium app window rather than a native one because the project has no
 * build step and no dependencies, and `--app` gives a chromeless window that behaves
 * like a small panel. It runs in its own `--user-data-dir`, which is what makes the
 * geometry flags reliable: passed to an already-running Chrome they are handed to
 * the existing process and quietly dropped, so the window lands wherever Chrome
 * feels like putting it.
 */

export class Panel {
  constructor({ config, logger } = {}) {
    this.config = config;
    this.logger = logger;
    this.child = null;
    // The window outlives the daemon: restarting Interstice does not close it, and a
    // daemon that has forgotten the pid can no longer bring it forward. Delivery
    // then silently stops raising the panel, which looks exactly like the panel not
    // working. So the pid is written down and read back on start.
    this.pid = readPanelPid();
    this.browser = null;
    this.geometry = null;
    this.view = { rung: null, at: 0, detail: null, seq: 0 };
    this.lastPingAt = 0;
    // One window-opening at a time. See #ensureWindow.
    this.ensuring = null;
  }

  get settings() {
    const p = this.config.panel ?? {};
    return {
      // A reading window, not a notification. The book is the thing this panel is
      // mostly used for, and at 440x620 the page that arrived was around forty words
      // between a title block and a pager: legible, but not something to settle into.
      // Taller matters more than wider, and `placeBottomRight` clamps the height to
      // whatever the screen actually has, so asking for more than a laptop has costs
      // nothing on the laptop.
      width: p.width ?? 640,
      height: p.height ?? 900,
      margin: p.margin ?? 24,
      side: p.side ?? 'bottom-right',
      raiseOnDeliver: p.raiseOnDeliver !== false,
    };
  }

  url(route = '/panel') {
    return `http://127.0.0.1:${this.config.port}${route}`;
  }

  /** The page reports in while it is on screen, which is how we know not to open a second one. */
  ping() {
    this.lastPingAt = Date.now();
    return { ok: true, at: this.lastPingAt };
  }

  isAlive({ withinMs = 6000 } = {}) {
    return Date.now() - this.lastPingAt < withinMs;
  }

  /**
   * The window a previous daemon opened, found by asking the machine rather than by
   * remembering.
   *
   * A restart is the case that matters. `lastPingAt` resets with the process, so for
   * the first few seconds a restarted daemon believes there is no panel, and the pid
   * file cannot correct it: passing `--app` to an already-running Chrome makes that
   * Chrome open the window and the process we spawned exit at once, so what got
   * written down was a pid that was already gone.
   *
   * Spawning under that misapprehension does not fail loudly. It opens a second
   * window in the same browser, which is how you end up looking at two Interstices.
   *
   * The command has to be a browser we would have started, not merely a line with
   * our URL in it. Any `grep --app=http://127.0.0.1:7420/panel` running at the
   * moment we look matches on substring alone, and adopting a pid that is not a
   * window is worse than opening one: the panel is then never opened and never
   * raised, and the delivery goes nowhere at all.
   */
  async existingWindowPid() {
    try {
      const { stdout } = await run('/bin/ps', ['ax', '-o', 'pid=,command='], { timeout: 3000 });
      const marker = `--app=${this.url()}`;
      const line = stdout.split('\n').find((l) => {
        if (!l.includes(marker) || l.includes('--type=')) return false;
        const command = l.trim().slice(l.trim().indexOf(' ') + 1);
        return BROWSERS.some((b) => command.startsWith(b.bin));
      });
      const pid = line ? Number(line.trim().split(/\s+/)[0]) : null;
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  async #spawn() {
    const frame = await screenFrame();
    const settings = this.settings;
    const box = placeBottomRight(frame, settings);
    this.geometry = { ...box, frame };

    const profile = path.join(LOG_DIR, 'panel-profile');
    // Nothing is seeded into this profile and no session is carried into it. The
    // panel shows Interstice's own pages and nothing else, so it has no business
    // holding anyone's cookies; the reader keeps its own profile for that.
    for (const b of BROWSERS) {
      try {
        const args = [
          `--app=${this.url()}`,
          `--user-data-dir=${profile}`,
          `--window-position=${box.x},${box.y}`,
          `--window-size=${box.width},${box.height}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-features=Translate,MediaRouter',
        ];
        const { spawn } = await import('node:child_process');
        const child = spawn(b.bin, args, { detached: true, stdio: 'ignore' });
        child.unref();
        this.child = child;
        this.browser = b.app;
        // Whichever process ends up owning the window, which is not always the one
        // just spawned: a Chrome already running on this profile takes the window
        // and lets the new process exit. Remembering the wrong pid costs the ability
        // to raise the panel at all.
        await new Promise((r) => setTimeout(r, 600));
        this.pid = (await this.existingWindowPid()) ?? child.pid;
        try {
          fs.writeFileSync(PANEL_PID, String(this.pid));
        } catch {
          /* raising is a convenience; losing it must not stop the delivery */
        }
        return { browser: b.app, ...box, screen: frame.source };
      } catch (err) {
        this.logger?.warn(`panel: ${b.app} would not start`, { error: err.message });
      }
    }
    throw new Error('no Chromium-family browser found to host the panel');
  }

  /**
   * Bring the panel forward without disturbing anything else.
   *
   * Addressed by process id, not by application name. The panel runs the same
   * browser binary you browse with, so raising it by name would raise your ordinary
   * browser window instead, which is both wrong and exactly the kind of unasked-for
   * app switch this rewrite exists to remove.
   */
  async raise() {
    if (!this.pid) this.pid = readPanelPid();
    // A window that has been pinging all along was never adopted, so its pid was
    // never learned and the panel could not be brought forward at all. Ask the
    // machine before giving up on it.
    if (!this.pid) this.pid = await this.existingWindowPid();
    if (!this.pid) return { raised: false, reason: 'no panel process' };
    try {
      await run(
        '/usr/bin/osascript',
        [
          '-e',
          `tell application "System Events" to set frontmost of (first process whose unix id is ${this.pid}) to true`,
        ],
        { timeout: 3000 }
      );
      return { raised: true, pid: this.pid };
    } catch (err) {
      return { raised: false, reason: err.message };
    }
  }

  /**
   * Make sure there is exactly one window, with only one attempt in flight.
   *
   * Checking for a window and then opening one is two steps, and between them a
   * second delivery can run the same check and get the same answer. Both then open,
   * and because they share a browser profile the second lands as another window in
   * the same Chrome rather than failing, which is how you end up looking at two
   * Interstices. `isAlive` does not save you either: the new page has not pinged
   * yet, so for its first few seconds a freshly opened panel reads as absent.
   *
   * So the whole check-then-open is serialized behind one promise. Callers that
   * arrive while it is running await the same attempt and share its result instead
   * of starting their own.
   */
  #ensureWindow() {
    if (!this.ensuring) {
      this.ensuring = this.#ensureWindowOnce().finally(() => {
        this.ensuring = null;
      });
    }
    return this.ensuring;
  }

  async #ensureWindowOnce() {
    // Adopt the window that is already there instead of opening another one next
    // to it. Only a machine with no Interstice window on it gets a new one.
    const existing = await this.existingWindowPid();
    if (existing && (await this.answersTo(existing))) {
      this.pid = existing;
      try {
        fs.writeFileSync(PANEL_PID, String(existing));
      } catch {
        /* raising is a convenience; losing it must not stop the delivery */
      }
      return null;
    }
    const opened = await this.#spawn();
    // Give the page long enough to load before anyone asks whether it is alive.
    await new Promise((r) => setTimeout(r, 400));
    return opened;
  }

  /**
   * Whether the process we found is still showing a page, rather than merely still
   * being a process.
   *
   * A Chrome that has lost its window does not always exit: it can sit in the
   * process table for days with our `--app` flag still on its command line and
   * nothing on screen at all. Adopting one of those is worse than opening a second
   * window, because the delivery then goes nowhere and the panel looks broken with
   * no error anywhere to say why. Seen on this machine: pid alive since Wednesday,
   * `lastPingAt` still zero, every rung delivered into nothing.
   *
   * The page is the only witness that can settle it, and it pings every 1.5s, so a
   * few seconds of silence means there is no page. A window that is merely slow
   * gets several chances before we conclude it is gone.
   */
  async answersTo(pid, { graceMs = 4500, pollMs = 300 } = {}) {
    if (this.isAlive()) return true;
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      if (this.isAlive()) return true;
    }
    this.logger?.warn('panel: a window process is not showing a page, opening a new one', { pid });
    return false;
  }

  /**
   * Put a rung on screen.
   *
   * If the panel is already up this only changes what it is showing: the window
   * stays where it is, at the size you left it, and the page swaps view on its next
   * poll. Reopening it would move it back to our idea of bottom-right and throw away
   * whatever you had scrolled to.
   */
  async show(rung, detail = null) {
    this.view = { rung, detail, at: Date.now(), seq: this.view.seq + 1 };

    const opened = this.isAlive() ? null : await this.#ensureWindow();

    const raised = this.settings.raiseOnDeliver ? await this.raise() : { raised: false };
    return { rung, opened, raised, geometry: this.geometry };
  }

  state() {
    return {
      ...this.view,
      alive: this.isAlive(),
      lastPingAt: this.lastPingAt,
      pid: this.pid,
      browser: this.browser,
      geometry: this.geometry,
    };
  }

  stop() {
    // The window is the user's now. Killing it on shutdown would close something
    // they may be reading, and nothing in this project closes anything.
    this.child = null;
  }
}
