# Recurring goals audit, loop 9, run 2026-08-21

One agent per rule row, seventeen sheets, each agent reading only its own row out of the
spreadsheet and auditing only the targets its RG item names. Every entry below is a real return
from a real agent; no row is filled by inference.

| Sheet | Rows | Findings | Pass | Not applicable | Unreturned |
|---|---:|---:|---:|---:|---:|
| `Assignments` | 12 | 3 | 5 | 4 | 0 |
| `Code__JavaScript_TypeScript_Development` | 116 | 38 | 48 | 30 | 0 |
| `Code__Swift_Development` | 133 | 47 | 76 | 10 | 0 |
| `Code__Testing_and_Coverage` | 10 | 7 | 1 | 2 | 0 |
| `Code__Universal` | 18 | 10 | 8 | 0 | 0 |
| `Deployment` | 19 | 7 | 1 | 11 | 0 |
| `Design__Data_Visualization` | 6 | 1 | 0 | 5 | 0 |
| `Design__Design_Fidelity` | 8 | 0 | 2 | 6 | 0 |
| `Design__Visual_Design` | 10 | 2 | 2 | 6 | 0 |
| `Machine_Safety` | 10 | 4 | 3 | 3 | 0 |
| `Process__Agent_Behavior` | 26 | 9 | 11 | 6 | 0 |
| `Process__Communication` | 15 | 7 | 3 | 5 | 0 |
| `Process__Data_Integrity` | 10 | 2 | 4 | 4 | 0 |
| `Project_Structure` | 7 | 6 | 1 | 0 | 0 |
| `Security_and_Secrets` | 5 | 2 | 3 | 0 | 0 |
| `UX` | 95 | 41 | 41 | 13 | 0 |
| `User_Facing_Copy` | 12 | 9 | 3 | 0 | 0 |
| **Total** | **512** | **195** | **212** | **105** | **0** |

## On the three statuses

The RG items ask that every entry be "either a finding with a file and line or an explicit pass".
Three statuses are used rather than two, and the third is named here rather than folded quietly
into one of the others. `not_applicable` means the rule addresses a language, framework or
artifact that does not exist in the targets: React rules against a SwiftUI screen, `use server`
rules against a Vapor handler. Each one says which. It is an explicit non-finding, which is what
the verify is protecting against, but it is not a pass and is not counted as one.

Every `finding` carries a file path and a 1-indexed line, checked mechanically rather than by
reading: zero findings across all seventeen sheets are missing either.

## Unreturned rows, and what was done about them

Two rows of `Code/JavaScript_TypeScript_Development`, `TS-100` and `TS-111`, came back empty on
the first run. They were re-run rather than counted, because an agent that did not answer is not
evidence of a pass, and the placeholder the harness writes for them says so in those words. Both
returned on the re-run and their entries are the re-run results, marked `rerun: true`.

The count that matters is the last column: it is zero for every sheet, which is the only state in
which the row counts above can be read as coverage.
