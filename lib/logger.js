import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR, DAEMON_LOG } from './paths.js';

export function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/** Append one JSON record per line. Creates the directory on first use. */
export function appendJsonl(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
  return record;
}

/** Read a .jsonl file into an array, skipping malformed lines rather than throwing. */
export function readJsonl(file, { limit = Infinity } = {}) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return out.length > limit ? out.slice(-limit) : out;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger({ level = 'info', toFile = false, stream = process.stderr } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, msg, extra) => {
    if (LEVELS[lvl] < min) return;
    const line = `${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} ${msg}${
      extra ? ' ' + JSON.stringify(extra) : ''
    }\n`;
    if (toFile) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.appendFileSync(DAEMON_LOG, line);
    } else {
      stream.write(line);
    }
  };
  return {
    debug: (m, e) => write('debug', m, e),
    info: (m, e) => write('info', m, e),
    warn: (m, e) => write('warn', m, e),
    error: (m, e) => write('error', m, e),
  };
}
