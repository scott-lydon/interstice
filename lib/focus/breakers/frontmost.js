// Breaker: a blacklisted app becoming frontmost forfeits the focus block (S2a). It reuses the
// repo's existing frontmost-app probe (lib/state/system.js, lsappinfo, no Accessibility grant)
// rather than adding a second mechanism, and it emits only a plain BreakEvent, knowing nothing
// about stars or blocks.
//
// S4: Interstice's own panel is permanently whitelisted, encoded here as a constant so a user
// cannot break it by editing config. The blacklist itself is opt-in via `focus.blacklistApps`.

import { frontmostApp } from '../../state/system.js';

/**
 * Apps that never break a focus block, no matter the config. The panel is the product's answer to
 * the gap, so using it is focus, not distraction. This is a constant, not a config default.
 */
export const PANEL_APPS = ['Interstice', 'interstice'];

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
export function decideFrontmost({ app, at }, { blacklistApps = [] } = {}) {
  if (!app) return null;
  if (PANEL_APPS.some((w) => matches(app, w))) return null; // S4: the panel never breaks its block
  const hit = blacklistApps.find((entry) => matches(app, entry));
  if (!hit) return null;
  return { cause: 'app', at, detail: `${app} (matched blacklist entry "${hit}")` };
}

/**
 * The breaker, with the three-function interface every breaker shares. `frontmost` is injectable so
 * a test can drive it with a synthetic signal and no live app.
 */
export function createFrontmostBreaker({ blacklistApps, frontmost = frontmostApp } = {}) {
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
      const app = await frontmost();
      return decideFrontmost({ app, at: nowISO }, { blacklistApps });
    },
  };
}
