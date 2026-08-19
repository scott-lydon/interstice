# interstice — session constraints

This repo is under an active goal loop. Before changing anything, read the loop and its
settled decisions; do not re-derive or re-ask what they already resolve.

- **Goal loop:** `docs/GOAL_LOOP_STARS_READER_2026-08-17.md`. Its RULE block is binding: the
  only edits permitted to that file are ticking completed boxes and appending one parallel-notes
  link. Every item there carries a machine-runnable verify.
- **Predecessor spec and vocabulary:** `docs/GOAL_LOOP.md` and `README.md`. Match the existing
  vocabulary (rung, gap, ladder, actuator, companion); do not invent a parallel one.
- **Config:** `config/interstice.config.default.json` is the source of truth for tunables.

The loop's "Settled decisions" table is the single source of truth for the focus, star, break,
and whitelist rules. Do not copy those decisions here; read them there so the two cannot drift.
The one-line reminders that matter most for not breaking the design:

- The focus and break rules live only in the goal loop's settled-decisions table. Read them there.
- The Interstice panel and its headless reader profile never break their own focus block.
- The reader's failure paths must throw specific, remedy-bearing errors, not bare `throw new Error`.

Environment: `node` is at `/opt/homebrew/bin/node`; a non-login shell will not see it, so export
`/opt/homebrew/bin` on PATH in any spawned shell before running `npm test` or `bin/interstice.js`.
