# 9.2 Professionalism scan

**Method deviation, stated up front.** The item asks for an agent with a new context. This session
runs under a standing instruction not to spawn agents, so the scan was done directly. The mechanical
results are unaffected; the judgement half is weaker than an independent reader would be.

## Scope, and one correction to how it was measured

A first pass walked every `.md`, `.html`, `.txt` and `.json` in the tree: 804 files, and it reported
24 self-praise hits, 682 placeholder hits and 2,429 dash-punctuation hits. **Every one of those
headline numbers was wrong**, because the walk included `logs/reader-profile/ZxcvbnData/` and
`ActorSafetyLists/`, which are downloaded password-strength wordlists and safety corpora. A wordlist
containing the token `seamless` is not a marketing boast, and reporting it would be inventing an
offense to look productive.

Rescoped to AUTHORED markdown and HTML, excluding vendored data, logs and caches: **19 files**.

## Results on authored content

| Class | Count |
|---|---:|
| stale boasts (`completed in N days`, `in just N`) | **0** |
| self-praise (`blazing fast`, `world class`, `bullet proof`) | **0** |
| placeholder copy (`lorem ipsum`, `coming soon`, `dummy data`) | **0** |
| dated claims (`currently N`, `as of today`) | **0** |
| open `TODO`/`FIXME`/`XXX` | **1**, in the goal loop file itself |

The class of defect this item names, a README that brags about a two-day build and goes stale the
moment work continues, does not appear anywhere. `README.md` makes no claim about duration, effort or
completeness.

## Findings fixed

**Dash punctuation, 6 occurrences in documentation.** Every user-facing surface was already clean:
`README.md`, `web/panel.html`, `web/debug.html`, `web/dashboard.html`, `docs/design-brief.html` and
`docs/design-immersive-reading.html` all carry **zero**. The hits were in two documentation files:

- `docs/FOCUS_MODULE_CONTRACTS.md`, 5, all in headings such as
  `## lib/focus/store.js — durable persistence`. Rewritten with a comma or a colon.
- `docs/audit/CONDITIONAL_RESOLUTIONS.md`, 1, inside a parenthetical. Rewritten with a comma.

Authored documentation excluding the goal loop now carries **0**.

## Not fixed, and why

`docs/GOAL_LOOP_STARS_READER_2026-08-17.md` carries 63 dashes and the single `TODO`. It is the
operator's own working checklist rather than outward-facing content, and this loop's rules permit
editing it only to check off completed work. Recorded rather than silently rewritten.

## Second pass

Re-scanned after the fixes. Zero findings in every class across authored content, excluding the goal
loop for the reason above.
