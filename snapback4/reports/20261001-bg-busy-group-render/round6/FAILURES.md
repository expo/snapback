# BG round 6 failure ledger

Final-source full-suite result is recorded in `final-verification.json` and REPORT round 6. Large logs are retained as `.log.gz` archives with their original log names below. No development failure below is waived as baseline or environmental.

## compiler-dev.log

Ours: sequential branch inference joined a maintained row with its scalar count before checking the alternative branch. Corrected branch environments; all 32 original tests then passed.

- `blind_member_marks_have_identical_meters_bounds_and_changes`
- `comparison_boundaries_exclude_or_include_the_exact_mark`
- `completed_expiry_correction_has_one_constant_public_meter_charge`
- `defaulted_member_fields_are_materialized_in_durable_recounts`
- `emitted_work_and_chunked_deletes_maintain_all_members`
- `existence_with_expiring_sources_and_raw_metadata_refusals`
- `expired_population_never_selects_a_pending_mark`
- `expired_private_member_catchup_deletes_view_before_sweep`
- `expired_unswept_recipients_do_not_consume_the_live_cap_scan`
- `hidden_marks_have_identical_meters_bounds_and_changes`
- `incomplete_counts_cannot_authorize_writes_or_numeric_probes`
- `large_mark_commits_pending_then_settles`
- `lifecycle_memory`
- `lifecycle_sqlite`
- `live_cap_ignores_unswept_expired_members`
- `member_expiry_ends_existence_and_rule_authority_before_sweep`
- `moving_source_between_two_parents_updates_both_groups`
- `oversized_recount_parks_without_starving_another_member`
- `parent_moves_recount_the_new_domain_and_clear_the_pending_fallback`
- `parent_reference_comparison_keeps_parent_scan_and_residual`
- `parse_bind_and_explain`
- `private_member_predicates_require_owner_read_authority`
- `recount_survives_restart_and_concurrent_changes_on_both_sides_of_cursor`
- `sequence_field_authority_and_row_view_share_one_runtime`
- `settled_expiring_counts_certify_only_the_live_basis`
- `small_mark_uses_the_changed_range_in_a_large_chat`
- `tombstoning_exact_recount_cursor_removes_its_already_counted_contribution`
- `unread_inherits_member_authority_and_expiry_timer`

## lang-final.log

Ours: raw argument types were not initialized, so video.duration was treated as an unknown receiver. Initialized argument and asset object types; all four audience_bounds cases now pass.

- `builder_public_aggregate_refuses_both_edits_and_explains_each_repair`
- `helper_refusal_finds_a_transitive_job_caller`
- `owner_key_rewrite_from_each_narrowing_diagnostic_compiles_verbatim`
- `query_replacement_points_at_declaration_with_helper_loop_and_job_context`

## lang-second.log

Ours: this broad language run compiled the intermediate guide before its two corrections. Its only failing target was guide; the frozen-source guide-final run passes 110/110.

- `every_card_compiles_clean`
- `start::openings_fit_without_growing_the_eight_reference_cards`

## affected-dev.log

Ours: non-unique maintenance-field indexes received a generic undeclared-column schema error. Extended the shared structural schema walk to every row-view index; the diagnostic now names the field and fix with E_VIEW_KEY.

- `every_reachable_maintenance_field_refuses_raw_engine_admission`

## admission-final.log

Ours: the new guide page lacked a cursor (N_NO_CURSOR), and the card grew from 879 to 899 lines. Added the cursor and condensed the policy within the existing 879-line cap.

- `every_card_compiles_clean`
- `start::openings_fit_without_growing_the_eight_reference_cards`

## admission-final2.log

Ours: the intermediate guide condensation was still four lines over its unchanged cap. The final card is 879 lines and passes.

- `start::openings_fit_without_growing_the_eight_reference_cards`

## raw-dev2.log

Ours: command syntax supplied two Cargo test filters. No test ran. Corrected the command and ran both native cohorts.

- `error: unexpected argument 'maintenance_admission' found`

## types-dev.log

Ours: the initial test harness expected E_VIEW_KEY before optional-bool checking, and used data.q while invoking unqualified operation names. Added the typed source-position check and corrected the fixture module name.

- `maintenance_types::astra_nested_containers_and_all_nonreturn_reads_refuse`
- `maintenance_types::direct_data_projection_and_whole_rows_return_exact_values`
- `maintenance_types::generated_container_helper_projection_compositions_keep_receiver_types`

## types-dev2.log

Ours: a new binder method needed pub(super) visibility. Corrected before tests could compile.

- `error[E0624]: method `computation` is private`

## types-dev3.log

Ours: the fixture used .$private, which Quarry cannot lex. Kept literal raw IR coverage and exercised Quarry through the string sort-key spelling; all wrapped private-field cases refuse.

- `maintenance_types::astra_nested_containers_and_all_nonreturn_reads_refuse`
- `maintenance_types::generated_container_helper_projection_compositions_keep_receiver_types`

## Expected detecting controls

The hash-verified saved round-5 binary incorrectly accepts all four nested bypass fixtures (exit 0, zero problems); its direct-field control correctly refuses with E_VIEW_KEY (exit 1). These are detecting controls, not final-source product passes. `round5-negative-controls.json` binds the old binary and records every outcome.

The guide retirement tests intentionally catch panics from negative fixtures and pass; those printed panic lines are not test failures.

## Final source: full-suite.log.gz

Exact summary: `== 1 failure(s) in 1421 s`; exit 1. Final classifications:
**ours 0, baseline 1, environmental 0**. The sole failed stage is client tests.

- **Baseline:** `48 transient: local.ts:855 follow` in
  `packages/snapback4/test/delivery-fault-matrix.test.mjs:264`:
  `the classified await must actually experience an injected fault`
  (actual false, expected true). Product assertions before this check passed.
  All 495 tracked client source/test files and the wasm digest are unchanged
  from round 5; the fixture uses a static schema and does not invoke the native
  compiler. Ten isolated site/mode repeats pass. Root cause remains unresolved;
  this is evidence of inherited harness nondeterminism, not a load diagnosis.
  See `fault-input-equivalence.json`, `fault-site48-repeats.json`, and
  `issues/20261002-snapback4-delivery-fault-site48-missed-injection.md` at repo root.

All Rust executions and all 79 serial models pass. Client totals are 5,745
passed, one failed, ten skipped. No full-suite rerun; no failure is hidden by
the focused passing repeats. The frozen-source receipt has no changed inputs.

## Evidence packaging

The first staged whitespace check reported trailing spaces/blank lines in raw
Cargo logs. These are ours to package, not product test failures. Archived those
logs losslessly instead of editing their contents; `archived-log-digests.json`
binds each original. The final staged whitespace check passes.
