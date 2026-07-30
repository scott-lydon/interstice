import fs from 'node:fs';
import { CONFIG_FILE, CONFIG_DEFAULT } from './paths.js';

const KNOWN_RUNGS = new Set(['flashcards', 'reading', 'queue_prompt', 'todo']);

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
    const q = cfg.quietHours;
    const ok = q && typeof q.start === 'number' && typeof q.end === 'number'
      && q.start >= 0 && q.start < 24 && q.end >= 0 && q.end < 24;
    if (!ok) errors.push('quietHours must be null or {start:0-23, end:0-23}');
  }
  return errors;
}

let cached = null;

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
