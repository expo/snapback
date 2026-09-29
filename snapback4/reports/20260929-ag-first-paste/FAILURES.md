# Failure attribution

The single requested `scripts/test.sh` run is preserved in `full-suite.log`.
The Rust stage had the following 16 failures, **all mine**, caused by the new
accepted forms, truthful advice and default presentation. They were fixed and
the affected targets rerun; no failure was waived or relabelled as baseline.
The full script was not run a second time.

| Failed test | Attribution and resolution |
| --- | --- |
| `durable_schema_and_types_keep_base_bytes` | **Mine.** The frozen schema includes human advice. Pin the two changed upsert strings explicitly; every other serialized schema and emitted type byte remains frozen. |
| `foreign_spellings_are_refused_and_canonical_repairs_compile` | **Mine.** Remove len from the refused-spelling list; executed alias and meter checks cover its acceptance. |
| `guessed_spellings_are_mechanical_refusals_with_exact_rewrites` | **Mine.** Remove len from the refused-spelling list. |
| `helper_bodies_return_values_without_returning_from_the_caller` | **Mine.** Replace the old no-return refusal assertion with an executed null result. |
| `baseline_golden_and_ownership_switch_shard_5` | **Mine.** Pin the newly admitted no-return helper program separately; do not change historical IR digests. |
| `baseline_golden_and_ownership_switch_shard_6` | **Mine.** Pin choose/member from the document formerly rejected at len; do not change historical IR digests. |
| `board_quotes_source_read_with_four_planner_variants` | **Mine.** Plain check no longer prints plans. Keep the authored read and index-label assertions on explicit --cost and --verbose output. |
| `no_horizon_notes_are_compact_in_check_and_explained_by_verbose_or_why` | **Mine.** Assert one-line default notes and full rewrites under --verbose. |
| `json_and_text_both_name_every_sequence_counter` | **Mine.** Sequence facts moved to --verbose; JSON remains detailed. |
| `sync_order_note_is_printed_on_every_check_and_clears_with_matching_window` | **Mine.** Default still prints N_SYNC_ORDER and its chosen index, but omits the rewrite. |
| `len_retains_its_mechanical_check_fix` | **Mine.** Rename to assert accepted alias stays authored as len under --fix. |
| `builder_guesses_have_one_step_check_repairs` | **Mine.** Update the len fixture to expect acceptance. |
| `language_operation_classes` | **Mine.** Add the new language-card familiarLengths query to the constant-operation expectations. |
| `text_and_json_preserve_cost_lines_and_add_a_summary` | **Mine.** Assert scale summary under --cost; plain check is terse. |
| `check_reports_each_field_owner_and_visibility` | **Mine.** Field-authority facts moved to --verbose; JSON remains detailed. |
| `w10r1b_dev_reports_the_same_cascades_as_check` | **Mine.** check now puts the verdict first. Compare identical diagnostic bodies with dev's existing footer; this also avoids waiting on an empty last line. |

Rerun evidence: `suite-repairs-lang.log` (1 ephemeral compatibility, 6 familiar
forms, 40 frontend regressions, all 11 lowering tests), `suite-repairs-cli.log`
(10 cost, 3 notes, 3 familiar, 28 scale, 1 field-owner), and
`suite-repairs-lifecycle.log` (the exact failed lifecycle test). All pass.

## Client-stage failures

| Failed test | Attribution and disposition |
| --- | --- |
| `page-ready.test.mjs:31` — ready list reads survive account restoration, new chat acquisition and pending unread counts | **Environmental / nondeterministic.** Under the full run it received an empty complete page instead of loading behind an unapplied receipt. Isolated base and current runs both pass all three page-ready tests. The base/current fixture schema and executable programs have identical activation digests; runtime and client sources are unchanged. See `page-ready-attribution.txt`, `baseline-page-ready.log`, `current-page-ready.log`. No deterministic baseline defect is claimed. |
| `page-ready.test.mjs:138` — unavailable server list responses end retention in both clients | **Environmental / nondeterministic.** The full run accessed missing `denied.code`; same paired controls and identical fixture artifacts as above. |
| `periphery.test.mjs:394` — check --fix repairs every remaining guessed spelling and the repaired program runs | **Mine, client-owned expectation remains unapplied.** Accepted len no longer requires a rewrite. The proposed assertion keeps len and the existing executed size=3 check. |
| `unread-range.test.mjs:140` — unread range check names the chosen predicates, index and horizon | **Mine, fixed.** Restore row-view range detail for explicit --cost. The unchanged client test now passes (`final-client-cost.log`). |
| `unread-range.test.mjs:258` — check enumerates every range candidate and its fallback in text and JSON | **Mine, client-owned expectation remains unapplied.** Detailed enumeration is now under --verbose. JSON remains unchanged. |

The user explicitly reserved client packages for other lanes. No files there were
changed. `client-test-followup.patch` contains the two exact expectation edits for
those owners. Applying it in an isolated scratch copy and running those two tests
passes **2/2** (`client-test-followup-validation.log`), including actual CLI query
execution. Those two tests remain red in the unchanged client tree; this is not
reported as a green full suite.

## Earlier local development failures (mine, resolved)

These are retained rather than hiding the iteration history:

- `first-paste-1.log`: error[E0308]: mismatched types.
- `first-paste-2.log`: error[E0433]: cannot find `jobs` in `snapback4_core`.
- `first-paste-3.log`: comparative_public_view_and_cal24_effect_helper_first_attempts_execute.
- `cli-first-paste-1.log`: first_paste::cal25_check_is_verdict_first_and_ephemeral_indexes_are_presented.
- `cli-affected-2.log`: check_explains_held_dispatch_and_generates_the_client_marker; w11_repeated_quarry_refusals_show_sections_and_their_repairs_check_clean; horizon_check_and_why_keep_the_same_advice_across_checks; b2_predicts_assertion_refuses_check_and_is_quiet_when_satisfied; w10r1b_unscoped_cursor_note_never_proposes_a_whole_table_cap; w9a_check_states_held_source_coverage_only_without_horizons; check_reports_all_narrowing_sites_in_text_and_json_without_adopting; b2_maintain_note_points_to_the_measured_cold_snapshot.
- `cli-affected-3.log`: w9a_check_states_held_source_coverage_only_without_horizons.
- `guide-final.log`: the_language_card_compiles_and_runs.
- `affected-final.log`: error: cannot find macro `json` in this scope; error[E0433]: cannot find module or crate `wire` in this scope.

`final-whole-guide.log` initially had one further mine failure: `familiar::every_moved_fact_has_its_why_or_details_home` still pinned the old len refusal sentence. The first fix exposed the opening paragraph's second stale fact-home entry (language-20), recorded in `final-whole-guide-fact-home-2.log`. Both entries now match the accepted alias policy; `final-whole-guide-pass.log` passes all 98 tests.

The first two were test-code JobState type/import mistakes. The third used a
raw load instead of maintenance-aware seeding. The CLI test expected a point
selection in an ephemeral write; it now asserts the emitted write operation.
The eight CLI compatibility assertions were updated to request verbose detail;
the remaining --cost held-coverage regression was fixed in production. The guide
snapshot gained familiarLengths, then its new execution assertion needed explicit
wire/json imports. Final relevant logs are green. A scratch golden-capture command
also first used the wrong working directory, made no edit and found no test target;
the corrected capture is in `golden-capture.log`.

## Root check-inventories (outside the Snapback 4 fence)

Command: `node scripts/check-inventories.mjs`, exit 1. `inventories.log` preserves
all messages; `inventory-attribution.txt` records that the scanned root inputs
match f56e8048a. No root registry or root inventory was modified.

| Failure | Attribution |
| --- | --- |
| scripts-test: unregistered `scripts/caps.test.mjs` | **Baseline**, tracked file and registry unchanged. |
| demo-catalog: `guide/capabilities.md` is 63,496 B, over its 63,488 B budget | **Baseline**, root guide unchanged. |
| guide-manifest: missing `demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json` (both path and snippet checks) | **Environmental**, ignored generated demo output absent in this checkout. |
| guide-manifest: legacy authoring-profile drift in `guide/auth/app-identity-binding.md` | **Baseline**. |
| guide-manifest: legacy authoring-profile drift in `guide/deploying/hosted-control.md` | **Baseline**. |
| guide-manifest: legacy authoring-profile drift in `guide/deploying/index.md` | **Baseline**. |
| guide-manifest: legacy authoring-profile drift in `guide/recipes/auth-transition-writes.md` | **Baseline**. |
| guide-manifest: legacy authoring-profile drift in `guide/recipes/split-sensitive-fields.md` | **Baseline**. |
| guide-manifest: legacy authoring-profile drift in `guide/sync/offline-and-retention.md` | **Baseline**. |
| stale `guide/reference/diagnostics-registry.json` | **Baseline**, root generator does not scan Snapback 4. |
| stale `guide/reference/diagnostics.md` | **Baseline**, same. |
| stale `packages/snapback-client/diagnostic-codes.d.mts` | **Baseline**, same. |
| missing `demos/todo-v2/snapback/generated/contract/setCompleted.mutation.ts` | **Environmental**, ignored Contract output absent. |
| missing `demos/todo-v2/snapback/generated/contract/runtime-links.ts` | **Environmental**, ignored Contract output absent. |
| guide-manifest: repeated capabilities size failure | **Baseline**, same 8-byte overage above. |

The root check also reports 18 pre-existing capability-gap review warnings
(expired or expiring within seven days), all listed verbatim in `inventories.log`.
These are warnings, not additional failures. The Snapback 4 compiled guide is a
separate check and passes all 98 tests.
