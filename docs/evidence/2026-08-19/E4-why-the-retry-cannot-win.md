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

## Correction, same day: the narrow fix above does not work

The section above proposed, as the narrow fix, opening at "the Kindle app's synced position rather
than the server's". That was tested and it is wrong, so it is corrected here rather than left for
someone to implement.

What was tried, in order:

1. Closed the web reader entirely, so it would stop re-asserting its own position.
2. Opened the book in the Kindle app by bundle id, `com.amazon.Lassen`, and gave it 45 seconds.
3. Reopened the web reader.

It landed at `Page 219 of 220 ● 95%` again, with the spinner up.

**Why the proposal was wrong.** It assumed the Kindle app's position IS the server's, so that
opening the app would move what the web reader returns to. It is not. The reading rung reads the
app's position out of the Kindle app's own Core Data store, which is a LOCAL number: it still says
39%. The web reader opens at the position Amazon holds server-side, which the web reader itself set
to 95%. The two are different sources, and this loop's notes describe them as different sources in
the very table that lists where each rung's data comes from. I proposed a fix that read one and
expected the other to move.

**What that leaves.** The position cannot be steered from this machine by any route tried: not by
navigating the tab, which does not answer; not by turning pages, which needs a rendered page; not by
the other device, which does not own the number. What is left is either a URL form that carries a
position and that Amazon honours, which is unverified, or reading far enough in the Kindle app that
it pushes a new position up, which is a person's afternoon rather than a command.

**The general point survives, and is the part worth keeping.** A recovery that returns to the exact
conditions of the failure is not a recovery. That was true before this correction and is still true;
what changed is that the obvious way to vary the destination turns out not to be available.
