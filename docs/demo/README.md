# Demonstration recording

`interstice-demo.mp4`, 640x900, recorded against the running daemon. `frames/` holds one still per
marked moment, and `index.json` carries the same marks as data.

Nothing here is drawn for the camera. The stars are the ones the tracker actually earned on 2026-08-20, the
forfeit is a record the real video breaker produced against a real browser playing a real video
file, and the latency cycle runs through the panel's own latency surface.

| at | what the spec asks for | what the recording shows |
|---|---|---|
| 5.5s | 2. the reading view fills the panel | `#reader` measured at 640x900 of a 640x900 panel |
| 10.7s | 2. the menu opened | the one menu, holding every displaced control |
| 13.2s | 2. and closed | the page restored |
| 17.5s | 4. the star calendar, month view | "Stars in 2026-08", 12 stars, all earned on 2026-08-20 by the running daemon |
| 22.6s | 4. a star activated to reveal its times | "A block earned on 2026-08-20: began 06:41 · ended 07:06." |
| 28.1s | 4. day view | "Stars on 2026-08-20", 12 stars |
| 37.6s | 6. a prompt submitted, the indicator ticking | "your agent: 0:04" |
| 41.7s | 6. still ticking | "your agent: 0:08" |
| 43.7s | 6. the response arriving, the indicator clearing, the arrival raising its own notice | chip cleared, arrival notice shown |
| 51.2s | 5. video forfeiting a block, with the reason visible | "Block forfeited at 07:51: non-whitelisted video played. 20 minutes lost." |

## What is not in it, and why

**Item 1, a cold start opening a real book at the synced page, is absent.** The reader itself now
works: it launches, renders, and returns a real 960x1212 frame. That frame is Amazon's sign-in
page, because the session carried into `logs/reader-profile` has expired. Signing in again needs
the account holder, so this one is not something the recording can supply.

**Item 5's whitelisted half is shown by result rather than on camera.** The whitelist decision is
made before anything reaches the panel, so a video that does not forfeit produces no visible event
by design. Both halves are exercised against a real browser in `test/video-breaker.pw.mjs`, and the
run that produced the forfeit record here first checked the same playing video against a whitelist
containing its host and got no break.

**Item 3, a block completing on camera, is shown by its result rather than its passage.** A block
is 25 minutes and the recording is under a minute. What the calendar shows at 17.5s and 22.6s are
twelve real blocks the daemon filed under 2026-08-20, eleven of them 25 minutes apart to the
second. The first is the pre-`14520ee` UTC record, which really ran 23:08 to 23:33 on 2026-08-19
and is filed a day late for exactly the reason `docs/BUG_ISSUE_PREVENTION.md` records. With their
real start and end times legible when a star is activated.
