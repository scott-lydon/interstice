// The focus tracker: the one place the pure state machine, the three breakers, and the durable
// star store are joined into a thing that runs. Everything it composes was already built and
// tested in isolation; without this file none of it has a caller outside the test suite, which is
// the difference between a feature that exists and a feature that runs.
//
// It talks to its parts only through their published contracts: `createMachine` takes plain events
// and returns plain events, every breaker exposes the same `{ name, describe, probe }` three, and
// the store exposes `award`. The tracker knows nothing of any breaker's internals.
//
// Why it can run continuously rather than waiting for a rung to be on screen: S2 settles that a
// block is broken by exactly three causes, and that keyboard and mouse idle is NOT one of them.
// Reading a book without touching the keyboard is focus. So "focus" is the absence of a break
// cause, and the honest implementation is to keep a block armed whenever no breaker is firing.

import { createMachine } from './blocks.js';
import { createFrontmostBreaker } from './breakers/frontmost.js';
import { createDisplayBreaker } from './breakers/display.js';
import { createVideoBreaker } from './breakers/video.js';
import { probeVideo } from '../video/probe.js';
import { connect } from '../cdp.js';
import { defaults } from '../config.js';

/** How often the breakers are polled. Short enough to catch a break, long enough to cost nothing. */
const DEFAULT_TICK_MS = 15_000;

/**
 * Now, as ISO 8601 carrying the machine's LOCAL offset, never `Z`.
 *
 * S5 settles that a star belongs to the local calendar day the block completed on, and `localDay`
 * reads that day by slicing the first ten characters of the timestamp, which is only correct when
 * the timestamp is written in the offset it is meant to be read in. `new Date().toISOString()`
 * returns UTC, so west of Greenwich every block finishing after local 17:00 was filed on tomorrow,
 * and one finishing on the last of the month was filed into the next month. The star was real; the
 * day it was stamped with was not.
 */
export function localISO(d = new Date()) {
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  // getTimezoneOffset is minutes BEHIND UTC, so a positive value means a negative offset.
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`
  );
}

/**
 * @param {object} opts
 * @param {object} opts.config          the loaded config; reads `config.focus.*`
 * @param {object} opts.stars           the star store (needs `award`)
 * @param {object} opts.logger
 * @param {object[]} [opts.breakers]    injectable, so a test drives synthetic signals with no live Mac
 * @param {number} [opts.tickMs]
 * @param {function} [opts.now]         injectable clock, returns an ISO 8601 string with offset
 * @returns {{ start, stop, tick, status, onEvent }}
 */
export function createFocusTracker({
  config,
  stars,
  logger,
  breakers = null,
  tickMs = DEFAULT_TICK_MS,
  now = () => localISO(),
}) {
  // The shipped defaults are read from the file that ships them, never restated as literals here.
  // A `?? 25` in this file was a third copy of the block length (config, code, README), and the
  // panel-size copy in the README had already drifted from the config by 200 points, which is what
  // a second copy of a value does when nothing checks it. A test passing a partial config still
  // gets the real shipped values underneath, which is also the honest thing for a test to run on.
  const focus = { ...defaults().focus, ...(config?.focus ?? {}) };
  const machine = createMachine({ blockMinutes: focus.blockMinutes });

  // Built here rather than passed in so the daemon does not have to know the breaker roster. A
  // test passes its own list and none of this runs.
  const parts =
    breakers ??
    [
      createFrontmostBreaker({ blacklistApps: focus.blacklistApps }),
      createDisplayBreaker(),
      createVideoBreaker({
        whitelist: focus.videoWhitelist,
        breakAfterMs: focus.videoBreakAfterMs,
        // `probeVideo` takes its endpoints and its transport as arguments, and the breaker calls
        // `probe()` with none. Passing the bare function meant every tick threw "Cannot read
        // properties of undefined (reading 'browsers')", which the catch below turned into a
        // warning line and a no-break, so the video breaker had been silently switched off for as
        // long as it had been wired in: four warnings a minute and never once a forfeit.
        //
        // `focus.videoBrowsers` ships empty. There is no way to discover the debugging endpoint of
        // a browser that was not started with one, so this cannot be detected for you; an empty
        // list means no endpoints, which means no records and no break, which is the honest state
        // rather than an exception pretending to be one.
        probe: () => probeVideo({ browsers: focus.videoBrowsers, connect }),
      }),
    ];

  let timer = null;
  let lastForfeit = null;
  let lastStar = null;
  const listeners = [];

  function emit(ev) {
    for (const fn of listeners) {
      try {
        fn(ev);
      } catch (err) {
        // A listener that throws must not take the tracker down with it: the block in progress is
        // the thing being protected, and it outranks whatever the listener wanted to do.
        logger?.warn?.('focus: a tracker listener threw', { error: err.message, event: ev.type });
      }
    }
  }

  /** Apply the machine's output: a completed block earns exactly one durable star. */
  function apply(events) {
    for (const ev of events) {
      if (ev.type === 'blockCompleted') {
        const star = stars.award(ev);
        lastStar = star;
        logger?.info?.('focus: star earned', { day: ev.day, startedAt: ev.startedAt, endedAt: ev.endedAt });
        emit({ type: 'star', star });
      } else if (ev.type === 'blockForfeited') {
        lastForfeit = { cause: ev.cause, at: ev.at, elapsedMs: ev.elapsedMs };
        logger?.info?.('focus: block forfeited', { cause: ev.cause, elapsedMs: ev.elapsedMs });
        emit({ type: 'forfeit', forfeit: lastForfeit });
      }
    }
  }

  /**
   * One poll of every breaker. A breaker that throws is a broken sensor, not a break: failing open
   * would forfeit a block the user actually earned, which is the worse of the two errors.
   */
  async function tick(atISO = now()) {
    const hits = [];
    for (const b of parts) {
      try {
        const hit = await b.probe(atISO);
        if (hit) hits.push(hit);
      } catch (err) {
        logger?.warn?.('focus: a breaker could not be probed, treating as no break', {
          breaker: b.name(),
          error: err.message,
          remedy: `run 'interstice doctor' to see why the ${b.name()} signal is unavailable`,
        });
      }
    }

    if (hits.length > 0) {
      // Several causes at once still forfeit one block once. The first is recorded, because a
      // forfeit banner that names two reasons reads as a system that is guessing.
      apply(machine.send({ type: 'break', cause: hits[0].cause, at: atISO, detail: hits[0].detail }));
      return { broke: true, cause: hits[0].cause };
    }

    // Nothing is breaking, so a block should be running. `start` is idempotent in effect here:
    // it is only sent when the machine is idle, so a running block is never restarted (which
    // would silently reset the user's 24 earned minutes to zero).
    if (machine.phase !== 'running') {
      apply(machine.send({ type: 'start', at: atISO }));
      return { broke: false, started: true };
    }
    apply(machine.send({ type: 'tick', at: atISO }));
    return { broke: false, started: false };
  }

  return {
    start() {
      if (timer) return this;
      // Arm immediately rather than waiting a full tick, so a block starts when the daemon does.
      tick().catch((err) => logger?.error?.('focus: first tick failed', { error: err.message }));
      timer = setInterval(() => {
        tick().catch((err) => logger?.error?.('focus: tick failed', { error: err.message }));
      }, tickMs);
      timer.unref?.();
      return this;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      return this;
    },
    tick,
    /** Subscribe to `star` and `forfeit` events. Used by the server to surface them to the panel. */
    onEvent(fn) {
      listeners.push(fn);
      return this;
    },
    /** Plain data for the panel: how far into the current block, and what last broke one. */
    status(atISO = now()) {
      return {
        phase: machine.phase,
        elapsedMs: machine.elapsedMs(atISO),
        blockMs: machine.blockMs,
        blockMinutes: focus.blockMinutes,
        lastForfeit,
        lastStar,
        breakers: parts.map((b) => ({ name: b.name(), describe: b.describe() })),
      };
    },
  };
}
