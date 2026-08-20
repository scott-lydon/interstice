import fs from 'node:fs';
import { Engine } from './engine.js';
import { TranscriptWatcher } from './watcher.js';
import { HookSource } from './hook-source.js';
import { createServer } from './server.js';
import { Panel } from './panel.js';
import { Reader } from './reader.js';
import { createReadingSurface } from './reading.js';
import { createLogger, ensureLogDir } from './logger.js';
import {
  COWORK_SESSIONS_ROOT,
  CLAUDE_CODE_PROJECTS,
  PID_FILE,
} from './paths.js';

import { open as openStarStore } from './focus/store.js';
import { createFocusTracker } from './focus/tracker.js';
import { createLatency, latencyEventFromEngine } from './latency.js';
import { LOG_DIR } from './paths.js';
import path from 'node:path';

/**
 * Wires the sources to the engine and stands up the control surface.
 *
 * Both surfaces feed one engine, so a gap opened in Cowork and a gap opened in the
 * CLI are the same kind of object. If hooks ever ship for Cowork, its watcher is
 * swapped for a HookSource here and nothing else in the system changes.
 */
export class Daemon {
  constructor({ config, logger = createLogger({ toFile: true }) }) {
    this.config = config;
    this.logger = logger;
    this.panel = new Panel({ config, logger });
    // The book renders here rather than in a window of its own. Nothing starts it
    // but the reading rung being on screen, and it puts itself away when it is not.
    this.reader = new Reader({ config, logger });
    // The only reading surface anything outside this file is allowed to hold. lib/server.js used
    // to name dozens of members of the Reader directly, three of them plain fields, which meant an
    // HTTP route could only be understood by reading much the largest class in lib/ as well.
    // See lib/reading.js.
    this.reading = createReadingSurface({ reader: this.reader });
    this.stars = openStarStore(path.join(LOG_DIR, 'stars.jsonl'));
    // The tracker is what turns the focus machine, the breakers and the store from three tested
    // modules into a running feature. Without it nothing ever calls `stars.award`.
    this.focus = createFocusTracker({ config, stars: this.stars, logger });
    // One latency clock for the whole daemon, fed by the same submit and end events the engine
    // sees, so the indicator can never disagree with the gap it is timing.
    this.latency = createLatency();
    this.engine = new Engine({ config, logger, panel: this.panel });
    this.sources = [];
    this.server = null;
    this.lastEventAt = null;
    // The most recent arrival, held so the panel can raise its own notification for it.
    this.lastDelivery = null;
    this.startedAt = null;
    this.heartbeatTimer = null;
    this.readerSweepTimer = null;
  }

  #attach(source, name) {
    source.on('submit', (ev) => {
      this.lastEventAt = Date.now();
      this.logger.info(`submit via ${name}`, { surface: ev.surface });
      // Both surfaces map to the same latency shape, which is why the indicator behaves
      // identically whichever one drove it.
      this.latency.onSubmit(latencyEventFromEngine(ev));
      this.engine.onSubmit(ev);
    });
    source.on('end', (ev) => {
      this.lastEventAt = Date.now();
      const delivery = this.latency.onComplete(latencyEventFromEngine(ev));
      if (delivery) {
        this.lastDelivery = delivery;
        this.logger.info('response arrived', {
          sessionId: delivery.sessionId,
          elapsedMs: delivery.elapsedMs,
        });
      }
      this.engine.onEnd(ev).catch((err) => this.logger.error('onEnd failed', { error: err.message }));
    });
    source.on('warning', (w) => this.logger.warn(`${name}: ${w.code}`, w));
    source.on('error', (e) => this.logger.error(`${name} error`, { error: e.message }));
    this.sources.push(source);
    return source;
  }

  async start() {
    ensureLogDir();
    this.startedAt = Date.now();

    if (this.config.surfaces.cowork) {
      this.#attach(
        new TranscriptWatcher({
          root: COWORK_SESSIONS_ROOT,
          surface: 'cowork',
          // Cowork writes an audit.jsonl beside the transcript; it is not a conversation.
          match: /\.claude\/projects\/.*\.jsonl$/,
        }).start(),
        'cowork-watcher'
      );
    }

    if (this.config.surfaces.claudeCode) {
      // Hooks are authoritative when installed. The transcript watcher runs anyway
      // as a safety net; duplicate submits collapse because the engine merges a
      // second submit into the open gap rather than starting a rival.
      this.#attach(new HookSource().start(), 'claude-code-hook');
      this.#attach(
        new TranscriptWatcher({
          root: CLAUDE_CODE_PROJECTS,
          surface: 'claude-code',
        }).start(),
        'claude-code-watcher'
      );
    }

    // Focus tracking runs for as long as the daemon does: a block is broken by the three settled
    // causes, never by the daemon losing interest in watching for them.
    this.focus.start();

    this.server = await createServer({ daemon: this, config: this.config });
    fs.writeFileSync(PID_FILE, String(process.pid));

    // Detection going silent is the worst failure mode because it looks like
    // nothing. If a full day of use produces no events at all, say so loudly.
    this.heartbeatTimer = setInterval(() => this.#heartbeat(), 60 * 60 * 1000);
    this.heartbeatTimer.unref();

    // A browser nobody is reading in is a browser that should not be running. It
    // costs nothing to start again, and the alternative is half a gigabyte held for
    // a book you closed hours ago.
    this.readerSweepTimer = setInterval(() => {
      this.reader.closeIfIdle().catch((err) =>
        this.logger.warn('reader: could not close an idle browser', { error: err.message })
      );
    }, 60 * 1000);
    this.readerSweepTimer.unref();

    this.logger.info('interstice started', {
      pid: process.pid,
      port: this.config.port,
      surfaces: this.config.surfaces,
    });
    return this;
  }

  #heartbeat() {
    const day = 24 * 60 * 60 * 1000;
    const since = this.lastEventAt ?? this.startedAt;
    if (Date.now() - since > day) {
      this.logger.error('DETECTION_SILENT: no transcript or hook events for 24h', {
        lastEventAt: this.lastEventAt,
        coworkRoot: COWORK_SESSIONS_ROOT,
      });
    }
  }

  health() {
    return {
      ok: true,
      pid: process.pid,
      startedAt: this.startedAt,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      lastEventAt: this.lastEventAt,
      sources: this.sources.length,
      detectionSilent:
        Date.now() - (this.lastEventAt ?? this.startedAt) > 24 * 60 * 60 * 1000,
      panel: { ...this.panel.state(), ...(this.server?.stats() ?? {}) },
      reader: {
        running: this.reader.running,
        asin: this.reader.asin,
        frames: this.reader.seq,
        idleSec: this.reader.lastUsedAt ? Math.round(this.reader.idleFor() / 1000) : null,
        error: this.reader.error,
      },
      ...this.engine.status,
    };
  }

  async stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.readerSweepTimer) clearInterval(this.readerSweepTimer);
    for (const s of this.sources) s.stop?.();
    this.focus.stop();
    // Shut down rather than orphan. A reader killed with the daemon still holding
    // its unwritten cookies is a sign-in page the next time you open your book.
    await this.reader.close().catch(() => {});
    this.panel.stop();
    this.engine.stop();
    await this.server?.close();
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* already gone */
    }
    this.logger.info('interstice stopped');
  }
}
