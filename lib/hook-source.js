import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { LOG_DIR } from './paths.js';

export const HOOK_EVENTS = path.join(LOG_DIR, 'hook-events.jsonl');

/**
 * Claude Code hooks are separate short-lived processes, so they cannot call into the
 * daemon directly. They append a line; we watch that one file with the same
 * event-driven mechanism used for transcripts. Still no polling.
 */
export class HookSource extends EventEmitter {
  constructor({ file = HOOK_EVENTS } = {}) {
    super();
    this.file = file;
    this.offset = 0;
    this.watcher = null;
  }

  start() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '');
    this.offset = fs.statSync(this.file).size;

    // Watch the directory rather than the file: editors and log rotation replace
    // inodes, and a file-level watch would silently follow the dead inode.
    this.watcher = fs.watch(path.dirname(this.file), (_t, name) => {
      if (name && path.basename(this.file) !== name) return;
      this.#drain();
    });
    this.watcher.on('error', (err) => this.emit('error', err));
    return this;
  }

  #drain() {
    let size;
    try {
      size = fs.statSync(this.file).size;
    } catch {
      return;
    }
    if (size < this.offset) this.offset = 0;
    if (size === this.offset) return;

    const fd = fs.openSync(this.file, 'r');
    let chunk;
    try {
      const buf = Buffer.allocUnsafe(size - this.offset);
      const read = fs.readSync(fd, buf, 0, buf.length, this.offset);
      chunk = buf.subarray(0, read).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }

    const lastNewline = chunk.lastIndexOf('\n');
    if (lastNewline === -1) return;
    const complete = chunk.slice(0, lastNewline);
    this.offset += Buffer.byteLength(complete, 'utf8') + 1;

    for (const line of complete.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.event) this.emit(ev.event, ev);
      } catch {
        /* skip malformed */
      }
    }
  }

  stop() {
    this.watcher?.close();
    this.watcher = null;
    return this;
  }
}
