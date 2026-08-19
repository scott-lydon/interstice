# Focus, star, break, video, and latency — module contracts

Each new capability is a module that talks to the rest of the system only through a small protocol
and plain data types, never by reaching into another module's internals. This is the contract every
implementation must satisfy; it is written before the implementation so the boundaries are fixed
first. Plain data types crossing a boundary are JSON-serializable objects with the fields named
below and nothing else.

## lib/focus/blocks.js — the block state machine (pure)

Pure, no I/O, no timers of its own. Given events and a clock reading, it decides block state.

- `createMachine({ blockMinutes }) -> Machine`
- `Machine.onTick(nowISO) -> { state, elapsedMs }` where `state` is one of `"idle" | "running" | "completed"`.
- `Machine.onBreak(breakEvent) -> { state: "idle", forfeited: boolean }`
- Crossing data: a **BreakEvent** `{ cause: string, at: string /* ISO 8601 with offset */, detail: string }`.
- Emits a **BlockCompleted** `{ startedAt: string, endedAt: string, day: string /* local YYYY-MM-DD */ }`.

## lib/focus/store.js — durable persistence

- `open(path) -> Store`
- `Store.award(blockCompleted) -> Star` where a **Star** is `{ id: string, startedAt, endedAt, day }`.
- `Store.starsForDay(day) -> Star[]`
- `Store.starsForMonth(yyyyMM) -> Star[]`
- Crossing data: **BlockCompleted** in, **Star** out. The store knows nothing about breakers or the clock.

## lib/focus/breakers/*.js — one breaker per cause

Each breaker exports the same three-function interface and knows nothing about stars or blocks.

- `name() -> string`
- `probe() -> BreakEvent | null` (null when nothing is breaking)
- `describe() -> string` (for the doctor rung)
- The three breakers: `frontmost.js` (blacklisted app frontmost, via `lsappinfo`), `lock.js`
  (display sleep or screen lock, via `ioreg` IOConsoleLocked), `video.js` (delegates to
  lib/video/probe.js). Each emits only a **BreakEvent**; none imports another breaker or the store.

## lib/video/probe.js — browser video detection

- `probe({ cdp, whitelist }) -> BreakEvent | null`
- Reuses lib/cdp.js for Chromium-family tabs (URL + play state) and the Safari scripting interface.
- Crossing data: takes a `whitelist: string[]` of host substrings, returns a **BreakEvent** or null.

## lib/latency.js — elapsed-since-submit ticker

- `createTicker({ onTick, onClear }) -> Ticker`
- `Ticker.submitted(atISO)` starts it; `Ticker.delivered(atISO)` clears it and fires the arrival notification.
- Crossing data: emits a **LatencyTick** `{ elapsedMs: number }` to `onTick`; nothing about focus or stars.

## Boundary rule

No module above may import another new module's internals. A breaker returns a BreakEvent to the
machine; the machine emits a BlockCompleted to the store; the store returns a Star. The only shared
vocabulary is the four plain types (BreakEvent, BlockCompleted, Star, LatencyTick).
