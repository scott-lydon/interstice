import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { classify } from './transcript.js';

/**
 * Event-driven transcript watcher. No polling.
 *
 * macOS FSEvents (reached through Node's recursive fs.watch, which sits on it via
 * libuv) pushes a callback when anything under the root changes. Between events this
 * does no work at all: no timers, no directory scans, no stat loops.
 *
 * The case that matters is a *new* session, because Cowork creates a fresh directory
 * tree per session and the transcript lands six levels deep in folders that did not
 * exist when the watch started. Recursive FSEvents covers that; it was measured at
 * 13ms from append to callback for exactly that shape.
 *
 * Reads are incremental: we keep a byte offset per file and only ever read what was
 * appended. A file that shrinks (rotation, truncation) resets its offset to zero.
 */
export class TranscriptWatcher extends EventEmitter {
  /**
   * @param {object}   opts
   * @param {string}   opts.root      directory to watch recursively
   * @param {string}   opts.surface   'cowork' | 'claude-code'
   * @param {RegExp}   [opts.match]   which files are transcripts
   * @param {boolean}  [opts.seedOffsets] start at EOF for files that already exist
   */
  constructor({ root, surface, match = /\.jsonl$/, seedOffsets = true }) {
    super();
    this.root = root;
    this.surface = surface;
    this.match = match;
    this.seedOffsets = seedOffsets;
    this.offsets = new Map();
    this.watcher = null;
    this.started = false;
    this.pending = new Set();
    this.flushTimer = null;
  }

  start() {
    if (this.started) return this;
    if (!fs.existsSync(this.root)) {
      this.emit('warning', { code: 'ROOT_MISSING', root: this.root });
      return this;
    }
    if (this.seedOffsets) this.#seed();

    try {
      this.watcher = fs.watch(this.root, { recursive: true }, (_type, rel) => {
        if (!rel) return;
        const abs = path.join(this.root, rel);
        if (!this.match.test(abs)) return;
        this.#schedule(abs);
      });
    } catch (err) {
      this.emit('error', Object.assign(err, { code: err.code || 'WATCH_FAILED' }));
      return this;
    }
    this.watcher.on('error', (err) => this.emit('error', err));
    this.started = true;
    this.emit('started', { root: this.root, surface: this.surface, seeded: this.offsets.size });
    return this;
  }

  /**
   * Record current sizes so an existing backlog is not replayed as a burst of gaps
   * the moment the daemon boots.
   */
  #seed() {
    const stack = [this.root];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (this.match.test(p)) {
          try {
            this.offsets.set(p, fs.statSync(p).size);
          } catch {
            /* vanished between readdir and stat */
          }
        }
      }
    }
  }

  /**
   * FSEvents coalesces, and a single append can produce several callbacks. Batch by
   * file across one tick so we read each changed file once per burst. This is a
   * debounce on already-delivered events, not a poll.
   */
  #schedule(abs) {
    this.pending.add(abs);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const files = [...this.pending];
      this.pending.clear();
      for (const f of files) this.#drain(f);
    }, 15);
    if (typeof this.flushTimer.unref === 'function') this.flushTimer.unref();
  }

  #drain(file) {
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      this.offsets.delete(file);
      return;
    }
    const prev = this.offsets.get(file) ?? 0;
    if (size === prev) return;
    if (size < prev) {
      this.offsets.set(file, 0); // truncated or replaced
      return this.#drain(file);
    }

    let chunk;
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const buf = Buffer.allocUnsafe(size - prev);
        const read = fs.readSync(fd, buf, 0, buf.length, prev);
        chunk = buf.subarray(0, read).toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      this.emit('warning', { code: 'READ_FAILED', file, message: err.message });
      return;
    }

    // A trailing partial line is left unconsumed so the next event re-reads it whole.
    const lastNewline = chunk.lastIndexOf('\n');
    if (lastNewline === -1) return;
    const complete = chunk.slice(0, lastNewline);
    this.offsets.set(file, prev + Buffer.byteLength(complete, 'utf8') + 1);

    for (const line of complete.split('\n')) {
      const ev = classify(line, { surface: this.surface, file });
      if (ev) this.emit(ev.event, ev);
    }
  }

  stop() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.watcher?.close();
    this.watcher = null;
    this.started = false;
    return this;
  }
}
