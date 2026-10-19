# Final 200-schema survey

Waves 15/16/18: 100/50/50 applications. All sources were read-only; check ran on owned copies. All 200 exit 0 before and after. No changed security findings or errors, no removed compiler notes, and no new fallthrough/oversized-reservation notes. Finished app schemas contain the branch workarounds; the original-runtime detecting witnesses are recorded separately.

The only final deltas are these 11 source-only N_LOOKUP_FILTERED notes in five applications. Each names the operation, read site and authored authority. These are missing-proof advice, not confirmed application security findings and not a claim that all callers are denied. Optional null may feed a later field/default or business requirement.

| Wave / lane | Mutation | Target | Source | Read authority |
| --- | --- | --- | --- | --- |
| 15 / 010-day2-propane-tank-readings | confirmFill | routes | schema.q:121:7 | `read <- .driver = viewer or exists staff[viewer, role = 'dispatcher']` |
| 15 / 036-day2-jersey-number-requests | assignNow | requests | schema.q:104:11 | `read <- .owner = viewer or exists staff[viewer, role = 'manager'] or viewer = 'service:ops'` |
| 18 / 018-snapback-asbestos-air-clearances | changeBoundary | jobs | schema.q:90:16 | `read <- .contractor = viewer or .monitor = viewer or .owner = viewer or .supervisor = viewer or .designer = viewer or .workerA = viewer or .workerB = viewer` |
| 18 / 018-snapback-asbestos-air-clearances | collectSample | jobs | schema.q:121:16 | `read <- .contractor = viewer or .monitor = viewer or .owner = viewer or .supervisor = viewer or .designer = viewer or .workerA = viewer or .workerB = viewer` |
| 18 / 018-snapback-asbestos-air-clearances | uploadLabResult | jobs | schema.q:130:16 | `read <- .contractor = viewer or .monitor = viewer or .owner = viewer or .supervisor = viewer or .designer = viewer or .workerA = viewer or .workerB = viewer` |
| 18 / 018-snapback-asbestos-air-clearances | uploadLabResult | containments | schema.q:133:17 | `read through .job` |
| 18 / 018-snapback-asbestos-air-clearances | uploadLabResult | containments | schema.q:134:30 | `read through .job` |
| 18 / 018-snapback-asbestos-air-clearances | signClearance | jobs | schema.q:140:16 | `read <- .contractor = viewer or .monitor = viewer or .owner = viewer or .supervisor = viewer or .designer = viewer or .workerA = viewer or .workerB = viewer` |
| 18 / 018-snapback-asbestos-air-clearances | dismantle | jobs | schema.q:156:16 | `read <- .contractor = viewer or .monitor = viewer or .owner = viewer or .supervisor = viewer or .designer = viewer or .workerA = viewer or .workerB = viewer` |
| 18 / 019-snapback-chimney-sweep-reports | fileReport | rentalUnits | schema.q:245:7 | `read <- .landlord = viewer or exists roles[viewer, role = 'master'] or exists assignments[.chimney, viewer]` |
| 18 / 025-snapback-wheelchair-repair-loaners | setStatus | limits | schema.q:240:9 | `read <- .client = viewer or viewer = 'service:operator' or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'manager']` |

Key/guard and helper refinements remove three preliminary warnings (two in wave-16 048 and one in wave-18 041); inherited read-through coverage adds the missing child-side reads in wave-18 018. The initial and final JSON comparisons preserve exact additions; no frozen app was rewritten.

No existing corpus query is missing a return after Quarry implicit-final-expression lowering, so no query signature or authored schema needs migration. The selected compatibility semantics still names genuinely uncovered paths in new/unfinished queries, with explicit []/null repairs.
