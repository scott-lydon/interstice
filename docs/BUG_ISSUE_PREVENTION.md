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

Four exported symbols have no reference anywhere in `lib`, `bin`, `web`, `test`, `scripts`,
`.githooks`, or `docs`. They predate the audits that found them, no change here orphaned them, and
deleting code nobody asked to have deleted is its own risk, so they are recorded here instead. Check
the list with `grep -rnw '<name>' lib bin web test scripts .githooks docs`, which should return only the
definition line.

| Symbol | Where |
|---|---|
| `OFFSETS_FILE` | `lib/paths.js` |
| `panelCookies` | `lib/amazon-session.js` |
| `toParagraphs` | `lib/ocr.js` |
| `RUNGS` | `lib/router.js` | the shipped default ladder order; `validate` checks against `KNOWN_RUNGS` in lib/config.js instead |

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
