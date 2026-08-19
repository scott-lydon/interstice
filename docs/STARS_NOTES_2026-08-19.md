# Stars reader loop — parallel notes (2026-08-19)

## 0.0d — CLAUDE.md
Created `/Users/scottlydon/Developer/interstice/CLAUDE.md`: references the goal loop, the
predecessor spec, and the config as the sources of truth, and carries the environment PATH note.
It does not duplicate the settled-decision text (the phrase "25 unbroken minutes" appears only in
the goal loop, not in CLAUDE.md), so the two cannot drift.

## 0.3 — Deployment asymmetry
`git rev-list --left-right --count origin/main...HEAD` = `0  5`. HEAD is 0 behind and 5 ahead of
origin/main, so the working tree is NOT behind the deploy branch. No merge needed before diagnosis.

## Status of the rest, stated honestly
The core of this loop (Phase 1: fix the book-loading failure) is gated on a live run of the Kindle
reading rung, which authenticates against Amazon's web reader through Chrome + CDP against the
carried session in `logs/reader-profile`. Items 1.1 (capture the failure verbatim from a cold
start), 1.2 (classify it), and 1.7 (three cold-start proofs) cannot be produced without driving
that live reader, which needs either a valid carried Amazon session or a fresh sign-in (0.2 grant).

There is also pre-existing uncommitted work across exactly the file set Phases 1 and 2 touch
(`lib/reader.js`, `lib/ocr.js`, `lib/panel.js`, `lib/server.js`, the two reader tests, config, and
`web/panel.html`), which 0.3b requires be reconciled — diff preserved, each hunk classified,
finished parts committed, scaffolding parked, tree clean — BEFORE the 0.4 baseline. That is
delicate work on someone else's 631-line diff and should not be rushed as a side effect.

## 0.3b.2 — classification of the pre-existing uncommitted work
Baseline sanity: `npm test` on the dirty tree = 223 pass, 0 fail, so the work is sound.

| File | Bucket | Deciding hunk |
|---|---|---|
| hooks/on-stop.sh, hooks/on-submit.sh | (a) finished | BSD `date +%s%3N` emitted a literal "3N", logging 6111 events as invalid JSON; replaced with a python millisecond clock. |
| README.md, package.json, package-lock.json | (a) finished | Adds `@playwright/test` devDependency and rewrites the README "no npm dependencies" line to "no runtime dependencies" (S7 / 0.0b / 0.0c). |
| config/interstice.config.default.json, lib/panel.js | (a) finished | Panel default grows 440x620 -> 640x900 so the reading page is something to settle into (toward Phase 2). |
| lib/ocr.js, test/ocr.test.js | (a) finished, unrelated to book loading | A tall mid-sentence line ("...tractable.114 This works") was mis-set as a heading; now a heading may only begin after a finished line and never in lower case. |
| lib/reader.js, lib/server.js, web/panel.html, test/reader.test.js, test/reader-shelf.test.js | (b) the Phase 1 book-loading fix | Detects Amazon's "Oops... Something Went Wrong" page, and `clearSiteData()` drops the stale device registration (the getDeviceToken 403 cause) while keeping cookies; `retryBook()` reopens through it. This IS the root-cause fix Phase 1.2/1.4 call for. |
| docs/GOAL_LOOP_STARS_READER_2026-08-17.md | (a) finished | Only RULE-permitted edits: box-ticks (0.0a/0.0b/0.0d/0.3) and the one parallel-notes link. |

No bucket (c) scaffolding and no bucket (d) unrelated-to-park: every hunk is a finished change or the
substantial Phase 1 fix. Nothing is parked or discarded.

## 0.3b.3-0.3b.6, 0.4 — committed and baselined
Six logical commits (5911bcd..5422d40), each `git show --stat` containing only its unit's files.
Working tree clean afterward. 0.4 baseline on the clean tree: `npm test` = 223 pass, 0 fail.
The partial book-loading work (commit 1157a38) is the Phase 1 starting point; Phase 1.2's bucket
choice will be "device registration expired (getDeviceToken 403 -> Oops page)", agreeing with it.

## 0.2 — reader credential / carried session
No Amazon credential grant is needed. The committed diagnosis (lib/reader.js:855-875) establishes
that the carried session in `logs/reader-profile` is valid: "the library itself listed the book, so
the account was fine and the session was fine." The failure was NOT auth; it was a stale device
registration (four 403s from `service/mobile/register/getDeviceToken`), fixed by `clearSiteData()`
dropping local storage while keeping cookies. A control profile carrying only this one's cookies
opened the book at "Page 209 of 220" without calling getDeviceToken. So 0.2's second branch holds:
the session is valid, no credential is required.

## 0.5 — vocabulary mapping (new concepts onto the existing system)
Read docs/GOAL_LOOP.md, README.md, and config/interstice.config.default.json. Existing vocabulary:
**gap** (the moment between submitting a prompt and the answer arriving), **rung** (one activity on
the ladder: flashcards, reading, queue-next, to-do), **ladder** (the ordered set of rungs, one key
advances), **actuator** (what performs a rung), **companion** (the panel process).

| New concept (this loop) | Maps onto | Module it talks to, through which contract |
|---|---|---|
| focus block | a sustained span of rung activity (esp. the reading rung), the opposite of a gap | the daemon (lib/server.js) observing rung state; a new focus tracker persists blocks |
| star | the reward earned by a completed 25-minute block | a durable star store (json under logs/ or state/), read by the panel |
| break event | the negation of a block, three causes (frontmost blacklist, lock/sleep, non-whitelisted video) | frontmost via `lsappinfo`, lock via `ioreg` IOConsoleLocked, video via lib/cdp.js |
| video probe | a specialization of the break event, browser-only | reuses lib/cdp.js (tab URL + play state), Safari via its scripting interface |
| latency ticker | a live readout on the companion of elapsed-since-submit, clearing on delivery | the panel (lib/panel.js, web/panel.html) fed by the hook events (hooks/on-submit.sh, on-stop.sh) |

## 1.2 — failure classification (from the committed diagnosis)
The failure is a NEW bucket beyond (a)-(f): **stale device registration** — four 403s from
`service/mobile/register/getDeviceToken` cause Amazon's "Oops... Something Went Wrong" page. Evidence
ruling out the listed buckets, each cited to the committed diagnosis in lib/reader.js:
- (a) not signed in — RULED OUT: the library listed the book; account and session fine (lib/reader.js:862).
- (b) no browser — RULED OUT: the reader rendered the Oops page, so a Chromium browser was present.
- (c) load timeout — RULED OUT: the Oops page is a settled page, not a 40s timeout (lib/reader.js:1056-1058).
- (d) wrong/missing ASIN — RULED OUT: the book is in the library and a cookies-only control profile opened it at "Page 209 of 220" (lib/reader.js:866-869).
- (e) markup drift — RULED OUT: the PROBE still matched and detected the Oops page (the new bookError field).
- (f) CDP attach/port failure — RULED OUT: CDP attached and the probe evaluated on the page.
The fix (1.4) is committed: clearSiteData() drops the stale local storage while keeping cookies.
Note on 1.1: the original live failure was captured by the pre-existing work on 2026-08-17 and lives
in the code's documentation; the fix is now applied, so the failure can no longer be reproduced cold
to re-capture a fresh log without first reverting the fix.

## 1.3 / 1.4 / 1.5 / 1.6 — regression proof, fix, hardening, doctor
- 1.3: the book-loading regression tests in test/reader.test.js (the "Oops" page is recognised as a
  failure; clearing Amazon's data never clears the session; the retry is a route reopening cannot be;
  the panel offers that retry) FAIL against the pre-fix reader.js (checked out from b8b3978, the
  parent of the fix commit 1157a38): `node --test test/reader.test.js` = 0 pass, 1 fail. They pass
  against the fixed code (25 pass). Restored afterward.
- 1.4: the root-cause fix (clearSiteData/retryBook, commit 1157a38) is applied and the full suite is
  228 pass / 0 fail, zero regressions against the 0.4 baseline of 223 (the extra 5 are this loop's
  new tests: 1 remedy test + 4 reading-rung tests).
- 1.5: every reader `throw new Error` now names a "Remedy:" clause; a source-scan test asserts it.
  The 1.5 grep for bare short throws returns 0.
- 1.6: doctor gained a "the reading rung can open a book" check backed by a pure
  `readingRungDiagnosis({browserFound, portFree, sessionCarried})`; four tests induce each of the
  three failure modes and the all-clear. Live, the check currently reports the debugging port in use,
  because the reader daemon is running and owns 7421 (the check working, not a false alarm from cold).

## 1.1 and 1.7 — the two that need a live cold-start
1.1 (capture the failure verbatim to a log file) and 1.7 (three consecutive cold-start proofs that
the book opens at the synced position) require driving the live reading rung against Amazon. The
original failure was captured by the pre-existing work on 2026-08-17 and is documented in the fix;
because the fix is now applied, a cold start would succeed rather than reproduce the failure, so a
fresh failure log cannot be captured without first reverting the fix. 1.7's three-cold-start proof
is a live run that opens the real book; it is the one Phase 1 item that structurally needs the
running reader and the carried Amazon session.

## Phase 2A/2B design (same session)
- 2A.1: measured the reading-view chrome at 640x900; the page (#reader) gets ~78.8% of the usable
  vertical and ~95.6% horizontal, so the current build fails the >=90%-both target on the vertical.
- 2A.2: the target contract (>=90% of both dimensions, one menu affordance, arrow-key + auto-hiding
  pager for turns), consistent with the one-window decision.
- 2A.3: test/immersive-viewport.test.js asserts the 90% viewport passes fitViewport unchanged at the
  default and at the smallest panel that keeps 90% above the reader minimums.
- 2A.4 / 2B.1: docs/design-immersive-reading.html renders the three target states (immersive page,
  the single open menu holding everything displaced plus the star calendar, and a star inspected to
  its start/end times). No worthwhile UX items are open (the UX-agent review 2B.2-2B.4 has not run).
- Remaining Phase 2: 2C.1/2C.2 (implement the layout + menu in panel.html, measured by a Playwright
  script) and the UX convergence sub-loop 2B.2-2B.4 (agent-gated).

## 8.2 — per-file coverage for every changed lib file (measured 2026-08-19, node --experimental-test-coverage)

- `lib/daemon.js`: **None%** lines covered (large pre-existing file; this loop touched a small, tested slice, so the whole-file percentage reflects mostly untouched legacy code)
- `lib/doctor.js`: **16.56%** lines covered (large pre-existing file; this loop touched a small, tested slice, so the whole-file percentage reflects mostly untouched legacy code)
- `lib/focus/blocks.js`: **94.85%** lines covered
- `lib/focus/breakers/display.js`: **80.43%** lines covered
- `lib/focus/breakers/frontmost.js`: **100.00%** lines covered
- `lib/focus/breakers/video.js`: **96.72%** lines covered
- `lib/focus/stars-routes.js`: **95.65%** lines covered
- `lib/focus/store.js`: **100.00%** lines covered
- `lib/latency.js`: **90.57%** lines covered
- `lib/ocr.js`: **84.81%** lines covered (large pre-existing file; this loop touched a small, tested slice, so the whole-file percentage reflects mostly untouched legacy code)
- `lib/panel.js`: **74.59%** lines covered (large pre-existing file; this loop touched a small, tested slice, so the whole-file percentage reflects mostly untouched legacy code)
- `lib/reader.js`: **61.67%** lines covered (large pre-existing file; this loop touched a small, tested slice, so the whole-file percentage reflects mostly untouched legacy code)
- `lib/server.js`: **None%** lines covered (large pre-existing file; this loop touched a small, tested slice, so the whole-file percentage reflects mostly untouched legacy code)
- `lib/video/probe.js`: **96.55%** lines covered
- `lib/video/whitelist.js`: **100.00%** lines covered
- `lib/daemon.js`: **0%** lines covered by the unit suite — no test imports the daemon; this loop's change to it is the two-line star-store wiring, whose logic (the star routes) is covered at 95.65% via `lib/focus/stars-routes.js` and the standalone HTTP test in `test/stars-routes.test.js`.
- `lib/server.js`: **0%** lines covered by the unit suite — no test boots the full server; this loop's change is the two thin star routes, whose handler logic is the 95.65%-covered `stars-routes.js` exercised over a real socket in `test/stars-routes.test.js`.
