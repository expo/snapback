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
