# QX failure ledger

No failures are omitted or reclassified as passes. A successful follow-up does
not change the result of an earlier run. Only the one requested full run is used; fixes receive affected checks. "Ours" includes temporary
implementation, test and measurement-harness mistakes. Intentional baseline
controls are separated from current-source qualification.

## Requested full suite

Exact summary: `== 1 failure(s) in 1369 s`, stage `cargo test`, exit 1.
Run once. Rust: 4,368 passed, three failed, 33 ignored. Client pool: 5,314
passed, zero failed, ten skipped. Serial models: 79 passed, zero failed.
Fixture wrappers: nine passed. Full-run failures: ours 3; baseline 0;
environmental 0.

| Full-suite test | Attribution | Final disposition |
|---|---|---|
| `snapback4-device::readauth::census::authoring_census` | Ours | New compiled membership-path example adds exactly two census entries. Reviewed the private write against the new device lifecycle tests; updated the frozen corpus. Full readauth target then passes 81/81. |
| `snapback4-device::row_view_expiry::inherited_expiry_replay_memory` | Ours | Baseline isolated checkout passes. Public whole-table absence must retain its old proof after parent expiry; fixed. All expiry cases pass 10/10. |
| `snapback4-device::row_view_expiry::inherited_expiry_replay_sqlite` | Ours | Same regression and correction as memory. |

These are three individual test failures in one script stage (`cargo test`).
The first full run remains red; affected fixes do not rewrite that result.
There were no baseline or environmental failures in that run. Expected
`E_AUTH: refused` model fault-injection messages are not failed tests.

## Detecting and superseded affected runs

| Evidence | Failure(s) | Attribution / disposition |
|---|---|---|
| `initial-lang.log` | Rust E0433: `super::through` resolves inside the write module, not engine | Ours. Use `crate::engine::through`; compilation then advances. |
| `initial-lang-2.log` | Rust E0502: mutate the table map while parent info remains borrowed | Ours. Resolve sync paths after finishing immutable parent inspection. |
| `membership-paths-1.log` | `generated_paths_have_identical_schema_programs_and_residency`, `explicit_through_can_name_its_authored_sync_path`, `path_refusals_are_targeted_and_repairs_compile` | Ours. Explicit sync's column validation omitted already-validated captured fields; include captures. |
| `membership-paths-2.log` | First two tests above | Ours. Runtime data matched but explicit paths omitted the inferred-residency flag; canonicalize that metadata for captured audiences. |
| `membership-paths-3.log`, `membership-paths-4.log` | `generated_paths_have_identical_schema_programs_and_residency` | Ours. Repeated same residency mismatch while adding focused diff output; fixed by the same canonicalization. Run 3 followed a failed edit invocation using the wrong cwd. |
| `device-1.log` | Seven compile errors: nonexistent `WriteOutcome`, unconstrained row collection type, wrong `wire::from_json` signature and resulting wrong map value, three wrong `Device::settle` calls | Ours, test implementation. Use `MutationOutcome`, typed rows/arguments and existing two-argument settle API. |
| `device-2.log` | Four remaining compile errors: collection type and three settle calls | Ours, same test corrections. `device-3.log` then passes all four tests. |
| `lang-guide-1.log` | `durable_schema_and_types_keep_base_bytes` | Ours. Emitted TypeScript legitimately changes `put` from never to eligible. Narrow normalization preserves all other historical schema/type bytes. |
| `lang-guide-2.log` | `every_card_compiles_clean`; `familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block` | Ours. The new language block changes 9 to 10 blocks; added prose exceeded the existing 30% reduction target. Update the explicit block count, shorten repeated prose, retain all original compiled blocks and the unchanged word target. |
| `lang-guide-3.log` | `familiar::every_moved_fact_has_its_why_or_details_home` (`language-01`) | Ours. The wording inventory must match the equivalent shortened details. Four fact excerpts updated; no fact count or guard relaxed. `lang-guide-4.log` passes all 105 guide tests. |
| `affected-check-1.log` | `first_paste::failing_check_keeps_the_terse_prediction_reason` | Ours. The blanket upsert prohibition is gone; the test now exercises the remaining child-horizon insert limitation. |
| `check-final.log` | Same terse-summary test; `first_paste::membership_paths_keep_check_residency_output` | Ours. Plain and verbose summaries have different wording; compare the common insert-arm warning. CLI comparison included elapsed milliseconds and mismatched prior-check history. |
| `check-first-paste-final.log` | `first_paste::membership_paths_keep_check_residency_output` | Ours, harness. One variant inherited the previous generated schema's horizon-change note while the second inherited its equivalent schema. Use equivalent fresh projects, excluding only elapsed milliseconds. Final 7/7. |
| `device-tiers-2.log` | `wasm: read-through upsert missing child coverage queues`; same process test | Ours, harness. Public `meta` addresses client-prefixed metadata; it cannot read internal group state. Model child scope departure and incomplete rejoin through actual stream events instead. Final 6/6. |
| `guide-post-suite.log`, `guide-post-suite-final.log`, `guide-final-qualified.log` | `familiar::every_moved_fact_has_its_why_or_details_home` | Ours. Restored duration-unit and bounded-scan facts while retaining the word target; an overly broad inventory text replacement also touched language-09/types-01. Correct the four intended language excerpts only. `guide-complete-final.log`: 105/105. |
| `fixed-expiry-control.log`, `absence-regression-fixed.log` | `inherited_expiry_replay_memory`, `inherited_expiry_replay_sqlite` | Ours, reproduced from the full suite. Baseline control passes 2/2. The new parent proof intercepted public whole-table coverage after parent expiry. An initial early-return reorder was insufficient because read-through visibility deliberately does not mark public rules decided-true. Keep uniformly readable rules on their original proof path. `absence-regression-final.log`: 104/104, including all ten expiry tests. |
| `guide-final.log` | `path_refusals_are_targeted_and_repairs_compile` (guide itself 105/105; compatibility 1/1) | Ours, test. A global text substitution injected a multi-line declaration repair into function argument types. Restrict the original faulty declaration mutation to its first occurrence. `path-repairs-final.log` passes 3/3. |

## Measurement and reproduction setup

| Evidence | Failure(s) | Attribution / disposition |
|---|---|---|
| `baseline-process-measure.log` | `E_ADMISSION`: a browser-owned process adapter has no synchronous browser journal | Ours, harness. Move the process SDK owner into Node, forwarding its observations to React. Both successful process phases use that identical path; 40 samples each retained. |
| `cal27-fixed-check.json` | Missing `messageTtl`, `editWindow`, `deleteWindow`, `digestBucket`, `digestFollowers`, `digestPosts` | Ours, harness. Initial temporary copy omitted `config.q`. With config, fixed check exits 0. The original partial copy/result remains preserved. |
| `full-suite-inputs.json` | Launch manifest omitted then-untracked additions | Ours, evidence collection. `git ls-files` paths from `snapback4/` were resolved at the repository root. Final manifest includes all files and distinguishes previously recorded changes from additions lacking launch hashes. Full-run test output retains their actual execution. |
| Staged whitespace audit | `git diff --cached --check` flags trailing spaces/blank final lines in retained test logs | Ours, evidence formatting only. Preserve emitted logs verbatim; the source/document diff excluding raw report evidence passes the whitespace audit. |
| Interactive setup | One `python: command not found`; one fixture-edit script and one fact-inventory repair used a root-relative path from `snapback4/`; three log redirections used a Snapback-4-relative report path from the repository root | Ours, command invocation. Use `python3` and the proper cwd; no product change or failed test hidden. |

## Intentional baseline controls

| Evidence | Observed refusal/failure | Attribution / meaning |
|---|---|---|
| `cal27-baseline-check.json`, `cal27-baseline-with-config.json` | `E_QUARRY_SYNTAX`: `expected "]", got "."` at the multi-hop sync key | Baseline limitation under repair. The fixed complete-schema reconstruction succeeds. |
| `negative-baseline-device-tiers.log` | `wasm: read-through upsert predicts both arms and server refusal rolls back`; same process test, both fail `predictable === true` | Baseline limitation, expected negative control. Four horizon/unknown-coverage controls pass. Rebuilt baseline wasm reproduces 593,225 B gzip. Fixed 6/6 afterward. |

All current-source affected failures above are resolved. No environmental test
failure has been identified in the affected runs. The full suite's final
ownership ledger is independent of these deliberate baseline controls.
