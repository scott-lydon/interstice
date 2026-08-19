# Internal consistency finding (8.6)

A cross-read of `README.md`, `docs/GOAL_LOOP.md`, `docs/GOAL_LOOP_STARS_READER_2026-08-17.md`, and
`config/interstice.config.default.json`, against the code this loop added. Each claim checked is
cited; zero contradictions found.

| Claim checked | Where | Verified against | Verdict |
|---|---|---|---|
| "no runtime dependencies" (not "no npm dependencies") | README.md Install | package.json `dependencies: {}`, only `@playwright/test` as a devDependency (S7) | consistent |
| A star = 25 unbroken minutes | GOAL_LOOP settled S1 | `config.focus.blockMinutes` default `25`; `createMachine` uses it | consistent |
| The panel never breaks its own block | GOAL_LOOP settled S4 | `PANEL_APPS` constant in `lib/focus/breakers/frontmost.js`; a test asserts it even when blacklisted | consistent |
| Video detection is browsers only | GOAL_LOOP settled S3 | README "Scope (S3): browsers only" note; `lib/video/probe.js` reads browser tabs only | consistent |
| Break causes are app-frontmost, lock/sleep, non-whitelisted video; NOT idle | GOAL_LOOP settled S2 | three breakers (`frontmost`, `display`, `video`); a test asserts a zero-input 25-minute block still completes (no idle breaker) | consistent |
| Every `focus.*` config key is documented | README focus section | `focus.blockMinutes`, `blacklistApps`, `videoWhitelist`, `videoBreakAfterMs` all appear in README (8.5) | consistent |
| Timestamps stored as ISO 8601 with offset; block credited to completion day | GOAL_LOOP settled S5 | `store.js` writes the ISO strings verbatim; `localDay` slices the date; aggregation test covers month/DST/midnight | consistent |
| New vocabulary maps onto rung/gap/ladder, not a parallel one | GOAL_LOOP methodology + 0.5 | the 0.5 mapping table in the parallel notes | consistent |

No document contradicts another or the code on any claim checked.
