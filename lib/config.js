import fs from 'node:fs';
import { CONFIG_FILE, CONFIG_DEFAULT } from './paths.js';

const KNOWN_RUNGS = new Set(['flashcards', 'reading', 'queue_prompt', 'todo']);

/**
 * The shipped configuration, read fresh from disk every call.
 *
 * Not cached and not frozen, because `writeUserConfig` merges a patch on top of the
 * object it returns and a shared copy would accumulate one user's edits.
 */
export function defaults() {
  return JSON.parse(fs.readFileSync(CONFIG_DEFAULT, 'utf8'));
}

/** Deep merge, with user values winning. Arrays are replaced, never concatenated. */
function merge(base, over) {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base) || typeof base !== 'object' || typeof over !== 'object') return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

/**
 * Everything wrong with a candidate config, as a list of sentences.
 *
 * Returns them all rather than throwing on the first: a person editing this file by
 * hand should learn about all four mistakes in one run, not across four runs. The
 * caller decides whether a bad config is fatal.
 */
export function validate(cfg) {
  const errors = [];
  const num = (k, min, max) => {
    const v = cfg[k];
    if (typeof v !== 'number' || Number.isNaN(v)) errors.push(`${k} must be a number`);
    else if (v < min || v > max) errors.push(`${k} must be between ${min} and ${max} (got ${v})`);
  };
  num('arm', 1, 3600);
  num('mid', 1, 7200);
  num('long', 1, 14400);
  num('cooldown', 0, 3600);
  num('idleVetoMs', 0, 120000);
  num('port', 1024, 65535);

  if (!(cfg.arm < cfg.mid && cfg.mid < cfg.long)) {
    errors.push(`thresholds must strictly increase: arm(${cfg.arm}) < mid(${cfg.mid}) < long(${cfg.long})`);
  }
  if (!Array.isArray(cfg.ladder) || cfg.ladder.length === 0) {
    errors.push('ladder must be a non-empty array');
  } else {
    for (const r of cfg.ladder) if (!KNOWN_RUNGS.has(r)) errors.push(`unknown rung "${r}"`);
    if (new Set(cfg.ladder).size !== cfg.ladder.length) errors.push('ladder contains duplicates');
  }
  if (!['take', 'offer'].includes(cfg.focusMode)) errors.push('focusMode must be "take" or "offer"');
  if (!Array.isArray(cfg.originApps) || cfg.originApps.length === 0) {
    errors.push('originApps must be a non-empty array');
  }
  if (cfg.quietHours !== null) {
    const quietHours = cfg.quietHours;
    const ok = quietHours && typeof quietHours.start === 'number' && typeof quietHours.end === 'number'
      && quietHours.start >= 0 && quietHours.start < 24 && quietHours.end >= 0 && quietHours.end < 24;
    if (!ok) errors.push('quietHours must be null or {start:0-23, end:0-23}');
  }
  return errors;
}

let cached = null;

/**
 * The effective configuration: shipped defaults with the user's file merged over.
 *
 * Cached and frozen after the first call, because every rung and every route reads
 * it and a config that changed mid-decision would make the logs unreadable. Pass
 * `force` to re-read, which is what `writeUserConfig` arranges by clearing it.
 *
 * Throws on invalid config rather than falling back to defaults. Silently running
 * with settings nobody chose is the failure that looks like the tool ignoring you.
 */
export function load({ force = false } = {}) {
  if (cached && !force) return cached;
  const base = defaults();
  let user = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (err) {
      throw new Error(`config/interstice.config.json is not valid JSON: ${err.message}`);
    }
  }
  const cfg = merge(base, user);
  const errors = validate(cfg);
  if (errors.length) {
    throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  }
  cached = Object.freeze(cfg);
  return cached;
}

/**
 * Merge a patch into the user's config file, refusing to write an invalid result.
 *
 * Validated against defaults-plus-patch rather than the patch alone, so a partial
 * write cannot be judged against fields it never set. Only the user's own keys are
 * written back: the file stays a short list of what you changed rather than a copy
 * of every default, which is what makes a later default change reach you.
 */
export function writeUserConfig(patch = {}) {
  const current = fs.existsSync(CONFIG_FILE)
    ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    : {};
  const next = merge(current, patch);
  const errors = validate(merge(defaults(), next));
  if (errors.length) throw new Error(`Refusing to write invalid config:\n  - ${errors.join('\n  - ')}`);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n');
  cached = null;
  return next;
}
