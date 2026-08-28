# Stars reader loop: parallel notes

Working record for the goal loop in `docs/GOAL_LOOP_STARS_READER_2026-08-17.md`, written as the
work ran on 2026-08-19 and into 2026-08-20. It is a log, not a description of the product, and
not a submission artifact: read `README.md` for what Interstice does.

Every figure here (test counts, coverage percentages, timings, commit ranges) is the value
measured on the date and at the commit stated beside it. None of them is a claim about the
current tree, and none is re-checked when the tree moves.

## 0.0d: CLAUDE.md
Created `CLAUDE.md` at the repo root: references the goal loop, the
predecessor spec, and the config as the sources of truth, and carries the environment PATH note.
It does not duplicate the settled-decision text (the phrase "25 unbroken minutes" appears only in
the goal loop, not in CLAUDE.md), so the two cannot drift.

## 0.3: Deployment asymmetry
`git rev-list --left-right --count origin/main...HEAD` = `0  5`. HEAD is 0 behind and 5 ahead of
origin/main, so the working tree is NOT behind the deploy branch. No merge needed before diagnosis.

## Status of the remaining items
The core of this loop (Phase 1: fix the book-loading failure) is gated on a live run of the Kindle
reading rung, which authenticates against Amazon's web reader through Chrome + CDP against the
carried session in `logs/reader-profile`. Items 1.1 (capture the failure verbatim from a cold
start), 1.2 (classify it), and 1.7 (three cold-start proofs) cannot be produced without driving
that live reader, which needs either a valid carried Amazon session or a fresh sign-in (0.2 grant).

There is also pre-existing uncommitted work across exactly the file set Phases 1 and 2 touch
(`lib/reader.js`, `lib/ocr.js`, `lib/panel.js`, `lib/server.js`, the two reader tests, config, and
`web/panel.html`), which 0.3b requires be reconciled before the 0.4 baseline: diff preserved, each
hunk classified, finished parts committed, scaffolding parked, tree clean. The diff runs to 631
lines and none of it was written by this loop, so each hunk is classified on its own evidence
rather than assumed.

## 0.3b.2: classification of the pre-existing uncommitted work
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

## 0.3b.3-0.3b.6, 0.4: committed and baselined
Six logical commits (5911bcd..5422d40), each `git show --stat` containing only its unit's files.
Working tree clean afterward. 0.4 baseline on the clean tree: `npm test` = 223 pass, 0 fail.
The partial book-loading work (commit 1157a38) is the Phase 1 starting point; Phase 1.2's bucket
choice will be "device registration expired (getDeviceToken 403 -> Oops page)", agreeing with it.

## 0.2: reader credential / carried session
No Amazon credential grant is needed. The committed diagnosis (lib/reader.js:855-875) establishes
that the carried session in `logs/reader-profile` is valid: "the library itself listed the book, so
the account was fine and the session was fine." The failure was NOT auth; it was a stale device
registration (four 403s from `service/mobile/register/getDeviceToken`), fixed by `clearSiteData()`
dropping local storage while keeping cookies. A control profile carrying only this one's cookies
opened the book at "Page 209 of 220" without calling getDeviceToken. So 0.2's second branch holds:
the session is valid, no credential is required.

## 0.5: vocabulary mapping (new concepts onto the existing system)
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

## 1.2: failure classification (from the committed diagnosis)
The failure is a NEW bucket beyond (a)-(f): **stale device registration**, four 403s from
`service/mobile/register/getDeviceToken` cause Amazon's "Oops... Something Went Wrong" page. Evidence
ruling out the listed buckets, each cited to the committed diagnosis in lib/reader.js:
- (a) not signed in, RULED OUT: the library listed the book; account and session fine (lib/reader.js:862).
- (b) no browser, RULED OUT: the reader rendered the Oops page, so a Chromium browser was present.
- (c) load timeout, RULED OUT: the Oops page is a settled page, not a 40s timeout (lib/reader.js:1056-1058).
- (d) wrong/missing ASIN, RULED OUT: the book is in the library and a cookies-only control profile opened it at "Page 209 of 220" (lib/reader.js:866-869).
- (e) markup drift, RULED OUT: the PROBE still matched and detected the Oops page (the new bookError field).
- (f) CDP attach/port failure, RULED OUT: CDP attached and the probe evaluated on the page.
The fix (1.4) is committed: clearSiteData() drops the stale local storage while keeping cookies.
Note on 1.1: the original live failure was captured by the pre-existing work on 2026-08-17 and lives
in the code's documentation; the fix is now applied, so the failure can no longer be reproduced cold
to re-capture a fresh log without first reverting the fix.

## 1.3 / 1.4 / 1.5 / 1.6: regression proof, fix, hardening, doctor
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

## 1.1 and 1.7: the two that need a live cold-start
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

## 8.2: per-file coverage for every changed lib file (measured 2026-08-19, node --experimental-test-coverage)

- `lib/daemon.js`: **0%** lines covered by the unit suite (large pre-existing file; this loop touched a small, tested slice). The note at the end of this list says which slice and where its logic is covered.
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
- `lib/server.js`: **0%** lines covered by the unit suite (large pre-existing file; this loop touched a small, tested slice). The note at the end of this list says which slice and where its logic is covered.
- `lib/video/probe.js`: **96.55%** lines covered
- `lib/video/whitelist.js`: **100.00%** lines covered
- `lib/daemon.js`: **0%** lines covered by the unit suite, no test imports the daemon; this loop's change to it is the two-line star-store wiring, whose logic (the star routes) is covered at 95.65% via `lib/focus/stars-routes.js` and the standalone HTTP test in `test/stars-routes.test.js`.
- `lib/server.js`: **0%** lines covered by the unit suite, no test boots the full server; this loop's change is the two thin star routes, whose handler logic is the 95.65%-covered `stars-routes.js` exercised over a real socket in `test/stars-routes.test.js`.

## 9.3: demo-URL / credential grep, each match justified
The grep `localhost:74[0-9]{2}|password|api[_-]?key|secret` over README + docs returns 13 lines, all
intentional and safe; none is a demo URL or a leaked credential:
- `README.md:76` `http://localhost:7420`, the Learn feature's real local render endpoint, documented,
  not a demo placeholder. A localhost address is not a credential.
- `README.md:215/221/251`, the word "password" appears in prose describing that the sign-in flow
  types and stores NO password (session-carrying). Documentation about the absence of a stored
  credential, not a credential.
- `docs/RECURRING_GOALS_SELECTION.md` and the goal-loop's copy of that table, "Security_and_Secrets"
  is the NAME of a Recurring_goals rule folder, not a secret.
- `docs/GOAL_LOOP_STARS_READER...` lines 67/176/178/181/691/807, references to the Secrets Driver
  MCP mechanism, `get_secret`, and the verify command's own regex. No secret value appears.
No actual demo URL or credential is present in any public-facing text.

---

# Session 2 notes (2026-08-19 into 2026-08-20)

Everything below records a command that was actually run and its actual output. Where a literal
`Verify:` command could not be run, the entry says so rather than papering over it.

## 0.7 / 0.8: Blocker Resolver Monitor

The loop's suggested route is the Claude Code Remote MCP (`create_trigger` / `list_triggers`).
**That MCP is not connected in this session**, so `list_triggers` cannot be run at all. Per the
loop's methodology note ("every how is offered by way of suggestion; the done criterion is
binding"), the monitor was built instead as a session-detached supervisor, which satisfies the
same done criterion by stronger evidence: an actually-running process rather than a registry entry.

Files:
- `$HOME/Library/Application Support/interstice-blocker-resolver/blocker_resolver.sh`
- `$HOME/Library/Application Support/interstice-blocker-resolver/supervisor.sh`

Behaviour implemented, matching 0.7 clause by clause: a tally at `logs/blockers.json` keyed
`PB1..PBn`; one attempt per model escalating haiku, sonnet, opus, fable, never revisiting a model
on a blocker it already attempted; abandonment after fable; a haiku re-check of every abandoned
blocker on each recurrence; and the `route-around-not-stop` trigger phrases ("blocked", "can't",
"cannot", "not possible", "requires the user", "impossible") scanned out of
`logs/blocker-worklog.md`.

**Identifier for teardown (item Z8, replacing "trigger id"):**
`supervisor.pid` file at `$HOME/Library/Application Support/interstice-blocker-resolver/supervisor.pid`,
holding **pid 82500** at launch. Teardown is `kill $(cat "$HOME/Library/Application Support/interstice-blocker-resolver/supervisor.pid")`.

Live evidence:

```
$ ps -p 82500 -o pid,etime=
  PID
82500 01:42:36
$ python3 -c "import json; t=json.load(open('logs/blockers.json')); ..."
PB1 routed [('haiku', 'ARTIFICIAL')]
PB2 routed [('haiku', 'ARTIFICIAL')]
PB3 routed [('haiku', 'UNPARSED'), ('sonnet', 'ARTIFICIAL')]
```

`test -f logs/blockers.json` succeeds and the file carries three entries each with an `attempts`
array, which is the second and third clause of 0.7's verify.

A real bug in the monitor was found and fixed by running it: `claude -p` blocks waiting on stdin,
so the first three attempts recorded `Warning: no stdin data received in 3s` instead of a verdict.
Both call sites now redirect `< /dev/null`. The three stdin-broken attempts were discarded rather
than counted, because a warning string is not a model's verdict.

## 7.5: adversarial spot-check of the exclusions, and the correction it forced

A fresh-context agent was given the manifest's exclusion table and the repo and told to break it.
It returned finding (b), a list of rules to reclassify, quoting 52 real row_ids it examined. Its
structural point: `DECISIONS` is keyed by `(sheet, applies_to)`, and `applies_to` is a PATH GLOB,
which is the wrong question for a rule whose normative text is about a KIND OF SYSTEM. Concretely,
`server/**` excluded the daemon-restart rule from a project that IS a daemon.

Per 7.5's own verify, the decision table was corrected and 7.1 re-run. The correction adds a
`ROW_OVERRIDES` layer to `docs/recurring_goals_selection.py` (a named row beats its pair), holding:
`DEP-005`, `DEP-019`, `TC-005`, `SEC-005`, `PS-002` promoted to include; `DF-005`, `DF-006` to
conditional; and 20 plain-JavaScript rows from the React sheet restored (verified individually:
their rule sentence names no React construct and their glob matches this repo's `.js`).
Two exclusion reasons that were falsifiable as written were also corrected: the Python reason
claimed "no Python source in this repo" while `docs/recurring_goals_selection.py` is 376 lines of
Python, and the React reason claimed "every rule presumes a React component tree".

## 7.1: selector re-run after the correction

```
$ python3 docs/recurring_goals_selection.py > docs/RECURRING_GOALS_SELECTION.md
$ echo $?
0
**Selected 328 · conditional 18 · excluded 297**
```

## 7.2: routed audit over the selected rules

Routed with the `routed-audit-team` pattern, batched by target locality rather than one agent per
row: `docs/audit/route.py` produced nine batches (ux-a 48, ux-b 47, js-a 58, js-b 58, perf-test 26,
universal 35, copy-design 26, ops 31, process 17) and asserts `total == len(rules)` itself.
Nine worker agents each wrote one JSONL verdict per row_id. `docs/audit/reduce.py` then checked
completeness by script rather than by eye, as the item requires:

```
$ python3 docs/audit/reduce.py; echo "EXIT=$?"
selected : 346
findings : 346
missing  : 0 []
extra    : 0 []
duplicate: 0 []
verdicts : {'FAIL': 131, 'NA': 70, 'PASS': 145}
FAIL by severity: {'medium': 45, 'high': 50, 'blocker': 14, 'low': 22}
SET CHECK: PASS, findings set is exactly the selected set
EXIT=0
```

## 7.4: every conditional row resolved

`docs/audit/CONDITIONAL_RESOLUTIONS.md` carries one row per conditional `row_id` (18 of them),
each naming its precondition, whether it held, whether the rule therefore applies, and the verdict,
plus a per-row evidence line. No conditional is left unresolved. Resolutions: DEP-001, DEP-002,
DEP-007, DEP-016 held and PASS; DEP-003 held and FAIL; DEP-006, DEP-008, DEP-011, DEP-013, DEP-014,
DEP-015, DEP-017, DEP-018, CM-009, CM-010, DF-005, DF-006, VD-007 did not hold and are NA.

## DI-007: the blocker the audit found, fixed and deployed

The audit's most severe finding was that the entire focus/star/latency feature was implemented,
unit-tested, and **never wired into the running product**. Verified independently before acting:

```
$ grep -rn "createMachine\|createLatency\|createVideoBreaker" lib bin web
lib/latency.js:17:export function createLatency() {
lib/focus/blocks.js:74:export function createMachine({ blockMinutes = 25 } = {}) {
lib/focus/breakers/video.js:33:export function createVideoBreaker({ ... }) {
```

Every hit is the definition itself. No caller anywhere outside `test/`. `lib/daemon.js` opened the
star store and never called `award`, so no star could ever be earned in production.

Fix: new `lib/focus/tracker.js` composes the machine, the three breakers and the durable store into
a thing that runs; `lib/daemon.js` builds and starts it, and feeds `lib/latency.js` from the same
submit and end events the engine sees; `lib/server.js` exposes `GET /api/focus` and adds `focus`
and `latency` to the existing `POST /api/panel/ping` heartbeat; `web/panel.html` gained
`applyFocusBeat(d)` so a forfeit and an in-flight prompt reach the panel in real use rather than
only from the test hooks. `test/focus-tracker.test.js` pins the join, including a source-level
assertion that the daemon still wires it, so a future refactor that unwires it fails here.

Deployed and behaviour-verified, not merely built:

```
$ pkill -9 -f "interstice.js start"      # launchd restarted it as a new pid on the new code
$ curl -s http://localhost:7420/api/focus
{"ok": true, "at": "2026-08-19T23:44:56-07:00",
 "block": {"phase": "running", "elapsedMs": 10656, "blockMs": 1500000, "blockMinutes": 25,
           "breakers": ["frontmost-app", "display-lock", "video"]}, ...}
$ curl -s -X POST http://localhost:7420/api/panel/ping
keys        : ['asset', 'detail', 'focus', 'latency', 'ok', 'rung', 'seq']
focus.phase : running
```

A real star was then awarded by the live tracker during a later review pass, which is the end-to-end
proof: `2026-08-19T23:44:51-07:00` to `2026-08-20T00:09:51-07:00`.

## The timezone bug the live star exposed (S5)

The first star the live tracker awarded was filed on the WRONG DAY, and an interactive review pass
caught it. `createFocusTracker` minted `new Date().toISOString()`, which is always UTC, while
`localDay` in `blocks.js` reads the day by slicing the first ten characters "in the offset the
timestamp carries". West of Greenwich every block finishing after local 17:00 was therefore stored
under tomorrow, and one finishing on the last of the month landed in the next month. S5 settles the
opposite: local calendar day, timestamps as ISO 8601 with offset, never a bare local string.

Fixed with an exported `localISO()` in `lib/focus/tracker.js`, used by the tracker and by
`lib/server.js`. Pinned by a regression test:

```
$ node -e "... localISO() ..."
localISO()      : 2026-08-19T23:44:24-07:00
carries offset  : true
local day slice : 2026-08-19 (system date: 2026-08-19)
```

The pre-fix `toISOString()` returned `2026-08-20T06:33:21.000Z` for that same instant.
One star in `logs/stars.jsonl` was awarded by the pre-fix build and still carries `Z` timestamps;
that is pre-fix DATA, not live behaviour, and it is left as it is rather than rewritten, because
editing a durable record to make a chart look right is exactly what the no-fake-data rule forbids.

## 2B.2 / 2B.3 / 2B.4 and 6.1 / 6.2 / 6.3 / 6.4: the UI-to-UX convergence sub-loops

Nine U passes and seven J rulings actually ran, each as a fresh-context agent, each verifying its
claims in a real headless Chromium against the running daemon rather than by reading the diff.
`UX_FEEDBACK.md` is the artifact. Totals: 34 items raised, 25 ruled `{worthwhile}`, 9 ruled
`{skip}`, all 25 fixed and each re-verified by the next pass.

The ping-pong earned its cost. Every pass from 2 through 8 caught a genuine defect, and four of
them were regressions introduced by the immediately preceding fix:

| pass | what it caught |
|---|---|
| 1 | `body.immersive #view-reading > :not(...)` at specificity (2,3,1) outranked every rule meant to SHOW the floating affordances, so the pager, star calendar, latency chip, arrival note and forfeit banner all computed `display: none` in the only view they exist for. The forfeit banner is `role="alert"` and could never fire, which made block loss silent. |
| 2 | the calendar's first open never fetched (a false zero at the entry point); the arrival note covered the latency chip |
| 3 | the calendar never re-asked the server after the first open; the arrival note, moved down, now sat under the never-auto-hiding forfeit banner |
| 4 | deriving the month from `_cal.key` sent a full date to a month-only route, HTTP 400 `bad_date`, header reading "Stars in 2026-08-19" |
| 5 | the UTC/S5 bug above; nothing in the running panel ever raised the forfeit banner; `#book-actions` escaped the immersive rule via an inline style no stylesheet rule can outrank |
| 6 | the `⋯` trigger at z 30 covered the top-right of the menu's Close button at z 29, and the trigger has no toggle, so the dismiss glyph was a dead click target |
| 7 | `setView`'s `typeof closeReaderMenu === 'function'` guard was dead code (the function is declared inside a load callback), so leaving the reading view with the menu open stranded the rung ladder and footer inside a hidden container with no way back |
| 8 | the same class for the second overlay: the star calendar survived the view change and repainted a full-panel dialog over the page, with no keyboard route out |

Convergence command, run after the last D change:

```
$ grep -qE '^- \[ \].*\{worthwhile\}' UX_FEEDBACK.md && echo "FAIL: rework D" || echo PASS
PASS
```

## Suite

```
$ node --test test/*.test.js
ℹ tests 281
ℹ pass 281
ℹ fail 0
```

Baseline at the start of this session was 275 passing. The six added are `test/focus-tracker.test.js`
(five wiring and behaviour tests plus the timezone regression).

Note carried forward: the five `test/*.pw.mjs` Playwright specs are NOT in that count.
A bare `chromium.launch({channel:'chrome'})` times out on this machine even standalone, so
`node --test` over the whole directory reports 5 failures for an environmental reason. Every
browser verification recorded above therefore used the headless chromium shell explicitly, which
does work, and each is quoted with its real output.

## The Playwright specs, and why `npm test` was red

Correction to the note above: the five `test/*.pw.mjs` specs were not failing for an unfixable
environmental reason, they were failing for a fixable one. Each called
`chromium.launch({ channel: 'chrome' })`, which requires a separately-installed Chrome. Where that
is missing the launch does not error, it HANGS until the runner's 180s timeout and then reports a
product failure for an environment reason. Meanwhile Playwright's own bundled Chromium, which
`@playwright/test` always installs, works fine on this machine, which is what every browser
verification in these notes used.

All five now launch the bundle by default and keep real Chrome reachable behind
`INTERSTICE_PW_CHANNEL=chrome`. Each exits 0:

```
test/forfeit-legible.pw.mjs   -> exit 0   4.6 PASS: forfeit surfaces cause ("video") and wall-clock time
test/immersive-layout.pw.mjs  -> exit 0   #reader = 640x900 of 640x900 (width 100.0%, height 100.0%)
test/immersive-menu.pw.mjs    -> exit 0   2C.2/2C.3/2C.4 PASS: one menu, arrows turn pages both states, Escape closes
test/latency-indicator.pw.mjs -> exit 0   5.2/5.3/5.4/5.7 PASS: indicator increments, clears, distinct arrival, layout intact
test/star-calendar.pw.mjs     -> exit 0   3.8 PASS: calendar opens behind the menu, star on the right day, reveal 09:12/09:37
```

`immersive-menu.pw.mjs` passing is also the check on an arbitration made earlier: item 24 of UX
pass 1 wanted arrow keys guarded while an overlay is open, which contradicts 2C.3 ("arrow keys turn
pages with the menu closed AND with it open"), already ticked and pinned by that spec. The guard was
narrowed to the star calendar only, because the calendar covers the page and shows no position,
whereas the menu is where `#reader-page` is displaced to, so the position change stays visible while
it turns. Both the UX item and 2C.3 are satisfied; neither was overridden.

With that fixed, the loop's own success condition 7 is measurable rather than blocked:

```
$ npm test >/dev/null 2>&1; echo $?
0
$ npm test >/dev/null 2>&1 && ! grep -qE '^- \[ \].*\{worthwhile\}' UX_FEEDBACK.md && echo PASS || echo FAIL
PASS
```

286 tests, 286 pass, 0 fail. Baseline at session start was 275 unit tests with the five browser
specs failing.

## Convergence of both sub-loops (2B.4 and 6.4)

Pass 9 ran AFTER the last D change and raised zero items, which is what the mtime clause asks for.
Its measured evidence: `#reader` at 100% of both dimensions at 640x900, 640x700, 640x560, 480x900
and 1000x640; a 441-point grid landing inside `#reader` at 435/441 (the six misses are the floating
pager and hint, which are meant to be there) where pass 8 measured 0/441; both overlays closing on
a view change independently of one another; 441/441 self-hits on both close buttons; all four
forfeit causes rendering in plain words at the correct local wall clock; and the latency chip
clearing on arrival with a distinct, non-overlapping arrival note.

## Items not completed

- **1.1 and 1.7** (capture the original failure verbatim from a cold start; three consecutive
  cold-start proofs) remain open. Both need the live Amazon reading rung. Confirmed this session
  rather than assumed: `POST /api/reading/view` against the running daemon takes about 20 seconds
  and answers `ok: false, "the reader browser never opened its debugging port: fetch failed"`, so
  the headless reader will not come up on this machine at present. 1.1 additionally cannot be
  reproduced without reverting the committed fix, since the fix is applied.
- **5.8** (two real prompts through the live LLM path with the timer starting and clearing for
  both) remains open. The latency clock is now genuinely wired daemon-side and proven by the ping
  payload, but a recorded transcript of two real sequential turns was not captured.
- **7.3** (every blocker and high finding fixed or refuted) is PARTIAL. The audit produced 64 such
  findings. DI-007 is fixed and deployed, and the UX, UFC and DV findings that the convergence
  loop covers are fixed and re-verified. The remainder, including SEC-004 (no auth on the loopback
  control surface), DEP-003, DEP-010, DEP-019, TC-007, TC-008, the UC-* design findings and the
  TS-* style findings, are recorded in `docs/audit/findings_merged.json` with evidence and a
  proposed fix, but are neither fixed nor formally refuted.
- **9.1** (the demonstration video) was not recorded.
- **9.2** (professionalism scan) ran and produced 45 findings, listed by a fresh-context agent
  covering stale boasts in `docs/design-brief.html`, the Python-vs-JavaScript drift throughout
  `docs/GOAL_LOOP.md`, a README panel-size sample contradicting the shipped config, and the CI
  step `test ! -f package-lock.json` which now fails on every push. The item's verify requires all
  of them fixed and a second pass returning zero findings; that has not been done, so the box stays
  open.

## Commit, push, PR

Branched off `main` rather than committing to it. Five logical commits on
`stars-reader-loop-session-2`, pushed, PR opened:

**https://github.com/scott-lydon/interstice/pull/7**

```
7db8e9e Loop notes and box ticks for this session, plus a gitignore for __pycache__
a72e5f6 Recurring goals: per-row overrides, and the audit over the selected rules
7aa8ea1 Playwright specs: launch the bundled Chromium, not a Chrome channel
e6c8a0a Immersive reading: fix the rule that hid every floating affordance
14520ee Wire the focus engine into the running daemon, and stamp local time
```

Working tree clean after the fifth. The PR body names every box left open and what is missing
from each, so the next session does not have to re-derive it.

## 7.3: every blocker and high finding fixed or refuted

64 rows. 58 fixed, 6 refuted, none left open. `docs/audit/merge_resolutions.py` folds the
per-cluster resolution files into the findings and checks the bar by script, because a campaign
this size is exactly where an eye slides past the one row nobody did:

```
$ python3 docs/audit/merge_resolutions.py; echo "EXIT=$?"
resolutions merged      : 62
blocker/high FAIL rows  : 64
  fixed                 : 58
  refuted               : 6
  still open            : 0 []
  malformed             : 0 []
by severity             : {'high': 50, 'blocker': 14}
7.3 CHECK: PASS, every blocker and high finding is fixed or refuted with a recorded reason
EXIT=0
```

Every fixed row records the real command and output that verified it; every refuted row records a
reason specific to this repo rather than a general argument. Full detail in
`docs/audit/resolutions/` and in the `resolution` key of each row in `docs/audit/findings_merged.json`.

### The six refutations, in short

- **TS-PP-002** `lib/state/index.js` is not a facade. Its own documentation says it gathers what the
  router needs under a ceiling; nine modules import its siblings directly against two importers of
  `index.js`, and making it a barrel would put the companions graph on the router hot path.
- **RN-ASYNC-DEPENDENCIES** the two operations are not independent. The first writes a macOS
  defaults key that Cocoa reads at process start, so running them concurrently lets the process
  launch before the write lands, which is the exact failure that path exists to prevent. The
  dependency runs through the defaults database rather than a JavaScript value.
- **UC-CUPID-002** splitting the 1700-line Reader was declined, not deferred vaguely: its
  lifecycle, auth and session-carry thirds have no reachable test coverage, and the live reader
  cannot be driven on this machine right now, so a split could be claimed but not verified.
- **DF-008** the rule is conditional on a Claude Design handoff bundle. This project ships none,
  and the general-model route was recorded before the artifact existed rather than after the fact.
- **AB-012** the clause it objects to has no on-disk existence, and it was load bearing: nine
  writers ran concurrently in one working tree with no branch or worktree isolation.
- **AB-016** the fix it prescribes is forbidden by the loop's own item 0.7, and the teardown handle
  it says is missing is recorded in these notes under item 0.8.

### The two defects the campaign found that nobody had reported

**The video breaker was silently dead in production.** Verifying UC-PRIN-002 showed that the
tracker wiring passed `probe: probeVideo` with no arguments, so the function threw on destructuring
every 15 seconds. The tracker's own "a breaker that throws is a broken sensor, not a break" design
then swallowed it into a warning, which is correct behaviour that happened to hide a real fault.
Success condition 5 could never have held. Counted against the live log across the restart:

```
video-breaker throw warnings BEFORE the restart: 736
video-breaker throw warnings AFTER  the restart: 0
```

with the daemon up 5:25 and `/api/focus` reporting a running block with all three breakers armed.

**A second README drift nobody had reported.** The DI-010 pinning test was made to fail first
against the known panel-size drift, and on being fixed it failed again on a binaural `match` regex
that had also gone stale. That is the test doing its job on its first run.

Suite: 336 passing, 0 failing, `npm test` exits 0. It was 275 at the start of the session.

## 5.8, conversational smoke test on the live path

Two real prompts, run through the real hooks into the real daemon. Nothing simulated: the hooks
registered in `~/.claude/settings.json` are this repo's own `hooks/on-submit.sh` and
`hooks/on-stop.sh`, they append to `logs/hook-events.jsonl`, the daemon's HookSource reads that,
and `lib/latency.js` is fed from the same events the engine sees. The timings below are read back
from `GET /api/focus`, which reports the daemon's own clock rather than anything the test kept.

Full transcript at `docs/audit/smoke-test-5.8.log`. The two cycles:

| | turn one | turn two (`--continue`) |
|---|---|---|
| timer started | `2026-08-20T14:30:25.916Z`, seen 84ms in | `2026-08-20T14:30:41.939Z`, seen 61ms in |
| submitted | `14:30:25.880Z` | `14:30:41.903Z` |
| arrived | `14:30:35.629Z` | `14:30:55.743Z` |
| elapsed | 9,749ms | 13,840ms |
| cleared | `waiting = []` | `waiting = []` |

Two distinct cycles, not one repeated: different submit, different arrival, different elapsed, and
the timer returned to empty between them.

The second turn genuinely required the first's context, which is the part of this item that a
canned pair of prompts would not test. It asked "what single function in that same file did I just
ask you about", naming neither the file nor the function, and the answer came back
`createFocusTracker` in `lib/focus/tracker.js`. It could only resolve "that same file" from the
prior turn.

Both turns ran in one session (`42a74228-9461-4bd7-bf41-0befe274d2e6`), which is what `--continue`
means and is why the second is a follow-up rather than a fresh conversation. The clock still
separates them because it pairs a submit with its own completion rather than keying on the session
alone.

Worth recording, since it was visible while setting this up: the daemon was already timing a real
in-flight prompt from the session driving this work before the test started, which is the same
mechanism answering for a third party. The clock was not stood up for the test.

## The reading rung: what the wall actually was

Worth correcting the record from session one, which reported this as an environment problem.

`POST /api/reading/view` answered "the reader browser never opened its debugging port: fetch
failed" for the whole of the first session, and that was taken as the reader being unavailable on
this machine. It was our bug. `findBrowser` returned the first Chromium-family browser that
EXISTED and the reader gave up when it did not answer.

Google Chrome 151 on this machine starts, stays alive, and never opens a DevTools port. Proven,
not inferred: no `DevToolsActivePort` written into the profile, no listening socket bound by the
process, nothing in its own `--enable-logging=stderr --v=1` output, no managed policy plist
present, and the same result with a clean temp profile and with `--remote-debugging-port=0`. Brave,
installed beside it, writes the port file and answers `/json/version` on the first try.

So the reading rung was dead on a machine that had a working browser installed the whole time.
`launchFirstWorkingBrowser` now tries each installed browser in turn and, when none answers, names
every one it tried and what each did.

After that, against the live daemon:

```
 ok: True | ready: False | seq: 1 | signedOut: True
```

A real 960x1212 JPEG, rendered by Brave. Looking at it: Amazon's own sign-in page, the yellow
button and the email field.

**Where the wall is now.** The carried session in `logs/reader-profile` has expired, and signing in
needs the account holder: a password, an emailed code, or a passkey. That is not something to
route around. So 1.1 and 1.7 stay open, and item 1 of the video stays absent, on a blocker that is
genuinely the operator's rather than a broken tool. One sign-in through the panel's "Sign in to
Amazon in Chrome" button carries the session, and 1.7 becomes runnable immediately after.

## 9.1, what was recorded

`docs/demo/interstice-demo.mp4` with `docs/demo/README.md` indexing every moment by timestamp, and
one still per moment under `docs/demo/frames/`. Five of the six behaviours, against the running
daemon, with real data: twelve real stars the tracker earned today, a forfeit record the real video
breaker produced against a real browser playing a real ffmpeg-encoded file, and a latency cycle
through the panel's own surface.

The box stays unticked because item 1 is absent, which the item's own verify does not allow for.

Recording it was worth doing for its own sake, because watching the first take found a defect that
nine UX passes and thirteen professionalism scans had all missed: the arrow-key hint ran under the
pager buttons, and the tail of the sentence was printed beneath them. Bounding the hint's width
does not fix it, which is the interesting part: the pager is centred on the reader, so its left
edge moves with the panel, and at 480 wide it reaches further left than any fixed bound would allow
for. Two things whose widths both vary cannot be kept apart by choosing a number for one of them.
The hint moved above the pager's band instead, and is clear at five widths and two heights.

The first take also appeared to show the latency chip failing to clear on arrival. It was not a
bug: a real prompt was in flight from the session driving this work, the heartbeat reported it, and
the panel went on timing it, which is exactly right.

## Closing block

- **Incidental iCloud downloads**: none to evict. The repo is on `/dev/disk3s5`, not an
  iCloud-managed path, and nothing in this work read from `~/Library/Mobile Documents`.
- **Tabs and processes**: every browser this work started is closed. What remains running is the
  product and the loop's own monitor: the daemon, the Brave instance the daemon owns for the
  reader, and the blocker resolver that item 0.7 requires until Z8.
- **Demo**: the recording, the live panel and the dashboard were opened for review.
- **Manual verification checklist**: `docs/MANUAL_VERIFICATION.md`. Every command in it was run
  verbatim before it was written down, and the expected output in the document is the output that
  came back.

The parent box stays unticked because its text is "After you've finished everything", and four
items are not finished.

---

# Item 9.2: the bar that was substituted, and why the box is still open

**The box stays unticked.** 9.2's literal verify is "every item is fixed and re-scanned to zero
findings by a second fresh-context pass". That was not met, and a substituted bar was not met
either, so the box is open and the operator decides whether the substitution is acceptable.

**The substituted bar, agreed with the loop lead:** two consecutive scans producing no finding
above low severity, with every finding above low either fixed or refuted in writing against this
repo. That is the same convergence idiom the loop already uses for the UI-to-UX sub-loops, two
consecutive rounds adding nothing worthwhile.

**Why literal zero was not the right target.** Sixteen fresh-context scans ran. Findings per scan,
in order:

```
45, 15, 8, 7, 5, 10, 13, 5, 36, 12, 19, 24, 19, 10, 7, 17
```

That is not a convergence curve. The diagnosis: "re-scanned to zero" is a function of how hard the
scanner looks, not a property of the code. This repo carries roughly six thousand lines of unusually
dense explanatory comment, and every one of those sentences is a factual claim that can rot. A
scanner that reads deeper than the last one will always find more, and roughly a third of each
round's findings were defects introduced by the previous round's fixes. The jump from 5 to 36 at
scan nine is the clearest evidence: that was the first scanner to read `lib/reader.js`,
`lib/ocr.js` and `lib/engine.js` against their own doc blocks rather than concentrating on the
README.

**Why the scans were still worth their cost.** They were not finding taste. Eight defects they
found were things that did not work at all, listed below.

# The eight things that were broken, not merely documented wrong

Recorded here rather than only in `docs/audit/findings_merged.json`, because a defect nobody reads
about is a defect that comes back.

1. **The focus feature had no caller.** `createMachine`, the three breakers and `createLatency`
   were referenced only from their own files and from `test/`. The daemon opened the star store and
   never called `award`. The README documented earning stars; no star could ever be earned.
2. **The video breaker could not see video, for two independent reasons.** First it was invoked
   with no arguments, so it threw on destructuring every fifteen seconds and its own
   broken-sensor rule swallowed the throw: 736 warnings before the fix, zero after. Then, with that
   fixed, it still detected nothing.
3. **The reading rung was dead because installed is not working.** `findBrowser` returned the first
   Chromium-family browser that EXISTED and the reader gave up when it did not answer. Chrome 151
   on this machine starts, stays alive, and never opens a DevTools port; Brave, installed beside it,
   opens it immediately.
4. **The control surface had no authentication** on roughly thirty five handlers, verified live
   with a cross-origin POST that was accepted.
5. **The hotkey apps had not worked since that auth landed.** The token header was built inside
   single quotes, where `sh` never substitutes, so every press sent the literal characters `$(cat `
   as its header value, got a 401, and `|| true` swallowed it. Worth naming separately: the auth
   work that broke it was correct, and the breakage went unnoticed *precisely because the failure
   path was silenced*.
6. **The reader frame returned 401** under the same auth, because an `<img src>` is issued by the
   browser and never reaches the `fetch` wrapper the page installs. The book went blank.
7. **The reading menu lost two of the eight controls** it claims to hold: the footer bar and the
   reader note were displaced into it and then hidden by rules that did not except the open overlay.
8. **The video whitelist failed open on multi-part TLDs.** Both host and entry were collapsed to
   two labels, so `bbc.co.uk` became `co.uk` and whitelisting one BBC host whitelisted every
   `.co.uk` host there is. The comment above the collapse claimed it "fails safe by being stricter".

## The pattern underneath six of them: a check that could not fail

- The doctor video probe passed a hard-coded zero and contacted nothing, so it printed a green tick
  for a signal it had never reached.
- The doctor screen-lock check probed through a wrapper that swallows every error by design, so it
  could only ever see a boolean and its failure branch was unreachable.
- The hotkey 401s were hidden by `|| true`.
- The video breaker's throws were hidden by the tracker's treat-a-throw-as-a-broken-sensor rule,
  which is correct behaviour that happened to conceal a real fault.
- `focus.videoBrowsers` ships empty, so video cannot break a block on a stock install at all. The
  old check could not say so; the fixed one now does, in as many words.
- And the sharpest instance, worth keeping verbatim:

  **The stub had invented a protocol and the probe agreed with the stub.**

  `probeVideo` evaluated its play-state expression with `t.sessionId`, taken from
  `Target.getTargets`, which returns no sessionId. The evaluate went to the browser-level session,
  where there is no page and no `Runtime` domain, and Chrome answers `'Runtime.evaluate' wasn't
  found`. The catch turned that into `playing = false` on every tab forever. Every unit test passed
  throughout, because the fake session handed back a sessionId from `getTargets` and matched on it.
  The test was not merely weak. It was actively agreeing with a fiction.

  The lesson, now also in `docs/BUG_ISSUE_PREVENTION.md`: when a module speaks a wire protocol, at
  least one test has to speak it to a real implementation. A stub is free to be wrong in exactly the
  way the code is wrong, and then a green suite is evidence of nothing.

---

## 1.1 Capture the failure verbatim, 2026-08-21T00:50Z

Driven from the running daemon (pid 833, up 393 minutes) plus the full event log. Capture file:
`logs/reader-failure-2026-08-20.log`.

### The finding: the reading rung does NOT fail, and the telemetry says so plainly

7,564 events. **195 deliveries, 1 failure.** By rung:

```
delivered by rung: {'reading': 178, 'flashcards': 13, 'queue_prompt': 4}
```

**There are zero reading failures.** The single `deliver_failed` in the entire log is the flashcards
rung, verbatim:

```json
{"kind": "deliver_failed", "gapId": "28973cf0-2174-44c0-8d47-9848fa9c9e5c",
 "rung": "flashcards", "error": "AnkiConnect timed out after 2000ms (App Nap?)"}
```

The most recent reading delivery, verbatim, carries the book and the synced position:

```json
{"kind": "delivered", "gapId": "690bd670-1050-4f15-bd61-e917fd98005b", "rung": "reading",
 "reason": "armed at 25s",
 "detail": {"app": "Amazon Kindle", "generation": "current",
            "title": "Early Retirement Extreme: A philosophical and practical guide to financial independence",
            "asin": "B0046LU7H0", "percent": 39, "position": 226766}}
```

`doctor` agrees: every reading check passes, including "the reader is signed in, the reader carries
your Amazon session" and "a book in progress is identifiable, Early Retirement Extreme at 39%".

### So what does `#reader-failed-why` say?

Nothing, because it never renders. That string is a hardcoded constant at `web/panel.html:1307` and
is written only when a delivery fails. No reading delivery has failed, so it has never been shown.
Its literal text, for the record:

> Amazon would not open this book here. Your account and the book are both fine; what Amazon turned
> down was this reader as a device. Try again: it clears what Amazon stored here, keeps you signed
> in, and reopens the book.

### Why the item expected a failure

Items 1.2 through 1.6 are already ticked: the failure was classified and repaired in an earlier
session. 1.1 is the capture step that was never run afterwards, so it still reads as though the
failure is live. Capturing it now shows the repair holding across 178 deliveries.

### What IS still failing, and it is not the reader

`delivered=0` on the current daemon's counter is a per-run counter, not a lifetime one, and it is
misleading next to a lifetime total of 195. Separately, the decision log shows most gaps never route
at all:

```
  534  idle_veto
  520  wrong_app
  194  armed at 25s
   55  already_there
   32  cooldown
```

1,141 of 1,335 decisions chose no rung. That is the routing gate doing its job (the operator was in
the wrong app, or idle), not a reader defect, but it is why the counter looks dead on a short run.

The one genuine open failure is AnkiConnect timing out at 2000 ms, attributed in the error string
itself to App Nap. That belongs to the flashcards rung.

## 1.7 cold-start proof, 2026-08-20

`scripts/cold_start_proof.mjs` opens three genuinely cold readers, one per round, and asserts a
non-blank page plus a position within 2 points of the Kindle-synced one. It found a real defect on
its first run, and then found the wall that stops it passing today.

**The defect.** A cold `ensure()` returned `{ok: true}` over a browser that was no longer running:

```
ensure returned: {"ok":true,"asin":null,"recarried":0}
after: running false asin null error null
```

The chain: `ensure` saw a signed-out arrival, called `recoverIfPossible`, which called
`reauthenticate`, which closes the reader before a forced carry (the forced path deletes the cookie
store before writing, so it must not run against a live browser). The carry found nothing to carry
and returned from there, leaving the reader closed. `ensure` then reported success with no error
set. The daemon hides this because its poll opens again 1.5 seconds later. One cold call does not,
which is why 178 successful warm deliveries never surfaced it.

Fixed in `lib/reader.js`: `reauthenticate` now reopens on the book it was reading before it gives
up. `test/reader.test.js` covers it, and the test fails on the old code (26 pass / 1 fail) and
passes on the new (27 / 0). Full suite 347 / 0.

**The wall.** With the reader kept alive, the honest state is visible, and it is that Amazon has
expired the session:

```
href: https://www.amazon.com/ap/signin?...openid.return_to=https%3A%2F%2Fread.amazon.com%2F%3Fasin%3DB0046LU7H0
```

`carry` reports "your browser is holding the same session this reader already has", so the reader
profile and Chrome hold the identical mark: both are expired, and there is no live session anywhere
on this machine to carry across. The remedy is the product's own `startSignIn()`, a Chrome window on
the reader's profile that takes a password, an emailed code, or a passkey. That needs the account
holder, so 1.7 stays open until someone signs in, then the script is one command.

**Worth noting for a later item.** `doctor` reports "the reader is signed in, the reader carries
your Amazon session" while the live page is Amazon's sign-in form. The check reads the cookie store,
not the page, so it cannot see an expired session. That is a separate finding, not fixed here.
