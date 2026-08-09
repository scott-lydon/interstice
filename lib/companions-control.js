import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isRunning, launchHeadless } from './state/system.js';
import { matchesBinaural, pomodoroState } from './state/companions.js';

const run = promisify(execFile);

/**
 * The two things the setup check reports, made pressable.
 *
 * The check itself is a report and stays one: `state/companions.js` reads and never
 * acts, because a thing that starts your music while telling you about your music
 * cannot be trusted to describe it. Doing is here instead, and only ever from a
 * button you pressed.
 *
 * Nothing here raises an app either. Music is told to play and stays where it is;
 * Be Focused is sent the shortcut it already answers to. The panel keeps the screen.
 */

/* ------------------------------------------------------------------ binaural --- */

/** AppleScript has no escape for a string literal, so the search terms are kept plain. */
export function safeTerm(term) {
  return String(term).replace(/[^\p{L}\p{N} .'-]/gu, '').slice(0, 40);
}

/** A separator no track name carries, so punctuation in a title survives the trip. */
const TRACK_SPLIT = '\t';

/**
 * Every track whose name carries one of the search words.
 *
 * Asked of the library rather than of a playlist you have to have made. Persistent
 * IDs come back with the names because two files can carry the same title, and
 * playing "the first track called X" is how you end up listening to the other one.
 */
export async function findBinauralTracks(config, { timeoutMs = 8000 } = {}) {
  const c = config.companions?.binaural ?? {};
  const app = c.app ?? 'Music';
  const terms = (c.search ?? ['binaural', 'isochronic', 'solfeggio', 'hz']).map(safeTerm).filter(Boolean);
  if (!terms.length) return [];

  const clauses = terms
    .map(
      (t) => `try
         repeat with x in (every track of library playlist 1 whose name contains "${t}")
           set out to out & (persistent ID of x) & tab & (name of x) & linefeed
         end repeat
       end try`
    )
    .join('\n');

  const { stdout } = await run(
    '/usr/bin/osascript',
    ['-e', `tell application "${app}"\n set out to ""\n ${clauses}\n return out\nend tell`],
    { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }
  );

  const seen = new Set();
  const tracks = [];
  for (const line of stdout.split('\n')) {
    const [id, ...rest] = line.split(TRACK_SPLIT);
    const name = rest.join(TRACK_SPLIT).trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    tracks.push({ id: id.trim(), name });
  }
  // The search words are broad on purpose, so "40 Hz" also finds "Hzardous". The
  // pattern the check already uses is what decides whether it counts.
  return tracks.filter((t) => matchesBinaural(t.name, c.match ?? 'binaural'));
}

/**
 * Put the track on.
 *
 * Launched with `open -g` first, so a Music that was not running comes up behind
 * the panel rather than over it: `tell application "Music" to play` starts it too,
 * but starts it in front, and an app taking the screen is the thing this project
 * exists to stop doing to you.
 */
export async function playBinaural(config, { timeoutMs = 10000 } = {}) {
  const c = config.companions?.binaural ?? {};
  const app = c.app ?? 'Music';
  const label = c.label ?? 'binaural beats';

  const wasRunning = await isRunning(app);
  if (!wasRunning) {
    await launchHeadless(app);
    await new Promise((r) => setTimeout(r, 1200));
  }

  const tell = async (body) => {
    const { stdout } = await run('/usr/bin/osascript', ['-e', `tell application "${app}"\n${body}\nend tell`], {
      timeout: timeoutMs,
    });
    return stdout.trim();
  };

  try {
    if (c.playlist) {
      const played = await tell(`play playlist "${safeTerm(c.playlist)}"\nreturn (name of current track)`);
      return { ok: true, app, label, playing: played, chosenBy: 'playlist' };
    }

    const tracks = await findBinauralTracks(config);
    if (!tracks.length) {
      return {
        ok: false,
        app,
        label,
        reason: 'no_match',
        // Say what was looked for. "Nothing found" without the query is a dead end.
        detail: `no track in ${app} matches ${c.match ?? 'binaural'}`,
        how: [
          `Add the track to ${app}, or`,
          'name a playlist in config: companions.binaural.playlist',
        ],
      };
    }
    const wanted = c.track ? tracks.find((t) => t.name === c.track) ?? tracks[0] : tracks[0];
    const played = await tell(
      `play (first track of library playlist 1 whose persistent ID is "${wanted.id}")\n`
        + 'return (name of current track)'
    );
    return {
      ok: true,
      app,
      label,
      playing: played || wanted.name,
      chosenBy: c.track ? 'configured track' : 'first match in your library',
      candidates: tracks.length,
    };
  } catch (err) {
    const denied = /-1743|not authori[sz]ed/i.test(err.message);
    return {
      ok: false,
      app,
      label,
      reason: denied ? 'automation_denied' : 'refused',
      detail: err.message.split('\n')[0],
      how: denied
        ? [`Allow Interstice to control ${app} in System Settings → Privacy & Security → Automation`]
        : [],
    };
  }
}

/* ------------------------------------------------------------------ pomodoro --- */

/**
 * Be Focused publishes nothing, is not scriptable, and its status item refuses
 * AXPress. What it does have is a pair of global shortcuts, stored in its own
 * preferences as archived `MASShortcut` objects, and a shortcut it registered is a
 * shortcut it will answer.
 *
 * So the timer is started the way you would start it: by pressing the keys. The
 * settings are read from the app rather than guessed, because a hardcoded ⌘⇧R that
 * the app is not listening for lands in whatever is in front instead.
 */
export const NS_MODIFIERS = [
  [1 << 17, 'shift down'],
  [1 << 18, 'control down'],
  [1 << 19, 'option down'],
  [1 << 20, 'command down'],
];

export function modifierClause(flags) {
  const on = NS_MODIFIERS.filter(([bit]) => (flags & bit) !== 0).map(([, name]) => name);
  return on.length ? ` using {${on.join(', ')}}` : '';
}

export function parseShortcutPlist(xml) {
  const key = xml.match(/<key>KeyCode<\/key>\s*<integer>(-?\d+)<\/integer>/);
  const mods = xml.match(/<key>ModifierFlags<\/key>\s*<integer>(-?\d+)<\/integer>/);
  if (!key) return null;
  const keyCode = Number(key[1]);
  if (keyCode < 0) return null;
  return { keyCode, flags: mods ? Number(mods[1]) : 0 };
}

/**
 * Where an app's preferences actually are.
 *
 * A sandboxed app keeps them inside its container, and Be Focused is one: there is
 * no `~/Library/Preferences/com.xwavesoft.pomodoromaclite.plist` at all. Both are
 * tried, container first, because that is where the answer is for the app this was
 * written against.
 */
export function preferenceFiles(bundleId, { home = os.homedir() } = {}) {
  return [
    path.join(home, 'Library', 'Containers', bundleId, 'Data', 'Library', 'Preferences', `${bundleId}.plist`),
    path.join(home, 'Library', 'Preferences', `${bundleId}.plist`),
  ];
}

/**
 * One shortcut out of another app's preferences.
 *
 * Read from the file rather than through `defaults`. `defaults read` prints
 * archived data as `{length = 257, bytes = 0x62706c69 ...}`, which is not something
 * to parse, and `defaults export`, which prints it intact, goes through cfprefsd
 * and can simply never return: measured here at over two minutes against a live
 * app, from a command that had answered in milliseconds an hour earlier. A button
 * that hangs the panel is worse than one that does nothing.
 *
 * The value is itself an archived plist, so plutil is asked twice: once for the
 * bytes, once to make them readable.
 */
export async function readShortcut(bundleId, name, { timeoutMs = 4000, home = os.homedir() } = {}) {
  const file = preferenceFiles(bundleId, { home }).find((f) => fs.existsSync(f));
  if (!file) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-shortcut-'));
  try {
    const { stdout: b64 } = await run('/usr/bin/plutil', ['-extract', name, 'raw', '-o', '-', file], {
      timeout: timeoutMs,
    });
    const inner = path.join(dir, 'shortcut.plist');
    fs.writeFileSync(inner, Buffer.from(b64.trim(), 'base64'));
    const { stdout: xml } = await run('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', inner], {
      timeout: timeoutMs,
    });
    return parseShortcutPlist(xml);
  } catch {
    // No shortcut set is the ordinary case on a fresh install, not a failure.
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function pressShortcut(shortcut, { timeoutMs = 4000 } = {}) {
  await run(
    '/usr/bin/osascript',
    ['-e', `tell application "System Events" to key code ${shortcut.keyCode}${modifierClause(shortcut.flags)}`],
    { timeout: timeoutMs }
  );
  return true;
}

/**
 * Answer Be Focused's "are you sure you want to skip the current interval?".
 *
 * Skipping is what resets the clock to a whole interval, and Be Focused asks before
 * it does. That question cannot be answered by pressing Return: the panel it
 * appears in never takes keyboard focus, so Return, Escape and a click at the
 * button's coordinates all leave it sitting there, and every later keystroke lands
 * on a dialog instead of on the timer. It can be answered through accessibility,
 * where the two buttons carry their titles.
 *
 * Asked for repeatedly rather than once: the confirmation takes a moment to appear,
 * and a timer that was already stopped never asks at all.
 */
export async function answerSkipConfirmation(app, { answer = 'Skip', timeoutMs = 3000 } = {}) {
  const script = `tell application "System Events" to tell process "${app}"
      repeat with n from 1 to ${Math.max(1, Math.round(timeoutMs / 250))}
        repeat with w in windows
          try
            click (first button of w whose title is "${answer}")
            return "answered"
          end try
        end repeat
        delay 0.25
      end repeat
      return "never asked"
    end tell`;
  try {
    const { stdout } = await run('/usr/bin/osascript', ['-e', script], { timeout: timeoutMs + 4000 });
    return stdout.trim();
  } catch (err) {
    return `unanswered: ${err.message.split('\n')[0]}`;
  }
}

/**
 * Start a fresh interval, not a resumed one.
 *
 * Skip first, answer the confirmation, then start. Pressing start on its own
 * resumes: press it on a timer you paused eleven minutes in and you get eleven
 * minutes, which is the wrong answer for a button that says twenty-five.
 */
export async function startPomodoro(config, { minutes = 25 } = {}) {
  const c = config.companions?.pomodoro ?? {};
  const app = c.app ?? 'Be Focused';
  const label = c.label ?? 'pomodoro timer';
  const bundleId = c.bundleId ?? 'com.xwavesoft.pomodoromaclite';
  const base = { app, label, minutes, bundleId };

  const wasRunning = await isRunning(app);
  if (!wasRunning) {
    await launchHeadless(app);
    // A shortcut is only answered once the app has registered it, and it registers
    // on launch. Pressing the keys into the gap sends them to whatever is in front.
    await new Promise((r) => setTimeout(r, 2500));
  }

  const [start, stop] = await Promise.all([
    readShortcut(bundleId, c.startShortcutKey ?? 'startShortcut'),
    readShortcut(bundleId, c.stopShortcutKey ?? 'stopShortcut'),
  ]);

  if (!start) {
    return {
      ...base,
      ok: false,
      reason: 'no_shortcut',
      detail: `${app} has no start shortcut set, so there is no way to press for you`,
      how: [
        `Open ${app} → Preferences → Shortcuts`,
        'Set a shortcut for Start, and one for Skip so this button can begin a whole interval',
        'Then press this button again',
      ],
    };
  }

  // Skip is what puts the clock back to a whole interval, and it asks first. The
  // question has to be answered before anything else is pressed: while it is open
  // the timer ignores its own shortcuts, so a start sent into it does nothing and
  // leaves a dialog on your screen.
  let skipped = null;
  if (stop) {
    await pressShortcut(stop);
    skipped = await answerSkipConfirmation(app);
    await new Promise((r) => setTimeout(r, 700));
  }

  // Look before pressing. Start is a toggle, and Be Focused begins the new interval
  // by itself after a skip: pressing start on top of that pauses the timer you just
  // asked for. Measured, not assumed: the menu bar read 24:56 and stayed there.
  let state = await pomodoroState(config, { sampleGapMs: 700 });
  let pressedStart = false;
  if (state.verdict !== 'on') {
    await pressShortcut(start);
    pressedStart = true;
    await new Promise((r) => setTimeout(r, 700));
    state = await pomodoroState(config, { sampleGapMs: 700 });
  }

  return {
    ...base,
    // The claim is not "it started": this is the menu bar, read afterwards. The
    // panel shows the strip that was read, so it can be checked rather than trusted.
    ok: state.verdict === 'on',
    verdict: state.verdict,
    detail: state.detail,
    reset: Boolean(stop),
    skipped,
    pressedStart,
    pressed: { start, skip: stop ?? null },
    ...(state.verdict === 'on'
      ? {}
      : {
          how: [
            `${app} did not start. Click its menu bar timer and press play`,
            'If nothing happens there either, the interval may be waiting on a dialog in the app',
          ],
        }),
    ...(stop
      ? {}
      : {
          note: `${app} has no skip shortcut set, so this resumed the current interval `
            + `rather than starting a new ${minutes} minute one`,
        }),
  };
}
