# LV round 3 failure inventory

All unexpected test, build and fixture failures below are **ours**. No baseline
or environmental exemption is claimed. Expected failures on round-2 code and
deliberate mutants are separate evidence, not qualification failures.
Every retained log with failing names is indexed in [failures.json](./failures.json).

## The single full run

`bash scripts/test.sh` ran once. Its original log is [test-sh.log.gz](./test-sh.log.gz).
This was an intermediate implementation run, not a green final-tree full run.

The ten Rust failures are:

1. `engine::aggregate_metadata_tests::memory_inherited_only_aggregate_dependencies`
2. `engine::aggregate_metadata_tests::memory_aggregate_point_and_raw_probe_dependencies_are_constant`
3. `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots`
4. `the_same_module_answers_the_same_on_the_server_and_on_both_devices`
5. `durable_schema_and_types_keep_base_bytes`
6. `aggregate_denial_dependencies`
7. `aggregate_denial_work`
8. `aggregate_inherited_only_dependencies`
9. `authorized_expired_backlog_stays_metered`
10. `aggregate_tables_constant`

All ten expected the former smaller dependency lists or schema bytes. The
dependency assertions now include the parent/source inputs. The word-search
fixture was regenerated; stripping only `operations[*].reads` yields the
identical old fixture. The historical ephemeral byte comparison likewise strips
only this new additive field, whose contents the new census checks separately.
The native test checks all possible visible inputs and server/device equality.
Meter and answer assertions remain. Final targeted Rust runs pass: core 3,
native 8, search fixture 1, ephemeral compatibility 1, read-through review 35.

The seven client failures are:

1. `bounded Following wasm: unknown conditions preserve static and helper dependencies`
2. `bounded Following wasm: a scalar cut before the feed keeps its possible reads fenced`
3. `bounded Following wasm: a known branch wins over static server routing`
4. `bounded Following native: unknown conditions preserve static and helper dependencies`
5. `bounded Following native: a scalar cut before the feed keeps its possible reads fenced`
6. `bounded Following native: a known branch wins over static server routing`
7. `every delivery await is explicitly classified`

The six Following assertions expected runtime-only lists. They now assert the
required static inputs as lower bounds; their answer, acquisition and routing
assertions are unchanged. All six pass in the final affected client run.

The new `syncRound` queue inspection changed the await boundary and shifted the
matrix's numeric recipes. Its queued-call hold also deadlocked direct sync
fixtures. After diagnosing that, I sent SIGTERM only to the stuck matrix child
in the full run, and to the same child in the concurrent affected run. This is
an **ours/incomplete execution** in addition to the recorded classification
failure. The full main client summary contains 4,240 tests, 4,223 pass, 7 fail,
10 skipped; it does **not** imply that the remaining matrix ran. The seven
acquisition/server shards all pass (12, 12, 11, 12 and 3, 3, 3 cases).

The new site is now appended as index 156, leaving every existing recipe index
intact. It is optional: failure aborts sync conservatively and delivery can
retry. The fixture holds dispatch while permitting read-only capture; fault
injection still reaches that capture. All **315** cases (157 sites in both
transient/persistent modes, plus the complete boundary audit) pass in
[delivery-matrix-final.log.gz](./delivery-matrix-final.log.gz).

## Other ordinary development failures

| Logs | Failure and resolution; all ours |
| --- | --- |
| `wasm.log`, `wasm-second.log`, `wasm-third.log`, `wasm-fourth.log` | Intermediate artifacts exceeded the unchanged 593,719-byte cap by 123, 163, 99 and 226 bytes. Compute the graph in the compiler and carry its certificate into the device; do not duplicate runtime graph traversal. Final artifact is below cap. |
| `footprint-initial.log`, `footprint-model.log`, `footprint-model-second.log`, `census-diagnosis.log` | Both process/wasm census fixtures initially fetched `/schema` without a persona, used an unacquired core, then required a remote-only flag on the device. Correct persona and an acquired real client fixed the first two; reading the flag without requiring its presence preserves server routing and permits the device metadata census. |
| `private-census.log` | Test construction passed `Backend` where `Option<Backend>` was required. Corrected to `Some`; all three Rust census tests pass. |
| `rust-dependencies.log`, `rust-dependencies-second.log` | `ordinary_expiring_page_recounts` was incorrectly broadened to include a nonexistent parent; `aggregate_tables_constant` still omitted its witness-path parent. Corrected those expectations; all 35 review cases pass. |
| `bounded-dependencies.log` | The same six Following failures listed above, before correcting their metadata assertions. |
| `receipt-cost.log` | New test supplied invalid short mutation IDs, producing `failed` instead of `sent`. The client now mints its ordinary IDs. Nine index/cost tests pass. |
| `affected.log` | 1,253 pass / 1 fail; the stale delivery boundary failed and its stuck matrix child was stopped as described above. Of the passes, 32 were partial matrix cases. All 1,221 other affected cases pass; the complete final matrix passes separately. |
| `mutant-receipt-scan.log` | First isolated mutant lacked package import mappings and failed with `ERR_PACKAGE_IMPORT_NOT_DEFINED` for `#fetch`. Copied the ordinary package manifest; the qualified run fails the intended cost assertion. |

A one-off shell verification used a redundant `snapback4/` prefix while already
inside that directory and raised `FileNotFoundError`; the corrected command ran.
A final evidence read asked for the nonexistent `wasm-size.json` instead of the
existing round-2 `wasm-measurement.json`; the correct file was then read. The
final-review bookkeeping initially required two trailing newlines instead of
one; stripping whitespace and checking the unchanged digest corrected it. These
are operator/setup errors, not product failures or environmental exemptions.
The staged whitespace audit also caught one extra blank line at the end of new
`schema/execution.rs`; removed it and reran the audit before the final amend.

## Expected red evidence

- Exact round-2 HEAD server/client plus round-2 wasm: **10 failures / 1 pass**
  across the initial new footprint tests. Tree and sum retention fail on online,
  process and wasm; both metadata censuses and both already-pending profile
  cases fail. [Log](./counterfactual-baseline.log.gz).
- The additional private-column case fails on **all three clients** against
  those same round-2 artifacts. [Log](./counterfactual-private-column.log.gz).
- Releasing every finite fence regardless of the applied watermark fails the
  named intermediate-cut regression and independent model seeds
  **4, 9, 10, 11, 14, 17, 20, 22, 23, 25, 26, 28, 32, 33, 36, 40**:
  **17 fail / 24 pass**. [Log](./mutant-finite-release.log.gz).
- Restoring the per-receipt full-owner loop fails with **160,000 actual visits
  versus 400 expected**. [Log](./mutant-receipt-scan-qualified.log.gz).

The baseline harness alone imports the new standalone `outstandingPredictions`
helper so the test module loads; round-2 `local.ts` does not call it. No baseline
runtime fence, footprint, receipt or profile implementation was changed. The
baseline tree/server and deliberate mutants live under ignored `target/`.

No new Expo/iOS UI qualification is claimed on this Linux host. Existing browser
profile witnesses are included among the passing affected cases.
