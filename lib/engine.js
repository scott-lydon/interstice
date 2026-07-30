import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { choose, advance as advanceRung } from './router.js';
import { snapshot } from './state/index.js';
import { deliver } from './actuators/index.js';
import { reclaim } from './reclaim.js';
import { appendJsonl } from './logger.js';
import { GAPS_LOG, EVENTS_LOG } from './paths.js';

/**
 * The gap engine.
 *
 * One open gap at a time, deliberately. Parallel agent sessions are common, but you
 * have one attention, so a second submit while a gap is open extends the existing
 * gap rather than starting a competing one.
 *
 * Timers, not polling: arming schedules exactly one callback per threshold. Between
 * those the engine is idle.
 *
 * Injectable clock and side effects so the whole lifecycle is testable without
 * waiting 12 real minutes or launching Anki.
 */
export class Engine extends EventEmitter {
  constructor({
    config,
    logger,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (t) => clearTimeout(t),
    getState = snapshot,
    doDeliver = deliver,
    doReclaim = reclaim,
    persist = true,
  } = {}) {
    super();
    this.config = config;
    this.logger = logger;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.getState = getState;
    this.doDeliver = doDeliver;
    this.doReclaim = doReclaim;
    this.persist = persist;

    this.gap = null;
    this.timers = [];
    this.retries = 0;
    this.cooldownUntil = 0;
    this.stoodDownForDay = false;
    this.standDownDate = null;
    this.counters = { gaps: 0, delivered: 0, vetoed: 0, reclaimed: 0, advances: 0 };
  }

  get status() {
    return {
      open: Boolean(this.gap),
      gap: this.gap
        ? {
            id: this.gap.id,
            surface: this.gap.surface,
            startedAt: this.gap.startedAt,
            elapsed: Math.round((this.now() - this.gap.startedAt) / 1000),
            current: this.gap.current,
            stoodDown: this.gap.stoodDown,
            synthetic: this.gap.synthetic,
          }
        : null,
      cooldownUntil: this.cooldownUntil,
      stoodDownForDay: this.stoodDownForDay,
      counters: { ...this.counters },
    };
  }

  #log(record) {
    if (this.persist) appendJsonl(EVENTS_LOG, record);
    this.emit('log', record);
    return record;
  }

  #clearTimers() {
    for (const t of this.timers) this.clearTimer(t);
    this.timers = [];
  }

  #dayKey(ts) {
    return new Date(ts).toISOString().slice(0, 10);
  }

  /** A day-long stand down expires when the calendar date changes. */
  #standDownActive() {
    if (!this.stoodDownForDay) return false;
    if (this.standDownDate !== this.#dayKey(this.now())) {
      this.stoodDownForDay = false;
      this.standDownDate = null;
      return false;
    }
    return true;
  }

  onSubmit(ev) {
    const ts = ev.ts || this.now();

    if (this.gap) {
      // A follow-up prompt while a gap is open: the agent is still working and you
      // are still waiting, so extend rather than restart.
      this.gap.submits += 1;
      this.gap.lastSubmitAt = ts;
      this.#log({ kind: 'submit_merged', gapId: this.gap.id, ts });
      return this.gap;
    }

    this.retries = 0;
    this.gap = {
      id: randomUUID(),
      surface: ev.surface || 'unknown',
      sessionId: ev.sessionId || null,
      originApp: ev.originApp || null,
      startedAt: ts,
      lastSubmitAt: ts,
      submits: 1,
      current: null,
      deliveries: [],
      stoodDown: false,
      synthetic: Boolean(ev.synthetic),
      via: ev.via || 'watcher',
    };
    this.counters.gaps += 1;
    this.#log({ kind: 'gap_open', gapId: this.gap.id, surface: this.gap.surface, ts });
    this.emit('gap:open', this.gap);
    this.#arm();
    return this.gap;
  }

  #arm() {
    const { arm, mid, long } = this.config;
    for (const [name, seconds] of [['arm', arm], ['mid', mid], ['long', long]]) {
      const t = this.setTimer(() => this.#evaluate(name), seconds * 1000);
      if (t && typeof t.unref === 'function') t.unref();
      this.timers.push(t);
    }
  }

  async #evaluate(threshold) {
    const gap = this.gap;
    if (!gap) return;
    const elapsed = (this.now() - gap.startedAt) / 1000;

    let state;
    try {
      state = await this.getState(this.config, { now: this.now() });
    } catch (err) {
      this.logger?.warn('state snapshot failed, holding', { error: err.message });
      return;
    }
    if (this.gap !== gap) return; // gap closed while we were gathering state

    const decision = choose({
      elapsed,
      config: this.config,
      state: {
        ...state,
        current: gap.current,
        stoodDown: gap.stoodDown || this.#standDownActive(),
        cooldownUntil: this.cooldownUntil,
        now: this.now(),
      },
    });

    this.#log({
      kind: 'decision',
      gapId: gap.id,
      threshold,
      elapsed: Math.round(elapsed),
      action: decision.action,
      rung: decision.rung ?? null,
      reason: decision.reason,
      state: {
        ankiDue: state.ankiDue,
        bookInProgress: state.bookInProgress,
        idleMs: state.idleMs === null ? null : Math.round(state.idleMs),
        frontmostApp: state.frontmostApp,
      },
    });

    if (decision.action !== 'deliver') {
      if (decision.reason === 'idle_veto') {
        this.counters.vetoed += 1;
        this.#scheduleRetry(gap, decision.reason);
      }
      this.emit('gap:hold', { gap, decision });
      return;
    }
    this.retries = 0;
    await this.#deliver(gap, decision.rung, decision.reason);
  }

  /**
   * An idle veto is transient: it means you were mid-keystroke, not that you left.
   * Waiting until the next declared threshold to look again throws away gaps we
   * could have caught, so a veto schedules a short retry instead.
   *
   * Deliberately NOT done for `wrong_app`. That one means you have already gone
   * somewhere else, and chasing you there is the interruption this system exists
   * to avoid.
   */
  #scheduleRetry(gap, reason) {
    const max = this.config.vetoRetries ?? 4;
    if (this.retries >= max) return;
    this.retries += 1;
    const t = this.setTimer(() => {
      if (this.gap === gap) this.#evaluate(`retry:${this.retries}`);
    }, (this.config.vetoRetrySec ?? 15) * 1000);
    if (t && typeof t.unref === 'function') t.unref();
    this.timers.push(t);
    this.#log({ kind: 'retry_scheduled', gapId: gap.id, attempt: this.retries, after: reason });
  }

  async #deliver(gap, rung, reason) {
    try {
      const result = await this.doDeliver(rung, this.config, { capture: this.capture });
      if (this.gap !== gap) return; // reclaimed mid-delivery
      gap.current = rung;
      gap.deliveries.push({ rung, at: this.now(), reason, detail: result?.detail ?? null });
      this.counters.delivered += 1;
      this.#log({ kind: 'delivered', gapId: gap.id, rung, reason, detail: result?.detail ?? null });
      this.emit('gap:deliver', { gap, rung, result });
    } catch (err) {
      this.#log({ kind: 'deliver_failed', gapId: gap.id, rung, error: err.message });
      this.logger?.warn(`delivery of "${rung}" failed, falling through`, { error: err.message });
      // Fall through to the next rung rather than leaving you with nothing.
      const ladder = this.config.ladder;
      const next = ladder[ladder.indexOf(rung) + 1];
      if (next && this.gap === gap) await this.#deliver(gap, next, `${rung} failed: ${err.message}`);
    }
  }

  /** The advance key: one step down the ladder, wrapping, never a menu. */
  async advance() {
    const gap = this.gap;
    if (!gap) return { ok: false, reason: 'no open gap' };
    const state = await this.getState(this.config, { now: this.now() });
    const decision = advanceRung({
      state: { ...state, current: gap.current, now: this.now() },
      config: this.config,
    });
    this.counters.advances += 1;
    this.#log({
      kind: 'advance',
      gapId: gap.id,
      from: gap.current,
      to: decision.rung ?? null,
      reason: decision.reason,
    });
    if (decision.action !== 'deliver') return { ok: false, reason: decision.reason };
    await this.#deliver(gap, decision.rung, 'advance key');
    return { ok: true, rung: decision.rung };
  }

  standDown({ forDay = false } = {}) {
    if (forDay) {
      this.stoodDownForDay = true;
      this.standDownDate = this.#dayKey(this.now());
    }
    if (this.gap) this.gap.stoodDown = true;
    this.#log({ kind: 'stand_down', gapId: this.gap?.id ?? null, forDay });
    return { ok: true, forDay };
  }

  async onEnd(ev = {}) {
    const gap = this.gap;
    if (!gap) return null;
    this.#clearTimers();
    this.gap = null;

    const endedAt = ev.ts || this.now();
    const record = {
      id: gap.id,
      surface: gap.surface,
      sessionId: gap.sessionId,
      via: gap.via,
      synthetic: gap.synthetic,
      submittedAt: gap.startedAt,
      endedAt,
      durationSec: Math.round((endedAt - gap.startedAt) / 1000),
      submits: gap.submits,
      delivered: gap.deliveries.length ? gap.deliveries : null,
      finalRung: gap.current,
      stoodDown: gap.stoodDown,
      endReason: ev.reason || 'complete',
    };

    if (gap.current) {
      try {
        record.reclaim = await this.doReclaim({
          gap,
          config: this.config,
          reason: record.endReason,
          logger: this.logger,
        });
        this.counters.reclaimed += 1;
      } catch (err) {
        record.reclaim = { error: err.message };
      }
      // Cooldown only matters if we actually moved you. Rapid short turns with no
      // delivery should not suppress the next real gap.
      this.cooldownUntil = this.now() + this.config.cooldown * 1000;
    }

    if (this.persist) appendJsonl(GAPS_LOG, record);
    this.#log({ kind: 'gap_close', gapId: gap.id, durationSec: record.durationSec });
    this.emit('gap:close', record);
    return record;
  }

  stop() {
    this.#clearTimers();
    this.gap = null;
  }
}
