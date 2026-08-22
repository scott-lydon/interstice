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

/**
 * Read a .jsonl file into records, plus a record of every line that could not be parsed.
 *
 * The skipping is deliberate: one truncated line at the end of logs/gaps.jsonl, which is what a
 * kill or a full disk leaves behind, must not take the whole dashboard down with it. What was not
 * deliberate is that the loss left no trace anywhere. Every figure the dashboard shows is computed
 * from this file, so a dropped gap is a number that is quietly wrong, and the operator has no way
 * to tell a real slow day from a log that stopped parsing.
 *
 * So the loss is now itself data. Line numbers are 1-based, because that is what an editor and
 * `sed -n` count in, and the preview is truncated because a malformed line is untrusted input that
 * ends up in a JSON response.
 *
 * @returns {{records: object[], malformed: Array<{line:number, error:string, preview:string}>}}
 */
export function readJsonlWithErrors(file, { limit = Infinity } = {}) {
  if (!fs.existsSync(file)) return { records: [], malformed: [] };
  const out = [];
  const malformed = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      malformed.push({ line: i + 1, error: err.message, preview: line.slice(0, 120) });
    }
  }
  return { records: out.length > limit ? out.slice(-limit) : out, malformed };
}

/**
 * The records only, for the many callers that have nothing to do with a parse failure.
 *
 * Kept as the plain-array call it always was rather than changed to the pair: a caller that cannot
 * act on a malformed line should not be made to destructure around one. The callers that CAN act
 * (the routes that feed the dashboard) use `readJsonlWithErrors` and surface what it reports.
 */
export function readJsonl(file, opts = {}) {
  return readJsonlWithErrors(file, opts).records;
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
