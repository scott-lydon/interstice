// Breaker: a blacklisted app becoming frontmost forfeits the focus block. It reuses the
// repo's existing frontmost-app probe (lib/state/system.js, lsappinfo, no Accessibility grant)
// rather than adding a second mechanism, and it emits only a plain BreakEvent, knowing nothing
// about stars or blocks.
//
// Interstice's own panel is permanently whitelisted, encoded here as a constant so a user
// cannot break it by editing config. The blacklist itself is opt-in via `focus.blacklistApps`.

import fs from 'node:fs';
import { frontmostApp, frontmostAppPid } from '../../state/system.js';
import { PANEL_PID } from '../../paths.js';

/**
 * Apps that never break a focus block, no matter the config. This is a constant, not a config
 * default. It covers the hotkey applets, which do run under their own name.
 *
 * It does NOT cover the panel window, and cannot: the panel is a Chrome `--app=` window, so the
 * frontmost-app probe reports the owning application and it reads as "Google Chrome". Recognising
 * the panel is `panelIsFrontmost` below, by process id.
 */
export const PANEL_APPS = ['Interstice', 'interstice'];

/**
 * Is the frontmost process our own panel?
 *
 * The panel is the product's answer to the gap, so using it is focus, not distraction, and the
 * settled design says it can never forfeit its own block. Matching by name cannot deliver that,
 * so this compares the frontmost pid against the one the panel recorded when it opened.
 */
export function panelIsFrontmost(pid, { pidFile = PANEL_PID, read = fs.readFileSync } = {}) {
  if (!pid) return false;
  try {
    return Number(String(read(pidFile, 'utf8')).trim()) === Number(pid);
  } catch {
    return false; // no panel running, so nothing to exempt
  }
}

// There is deliberately no default blacklist literal here. The shipped list lives in exactly one
// place, `focus.blacklistApps` in config/interstice.config.default.json, and a copy of it in this
// file was a second source of truth that nothing kept in step with the first (or with the README,
// which quotes it a third time). The caller passes the list it read from config.

function matches(app, entry) {
  // Case-insensitive substring, so "Slack" catches "Slack" and "Slack (2)".
  return String(app).toLowerCase().includes(String(entry).toLowerCase());
}

/**
 * The pure decision: given the frontmost app and the blacklist, is this a break?
 * @returns {{cause:'app', at:string, detail:string} | null}
 */
export function decideFrontmost({ app, at, pid }, { blacklistApps = [], isPanel = panelIsFrontmost } = {}) {
  if (!app) return null;
  if (PANEL_APPS.some((w) => matches(app, w))) return null; // the hotkey applets
  if (isPanel(pid)) return null; // our own panel window, whatever Chrome calls itself
  const hit = blacklistApps.find((entry) => matches(app, entry));
  if (!hit) return null;
  return { cause: 'app', at, detail: `${app} (matched blacklist entry "${hit}")` };
}

/**
 * The breaker, with the three-function interface every breaker shares. `frontmost` is injectable so
 * a test can drive it with a synthetic signal and no live app.
 */
export function createFrontmostBreaker({ blacklistApps, frontmost = frontmostApp, frontPid = frontmostAppPid } = {}) {
  if (!Array.isArray(blacklistApps)) {
    throw new Error(
      `createFrontmostBreaker needs blacklistApps as an array, got ${JSON.stringify(blacklistApps)}. ` +
        'Remedy: pass config.focus.blacklistApps, whose shipped value is in config/interstice.config.default.json.'
    );
  }
  return {
    name: () => 'frontmost-app',
    describe: () => `breaks a block when a blacklisted app is frontmost (${blacklistApps.length} on the list)`,
    async probe(nowISO = new Date().toISOString()) {
      const [app, pid] = await Promise.all([frontmost(), frontPid()]);
      return decideFrontmost({ app, at: nowISO, pid }, { blacklistApps });
    },
  };
}
