# Post loop 8 retest of the three reader failure modes

Item 1.0 of `GOAL_LOOP_INTERSTICE_HANGS_AND_AKIN_SOCIAL_2026-08-19.md`. Loop 8 ran first and
repaired one classified cause, so each mode is re-tested against the code loop 8 left behind before
anything is repaired a second time.

Run on 2026-08-21 against a live Amazon session on the operator's own reader profile, book
`B0046LU7H0`. Every probe below is a real capture from `POST /api/reading/view`, not a
reconstruction.

| Mode | Verdict | Probe that proves it | Loop 8 commit |
|---|---|---|---|
| E1, the sync prompt | **no verdict yet, not induced** | see below | matcher and dismissal from `e7f55a7` |
| E2, the white page and the spinner | **still failing** | `E2-probe-2026-08-21.json` | none, loop 8 did not classify this cause |
| E3, Amazon's failure page rendered as the book | **closed by loop 8** | see below | `1157a38` |

## E2, still failing, reproduced today

A cold start wedges the reader. After `POST /api/reading/close` and a reopen, the probe reported
`ready: false, painted: false` for 26 consecutive samples over roughly 30 seconds, then continued
failing for a further 60 seconds of five-second samples. The captured probe is
`E2-probe-2026-08-21.json`:

```json
{ "ok": true, "ready": false, "running": true,
  "error": "Runtime.evaluate did not answer in 8000ms",
  "seq": 2, "asin": "B0046LU7H0", "percent": 39 }
```

**The cause is visible and it is not a slow load.** The page IS there: DevTools lists
`https://read.amazon.com/?asin=B0046LU7H0` with title `Kindle`, and the browser has nine live
processes. What is not there is an answer. `Runtime.evaluate` times out at 8000ms, so the PROBE
cannot run, so nothing downstream of it can know anything. A direct CDP connection from outside the
daemon timed out on `Runtime.enable` in the same way, which rules out the daemon's own connection
handling as the cause.

**Two distinct defects, and the second is the one that reaches the operator.**

1. The reader page's main thread stops answering after a cold start.
2. When the probe cannot run, the view route still answers `ok: true`, and across the samples it
   reported the label, href and `bookError` from BEFORE the close as though they were current: a
   spinner on screen while the state surface said `Page 217 of 220 ● 94%`. `painted` alternated
   between `false` and `null` depending on whether that particular evaluate timed out, so a consumer
   cannot distinguish "not painted yet" from "we could not ask". Items 1.4 and 1.5 own this.

**The product's own retry recovers it**, which is item 1.8's question answered early:
`POST /api/reading/retry` returned `{ok: true, cleared: true, reopened: true}` and the next four
samples were `ready: true, painted: true`, sequence advanced from 2 to 3. So the recovery path works;
what is missing is anything that notices the wedge and offers it.

## E3, closed by loop 8

Loop 8's `1157a38` added the `bookError` field to the PROBE, plus `clearSiteData` and `retryBook`,
after diagnosing the cause as a stale device registration rather than a bad session. Across every
sample taken today, including the wedged cold start and the recovery, `bookError` was never true and
no Oops page was ever rendered as a page of the book.

The regression test is `test/reader.test.js:59-70`. It asserts the detector fires on the real failure
text, does not fire on a page of the book, does not fire on prose that merely contains the word, and
that the PROBE actually reports the field. Suite run today for the two reader files: 48 tests, 48
pass, 0 fail.

## E1, no verdict, and why it is not being guessed

The mode did not occur today, so there is nothing to call closed and nothing to call still failing.
Recorded rather than resolved, because item 1.0 says a mode already closed is *proven* closed here.

What was tried: the reader was closed and reopened, and the page text was read back through
`GET /api/reading/text`. The reader came up on the References page near the end of the book, matching
`Page 217 of 220`, and the text carried no sync prompt. The reason is the interesting part. The
prompt only appears when two positions disagree, and the reopen landed on the reader's OWN last
position, so there was nothing to reconcile. Note the standing divergence that did not produce one:
the Kindle app reports `percent: 39` while the reader sits at 94%.

Inducing it needs the server-side position moved by a different device, that is, reading in the
Kindle app and then opening the web reader. That is the next step for this row and it is not done.

**The latent defect item 1.1 names is still there and is worth stating separately from the verdict.**
`dismissScript` at `lib/reader.js` searches only `ion-alert`, `ion-modal` and `ion-popover`. If
Amazon moves the prompt out of those three custom elements, the matcher never gets to run. The
`SYNC_PROMPT` regex itself is tested at `test/reader-shelf.test.js:114-117` against the real dialog
text and against three things that must not match, and it passes. So the regex is proven and the
container search is not.
