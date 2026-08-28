# Focus, star, break, video, and latency: module contracts

Design record from 2026-08-19, written before the implementation and kept for the boundary
reasoning. The boundaries it fixed are the ones the code still holds to; the names and signatures
are not what it originally guessed. Where this document and the code disagree, the code is right,
and the surfaces below have been corrected against the shipped modules rather than left as the
first sketch of them.

Each new capability is a module that talks to the rest of the system only through a small protocol
and plain data types, never by reaching into another module's internals. Plain data types crossing
a boundary are JSON-serializable objects with the fields named below and nothing else.

## lib/focus/blocks.js, the block state machine (pure)

Pure, no I/O, no timers of its own. Given events and a clock reading, it decides block state.

- `createMachine({ blockMinutes }) -> Machine`
- `Machine.send(event) -> emitted[]` is the only way in. An event is `{ type: 'start' | 'tick' | 'break', at, ... }`;
  the return is the (possibly empty) list of events the machine emitted in response.
- `Machine.phase` is a getter reading `"idle" | "running"`, `Machine.elapsedMs(nowISO)` is the milliseconds
  of the block in progress (0 when idle), and `Machine.blockMs` is the configured block length.
- Crossing data: a **BreakEvent** `{ cause: string, at: string /* ISO 8601 with offset */, detail }`, where
  `detail` is a string for the `app` and `lock` causes and an object `{ host, url }` for `video`.
- Emits a **BlockCompleted** `{ type: 'blockCompleted', startedAt, endedAt, day /* local YYYY-MM-DD */ }` and a
  **BlockForfeited** `{ type: 'blockForfeited', cause, at, elapsedMs }`.

## lib/focus/store.js, durable persistence

- `open(path) -> Store`
- `Store.award(blockCompleted) -> Star` where a **Star** is `{ id: string, startedAt, endedAt, day }`.
- `Store.starsForDay(day) -> Star[]`
- `Store.starsForMonth(yyyyMM) -> Star[]`
- Crossing data: **BlockCompleted** in, **Star** out. The store knows nothing about breakers or the clock.

## lib/focus/breakers/*.js, one breaker per cause

Each breaker exports the same three-function interface and knows nothing about stars or blocks.

- `name() -> string`
- `probe(nowISO) -> Promise<BreakEvent | null>` (null when nothing is breaking)
- `describe() -> string` (for the doctor rung)
- The three breakers: `frontmost.js` (blacklisted app frontmost, via `lsappinfo`), `display.js`
  (display sleep or screen lock, via `ioreg` IOConsoleLocked), `video.js` (delegates to
  lib/video/probe.js). Each emits only a **BreakEvent**; none imports another breaker or the store.

## lib/video/probe.js, browser video detection

- `probeVideo({ browsers, connect }) -> Promise<VideoRecord[]>`
- Reuses lib/cdp.js for Chromium-family tabs (URL + play state) via the injectable `connect`.
- Crossing data: takes `browsers: Array<{ name, wsUrl }>`, returns plain **VideoRecord** rows. The
  whitelist is applied one level up, in `lib/focus/breakers/video.js`, which is what turns a row
  into a **BreakEvent**.

## lib/latency.js: elapsed-since-submit timers

- `createLatency() -> Latency`, plus `latencyEventFromEngine(ev)` which maps an engine event onto it.
- `Latency.onSubmit({ sessionId, at })` starts one session's timer; `Latency.onComplete({ sessionId, at })`
  clears it and returns the delivery record `{ sessionId, submittedAt, arrivedAt, elapsedMs }`, or null
  when there was no timer for it.
- `Latency.elapsedMs(sessionId, nowISO)`, `Latency.isWaiting(sessionId)`, and `Latency.active(nowISO)` are
  the read side; the caller polls rather than the module pushing ticks.
- Crossing data: plain `{ sessionId, submittedAt, elapsedMs }` rows; nothing about focus or stars.

## Boundary rule

No module above may import another new module's internals. A breaker returns a BreakEvent to the
machine; the machine emits a BlockCompleted to the store; the store returns a Star. The only shared
vocabulary is the plain types named above (BreakEvent, BlockCompleted, BlockForfeited, Star,
VideoRecord, and the latency delivery record).
