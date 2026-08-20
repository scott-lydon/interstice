# UX_FEEDBACK

## Pass 1 - design only (2B.2)

- [x] (high) [operator] The `#companions` setup banner is a sibling of `<main>` and no `body.immersive` rule hides it, so while reading it still sits above `#reader` and eats the page. Measured in a 640x900 headless render with two short items showing: `#reader` falls to 794px, 88.2% of the height, already under the >=90% contract, and `#companions` is allowed to grow to `max-height: 40vh` (360px), which would leave the page near 60%. This is the exact "chrome eating the page" failure the phase exists to remove. {worthwhile}
- [x] (high) [first-run] There is no mouse page-turn control while reading. `body.immersive #view-reading > :not(#reader):not(.reader-menu):not(.reader-menu-overlay) { display: none }` has specificity (2,3,1) and outranks `body.immersive .reader-pager-overlay { display: flex }` at (0,2,1), so `.reader-pager-overlay` computes to `display: none` (verified in Chromium against `web/panel.html`). The design artifact's pager pill never appears, `#page-prev-imm` and `#page-next-imm` are unreachable, and a new user sees a page with no controls at all. {worthwhile}
- [x] (high) [star-checker] The star calendar cannot open. `#star-cal-overlay` is a direct child of `#view-reading` and is caught by the same `:not()` rule, so pressing `#open-star-cal` adds `.open` to an element that still computes `display: none` (verified: `star-cal-overlay.open` renders as `none`). The persona's entire reason for opening the menu produces nothing on screen. {worthwhile}
- [x] (medium) [operator] `#latency-chip`, `#arrival-note` and `#forfeit-note` are hidden by the same rule and compute to `display: none` even with `.show` applied, so while reading you never see the waited-time chip, the "Response landed" arrival note, or the banner naming a forfeited block. A star that quietly disappears with no notice is the fastest way to stop trusting the star system. {worthwhile}
- [x] (high) [first-run] Nothing tells a new user the page can be turned. The design artifact carries a persistent `<div class="note">&#8592; &#8594; turn the page</div>`; `web/panel.html` has no equivalent, and `#reader-note` is the per-page message slot, not a keyboard hint. With the pager overlay invisible too, the only page-turn affordance in the product is an undiscoverable arrow key. {worthwhile}
- [x] (medium) [operator] The current page number is not visible while reading. `#reader-page` is displaced into the menu by `READER_MENU_DISPLACED`, and the immersive pager markup (`#page-prev-imm`, `#page-next-imm`) omits it, unlike the design's `.pager .now` which reads "Page 79". Answering "where am I" costs a modal open and close. {worthwhile}
- [ ] (medium) [first-run] `#reader-menu` is a bare `&#8943;` glyph, 30px square, with an `aria-label` but no visible label and no `title` tooltip. The design mock gives the same button `title="Menu"`. A sighted first-run user gets an unexplained mark in the corner and no hover text. {skip}
- [ ] (medium) [first-run] The open menu has no heading and no hierarchy. `#reader-menu-overlay` renders "Close x", then "Star calendar", then `#reader-menu-slot` filled in `READER_MENU_DISPLACED` order (rungs, title block, progress bar, pager, note, actions, companions, footer bar). The book title and progress land in the middle of a stack of relocated chrome, whereas the design leads with the brand row, then the rungs, then the title, the author line and the bar. First sight of the menu does not answer "what is this panel showing". {skip}
- [ ] (medium) [star-checker] The calendar prints raw ISO keys at users: `_renderStarCal` sets the title to `Stars in ${key}` ("Stars in 2026-08") and `Stars on ${key}` ("Stars on 2026-08-19"), and `_reveal` repeats the key inside the sentence. The design shows "August 2026" and "Today, Aug 19". {skip}
- [ ] (high) [star-checker] There is no "today" marker in the month grid. `.cal-cell` is built identically for every day and the design's `.d.today` accent border has no counterpart in `web/panel.html`, so the one-second glance the persona wants ("did today happen yet") turns into counting cells from the day-of-week header. {skip}
- [x] (medium) [star-checker] No total is shown for the month or the day. The design puts a count in `.cal .mh .t` ("14 stars", "3 stars"); the implementation offers only `#cal-title` plus per-day glyphs, so "how am I doing this month" has to be tallied by eye across a 31 cell grid. {worthwhile}
- [x] (high) [star-checker] Month paging reports false zeros. `#cal-prev` and `#cal-next` call `_renderStarCal` with `_cal.stars`, the array already loaded for the current month, instead of calling `_loadStarCal` for the new month, so `starsFor(day)` matches nothing and every other month renders "No stars earned this month yet." even when that month has stars. {worthwhile}
- [x] (medium) [star-checker] Day view lands on the wrong day and cannot be moved. `#cal-view-toggle` opens `_cal.stars[last].day`, the most recent star's day rather than today, and `#cal-prev` and `#cal-next` are guarded by `_cal.view === 'month'`, so once in day view there is no way to step to another day or back to today. {worthwhile}
- [ ] (medium) [star-checker] Clicking a star can look like nothing happened. `_reveal` writes into `#cal-reveal`, which sits after `#cal-body` at the bottom of a scrolling overlay; a six row month grid plus header and legend pushes it below the fold in a 640x900 panel, nothing scrolls it into view, and no `.cal-star` gets a selected state, so there is no feedback at the point of the click. {skip}
- [ ] (low) [star-checker] The reveal copy drops the fact that makes a star legible. `_reveal` produces "A block earned on 2026-08-19: began 09:12 and ended 09:37" with no duration, while the design's star detail row says "(25m unbroken)". The persona reading a start and an end has to subtract to confirm the block was a full one. {skip}
- [x] (medium) [star-checker] `#star-cal-overlay` is a `role="dialog" aria-modal="true"` that does not trap focus. Only Escape is handled on it, unlike `#reader-menu-overlay` which has a Tab trap, so Tab walks out of the open calendar onto the controls beneath it. `_closeStarCal` also returns focus to `#reader-menu` rather than to `#open-star-cal`, the button that opened it, so keyboard position is lost on close. {worthwhile}
- [ ] (medium) [operator] The stars live behind two stacked modals, not one. `#star-cal-overlay` (z-index 31) is a second full screen `role="dialog"` layered on top of `#reader-menu-overlay` (z-index 29), so a glance at stars costs menu, Star calendar, Close, Close. The design put the calendar inline in the single menu, and the loop's own contract says the star surface lives behind the same one menu. Two nested overlays is the "menu that costs more attention than the thing it hides". {skip}
- [ ] (medium) [operator] Nothing shows a focus block in progress. The reading view has a chip for prompt latency (`#latency-chip`) but no equivalent for the 25 minute block that is the reason to sit here, so the operator cannot tell whether a star is two minutes away or twenty two, and learns the block existed only after it is earned or forfeited. {skip}
- [ ] (low) [star-checker] The legend does not match the marker it explains. `.cal-legend .swatch` is an empty accent tinted square while the grid marker is a filled star glyph on a `.cal-star` button, so the mapping from legend to calendar takes a second look. {skip}
- [x] (low) [operator] With the menu or the calendar open, ArrowLeft and ArrowRight still turn the page: the document `keydown` handler fires on `currentView === 'reading'` regardless of overlay state. The page is behind an opaque blurred overlay and `#reader-page` has been moved into the menu, so the position changes with no visible feedback anywhere. {worthwhile}

## Pass 2 - design only, after D (2B.4)

- [x] (high) [star-checker] The star calendar's first open claims there are no stars at all, and never asks the server. Measured in a 640x900 headless Chromium render driving the real path (click `#reader-menu`, then `#open-star-cal`): zero requests to `/api/stars` (both the page-level network log and a `window.fetch` wrapper recorded `[]`), `#cal-title` computed to "Stars in (no month)", `#cal-count` to "" (empty) and `#cal-body` to "No stars earned yet. Complete a 25-minute block to earn your first." `_openStarCal` calls `_loadStarCal(_thisMonth())`, and `_thisMonth()` returns `null` while `_cal.stars` is empty and `_cal.key` is `null`, so `_loadStarCal` short-circuits on `if (!yyyyMM)` before it can fetch. This is the same false zero the month-paging fix removed, relocated onto the first thing the persona ever sees, and it states it as history rather than as a load failure. {worthwhile}
- [x] (medium) [star-checker] From that first open the calendar is unrecoverable: no control reaches a real month. Measured after the cold open, `#cal-prev` issued zero `/api/stars` requests and left `#cal-title` at "Stars in (no month)", because `_step` returns on `if (!_cal.key) return` and `_cal.key` is `null`; `#cal-view-toggle` does move to today's day view ("Stars on 2026-08-19") but reports "0 stars" from the same never-loaded array. Every control in the dialog is pressable and none of them changes what the month says. {worthwhile}
- [x] (medium) [operator] The arrival note lands exactly on top of the latency chip and hides it. Pass 1 made both visible while immersive, and they now share one position: driven through the real `window.__latency` API with two prompts in flight, completing one left `#latency-chip.show` reading "waited 1:04" at rect (8, 8, 91x22) with z-index 25 while `#arrival-note.show` occupied (8, 8, 107x22) with z-index 26, and `document.elementFromPoint` at the chip's centre returned `arrival-note`. For the 2500ms the note is up, the operator is told a response landed and at the same moment loses the number saying how long the other one has been waiting. {worthwhile}

## Pass 3 - design only, after D (2B.4)

All three pass-2 items verified fixed against the live daemon at http://localhost:7420/panel,
driven through the real path in a 640x900 headless Chromium (`setView('reading')`, click
`#reader-menu`, click `#open-star-cal`), with page-level `request` events as the proof:

    2B.4 fix 1 (cold open fetches): one request recorded on first open,
      GET /api/stars/month?month=2026-08. `#cal-title` = "Stars in 2026-08",
      `#cal-count` = "0 stars", a full 37-cell grid (6 leading blanks + 31 days) rendered,
      and the "No stars earned this month yet." line is now an honest empty: the daemon
      really answered {"month":"2026-08","stars":[]}.
    2B.4 fix 2 (steppers live from a cold open): `#cal-prev` issued
      /api/stars/month?month=2026-07 and titled "Stars in 2026-07"; `#cal-next` issued
      2026-08 then 2026-09. Day view toggles to "Stars on 2026-09-01" and `#cal-next`
      steps to 2026-09-02 with no request, correct for a within-month day step.
    2B.4 fix 3 (arrival note off the chip): with two prompts in flight and one completed,
      `#latency-chip.show` = "waited 1:04" at rect (8, 8, 90.6x22), z-index 25, and
      `#arrival-note.show` at (8, 36, 107.1x22), z-index 26. No overlap.
      `document.elementFromPoint` at the chip centre returns `latency-chip`, at the note
      centre returns `arrival-note`.
    Reader real estate while reading: `#reader` 866.7px of 900, 96.3%.

Two new items, both measured:

- [x] (medium) [star-checker] After the first open, the calendar never asks the server again for the life of the panel, so a star earned during the session is invisible until a reload. Measured on the live daemon: open #1 issued `/api/stars/month?month=2026-08`; closing and reopening (opens #2 and #3) issued zero requests and re-showed the cached "Stars in 2026-08 / 0 stars". `_openStarCal` fetches only under `if (_cal.key === null)`, and `/api/stars/month` is the panel's only stars call (no poll, no event stream), so nothing else can refresh it. The same guard also means the dialog reopens on wherever it was last left rather than on this month: after paging to September and switching to day view, closing and reopening put the star-checker back on "Stars on 2026-09-02" with no request. The only in-panel recovery is pressing `#cal-prev` then `#cal-next` (measured: two requests, back to a fresh 2026-08), which nothing hints at. {worthwhile}
- [x] (low) [operator] Moving the arrival note down to `top: 36px` moved it under the forfeit banner: `.forfeit-note` sits at `top: 44px` with z-index 27, above the note's 26. Measured with a real forfeit record and a completing prompt, `#arrival-note` occupied (8, 36, 107.1x22) and `#forfeit-note` (8, 44, 624x38.8), covering 14 of the note's 22px (64%) and leaving an 8px accent-coloured sliver; `document.elementFromPoint` at the note's centre returns `forfeit-note`. The 2500ms confirmation that a response landed is unreadable, and reads as a rendering glitch, for exactly the operator whose block just died and who is most likely to be looking at that corner. {worthwhile}

## Pass 4 - design only, convergence check (2B.4)

Both pass-3 fixes verified against the live daemon at http://localhost:7420/panel in a
640x900 headless Chromium, driven through the real path (`setView('reading')`, click
`#reader-menu`, click `#open-star-cal`), with page-level `request` and `response` events
as the proof:

    2B.4 fix 1 (every open re-asks the server): open #1 issued
      GET /api/stars/month?month=2026-08 (200); close + reopen issued it again, and a third
      open issued it a third time. Three opens, three requests, where pass 3 measured one.
      A star appearing mid-session is now visible without a reload: with the route answering
      one star for 2026-08, the very next reopen rendered `#cal-title` "Stars in 2026-08",
      `#cal-count` "1 star", one `.cal-star` in the grid and no empty-copy line.
    2B.4 fix 2 (arrival note clear of both the chip and the forfeit banner): two prompts in
      flight, one completed, plus a real forfeit record. `#latency-chip.show` "waited 1:04"
      at (8, 8, 90.6x22) z-index 25; `#arrival-note.show` at (108, 8, 107.1x22) z-index 26;
      `#forfeit-note.show` at (8, 44, 624x38.8) z-index 27. Zero rect intersections between
      any pair. `document.elementFromPoint` at each centre returns its own element:
      latency-chip, arrival-note, forfeit-note. Chip growth headroom: the chip's right edge
      is 98.6px at "waited 1:04" and 105px at "waited 59:59", against the note's left edge
      at 108px.
    Pass-1 items still holding: `#companions` display none while immersive, reader 866.7px
      of 900 (96.3%), `.reader-pager-overlay` flex at 125x44, `.reader-hint` visible reading
      "left-arrow right-arrow turn the page", both hidden while an overlay is open, arrow
      keys inert with the calendar open, Escape closes the calendar and returns focus to
      `#open-star-cal`.

One new item, a regression introduced by fix 1:

- [x] (medium) [star-checker] Every open now re-asks the server, but it asks for whatever key was left on screen, so reopening after the day view sends a day as if it were a month and the calendar labels itself with dates that do not exist. `_openStarCal` passes `_thisMonth()`, and `_thisMonth()` prefers stale state (`_cal.stars`'s newest star, then `_cal.key`) over today; in day view `_cal.key` is a full day string, and it stays one whenever the loaded month held no stars. Measured on the live daemon in its real (empty) state, four clicks from a cold panel: open the calendar ("Stars in 2026-08", 0 stars), press Day view ("Stars on 2026-08-19"), Escape, reopen. The reopen issued GET /api/stars/month?month=2026-08-19, the daemon answered HTTP 400 `{"error":"bad_date","detail":"month must be YYYY-MM, got \"2026-08-19\""}`, the fetch fell into the offline catch, and `#cal-title` rendered "Stars in 2026-08-19" over a 37-cell grid. It compounds from there: pressing Day view again titles the panel "Stars on 2026-08-19-01" (day view builds `${month}-01` from the day string), and `#cal-prev` from that state jumps to "Stars on 2026-08-18" with no explanation of where the 19th went. Before the fix this path was inert, because the reopen never loaded anything. The same line has a second consequence pass 3 raised and this fix did not remove: reopening still lands on the last month viewed rather than this one, measured as page to October, close, reopen, request month=2026-10, title "Stars in 2026-10", so the persona who opened the panel to ask about this month is answered about a different one. Opening on `_today().slice(0, 7)` instead of `_thisMonth()` settles both. {worthwhile}

## Pass 5 - interactive, convergence check (2B.4 / 6.2)

First pass that could interact with the running build, and the first to run while the star
store held a real star: the daemon awarded one at 06:33:21Z during this pass, so the
star-checker persona was driven against live data rather than an empty month. All figures
below come from a 640x900 headless Chromium against http://localhost:7420/panel, driven
through the real path.

    Pass-4 fix (open on today's month, never on the stale key): LANDED.
      Four clicks from a cold panel (open, Day view, Escape, reopen): open #1 issued
      GET /api/stars/month?month=2026-08 (200), `#cal-title` "Stars in 2026-08",
      `#cal-count` "1 star", 31 day cells; Day view titled "Stars on 2026-08-19";
      Escape closed the overlay and returned focus to `#open-star-cal`; the reopen issued
      month=2026-08 again (200), not month=2026-08-19. Where pass 4 measured HTTP 400
      bad_date and a header reading "Stars in 2026-08-19", this pass measured neither.
      Reopen after paging: `#cal-prev` twice reached 2026-07 then 2026-06 (both 200),
      Escape, reopen issued month=2026-08 and rendered "Stars in 2026-08 / 1 star", so the
      dialog returns to the current month instead of the last one paged to.
      Six /api/stars requests across the whole session, six 200s, zero non-200.
    Passes 1 to 4 still holding: `#companions` display none while immersive,
      `.reader-pager-overlay` flex at 124.6x44.1, `.reader-hint` reading
      "left-arrow right-arrow turn the page", arrow keys guarded while the calendar is open,
      and no rect intersection between the three corner surfaces:
      `#latency-chip` (8, 8, 90.6x22) z 25, `#arrival-note` (108, 8, 107.1x22) z 26,
      `#forfeit-note` (8, 44, 624x38.8) z 27, each returning its own id from
      `document.elementFromPoint` at its centre.
    What the forfeited-star persona sees, driven with
      `window.__focus.forfeit({cause:'video', at:<20 minutes ago>, elapsedMs:1200000})`:
      a single bounded banner across the top of the reading page, role="alert"
      aria-live="assertive", reading "Block forfeited at 06:16: non-whitelisted video
      played." with the cause in bold. It is neutral rather than accusing, it names the
      breaker in the user's words and not the breaker's own slug, it persists until
      dismissed rather than timing out, and its close button is focusable (tab order in the
      reading view: page-prev-imm, page-next-imm, immersive, read-app, fn-dismiss,
      reader-menu). Every cause maps to plain words: app to "a blacklisted app came to the
      front", lock to "the screen locked", video to "non-whitelisted video played", manual
      to "you ended the block". Three things are missing from that experience and are raised
      below: the wall-clock time is wrong by the UTC offset, nothing in the running panel
      ever triggers it, and the 20 minutes the persona lost is not in the sentence.

Five new items, none of them a regression from the pass-4 fix. Four of the five were reachable
only by driving the running system: three needed a real star and a real forfeit record, and one
needed the reader in a live state that fills the element it hides behind.

- [x] (high) [star-checker] A star earned today is filed on tomorrow's cell, and today's day view says zero. Measured live: the daemon awarded a star at 2026-08-20T06:33:21.293Z, which is 23:33 PDT on 2026-08-19, and `/api/stars/month?month=2026-08` returns it with `"day":"2026-08-20"`. The panel puts the only star of the month in cell 20 while the browser's own `_today()` is 2026-08-19, and pressing Day view titles the dialog "Stars on 2026-08-19", counts "0 stars" and prints "No stars earned this day yet." six minutes after the block completed. The cause is one line: `lib/focus/tracker.js` mints every timestamp with `new Date().toISOString()`, which is always UTC, and `localDay` in `lib/focus/blocks.js` slices the first ten characters of it on the stated assumption that "the timestamp carries its own offset". West of UTC every block finishing after 17:00 local is filed on the next day, and every block finishing after 17:00 on the last of the month is filed into the next month, where the persona's glance at this month will never find it. The persona's entire goal, see when today's star happened, currently answers "it did not". {worthwhile}
- [x] (high) [forfeited-star] Nothing in the running panel ever raises the forfeit banner, so in real use this persona sees nothing at all. `#forfeit-note` and its copy are correct when driven, but `window.__focus.forfeit` has exactly one occurrence in the served page, its own definition: the panel makes no request to `/api/focus` anywhere, and its only poll, `beat()` every 1500ms, hits `/api/panel/ping`, which answers `{ok, rung, seq, detail, asset}` and carries no focus, star or forfeit field (verified against the live route). The daemon already publishes the record the banner wants: `/api/focus` returns `block.lastForfeit` alongside the three armed breakers. A user who watches a clip and loses the block gets a silent loss and a star that never appears, which is the exact outcome item 4.6 exists to prevent. {worthwhile}
- [x] (medium) [forfeited-star] The time in the banner is the UTC time, not the time on the user's clock, so the sentence points at the wrong moment. Same root as the star-day item: `_wallClock` regexes `T(\d{2}):(\d{2})` out of the ISO string on the comment's assumption that it reads "the ISO string's own offset", but the record's `at` is a `Z` timestamp. Driven with a forfeit 20 minutes in the past, the banner read "Block forfeited at 06:16" while the clock on the machine read 23:16, seven hours out. The star reveal has it too: clicking the live star printed "A block earned on 2026-08-20: began 06:08 ended 06:33" for a block that ran 23:08 to 23:33. The persona is trying to connect a banner to the two-minute clip they remember watching; a timestamp seven hours away from their memory of it reads as the system talking about something else. {worthwhile}
- [x] (medium) [first-run] `#book-actions` escapes the immersive hide rule through an inline style and lands under the pager pill, cutting six words out of the sentence that explains the page. `body.immersive #view-reading > :not(#reader)...` computes `display: none` for it, but the element carries `style="display:flex; flex-direction:column; gap:6px"` inline, and inline wins. Measured on the live panel in the reader's current failure state: the element renders at (0, 866.7, 640x33.3) reading "Amazon's own reader is drawing this, in a browser you never see, at the page your Kindle synced to. Open the Kindle app instead.", `.reader-pager-overlay` sits over it at (257.7, 845.9, 124.6x44.1), and a per-word range test returns "you never see, at the page" as the words behind the pill. Deleting the inline style alone drops the element to `display: none` and grows `#reader` from 866.7 to 900, the full 100%. This is the pass-1 chrome-eats-the-page item surviving in one element; it stayed invisible to passes 1 to 4 because `#book-actions` is emptied to a zero-height div whenever the reader has nothing to say, and only a live reader state fills it. {worthwhile}
- [x] (low) [forfeited-star] The banner drops the one number this persona came for, and does not say what happens next. The record carries `elapsedMs` and `window.__focus.forfeit` never reads it: driven with `elapsedMs: 1200000`, the rendered sentence was "Block forfeited at 06:16: non-whitelisted video played." and a regex for a duration over the banner's text returned nothing. The user who just lost 20 minutes of credit is told a block ended, not how much of it they had banked, so they cannot tell a forfeit at minute 2 from a forfeit at minute 24. The banner is also silent about the recovery, even though `lib/focus/tracker.js` starts a fresh block on the next clean tick with no action from the user, which is the one reassuring fact available and the cheapest way to keep the sentence from reading as a penalty. {worthwhile}

## Pass 6 - interactive, final convergence (2B.4 / 6.4)

All five pass-5 fixes verified against the live daemon at http://localhost:7420/panel, in a
640x900 headless Chromium driven through the real path, plus the shipped functions run directly.

    Fix 1 (the tracker clock carries the local offset): GET /api/focus answered
      "at": "2026-08-19T23:47:14-07:00". A numeric offset, never `Z`, and its date part is
      today's LOCAL date: the machine clock read Wed Aug 19 23:47:14 PDT 2026, and the same
      instant in UTC is already 2026-08-20. Run against the shipped functions,
      `localISO(19 Aug 2026 23:33:21 local)` is "2026-08-19T23:33:21-07:00" and `localDay`
      of it is "2026-08-19", where `toISOString()` of that same Date is
      "2026-08-20T06:33:21.000Z" and filed the star on the 20th. At a month boundary,
      `localISO(31 Aug 23:50 local)` files on 2026-08-31 where UTC files 2026-09-01. Both
      halves of the pass-5 symptom are gone at the source.
    Fix 2 (the focus block and the in-flight prompts ride the heartbeat): POST /api/panel/ping
      answers {ok, rung, seq, detail, asset, focus, latency}; `focus` carries
      {phase, elapsedMs, blockMs, blockMinutes, lastForfeit, lastStar, breakers} and `latency`
      carries {waiting, lastDelivery}, matching what `applyFocusBeat` reads. Driven through the
      real `beat()`, with the daemon's own ping answer augmented by a forfeit record and two
      waiting sessions (disclosed: the live daemon reports lastForfeit null and nothing in
      flight right now, so those two fields were injected into its real response; every other
      field is the daemon's own): the banner raised itself inside one 1500ms beat with no test
      hook touched, two prompts in flight drove `#latency-chip` to "waited 1:07", and a
      delivery cleared that session and showed "Response landed" while the other kept counting.
      Zero page errors across the whole run.
    Fix 3 (`_wallClock` reads the real local time): a forfeit stamped
      2026-08-19T23:30:42-07:00 rendered "Block forfeited at 23:30" with the machine clock at
      23:50. Pass 5 measured a seven hour error on the same input shape.
    Fix 4 (`#book-actions` no longer escapes the hide rule): computed display is "none" while
      immersive, and `#reader` is 640x900, 100% of both panel dimensions, where pass 5 measured
      866.7 of 900. Still 100% of both at 640x700, 640x560 and 480x900. The element is unharmed
      everywhere it is meant to show: display flex, column, 6px gap, at (14, 802, 612x33) in the
      non-immersive reading view and (16, 205, 608x33) inside the open menu, with
      "Open the Kindle app instead." reachable by Tab.
    Fix 5 (the banner names the minutes lost and the recovery): from a record carrying
      elapsedMs 1200000, "Block forfeited at 23:30: non-whitelisted video played.
      20 minutes lost. A fresh block starts on the next clear check."
    Passes 1 to 4 still holding: `#companions` display none while immersive;
      `.reader-pager-overlay` flex at (257.7, 845.9, 124.6x44.1); `.reader-hint` reading
      "left-arrow right-arrow turn the page"; exactly three focusables in the reading view
      (reader-menu, page-prev-imm, page-next-imm); no rect intersection between the three
      corner surfaces, `#latency-chip` (8, 8, 90.6x22) z 25, `#arrival-note` (108, 8, 107.1x22)
      z 26, `#forfeit-note` (8, 44, 624x55.6) z 27, each returning its own id from
      `document.elementFromPoint` at its centre; four /api/stars calls in one calendar session,
      four 200s, every open asking for today's month (2026-08) and never for a day key;
      "1 star" counted in the header and one `.cal-star` in a 37 cell grid; the reveal landing
      on screen at (16, 401, 608x34.8) and hit-testing to itself; arrow keys inert with either
      overlay open; Escape closing the calendar back to `#open-star-cal` and then the menu back
      to `#reader-menu`; both overlays overflow-y auto with the close control on screen at every
      size tested.
    Star store state, for the record: the single star it holds was awarded by the pre-fix build
      (startedAt "2026-08-20T06:08:21.122Z"), so it still sits on cell 20 and reveals
      "began 06:08 ended 06:33". That is data written before fix 1, not live behaviour; every
      star the running tracker awards from now on carries the local offset, as measured above.
    Considered and not raised: the daemon holds `lastForfeit` for its whole life and never
      clears it, so a panel page load hours later re-raises the banner for an old forfeit
      (measured with a six hour old record: "Block forfeited at 17:50: a blacklisted app came
      to the front. 5 minutes lost."). The banner names its own wall-clock time, dismisses in
      one click and stays dismissed for the life of the page, a daemon restart clears the
      record, and the panel window is long-lived, so page loads are rare. That is below the bar
      the earlier passes set.

One new item. It is not a regression from any of the five fixes, and it is reachable only with
the menu open, which is why the design-only passes did not see it.

- [x] (medium) [operator] The multiplication sign on the open menu's Close button is dead, because the always-on-top menu button covers it. `#reader-menu` is position absolute at (602, 8, 30x30) with z-index 30, while `#reader-menu-overlay` is z-index 29, so the control that dismisses the menu, `#reader-menu-close` at (568.7, 16, 55.3x34.1), loses its top-right 22x22, 25.7% of its area. A per-character range test over the label returns "reader-menu-close" for "C", "l", "o" and "s", and "reader-menu" for "e", the space, and the dismiss glyph itself, so the entire glyph and the last letter of the word belong to the element underneath. `#reader-menu` is bound to `openReaderMenu` with no toggle, so a click there re-opens an already-open menu and changes nothing on screen: measured, clicking (617, 23) left `#reader-menu-overlay` still `.open`, while clicking the visible left of the same button closed it. The operator aiming at the dismiss glyph of a modal, which is where everyone aims, gets a click that does nothing, and a second one if they try the same spot again. Escape and the left 74% of the button still work, so it is a dead target rather than a trap, and the star calendar is unaffected because its overlay is z-index 31 and sits above the menu button. {worthwhile}

## Pass 7 - interactive, final convergence (2B.4 / 6.4)

The pass-6 fix landed. Verified against the live daemon at http://localhost:7420/panel in a
640x900 headless Chromium, driven through the real path (`setView('reading')`, click
`#reader-menu`), with hit-testing that walks up to the nearest `[id]`.

    The fix (`body.immersive #view-reading:has(.reader-menu-overlay.open) .reader-menu`):
      with the menu open, `#reader-menu` computes `display: none` (Playwright agrees the
      element is not visible), where pass 6 measured it at (602, 8, 30x30) z 30 over an
      overlay at 29. A 21x11 grid of 231 sample points spanning the whole Close button,
      `#reader-menu-close` at (568.7, 16, 55.3x34.1), hit-tests to `reader-menu-close` at
      every one of the 231 points, zero misses. The per-character range test now returns
      `reader-menu-close` for all seven characters, "C", "l", "o", "s", "e", the space and
      the dismiss glyph, where pass 6 got `reader-menu` for the last three. Clicking the
      exact pass-6 dead spot (617, 23) closes the menu. So does the button's top-right
      corner. After close the trigger is back at `display: grid`, `aria-expanded` is
      "false", focus is on `#reader-menu`, `#reader` is 640x900, and the menu reopens.
      The same 231-point grid with a forfeit banner up: still zero misses.
    Not broken by the fix: the star calendar opens from the menu, `#cal-close` at
      (568.7, 20, 55.3x34.1) hit-tests to itself at all 231 points of its own grid, a
      click closes it and returns focus to `#open-star-cal` with the menu still open
      beneath, and Escape then closes the menu back to `#reader-menu`. `#reader-menu`
      stays `display: none` for as long as the menu is open, including while the calendar
      is stacked on it, and returns to `display: grid` the moment it closes.
    Passes 1 to 6 still holding: `#reader` at 100% of both dimensions at 640x900, 640x700,
      640x560, 480x900 and 1000x640; the only visible children of `#view-reading` while
      immersive are `#reader`, `#reader-menu`, `.reader-hint` reading "left-arrow
      right-arrow turn the page" and `.reader-pager-overlay` at (257.7, 845.9, 124.6x44.1);
      `#companions` display none while immersive and `<main>` the only visible child of
      `<body>`; tab order in the reading view is exactly reader-menu, page-prev-imm,
      page-next-imm; arrow keys issue nothing with either overlay open; one
      `/api/stars/month?month=2026-08` per open, "1 star" in the header, one `.cal-star`
      on cell 20, the reveal on screen at (16, 401.1, 608x34.8) hit-testing to itself, day
      view titled "Stars on 2026-08-20" counting "1 star". Zero page errors across every run.
    The heartbeat path, driven with the daemon's own POST /api/panel/ping answer
      (disclosed: it really returns {ok, rung, seq, detail, asset, focus, latency} with
      focus {phase, elapsedMs, blockMs, blockMinutes, lastForfeit, lastStar, breakers} and
      latency {waiting, lastDelivery}, but reports lastForfeit null and nothing in flight
      right now, so those two fields were injected into its real response and nothing else
      was): the banner raised itself with no test hook, reading "Block forfeited at 23:46:
      non-whitelisted video played. 18 minutes lost. A fresh block starts on the next clear
      check." with the machine clock at 00:04, so 18 minutes ago exactly. Two prompts in
      flight drove `#latency-chip` to "waited 1:12"; delivering one showed "Response
      landed" while the other kept counting, and the chip cleared when the second landed.
      No rect intersection between `#latency-chip` (8, 8, 90.6x22) z 25, `#arrival-note`
      (108, 8, 107.1x22) z 26 and `#forfeit-note` (8, 44, 624x55.6) z 27, each returning
      its own id from `document.elementFromPoint`, and `#reader` still 100% of both
      dimensions with all three up.
    Star store state, unchanged from pass 6 and still not live behaviour: the single stored
      star was written by the pre-fix build (`startedAt` "2026-08-20T06:08:21.122Z", a Z
      timestamp), so it reveals "began 06:08 ended 06:33" for a block that ran 23:08 to
      23:33 local. The tracker now stamps local offsets (GET /api/focus answered
      "2026-08-20T00:00:54-07:00"), so every star from here carries one. Pass 6 disclosed
      this and judged it below the bar; nothing has changed, and it is not re-raised.

One new item. It is not a regression from the pass-6 fix: the guard it defeats predates that
fix by four passes. It is reachable only by leaving the reading view while the menu is open,
which no earlier pass did.

- [x] (high) [operator] Leaving the reading view with the menu open strands the panel's entire navigation inside the hidden view, and nothing in the panel gets it back. `setView` line 563 reads `if (name !== 'reading' && typeof closeReaderMenu === 'function' && ...) closeReaderMenu();`, but `closeReaderMenu` is declared at line 1805 inside the `window.addEventListener('load', ...)` callback that starts at line 1778, so it is not in `setView`'s scope: measured, `typeof closeReaderMenu` evaluated at `setView`'s scope is "undefined", the guard is dead code, and the menu is never closed on the way out. The eight elements `READER_MENU_DISPLACED` moved into `#reader-menu-slot` stay there, and that slot lives inside `#view-reading`, which `setView` has just switched to `display: none`. Two paths reach it, both real. The operator's own: `#rungs` is one of the displaced elements, so the rung ladder is inside the menu, which is the point of putting it there; opening the menu and pressing "Cards" left `#rungs`, `#footer-bar`, `#companions`, the title block, the progress bar, the pager and the note all parented to `reader-menu-slot` at zero width, the header collapsed from 43px carrying Cards, Book, Queue and To-do to 32px carrying the word "Interstice", `#footer-bar` gone from `<body>`, and zero elements with a `data-view` attribute visible anywhere on the page. The daemon's own: `beat()` calls `setView(d.rung, { fromServer: true })` on a new delivery, so with the menu open a prompt landing does the same thing with no click at all, measured on a real ping answer with the rung moved to `queue_prompt`. It does not heal: five seconds of further heartbeats left `#rungs` in the slot and zero `[data-view]` on screen, and the only way back to the reading view, which is where closing the menu would restore everything, is a rung button that no longer exists. The operator is locked on whatever rung they landed on, with the panel's one navigation surface, its status footer and its setup banner all inside a container the browser is not painting. {worthwhile}

## Pass 8 - interactive, final convergence (2B.4 / 6.4)

The pass-7 fix landed. Verified against the live daemon at http://localhost:7420/panel in a
640x900 headless Chromium, driven through the real path, with hit-testing that walks up to the
nearest `[id]`.

    Path (a), a rung button pressed from inside the open menu: with the menu open,
      `#rungs` is parented to `div#reader-menu-slot`, `#footer-bar` is in the slot at
      0x0 and invisible, `<header>` is 0px tall, and all eight `READER_MENU_DISPLACED`
      ids are in the slot. Clicking `#rungs button[data-view="flashcards"]` from there
      returned `#rungs` to `<header>` (43px tall again), `#footer-bar` to `<body>` at
      (0, 848.9, 640x51.1), full panel width, `#reader-menu-slot` to zero children,
      `.open` off the menu overlay, and four visible `[data-view]` elements reading
      Cards, Book, Queue, To-do. Five further seconds of live heartbeats changed none of
      it. Pass 7 measured zero `[data-view]` visible and the slot still holding all eight.
    Path (b), `setView('flashcards', { fromServer: true })`, which is what `beat()` calls
      on a delivery: identical result from the same starting state. `#rungs` back in
      `<header>`, `#footer-bar` back in `<body>` at (0, 848.9, 640x51.1), slot empty,
      four `[data-view]` visible, `#view-flashcards` the active view. Zero page errors on
      either path.
    Not broken by the fix: the menu opens with the trigger at `display: none` and
      `aria-expanded` "true", focus on `#reader-menu-close`; a 231-point grid over
      `#reader-menu-close` (568.7, 16, 55.3x34.1) hit-tests to itself at every interior
      point; the close click and Escape both restore `#rungs` to `<header>`, put focus
      back on `#reader-menu`, return the trigger to `display: grid` and leave `#reader`
      at 640x900. The star calendar still opens from the menu, issues exactly one
      `GET /api/stars/month?month=2026-08` (200) per open, titles "Stars in 2026-08",
      counts "2 stars" over a 37-cell grid, `#cal-close` hit-tests to itself at all 231
      interior points, Escape closes it back to `#open-star-cal` with the menu still open
      beneath, and a second Escape closes the menu back to `#reader-menu`.
    Passes 1 to 7 still holding: `#reader` at 100% of both dimensions at 640x900, 640x700,
      640x560, 480x900 and 1000x640; the only visible children of `#view-reading` while
      immersive are `#reader`, `#reader-menu`, `.reader-hint` reading "left-arrow
      right-arrow turn the page" at (10, 844.3, 88.4x11.7) and `.reader-pager-overlay`;
      `<main>` the only visible child of `<body>`; tab order in the reading view exactly
      reader-menu, page-prev-imm, page-next-imm; both overlays `overflow-y: auto` with the
      close control on screen at 640x560. Star history is real and now two deep: the
      pre-fix star reveals "A block earned on 2026-08-20: began 06:08 · ended 06:33", and
      a star the running tracker awarded during this pass carries local offsets
      (`startedAt` "2026-08-19T23:44:51-07:00", `endedAt` "2026-08-20T00:09:51-07:00",
      `day` "2026-08-20") and reveals "began 23:44 · ended 00:09". Day view titles
      "Stars on 2026-08-20" and counts "2 stars".
    Forfeit and latency, driven through the real `beat()` with the daemon's own ping answer
      (disclosed: the live daemon reports `focus.lastForfeit` null and `latency.waiting`
      empty right now, so a video forfeit record and two waiting sessions were injected
      into its real response and nothing else was): the banner raised itself inside one
      1500ms beat with no test hook, `role="alert" aria-live="assertive"`, reading "Block
      forfeited at 23:58: non-whitelisted video played. 18 minutes lost. A fresh block
      starts on the next clear check." with the machine clock at 00:16, 18 minutes later
      exactly. All four causes render in plain words. One click on `.fn-dismiss`
      (aria-label "Dismiss") hides it and four further beats leave it hidden; a forfeit
      with a new `at` raises it again. Two prompts in flight drove `#latency-chip` to
      "waited 1:09"; delivering one showed `#arrival-note` "Response landed" at
      (108, 8, 107.1x22) while the chip kept counting the other at "waited 0:22". Zero
      rect intersections between `#latency-chip` (8, 8, 90.6x22) z 25, `#arrival-note`
      z 26 and `#forfeit-note` (8, 44, 624x55.6) z 27, each hit-testing to itself, and
      `#reader` still 900px tall with all three up.
    Considered and not raised: the star that spans midnight reveals "A block earned on
      2026-08-20: began 23:44 · ended 00:09", filed on the local day it ended. Both
      wall-clock times are correct and the spec asks for start and end, so the only cost
      is that the reader has to notice the start belongs to the evening before.

One new item. It is not a regression from the pass-7 fix: that fix closes the reader menu on
the way out of the reading view, and this is the second overlay, which it does not touch.

- [ ] (medium) [operator] Leaving the reading view with the star calendar open leaves the calendar open, and coming back puts a full-screen dialog over the page that no key will close. `setView` line 564 now closes the reader menu, but `#star-cal-overlay` is a second `role="dialog" aria-modal="true"` at z-index 31 and `_closeStarCal` is never published to `window` and never called from `setView`, so the `.open` class survives the view change. The path is the same one pass 7 named: `beat()` calls `setView(d.rung, { fromServer: true })` when a delivery lands, and the calendar is opened from inside the menu, so the star-checker who is glancing at this month when a card arrives gets switched off the reading view with the dialog still armed. Measured: open the calendar, `setView('queue_prompt', { fromServer: true })`, then press Book. `#star-cal-overlay` is back at `display: flex`, 640x900, z 31, over a `#reader` that is still 640x900; a 441-point grid over `#reader` hit-tests to something other than `reader` at 441 of 441 points, 100% covered, so the page is at 0% of both panel dimensions while nominally reading. The pager and the hint are hidden by `body.immersive #view-reading:has(.star-cal-overlay.open)`, arrow keys issue nothing because the page-turn handler reads the same `.star-cal-overlay.open` guard, and `#reader-menu` is painted but hit-tests to `cal-close`. Keyboard recovery is gone entirely: `closeReaderMenu` returned focus to `#reader-menu` while it was inside the hidden view, so `document.activeElement` is `<body>`, and the calendar's only Escape handler is a `keydown` bound to `#star-cal-overlay` itself, which a keypress on `<body>` never reaches. Escape does nothing, Tab moves to `#reader-menu` behind the overlay, and Escape there does nothing either. The one thing that works is a mouse click on `#cal-close` at (568.7, 20, 55.3x34.1), which closes it and restores the page; nothing on screen says so.

## Pass 9 - interactive, final convergence (2B.4 / 6.4)

No new issues found in pass 9. The loop has converged: every worthwhile item from passes 1
through 8 is fixed and verified against the live daemon.

    The pass-8 fix landed. `typeof window.__closeStarCal` and `typeof window.__closeReaderMenu`
      both answer "function" at page scope. Driven through the exact path named: open reading,
      open the menu, open the star calendar, then `setView('flashcards', { fromServer: true })`,
      which is what `beat()` calls on a delivery. Before the call `#star-cal-overlay` is
      `display: flex` 640x900 z 31 with `.open`, `#reader-menu-overlay` is `display: flex`
      640x900 z 29 with `.open`, and `#reader-menu-slot` holds all 8 displaced elements. After
      it both overlays are `display: none` with `.open` gone, the slot holds 0 children,
      `#rungs` is back under `<header>` at 43px, `#footer-bar` is back in `<body>` at
      (0, 848.9, 640x51.1), four `[data-view]` elements read Cards, Book, Queue and To-do, and
      `#view-flashcards` is the active view. Pass 8 measured the calendar still at
      `display: flex` 640x900 z 31 on the way back with no keyboard route out.
    Returning to reading shows the page. `#reader` is 640x900, 100% of both panel dimensions.
      A 21x21 grid of 441 sample points spanning `#reader` lands inside `#reader` at 435 of 441,
      98.6%; the 6 that do not are the floating pager (`page-prev-imm` 1, `page-next-imm` 1) and
      4 points in the hint strip, which is what the pass allows for. Pass 8 measured this same
      grid at 441 of 441 outside `#reader`, 0%. Both overlays read `display: none` and the only
      visible children of `#view-reading` are `#reader`, `#reader-menu`, `.reader-hint` and
      `.reader-pager-overlay`, with `<main>` the only visible child of `<body>`.
    Ordinary open and close, both overlays, unbroken. Menu: trigger goes to `display: none`,
      `aria-expanded` "true", focus to `#reader-menu-close`, and a 441-point grid over that
      button at (568.7, 16, 55.3x34.1) hit-tests to itself at every one of the 441 points, zero
      misses. Calendar: opens from the menu, focus to `#cal-close`, exactly one
      `GET /api/stars/month?month=2026-08` (200) per open, and its own 441-point grid over
      `#cal-close` at (568.7, 20, 55.3x34.1) hit-tests to itself 441 of 441. Escape closes the
      calendar back to `#open-star-cal` with the menu still open beneath, a second Escape closes
      the menu back to `#reader-menu`; the mouse path through `#cal-close` and
      `#reader-menu-close` gives the same two results. Every close puts `#rungs` back under
      `<header>`, empties the slot and leaves `#reader` at 640x900.
    The overlay-surviving-a-state-change family, probed for anything left in it, and there is
      nothing. The calendar opened alone through `window.__stars.open()` with the menu shut also
      closes on `setView('todo', { fromServer: true })`, so the second guard stands on its own
      rather than riding on the first. A heartbeat that bumps `seq` while `rung` is null does
      not disturb the open menu, which is right, and the forced companions reload lands inside
      it at 608px wide with `.show` on, as the `body.immersive .reader-menu-overlay.open
      #companions.show` rule intends. Zero page errors on every run in this pass.
    Spec success conditions, re-measured. Page size: `#reader` is 100% of both dimensions at
      640x900, 640x700, 640x560, 480x900 and 1000x640, and while immersive the count of visible
      `[data-view]` elements is 0, so the whole ladder really is behind the one menu affordance;
      no view scrolls the body horizontally. Stars: month view titles "Stars in 2026-08" and
      counts "2 stars" over a 37-cell grid, day view titles "Stars on 2026-08-20" and counts
      "2 stars", stepping back gives "Stars on 2026-08-19" "0 stars" and "Stars in 2026-07"
      "0 stars" with "No stars earned this month yet.", stepping forward returns to
      "Stars in 2026-08" "2 stars", one month request per step and no phantom. Each star is
      inspectable to wall clock from both views: `#cal-reveal` at (16, 413, 608x35) hit-tests to
      itself and reads "A block earned on 2026-08-20: began 06:08 · ended 06:33." and
      "A block earned on 2026-08-20: began 23:44 · ended 00:09.". Forfeit: the banner raises
      itself inside one 1500ms beat off the real `beat()` with `role="alert"`
      `aria-live="assertive"`, and all four cause values the tracker actually emits render in
      plain words, video as "non-whitelisted video played", app as "a blacklisted app came to
      the front", lock as "the screen locked", manual as "you ended the block", each carrying
      "Block forfeited at 00:09" against a machine clock of 00:27 for an `at` 18 minutes back,
      "18 minutes lost." and "A fresh block starts on the next clear check."; one click on
      `.fn-dismiss` hides it and three further beats leave it hidden. Latency: two sessions in
      flight drove `#latency-chip` to "waited 0:47" at (8, 8, 90.6x22) z 25, delivering one
      showed `#arrival-note` "Response landed" at (108, 8, 107.1x22) z 26 with `role="status"`
      while the chip kept counting the other at "waited 0:24", and delivering the second cleared
      the chip to empty and unshown. Zero rect intersections among `#latency-chip`,
      `#arrival-note` and `#forfeit-note` (8, 44, 624x38.8) z 27, each returning its own id from
      `document.elementFromPoint`, with `#reader` still 640x900 under all three.
    Overlay bounds at the smallest window tried in any pass, 360x500: both overlays compute
      `overflow-y: auto` with height equal to scroll height and their close controls fully on
      screen, so neither traps a reader behind unreachable content.
    Disclosed, and not raised. The forfeit and latency numbers above were driven through the
      real `beat()` against the daemon's own `POST /api/panel/ping` response, with only
      `focus.lastForfeit` and `latency.waiting` / `latency.lastDelivery` overwritten, because
      the live daemon reports `lastForfeit` null and nothing in flight right now. Everything
      else in that response, and every other measurement in this pass, is the daemon's real
      answer. The reader itself could not open a page during this pass: the daemon's headless
      reader browser does not come up on this machine at the moment, so
      `POST /api/reading/view` takes about 20 seconds and answers `ok: false` with "the reader
      browser never opened its debugging port: fetch failed", and the panel prints exactly that
      inside `#reader-over` after showing an animated shimmer skeleton and "opening your book".
      That is a daemon-side condition, not a panel one, the panel names it rather than hiding
      it, and `#reader` stays at 100% of both dimensions throughout, so it is not raised.
    The pre-fix star is still in the store and still reveals "began 06:08 · ended 06:33" for a
      block that ran 23:08 to 23:33 local, because it was written with a `Z` timestamp before
      the tracker started stamping local offsets. Passes 6 and 8 disclosed this and judged it
      below the bar; nothing has changed and it is not re-raised.
