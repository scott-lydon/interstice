# Recurring_goals selection for Interstice

_Generated 2026-08-20 against commit 6fb9a7d. The counts and the exclusion reasons below
describe that tree and are not re-checked as it moves. Regenerate with
`RECURRING_GOALS_ROOT=... TARGET_REPO=... python3 docs/recurring_goals_selection.py`._

Source tree : `Recurring_goals` (from RECURRING_GOALS_ROOT)
Target repo : `interstice` (from TARGET_REPO)
Total rules : 643 across 19 sheets (counted with a CSV reader; `wc -l` overcounts because agent_prompt contains newlines)

**Selected 328 · conditional 18 · excluded 297**

## Probed facts about the target

| fact | value | how |
|---|---|---|
| `claude_design_bundle` | False | probed from the filesystem |
| `gauntlet_assignment` | False | stated: Interstice is a personal tool, not a graded submission |
| `graphified` | False | probed from the filesystem |
| `html` | True | probed from the filesystem |
| `icloud_synced` | False | probed from the filesystem |
| `js` | True | probed from the filesystem |
| `migrations` | False | probed from the filesystem |
| `python` | False | probed from the filesystem |
| `react` | False | probed from the filesystem |
| `server_dir` | False | probed from the filesystem |
| `src_dir` | False | probed from the filesystem |
| `swift` | False | probed from the filesystem |
| `website_index` | False | probed from the filesystem |

## Per sheet

| sheet | rules | include | conditional | exclude |
|---|---:|---:|---:|---:|
| Assignments | 12 | 1 | 0 | 11 |
| Code/JavaScript_TypeScript_Development | 116 | 116 | 0 | 0 |
| Code/Python_Development | 61 | 0 | 0 | 61 |
| Code/React_NextJS_Development | 70 | 20 | 0 | 50 |
| Code/Swift_Development | 133 | 0 | 0 | 133 |
| Code/Testing_and_Coverage | 10 | 6 | 0 | 4 |
| Code/Universal | 18 | 18 | 0 | 0 |
| Deployment | 19 | 3 | 13 | 3 |
| Design/Data_Visualization | 6 | 6 | 0 | 0 |
| Design/Design_Fidelity | 8 | 1 | 2 | 5 |
| Design/Visual_Design | 10 | 4 | 1 | 5 |
| Machine_Safety | 10 | 7 | 0 | 3 |
| Process/Agent_Behavior | 26 | 17 | 0 | 9 |
| Process/Communication | 15 | 0 | 2 | 13 |
| Process/Data_Integrity | 10 | 10 | 0 | 0 |
| Project_Structure | 7 | 7 | 0 | 0 |
| Security_and_Secrets | 5 | 5 | 0 | 0 |
| UX | 95 | 95 | 0 | 0 |
| User_Facing_Copy | 12 | 12 | 0 | 0 |
| **TOTAL** | **643** | **328** | **18** | **297** |

## Exclusions, with the reason for each

| sheet | applies_to | rules dropped | reason |
|---|---|---:|---|
| Code/Swift_Development | `**/*.swift` | 129 | no Swift source in this repo |
| Code/Python_Development | `**/*.py` | 61 | `git ls-files '*.py'` returns five files, every one of them under docs/: this manifest generator and four audit-record scripts. `find lib bin web test scripts .githooks -name '*.py'` returns nothing, so the product itself ships no Python and these rules have no product source to run against. Scoped out deliberately, not absent |
| Code/React_NextJS_Development | `**/*.{ts,tsx,js,jsx}` | 50 | the glob matches this repo's .js files, and most rules on the React/Next sheet presume a React component tree, Server Actions, RSC nesting, or a bundler, none of which this repo has. The plain-JavaScript and plain-web subset of the sheet is restored row by row in ROW_OVERRIDES |
| Process/Agent_Behavior | `every response` | 7 | governs how the agent writes its replies, not anything in the codebase; remains in force continuously and is not a code-audit row |
| Assignments | `assignment repositories` | 5 | Interstice is a personal tool, not a Gauntlet assignment submission |
| Design/Design_Fidelity | `projects with a Claude Design handoff bundle` | 5 | no design/claude-design bundle; the design phase here uses frontend-design and design-reference |
| Process/Communication | `every response` | 5 | governs how the agent writes its replies, not anything in the codebase; remains in force continuously and is not a code-audit row |
| Code/Testing_and_Coverage | `assignment repositories` | 4 | Interstice is a personal tool, not a Gauntlet assignment submission |
| Assignments | `assignment responses` | 2 | Interstice is a personal tool, not a Gauntlet assignment submission |
| Design/Visual_Design | `website/index.html` | 2 | no website/ directory |
| Assignments | `Gauntlet repositories` | 1 | Interstice is a personal tool, not a Gauntlet assignment submission |
| Assignments | `assignment deliverables` | 1 | Interstice is a personal tool, not a Gauntlet assignment submission |
| Assignments | `the Gauntlet portal` | 1 | Interstice is a personal tool, not a Gauntlet assignment submission |
| Assignments | `assignment submissions` | 1 | Interstice is a personal tool, not a Gauntlet assignment submission |
| Code/Swift_Development | `all source files` | 1 | no Swift source in this repo (sheet is Swift-specific) |
| Code/Swift_Development | `server-side Swift (Vapor) **/*.swift` | 1 | no Swift source in this repo |
| Code/Swift_Development | `**/*UITests*/**/*.swift` | 1 | no Swift source in this repo |
| Code/Swift_Development | `new projects and new standalone components` | 1 | no Swift source in this repo |
| Deployment | `src/**` | 1 | no src/ directory |
| Deployment | `**/migrations/**` | 1 | no database, therefore no migrations |
| Deployment | `~/.claude/skills/**, ~/.claude/plugins/**` | 1 | this loop ships no skill or plugin |
| Design/Visual_Design | `website/index.html, architecture diagrams` | 1 | no website/ directory and no architecture diagrams |
| Design/Visual_Design | `all Mermaid diagrams` | 1 | no Mermaid diagrams in this repo |
| Design/Visual_Design | `ARCHITECTURE.md, website/index.html` | 1 | neither file exists |
| Machine_Safety | `new and moved projects` | 1 | Interstice already exists at its final location |
| Machine_Safety | `iCloud-managed paths` | 1 | ~/Developer is not iCloud-synced |
| Machine_Safety | `graphified projects` | 1 | no .graphify directory |
| Process/Agent_Behavior | `every recommendation` | 1 | governs how the agent writes its replies, not anything in the codebase; remains in force continuously and is not a code-audit row |
| Process/Agent_Behavior | `every session that creates a skill` | 1 | this loop creates no skill |
| Process/Communication | `every response mentioning the codebase` | 1 | governs how the agent writes its replies, not anything in the codebase; remains in force continuously and is not a code-audit row |
| Process/Communication | `every response that creates content` | 1 | governs how the agent writes its replies, not anything in the codebase; remains in force continuously and is not a code-audit row |
| Process/Communication | `every explanatory response` | 1 | governs how the agent writes its replies, not anything in the codebase; remains in force continuously and is not a code-audit row |
| Process/Communication | `every re-explanation` | 1 | governs how the agent writes its replies, not anything in the codebase; remains in force continuously and is not a code-audit row |
| Process/Communication | `every health-advice response` | 1 | this loop produces no health advice |
| Process/Communication | `App Store rejection responses` | 1 | Interstice is not shipped through the App Store |
| Process/Communication | `spoken deliverables` | 1 | this loop produces no spoken deliverable |
| Process/Communication | `every response with timing` | 1 | governs how the agent writes its replies, not anything in the codebase; remains in force continuously and is not a code-audit row |

## Conditional rules (each worker must record how it resolved)

| sheet | applies_to | rules | precondition |
|---|---|---:|---|
| Deployment | `the deployed system` | 13 | Interstice 'deploys' as a macOS LaunchAgent on one machine, not a server; each row must record whether its notion of deployment maps onto a LaunchAgent |
| Process/Communication | `every guide` | 2 | the closing block produces a manual verification checklist, which is a guide; applies to that artifact only |
| Design/Design_Fidelity | `projects with a Claude Design handoff bundle` | 1 | applies if docs/design-immersive-reading.html is treated as the canonical design artifact; record whether the panel drifted from it |
| Design/Design_Fidelity | `projects with a Claude Design handoff bundle` | 1 | same precondition as DF-005: does a canonical design artifact exist here |
| Design/Visual_Design | `design tokens` | 1 | applies only if phase 2 introduces a token layer; record which way it resolved |

## Row ids routed to workers (346: every included row plus every conditional one)

- **Assignments** (1): AS-007
- **Code/JavaScript_TypeScript_Development** (116): TS-001, TS-002, TS-003, TS-004, TS-005, TS-006, TS-007, TS-008, TS-009, TS-010, TS-011, TS-012, TS-013, TS-014, TS-015, TS-016, TS-017, TS-018, TS-019, TS-020, TS-021, TS-022, TS-023, TS-024, TS-025, TS-026, TS-027, TS-028, TS-029, TS-030, TS-031, TS-032, TS-033, TS-034, TS-035, TS-036, TS-037, TS-038, TS-039, TS-040, TS-041, TS-042, TS-043, TS-044, TS-045, TS-046, TS-047, TS-048, TS-049, TS-050, TS-051, TS-052, TS-053, TS-054, TS-055, TS-056, TS-057, TS-058, TS-059, TS-060, TS-061, TS-062, TS-063, TS-064, TS-065, TS-066, TS-067, TS-068, TS-069, TS-070, TS-071, TS-072, TS-073, TS-074, TS-075, TS-076, TS-077, TS-078, TS-079, TS-080, TS-081, TS-082, TS-083, TS-084, TS-085, TS-086, TS-087, TS-088, TS-089, TS-090, TS-091, TS-092, TS-093, TS-094, TS-095, TS-096, TS-097, TS-098, TS-099, TS-100, TS-101, TS-102, TS-103, TS-104, TS-105, TS-106, TS-107, TS-108, TS-109, TS-110, TS-111, TS-112, TS-113, TS-114, TS-PP-001, TS-PP-002
- **Code/React_NextJS_Development** (20): RN-ASYNC-DEPENDENCIES, RN-ASYNC-PARALLEL, RN-CLIENT-LOCALSTORAGE-SCHEMA, RN-JS-BATCH-DOM-CSS, RN-JS-CACHE-FUNCTION-RESULTS, RN-JS-CACHE-PROPERTY-ACCESS, RN-JS-CACHE-STORAGE, RN-JS-COMBINE-ITERATIONS, RN-JS-EARLY-EXIT, RN-JS-FLATMAP-FILTER, RN-JS-INDEX-MAPS, RN-JS-LENGTH-CHECK-FIRST, RN-JS-MIN-MAX-LOOP, RN-JS-REQUEST-IDLE-CALLBACK, RN-JS-SET-MAP-LOOKUPS, RN-RENDERING-ANIMATE-SVG-WRAPPER, RN-RENDERING-CONTENT-VISIBILITY, RN-RENDERING-SCRIPT-DEFER-ASYNC, RN-RENDERING-SVG-PRECISION, RN-SERVER-HOIST-STATIC-IO
- **Code/Testing_and_Coverage** (6): TC-005, TC-006, TC-007, TC-008, TC-009, TC-010
- **Code/Universal** (18): UC-CMT-001, UC-CMT-002, UC-CUPID-001, UC-CUPID-002, UC-CUPID-003, UC-CUPID-004, UC-CUPID-005, UC-DEAD-001, UC-ENC-001, UC-ERR-001, UC-ERR-002, UC-MOD-001, UC-NUM-001, UC-PRIN-001, UC-PRIN-002, UC-PRIN-003, UC-PRIN-004, UC-PRIN-005
- **Deployment** (16): DEP-001, DEP-002, DEP-003, DEP-005, DEP-006, DEP-007, DEP-008, DEP-010, DEP-011, DEP-013, DEP-014, DEP-015, DEP-016, DEP-017, DEP-018, DEP-019
- **Design/Data_Visualization** (6): DV-001, DV-002, DV-003, DV-004, DV-005, DV-006
- **Design/Design_Fidelity** (3): DF-005, DF-006, DF-008
- **Design/Visual_Design** (5): VD-006, VD-007, VD-008, VD-009, VD-010
- **Machine_Safety** (7): MS-001, MS-002, MS-003, MS-004, MS-005, MS-006, MS-007
- **Process/Agent_Behavior** (17): AB-004, AB-005, AB-006, AB-007, AB-008, AB-009, AB-010, AB-011, AB-012, AB-013, AB-014, AB-015, AB-016, AB-017, AB-022, AB-023, AB-024
- **Process/Communication** (2): CM-009, CM-010
- **Process/Data_Integrity** (10): DI-001, DI-002, DI-003, DI-004, DI-005, DI-006, DI-007, DI-008, DI-009, DI-010
- **Project_Structure** (7): PS-001, PS-002, PS-003, PS-004, PS-005, PS-006, PS-007
- **Security_and_Secrets** (5): SEC-001, SEC-002, SEC-003, SEC-004, SEC-005
- **UX** (95): UX-A11Y-001, UX-A11Y-002, UX-A11Y-003, UX-A11Y-004, UX-A11Y-005, UX-A11Y-006, UX-A11Y-007, UX-A11Y-008, UX-A11Y-009, UX-A11Y-010, UX-ANIM-001, UX-ANIM-002, UX-ANIM-003, UX-ANIM-004, UX-ANIM-005, UX-ANIM-006, UX-ANTI-001, UX-ANTI-002, UX-ANTI-003, UX-CONT-001, UX-CONT-002, UX-CONT-003, UX-CONT-004, UX-COPY-001, UX-COPY-002, UX-COPY-003, UX-COPY-004, UX-COPY-005, UX-COPY-006, UX-COPY-007, UX-COPY-008, UX-FOCUS-001, UX-FOCUS-002, UX-FOCUS-003, UX-FOCUS-004, UX-FORM-001, UX-FORM-002, UX-FORM-003, UX-FORM-004, UX-FORM-005, UX-FORM-006, UX-FORM-007, UX-FORM-008, UX-FORM-009, UX-FORM-010, UX-FORM-011, UX-HOVER-001, UX-HOVER-002, UX-HYD-001, UX-HYD-002, UX-HYD-003, UX-I18N-001, UX-I18N-002, UX-I18N-003, UX-I18N-004, UX-IMG-001, UX-IMG-002, UX-IMG-003, UX-NAV-001, UX-NAV-002, UX-NAV-003, UX-NAV-004, UX-PERF-001, UX-PERF-002, UX-PERF-003, UX-PERF-004, UX-PERF-005, UX-PERF-006, UX-SAFE-001, UX-SAFE-002, UX-SAFE-003, UX-SL-001, UX-SL-002, UX-SL-003, UX-SL-004, UX-SL-005, UX-SL-006, UX-SL-007, UX-SL-008, UX-SL-009, UX-THEME-001, UX-THEME-002, UX-THEME-003, UX-THEME-004, UX-TOUCH-001, UX-TOUCH-002, UX-TOUCH-003, UX-TOUCH-004, UX-TOUCH-005, UX-TYPO-001, UX-TYPO-002, UX-TYPO-003, UX-TYPO-004, UX-TYPO-005, UX-TYPO-006
- **User_Facing_Copy** (12): UFC-001, UFC-002, UFC-003, UFC-004, UFC-005, UFC-006, UFC-007, UFC-008, UFC-009, UFC-010, UFC-011, UFC-012
