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
