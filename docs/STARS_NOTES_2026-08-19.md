# Stars reader loop — parallel notes (2026-08-19)

## 0.0d — CLAUDE.md
Created `/Users/scottlydon/Developer/interstice/CLAUDE.md`: references the goal loop, the
predecessor spec, and the config as the sources of truth, and carries the environment PATH note.
It does not duplicate the settled-decision text (the phrase "25 unbroken minutes" appears only in
the goal loop, not in CLAUDE.md), so the two cannot drift.

## 0.3 — Deployment asymmetry
`git rev-list --left-right --count origin/main...HEAD` = `0  5`. HEAD is 0 behind and 5 ahead of
origin/main, so the working tree is NOT behind the deploy branch. No merge needed before diagnosis.

## Status of the rest, stated honestly
The core of this loop (Phase 1: fix the book-loading failure) is gated on a live run of the Kindle
reading rung, which authenticates against Amazon's web reader through Chrome + CDP against the
carried session in `logs/reader-profile`. Items 1.1 (capture the failure verbatim from a cold
start), 1.2 (classify it), and 1.7 (three cold-start proofs) cannot be produced without driving
that live reader, which needs either a valid carried Amazon session or a fresh sign-in (0.2 grant).

There is also pre-existing uncommitted work across exactly the file set Phases 1 and 2 touch
(`lib/reader.js`, `lib/ocr.js`, `lib/panel.js`, `lib/server.js`, the two reader tests, config, and
`web/panel.html`), which 0.3b requires be reconciled — diff preserved, each hunk classified,
finished parts committed, scaffolding parked, tree clean — BEFORE the 0.4 baseline. That is
delicate work on someone else's 631-line diff and should not be rushed as a side effect.

## 0.3b.2 — classification of the pre-existing uncommitted work
Baseline sanity: `npm test` on the dirty tree = 223 pass, 0 fail, so the work is sound.

| File | Bucket | Deciding hunk |
|---|---|---|
| hooks/on-stop.sh, hooks/on-submit.sh | (a) finished | BSD `date +%s%3N` emitted a literal "3N", logging 6111 events as invalid JSON; replaced with a python millisecond clock. |
| README.md, package.json, package-lock.json | (a) finished | Adds `@playwright/test` devDependency and rewrites the README "no npm dependencies" line to "no runtime dependencies" (S7 / 0.0b / 0.0c). |
| config/interstice.config.default.json, lib/panel.js | (a) finished | Panel default grows 440x620 -> 640x900 so the reading page is something to settle into (toward Phase 2). |
| lib/ocr.js, test/ocr.test.js | (a) finished, unrelated to book loading | A tall mid-sentence line ("...tractable.114 This works") was mis-set as a heading; now a heading may only begin after a finished line and never in lower case. |
| lib/reader.js, lib/server.js, web/panel.html, test/reader.test.js, test/reader-shelf.test.js | (b) the Phase 1 book-loading fix | Detects Amazon's "Oops... Something Went Wrong" page, and `clearSiteData()` drops the stale device registration (the getDeviceToken 403 cause) while keeping cookies; `retryBook()` reopens through it. This IS the root-cause fix Phase 1.2/1.4 call for. |
| docs/GOAL_LOOP_STARS_READER_2026-08-17.md | (a) finished | Only RULE-permitted edits: box-ticks (0.0a/0.0b/0.0d/0.3) and the one parallel-notes link. |

No bucket (c) scaffolding and no bucket (d) unrelated-to-park: every hunk is a finished change or the
substantial Phase 1 fix. Nothing is parked or discarded.
