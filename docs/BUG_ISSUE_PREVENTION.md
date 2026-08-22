# Bug and issue prevention checklist

## Reader: a book that will not open is often a stale device registration, not a bad session (2026-08-19)

**Cause.** Amazon's web reader drew "Oops... Something Went Wrong. Please try to open this book from
the library again" where the book should be, driven by four 403s from
`service/mobile/register/getDeviceToken`. The account and the carried session were both fine (the
library listed the book); what was stale was this profile's *device registration* in local storage.
Reopening the book, by address or by clicking it in the library, never touches that, which is why
Amazon's own advice cannot work. The failure was also invisible: the Oops page was photographed and
set in the reading type as though it were page 79, under a progress bar still reading 39%.

**Prevention.**
1. Detect Amazon's failure page explicitly (the `bookError` probe field) so the panel reports a
   failure instead of rendering it as the book.
2. Recover by clearing local storage, indexeddb, cache, and service workers for the reader origin
   while keeping cookies (the session), then reopening in a fresh tab: `Reader.clearSiteData()` +
   `Reader.retryBook()`. Never clear cookies, which would turn a stuck book into a sign-in page.
3. When a book will not open, check the network for `getDeviceToken` 403s before assuming the
   session expired; a session probe alone will say the session is fine and send you the wrong way.

## A debounce that returns on first sighting never fires at threshold zero (2026-08-19)
**Cause.** The video breaker returned null on the first sighting of offending playback to start its
debounce clock, so with `videoBreakAfterMs: 0` it never broke on that same call. **Prevention.** A
debounce must set its start time and THEN check `now - start >= threshold` in the same pass, so a
zero threshold fires immediately and a positive one still waits.

## A comment word can fail a source-scan verify (2026-08-19)
**Cause.** The latency module's own comment said it does not "re-parse transcripts", which tripped a
verify that greps the module for the word "transcript" to prove it does not read session logs.
**Prevention.** When a check greps a file for a forbidden token, keep that token out of the file
entirely, comments included; describe the avoided thing without naming it.

## Config edits in tests must preserve the user's file (2026-08-19)
**Cause.** The whitelist-reload test writes `config/interstice.config.json` to prove a live reload.
The repo already had a real user config there. **Prevention.** A test that writes a real config file
must back up its prior contents and restore them in a `finally`, so the test leaves the repo exactly
as it found it, and reload the config back to the original state afterward.

## A feature can be fully built, fully unit tested, and never wired in (2026-08-20)
**Cause.** The whole focus, star and latency feature passed its unit tests while `createMachine`,
the three breakers and `createLatency` had no caller anywhere outside `test/`, and `lib/daemon.js`
opened the star store but never called `award`. No star could ever be earned in production while
the README documented earning them. **Prevention.** A unit test constructs the module itself, so a
green suite proves the module works and says nothing about whether the product reaches it. For
every new module, grep the non-test tree for its exported names and require at least one caller
outside `test/`, or treat the feature as unshipped no matter how green the suite is.

## A UTC timestamp read by a local-offset reader files the record on the wrong day (2026-08-20)
**Cause.** The focus tracker minted `new Date().toISOString()`, which is always UTC, while
`localDay` in `lib/focus/blocks.js` takes the calendar day by slicing the first ten characters
of the timestamp. That slice is only correct when the timestamp carries the offset it is meant to
be read in. The first star the live tracker awarded, at 23:33 local, was filed on the following
day. **Prevention.** When a timestamp is written by one module and its date part is read by
another, the offset is part of the contract, not a formatting detail. Stamp the local offset at the
mint site, and state in the reader's comment which offset it assumes.

## A missing Playwright browser channel hangs rather than errors (2026-08-20)
**Cause.** All five browser specs called `chromium.launch({ channel: 'chrome' })`, which needs a
separately installed Chrome. Where that is missing the launch does not fail fast: it blocks until
the runner's 180 second timeout, and the runner then reports five product failures. `npm test` hung
for fifteen minutes and returned red for an environment reason. **Prevention.** Default to the
browser the test dependency itself ships, which is always present, and keep the externally
installed channel behind an opt-in env var (`INTERSTICE_PW_CHANNEL`). More generally, a dependency
whose absence produces a timeout instead of an error will be misread as a product failure, so it
must not be the default.

## Loopback binding is not access control (2026-08-20)
**Cause.** Roughly 35 control-surface handlers had no authentication of any kind, verified live: a
cross-origin POST carrying `Content-Type: text/plain` was accepted and routed, and a request naming
another Host returned 200. Any page the user visits can reach 127.0.0.1, `readBody` parses JSON
regardless of content-type so the request is never preflighted, and the surface it lands on
reschedules cards, writes to-do state, drives the daemon, and types keystrokes into a signed-in
browser session. **Prevention.** Authenticate a local control surface the same as a remote one:
check Host is loopback on this port, check Origin when present is this daemon's own, and require a
token generated on first run rather than configured, compared in constant time. Run all three once
at the dispatcher so a handler added later cannot forget them.

## A shell script that calls `claude -p` must redirect stdin (2026-08-20)
**Cause.** The blocker resolver ran `claude -p` with stdin inherited from the supervisor. The CLI
waits on stdin, gives up after three seconds, and returns "Warning: no stdin data received in 3s"
on stdout, which the script then parsed as the model's answer and stored as the verdict. The first
two ledger entries in `logs/blocker-ledger.md` are that warning where a VERDICT line belongs.
**Prevention.** Every non-interactive `claude -p` call site gets `< /dev/null`. And when a script
parses a command's stdout for a specific shape, it must record what it could not parse rather than
storing the unparsed text as though it were the answer.

## An exclusion reason must be a falsifiable claim, checked against the repo (2026-08-20)
**Cause.** The rules manifest excluded the Python sheet with the reason "no Python source in this
repo", written while `docs/recurring_goals_selection.py`, the manifest generator that emitted that
very sentence, was itself 375 lines of Python. The claim was false on its face and nothing re-checked it.
**Prevention.** State every exclusion as a claim about the target that a reader can test in one
command, then run that command. Where the honest reason is a scope decision rather than an absence,
say so, because "X does not exist" and "X exists and is out of scope" fail in different ways.
**Recurrence, 2026-08-20.** The rewritten reason was false too: it read "the only Python in the repo
is docs/recurring_goals_selection.py", while `git ls-files '*.py'` returned five tracked files. A
prevention rule that names the command and is then not run is the same defect wearing the fix's
clothes. The reason now quotes both commands it rests on, `git ls-files '*.py'` and
`find lib bin web test scripts .githooks -name '*.py'`, so re-checking it is reading it.

## Pre-existing dead code, reported rather than deleted (2026-08-20)

Five exported symbols have no reference anywhere in `lib`, `bin`, `web`, `test`, `scripts` or
`.githooks`. They predate the audits that found them, no change here orphaned them, and
deleting code nobody asked to have deleted is its own risk, so they are recorded here instead. Check
the list with `grep -rnw '<name>' lib bin web test scripts .githooks`, which should return only
the definition line. Adding `docs` also matches this table and the audit records, so it is not the
command to run for this.

| Symbol | Where | Note |
|---|---|---|
| `OFFSETS_FILE` | `lib/paths.js` | |
| `panelCookies` | `lib/amazon-session.js` | a fossil of the design that carried cookies into the panel profile; the reader profile is what the carry targets now |
| `toParagraphs` | `lib/ocr.js` | |
| `RUNGS` | `lib/router.js` | the shipped default ladder order; `validate` checks against `KNOWN_RUNGS` in lib/config.js instead |
| `readingState` | `lib/state/reading.js` | the sole export of the module, which nothing imports. The question it answers, whether there is a book to go back to, is `bookInProgress` in lib/state/index.js now |

If one of them is deliberately kept for a caller that does not exist yet, say so beside it here. An
export with no reference and no note is indistinguishable from one that was forgotten.

## The video breaker could not see any video (2026-08-20)

**Cause.** `probeVideo` evaluated its play-state expression with `t.sessionId`, taken from
`Target.getTargets`. That call returns target infos and no sessionId at all, so the value was
always `undefined` and the evaluate went to the browser-level session, where there is no page and
no `Runtime` domain. Chrome answers `'Runtime.evaluate' wasn't found`, the surrounding catch turned
that into `playing = false`, and every tab in every browser was reported as not playing, forever.
Success condition 5 was unreachable.

Its unit tests all passed throughout, because the fake session handed back a sessionId from
`getTargets` and matched on it. The stub had invented a protocol, and the probe agreed with the
stub rather than with a browser.

**Prevention.** When a module speaks a wire protocol, at least one test has to speak it to a real
implementation. A stub is free to be wrong in exactly the way the code is wrong, and then the
green suite is evidence of nothing. `test/video-breaker.pw.mjs` now drives a real Chromium with a
real debugging port and a real decoded video file, and the stub in `test/video-probe.test.js`
models the real handshake (attach, evaluate, detach) including throwing the way a real browser
throws when you skip the attach.

## The reading rung was dead because "installed" is not "works" (2026-08-20)

**Cause.** `findBrowser` returned the first Chromium-family browser that EXISTED, and the reader
gave up when it did not answer. On this machine Google Chrome 151 starts, stays alive, and never
opens a DevTools port: no `DevToolsActivePort` file written into the profile, no listening socket
bound, nothing in its own `--enable-logging=stderr --v=1` output, no managed policy present, and
the same result with a clean profile and `--remote-debugging-port=0`. Brave, installed beside it,
opens the port immediately. So the rung was dead on a machine that had a working browser the whole
time, and the error it raised, "the reader browser never opened its debugging port: fetch failed",
named neither the browser it tried nor anything to do about it.

**Prevention.** A dependency probe answers "does it work", not "is it there". Where several
implementations can satisfy a dependency, try them in order and report every one that was tried
with what each did. `launchFirstWorkingBrowser` does that, and both reader launch sites use it.
The same lesson applies to `doctor`: its reading-rung check reported "browser present, port free,
session carried" for a rung that could not open a browser at all.

## A recovery that finds nothing to carry must not leave the reader closed (2026-08-20)
**Cause.** `reauthenticate` closes the browser before a forced carry, because the forced path
deletes the cookie store before it writes and must not run against a live session. When the carry
then found nothing to carry it returned from there, leaving the reader down, while `ensure` still
answered `ok: true` over a browser that was no longer running. The caller read success and the panel
showed a blank page with no error to explain it. A warm poll loop hid it by opening again a second
later; one cold call did not. **Prevention.** Any path that closes a resource as a precondition owns
reopening it on every exit, the failing ones included. And test the cold call: a poll loop is a
second caller that repairs the state under you, so a test that polls proves the loop works and says
nothing about the operation.

## A liveness probe that answers ok over a dead process is worse than an error (2026-08-20)
**Cause.** The same failure above was invisible because `ensure` reported success without
establishing that the browser it was reporting on was alive. **Prevention.** A health answer must be
derived from the thing itself in the same call, never from a field set when it was last known good.
The cheap check: kill the subject out from under the probe and require the probe to change its
answer.

## A preflight that reports a gap and still exits 0 is one nobody has to read (2026-08-20)
**Cause.** Tool preflights printed a missing row and exited successfully, so a caller that gated on
the exit status was gated on nothing. **Prevention.** Every gate exits non-zero on the condition it
exists to catch, and the proof is running it against a deliberately broken input and seeing the
non-zero. A gate never demonstrated to refuse is a check that cannot fail. Related: a preflight must
export the environment the tools need (`JAVA_HOME`, `ANDROID_HOME`) before deciding a tool is
absent, or it reports as missing something that is sitting on disk unexported.

## Match a load gate on the real binary, not the wrapper that exits (2026-08-20)
**Cause.** The build-load gate matched process names like `gradlew`, which exits immediately and
leaves a JVM behind, so the gate reported all clear while a build was running. **Prevention.** Match
what actually holds the CPU (`swift-frontend`, `swift-build`, `GradleDaemon`), and prefer exiting
non-zero over queueing, because a gate that blocks forever is one people work around.

## A README that omits a repair still describes the old behavior (2026-08-21)
**Cause.** Three reader repairs landed with tests and no document change, so the README's account of
the carry path ended with the browser closed, said nothing about what the panel shows when a page
fails to arrive, and named Node 22 as the reader's only extra dependency when the rung also needs a
Chromium-family browser that opens a debugging port. Nothing in it was contradicted by a test; it
was simply behind. **Prevention.** Treat a behavior change as unshipped until the sentence a reader
would trust has been re-read against it. The cheap check is per-repair rather than per-release: for
each new or changed test name, grep the README for the noun it is about and confirm the paragraph
that turns up still describes what the test asserts.

## A vendor sync prompt nobody answered, photographed as the book (2026-08-19, E1)
**Cause.** Amazon's reader asks "Most Recent Page Read. You're on location 4244. The most recent
location is 4242. Go to location 4242?" when two devices disagree. Interstice has `SYNC_PROMPT` to
match that text and `dismissScript` to answer it, and the screenshot proves the dismissal did not
fire: the prompt was photographed, transcribed, and set in the panel's reading type as though it
were a page of the book. `dismissScript` searches only `ion-alert`, `ion-modal` and `ion-popover`,
so a prompt Amazon moves out of those three custom elements is never reached by the regex.
**Prevention.** Do not key a dismissal on the container. Measured on a healthy reader with no prompt
on screen, the page already holds four `ion-modal` elements and one `ion-popover`, so their presence
proves nothing and the text match is carrying the whole decision. Search any element whose own text
matches and which owns a button with the wanted label, then **assert afterwards that the prompt is
gone** rather than assuming the click landed. The cheap check that would have caught it: after a
dismissal, probe again and fail if the pattern is still on screen. Note the instrument, too: looking
for a dialog with `GET /api/reading/text` cannot work, because that reads text off the captured page
IMAGE and a dialog can sit outside the capture clip. Query the DOM.

## A spinner is not a painted page (2026-08-21, E2)
**Cause.** `painted` was `Boolean(label || loc) || media > 2`, and `capture` looked at none of it: it
photographed whatever was on screen and held it as the current frame. Over a real cold start the
reader's page sits at `read.amazon.com` with no position label for tens of seconds, and once
Amazon's shell renders it holds `div.kg-spinner`, one svg, and a body fourteen characters long. The
panel set that in the reading type as the book, under a progress bar reporting the page you were on
before the reader went blank, because `state` fell back to the shelf's remembered label whenever the
browser's own was empty.
**Prevention.** Three separate rules, because this was three bugs wearing one symptom. The probe
reports the vendor's loading element by name, asked as "is it showing" rather than "is it in the
document", and `painted` requires its absence. `capture` refuses a probe that is not `painted`,
letting `bookError` through by name so the failure surface still works. And a fallback to a
remembered value is gated on the page having ARRIVED, not on the live source having produced a
string: the measured wedge is a spinner under a truthful page number, so a gate on the string
passing leaves the remembered page printed over a spinner. The
cheap check: sample the DOM once a second through a cold start and write the node counts down. The
measurement is what showed `painted` was already right and the other two were not.

## A vendor error page mistaken for content (2026-08-19, E3 and E4)
**Cause.** Amazon's "Oops... Something Went Wrong. Please try to open this book from the library
again" is a page like any other, so it was photographed, transcribed and rendered as page 79 under a
progress bar still reading 39%. Nothing anywhere said the reader had failed. The underlying cause
was a stale device registration in the profile, not a bad session, which is why reopening the book
never helped and Amazon's own advice cannot work.
**Prevention.** Detect the vendor error page explicitly, as its own probe field, so the panel can
report a failure instead of rendering one. Recover by clearing local storage, indexeddb, cache and
service workers for the reader origin while KEEPING cookies, then reopening in a fresh tab; clearing
cookies turns a stuck book into a sign-in page. The cheap check is a test that the detector fires on
the real failure text, does not fire on a page of the book, and does not fire on prose that merely
contains the word, plus an assertion that the probe actually reports the field. General rule behind
all three: a page that loaded is not a page that is what you asked for.

## A prevention entry can describe the rule that was replaced (2026-08-21)
**Cause.** The entry above was written from the first draft of the fix and not revisited when the
rule changed. It described `capture` as refusing a probe with no position label, which is precisely
the rule that draft was found insufficient for and replaced: the wedge that motivated it carries a
truthful label. A prevention document that states a superseded rule teaches the next reader to
reintroduce the bug, which is worse than not writing one.
**Prevention.** This file is source about source, so it goes stale the same way a README does, and
it gets the same check: when a named function changes behaviour, grep this file for that name and
reconcile every hit before the change is committed. The entry that prescribed that check for
`README.md` was added in the same diff that let this one rot, so applying it to only one file is
the specific mistake. The cheap check: `grep -n '`capture`' docs/BUG_ISSUE_PREVENTION.md` when
`capture` changes, and read every hit.
