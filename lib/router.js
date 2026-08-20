/**
 * The router. A pure function: no I/O, no clock, no side effects.
 *
 * Everything it needs arrives in `state`, which makes every decision reproducible
 * and every rule testable without a running Anki, a real gap, or a wall clock.
 *
 * Two rules carry the whole design:
 *
 *   1. It never returns a list. A menu at the moment the gap opens is the same
 *      decision fatigue wearing a different hat.
 *   2. It never returns a rung with no work in it. Routing someone into an empty
 *      deck teaches them the system is noise, and they stop trusting it.
 */

/**
 * Every rung the router knows about, in the order they are tried by default.
 *
 * The shipped default order, kept here for reference. `config.ladder` is what actually runs,
 * and the set `validate` checks it against is `KNOWN_RUNGS` in lib/config.js, not this list: a
 * typo in the ladder is a startup error there. Nothing imports this constant.
 */
export const RUNGS = ['flashcards', 'reading', 'queue_prompt', 'todo'];

/**
 * Why the router chose to deliver nothing, as a stable machine-readable reason.
 *
 * Every no-op carries one of these. A system that interrupts you is only trusted if
 * it can also say why it did not, and "nothing happened" with no reason attached is
 * indistinguishable from the detection being broken.
 */
export const DECLINE = {
  BELOW_THRESHOLD: 'below_threshold',
  COOLDOWN: 'cooldown',
  STOOD_DOWN: 'stood_down',
  IDLE_VETO: 'idle_veto',
  WRONG_APP: 'wrong_app',
  QUIET_HOURS: 'quiet_hours',
  NOTHING_AVAILABLE: 'nothing_available',
  ALREADY_THERE: 'already_there',
};

/**
 * Is a rung capable of holding your attention right now?
 * `unavailable` from a provider (timeout, app not running) makes a rung ineligible
 * rather than crashing the router or, worse, delivering into a void.
 */
export function rungAvailable(rung, state, config) {
  switch (rung) {
    case 'flashcards': {
      const due = state.ankiDue;
      if (due === null || due === undefined) return false; // unavailable
      return due > 0;
    }
    case 'reading':
      return state.bookInProgress === true;
    case 'queue_prompt':
      return true; // a capture window always has room for a thought
    case 'todo':
      // Null means Notes could not be read, which is unavailable, not empty. Same
      // distinction as Anki: we must not deliver into a list we cannot see.
      return state.todoAvailable === true;
    default:
      return false;
  }
}

/**
 * Escalation: once a rung is delivered we do not re-decide, we only move on when
 * the current rung has run dry. Switching someone off a deck that still has 20
 * cards in it is churn, not help.
 */
function rungExhausted(rung, state, config) {
  if (rung === 'flashcards') {
    const due = state.ankiDue ?? 0;
    return due < (config.anki?.midRungMinDue ?? 15);
  }
  if (rung === 'queue_prompt') return true; // one prompt queued is enough
  return false; // reading and todo are open-ended
}

function nextAvailableFrom(ladder, startIndex, state, config) {
  for (let i = startIndex; i < ladder.length; i += 1) {
    if (rungAvailable(ladder[i], state, config)) return ladder[i];
  }
  return null;
}

/**
 * @param {object} input
 * @param {number} input.elapsed   seconds since submit
 * @param {object} input.state     live world: ankiDue, bookInProgress, idleMs,
 *                                 frontmostApp, current, stoodDown, cooldownUntil, now
 * @param {object} input.config
 * @returns {{action:'deliver'|'hold', rung?:string, reason:string}}
 */
export function choose({ elapsed, state, config }) {
  const ladder = config.ladder;

  if (state.stoodDown) return { action: 'hold', reason: DECLINE.STOOD_DOWN };

  if (state.cooldownUntil && state.now < state.cooldownUntil) {
    return { action: 'hold', reason: DECLINE.COOLDOWN };
  }

  if (config.quietHours) {
    const hour = new Date(state.now).getHours();
    const { start, end } = config.quietHours;
    const inQuiet = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
    if (inQuiet) return { action: 'hold', reason: DECLINE.QUIET_HOURS };
  }

  if (elapsed < config.arm) return { action: 'hold', reason: DECLINE.BELOW_THRESHOLD };

  // Guards apply only at the moment of first delivery. Once you are in Anki the
  // frontmost app is Anki, and your hands are busy answering cards, so re-checking
  // them on escalation would wedge the ladder permanently.
  if (!state.current) {
    if (typeof state.idleMs === 'number' && state.idleMs < (config.idleVetoMs ?? 0)) {
      return { action: 'hold', reason: DECLINE.IDLE_VETO };
    }
    if (state.frontmostApp && !config.originApps.includes(state.frontmostApp)) {
      return { action: 'hold', reason: DECLINE.WRONG_APP };
    }
  }

  // First delivery: top of the ladder that has work.
  if (!state.current) {
    const rung = nextAvailableFrom(ladder, 0, state, config);
    if (!rung) return { action: 'hold', reason: DECLINE.NOTHING_AVAILABLE };
    return { action: 'deliver', rung, reason: `armed at ${config.arm}s` };
  }

  // Escalation only at the declared thresholds.
  const atThreshold = elapsed >= config.long ? 'long' : elapsed >= config.mid ? 'mid' : null;
  if (!atThreshold) return { action: 'hold', reason: DECLINE.ALREADY_THERE };

  if (!rungExhausted(state.current, state, config)) {
    return { action: 'hold', reason: DECLINE.ALREADY_THERE };
  }

  const idx = ladder.indexOf(state.current);
  const next = nextAvailableFrom(ladder, idx + 1, state, config);
  if (!next) return { action: 'hold', reason: DECLINE.NOTHING_AVAILABLE };
  return { action: 'deliver', rung: next, reason: `${state.current} exhausted at ${atThreshold}` };
}

/**
 * The advance key. A *next*, never a picker: it moves one step down the ladder,
 * wrapping, skipping rungs with no work. Manual, so thresholds do not apply.
 */
export function advance({ state, config }) {
  const ladder = config.ladder;
  const start = state.current ? ladder.indexOf(state.current) : -1;
  for (let step = 1; step <= ladder.length; step += 1) {
    const rung = ladder[(start + step + ladder.length * 2) % ladder.length];
    if (rung === state.current) continue;
    if (rungAvailable(rung, state, config)) {
      return { action: 'deliver', rung, reason: 'advance key' };
    }
  }
  return { action: 'hold', reason: DECLINE.NOTHING_AVAILABLE };
}
