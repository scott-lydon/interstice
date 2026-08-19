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
