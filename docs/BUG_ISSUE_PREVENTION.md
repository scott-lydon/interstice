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
