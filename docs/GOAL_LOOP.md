# GOAL_LOOP.md: Interstice

> **Superseded. This is the original build checklist, kept as a record of what was planned.**
>
> It is not a description of the shipped system and it is not a live to do list. Read
> `README.md` for what Interstice actually does, and `config/interstice.config.default.json`
> for what it ships with. Where this file and the README disagree, the README is right.
>
> Four things in here were overtaken by the build and are flagged again where they appear:
> the implementation language (this file plans Python and pytest; the shipped daemon is
> JavaScript on Node with `node --test`), the config filename (`config/ladder.json` became
> `config/interstice.config.json`), the to do surface (Obsidian became Apple Notes), and the
> delivery mechanism (bringing other apps to the front was tried, found to be the problem
> rather than the solution, and replaced by a single panel). The unticked boxes below are
> unticked because this checklist was retired, not because the work is outstanding.

**Goal.** Eliminate the decision that occurs in the gap between submitting a prompt
(Cowork or Claude Code) and receiving the result, by automatically delivering a
pre-committed productive activity into that gap and reliably reclaiming attention
when the agent needs it.

**Success condition (the whole loop closes only when all of these hold):**

1. A gap opened in **Cowork** is detected from the session transcript within 2s of submit.
2. A gap opened in **Claude Code** is detected from a `UserPromptSubmit` hook within 2s.
3. Gaps shorter than the threshold never deliver anything.
4. A qualifying gap delivers exactly one activity, chosen without user input, and never
   delivers into an empty activity.
5. Agent completion or a permission request reclaims focus within 3s.
6. Over a 7-day soak on real usage: false-positive delivery rate < 5%, and every gap is
   present in the log.

**Autonomy rule.** Every item below has a machine-runnable verify. No item waits on a
person to look at, approve, or answer anything. All human-facing forks are pre-resolved
by `config/ladder.json` defaults, which a human may edit at any time without blocking
the loop.

**Repo root.** The checkout this file lives in, referred to below as `$R`.

---

## Settled decisions (confirmed by the operator, not assumptions)

| # | Decision | Value | Consequence for the build |
|---|---|---|---|
| 1 | Focus behaviour | **Take focus outright.** No countdown, no confirmation. | Misfires are expensive, so the idle veto (1.4) and the frontmost-app guard (3.5) are load bearing, not optional. |
| 2 | Ladder order | **Flashcards, reading, queue-next-prompt, to-do list.** | The shipped config, `config/interstice.config.json`, fixes the default order to this. |
| 2b | Switching | **One key advances to the next rung**, wrapping at the end. | A *next*, never a menu. A menu at delivery time reintroduces the decision this system exists to delete. See 3.7. |
| 3 | To-do list placement | **Last rung**, fires only when everything above is empty. | Follows from 2. Still always reachable via the advance key. |

| 4 | Surface scope | **Both.** Cowork via transcript watcher, Claude Code via hook, one queue. | Settled by the measured baseline: 1,883 CLI prompts and 139h of qualifying gap time. |
| 5 | Distraction handling | **None. Nothing is blocked, delayed, logged as a vice, or policed.** | No blocker, no friction layer, no vice tracking. This project *is* the distraction answer: it competes by being there first. Do not add a second mechanism for the same problem. |

Still open when this was written (a default held until answered, and it did not block the
loop): the project name and home. Both were settled shortly afterwards: the project is
Interstice, and it lives in a directory of that name.

---

## Ground truth discovered before this loop (do not re-derive)

| Fact | Value |
|---|---|
| Cowork sessions root | `~/Library/Application Support/Claude/local-agent-mode-sessions` |
| Cowork transcript glob | `<root>/*/*/local_*/.claude/projects/*/*.jsonl` |
| Submit event | JSONL line with `"type":"user"` carrying `promptId` + ISO `timestamp` |
| Why host hooks fail in Cowork | Cowork uses a per-session `.claude` home containing **no** `settings.json` |
| Claude Code CLI | hooks confirmed working against the CLI current when this was written, via an existing `PreToolUse` hook in the user settings file |
| Anki bridge | AnkiConnect addon `2055492159`, HTTP `127.0.0.1:8765`, action `guiDeckReview` |
| Kindle | registers `kindle` URL scheme |
| To-do surface | Obsidian, a single vault reached by URL scheme. **Superseded:** the shipped to do rung reads Apple Notes over Apple events. |
| Idle signal | `ioreg -c IOHIDSystem` → `HIDIdleTime` (nanoseconds) |

### Measured baseline (from existing transcripts, timestamps only)

Turn = genuine human prompt to last event before the next one. Subagent lines excluded,
tool-result lines excluded (they are recorded as `type:"user"` and must be filtered by the
absence of `toolUseResult`), turns over 1h dropped.

| Surface | Prompts | Median | p90 | ≥25s | ≥3m | ≥12m | Gap time |
|---|---|---|---|---|---|---|---|
| Cowork | 4,731 | 234s | 1,434s | 92.4% | 56.3% | 23.2% | 678h |
| Claude Code | 1,883 | 53s | 887s | 63.8% | 29.5% | 11.9% | 139h |

Consequences: the 25s threshold filters only 7.6% in Cowork but 36.2% in Claude Code, so it
must stay per-surface tunable. The 3m rung is not an edge case. Phase 8.3 retunes against
fresh data but must beat this baseline as its prior.

---

> **Note on every verify command below.** They were written for a Python implementation that
> was never built: `lib/router.py`, `python3 -m pytest`, `config/ladder.json`, and the
> `test/*.py` and `test/*.sh` scripts they name do not exist. The shipped suite is JavaScript,
> run with `npm test`. Read the verifies as a statement of what each item had to prove, not as
> commands to run.

## Phase 0: Preflight (fail loud, before any feature work)

These two dependencies can silently null the entire system. Prove them first.

- [ ] **0.1 Repo skeleton + config defaults.** Create `$R/{bin,lib,config,logs,web,test}` and
      `config/ladder.json` carrying the settled decisions: `ladder = ["flashcards",
      "reading", "queue_prompt", "todo"]` (decision 2), `focus_mode = "take"` (decision 1),
      `advance_key` and `standdown_key` bound to distinct keys (decision 2b), thresholds
      `arm=25s, mid=180s, long=720s`, `cooldown=90s`, `quiet_hours=null`.
  - Verify: `python3 -c "import json;d=json.load(open('$R/config/ladder.json'));assert d['arm']==25;assert d['focus_mode']=='take';assert d['ladder']==['flashcards','reading','queue_prompt','todo'];assert d['advance_key']!=d['standdown_key'];print('PASS')"`
- [ ] **0.2 Anki socket proven live.** Disable App Nap for Anki
      (`defaults write net.ankiweb.dtop NSAppSleepDisabled -bool YES`), launch Anki, and
      prove AnkiConnect answers **while Anki is backgrounded**.
  - Verify: `osascript -e 'tell app "Anki" to activate' >/dev/null; open -a Ghostty; sleep 4; curl -s --max-time 4 -X POST http://127.0.0.1:8765 -d '{"action":"version","version":6}' | grep -q '"result"' && echo PASS || echo FAIL`
- [ ] **0.3 Due-count query proven.** `findCards` with `is:due` returns an integer.
  - Verify: `curl -s -X POST http://127.0.0.1:8765 -d '{"action":"findCards","version":6,"params":{"query":"is:due"}}' | python3 -c "import sys,json;d=json.load(sys.stdin);assert isinstance(d['result'],list);print('PASS',len(d['result']))"`
- [ ] **0.4 Transcript glob resolves to at least one live Cowork session.**
  - Verify: `ls ~/Library/Application\ Support/Claude/local-agent-mode-sessions/*/*/local_*/.claude/projects/*/*.jsonl 2>/dev/null | head -1 | grep -q jsonl && echo PASS || echo FAIL`
- [ ] **0.5 Idle + frontmost readable without a TCC prompt blocking the daemon.**
  - Verify: `ioreg -c IOHIDSystem | grep -q HIDIdleTime && osascript -e 'tell application "System Events" to get name of first process whose frontmost is true' >/dev/null && echo PASS || echo FAIL`

**Gate:** if any 0.x is FAIL, the loop stops here and reports which dependency is dead.
No later phase may be marked done while a 0.x item is unticked.

---

## Phase 1: Detect

- [ ] **1.1 Transcript watcher, event driven (no polling).** A single **recursive FSEvents
      watch** on the Cowork sessions root (`fs.watch(root, {recursive:true})` on Node, or
      CoreServices FSEvents directly). The kernel pushes; the process sleeps otherwise. It
      must pick up files created in subdirectories that did not exist when the watch started,
      since every new session is a new tree. On each event, read only the bytes appended since
      the last known offset for that file, emit `{event:"submit", surface:"cowork", session,
      promptId, ts}` per new `"type":"user"` line (excluding `toolUseResult` lines) and
      `{event:"end"}` on the turn's final assistant line. Handle truncation by resetting the
      offset when file size shrinks.
  - **Measured precedent:** recursive `fs.watch` fired 13ms after an append to a file six levels deep in a tree created after the watch began. No dependency required.
  - Verify: `node $R/test/test_watcher.js` (creates a nested session tree AFTER starting the watch, appends a user line; asserts exactly one submit + one end, in order, within 2s, and asserts zero `setInterval`/`setTimeout` polling of the filesystem: `! grep -nE 'setInterval|readdirSync.*loop' $R/lib/watch_cowork.*`).
- [ ] **1.2 Claude Code hook path.** `bin/on_submit.sh` and `bin/on_stop.sh` write the same
      event shape to the same queue; snippet added to `~/.claude/settings.json` under
      `UserPromptSubmit` and `Stop`. Hook must exit in < 50ms so it never delays a turn.
  - Verify: `$R/test/test_hook_latency.sh` (asserts exit code 0 and wall time < 50ms, and that one event landed on the queue).
- [ ] **1.3 Unified event queue.** Both sources feed one append-only `logs/events.jsonl`;
      duplicate submits for the same `promptId` collapse to one.
  - Verify: `python3 $R/test/test_queue_dedup.py`
- [ ] **1.4 Idle veto.** A gap whose keyboard idle time is under `veto_ms` at arm time is
      marked `vetoed` and delivers nothing.
  - Verify: `python3 $R/test/test_idle_veto.py` (injects synthetic idle values; asserts no delivery below threshold, delivery above).

---

## Phase 2: Decide

- [ ] **2.1 Pure router function.** `lib/router.py::choose(elapsed, state, config) -> rung|None`
      with no side effects. Implements the escalating ladder and the never-route-into-empty rule.
  - Verify: `python3 -m pytest $R/test/test_router.py -q`: table-driven over ≥ 20 cases, must include: below-threshold, empty deck, deck exhausts mid-gap, no book, cooldown active, stand-down active.
- [ ] **2.2 Live state providers.** Anki due count, book-in-progress, cooldown, stand-down,
      each with a timeout and a safe fallback (a provider that times out reports "unavailable",
      which makes its rung ineligible rather than crashing the router).
  - Verify: `python3 $R/test/test_state_providers.py` (asserts every provider returns within 800ms or reports unavailable).
- [ ] **2.3 Router never returns a rung whose activity is empty.**
  - Verify: `python3 $R/test/test_no_empty_route.py` (property test, 500 randomized states, asserts no chosen rung reports zero available work).

---

## Phase 3: Deliver

> **Superseded in the build.** Items 3.1 to 3.4 below bring Anki, Kindle and Obsidian to the
> front in turn. That was tried and it was the wrong design: four apps taking the screen in
> sequence is four interruptions, which is the problem this project exists to remove. The
> shipped build renders every rung inside one small panel and brings no other app forward.
> The README section "One window" describes what replaced this.

- [ ] **3.1 Flashcards actuator** lands on a *card*, not a deck list, and brings Anki forward.
  - Verify: `$R/test/verify_anki_delivery.sh`: calls the actuator, then asserts via AnkiConnect `guiCurrentCard` that a card is loaded AND frontmost process is `Anki`.
- [ ] **3.2 Reading actuator** opens Kindle to the last book.
  - Verify: `$R/test/verify_kindle_delivery.sh`: asserts frontmost process is `Kindle` within 5s.
- [ ] **3.3 Queue-prompt actuator** raises a focused capture window that accepts text and
      appends to `logs/queued_prompts.jsonl`.
  - Verify: `$R/test/verify_capture.sh`: scripted keystrokes land in the file.
- [ ] **3.4 To-do actuator** opens the Obsidian vault to the configured note.
  - Verify: `$R/test/verify_obsidian.sh`: asserts frontmost process is `Obsidian`.
- [ ] **3.5 Delivery guard.** Nothing is delivered unless the frontmost app at arm time is in
      `{Claude, Cowork, Ghostty, iTerm2, Terminal, Warp}`.
  - Verify: `python3 $R/test/test_delivery_guard.py`
- [ ] **3.6 Non-destructive.** No actuator quits, hides, or closes any application.
  - Verify: `! grep -rnE '\b(quit|kill|pkill|close window)\b' $R/lib/actuators/ && echo PASS || echo FAIL`
- [ ] **3.7 Advance key cycles rungs (decision 2b).** A single global hotkey delivers the next
      rung in ladder order, wrapping at the end, without presenting any list, menu, picker, or
      prompt. Holding it walks the ladder. Each advance is logged with the rung left and the
      rung entered.
  - Verify: `python3 $R/test/test_advance_key.py`: asserts the sequence flashcards → reading → queue_prompt → todo → flashcards across five presses, asserts an empty rung is skipped rather than delivered, and asserts a log line per press.
  - Verify (no menu): `! grep -rniE 'menu|picker|chooser|selectFrom|dialog' $R/lib/advance* && echo PASS || echo FAIL`

---

## Phase 4: Reclaim

- [ ] **4.1 Reclaim on completion and on permission request,** within 3s: origin surface comes
      forward, a notification names the session and the reason.
  - Verify: `$R/test/verify_reclaim.sh`: injects an `end` event, asserts frontmost process returns to the origin app within 3s.
- [ ] **4.2 Reclaim never types into the delivered app**, so a half-answered card survives.
  - Verify: `! grep -rnE 'keystroke|key code' $R/lib/reclaim* && echo PASS || echo FAIL`
- [ ] **4.3 Cooldown honoured.** No delivery within `cooldown` seconds of a reclaim.
  - Verify: `python3 $R/test/test_cooldown.py`
- [ ] **4.4 Stand-down keys.** One key stands down the current gap, one disarms for the day;
      both write a logged reason.
  - Verify: `python3 $R/test/test_standdown.py` (asserts state change + log line for each).

---

## Phase 5: Dashboard, design pass (UI → UX convergence loop #1)

> **Note.** The four verify commands in Phases 5 and 6 read a `UX_FEEDBACK.md` at the repo
> root. That file is the convergence loop's own scratch surface: it holds whatever the current
> review round wrote, and it is rewritten each round rather than accumulated.

Personas for U, derived from this spec:

- **Scott, operator.** Wants to know at a glance whether the router is helping or misfiring,
  and to retune thresholds in seconds. Frustrated by dashboards that show activity but not
  whether the thing is working.
- **Scott, sceptic.** Suspects the premise may be wrong (that boredom was never the trigger).
  Wants the page to be capable of telling him he was wrong, not just to celebrate streaks.

- [ ] **5.D UI design pass.** Build the dashboard design with `frontend-design` +
      `design-reference`; self-check with `web-design-guidelines`. Must surface: gaps captured,
      minutes reclaimed, per-rung breakdown, false-positive rate, stand-down rate, and a raw
      gap log.
  - Verify: `test -s $R/web/dashboard.html && ! grep -qE '^- \[ \].*\{worthwhile\}' $R/UX_FEEDBACK.md 2>/dev/null && echo PASS || echo FAIL`
- [ ] **5.U Synthetic UX review (design only).** Spin up the UX subagent with the personas
      above and the framing: "you are reviewing the UI and its design only for this phase; you
      cannot interact with it. Judge layout, hierarchy, clarity, affordance, copy, and visual
      accessibility from the markup and screenshots." It writes `$R/UX_FEEDBACK.md`.
  - Verify: `test -s $R/UX_FEEDBACK.md && echo PASS || echo FAIL`
- [ ] **5.J Judge worthwhile feedback.** Fresh-context judge given this spec + `UX_FEEDBACK.md`
      tags each item `{worthwhile}` or `{skip}`.
  - Verify (converged): `grep -qE '^- \[ \].*\{worthwhile\}' $R/UX_FEEDBACK.md && echo "FAIL: rework 5.D" || echo PASS`

**Mechanic:** worthwhile feedback unticks 5.D. 5.D addressing items unticks 5.U. Ping-pong
until J finds zero open worthwhile items.

---

## Phase 6: Dashboard, code pass (UI → UX convergence loop #2)

- [ ] **6.1 Dashboard served from real log data**, no fabricated rows, empty state renders
      honestly when there are no gaps yet.
  - Verify: `$R/test/verify_dashboard_data.sh`: asserts every rendered row traces to a line in `logs/gaps.jsonl`, and that a zeroed log renders the empty state rather than placeholder numbers.
- [ ] **6.2 Debug route.** `/debug` lets a gap be driven into any state (arm, each rung,
      reclaim, veto, stand-down) without waiting for a real agent, and the URL is documented in
      `$R/README.md`.
  - Verify: `curl -s localhost:PORT/debug | grep -q 'force-rung' && grep -q '/debug' $R/README.md && echo PASS || echo FAIL`
- [ ] **6.3 Transparency.** Every gap row links to its raw event lines and shows the router's
      reason string for the rung it chose.
  - Verify: `$R/test/verify_transparency.sh`: asserts each row exposes `reason` and a link resolving to real event offsets.
- [ ] **6.4 Overlay bounds.** Any modal/drawer/popover uses `max-h-[min(90vh,calc(100vh-3rem))]`
      + `overflow-y-auto` + sticky header.
  - Verify: `$R/test/verify_overlay_bounds.sh`: greps every overlay for bounded height, fails on any unbounded one.
- [ ] **6.D / 6.U / 6.J** Same three-way loop as Phase 5, except U **can interact** with the
      running dashboard and drives it.
  - Verify 6.U: `node $R/test/ux_drive.js` (Playwright script exercises the dashboard and writes findings) `&& test -s $R/UX_FEEDBACK.md`
  - Verify 6.J (converged): `grep -qE '^- \[ \].*\{worthwhile\}' $R/UX_FEEDBACK.md && echo "FAIL: rework 6.D" || echo PASS`

---

## Phase 7: Install and run for real

- [ ] **7.1 LaunchAgent** `com.scottlydon.interstice.plist` runs the daemon, `KeepAlive`,
      survives reboot.
  - Verify: `launchctl list | grep -q interstice && echo PASS || echo FAIL`
- [ ] **7.2 Deploy verification (per DEPLOY-VERIFY-OR-DIE).** Kill, confirm zero leftovers,
      restart, health check, behaviour check.
  - Verify: `pkill -9 -f interstice; sleep 1; ps aux | grep interstice | grep -v grep | wc -l` prints `0`, then `launchctl kickstart -k gui/$(id -u)/com.scottlydon.interstice`, then `sleep 3 && curl -s --max-time 5 localhost:PORT/health | grep -q ok`
- [ ] **7.3 Heartbeat.** If zero gaps are detected across 24h of Cowork usage, the daemon
      writes a `DETECTION_SILENT` warning rather than failing quietly.
  - Verify: `python3 $R/test/test_heartbeat.py` (clock injected; asserts the warning fires).
- [ ] **7.4 End-to-end on a real Cowork prompt.** A genuine prompt submitted in Cowork produces
      a real delivery and a real reclaim.
  - Verify: `python3 $R/test/e2e_live.py`: asserts a `gaps.jsonl` record exists whose `surface=="cowork"`, `delivered!=null`, and `reclaimed_at - submitted_at` matches the observed turn duration within 2s. **Synthetic events are rejected by this test; it fails unless the event came from a real transcript file.**

---

## Phase 8: Soak and tune (the loop stays open here)

- [ ] **8.1 Seven days of real usage logged**, no gap missing.
  - Verify: `python3 $R/test/soak_report.py --days 7 --assert-complete`
- [ ] **8.2 False-positive rate under 5%.** A false positive is a delivery followed by a
      stand-down or a return to the origin app within 10s.
  - Verify: `python3 $R/test/soak_report.py --assert-fp-under 0.05`
- [ ] **8.3 Thresholds retuned from measured data**, `config/ladder.json` updated, and the
      change justified by the distribution of real turn durations.
  - Verify: `python3 $R/test/soak_report.py --assert-thresholds-derived`
- [ ] **8.4 Premise check reported.** The soak report states whether time-to-vice after a
      delivered gap improved, got worse, or did not move. This item passes when the report
      contains the finding, **including when the finding is that the premise was wrong.**
  - Verify: `python3 $R/test/soak_report.py --assert-premise-section`

---

## Standing rules for this loop

- No mock, stub, or reused data anywhere. Phase 7.4 and Phase 8 must run against genuine
  Cowork and Claude Code turns. If a real result is unavailable, stop and say so.
- No actuator may quit, hide, or close an app. Delivery only ever changes which window is in
  front.
- Every changed line must trace to an item above.
- Deploy verification (Phase 7.2) reruns after every daemon change. A code edit that has not
  been restarted and behaviour-checked is not shipped.
