# GOAL_LOOP: Interstice — reader repair, immersive reading, focus stars, video guard, prompt latency

**Created:** 2026-08-17
**Repo root:** `/Users/scottlydon/Developer/interstice` (referred to below as `$R`)
**Predecessor loop:** `$R/docs/GOAL_LOOP.md` (the loop that built the system). This loop
extends it and must not contradict it. Where this document and the predecessor disagree,
the disagreement is itself a bug to fix, not a fork to tolerate.

---

## How to start this loop from a terminal

This loop is driven by `cont`, the runner already defined in `~/.zshrc` line ~150. Do not
write a new runner: `cont` already supplies the iteration cap, the convergence phrase, and
the error triage this loop needs.

**Step 1 — seed a session.** `cont` calls `claude --continue -p`, which needs an existing
session in the working directory to continue from. Run this once, interactively:

```bash
cd /Users/scottlydon/Developer/interstice
claude
```

Type anything (for example `read docs/GOAL_LOOP_STARS_READER_2026-08-17.md`) and exit. This
is the one step `cont` cannot do for itself; its own error text says so.

**Step 2 — run the loop.** Paste this whole block:

```bash
export R="/Users/scottlydon/Developer/interstice"
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"

cd "$R" || { echo "FATAL: $R does not exist."; exit 1; }
command -v node   >/dev/null || { echo "FATAL: node not on PATH (expected /opt/homebrew/bin/node)."; exit 1; }
command -v claude >/dev/null || { echo "FATAL: claude not on PATH (expected ~/.local/bin/claude)."; exit 1; }

cont 40 "Work the goal loop at docs/GOAL_LOOP_STARS_READER_2026-08-17.md in $R.
Read the whole file before acting. Obey its RULE block verbatim: the only edits you may
make to that file are ticking completed boxes and appending one link to your parallel
notes. Start at Phase 0 item 0.0a and continue in order.
Every Verify line assumes R=$R is exported and that /opt/homebrew/bin is on PATH; export
both in every shell you spawn, because a non-login shell cannot see node.
Say the phrase 'I'm completely done.' ONLY when every single box in the file is ticked.
If any box remains unticked, do not say it, and instead report which box you are on."
```

**Why 40.** `cont`'s default cap is 8. This loop has 88 checkboxes across 10 phases, two
UI-to-UX convergence sub-loops that ping-pong an unknown number of rounds, and a routed
audit over 319 rules. Eight iterations would hit the hard cap far short of the end, and
`cont` returns exit 2 in that case rather than pretending it finished. Raise the number and
re-run `cont` if it caps; the loop is resumable because its state lives in the ticked boxes.

**Reading the exit code.** `cont` returns `0` when the agent said the phrase, `2` when it
hit the cap with work outstanding, and `1` when the CLI itself failed. Only `0` means the
loop is done, and even then Z-block item 9.2 has to have passed.

## RULE (read before touching anything)

```
RULE: Do not edit this goal loop except to check off completed work. You can keep your own
parallel notes to this however, you can add a link to said notes at the end of this
checklist. So checking off boxes and adding a link to your parallel notes, thats it.

Do not check a box unless it is complete.

If you ever need credentials from the user use secrets driver mcp. If you need anything
else, consider that you actually have everything you need. If you truly are blocked and
need something from the user that you really can't get otherwise (super unlikely), trigger
a system prompt to ask the user for it (terminal mcp, ssh). Don't just assume the user is
sitting at the terminal staring at your telemetry for 5 hours putting all their attention
waiting to address your needs.

Again, in the once in a million years event that you are blocked on any given part, do
absolutely everything else you possibly can, instead of stalling progress on the rest.
Obviously this doesn't apply to tasks that are dependent on your blocked task.
```

**Methodology note.** Every "how" in this document — every named file, function signature,
command, library choice, and sequence of steps — is offered **by way of suggestion**. The
done criterion attached to each item is binding; the suggested route to it is not. If a
better route exists, take it and record why in your parallel notes.

**Autonomy rule.** Every item below carries a machine-runnable or agent-runnable verify.
No item waits on a person to look at, approve, answer, or confirm anything. Every fork that
would otherwise need the operator is pre-resolved in "Settled decisions" below.

---

## Settled decisions (resolved with the operator on 2026-08-17 — do not re-derive, do not re-ask)

| # | Question | Settled value | Consequence |
|---|---|---|---|
| S1 | What earns one star? | **25 unbroken minutes of focus.** | One star per completed 25-minute block. Duration is `focus.blockMinutes` in config, defaulting to `25`, so the number is retunable without a code change. Partial blocks earn nothing and are discarded. |
| S2 | What breaks a block and forfeits the star? | **(a) a blacklisted app becomes frontmost, (b) display sleep or screen lock, (c) online video plays from a non-whitelisted source.** | Keyboard/mouse idle alone does **not** break a block. Reading a book without touching the keyboard is focus, not absence. Do not add an idle breaker. |
| S3 | How wide does video detection cast? | **Browsers only**, via tab URL plus play state. | Reuses `$R/lib/cdp.js`. Chromium-family over CDP; Safari over its own scripting interface. Native video apps (a Netflix desktop app, QuickTime) are out of scope for this loop and must be named as out of scope in the docs rather than silently missing. |
| S4 | Does using the Interstice panel break a focus block? | **No.** The panel is the product's answer to the gap; delivering it and forfeiting the star for it would be self-defeating. | Interstice's own panel process, and the headless reader profile it drives, are permanently whitelisted in both the app blacklist and the video whitelist. Encode this as a constant, not a config default a user could break. |
| S5 | Star granularity and timezone. | **Local calendar day**, `America/Los_Angeles`, day boundary at local midnight. | A block that spans midnight is credited to the day it **completed**. Store every timestamp as ISO 8601 with offset; never store a bare local string. |
| S6 | Goal loop home. | `$R/docs/GOAL_LOOP_STARS_READER_2026-08-17.md` | Lives in the repo and is committed with the work, so the checklist and the code cannot drift apart. |
| S7 | Playwright versus the zero-dependency promise. | **Playwright is added to `devDependencies`, and `README.md` line 50 is corrected to say "no runtime dependencies".** | Four items in this loop (2C.1, 3.8, 5.2, 6.2) drive the running UI, and the repo currently has empty `dependencies` **and** empty `devDependencies` while the README promises "There are no npm dependencies." Shipping a test dependency without correcting that sentence would make the README false, which is the exact self-inconsistency this project forbids. A test-only tool does not change what a user installs to *run* Interstice, so the promise stays true once it is stated precisely. `bin/interstice.js` and `doctor` must keep working with `node_modules` absent. |

---

## Ground truth verified on 2026-08-17 (do not re-derive)

| Fact | Value | Consequence |
|---|---|---|
| Node | `/opt/homebrew/bin/node`, v23.11.0 | Present in a login shell (`zsh -lc`), **absent from a plain non-login ssh shell**. Any spawned shell must export the PATH above or every `npm test` verify fails for the wrong reason. |
| Git remote | `origin` → `github.com/scott-lydon/interstice.git`, `origin/main` exists | HEAD is **4 commits ahead, unpushed** as of this writing. Item 0.3 compares against `origin/main`; expect a non-zero right-hand count and do not read it as a deploy lag. |
| Screen lock probe, zero dependencies | `ioreg -n Root -d1 -a \| plutil -extract IOConsoleLocked raw -` → `true`/`false` | Satisfies breaker 3.4 without a native module. It is a poll, not an event, so pair it with a sleep/wake notification if an event source is found; do not treat the poll as a blocker. |
| Frontmost app probe, zero dependencies | `lsappinfo info -only name $(lsappinfo front)` → `"LSDisplayName"="Claude"` | Satisfies breaker 3.3 without a native module or Accessibility permission. |
| Playwright | **not installed**, not resolvable locally or globally | See S7. Nothing that needs it can run until 0.0c completes. |
| `CLAUDE.md` | **does not exist** in this repo | See 0.0d. |

## Success condition (the loop closes only when every one of these holds)

1. The reading rung opens a real book, at the synced position, from a cold start, on three
   consecutive attempts, with zero manual intervention — and the specific defect that
   caused the original failure has a named regression test that fails against the old code.
2. While reading, the page occupies at least 90% of the panel's usable height and width;
   every other control is reachable behind exactly one menu affordance and nothing else
   competes for that space.
3. A completed 25-minute unbroken focus block awards exactly one star, persisted durably,
   and each of the three break causes in S2 is proven to forfeit the block by an automated
   test.
4. Stars are displayed per day and per month, and every individual star can be inspected to
   reveal the wall-clock start and end of the block that earned it.
5. Online video from a non-whitelisted source forfeits the in-progress block; video from a
   whitelisted source (Udemy ships as a default entry) does not.
6. The panel shows a live elapsed-time-since-prompt-submitted indicator, it clears when the
   agent's response arrives, and the arrival raises its own distinct notification.
7. `npm test` passes with zero failures, and no item in `UX_FEEDBACK.md` matches
   `^- \[ \].*\{worthwhile\}`.
8. A recorded video demonstrates every one of items 1 through 6 actually happening.

---

## Phase 0 — Preflight: unblock everything before writing a line

- [x] **0.0a Environment is exported and proven, before any other item.** Every later
  `Verify` line depends on it.
  - Verify: `test -d "$R" && command -v node && command -v npm && command -v git` all
    succeed in the shell the loop will actually use. If `node` is missing, the shell is
    non-login; re-run under `zsh -lc` or export `/opt/homebrew/bin` and record which.
- [x] **0.0b Resolve S7 in the files, not just in this table.** Correct `README.md` line 50
  from "There are no npm dependencies" to the precise claim, so the repo does not ship a
  false sentence the moment a devDependency appears.
  - Verify: `grep -n "no runtime dependencies" $R/README.md` returns a match AND
    `grep -c "There are no npm dependencies" $R/README.md` returns 0.
- [x] **0.0c Install Playwright as a devDependency and prove the runtime path is unaffected.**
  - Suggested route: `npm i -D @playwright/test` then `npx playwright install chromium`.
    Chromium may already be present from the reader's own profile; reuse it rather than
    downloading a second copy if the versions are compatible.
  - Verify: `cd $R && npx playwright --version` succeeds, AND — proving Interstice still
    runs without its test tooling — `mv node_modules /tmp/pw-parked && node ./bin/interstice.js doctor; rc=$?; mv /tmp/pw-parked node_modules; exit $rc`
    exits 0.
- [x] **0.0d Create `$R/CLAUDE.md` so a fresh session inherits this loop's constraints.**
  Without it, a new agent opening this repo does not know that idle must not break a focus
  block (S2), that the panel never breaks its own block (S4), or that the reader failure
  path must throw remedy-bearing errors.
  - Suggested content: a short file pointing at this goal loop, the settled decisions
    table, and `docs/GOAL_LOOP.md`; not a copy of them, so there is one source of truth.
  - Verify: `test -s $R/CLAUDE.md` AND `grep -q "GOAL_LOOP_STARS_READER_2026-08-17" $R/CLAUDE.md`
    AND the file contains no duplicated decision text, only references — checked by
    asserting the phrase "25 unbroken minutes" appears in the goal loop and **not** in
    `CLAUDE.md`.
- [x] **0.0e Push the goal loop commits before starting work**, so the checklist exists on
  the remote if this machine is lost mid-loop.
  - Verify: `cd $R && git rev-list --count origin/main..HEAD` returns 0 at the moment
    Phase 1 begins.

- [x] **0.1 Machine load guard.** Run `uptime` on the target Mac. If the 1-minute load
  average exceeds the core count, wait and re-check rather than starting a build. Never run
  two heavy builds concurrently.
  - Verify: `ssh localhost uptime` recorded in parallel notes, load average below core count.
- [x] **0.2 Secrets Driver grant, requested up front.** The reading rung authenticates
  against Amazon's web reader. Before any diagnosis, request a time-boxed, budget-scoped
  grant covering the Amazon account credential via the Secrets Driver MCP so that a sign-in
  wall later in the loop is a known-resolved step and not a fresh blocker.
  - Suggested route: `request_grant` → `authenticate_grant` → `grant_status`, then
    `get_secret` only at the moment of use.
  - Verify: `grant_status` returns an active grant covering the Amazon reader credential,
    OR the diagnosis in 1.2 proves the existing carried session in
    `$R/logs/reader-profile` is still valid and no credential is needed. Exactly one of
    these two must be recorded, with evidence.
- [x] **0.3 Deployment asymmetry check.** Before debugging anything, confirm the working
  tree is not behind a deploy branch.
  - Verify: `cd $R && git rev-list --left-right --count origin/main...HEAD` — record both
    counts. If HEAD is behind, merge before diagnosing.
### 0.3b Reconcile the pre-existing uncommitted work (do this before the baseline)

As of 2026-08-17 the working tree carries uncommitted modifications to
`lib/reader.js`, `lib/ocr.js`, `lib/panel.js`, `lib/server.js`,
`config/interstice.config.default.json`, `web/panel.html`, `test/ocr.test.js` and
`test/reader.test.js`. That is precisely the file set Phases 1 and 2 touch, which means it
is probably partial work on the book-loading failure. It must be reconciled before
anything else: building on top of unexamined changes makes every later bisect lie, and
discarding them silently throws away a diagnosis someone already paid for.

- [x] **0.3b.1 Preserve the diff before touching it.** Write the full diff and the
  untracked file list to a timestamped file outside the working tree, so no subsequent
  operation can lose it.
  - Verify: `test -s` on the saved diff file returns true, and its line count matches
    `git diff | wc -l`.
- [x] **0.3b.2 Classify every changed hunk into exactly one of four buckets.**
  (a) **useful and finished** — a coherent change that stands on its own;
  (b) **useful but partial** — the right direction, incomplete;
  (c) **debug scaffolding** — logging, probes, commented-out experiments;
  (d) **unrelated** — belongs to some other line of work.
  - Verify: a written table with one row per changed file, each row naming its bucket and
    citing the hunk that decides it. No file may be left unclassified.
- [x] **0.3b.3 Commit bucket (a) on its own, with a message that says what it does.**
  Separate logical units get separate commits; unrelated changes are never squashed
  together.
  - Verify: `git log --oneline` shows one commit per logical unit, and
    `git show --stat` for each contains only files from that unit.
- [x] **0.3b.4 Carry bucket (b) forward as the starting point for Phase 1, not as a
  discovery to be re-made.** Whatever the partial work already established about the book
  failure is evidence, and Phase 1.2 must reconcile its classification against it.
  - Verify: the parallel notes record what the partial work had already determined, and
    Phase 1.2's bucket choice either agrees with it or states specifically why it does not.
- [x] **0.3b.5 Park buckets (c) and (d) on a branch, never delete them.**
  - Verify: `git branch --list` shows the parking branch and `git show <branch>` contains
    the scaffolding; the working tree no longer carries it.
- [x] **0.3b.6 Working tree is clean before Phase 1 begins.**
  - Verify: `cd $R && git status --porcelain` produces no output.

- [x] **0.4 Baseline green — measured AFTER 0.3b, not before.** Establish the post-
  reconciliation state of the test suite so later failures are attributable. A baseline
  taken over a dirty tree would attribute someone else's half-finished work to this loop.
  - Verify: `cd $R && git status --porcelain` is empty AND
    `cd $R && npm test 2>&1 | tail -20` — record pass/fail counts verbatim in parallel
    notes.
- [x] **0.5 Read the predecessor spec.** Read `$R/docs/GOAL_LOOP.md`, `$R/README.md`, and
  `$R/config/interstice.config.default.json` end to end so this loop's additions match the
  system's existing vocabulary (rung, gap, ladder, actuator, companion) rather than
  inventing a parallel one.
  - Verify: parallel notes contain a table mapping each new concept in this loop (focus
    block, star, break event, video probe, latency ticker) onto the existing vocabulary,
    naming which existing module each new module will talk to and through which contract.
- [x] **0.6 Module contract sketch, before any implementation.** Per the operator's
  modularity rule, each new capability is a module that talks to the rest of the system
  only through a small protocol and plain data types, never by reaching into internals.
  - Suggested shape: `lib/focus/blocks.js` (state machine, pure), `lib/focus/store.js`
    (persistence), `lib/focus/breakers/*.js` (one breaker per cause, each exporting the
    same three-function interface), `lib/video/probe.js`, `lib/latency.js`. Each breaker
    emits a plain `{ cause, at, detail }` object and knows nothing about stars.
  - Verify: a written contract file exists listing, for every new module, its exported
    surface and the plain data types crossing each boundary; and
    `grep -rn "require\|import" lib/focus lib/video` shows no new module importing another
    new module's internals beyond those declared exports.

### 0.7 Blocker Resolver Monitor (stand this up before feature work, keep it running the whole loop)

- [ ] **0.7 Blocker Resolver Monitor is live.** A recurring agent fires **every 3 minutes**
  for the duration of this loop. Its job is to detect an *artificial* blocker — a
  non-real blocker that appears real, typically a limitation being imagined or incorrectly
  assumed rather than actually present — and to produce a concrete route around it.
  - Behaviour it must implement:
    - Maintain a tally file, suggested `$R/logs/blockers.json`, keyed by perceived blocker
      (`PB1`, `PB2`, …), recording each attempt and which model made it.
    - **Escalate one attempt per model, in order: Haiku → Sonnet → Opus → Fable.** Each
      model gets exactly one attempt at a given perceived blocker. If Fable also fails,
      mark that blocker abandoned and move on — never loop a model back onto a blocker it
      has already attempted.
    - Spin up a Haiku agent per past blocker on each recurrence to re-check whether a
      previously abandoned blocker has since become resolvable.
    - Apply the `route-around-not-stop` skill as its lens: any sentence in the working log
      of the form "blocked", "can't", "not possible", "requires the user" is a trigger.
  - Suggested route: create it as a **durable scheduled task** via the Claude Code Remote
    MCP (`create_trigger`, cron `*/3 * * * *` semantics as the server permits), **not** via
    the in-process `CronCreate` tools, which die with the session and would silently never
    run.
  - Verify: `list_triggers` shows an enabled recurring task named for this loop, AND
    `test -f $R/logs/blockers.json` succeeds, AND that file contains at least one entry
    with an `attempts` array by the time Phase 1 completes.
- [ ] **0.8 Monitor teardown is scheduled, not forgotten.** The monitor is deleted at the
  end of the loop (item Z8), so it cannot outlive the work and fire forever.
  - Verify: the trigger id is recorded in parallel notes so Z8 can delete it by id.

---

## Phase 1 — Fix the book loading failure

The panel already has a dedicated failure surface (`#reader-failed`, `#reader-failed-why`
in `$R/web/panel.html`), which means the failure is being caught and reported rather than
crashing. The diagnosis must therefore start from what that surface actually says.

- [ ] **1.1 Capture the failure verbatim.** Drive the reading rung from a cold start and
  capture the exact text rendered into `#reader-failed-why`, plus the full daemon log for
  that attempt.
  - Verify: parallel notes contain the literal failure string and a log excerpt with
    timestamps; `test -s` on the captured log file returns true.
- [x] **1.2 Classify the failure into exactly one of these buckets** (add a bucket if the
  evidence fits none, rather than forcing a fit):
  - (a) **Not signed in** — `signedInToReader(probe)` in `$R/lib/reader.js:122` returns
    false; the carried Chrome session in `$R/logs/reader-profile` has expired.
  - (b) **No browser binary** — `no Chromium-family browser found to render the book`
    (`$R/lib/reader.js:770`).
  - (c) **Load timeout** — the 40s `loadTimeoutMs` deadline
    (`$R/lib/reader.js:406,1013`) expires before the reader paints.
  - (d) **Wrong or missing ASIN** — the Kindle Core Data read in `$R/lib/state/kindle.js`
    yields no book, or an ASIN the reader rejects.
  - (e) **Amazon reader markup drift** — the `PROBE` selector set
    (`$R/lib/reader.js:57`) no longer matches Amazon's current DOM.
  - (f) **CDP attach/port failure** — `$R/lib/cdp.js` cannot attach on `readerPort` 7421.
  - Verify: parallel notes name exactly one bucket and cite the specific line of evidence
    (log line, probe output, or DOM dump) that rules the other buckets out.
- [x] **1.3 Write the failing regression test first.** Before the fix, add a test to
  `$R/test/reader.test.js` (or a new `$R/test/reader-load.test.js`) that reproduces the
  classified bucket and fails against current `main`.
  - Verify: `cd $R && git stash && npm test 2>&1 | grep -c 'fail'` shows the new test
    failing on unmodified code, then `git stash pop`.
- [x] **1.4 Fix the classified root cause.** Fix the cause, not the symptom. A retry loop
  wrapped around a broken selector is a symptom fix and does not satisfy this item.
  - Verify: the test from 1.3 passes, and `npm test` shows zero regressions against the
    0.4 baseline.
- [x] **1.5 Harden the error reporting for this class of failure.** Per the project rule,
  after a fix the codebase must expose this kind of issue earlier next time. Every failure
  path in the reader must throw a specific, actionable error naming (i) what was being
  attempted, (ii) the concrete value that was wrong, and (iii) the suggested remedy.
  - Suggested route: replace any bare `throw new Error('...')` and any generic catch in
    `$R/lib/reader.js` with a small `ReaderError` carrying `{ stage, expected, actual,
    remedy }`, and render `remedy` into `#reader-failed-why`.
  - Verify: `grep -nE "throw new Error\('[a-z ]{0,25}'\)" $R/lib/reader.js` returns no
    matches, AND every reader throw site has a test asserting its message names a remedy.
- [x] **1.6 Extend `doctor` to prove the reading rung.** `doctor` already exists to prove
  dependencies that can silently null the system. The reader is now such a dependency.
  - Verify: `cd $R && node ./bin/interstice.js doctor` prints a reading-rung check that
    fails loudly and specifically when the session is expired, the browser is missing, or
    the port is occupied. Prove each by temporarily inducing it in a test.
- [ ] **1.7 Cold-start proof, three consecutive times.** From a fully cold state, the book
  opens at the synced position with no intervention.
  - Verify: a scripted run performs three cold starts and asserts a non-blank rendered page
    plus a page number matching the Kindle-synced position each time; exit code 0.
- [x] **1.8 Add the observed failure to the bug/issue prevention checklist.** Per the
  operator's standing rule, append a brief-enough-to-work entry describing the issue and
  how to prevent it.
  - Verify: `grep -qi "reader" $R/docs/BUG_ISSUE_PREVENTION.md` (create the file if this is
    its first entry) returns 0, and the entry names both the cause and the prevention.

---

## Phase 2 — Immersive reading: page fills the window, everything else behind a menu

### 2A. Design

- [x] **2A.1 Inventory what currently competes with the page.** Enumerate every element
  rendered in `$R/web/panel.html` while `#view-reading` is active — `<header>`, `.rungs`
  nav, `#companions` aside, `#book-title`, `#book-why`, `#book-bar`, `#reader-page`,
  `#page-prev`, `#page-next`, `#reader-mode`, `#book-actions`, `#reader-note`, footer
  `#status`, `#advance` — and record the vertical and horizontal pixels each consumes at
  the default 640×900 panel size.
  - Verify: a measured table exists with a pixel figure per element and a computed
    "page gets N% of usable area" figure for the current build.
- [x] **2A.2 Define the target layout contract.** The page region occupies **≥90% of both
  usable panel dimensions** while reading. Exactly one menu affordance exposes everything
  displaced. Page-turn must remain reachable without opening the menu (arrow keys already
  bind; the visible buttons may move into an auto-hiding overlay).
  - Verify: the contract is written down with the ≥90% figure and the list of what moves
    behind the menu, and it does not contradict the "one window, no second window" decision
    in `$R/docs/GOAL_LOOP.md`.
- [x] **2A.3 Cross-check the contract against the reader's own minimums.**
  `$R/lib/reader.js` declares `MIN_WIDTH = 480`, `MIN_HEIGHT = 400`, and a `fitViewport`
  function. The immersive layout must not request a viewport below those.
  - Verify: a test asserts the immersive layout's computed viewport passes `fitViewport`
    unchanged at the default panel size and at the smallest size the panel permits.
- [x] **2A.4 Design the menu affordance and the star surface together.** The month/day star
  calendar from Phase 3 also needs a home, and it belongs behind the same menu. Design both
  now so a second menu is never invented later.
  - Suggested route: apply `frontend-design` for the aesthetic direction, `design-reference`
    for the concrete palette / type pairing / style recipe, `dataviz` for the star calendar's
    form and color, and `web-design-guidelines` to self-check the result.
  - Verify: `test -s $R/docs/design-immersive-reading.html` (a rendered design artifact, in
    the same spirit as the existing `$R/docs/design-brief.html`) AND
    `! grep -qE '^- \[ \].*\{worthwhile\}' $R/UX_FEEDBACK.md 2>/dev/null`.

### 2B. UI → UX convergence sub-loop, design pass

- [x] **2B.1 D — UI design pass.** Build or revise the immersive reading layout and the
  menu using `frontend-design` + `design-reference`; self-check with
  `web-design-guidelines`. D is not done when the design exists; D is done when every open
  worthwhile UX item is addressed.
  - Verify: `test -s $R/docs/design-immersive-reading.html && ! grep -qE '^- \[ \].*\{worthwhile\}' $R/UX_FEEDBACK.md 2>/dev/null && echo PASS || echo FAIL`
- [ ] **2B.2 U — Synthetic UX review (design only, no interaction).** Spin up a UX subagent
  given personas derived from this spec, reviewing as the users and not as an engineer.
  Personas, at minimum:
  - **Scott, the operator.** Goal: read a real book in the four dead minutes after
    dispatching an agent, without deciding anything. Context: ADD, a 640×900 panel in the
    bottom-right corner, keyboard-first. Likely frustration: chrome and status text eating
    the page; a menu that costs more attention than the thing it hides.
  - **A first-run installer.** Goal: understand what the panel is showing within two
    seconds of first sight. Context: has never seen this UI, no onboarding. Likely
    frustration: an unlabelled menu button, no cue that page-turn still works.
  - **A star-checker.** Goal: glance at this month's stars and see when today's happened.
    Context: opens the menu specifically for this. Likely frustration: a calendar that
    shows counts but hides times; ambiguity about what a star means.
  - Framing: "you are reviewing the UI and its design only for this phase; you cannot
    interact with it. Judge layout, hierarchy, clarity, affordance, copy, and visual
    accessibility from the markup and screenshots."
  - It writes or updates `$R/UX_FEEDBACK.md`, one checkable item per issue, in the form
    `- [ ] (severity) [persona] issue`.
  - Verify: `test -s $R/UX_FEEDBACK.md && echo PASS || echo FAIL`
- [ ] **2B.3 J — Judge worthwhile feedback.** Spin up a judge agent with **fresh context**,
  given this spec plus `$R/UX_FEEDBACK.md`. For each item it rules `{worthwhile}` (real
  user value, in scope) or `{skip}` (nitpick, out of scope, taste only).
  - Verify (converged): `grep -qE '^- \[ \].*\{worthwhile\}' $R/UX_FEEDBACK.md && echo "FAIL: rework D" || echo PASS`
- [ ] **2B.4 Ping-pong until convergence.** When U produces worthwhile feedback confirmed by
  J, **U unticks D**. D addresses every worthwhile item, checks each to `- [x]`, then
  **unticks U** so U must re-review. Repeat until J finds nothing worthwhile open.
  - Verify: the convergence command in 2B.3 prints PASS on a U pass that ran *after* the
    most recent D change, provable by file mtimes.

### 2C. Implementation

- [ ] **2C.1 Implement the immersive layout in `$R/web/panel.html`.**
  - Verify: a `webapp-testing` Playwright script measures the rendered page region and
    asserts ≥90% of both usable panel dimensions while `#view-reading` is active.
- [ ] **2C.2 Implement the single menu affordance** housing everything displaced in 2A.1
  plus the star surface slot from Phase 3.
  - Verify: an automated test asserts exactly one menu trigger exists in the reading view,
    that every element enumerated in 2A.1 is reachable from it, and that no enumerated
    element remains outside it.
- [ ] **2C.3 Preserve keyboard page-turn and the advance key.** Arrow keys turn pages and
  the existing advance hotkey still works with the menu closed and with it open.
  - Verify: automated key-event test covering both menu states, both directions, plus advance.
- [ ] **2C.4 Menu is accessible.** Focus is trapped while open, `Escape` closes it, the
  trigger has an accessible name, and focus returns to the trigger on close.
  - Verify: automated accessibility assertions on the four behaviours above.
- [ ] **2C.5 Non-reading rungs are unharmed.** Flashcards, queue_prompt and todo views
  render and behave exactly as before.
  - Verify: `cd $R && npm test` — `panel.test.js` and the rung tests pass with no
    regressions against the 0.4 baseline.

---

## Phase 3 — Focus blocks and stars

Per S1: **one star per 25 unbroken minutes.** Per S2: broken by a blacklisted app coming
frontmost, by display sleep or screen lock, or by non-whitelisted online video (Phase 4).
Per S4: Interstice's own panel never breaks a block.

- [x] **3.1 Focus block state machine, pure and testable.** A module that takes a stream of
  plain events (`start`, `tick`, `break{cause, at}`) and emits `blockCompleted{startedAt,
  endedAt}` or `blockForfeited{cause, at, elapsedMs}`. No I/O, no timers, no knowledge of
  macOS.
  - Suggested route: `$R/lib/focus/blocks.js`, exporting a reducer plus a small factory.
  - Verify: `$R/test/focus-blocks.test.js` covers, at minimum: exact-25-minute completion,
    24m59s forfeiture, break at t=0, break at t=24m59s, back-to-back blocks, and two
    breaks arriving in the same millisecond. All pass.
- [x] **3.2 Durable star store.** Append-only persistence surviving daemon restart and
  machine reboot, storing per star: `startedAt`, `endedAt`, both ISO 8601 with offset.
  - Suggested route: `$R/lib/focus/store.js` writing JSONL under `$R/logs/`, matching the
    existing gap-log convention rather than introducing a new format.
  - Verify: a test writes stars, kills and reconstructs the store, and asserts byte-exact
    recovery including timestamps; plus a test asserting a malformed line is reported with
    a specific error naming the line number, not silently skipped.
- [ ] **3.3 Breaker: blacklisted app frontmost.** Detects the frontmost application and
  emits a break when it matches the denylist.
  - Suggested route: `$R/lib/focus/breakers/frontmost.js`. The repo already reasons about
    frontmost apps via `originApps` in config; reuse that mechanism rather than adding a
    second one. New config key `focus.blacklistApps` with a sensible default set.
  - Verify: a test injects a synthetic frontmost-app signal for a denylisted bundle id and
    asserts exactly one `break{cause:'app'}` is emitted; a second test asserts an
    allowlisted app and the Interstice panel itself emit none.
- [ ] **3.4 Breaker: display sleep or screen lock.** Emits a break when the display sleeps
  or the screen locks.
  - Suggested route: `$R/lib/focus/breakers/display.js` subscribing to the macOS display
    and session-lock notifications. Prefer an event subscription over polling, consistent
    with the project's "no polling" stance.
  - Verify: a test injects synthetic sleep and lock events and asserts a
    `break{cause:'display'}` for each; and `doctor` gains a check proving the subscription
    is actually receiving events, failing loudly with a specific remedy if it is not.
- [ ] **3.5 No idle breaker exists.** Per S2, keyboard/mouse idle must **not** break a
  block.
  - Verify: `grep -rn "HIDIdleTime\|idleVeto" $R/lib/focus` returns no matches, and a test
    asserts a 25-minute block with zero input events still completes and awards a star.
- [ ] **3.6 Wire the breakers into the state machine through the declared contract only.**
  Each breaker exports the same interface and emits the same plain `{cause, at, detail}`
  shape; the state machine imports no breaker directly.
  - Verify: `grep -rn "breakers/" $R/lib/focus/blocks.js` returns no matches, and a test
    drives the state machine with a fake breaker to prove substitutability.
- [ ] **3.7 Star aggregation: per day and per month.** A query surface returning stars
  grouped by local calendar day and by calendar month, per S5.
  - Verify: a test seeds stars across a month boundary, a DST boundary, and a
    block-spanning-midnight case, and asserts each is credited to the day it completed in
    `America/Los_Angeles`.
- [ ] **3.8 Star calendar UI, behind the Phase 2 menu.** Day view and month view; every
  star reveals the wall-clock start and end of the block that earned it.
  - Suggested route: apply the `dataviz` skill before writing the first line of calendar
    code — form heuristic, palette, and legend rules — so the calendar reads as part of the
    same system as the rest of the panel.
  - Verify: a Playwright script opens the menu, opens the calendar, asserts a seeded star
    renders on the correct day cell, activates it, and asserts the revealed start and end
    times match the seeded values exactly.
- [ ] **3.9 Star data is real, never stubbed.** No placeholder counts, no sample stars, no
  demo month shipped in the UI. An empty history renders an empty calendar with honest
  copy.
  - Verify: `grep -rniE "mock|dummy|sample|placeholder|TODO" $R/lib/focus $R/web` returns
    no match inside star code paths, and a test asserts a fresh install renders zero stars
    rather than any seeded value.
- [ ] **3.10 Server surface for stars.** `$R/lib/server.js` gains the routes the calendar
  needs, consistent with its existing route style.
  - Verify: an HTTP test hits each new route and asserts shape and status codes, including
    the error shape for a malformed date range.

---

## Phase 4 — Online video detection and source whitelist

Per S3: **browsers only**, tab URL plus play state.

- [ ] **4.1 Video probe module.** Reports currently-playing online video as a list of plain
  `{ browser, url, host, playing }` records.
  - Suggested route: `$R/lib/video/probe.js`. Chromium-family via the existing
    `$R/lib/cdp.js` attach; Safari via its own scripting interface. Detect play state from
    the media element's actual playing state, not merely from the tab being open.
  - Verify: a test with a fixture page containing a playing `<video>` asserts a record with
    `playing:true`; a paused video asserts `playing:false`; a tab with no media asserts no
    record.
- [ ] **4.2 The probe never opens, focuses, or disturbs a browser.** Consistent with the
  project's "nothing is ever quit, hidden or closed" rule.
  - Verify: a test asserts the probe performs no navigation, no window activation, and no
    tab creation; and that it returns an empty list rather than launching anything when no
    browser is running.
- [ ] **4.3 Whitelist configuration, with Udemy shipping as a default.**
  - Suggested route: `focus.videoWhitelist` in `$R/config/interstice.config.default.json`,
    an ordered list of host patterns, defaulting to at least `udemy.com` and its CDN hosts.
    Match on registrable domain, so `www.udemy.com` and `*.udemy.com` both pass and a
    lookalike domain does not.
  - Verify: a test table covers `www.udemy.com` (pass), `sub.udemy.com` (pass),
    `udemy.com.evil.example` (fail), `youtube.com` (fail), and an empty/malformed URL
    (fail, with a specific error rather than a silent pass).
- [ ] **4.4 Breaker: non-whitelisted video.** Emits `break{cause:'video', detail:{host}}`
  when the probe reports a playing, non-whitelisted source.
  - Suggested route: `$R/lib/focus/breakers/video.js`, same interface as the other breakers.
  - Verify: a test asserts a whitelisted host emits no break while a non-whitelisted host
    emits exactly one, and that Interstice's own reader profile (S4) never emits one.
- [ ] **4.5 Debounce so a one-frame autoplay does not cost a block.** A brief flicker of
  playback is not a distraction; sustained playback is.
  - Suggested route: `focus.videoBreakAfterMs`, defaulting to a few seconds, applied to
    continuous playback.
  - Verify: a test asserts playback shorter than the threshold emits no break and playback
    longer than it emits exactly one.
- [ ] **4.6 The forfeit is legible, not silent.** When a block is forfeited, the panel can
  say which cause did it and at what time. Silent forfeiture would make the star system
  untrustworthy.
  - Verify: a test asserts the forfeit record carries cause and timestamp and that the UI
    surfaces both.
- [ ] **4.7 Whitelist is editable without editing code.**
  - Verify: a test writes a new host into `$R/config/interstice.config.json`, reloads
    config, and asserts the new host now passes — with no restart required, if the config
    module already supports live reload; otherwise with a documented restart.

---

## Phase 5 — Prompt latency: elapsed timer and response notification

Interstice already knows when a prompt was submitted (the transcript watcher for Cowork,
the `UserPromptSubmit` hook for Claude Code) and when the agent finishes (the reclaim
path). This phase surfaces that knowledge inside the panel.

- [ ] **5.1 Latency module.** Given the existing submit and completion events, exposes
  elapsed-since-submit per session as plain data.
  - Suggested route: `$R/lib/latency.js`, subscribing to the existing engine events rather
    than re-parsing transcripts. Re-parsing would be a second source of truth for the same
    fact.
  - Verify: `grep -rn "jsonl\|transcript" $R/lib/latency.js` returns no matches, and a unit
    test drives it purely from injected engine events.
- [ ] **5.2 Live elapsed indicator in the panel.** Shows time since the prompt was sent,
  updating while the user waits, without stealing attention from the reading page.
  - Verify: a Playwright test injects a submit event, advances time, and asserts the
    rendered elapsed string increments and matches the injected elapsed value.
- [ ] **5.3 Indicator clears on response.** When the agent's response arrives, the elapsed
  indicator is cleared, not left frozen at its last value.
  - Verify: a test injects submit then completion and asserts the indicator is absent or
    explicitly cleared afterwards.
- [ ] **5.4 Response-arrival notification inside the panel.** A distinct in-panel
  notification announces that the response landed, separate in appearance from the elapsed
  indicator.
  - Verify: a test asserts the arrival notification appears exactly once per completion
    event and is visually and structurally distinct from the elapsed indicator.
- [ ] **5.5 It works on both surfaces.** Cowork and Claude Code both drive the indicator and
  the notification.
  - Verify: separate tests inject a Cowork-shaped and a Claude-Code-shaped event and assert
    identical downstream behaviour.
- [ ] **5.6 Multiple concurrent sessions do not collide.** Two prompts in flight produce two
  correctly-attributed timers.
  - Verify: a test injects two submits with different session ids, completes one, and
    asserts only that one's indicator clears.
- [ ] **5.7 The indicator does not break the immersive layout.** With the timer visible, the
  page region still meets the ≥90% contract from 2A.2.
  - Verify: the 2C.1 measurement script re-run with an active timer still asserts ≥90%.
- [ ] **5.8 Conversational smoke test on the live path.** Per the project rule, before
  calling any LLM-driven path demo-ready, run two real prompts in sequence: a substantive
  one, then an immediate follow-up requiring prior-turn context. Confirm the timer starts
  and clears correctly for **both**, and that the second is not treated as a repeat of the
  first.
  - Verify: recorded transcript of both turns plus the timer's start/clear timestamps for
    each, showing two distinct cycles.

---

## Phase 6 — UI → UX convergence sub-loop, post-code pass

Same three roles as 2B, with one difference: the UX subagent **can interact with the
running UI**.

- [ ] **6.1 D — UI revision pass on the running build.** Revise the shipped UI using
  `frontend-design` + `design-reference`; self-check with `web-design-guidelines`.
  - Verify: `cd $R && npm test` passes AND
    `! grep -qE '^- \[ \].*\{worthwhile\}' $R/UX_FEEDBACK.md && echo PASS || echo FAIL`
- [ ] **6.2 U — Synthetic UX review (interactive).** Same personas as 2B.2, plus one more:
  - **A forfeited-star user.** Goal: understand why a block did not earn a star. Context:
    just watched a two-minute clip and lost 20 minutes of credit. Likely frustration: no
    explanation, or an explanation that feels like an accusation.
  - Framing: "you can interact with the running UI. Drive it, click, navigate, submit, and
    judge the experience of using it, not only how it looks."
  - It updates `$R/UX_FEEDBACK.md` in the same convention.
  - Verify: a `webapp-testing` Playwright driver script exists and exits 0, AND
    `test -s $R/UX_FEEDBACK.md`.
- [ ] **6.3 J — Judge worthwhile feedback (fresh context).** Tags each item `{worthwhile}`
  or `{skip}` against this spec.
  - Verify: `grep -qE '^- \[ \].*\{worthwhile\}' $R/UX_FEEDBACK.md && echo "FAIL: rework D" || echo PASS`
- [ ] **6.4 Ping-pong until convergence.** Identical mechanic to 2B.4: U unticks D on
  worthwhile feedback; D addresses and unticks U; repeat until J finds nothing worthwhile
  open.
  - Verify: 6.3 prints PASS on a U pass that ran after the most recent D change, provable
    by file mtimes.

---

## Phase 7 — Recurring goals audit (selected folders, then selected rules)

`Recurring_goals` holds **643 atomic rules across 19 folders**. Count them with a CSV
reader, never with `wc -l`: the `agent_prompt` column carries embedded newlines, so line
counting overstates the corpus roughly ninefold.

### Step 1 — folder selection (this is where most of the saving is)

Four of the nineteen folders cannot apply to a dependency-free Node ESM tool with one HTML
panel, and are dropped whole:

| Folder dropped | Rules | Why |
|---|---:|---|
| `Code/Swift_Development` | 133 | no Swift source anywhere in the repo |
| `Code/React_NextJS_Development` | 70 | its `applies_to` glob matches this repo's `.js` files, but every rule on the folder presumes a React component tree, which this repo does not have |
| `Code/Python_Development` | 61 | no Python source in `lib/ bin/ test/ web/ hooks/ launchd/` |
| `Assignments` | 12 | Interstice is a personal tool, not a Gauntlet assignment submission |

**276 of 643 rules removed at the folder level.** The remaining fifteen folders are in
scope.

### Step 2 — row refinement inside the folders that were kept

A kept folder still contains rules that cannot be evaluated here: `Process/Communication`
governs how replies are written and has nothing in a codebase to inspect,
`Design/Design_Fidelity` mostly presumes a Claude Design handoff bundle, and several
`Design/Visual_Design` rules are scoped to a `website/index.html` that does not exist. That
is a further **48 rules**, taking the run from 367 to 319.

This second step is machine-made and auditable rather than asserted:

| Artifact | Path | Role |
|---|---|---|
| Selector | `$R/docs/recurring_goals_selection.py` | Decision table keyed by `(folder, applies_to)`; target facts probed from the filesystem, not assumed |
| Manifest | `$R/docs/RECURRING_GOALS_SELECTION.md` | Generated: every selected row id, every exclusion with its reason, every conditional with its precondition |

**The guard that makes it trustworthy:** any `(folder, applies_to)` pair absent from the
decision table is a hard error naming the folder, the exact string, the row count and the
row ids. The script refuses to emit a manifest until every pair is classified, because a
silently dropped rule is indistinguishable from a rule that was never considered. The
language probes scan only `lib/ bin/ test/ web/ hooks/ launchd/`, never the repo root, so
tooling under `docs/` cannot answer a question about the product.

**Net selection: 303 included, 16 conditional, 324 excluded, of 643.**

| Sheet | Rules | Selected | Conditional | Excluded | Why the exclusions |
|---|---:|---:|---:|---:|---|
| Code/JavaScript_TypeScript_Development | 116 | 116 | 0 | 0 | — |
| UX | 95 | 95 | 0 | 0 | — |
| Code/Universal | 18 | 18 | 0 | 0 | — |
| Process/Agent_Behavior | 26 | 17 | 0 | 9 | conversational-only rows |
| User_Facing_Copy | 12 | 12 | 0 | 0 | — |
| Process/Data_Integrity | 10 | 10 | 0 | 0 | — |
| Machine_Safety | 10 | 7 | 0 | 3 | iCloud paths, graphify, new-project rows |
| Project_Structure | 7 | 6 | 0 | 1 | new-project row |
| Design/Data_Visualization | 6 | 6 | 0 | 0 | — |
| Code/Testing_and_Coverage | 10 | 5 | 0 | 5 | assignment and XCUITest rows |
| Design/Visual_Design | 10 | 4 | 1 | 5 | no `website/index.html`, no Mermaid diagrams |
| Security_and_Secrets | 5 | 4 | 0 | 1 | no `server/` or `app/` tree |
| Deployment | 19 | 1 | 13 | 5 | no server tree, no migrations; "the deployed system" is conditional |
| Design/Design_Fidelity | 8 | 1 | 0 | 7 | no Claude Design handoff bundle |
| Assignments | 12 | 1 | 0 | 11 | not a Gauntlet assignment |
| Process/Communication | 15 | 0 | 2 | 13 | governs reply style, not the codebase |
| Code/Swift_Development | 133 | 0 | 0 | 133 | no Swift source |
| Code/React_NextJS_Development | 70 | 0 | 0 | 70 | glob matches `.js`, but every rule presumes a React tree |
| Code/Python_Development | 61 | 0 | 0 | 61 | no Python source |
| **TOTAL** | **643** | **303** | **16** | **324** | |

Run the selected rules with the `routed-audit-team` pattern — router, workers batched by
locality and executor type, reducer — rather than one agent per row. 303 rules against one
small repo is a routing problem, not a fan-out-to-303-models problem. Suggested batching
axis: by target file cluster (`lib/focus/*`, `lib/video/*`, `lib/reader.js`,
`web/panel.html`, `test/*`), since a worker that has already read a file can evaluate many
rules against it in one pass.

- [ ] **7.1 Regenerate the manifest and prove it is current.** The selection must reflect
  the repo as it is now, not as it was when this loop was written.
  - Verify: `cd $R && python3 docs/recurring_goals_selection.py > docs/RECURRING_GOALS_SELECTION.md`
    exits 0 (a non-zero exit means an unclassified pair, which must be classified before
    proceeding), AND `git diff --exit-code docs/RECURRING_GOALS_SELECTION.md` shows either
    no change or a change that is committed with a reason.
- [ ] **7.2 Route and run the audit over the 303 selected rules.**
  - Verify: a findings file carries one verdict per selected `row_id`, and the set of
    `row_id`s in the findings file is exactly the selected set from the manifest — no
    extras, no omissions, checked by a script rather than by eye.
- [ ] **7.3 Every `severity: blocker` and `severity: high` finding is fixed or refuted.**
  - Verify: no finding at those severities is left in an open state; each is either fixed
    with a commit reference or refuted with a cited reason specific to this repo.
- [ ] **7.4 Resolve all 16 conditional rows explicitly.** The 13 `the deployed system`
  rows, the 1 `design tokens` row, and the 2 `every guide` rows each need a recorded
  resolution: does the precondition hold here, and therefore does the rule apply?
  - Verify: a table with one row per conditional `row_id`, each naming its precondition and
    whether it held. No conditional may be left unresolved.
- [ ] **7.5 Adversarially spot-check the exclusions.** Selection is only trustworthy if
  someone tries to break it. Spin up a fresh-context agent given the manifest's exclusion
  table and the repo, told to find any excluded rule that in fact applies.
  - Verify: the agent's written finding is either "no wrongly excluded rule found", with
    the specific exclusions it probed named, or a list of rules to reclassify — in which
    case the decision table is corrected and 7.1 through 7.4 re-run.
- [ ] **7.6 Re-run the selector after the code lands.** Phases 3 through 5 add files; new
  files can flip a probed fact and change which rules apply.
  - Verify: 7.1 re-run after Phase 5 exits 0 and produces a manifest whose selected set is
    either unchanged or changed with the delta explained.

## Phase 8 — Integration, coverage, documentation

- [ ] **8.1 Full suite green.** `cd $R && npm test` — zero failures, zero skipped tests that
  were passing at the 0.4 baseline.
  - Verify: exit code 0 and a pass count at or above the baseline.
- [ ] **8.2 Per-file coverage checklist for every new or modified file.** Rather than one
  monolithic coverage goal, iterate the changed file list and record an attempt plus the
  coverage actually achieved for each.
  - Suggested route: `git diff --name-only origin/main...HEAD -- '*.js'` to produce the
    list, then one entry per file in the parallel notes.
  - Verify: every file in that diff list has an entry naming its measured coverage
    percentage, and no entry is blank or estimated.
- [ ] **8.3 Every failure path throws a specific error.** Sweep the new modules for generic
  errors, silent catches, and swallowed rejections.
  - Verify: `grep -rnE "catch\s*\(\s*\w*\s*\)\s*\{\s*\}" $R/lib` returns no matches, and
    `grep -rnE "throw new Error\('[a-z ]{0,25}'\)" $R/lib/focus $R/lib/video $R/lib/latency`
    returns no matches.
- [ ] **8.4 `doctor` proves every new dependency.** The frontmost-app signal, the
  display/lock subscription, the browser video probe, and the reading rung all appear as
  doctor checks that fail loudly and specifically.
  - Verify: `node $R/bin/interstice.js doctor` lists all four, and each has a test proving
    it fails with a remedy-bearing message when its dependency is induced to fail.
- [ ] **8.5 README and config documentation match the shipped behaviour.** New config keys
  (`focus.blockMinutes`, `focus.blacklistApps`, `focus.videoWhitelist`,
  `focus.videoBreakAfterMs`) are documented, and the "browsers only" scope limit from S3 is
  stated plainly rather than left to be discovered.
  - Verify: every key present in `$R/config/interstice.config.default.json` under `focus`
    appears in `$R/README.md`, checked by a script rather than by eye.
- [ ] **8.6 Internal consistency sweep.** No document in the repo contradicts another or
  contradicts the code — the operator's standing expectation that a project is consistent
  within itself.
  - Verify: an agent with fresh context reads `$R/README.md`, `$R/docs/GOAL_LOOP.md`, this
    file, and `$R/config/interstice.config.default.json`, and reports a written finding of
    zero contradictions, citing each claim it checked.
- [ ] **8.7 Bug/issue prevention checklist updated for every fix in this loop.** Each fix
  gets a brief-enough-to-work entry: what went wrong and how to prevent it.
  - Verify: `$R/docs/BUG_ISSUE_PREVENTION.md` has one entry per fix made in Phases 1
    through 5, and a new-feature pass has been run against the whole checklist.

---

## Phase 9 — Proof and delivery

- [ ] **9.1 Record a video of the working demonstration.** The recording must contain a
  thorough, valid demonstration of the work actually happening. A video of a static UI with
  no activity does not satisfy this item. It must show, in sequence and visibly:
  1. A cold start opening a real book at the synced page.
  2. The reading view measured or visibly filling the panel, with the menu opened and
     closed.
  3. A focus block running and completing, awarding a star — time-compressed is acceptable
     only if the compression is visible on screen and the block's real start and end times
     are shown.
  4. The star calendar in day view and month view, and a star activated to reveal its
     times.
  5. Video from Udemy playing without forfeiting a block, then video from a non-whitelisted
     source forfeiting one, with the forfeit reason visible.
  6. A prompt submitted, the elapsed indicator ticking up, the response arriving, the
     indicator clearing, and the arrival notification appearing.
  - Verify: the video file exists with non-zero size, and a fresh-context agent watches it
    and confirms in writing that all six behaviours are visibly demonstrated, naming the
    timestamp in the recording where each occurs.
- [ ] **9.2 Professionalism scan.** Spin up an agent with a new context to scan the whole
  submission for professionality. For example, in another project the README bragged that
  the project was completed in two days; if work then continued, the README would be out of
  sync. Stupid on multiple levels. Look for exactly this class of defect: stale boasts,
  dated claims, contradicted timelines, leftover scaffolding, placeholder copy, and any
  statement that will be false next week.
  - Verify: the agent produces a written finding list; every item is fixed and re-scanned to
    zero findings by a second fresh-context pass.
- [ ] **9.3 No demo URLs or credentials anywhere in public-facing text.**
  - Verify: `grep -rniE "localhost:74[0-9]{2}|password|api[_-]?key|secret" $R/README.md $R/docs/*.md`
    returns only intentional, safe references, each individually justified in writing.

---

## Closing block

- [ ] After you've finished everything
    - [ ] If you did any searches, you may have incidentally downloaded more resources than
      are needed from icloud. Please go through the unused ones and evict them off this
      machine back onto icloud.
    - [ ] Close the tabs you've 1. opened yourself, and 2. are currently done using.
    - [ ] Demo: open up the windows to the work you've completed. Show me your work.
    - [ ] Create a manual verification checklist for the user to go to in order to verify
      and check your work, if not already explicitly requested.
- [ ] If you wrote or modified code, then commit all your changes, either one per checkmark
  item or one big commit per this goal loop whichever is logical. Push them, raise a PR.
  Share a link to the PR with the user.

- [ ] **Z8. Delete the Blocker Resolver Monitor** created in 0.7, by the trigger id recorded
  in 0.8, so it does not outlive this loop.
  - Verify: `list_triggers` no longer shows the trigger.

---

## Parallel notes

Working notes for this loop live at: _(link to be added by the agent working this loop;
this is the one addition permitted to this file besides checking boxes)_

---

**Parallel notes:** [`docs/STARS_NOTES_2026-08-19.md`](STARS_NOTES_2026-08-19.md)
