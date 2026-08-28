# PB-9 root cause: Amazon is serving a reader that cannot boot

Date: 2026-08-22 (local 2026-08-21 evening). Everything below is a live measurement taken
during this session against the running daemon and the real Amazon reader. Nothing is replayed.

## The finding

Amazon's Kindle-for-web reader is a code-split application. Two of its own JavaScript chunks
answer **404 from Amazon's CDN**. Its loader throws `ChunkLoadError`, the book pane never
mounts, and `.kg-spinner` spins forever with no error text anywhere on screen.

```
404  https://m.media-amazon.com/images/G/01/kindle/kindlefortheweb/js/725-ca73bf4e63259892d294.chunk.js
404  https://m.media-amazon.com/images/G/01/kindle/kindlefortheweb/js/789-ef89cfa2f84d6e6b0e8a.chunk.js
THROWN: ChunkLoadError: Loading chunk 725 failed.
THROWN: ChunkLoadError: Loading chunk 789 failed.
THROWN: TypeError: Cannot read properties of null (reading 'appendChild')
```

Confirmed **outside the browser**, with no cookies, no profile and no session, so it is not
this machine, not this profile, and not a cache:

```
$ curl -s -o /dev/null -w "HTTP %{http_code}  %{size_download} bytes\n" <725 chunk>
HTTP 404  9 bytes
$ curl -s -o /dev/null -w "HTTP %{http_code}  %{size_download} bytes\n" <789 chunk>
HTTP 404  9 bytes
$ curl ... <a sibling chunk of the same app>
HTTP 200  3382 bytes
```

The book's own content request succeeds. `renderer/render?version=3.0&asin=B0046LU7H0&
contentType=FullBook` returns 200, as do all 71 other completed requests. The content is
there. The program that draws it is not.

## What this closes

**PB-9 is real and it is external.** No route inside Interstice can make a CDN serve a file it
does not have, which is why all nine previously eliminated routes failed and why the tenth and
eleventh, tested tonight, failed the same way. It also means the route that was being held open
(a person opening the book in the Kindle app to move the server-side position) would not have
worked either. The position was never the problem.

## Two hypotheses killed by measurement tonight

**The sync prompt is not the cause.** Every one of the five wedges in the daemon log is preceded
by a sync-prompt "Yes", which looked causal. It is not: 2026-08-19 has roughly 25 "Yes" answers
and zero wedges. Tested directly by disabling the answer in `#seed`, restarting, and watching a
cold load for two minutes: no prompt was answered, no wedge fired, and the page still never
painted. Then the prompt was clicked by hand through CDP with the product's own selector and
predicate: the prompt disappeared in under a second and the spinner stayed at 330x370 for a
further twenty seconds with the body reading only `Kindle Library`.

That click is also **E1's first verdict**. The dismissal mechanism works. `ion-alert`, shown at
412x520, matched by the shipped pattern, buttons labelled exactly `No` and `Yes`, clicked, gone.
The prompt was a passenger on this failure, not the driver.

**A stale app shell is not the cause.** `Network.clearBrowserCache` followed by
`Page.reload({ignoreCache: true})` fetched the same two chunk hashes and got the same two 404s.
The shell being served right now names files that are not there.

## What was changed in response

Nothing can fix Amazon's CDN. What was fixed is that Interstice presented this as "loading",
indefinitely, which reads as a fault in this program:

- `SCRIPT_WATCH` records scripts the vendor's app asked for and did not get. It listens in the
  **capture phase**, because a `<script>` load error fires on the element and does not bubble.
  The resource timeline cannot substitute: these chunks are cross-origin without
  `Timing-Allow-Origin`, so `responseStatus` reads 0 rather than 404 and a status filter finds
  nothing. Both were tried against the live failure before the listener was written.
- `PROBE` reports `deadScripts` as a list of URLs rather than a flag, so the panel can name the
  file and the operator can check the claim in one `curl` instead of taking it on trust.
- The panel's failure surface gains a second arm: what happened, whose failure it is, the file
  itself, and a pager disabled with a reason. It does not offer the retry copy, because pressing
  a button here cannot fetch a file off Amazon's servers.

## Deployed and verified live

```
deadScripts:
  https://read.amazon.com/static/js/725-ca73bf4e63259892d294.chunk.js
  https://read.amazon.com/static/js/789-ef89cfa2f84d6e6b0e8a.chunk.js
```

from `POST /api/reading/view` against the restarted daemon, with `painted: false`,
`spinner: true`, `label: ''` and `error: null`. `GET /panel` serves the new markup.

## Also verified live tonight, from the same session

- **Finding 6**, before and after one restart, same wedge: the old process answered
  `label: 'Page 220 of 220 ● 95%'` over a spinner; the new one answers `label: ''`.
  Captured in `E2-live-before-deploy.json` and `E2-live-after-deploy.json`.
- **Finding 3 / E4**: `POST /api/reading/retry` answered `{ok: false, stage: "reopen", ...}`
  with a remedy, where the old code reported `{cleared: true, reopened: true}` on this same
  failure. Captured in `E4-live-honest-refusal.json`. That refusal came from the `reopen`
  branch, which finding 15 correctly said no test could reach.

Disclosure: that retry call cleared Amazon's stored device registration for the reader profile,
which the panel guards behind a two-step confirmation. Cookies and the sign-in are excluded from
that clear by design, and the session survived it.

## Re-checked 2026-08-22 01:0x local

Both chunks still answer 404 from Amazon's CDN, and the live reader still reports
`painted: false, spinner: true, label: '', deadScripts: 2`. The outage is ongoing, so items whose
verify needs a rendered page stay blocked: loop 9's `1.5`, `1.0`, `1.11` and `Z.1`, and loop 8's
`1.7` and `9.1`. Their fixes are shipped and live-verified; only the verification waits.

The cheapest re-check, for whoever picks this up:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  https://m.media-amazon.com/images/G/01/kindle/kindlefortheweb/js/725-ca73bf4e63259892d294.chunk.js
```

200 means the outage is over and those six items can be run. Note that Amazon may ship new chunk
hashes rather than restoring these two, in which case the URL above 404s forever and the real test
is whether the live reader reports an empty `deadScripts` with `painted: true`.
