import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Find where AnkiConnect is actually listening.
 *
 * The documented default is 8765, but the port and bind address are user editable
 * in the addon's own config, and an API key can be required. Hardcoding 8765 was
 * the first thing to break on a real machine: this host runs AnkiConnect on 8766,
 * so the flashcard rung would have been permanently unavailable with no error
 * anywhere. Exactly the silent-null class of failure this project exists to avoid.
 *
 * So we read the addon's config, and fall back to the documented default.
 */

export const ANKICONNECT_ADDON_ID = '2055492159';

export function addonConfigPath({ home = os.homedir() } = {}) {
  return path.join(
    home,
    'Library',
    'Application Support',
    'Anki2',
    'addons21',
    ANKICONNECT_ADDON_ID,
    'config.json'
  );
}

export const FALLBACK = { url: 'http://127.0.0.1:8765', apiKey: null, source: 'default' };

/**
 * @returns {{url: string, apiKey: string|null, source: 'addon-config'|'default'}}
 */
export function discover({ home = os.homedir() } = {}) {
  const file = addonConfigPath({ home });
  if (!fs.existsSync(file)) return { ...FALLBACK };
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ...FALLBACK };
  }
  const port = Number(cfg.webBindPort) || 8765;
  // A missing or 0.0.0.0 bind address is read as loopback; any other address the addon names is
  // used as it stands.
  const addr = cfg.webBindAddress && cfg.webBindAddress !== '0.0.0.0' ? cfg.webBindAddress : '127.0.0.1';
  return {
    url: `http://${addr}:${port}`,
    apiKey: cfg.apiKey ?? null,
    source: 'addon-config',
  };
}

/**
 * Resolve the endpoint for a loaded config. An explicit `anki.url` always wins, so
 * a user can point at a remote or unusual setup; otherwise we discover.
 */
export function resolveEndpoint(config, opts = {}) {
  if (config?.anki?.url) {
    return { url: config.anki.url, apiKey: config.anki.apiKey ?? null, source: 'config' };
  }
  const found = discover(opts);
  return { ...found, apiKey: config?.anki?.apiKey ?? found.apiKey };
}
