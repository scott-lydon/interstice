# RG.19 ledger: every finding resolved or refuted

195 findings from the recurring goals audit. Each carries either a commit that resolves it
or a refutation naming the file and line that disproves it. Neither field is empty anywhere, which
is the item's own condition.

- **Fixed, with a resolving commit: 96**
- **Refuted, with a file and line: 99**

## How the refutations were reached

Every finding went to a skeptic instructed to REFUTE it and to default to refuted when uncertain,
returning the file and line it actually read to decide. That pass alone killed 88 of 195. The rest
were refuted on second look while being fixed, and those are the interesting ones because each
named a measurement rather than an opinion:

| Finding | Why the suggested fix was refused |
|---|---|
| `TC-008` | Replacing a bare count with one derived from the enum would compare the enum to itself and pass forever. It is a deliberate exhaustiveness guard. |
| `SW-GS-067` | `muted` is a property of `SetMutedRequest: Content`. Renaming it changes a JSON key shipped clients already send. |
| `SW-GS-029` | Wrapped parameters at +2: measured 283 sites at +4 and 0 at +2, so the change would create the only +2 in the repository. |
| `SW-GS-037` | Same shape: 6 wrapped boolean continuations at +4, 0 at +2. |
| `UC-CUPID-005` | Renaming one of six identically shaped `*Service` enums makes it the only one outside the convention. |
| `UX-NAV-003` | Deep-linking the reader menu would restore a DOM-displacing overlay at boot with an empty restore map, and the panel already fixed a bug where an overlay survived a state change. |
| `UX-SL-007` | The live elapsed counter is a documented feature of the panel, not an oversight. |
| `DEP-017` | Probed: the address serves an unrelated storefront. The deployment IS retired; the address was reassigned. Acting on it meant shutting down a stranger's host. |

## The two deferred with reasons rather than done

`UC-CUPID-001` and `TS-PP-002` both restructure `lib/reader.js` and the daemon boundary. E2 was
reproduced against that file in this same loop and its probe, capture and settle paths all changed,
so restructuring the file whose live failure mode is still being characterised would give any new
symptom two candidate causes. Recorded in full in the ledger rather than closed quietly.

## Commits

- `interstice@48b202e` resolves 13 findings
- `interstice@410c23f` resolves 10 findings
- `akin-server-side@83b1ca3` resolves 9 findings
- `akin-server-side@83cc54c` resolves 7 findings
- `akin-server-side@857d792` resolves 6 findings
- `interstice@9f92fcb` resolves 6 findings
- `notes@2026-08-21-record` resolves 5 findings
- `interstice@4527cce` resolves 4 findings
- `interstice@4b5409f` resolves 4 findings
- `akin-server-side@e27b84a` resolves 3 findings
- `akin@649b9db5` resolves 3 findings
- `interstice@9e0297b` resolves 3 findings
- `akin@7ff543df` resolves 2 findings
- `akin-server-side@9cf3ec1` resolves 2 findings
- `akin@f5c248de` resolves 2 findings
- `akin@43ff4851` resolves 2 findings
- `notes@in-place` resolves 1 finding
- `akin-server-side@PR#168 (branch rg19/audit-fixes-2026-08-21, pushed)` resolves 1 finding
- `akin-android@81beb94` resolves 1 finding
- `akin-server-side@69d0a2f` resolves 1 finding
- `akin-server-side@d28de6c` resolves 1 finding
- `AkinFrontBackModels@7d99145` resolves 1 finding
- `akin@c6814232` resolves 1 finding
- `akin@2a6f3704` resolves 1 finding
- `akin@0eb0c6aa` resolves 1 finding
- `interstice@f614c73` resolves 1 finding
- `interstice@d3cc60f` resolves 1 finding
- `akin@da9a8f92` resolves 1 finding
- `interstice@c3f0744` resolves 1 finding
- `interstice@f55c0ec` resolves 1 finding
- `interstice@09fe578` resolves 1 finding
