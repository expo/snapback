# Wave 12 LANG full-six reconciliation

The initial six-package `--no-fail-fast` run exited 101 after executing all 393 top-level targets: 6201 passed, 21 failed, 43 ignored, and 0 filtered. The failures were confined to 10 targets.

The raw log is preserved verbatim as `snapback4/reports/wave12-lang/full-six/initial-full-six.log.gz` (SHA-256 `17162c3b01c45620cb22ea8afadaf3c7369e8e6383735af4f1853e4407a6788f`); its uncompressed source has SHA-256 `60d43bf15b235b62f1749d4766e98239b6e5d75910162e7d18fe3f288b160cee`. No compile, process-execution, artifact-removal, manifest, or doctest infrastructure error appears in the log. All five doctest package targets executed; core passed 17 and the other four contained zero doctests.

## Initial failed targets

| Target | Failed | Tests |
| --- | ---: | --- |
| `unittests src/lib.rs` | 5 | `engine::row_views::certification_tests::incremental_certification_matches_naive_after_every_random_step`<br>`engine::row_views::certification_tests::incremental_certification_matches_naive_with_expiring_members`<br>`engine::row_views::certification_tests::lifetimes::generated_direct_lifetimes`<br>`engine::row_views::certification_tests::lifetimes::generated_inherited_lifetimes`<br>`engine::row_views::certification_tests::lifetimes::generated_through_lifetimes` |
| `tests/sequence_disclosure.rs` | 1 | `landing::redundant_witness_lifetimes_do_not_change_scan_or_write_probe_reservations` |
| `tests/read_through.rs` | 1 | `pending_chain_and_queue` |
| `tests/recorded_coverage.rs` | 1 | `maintains::recorded::activation_has_no_events_and_reacquires_both_stores` |
| `tests/rx_rule_hops.rs` | 2 | `memory_chains_and_final_obligations_need_every_covered_row`<br>`sqlite_chains_and_final_obligations_need_every_covered_row` |
| `tests/lean.rs` | 2 | `page3_membership_and_compound_filters_keep_the_read_free_model_gate`<br>`the_emitter_covers_the_generated_corpus_with_named_exceptions` |
| `tests/smoke.rs` | 2 | `membership_page_with_two_filter_alternatives_stays_incomplete_in_lean_and_native`<br>`widening_keeps_unwidened_seeds_and_every_dimension_compiles` |
| `tests/read_through_review.rs` | 1 | `reuse_refusal` |
| `tests/reservation_app_headroom.rs` | 4 | `calibration_headroom_memory`<br>`calibration_headroom_sqlite`<br>`profile_upgrade::authentic_profile_kept_memory`<br>`profile_upgrade::authentic_profile_kept_sqlite` |
| `tests/maintains_recorded.rs` | 2 | `activation_dangling_expired_reused_and_removed_paths`<br>`round1::activation_capture_persists_after_reopen_and_empty_capture_has_no_gap` |

## Reconciliation boundary

The exhaustive command began before several scoped fixes landed in the shared tree. The table and JSON retain the exact initial result. Current-source follow-ups are attached only when a preserved receipt exists. Core lib, the three device targets, full difftest, and both language targets have passing follow-ups. `sequence_disclosure` has no preserved current-source follow-up receipt yet. The two `maintains_recorded` failures were discovered at the end of this run and await a current-source follow-up.
