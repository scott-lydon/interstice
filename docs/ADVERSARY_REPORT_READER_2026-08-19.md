# Adversarial review: the reader repairs of PHASE 1

Reviewer: an agent that wrote none of this code. Everything below is from reading the
working tree at `HEAD` and the diff named in PROVENANCE. Nothing was built, started, or
executed; no test was run.

## PROVENANCE

**Repository.** `/Users/scottlydon/Developer/interstice`

**Diff range.** `1e4f99e..HEAD` — 37 commits, 54 files, 7450 insertions / 140 deletions,
per `git diff --stat`.

**Files read in full or in the cited regions.**

- `/Users/scottlydon/Developer/interstice/lib/reader.js` (lines 55–140, 240–290, 580–640,
  750–800, 860–915, 946–1002, 1080–1120, 1140–1270, 1325–1520, 1505–1620, 1780–1815)
- `/Users/scottlydon/Developer/interstice/lib/reading.js` (whole file, 191 lines)
- `/Users/scottlydon/Developer/interstice/web/panel.html` (lines 455–470, 655–690, 790–830,
  960–1000, 1170–1200, 1220–1260, 1330–1440, 1420–1600, 1680–1710, 2210–2270, 2320–2380)
- `/Users/scottlydon/Developer/interstice/lib/server.js` (lines 270–360)
- `/Users/scottlydon/Developer/interstice/test/reader.test.js` (whole diff, plus lines
  460–762 as they stand)
- `/Users/scottlydon/Developer/interstice/test/panel.test.js` (whole file, 385 lines)
- `/Users/scottlydon/Developer/interstice/docs/evidence/2026-08-19/POST_LOOP8_RETEST.md`
- `/Users/scottlydon/Developer/interstice/docs/evidence/2026-08-19/E2-spinner-with-label.md`
- `/Users/scottlydon/Developer/interstice/docs/BUG_ISSUE_PREVENTION.md` (the diff hunk)
- `/Users/scottlydon/Developer/interstice/README.md` (the diff hunk)

**Commands run.** All rooted inside the repository; no `find ~`, no `mdfind`, no build, no
test run, no state-changing git command.

```
git log --oneline 1e4f99e..HEAD
git diff --stat 1e4f99e..HEAD
git diff 1e4f99e..HEAD -- lib/reader.js
git diff 1e4f99e..HEAD -- test/reader.test.js
git diff 1e4f99e..HEAD -- lib/reading.js README.md docs/BUG_ISSUE_PREVENTION.md
ls -la ; ls lib test web
wc -l lib/reader.js lib/reading.js web/panel.html test/reader.test.js test/panel.test.js
grep -rn "capture(" lib web bin test
grep -rn "painted|bookError|spinner|signedOut" lib web bin
grep -n "api/reading" web/panel.html
grep -n "setPagerDisabled|setFrameHidden|reader-failed|reader-retry" web/panel.html
grep -n "#hold|#shoot|#watch" lib/reader.js
grep -n "this.settle(" lib/reader.js
grep -n "loadTimeoutMs|readAhead:|quality" lib/reader.js lib/config.js
grep -n "SYNC_PROMPT|dismissScript|ion-alert" lib/reader.js
grep -n "async retryBook|async #applyViewport|async revive(|async clearSiteData" lib/reader.js
sed -n <ranges> on the files listed above
cat -n lib/reading.js ; cat -n test/panel.test.js
cat docs/evidence/2026-08-19/E2-spinner-with-label.md
sed -n '1,102p' docs/evidence/2026-08-19/POST_LOOP8_RETEST.md
```

---

## VERDICT

| # | Severity | Defect |
|---|---|---|
| 1 | BLOCKING | `capture`'s refusal is opt-in: five of its six callers pass no probe, including `/api/reading/frame`, which is the call that produces the bytes the panel actually renders. |
| 2 | BLOCKING | `#seed` and `#step` publish frames through `#shoot` + `#show`, bypassing `capture` entirely, so `revive` puts a picture of the spinner on screen as the current page on the very path where it returns `false`. |
| 3 | BLOCKING | The panel throws away `retryBook`'s answer. The stage, expected, actual and remedy are never rendered, and after a refused retry the panel returns to "opening your book" over a spinner, indefinitely. |
| 4 | MAJOR | `retryBook` reports `actual: 'the reopened tab has not painted anything'` when the probe threw, i.e. when the question was never answered. The fixed method commits the defect it was fixed for. |
| 5 | MAJOR | `ensure` still returns `{ ok: true }` after a `settle` that found nothing painted; only `signedOut` is read off the result. |
| 6 | MAJOR | `state`'s label gate repairs only the empty-label half. A spinner with a truthful label still reports a page number, plus "N pages ready to turn instantly", while nothing is on screen. |
| 7 | MAJOR | `settle` returns a stale probe as if it were current: one success followed by nothing but failures returns the old reading, and `revive` reports the book came back on it. |
| 8 | MAJOR | The five-miss log cannot fire in the recorded trace (any single success resets the counter) and is unreachable by arithmetic at two of the four `settle` call sites. |
| 9 | MAJOR | `dismissOverlays` reports the sync prompt "answered" from a `click()` it never verifies. This is E1's stated root cause, and the prevention entry written this loop prescribes the post-assert that was not implemented. |
| 10 | MAJOR | Two assertions in `test/reader.test.js` match a string literal against a regex literal. They cannot fail, and one of them is the only thing standing behind "the detector fires on the fixture". |
| 11 | MINOR | The two `capture` guard tests pass a probe with no `painted` key, so they still pass under the weaker label-only rule the change replaced. |
| 12 | MINOR | `revive` clears `this.error` before deciding it failed, so a failed revive erases the message the panel's remedy mapper needs. |
| 13 | MINOR | "Arrived" means three things in `revive` and two in `retryBook`, with nothing reconciling them. |
| 14 | MINOR | `docs/BUG_ISSUE_PREVENTION.md` states the shipped rule wrongly: it says `capture` refuses a probe with no position label, which is the rule that was found insufficient and replaced. |
| 15 | MINOR | The `retryBook` behavioural test stubs `revive` to a constant `true`, so the `stage: 'reopen'` branch is never executed by any test. |
| 16 | MINOR | An in-flight `loadReaderText` un-hides the transcript, and can call `setFrameHidden(false)`, after `readerFailed` has hidden both. |
| 17 | MINOR | `painted` now requires `.kg-spinner` to be absent, and no measurement in the repository shows that element absent on a page that has arrived. |

---

## 1. BLOCKING — `capture`'s refusal is opt-in, and the route that serves the picture opts out

**Where.** `lib/reader.js:1416` and `lib/reader.js:1436`; callers at `lib/reading.js:59`,
`lib/reading.js:126`, `lib/reading.js:153`, `lib/reader.js:614`, `lib/reader.js:766`,
`lib/reader.js:1800`; route at `lib/server.js:338-347`.

**What the code does.** The guard is

```js
async capture({ force = false, minIntervalMs = 350, probe = null } = {}) {
  this.lastUsedAt = Date.now();
  if (!this.running) return null;
  ...
  if (probe && !probe.painted && !probe.bookError) return this.frame;
```
`lib/reader.js:1416` and `lib/reader.js:1436`

`probe` defaults to `null`, so the refusal is skipped whenever the caller does not supply
one. Exactly one caller supplies one:

```js
      await reader.capture({ probe: view });
```
`lib/reading.js:115`

Every other caller does not:

```js
    await reader.capture({ force: true });      // lib/reading.js:59   (afterInput)
      return reader.capture();                  // lib/reading.js:126  (frame())
        await reader.capture({ force: true });  // lib/reading.js:153  (type)
```

`frame()` is what `GET /api/reading/frame` calls, and that route's own comment states the
consequence:

```js
    /**
     * The current picture of the page, pulled on demand rather than pushed: the reader takes a
     * new shot unless the one it holds is under 350ms old, so this is usually a fresh capture
     * and never a stream.
     */
    'GET /api/reading/frame': async (req, res) => {
      const frame = await daemon.reading.frame();
```
`lib/server.js:333-339`

The panel fetches its picture from that route, not from the poll:

```js
    const r = await fetch('/api/reading/frame?s=' + seq);
```
`web/panel.html:2350`

So the bytes the reader sees are produced by an ungated `capture()` taken at fetch time.
The guarded capture in `view()` never updates `this.frame.at`, which means the 350ms
staleness test at `lib/reader.js:1440` passes and `#shoot` runs. The seq that passed the
gate and the bytes that get displayed are not the same photograph.

`afterInput` is worse, because it is on the click and key path and it forces:

```js
async function afterInput(reader) {
  const before = reader.seq;
  ...
    await reader.capture({ force: true });
```
`lib/reading.js:55-59`

and the panel installs whatever seq comes back with no `ready` or `painted` test at all:

```js
    if (d.seq && d.seq !== readerSeq) {
      readerSeq = d.seq;
      setReaderFrame($('reader-frame'), d.seq);
    }
```
`web/panel.html:1694-1697`

A tap on a page that is repaginating therefore photographs the spinner, bumps `seq`,
hands the panel the seq, and the panel fetches and displays it. E2 is reachable through
the input path with the fix fully in place.

**What it should do.** The refusal belongs where the picture is taken, not in the argument
list. Either `capture` probes for itself when no probe is handed in (accepting the extra
round trip on the paths that are not the poll), or `#shoot`/`#hold` carry the gate so that
no caller can publish an unpainted frame. `probe = null` must not mean "no opinion, go
ahead"; it must mean "ask".

**Cheapest check that would catch it next time.** A test using the existing `wiredReader`
harness that calls `reader.capture({ force: true })` with **no** `probe` argument against a
fake whose `Runtime.evaluate` returns `{ spinner: true, painted: false }`, and asserts
`shots() === 0`. It is two lines beside the tests already at `test/reader.test.js:490-548`
and it fails today.

---

## 2. BLOCKING — `#seed` and `#step` publish frames without going through `capture` at all

**Where.** `lib/reader.js:1586-1591` (`#seed`), `lib/reader.js:1556-1562` (`#step`),
`lib/reader.js:1502-1506` (`#show`), reached from `lib/reader.js:905` (`revive`).

**What the code does.** `#seed` takes a picture, and only afterwards asks what is on the
page, and shows the picture regardless of the answer:

```js
    if ((await this.dismissOverlays('Yes')).length) await this.settle({ timeoutMs: 15000 });
    const jpeg = await this.#shoot();
    if (!jpeg) return null;
    const probe = await this.#probe().catch(() => null);
    const page = { label: probe?.label ?? null, jpeg, text: null, at: Date.now() };
    this.pages.set(0, page);
    this.#show(page);
```
`lib/reader.js:1585-1591`

`#show` calls `#hold`, which advances `seq` whenever the bytes differ
(`lib/reader.js:1393-1400`). A spinner is animated, so its bytes always differ.

`revive` calls `#seed` unconditionally, before it computes its return value:

```js
      const settled = await this.settle();
      ...
      await this.#seed();
      this.revivedAt = Date.now();
      this.error = null;
      return Boolean(settled && (settled.painted || settled.bookError || settled.signedOut));
```
`lib/reader.js:897-911`

So on the failure path — the one this loop exists to make honest — `revive` has already
photographed the spinner, stored it on the shelf at position 0 as the page you are on, made
it the current frame, and advanced `seq`. It then returns `false`. `retryBook` refuses
correctly, and the picture is on screen anyway at the next poll, because the panel repaints
on any `seq` change (`web/panel.html:1533`) and nothing there consults `d.ready`.

`#step` has the same shape: `#shoot` first, `#probeSoon` second, page shelved either way
(`lib/reader.js:1556-1562`). A turn that lands on a spinner is shelved as a page and later
served by `#show` from `turn()` at `lib/reader.js:1799`.

**What it should do.** `#seed` already calls `#probe()`; it should call it **before**
`#shoot`, and return `null` without shelving or showing when the probe is not
`painted || bookError`. `#step` should not shelve a page whose `#probeSoon` says the page
has not arrived. The rule the class documents at `lib/reader.js:343` — "It never
photographs a page that is not the book" — is currently true of `capture` alone, and
`capture` is not the only thing that photographs.

**Cheapest check that would catch it next time.** Grep for `#shoot(` and require every call
site to be preceded by a painted test; today that is five call sites and only one of them
(`capture`) has one. As a test: drive `revive` with a fake `settle` returning
`{ painted: false, spinner: true }` and assert `reader.seq` is unchanged across the call.

---

## 3. BLOCKING — the panel discards `retryBook`'s answer

**Where.** `web/panel.html:2231-2249`, specifically line 2238.

**What the code does.**

```js
  try {
    await fetch('/api/reading/retry', { method: 'POST' });
  } catch {
    /* the next tick reports whatever actually happened */
  }
  readerSeq = -1;
  readerTextSeq = -1;
  b.disabled = false;
  b.textContent = 'Discard it and reopen';
  readerRetryAsk(false);
  say('');
```
`web/panel.html:2237-2248`

The response is not read. `ok`, `stage`, `expected`, `actual` and `reason` are computed at
`lib/reader.js:967-1010`, serialised by the route at `lib/server.js:446`, and dropped on
the floor. Claim 4 of the brief — "Every refusal names a stage, what was expected, what was
found, and a remedy" — is true of the daemon and false of the product: none of those four
things reaches a human.

What the person sees after a refused retry is worse than nothing. `say('')` clears the
status line, and the next tick runs `renderReader` with `bookError: false` (a spinner is not
the Oops page), so the failure branch takes its `else` arm:

```js
      readerSeq = -1;
      readerTextSeq = -1;
      $('reader-over').hidden = false;
      readerSay('opening your book', true);
      // The pager comes back with the page.
      setPagerDisabled(false, '');
```
`web/panel.html:1497-1502`

The panel says "opening your book" with a spinner, re-enables the pager, and stays there.
The daemon knows the book did not come back and said so in four fields; the screen says it
is opening. That is E4's symptom restored one layer up.

The comment in the `catch` — "the next tick reports whatever actually happened" — is the
false premise. The next tick reports `bookError`, which is false in the E4 case; it has no
channel for "the retry was refused".

**What it should do.** Read the JSON, and on `ok === false` put `reason` into
`#reader-failed-why` (the surface the daemon's remedy strings were written for) and keep
`#reader-failed` visible, rather than returning to the "opening your book" overlay.

**Cheapest check that would catch it next time.** A grep-shaped test in the same style as
the existing ones: slice the `reader-retry-yes` handler out of `panel.html` and assert it
contains `.json()` and `reader-failed-why`. Note that the existing test asserts only
`assert.match(html, /id="reader-failed-why"/)` (`test/reader.test.js:637`), i.e. that the
element exists somewhere in the file — which is true and proves nothing about the wiring.

---

## 4. MAJOR — `retryBook` states a finding it never obtained

**Where.** `lib/reader.js:988-999`.

**What the code does.**

```js
    const after = reopened ? await this.#probe().catch(() => null) : null;
    const arrived = Boolean(after && (after.painted || after.bookError));
    ...
        actual: after?.spinner
          ? 'the reader is still showing its loading spinner'
          : 'the reopened tab has not painted anything',
```
`lib/reader.js:988-998`

`after` is `null` in two distinct situations: the probe threw (the E2 wedge, where
`Runtime.evaluate` times out at 8000ms — see the four `err=Runtime.evaluate did not answer
in 8000ms` samples in `docs/evidence/2026-08-19/E2-spinner-with-label.md`), and it is never
`null` for a page that answered and reported nothing painted. The message asserts the
second in both cases. "The reopened tab has not painted anything" is a statement about the
page; when the probe threw, the page was not asked. This is the defect class the brief names,
inside the method rewritten to remove it.

It also degrades the remedy: "the page has stopped answering" and "the page answered and is
blank" have different next moves, and `readerRemedy` at `web/panel.html:974-995` has a
branch for the first (`/did not answer in \d+ms/`) that this string can never route to.

**What it should do.** Three arms, not two: probe threw / probe answered with a spinner /
probe answered with nothing. The first should carry the thrown message, which
`#probe().catch(() => null)` currently discards.

**Cheapest check that would catch it next time.** Extend the existing test at
`test/reader.test.js:652-690`: make `cdp.send` reject for `Runtime.evaluate`, and assert
`actual` does not contain "has not painted anything". One added case in a test that already
exists.

---

## 5. MAJOR — `ensure` reports `ok: true` over a settle that found nothing

**Where.** `lib/reader.js:1100-1140`, return at `lib/reader.js:1140`.

**What the code does.**

```js
          const settled = await this.settle();
          ...
          if (settled?.signedOut) {
            ...
          }
          ...
        return { ok: true, asin: this.asin };
```
`lib/reader.js:1100-1140`

`settled` is consulted for exactly one thing, `signedOut`. A settle that ran the full 40s
budget and never saw a painted page, a label, or an error page still falls through to
`ok: true`. `view()` calls this first on every poll (`lib/reading.js:103`) and ignores the
result, so nothing downstream can tell "the book opened" from "the timeout expired".

The prevention document added in this same diff has an entry titled "A liveness probe that
answers ok over a dead process is worse than an error (2026-08-20)" naming `ensure` as the
subject. The entry was written; the code was not changed.

**What it should do.** Return what settle found, in the same shape `revive` now uses, and
let `view()` decide. At minimum `{ ok: Boolean(settled && (settled.painted ||
settled.bookError || settled.signedOut)), ... }`.

**Cheapest check that would catch it next time.** The prevention entry's own cheap check,
applied: stub `settle` to resolve `null` and assert `ensure(...)` does not answer `ok: true`.

---

## 6. MAJOR — the label gate fixes the empty half and leaves the wrong half

**Where.** `lib/reader.js:1245`, consumed at `web/panel.html:1525-1531`.

**What the code does.**

```js
      label: probe.label ? (page?.label ?? probe.label) : '',
```
`lib/reader.js:1245`

The gate asks whether the **browser** has a label. When it does, the shelf's remembered
label still wins. The E2 evidence captured in this loop is precisely the case where the
browser has a truthful label and no page:

```
t=5  ready=False painted=False spinner=True  label='Page 219 of 220 ● 95%' err=None
t=6  ready=False painted=False spinner=True  label='Page 219 of 220 ● 95%' err=None
```
`docs/evidence/2026-08-19/E2-spinner-with-label.md`

At t=5 the gate passes, so `state` answers the shelf's label. The panel then prints it with
no `ready` test anywhere:

```js
  $('reader-page').textContent = d.signedOut
    ? 'sign in'
    : (d.label || '') + (ahead
      ? '  ·  ' + ahead + (ahead === 1 ? ' page' : ' pages') + ' ready to turn instantly'
      : '');
```
`web/panel.html:1525-1530`

So the panel reads "Page 217 of 220 · 2 pages ready to turn instantly" over a spinner.
`POST_LOOP8_RETEST.md` lists this exact sentence as the second of the two E2 defects and
says "Items 1.4 and 1.5 own this". Only the `label === ''` half was closed.

`readerShelf` compounds it: it is only ever assigned, never cleared while the reader is
wedged (`web/panel.html:1457`, `web/panel.html:1693`), so the "ready to turn instantly"
count survives the failure that made it false.

**What it should do.** Gate the label on the page having arrived, not on the browser having
produced a string: `label: probe.painted ? (page?.label ?? probe.label) : ''`. That is the
same predicate `capture` was moved onto in this loop, and moving one and not the other is
the split the brief asks about.

**Cheapest check that would catch it next time.** One more case in the test at
`test/reader.test.js:551-563`: probe `{ label: 'Page 219 of 220', spinner: true, painted:
false }` with a shelf entry, asserting `state.label === ''`. It is the fixture the
neighbouring `capture` test already uses.

---

## 7. MAJOR — `settle` returns a stale reading as a current one

**Where.** `lib/reader.js:1166-1201`.

**What the code does.** `last` is assigned only on a successful probe, and returned after
the deadline regardless of how long ago that success was:

```js
    let last = null;
    let paintedAt = 0;
    let failures = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        last = JSON.parse(await this.#evaluate(PROBE));
        failures = 0;
      } catch (err) {
        ...
        continue;
      }
      ...
    }
    return last;
```
`lib/reader.js:1166-1201`

A page that answers once with a painted shell and then stops answering entirely returns
that first reading, up to 40 seconds old, as settle's answer. `revive` then evaluates
`settled.painted` on it and returns `true` (`lib/reader.js:911`), which is the exact claim
the brief says was repaired: revive reporting on something it did not establish. The repair
moved the lie from "my steps ran" to "here is a reading from forty seconds ago".

`retryBook` happens to catch this because it re-probes (`lib/reader.js:988`), but the turn
path does not:

```js
        if ((this.stuck ?? 0) >= 2 && (await this.revive())) {
          await this.#step(this.frontier < target ? 'next' : 'prev').catch(() => false);
        }
```
`lib/reader.js:1791-1793`

which presses a key into a page that was last seen alive before the deadline.

**What it should do.** Return `{ probe, at }`, or return `null` when the most recent
observation is older than one poll interval. A settle that timed out has not observed
anything; the caller needs to know that, not the last thing it saw.

**Cheapest check that would catch it next time.** Fake `#evaluate` to succeed once with
`{ painted: true }` and reject thereafter, call `settle({ timeoutMs: 3000 })`, and assert
the result is not a painted probe.

---

## 8. MAJOR — the five-miss log cannot fire where it matters

**Where.** `lib/reader.js:1173-1188`, with `lib/reader.js:1165`, `lib/reader.js:1298`,
`lib/reader.js:421`, `lib/reader.js:1094` and `lib/reader.js:1585`.

**What the code does.**

```js
        last = JSON.parse(await this.#evaluate(PROBE));
        failures = 0;
      } catch (err) {
        ...
        failures += 1;
        if (failures === 5) {
          this.logger?.info?.(
            `reader: the page has not answered a probe in ${failures} attempts (${err.message}). `
```
`lib/reader.js:1172-1184`

Two things make this unreachable in the case it was written for.

First, arithmetic. `#evaluate` defaults to an 8000ms timeout (`lib/reader.js:1298`), and the
loop sleeps 400ms per iteration, so a wedged page costs about 8.4s per attempt. Two of the
four `settle` call sites use budgets that cannot fit five attempts:
`settle({ timeoutMs: 12000 })` at `lib/reader.js:1094` allows two, and
`settle({ timeoutMs: 15000 })` at `lib/reader.js:1585` allows two. The default 40000ms
(`lib/reader.js:421`) allows five, and only just: the fifth attempt starts at ~33.6s and
finishes past the deadline. The threshold was picked without reference to the two numbers
that bound it.

Second, `failures = 0` on every success. The only recorded trace of this failure in the
repository alternates:

```
t=1 err=Runtime.evaluate did not answer   t=2 err=None   t=3 err=... t=4 err=...  t=5 err=None
```
`docs/evidence/2026-08-19/E2-spinner-with-label.md`

Under that pattern the counter never exceeds 2. The claimed repair — "`settle` swallowed
every probe failure silently and now counts them and logs once at five" — produces silence
on the only failure shape anyone has measured, and will produce noise on a normal load,
where fast "no execution context" rejections during navigation can hit five in two seconds.

**What it should do.** Count elapsed time without an answer, not consecutive exceptions, and
log the first time that exceeds a threshold expressed in the same units as the budget (say,
a quarter of it). Do not reset on a single success while the page is still not settling.

**Cheapest check that would catch it next time.** Assert the invariant in a test rather than
the constant: with `#evaluate` always rejecting and the default budget, the logger must
receive at least one call. That test fails today for the 12s and 15s call sites and passes
marginally for the default.

---

## 9. MAJOR — the sync prompt is reported answered from a click nobody checked

**Where.** `lib/reader.js:256-266` (`dismissScript`) and `lib/reader.js:1271-1287`
(`dismissOverlays`), consumed at `lib/reader.js:1585` and `lib/reader.js:1548`.

**What the code does.**

```js
      const hit = buttons.find((b) => (b.innerText || '').trim().toLowerCase() === want);
      if (!hit) continue;
      hit.click();
      answered.push(text.slice(0, 120));
```
`lib/reader.js:262-265`

`answered` is a list of prompts that were **clicked**, and every caller treats it as a list
of prompts that are **gone**:

```js
      if (answered.length) {
        this.logger?.info?.(`reader: answered Amazon with "${answer}"`, { asked: answered[0] });
```
`lib/reader.js:1277-1278`

```js
    if ((await this.dismissOverlays('Yes')).length) await this.settle({ timeoutMs: 15000 });
```
`lib/reader.js:1585`

Nothing re-queries the DOM. This is E1's root cause, and this loop's own prevention entry
prescribes the missing step in as many words:

> Search any element whose own text matches and which owns a button with the wanted label,
> then **assert afterwards that the prompt is gone** rather than assuming the click landed.
> The cheap check that would have caught it: after a dismissal, probe again and fail if the
> pattern is still on screen.

`docs/BUG_ISSUE_PREVENTION.md`, the E1 entry added in this diff.

Neither half was implemented. The container list is still the same three custom elements
(`lib/reader.js:256`) that `POST_LOOP8_RETEST.md` identifies as the latent defect, and there
is no post-dismissal assertion anywhere in the file. E1 is listed in the brief as one of the
repaired failure modes; the repository's own retest is more honest about it ("E1 therefore
stays without a verdict"), and no code in this diff addresses it.

Related and separate: nothing in `PROBE` reports a dialog, so `painted` is `true` while the
sync prompt is on screen (no spinner, label present). `capture`'s new guard cannot see E1
at all. If the prompt is up during a poll, it is photographed exactly as before.

**What it should do.** Return the outcome, not the attempt: after clicking, re-read the
document and return only the prompts whose text no longer matches. Callers keep their
current shape and become true.

**Cheapest check that would catch it next time.** A test that drives `dismissOverlays`
against a fake `#evaluate` whose script result reports a prompt clicked, and asserts a second
`Runtime.evaluate` was issued. Today the method issues exactly one.

---

## 10. MAJOR — two assertions in the new tests cannot fail

**Where.** `test/reader.test.js:595-605` and `test/reader.test.js:721-728`.

**What the code does.** First:

```js
  for (const observed of [
    'Runtime.evaluate did not answer in 8000ms',
    'Page.navigate did not answer in 20000ms',
    'Emulation.setDeviceMetricsOverride did not answer in 20000ms',
  ]) {
    assert.match(
      observed,
      /did not answer in \d+ms/,
      `the wedge pattern must match the real string "${observed}"`
    );
  }
```
`test/reader.test.js:595-605`

The subject is a literal in the test file and the pattern is a literal in the test file.
Neither comes from `panel.html` or `reader.js`. This loop asserts that a regex written on
line 600 matches a string written on line 596. It passes for any state of the product.

Second, and more consequential because it is the E3 regression test:

```js
  const AMAZON_FAILURE = 'Oops... Something Went Wrong\n'
    + 'Please try to open this book from the library again.\n'
    + 'Back to Library';

  // The detector fires on the fixture. Both halves are required, so a page merely containing the
  // word "Oops" is not a failure.
  assert.match(AMAZON_FAILURE, /Oops\b|Something Went Wrong/i);
  assert.match(AMAZON_FAILURE, /open this book from the library/i);
```
`test/reader.test.js:721-728`

The comment says "the detector fires on the fixture". The assertion never touches the
detector. The regexes are hand-copied from `lib/reader.js:73-74` into the test; if the
detector in `PROBE` is changed or deleted, both assertions still pass. The test named "E3:
the vendor failure page is never rendered as the book" verifies the panel branch (usefully,
by slicing `panel.html`) and verifies nothing at all about detection.

**What it should do.** Extract the pattern from `PROBE` rather than restating it — the file
already does this successfully at `test/reader.test.js:706-712`, where `PROBE.slice(...)` is
read — or delete the tautology. The wedge-pattern loop should slice `readerRemedy` out of
`panel.html` and test the observed strings against the pattern **the panel uses**, which is
the property the test claims to hold.

**Cheapest check that would catch it next time.** A lint rule or review question: in every
`assert.match(a, b)`, at least one of `a` and `b` must derive from a file read at runtime.
Both of these have neither.

---

## 11. MINOR — the `capture` guard tests pass under the rule they replaced

**Where.** `test/reader.test.js:499` and `test/reader.test.js:512`.

**What the code does.**

```js
  const out = await reader.capture({ force: true, probe: { label: '', bookError: false } });
```
`test/reader.test.js:499`

The probe object has no `painted` key, so `!probe.painted` is true because the field is
`undefined`. The test would pass identically against the old, rejected implementation
(`if (probe && !probe.label && !probe.bookError)`), because `label` is `''` too. The fixture
is weaker than the code requires and does not distinguish the rule under test from the rule
being replaced.

The spinner test at `test/reader.test.js:538-545` does distinguish them, so the property is
covered. These two are not carrying the weight their names suggest.

**What it should do.** Give the probe the full field set the real `PROBE` returns, and, in
the first test, `painted: false` with a non-empty `label` so the fixture can only satisfy the
new rule.

**Cheapest check.** Build the fixture from the shape `state()` returns rather than by hand.

---

## 12. MINOR — `revive` clears the error before deciding it failed

**Where.** `lib/reader.js:907`.

```js
      await this.#seed();
      this.revivedAt = Date.now();
      this.error = null;
      ...
      return Boolean(settled && (settled.painted || settled.bookError || settled.signedOut));
```
`lib/reader.js:905-911`

`this.error = null` runs unconditionally on the path that can return `false`. `state()`
reports `error: this.error` (`lib/reader.js:1235`), and the panel's remedy mapper is driven
off `d.error` (`web/panel.html:1465`), so a failed revive erases the one string that would
have routed to the "the page has stopped responding" remedy. Clear it when the return value
is true, not before it is computed.

**Cheapest check.** Assert `reader.error` is unchanged across a `revive` that returns false.

---

## 13. MINOR — "arrived" means two different things

**Where.** `lib/reader.js:911` versus `lib/reader.js:989`.

```js
      return Boolean(settled && (settled.painted || settled.bookError || settled.signedOut));   // revive
      const arrived = Boolean(after && (after.painted || after.bookError));                     // retryBook
```

A reopen that lands on the sign-in page is "arrived" for `revive` and "not arrived" for
`retryBook`, so `retryBook` reports `stage: 'settle'`, `actual: 'the reopened tab has not
painted anything'` for a sign-in form that is fully rendered and waiting for input. The
remedy it prints does happen to mention signing in, so the user is not badly served, but the
two predicates should be one named function with the difference stated, or the same.

**Cheapest check.** Name the predicate (`arrivedAtSomething(probe)`) and use it in both
places; the divergence then has to be written down to exist.

---

## 14. MINOR — the prevention document states the shipped rule wrongly

**Where.** `docs/BUG_ISSUE_PREVENTION.md`, the "A spinner is not a painted page (2026-08-21,
E2)" entry added in this diff.

> `capture` refuses a probe with no position label, letting `bookError` through by name so
> the failure surface still works.

That is the rule the loop found insufficient and replaced. The shipped rule is
`if (probe && !probe.painted && !probe.bookError)` (`lib/reader.js:1436`), and the reason
the label rule was abandoned is recorded in the code comment immediately above it and in
`docs/evidence/2026-08-19/E2-spinner-with-label.md`. A prevention document that describes
the superseded rule will teach the next reader to reintroduce it.

The same diff adds a prevention entry titled "A README that omits a repair still describes
the old behavior", whose prescribed check ("for each new or changed test name, grep the
README for the noun it is about") would have caught this had it been applied to
`BUG_ISSUE_PREVENTION.md` as well as to `README.md`.

**Cheapest check.** Grep the prevention document for `capture` when `capture` changes.

---

## 15. MINOR — the `retryBook` test cannot reach the `reopen` branch

**Where.** `test/reader.test.js:658`.

```js
  reader.revive = async () => true;
```

`reopened` is therefore always truthy, so the `if (!reopened)` refusal at
`lib/reader.js:1002-1013` — `stage: 'reopen'` — is never executed by any test. Its four
fields are checked only by the source-text scan at `test/reader.test.js:625-633`, which
matches the literal text of the object and would pass if the branch were unreachable or if
`reason` were nonsense.

**Cheapest check.** Two lines: a second case with `reader.revive = async () => false`,
asserting `stage === 'reopen'`.

---

## 16. MINOR — an in-flight transcription outlives the failure that hid it

**Where.** `web/panel.html:1346-1356` and `web/panel.html:1377-1381`, against
`web/panel.html:1478-1479`.

`loadReaderText` sets `host.hidden = false` before it awaits
(`web/panel.html:1356`), and its low-confidence arm calls `setFrameHidden(false)`
(`web/panel.html:1379`). Neither consults `readerFailed`. `renderReader` does not await
`loadReaderText` (`web/panel.html:1545`), so a text load started on poll N can resolve after
poll N+1 has set `readerFailed` and hidden both elements, re-showing the transcript element
and, on the low-confidence path, the picture of Amazon's failure page.

The visible damage is limited: `#reader-failed` is `.over`, which is `position:absolute;
inset:0` with an opaque `background: var(--raised)` (`web/panel.html:461-465`), so it paints
over both. The state is still wrong, and `readerNote(...)` writes a per-page note about a
page that does not exist.

**Cheapest check.** `if (readerFailed) return;` at the top of `loadReaderText`, and a test
slicing the function and asserting the guard is present, in the style of the existing panel
tests.

---

## 17. MINOR — `.kg-spinner` is a new necessary condition that was never measured absent

**Where.** `lib/reader.js:102-107`.

```js
    spinner: Boolean(document.querySelector('.kg-spinner')),
    painted: !document.querySelector('.kg-spinner')
      && (Boolean(label || loc) || document.querySelectorAll('img,canvas,svg').length > 2),
```

`painted` is now gated on an element's **existence in the DOM**, not on its visibility. If
Amazon's reader keeps a `.kg-spinner` node mounted and hidden once the page has rendered,
`painted` is false forever, `capture` refuses every page, `state.label` is always `''`
(finding 6's gate), and the reader shows nothing at all — a worse failure than the one being
fixed, produced by the fix.

The repository makes exactly this argument about a sibling selector, in the same week:

> Measured on a healthy reader with no prompt on screen, the page already holds four
> `ion-modal` elements and one `ion-popover`, so their presence proves nothing.

`docs/BUG_ISSUE_PREVENTION.md`, E1 entry; the same measurement appears in
`POST_LOOP8_RETEST.md`.

The evidence for `.kg-spinner` is thinner than that. `E2-spinner-with-label.md` records
`spinner=False` at t=2 and t=... — but every `spinner=False` sample in that trace also has
`painted=False` and `label=''`. There is no recorded sample of a **loaded** page with
`spinner` false. The rule is probably right; it has not been shown right, and `dismissScript`
mitigates the same risk (it tests `getBoundingClientRect()` size and the `overlay-hidden`
class, `lib/reader.js:250-254`) while `painted` does not.

**Cheapest check.** One sample of a page that has arrived, with `spinner` in it, appended to
`E2-spinner-with-label.md`. Failing that, apply `dismissScript`'s own `shown()` test to
`.kg-spinner` so a mounted-but-hidden node cannot blind the reader.

---

## What I checked and did not find fault with

- The `bookError` detector requires both halves (`lib/reader.js:73-74`), and the panel's
  failure branch does hide the picture, hide the transcript, show `#reader-failed` and
  disable the pager (`web/panel.html:1472-1494`). Claim 5 holds for the `bookError` state
  specifically. The pager helper is a single control point and both states go through it
  (`web/panel.html:799-807`); the test at `test/panel.test.js:353-385` genuinely exercises
  that, including the re-enable path.
- The `readerFailed` and `readerSignedOut` transition flags are initialised `false`
  (`web/panel.html:1188`, `web/panel.html:1185`) and reset in `startReader`
  (`web/panel.html:1421-1426`), so a page that is already failing on first observation does
  trigger the branch. The flag-set-on-transition trap the brief asks about is not present
  here.
- The destructive `clearSiteData` is behind a two-step confirmation
  (`web/panel.html:2229-2231`, markup at `web/panel.html:673-681`), and the copy states what
  is not recoverable.
- `#hold` compares bytes before advancing `seq` (`lib/reader.js:1393-1400`), so the "an
  unchanged page costs no download" claim is sound.
- `signedInToReader` asks from evidence rather than from the absence of a sign-in
  (`lib/reader.js:129-135`), and `waitUntilSignedIn`'s 75s budget (`lib/reader.js:658`)
  absorbs the stricter `painted` without regressing.
- The test-harness note at `test/reader.test.js:462-470` — counting attempted CDP calls
  rather than returned frames — is the right seam, and the non-empty guards added to the
  source-slicing tests (`test/reader.test.js:626`, `test/reader.test.js:697`) close the
  vacuous-pass hole those tests would otherwise have.

## Bottom line

Findings 1, 2 and 3 are blocking and they compose into one sentence: the daemon now knows
when it is not looking at the book, and the panel can still be handed a picture of one that
is not, by three separate routes that the guard does not sit on. E2 is reachable today
through a tap on a loading page; E4's honest refusal is computed and discarded before anyone
sees it. E1 has no code change in this diff at all, and the mechanism its own prevention
entry prescribes was not built.
