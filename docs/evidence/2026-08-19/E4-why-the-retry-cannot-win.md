# Why the retry recovers nothing, when the position is the problem

Captured 2026-08-21, from the live reader, after `retryBook` reported
`{ok: true, cleared: true, reopened: true}` and left the page exactly as it was.

## The sequence, as written

`retryBook` calls `revive({ clearFirst: true })`, and `revive` does this:

1. `Target.closeTarget` on the wedged tab
2. `#openTab`, a fresh one
3. `clearSiteData`, in the gap where nothing has loaded to write it back
4. `Page.navigate` to **`readerUrl(asin)`**
5. `settle`

Step 4 is the problem. `readerUrl(asin)` is `https://read.amazon.com/?asin=...` with no position,
so Amazon opens the book **where the server says the reader last was**. If that position is the one
that wedged the renderer, the retry lands back on it, and wedges again.

So the loop is: hang, close the tab, clear the data, reopen at the same page, hang. Every step
succeeds. Nothing recovers. That is E4, and it is not a bug in any single step.

## What confirms it rather than merely fitting it

The renderer is hung, not slow. Asked directly over the debugging port to navigate somewhere else:

```
Page.navigate did not answer in 20000ms
```

A tab that cannot be told to go elsewhere cannot be steered off the page that hung it, which is why
only closing the tab has any effect, and why closing it does not help when the reopen goes back to
the same place.

## The position, and how it got there

The Kindle app reports the synced position as 39%. The web reader is at `Page 219 of 220 ● 95%`,
the last page. This loop's own first live read pressed "next" twenty times, which walked it to the
end and pushed that position up to Amazon. So the wedging page is the last page of the book, and the
reason the reader keeps returning to it is that the reader itself put it there.

## What would fix it, and what would only appear to

**Appears to fix it:** anything that closes and reopens. It is what the code already does and it is
why `reopened: true` is not evidence of anything.

**Would actually fix it:** giving `revive` somewhere else to go when the same position has now
wedged twice. The reader already tracks `stuck`, and `reader.js` reopens after two strikes; what it
does not do is vary the destination. A retry that returns to the identical URL is not a retry, it is
the same attempt.

The narrow version is to open at the Kindle app's synced position rather than the server's when a
reopen at the server's position has already failed once. The broad version is that any recovery that
restores the exact conditions of the failure needs a reason to believe those conditions were not the
cause.
