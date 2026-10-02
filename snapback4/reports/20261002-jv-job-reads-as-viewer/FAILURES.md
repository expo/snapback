# Failure ledger — JV round 0

Every failure below is **ours**, corrected before final qualification unless
otherwise stated. No baseline or environmental failure is claimed. Expected
negative-test refusals and caught negative-fixture panics are passing tests,
not qualification failures.

## Development runs

| Evidence | Failure | Correction |
| --- | --- | --- |
| Initial compiler probes | Incomplete builtin match coverage / initial binder wiring while adding the IR forms | Completed all exhaustive classifications and fixed binder types; final workspace check passes. |
| `job-viewer-initial.log` (also retained as `job-viewer.log`, same run) | `guide_digest_restart_closed_clients_idle_and_legacy_emissions`: private-store EPERM | Fixture now creates a private temporary directory instead of opening a store directly under shared `/tmp`. This was our fixture error, not environmental. |
| Same initial run | `over_budget_recipient_parks_without_partial_effect_or_key`: nonexistent `_effect_once` table | Assert the real `_effect_keys` table, including its valid not-yet-created state. |
| `job-viewer-3.log` | `calibration_28_builder_digest_matches_with_restart_and_idle_period`: E_TIMELINE_IMPORT | Create mapped profile/post/follow rows through ordinary mutations, as required by timeline history. |
| `job-viewer-4.log` | `runtime_refuses_system_columns_and_forged_effectful_blocks`: NOT_FOUND while trying to seed a system principal | Exercise runtime system refusal with `as viewer` in a real system job. The final test is named `runtime_refuses_system_viewer_and_forged_effectful_blocks`. |
| `affected.log` | `definitions::w11_every_registered_code_quotes_its_definition` | Add the six diagnostic definitions and reviewed boundary/repair pins. |
| `affected.log` | `every_card_compiles_clean`; `intent::language_intent_views_predicates_search_and_durations_run`; `the_language_card_compiles_and_runs`; `the_readme_quarry_compiles_clean`; `w9a_expiry_cards_explain_and_select_the_readers_deadline` | Only intercept query calls inside `as`; the first implementation intercepted normal calls outside it and collided with existing operation names. |
| `affected.log` | `w11_every_registered_code_has_a_dedicated_section` | Route all six new diagnostics to jobs and provide dedicated paragraphs. |
| `affected-2.log` | `definitions::w11_every_registered_code_quotes_its_definition` | Complete the diagnostic recovery/boundary registry. |
| `affected-2.log` | `familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block` (12,829 > 12,810 words); `start::openings_fit_without_growing_the_eight_reference_cards` (827 > 825 lines) | Shorten prose/comments and remove redundant blank lines; keep the budgets and compiled examples. |
| `affected-3.log`, `affected-4.log` | Same word/line tests (12,820 > 12,810; 827 > 825); definitions test missing two DIGEST_CHAT_BOUND repair facts | Restore the older recipe's exact repair facts and trim enough unrelated wording/blank lines. |
| `wasm.log`, `wasm-final.log` | Old ratchet exceeded: 611,843 and 611,844 B gzip versus 610,782 B | Required IR codec/server-refusal cost; authorized ratchet increase to 612,474 B with estimated macOS + 500 B headroom. Full-suite build passes the new cap. |

Final affected rerun: 142 passed, zero failed. All 110 guide tests pass without
weakening word/line budgets, skipping snippets or removing diagnostics. The
host replay passes on its first run. The node SQLite experimental warning is
informational, not a failure.

## Full-suite run

The one requested run exits 0 and reports exactly:

```text
== 0 failure(s) in 1561 s
```

No failed phases or tests: **ours 0, baseline 0, environmental 0**. Rust's
284 binaries / 997 executions and doctests pass. Client tests: 5,768 passed,
zero failed, 10 skipped. Models: 79 passed, zero failed. Their E_AUTH messages
are expected injected faults, not failed assertions. No baseline claim was
needed or made; therefore no current-main reproduction is presented as evidence.

## Round 1

The development failures below are **ours**, corrected before final
qualification. Expected failures on exact round-0 source are negative controls,
not baseline claims.

| Evidence | Failure | Resolution |
| --- | --- | --- |
| `round1/regressions-first.log` | `every_direct_read_and_helper_refuses_incomplete_results`: non-uniform unbounded aggregate rejected at compile time. `point_reads_and_uniform_domains_keep_ordinary_complete_answers`: fixture owner index omitted its trailing id. | Use bounded non-uniform aggregates and the valid owner/id prefix index. |
| `round1/regressions-second.log` | Property fixture initialized a loop accumulator to nullable; `exists` fixture included a forbidden `first` clause. | Initialize the carried scalar to zero; use the ordinary domain-existence spelling. |
| `round1/regressions-third.log` | Property compared the oldest retained effect instead of the new effect. | Identify the emission by the difference in effect IDs, independent of ordering. |
| `round1/wasm-device.log` | Hand-built witness used `Job`, but serialized ProgramKind is `job`. | Correct the witness spelling; actual wasm check passes in `wasm-device-final.log`. |
| Shell edit preparation | A Python edit command ran with root-relative paths from the Snapback 4 directory and found no file. It made no edits; the following build merely repeated the intermediate measurement. | Re-run the edit from the repository root. `wasm-lane-final.log` is the repeated intermediate build; `wasm-lane-gated.log` is the final feature-gated build. |
| `round1/wasm-main.log`, empty `wasm-main-rebuild.log` | Initial baseline command/session ended without a completion record; a background attempt also produced no completion record. No resulting artifact was used. | Foreground rebuilt baseline completed with exit 0 in `wasm-main-final.log` / `wasm-main.exit`. The interruption cause is not established; count these orchestration failures as ours, without inferring a product or baseline failure. |

Final artifact hygiene: `git diff --cached --check` found trailing blank
lines in four captured logs (`affected-final.log`, `affected.log`,
`cache-boundary.log`, `wasm-main.log`). This was ours; only terminal blank
lines were removed. The final whitespace check is clean.

`round1/negative-round0.log`: expected 9 failing tests (five Astra findings,
the property extension, ephemeral refusal, stub identity and early device
refusal), 9 passing controls. `round1/negative-cache.log`: expected cache-boundary
failure. Production code in that detached checkout is exact 5e51108213; only
tests were transplanted. No baseline qualification claim comes from this run.

`round1/negative-wasm.log`: expected failure on rebuilt round-0 Wasm. All
three server-only builtin forms decode and execute ARGUMENT_EXECUTED before
refusing; round 1 rejects them at decode. The reproducible witness is
`round1/wasm-fence.mjs`.

The one full-suite invocation exits **0**. Exact summary:

```text
== 0 failure(s) in 1843 s
```

Every phase passes: **ours 0, baseline 0, environmental 0**. No baseline
failure claim is made. Rust: 284 binaries / 997 executions and doctests.
Clients: 5,768 passed, zero failed, 10 skipped. Models: 79 passed, zero failed,
with 5,000 online + 5,000 local sequences and 3,000 interleavings. Their
injected E_AUTH refusals are expected model faults, not assertion failures.
The final affected integration run passes 197 tests (including 110 guide);
the cache-boundary unit test and actual Wasm witness also pass.
