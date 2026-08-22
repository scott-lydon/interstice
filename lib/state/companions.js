import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isRunning } from './system.js';

const run = promisify(execFile);

/**
 * The two things you set up before a work block and forget to set up when you do not.
 *
 * This is a report, never an action. Nothing here starts your music, starts a timer,
 * raises an app or blocks a rung: the panel says what it found and you decide. A
 * companion that cannot be read reports `unknown`, which is deliberately not the same
 * as `off`, because a warning fired on a reading we could not take is a warning you
 * learn to ignore.
 */

/* ------------------------------------------------------------------ binaural --- */

/**
 * Music says what it is playing, so this one is simply asked.
 *
 * `application "Music" is running` is checked first because `tell application "Music"
 * to ...` LAUNCHES Music if it is not open. A status probe that starts an app is not
 * a status probe.
 */
export async function musicTrack(app, { timeoutMs = 2500 } = {}) {
  if (!(await isRunning(app, { timeoutMs }))) return { running: false };
  try {
    const { stdout } = await run(
      '/usr/bin/osascript',
      [
        '-e',
        `tell application "${app}"
           if player state is stopped then return "stopped\t"
           return (player state as text) & "\t" & (name of current track)
         end tell`,
      ],
      { timeout: timeoutMs }
    );
    const [state, ...rest] = stdout.trimEnd().split('\t');
    return { running: true, playerState: state || null, track: rest.join('\t') || null };
  } catch (err) {
    // Two very different things land here and must not be merged. A refused
    // Automation grant (-1743) is a fact about permissions; anything else is the
    // app being open with nothing loaded. Reporting the first as the second is a
    // warning invented out of a question that was never answered.
    const denied = /-1743|not authori[sz]ed|Not authorized/i.test(err.message);
    return { running: true, playerState: null, track: null, denied, error: err.message };
  }
}

/** Does this track name look like the thing you put on to work, rather than music? */
export function matchesBinaural(track, pattern) {
  if (!track) return false;
  try {
    return new RegExp(pattern, 'i').test(track);
  } catch {
    return false;
  }
}

export async function binauralState(config, { timeoutMs } = {}) {
  const c = config.companions?.binaural ?? {};
  const app = c.app ?? 'Music';
  const label = c.label ?? 'binaural beats';
  const found = await musicTrack(app, timeoutMs ? { timeoutMs } : {});

  if (!found.running) {
    return { key: 'binaural', label, verdict: 'off', app, detail: `${app} is not running`, track: null };
  }
  if (found.denied) {
    return {
      key: 'binaural',
      label,
      verdict: 'unknown',
      app,
      detail: `${app} refused the question (grant Automation for ${app})`,
      track: null,
    };
  }
  if (found.playerState !== 'playing') {
    return {
      key: 'binaural',
      label,
      verdict: 'off',
      app,
      detail: found.playerState ? `${app} is ${found.playerState}` : `${app} has nothing loaded`,
      track: found.track ?? null,
    };
  }
  const matched = matchesBinaural(found.track, c.match ?? 'binaural');
  return {
    key: 'binaural',
    label,
    // Playing something else is its own verdict. It is not silence, and it is not
    // the thing you meant to have on, so the panel says which of the two it is.
    verdict: matched ? 'on' : 'other',
    app,
    detail: matched ? 'playing' : 'playing something else',
    track: found.track ?? null,
  };
}

/* ------------------------------------------------------------------ pomodoro --- */

/*
 * Be Focused publishes no state at all: it is not scriptable, its group container
 * holds no running interval, and its status item exposes no AXTitle. The countdown
 * on the menu bar is the only place the timer is legible, so that is what is read.
 */
/**
 * Is anything covering the strip we are about to photograph?
 *
 * A full screen window hides the menu bar, and the status item still reports its
 * frame, so the capture would return whatever the app underneath is drawing there.
 * Static app content reads as a paused timer; an animating one reads as a running
 * timer. Both are warnings invented from a picture of something else.
 *
 * An ordinary window sits below the menu bar, so the test is not "do the rectangles
 * touch" but "does this window reach up into the menu bar at all".
 */
export async function menuBarObstruction(frame, { timeoutMs = 3000 } = {}) {
  let stdout;
  try {
    ({ stdout } = await run(
      '/usr/bin/osascript',
      [
        '-e',
        `tell application "System Events"
           set p to first application process whose frontmost is true
           tell p
             if (count of windows) is 0 then return "no-window"
             try
               if value of attribute "AXFullScreen" of window 1 is true then return "fullscreen"
             end try
             set b to position of window 1
             set z to size of window 1
             return ((item 1 of b) as text) & " " & ((item 2 of b) as text) & " " & ((item 1 of z) as text) & " " & ((item 2 of z) as text)
           end tell
         end tell`,
      ],
      { timeout: timeoutMs }
    ));
  } catch (err) {
    return { clear: null, reason: err.message };
  }

  const answer = stdout.trim();
  if (answer === 'fullscreen') return { clear: false, reason: 'a full screen window is hiding the menu bar' };
  if (answer === 'no-window') return { clear: true };

  const win = parseFrame(answer);
  if (!win.ok) return { clear: null, reason: win.reason };
  if (coversMenuBar(win, frame)) return { clear: false, reason: 'a window is covering the menu bar' };
  return { clear: true };
}

/**
 * An ordinary window starts below the menu bar, so overlapping rectangles is the
 * wrong test: every maximised window touches the bottom edge of the strip. What
 * matters is whether the window reaches up INTO the menu bar, which only a full
 * screen window or one deliberately drawn over it does.
 */
export function coversMenuBar(win, frame) {
  const sideways = win.x < frame.x + frame.width && win.x + win.width > frame.x;
  return sideways && win.y <= frame.y;
}

/**
 * A countdown ticks every second, so with samples spaced further apart than that, every
 * consecutive pair differs. A caller that shortens `sampleGapMs` below 1000, as the companion
 * controls do to answer quickly, trades that certainty for speed and can read a running timer
 * as paused. All the same is a frozen display. One pair
 * differing and the other not is something that crossed the strip and settled, and
 * neither verdict can be honestly read off that.
 */
export function verdictFromSamples(changed) {
  if (changed.every(Boolean)) return 'on';
  if (changed.some(Boolean)) return 'unknown';
  return 'paused';
}

export async function statusItemFrame(app, { timeoutMs = 3000 } = {}) {
  const script = `tell application "System Events"
      if not (exists process "${app}") then return "no-process"
      tell process "${app}"
        if (count of menu bars) < 2 then return "no-status-item"
        set p to position of menu bar item 1 of menu bar 2
        set s to size of menu bar item 1 of menu bar 2
        return ((item 1 of p) as text) & " " & ((item 2 of p) as text) & " " & ((item 1 of s) as text) & " " & ((item 2 of s) as text)
      end tell
    end tell`;
  const { stdout } = await run('/usr/bin/osascript', ['-e', script], { timeout: timeoutMs });
  return parseFrame(stdout);
}

export function parseFrame(stdout) {
  const text = String(stdout).trim();
  if (text === 'no-process') return { ok: false, reason: 'app is not running' };
  if (text === 'no-status-item') return { ok: false, reason: 'no status item on the menu bar' };
  const n = text.split(/[\s,]+/).map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) {
    return { ok: false, reason: `unreadable frame: ${text.slice(0, 40)}` };
  }
  const [x, y, width, height] = n;
  return { ok: true, x, y, width, height };
}

async function capture(frame, file, { timeoutMs = 4000 } = {}) {
  await run(
    '/usr/sbin/screencapture',
    ['-x', '-o', '-R', `${frame.x},${frame.y},${frame.width},${frame.height}`, file],
    { timeout: timeoutMs }
  );
  return fs.readFileSync(file);
}

/**
 * Read the pomodoro from the menu bar.
 *
 * Three captures of the same strip, about a second apart. A running countdown has changed by the
 * second capture; a paused one has not. This distinguishes paused from running, which matters,
 * because a paused pomodoro is the exact state you end up in without noticing.
 */
export async function pomodoroState(config, { sampleGapMs } = {}) {
  const c = config.companions?.pomodoro ?? {};
  const app = c.app ?? 'Be Focused';
  const label = c.label ?? 'pomodoro timer';
  const base = { key: 'pomodoro', label, app };

  if (!(await isRunning(app))) {
    return { ...base, verdict: 'off', detail: `${app} is not running` };
  }

  let frame;
  try {
    frame = await statusItemFrame(app);
  } catch (err) {
    // System Events refused. That is a permission fact about this machine, not a
    // fact about the timer, so it must not read as "you forgot to start one".
    return { ...base, verdict: 'unknown', detail: `menu bar unreadable: ${err.message}` };
  }
  if (!frame.ok) {
    return { ...base, verdict: 'unknown', detail: frame.reason };
  }
  // With the countdown hidden the status item shrinks to its icon, so a narrow item
  // is a timer that is not running at all: no capture needed to know that.
  if (frame.width < (c.minTimerWidth ?? 44)) {
    return { ...base, verdict: 'off', detail: 'no countdown on the menu bar', frame };
  }

  const bar = await menuBarObstruction(frame);
  if (bar.clear === false) {
    return { ...base, verdict: 'unknown', detail: bar.reason, frame };
  }

  const gap = sampleGapMs ?? c.sampleGapMs ?? 1200;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-pomodoro-'));
  try {
    const shots = [];
    for (let i = 0; i < 3; i += 1) {
      if (i) await new Promise((r) => setTimeout(r, gap));
      shots.push(await capture(frame, path.join(dir, `${i}.png`)));
    }
    // Three samples rather than two. A single difference is not enough: a window
    // animating into full screen, a banner, or a menu opening changes the strip
    // once and then settles, and read as a pair that is indistinguishable from a
    // tick. Observed on this machine before the third sample was added.
    const verdict = verdictFromSamples([!shots[0].equals(shots[1]), !shots[1].equals(shots[2])]);
    return {
      ...base,
      verdict,
      detail: {
        on: 'counting down',
        paused: 'showing a frozen time',
        unknown: 'something moved across the menu bar mid-reading',
      }[verdict],
      frame,
      // The strip we actually read, so the reading can be checked rather than
      // trusted. Kept out of the logs: it is a picture of your menu bar.
      image: `data:image/png;base64,${shots[2].toString('base64')}`,
    };
  } catch (err) {
    return {
      ...base,
      verdict: 'unknown',
      detail: `screen capture failed: ${err.message.split('\n')[0]}`,
      frame,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* --------------------------------------------------------------------- both --- */

/**
 * Which companion verdicts are worth interrupting for.
 *
 * The panel's wording lives in `SAYS` in `web/panel.html`; nothing here produces text.
 *
 * @param {object[]} companions  the companion readings to filter.
 * @returns {object[]}           those whose verdict is worth saying something about.
 */
export function warnings(companions) {
  return companions.filter((c) => c.verdict === 'off' || c.verdict === 'paused' || c.verdict === 'other');
}

/**
 * The snapshot cache.
 *
 * Reading the companions costs three screen captures a second apart, so the same reading is
 * reused for `companions.cacheMs`. That makes this an ambient dependency: the same call with the
 * same arguments answers differently depending on when, and in what order, it was called. It is
 * now an ordinary defaulted parameter rather than a hidden module variable, so a caller can see
 * the state it is reading in the signature and a test can hand in a cache of its own instead of
 * inheriting whatever an earlier test left behind. Real callers pass nothing and share this one,
 * which is the behaviour that was there before.
 */
const moduleCache = { snapshot: null };

export function invalidateCompanions(cache = moduleCache) {
  cache.snapshot = null;
}

export async function companionsSnapshot(config, { force = false, overrides = {}, cache = moduleCache } = {}) {
  if (config.companions?.enabled === false) {
    return { enabled: false, at: Date.now(), companions: [] };
  }
  const ttl = config.companions?.cacheMs ?? 15000;
  if (!force && cache.snapshot && Date.now() - cache.snapshot.at < ttl) {
    return applyOverrides(cache.snapshot, overrides);
  }

  const [binaural, pomodoro] = await Promise.all([
    binauralState(config).catch((err) => ({
      key: 'binaural',
      label: config.companions?.binaural?.label ?? 'binaural beats',
      verdict: 'unknown',
      detail: err.message,
    })),
    pomodoroState(config).catch((err) => ({
      key: 'pomodoro',
      label: config.companions?.pomodoro?.label ?? 'pomodoro timer',
      verdict: 'unknown',
      detail: err.message,
    })),
  ]);

  cache.snapshot = { enabled: true, at: Date.now(), companions: [binaural, pomodoro] };
  return applyOverrides(cache.snapshot, overrides);
}

/**
 * Debug overrides. A real reading of "off" needs you to actually stop your music,
 * which is a silly price for looking at the banner, so the debug page can force any
 * verdict. Forced readings are marked so the panel can say so.
 */
function applyOverrides(snapshot, overrides) {
  if (!overrides || !Object.keys(overrides).length) return snapshot;
  return {
    ...snapshot,
    companions: snapshot.companions.map((c) =>
      overrides[c.key] ? { ...c, verdict: overrides[c.key], detail: 'forced from /debug', forced: true } : c
    ),
  };
}
