// The focus-block state machine. Pure: no I/O, no timers, no knowledge of macOS. It takes a stream
// of plain events and emits plain events. One star is earned per `blockMinutes` of unbroken focus
// (S1, default 25). A break (S2: a blacklisted app frontmost, display sleep or screen lock, or
// non-whitelisted video) forfeits the block. The panel never breaks its own block (S4), but that
// whitelisting is the breakers' job, not this machine's: here a `break` event is always a break.
//
// Events in (plain objects, timestamps are ISO 8601 with offset):
//   { type: 'start', at }
//   { type: 'tick',  at }
//   { type: 'break', cause, at }
//
// Events out:
//   { type: 'blockCompleted', startedAt, endedAt, day }   // day is the local calendar day it completed
//   { type: 'blockForfeited', cause, at, elapsedMs }
//
// The reducer is `reduce(state, event) -> { state, emit }`. `createMachine` wraps it with a small
// stateful factory for callers that prefer to push events one at a time.

const MS_PER_MINUTE = 60_000;

/** Local calendar day (YYYY-MM-DD) of an ISO 8601 timestamp, in the offset the timestamp carries. */
export function localDay(iso) {
  // The timestamp carries its own offset, so slicing the date part after re-forming it in that
  // offset is exact without a timezone database. ISO 8601 date is the first 10 chars.
  return String(iso).slice(0, 10);
}

export function initialState() {
  return { phase: 'idle', startedAt: null, lastAt: null };
}

/**
 * @param {object} state
 * @param {object} event
 * @param {object} opts { blockMs }
 * @returns {{ state: object, emit: object[] }}
 */
export function reduce(state, event, { blockMs }) {
  const emit = [];
  switch (event.type) {
    case 'start': {
      // Starting always (re)arms the block from this instant. A start while already running
      // restarts, which is the honest reading of "begin a fresh block now".
      return { state: { phase: 'running', startedAt: event.at, lastAt: event.at }, emit };
    }
    case 'tick': {
      if (state.phase !== 'running') return { state, emit };
      const elapsed = Date.parse(event.at) - Date.parse(state.startedAt);
      if (elapsed >= blockMs) {
        emit.push({
          type: 'blockCompleted',
          startedAt: state.startedAt,
          endedAt: event.at,
          day: localDay(event.at),
        });
        // Back-to-back: a completed block immediately re-arms from the tick that completed it, so a
        // continuous run of focus earns consecutive stars without a gap or a manual restart.
        return { state: { phase: 'running', startedAt: event.at, lastAt: event.at }, emit };
      }
      return { state: { ...state, lastAt: event.at }, emit };
    }
    case 'break': {
      if (state.phase !== 'running') return { state, emit }; // a break with no block in progress is a no-op
      const elapsed = Date.parse(event.at) - Date.parse(state.startedAt);
      emit.push({ type: 'blockForfeited', cause: event.cause, at: event.at, elapsedMs: elapsed });
      return { state: initialState(), emit };
    }
    default:
      return { state, emit };
  }
}

/** A small stateful wrapper around the reducer for push-one-event-at-a-time callers. */
export function createMachine({ blockMinutes = 25 } = {}) {
  const blockMs = Math.round(blockMinutes * MS_PER_MINUTE);
  let state = initialState();
  return {
    /** Push one event; returns the events emitted by it (possibly empty). */
    send(event) {
      const r = reduce(state, event, { blockMs });
      state = r.state;
      return r.emit;
    },
    /** Current phase, for tests and the daemon's status. */
    get phase() {
      return state.phase;
    },
    /** Milliseconds of the block in progress at `nowISO`, or 0 when idle. */
    elapsedMs(nowISO) {
      if (state.phase !== 'running') return 0;
      return Date.parse(nowISO) - Date.parse(state.startedAt);
    },
    get blockMs() {
      return blockMs;
    },
  };
}
