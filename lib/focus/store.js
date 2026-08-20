// The durable star store. Append-only JSONL under logs/, matching the existing gap-log convention
// rather than introducing a new format. One line per star, each carrying its start and end as
// ISO 8601 with offset. It survives a daemon restart and a reboot because the file is the
// state: open() reads it back exactly, award() appends one line and returns the star.
//
// A malformed line is reported, not silently skipped: a star that cannot be read is a star that was
// earned and lost, which is worse than a loud failure. The error names the 1-based line number.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { localDay } from './blocks.js';

/** Thrown when a line in the star log cannot be parsed. Names the line so it can be found and fixed. */
export class StarLogError extends Error {
  constructor(line, detail) {
    super(`star log line ${line} is unreadable: ${detail}. Remedy: fix or remove that line; it holds a star that was earned.`);
    this.name = 'StarLogError';
    this.line = line;
  }
}

/**
 * @param {string} filePath JSONL file; the directory is created here, the file on the first
 * star.
 * @returns {{ award, starsForDay, starsForMonth, all, path }}
 */
export function open(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stars = read(filePath);

  function award(blockCompleted) {
    const star = {
      id: crypto.randomUUID(),
      startedAt: blockCompleted.startedAt,
      endedAt: blockCompleted.endedAt,
      day: blockCompleted.day ?? localDay(blockCompleted.endedAt),
    };
    fs.appendFileSync(filePath, JSON.stringify(star) + '\n');
    stars.push(star);
    return star;
  }

  return {
    award,
    all: () => stars.slice(),
    starsForDay: (day) => stars.filter((s) => s.day === day),
    starsForMonth: (yyyyMM) => stars.filter((s) => s.day.startsWith(yyyyMM)),
    path: filePath,
  };
}

/** Read the whole log, throwing StarLogError on the first unreadable non-empty line. */
export function read(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const stars = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.trim() === '') continue; // a trailing newline is not a malformed line
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (err) {
      throw new StarLogError(i + 1, err.message);
    }
    if (!obj || typeof obj.startedAt !== 'string' || typeof obj.endedAt !== 'string') {
      throw new StarLogError(i + 1, 'missing startedAt or endedAt');
    }
    stars.push(obj);
  }
  return stars;
}
