# The case that proves the E2 fix, captured live 2026-08-21

Item 1.4 asks whether a spinner-only page satisfies `painted`, and says to establish it by
measurement rather than argument. This is the measurement, taken from the running reader after the
fix shipped, and it shows the old rule getting a real page wrong.

## The samples

Polled once every five seconds through a cold start, immediately after restarting the daemon onto
the new code:

```
t=1  ready=False painted=None  spinner=None  label='None'                 err=Runtime.evaluate did not answer in 8000ms
t=2  ready=False painted=False spinner=False label=''                     err=None
t=3  ready=False painted=None  spinner=None  label='None'                 err=Runtime.evaluate did not answer in 8000ms
t=4  ready=False painted=None  spinner=None  label='None'                 err=Emulation.setDeviceMetricsOverride did not answer
t=5  ready=False painted=False spinner=True  label='Page 219 of 220 ● 95%' err=None
t=6  ready=False painted=False spinner=True  label='Page 219 of 220 ● 95%' err=None
t=7  ready=False painted=None  spinner=None  label='None'                 err=Runtime.evaluate did not answer in 8000ms
t=8  ready=False painted=None  spinner=None  label='None'                 err=Emulation.setDeviceMetricsOverride did not answer
```

## Why t=5 and t=6 are the whole argument

Those two samples have **a page label AND a spinner at the same time**. Amazon's reader draws its
own furniture, the toolbar and the page number, before the page itself arrives, so the label is
present and truthful while the book is still not there.

The rule before this loop was:

```js
painted: Boolean(label || loc) || document.querySelectorAll('img,canvas,svg').length > 2
```

On those two samples `label` is non-empty, so that expression is **true**. The old code would have
declared the page painted, `capture` would have photographed it, and the panel would have set a
spinner in the reading type under a progress bar reading 95%. That is E2 exactly, and it is not the
blank-page case anyone was looking for: the page number is right there on screen, which is what made
it look like a real page.

The rule now is:

```js
spinner: Boolean(document.querySelector('.kg-spinner')),
painted: !document.querySelector('.kg-spinner')
  && (Boolean(label || loc) || document.querySelectorAll('img,canvas,svg').length > 2),
```

and it returns **false** on both, which is correct.

## What the other samples show

Four of the eight could not be probed at all: `Runtime.evaluate` and
`Emulation.setDeviceMetricsOverride` time out because the page's main thread has stopped answering.
That is the second half of E2 and it is separate from the spinner. Note the reporting: when the
probe cannot run, every field is null rather than carrying the previous answer, which is the
`state` fallback that was fixed in the same loop. Before that fix these rows would have read
`label='Page 219 of 220'` with no way to tell them from t=5.

## The honest limit

This proves the rule now classifies the case correctly. It does not prove the reader stops wedging:
it still does, four samples in eight. The wedge is `retryBook`'s job and it recovers, verified
separately. What changed is that the panel no longer photographs the wait and calls it a page.
