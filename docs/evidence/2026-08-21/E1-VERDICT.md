# E1 (the sync prompt) gets a verdict

Date: 2026-08-22. Measured against the operator's own live reader profile through CDP.
`POST_LOOP8_RETEST.md` recorded "E1 therefore stays without a verdict" because nothing had
observed the dismissal actually happen. It has now been observed.

## Item 1.1's hypothesis is refuted by measurement

1.1 supposes: "`dismissScript` only searches `ion-alert, ion-modal, ion-popover`, so if Amazon
has moved the prompt out of those three custom elements the regex never gets to run."

Amazon has not moved it. Read off the live DOM while the prompt was on screen:

```
WHAT dismissScript LOOKS AT (ion-alert, ion-modal, ion-popover):
[{"tag":"ion-modal","hasText":false,"hidden":true,"box":"0x0"},
 {"tag":"ion-modal","hasText":false,"hidden":true,"box":"0x0"},
 {"tag":"ion-popover","hasText":false,"hidden":true,"box":"0x0"},
 {"tag":"ion-modal","hasText":false,"hidden":true,"box":"0x0"},
 {"tag":"ion-modal","hasText":false,"hidden":true,"box":"0x0"},
 {"tag":"ion-alert","hasText":true,"hidden":false,"box":"412x520"}]

WHERE THE PROMPT LIVES:
[{"tag":"h2","cls":"alert-title sc-ion-alert-ios","id":"alert-7-hdr"}]

BUTTONS in whatever holds it:
["div -> \"No\", \"Yes\""]
```

The prompt is in an `ion-alert`, which is one of the three the shipped search already covers. It
is shown at 412x520, it does not carry the hidden class, its text matches the shipped pattern,
and its buttons are labelled exactly `No` and `Yes`, which is what the shipped label test wants.
Every link in the chain the hypothesis doubted is intact.

The same reading is the answer to a second question worth settling: five of the six matching
custom elements are permanently mounted and 0x0. Presence proves nothing in this DOM, which is
why the shown-and-sized test exists, and why finding 17 moved `.kg-spinner` onto the same test.

## The click works

Driven by hand through CDP using the product's own predicate and selector, verbatim:

```
BEFORE: {"prompt":true, "spinner":true, "spinnerBox":"330x370", "media":2,
         "body":"Kindle Library Most Recent Page Read You're on location 4328. The most recent
                 location is 4325. Go to location 4325? No "}
CLICK RESULT: ["clicked: Most Recent Page Read You're on location 4328. The most rece"]
t+1s:  {"prompt":false, "spinner":true, "spinnerBox":"330x370", "media":2, "body":"Kindle Library"}
t+3s:  {"prompt":false, ...}   t+6s: {"prompt":false, ...}
t+12s: {"prompt":false, ...}   t+20s: {"prompt":false, ...}
```

The prompt is gone within one second and stays gone. **Verdict: the dismissal mechanism works.**

## So what was E1?

The defect was never that the click missed. It was that a click was REPORTED as an answer
without anything checking. `dismissOverlays` returned the prompts it had clicked and both
callers read that list as the prompts that were gone, one of them using a non-empty list as its
signal to settle for another fifteen seconds. That is adversary finding 9, and it is fixed: the
document is read again after the click and only the prompts that actually went away come back.

Verified live under the fixed code. At `2026-08-22T06:10:03.004Z`, under pid 39370 which
started at `06:09:23`, after the fix was deployed at `06:06:35`:

```
INFO  reader: answered Amazon with "No" {"asked":"Most Recent Page Read You're on location 4328.
      The most recent location is 4325. Go to location 4325? No Yes"}
```

That line can only print when the post-click re-read found the prompt gone, which is item 1.2's
verify condition in full: a live run against the operator's own profile answered the prompt,
returned a non-empty array, and a probe taken immediately after found nothing matching.

## What is NOT captured, and why

The prompt's `outerHTML` was not captured before it was dismissed, and it has not reappeared
since: answering `No` made the local position authoritative, so there is no longer a discrepancy
for Amazon to ask about, and a forced reload watched for 42 seconds produced no prompt. The book
cannot be advanced to create a new discrepancy because of PB-9. Everything quoted above is
verbatim live output; nothing here is reconstructed, and no fixture in the test suite claims to
be markup that was never captured.
