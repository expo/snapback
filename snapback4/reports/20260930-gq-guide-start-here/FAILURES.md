# Failure ledger — GQ round 0

Every failure below is retained; initial red guide runs were repaired before the single full-suite invocation.

## Guide edit iterations — ours

### guide-first.log

15 failing tests, all **ours** (guide layout, context selection, preservation or budget assertions):

- `client::existence_card_and_starters_teach_the_sdk_words`
- `client::native_smoke_is_the_milestone_path_with_honest_limits`
- `client::published::client_teaches_sdk_delivery_and_screen_seen`
- `definitions::w11_every_registered_code_quotes_its_definition`
- `definitions::why_rule_carries_the_target_visibility_contract`
- `every_card_compiles_clean`
- `familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block`
- `familiar::every_moved_fact_has_its_why_or_details_home`
- `feeds::builder_path_precedes_internals_and_older_spellings`
- `feeds::followups::published_global_filters_originals_and_preserves_independent_reposts`
- `feeds::owner_key_sign_out_preserves_the_replica_without_lending_its_proof`
- `prediction_card_compiles_clean`
- `start::openings_fit_without_growing_the_eight_reference_cards`
- `structural_admission_cards_name_every_host_and_the_web_trust_boundary`
- `the_keywords_are_one_list`

### guide-second.log

7 failing tests, all **ours** (guide layout, context selection, preservation or budget assertions):

- `client::existence_card_and_starters_teach_the_sdk_words`
- `definitions::w11_every_registered_code_quotes_its_definition`
- `familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block`
- `feeds::followups::published_global_filters_originals_and_preserves_independent_reposts`
- `start::openings_fit_without_growing_the_eight_reference_cards`
- `the_keywords_are_one_list`
- `w9b_every_code_has_bounded_card_context_and_a_full_card_command`

### guide-third.log

4 failing tests, all **ours** (guide layout, context selection, preservation or budget assertions):

- `familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block`
- `familiar::every_moved_fact_has_its_why_or_details_home`
- `start::openings_fit_without_growing_the_eight_reference_cards`
- `the_keywords_are_one_list`

The final targeted whole guide passes 109/109. Repairs preserved the historical example hashes, moved-fact inventory and word targets; no baseline or environmental failures occurred in these guide runs.

Setup commands also encountered three **ours** mistakes: report-directory creation relative to the wrong working directory, invoking unavailable `python` instead of `python3`, and using a root-relative edit path from the Snapback 4 working directory. They changed no product behavior and were corrected.

## Root diagnostic registry — baseline

`node scripts/generate-diagnostics-registry.mjs --check` exits 1. All three generated projections are stale:

- `guide/reference/diagnostics-registry.json`
- `guide/reference/diagnostics.md`
- `packages/snapback-client/diagnostic-codes.d.mts`

The fast freshness check confirms 764 unchanged source inputs have digest `a0632c170f26c82288e88aec8ea986f3c425640fb670540753e9737a7f76bfe1`, while the committed registry records `8dae0ec2871e51a1e8bbab32ef6c97632d924d93a7202c763de9bea3993f276a`. `root-authorities.txt` and its empty diff prove the registry/inventory paths match the starting revision. These are Snapback 1 projections, outside the Snapback 4 fence; no indexed source moved. The Snapback 4 emitted-code registry and full definition/recovery census pass in the guide suite.

## Root inventory check — baseline and environmental

`node scripts/check-inventories.mjs` exits 1 with three failing categories. Every reported error is listed below; repeated findings are identified.

- **Baseline, scripts-test:** `scripts/caps.test.mjs` is on disk but absent from the reviewed script-test inventory.
- **Baseline, demo-catalog:** `guide/capabilities.md` is 63,496 bytes against 63,488; the guide-manifest category repeats this same size failure.
- **Baseline, guide-manifest:** legacy authoring-profile baseline mismatch in `guide/auth/app-identity-binding.md`.
- **Baseline, guide-manifest:** legacy authoring-profile baseline mismatch in `guide/deploying/hosted-control.md`.
- **Baseline, guide-manifest:** legacy authoring-profile baseline mismatch in `guide/deploying/index.md`.
- **Baseline, guide-manifest:** legacy authoring-profile baseline mismatch in `guide/recipes/auth-transition-writes.md`.
- **Baseline, guide-manifest:** legacy authoring-profile baseline mismatch in `guide/recipes/split-sensitive-fields.md`.
- **Baseline, guide-manifest:** legacy authoring-profile baseline mismatch in `guide/sync/offline-and-retention.md`.
- **Baseline, guide-manifest:** reference-registry inventory repeats all three stale projections above.
- **Environmental, guide-manifest:** missing ignored generated `demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json`, reported both as an examples path and snippet source.
- **Environmental, guide-manifest:** missing ignored generated `demos/todo-v2/snapback/generated/contract/setCompleted.mutation.ts`.
- **Environmental, guide-manifest:** missing ignored generated `demos/todo-v2/snapback/generated/contract/runtime-links.ts`.

The 18 gap-review warnings in `inventories.log` are inherited warnings, not additional failing tests. No root gate assertion or baseline file was changed to hide these findings. The root guide-manifest generator has no changed inputs from GQ and would refuse this inherited failing corpus; no unrelated projections were regenerated.

## Full scripts/test.sh run

Run exactly once. Exit 1; exact summary line:

```text
== 1 failure(s) in 1441 s
```

The one failed stage is `cargo test` (576 s): 16 failing test cases in 13
scheduled Rust target executions. All 16 are **ours**, not baseline or environmental:

| Rust target | Failing case | Cause / repair |
| --- | --- | --- |
| core `lane_source` | `every_published_quarry_lane_source_matches_and_keeps_canonical_bytes` | Short excerpts need their declared template/reference schema; share the explicit test context resolver. |
| device `device` | `guide_examples::w10r1_directory_card_pages_and_searches_on_both_stores` | Select the full search program by `table profiles:` instead of first block. |
| device `device` | `presence::effect_reads::effect_payload_reads_keep_server_authorization_and_meter_rollback` | Select the preserved `mutation send(` program by name instead of block 1. |
| device `device` | `presence::effect_reads::effect_payload_send_predicts_offline_and_agrees_at_every_presence_state` | Same prediction-block selection repair. |
| device `device` | `presence::effect_reads::total_text_payloads_skip_profile_reads_on_devices` | Same prediction-block selection repair. |
| device `device` | `presence::effect_reads::unguarded_payload_reads_predict_without_online_only_data` | Same prediction-block selection repair. |
| device `readauth` | `census::authoring_census` | Share explicit context; relabel shifted reference blocks and include repeated existing default-template sites. |
| lang `aggregate_copies` | `every_card_and_published_quarry_block_has_no_aggregate_copy_note` | Share explicit snippet context; keep the existing aggregate-copy assertion. |
| lang `aggregate_copies` | `no_published_indexed_int_table_has_unrestricted_writes` | Share explicit snippet context; keep the existing write-rule assertion. |
| lang `effect_reads` | `clique_send_in_prediction_card_is_eligible_without_hoisting` | Select the preserved `mutation send(` program by name. |
| lang `server_opt_in` | `why_and_discovery_keep_the_opt_in_one_step_away` | Preserve listing's original first two lines; put Start here immediately after them. |
| lang `residency_notes` | `horizon_guard_remains_eligible_and_effect_only_presence_can_assert` | Select the preserved `mutation saveDraft(` program by name. |
| lang `residency_notes` | `predicts_assertion_refuses_online_writes_and_explicit_server_but_keeps_horizons` | Same prediction-block selection repair. |
| sim `clique` | `search_directory::w10c_directory_uses_the_cards_single_query_and_resets_its_cursor` | Select the full search program by `table profiles:`. |
| CLI `check` | `guide_lists_aliases_and_resolves_them_on_stdout` | Preserve the original keyword prefix, appending `start` to the list. |
| CLI `check` | `guide_unknown_word_suggests_cards_on_stdout` | Same keyword-prefix repair. |

The full run also passed the whole guide (109/109), wasm, docs budget, release
guard, package typecheck/build, both application typechecks, nine fixture-wrapper
tests, 5,726 client tests (ten existing skips; zero failures/cancellations), and
79 model tests including the 5,000-seed session batch. Wasm remained exactly
1,994,357 raw / 598,401 gzip bytes, at the existing budget.

All 2,329 captured source hashes stayed unchanged throughout that run
([receipt](suite-inputs-verified.txt)); repairs happened only after it finished.
The full-suite log remains red and was not overwritten or rerun. Final affected
checks and counts are in REPORT.md and their separate logs.

The first post-suite language rerun also printed an **ours** unused `quarry`
import warning after moving the context helper. The unused import was removed;
this was a warning, not a test failure.


## Final preservation edit — ours

After restoring the explicit “or job” placement alternative in language's
opening, `familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block`
failed the existing aggregate word ceiling by one word (12,811 versus 12,810).
The run passed 108 other guide tests and is retained in
`guide-preservation-extra.log` (exit 101). Rephrasing the same repair as
“use mutations or jobs” retains both alternatives within the unchanged ceiling.
The final whole-guide rerun is recorded separately.
