# Round 4 failure inventory

All unexpected test failures below are **ours**. None is excused as baseline or
environmental. The pre-fix baseline is our own round-3 implementation; its six
expected disclosure failures are counterfactual evidence, not a baseline waiver.
The machine-readable inventory lists every failing test name, including every
generated seed, with its original log in [failures.json](./failures.json).

| Log | Classification and disposition |
| --- | --- |
| `baseline-ephemeral.log.gz` | **Ours, expected counterfactual:** all six High regressions fail on the unmodified round-3 client (withdrawal and buffered direct reply, on online/process/wasm). |
| `ephemeral-first.log.gz` | **Ours:** wasm buffered-direct case passes disclosure checks but times out recovering the current epoch. Matching ephemeral data was not reconciled across retention policies. Fixed in `local-query.ts`; final host cases pass. |
| `ephemeral-second.log.gz` | **Ours:** the same recovery defect in process withdrawal and wasm withdrawal. Both pass after the reconciliation fix. These red reruns remain recorded as red. |
| `rust-census.log.gz` | **Ours, fixture:** `row_keyed_view_census` received `E_PREDICT` because the device had not completed acquisition. Apply the server's real empty acquisition snapshot first. All five Rust census tests pass. |
| `mutant-query-evidence.log.gz` | **Ours, expected counterfactual:** removing accepted-query propagation fails 21 generated ephemeral histories. |
| `mutant-dependency-floor-model.log.gz` | **Ours, expected counterfactual:** removing the dependency floor comparison fails 12 generated histories. |
| `mutant-dependency-floor-http.log.gz` | **Ours, expected counterfactual:** that same mutation fails delayed ownerless replies on all three hosts. |
| `mutant-poll-floor.log.gz` | **Ours, expected counterfactual:** removing change-poll propagation fails `withheld epochs do not advance floors and changes fence ownerless replies`. |
| `mutant-final-publication.log.gz` | **Ours, expected counterfactual:** replacing the final epoch-floor check with revision-only currentness fails both process/wasm publication-continuation cases. |
| `mutant-row-key.log.gz` | **Ours, expected counterfactual:** removing the row-key edge fails `row_keyed_view_census` and `row_view_inherited_member_census` at the compiler-certificate assertions. Source restored; complete census rerun passes. |

Operational corrections, also ours: orientation included guessed LLP/helper/
manual paths and a guide-test glob that did not exist; resolved paths were then
read. One multi-file patch missed the manual's exact context (`is needed`);
the tool applied nothing, and the corrected patch succeeded. No source or
evidence was lost. These are not product-test exemptions.

The supervisor requested no `scripts/test.sh` run. The unavailable Linux iOS
simulator remains a coverage limit, not a newly attempted or failed test.
