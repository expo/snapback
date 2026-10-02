# Failure ledger

All failed invocations are retained. No failure was hidden by a changed assertion or reduced sample count.

| Invocation | Classification | Failure and disposition |
|---|---|---|
| `logs/ct-negative-control.log.gz` | baseline; expected detecting control | Original dispatcher: `a_thousand_sequential_reads_reuse_bounded_request_threads` reports 1,000 serving threads versus capacity 32. Fixed implementation passes. |
| `logs/ct-affected-rust.log.gz` | ours; corrected | Compile setup: extracted poison fixture was accidentally discovered as an integration crate (48 unresolved-context errors); isolated lifecycle/witness test crates lacked the new priority module. Moved poison fixture under its own directory and imported the helper in the two isolated crates. |
| `logs/ct-after-build.log.gz` | ours; corrected | Initial diagnostic-priority implementation violated the core’s `forbid(unsafe_code)`. Replaced it with a safe host-supplied thread-start callback; platform calls remain in the HTTP host. |
| `logs/ct-affected-rust-r2.log.gz` | ours; corrected | `password_work_is_bounded_and_does_not_hold_the_query_engine`: queued requests could count a notified idle worker twice and delay needed capacity. Spawn when queued jobs reach idle capacity, not only when idle is zero. Full-capacity regression now also observes every handler entering. |
| `logs/ct-affected-rust-r2.log.gz` | environmental | `full_mutation_workers_refuse_upload_without_body_drain_or_eviction`: explicit OS error 24, too many open files at the shell’s 1,024 descriptor limit. Final affected invocation uses 4,096 and passes. |
| `logs/ct-affected-rust-r3.log.gz` | ours; corrected command | Cargo was invoked from the repository root instead of the independent Snapback 4 workspace and stopped on the absent Snapback 1 Ibex dependency. No bootstrap or Snapback 1 changes were made. |
| `logs/ct-before-smoke.log.gz` | ours; corrected harness | Readiness incorrectly required an unauthenticated `/probe` success; this schema requires authentication there. Use `/auth/config`; owned server stopped on the failed attempt. |
| macOS source review | ours; corrected before cross-check | Readback initially used a two-argument pthread spelling; the bound libc signature has three arguments and an output parameter. Corrected, then cross-compiled the scheduling, trace, worker modules and scheduling tests for aarch64-apple-darwin on Linux. No Mac execution. |

The 1,024-descriptor invocation `logs/ct-affected-rust-r3b.log.gz` had 15 environmental failures. Its log contains repeated OS error 24, resulting resets/timeouts, and an asset open interpreted as missing. With the same product and 4,096 descriptors, all 220 affected tests passed (four inherited ignores). Each failed case:

- `serve::tests::adoption_tests::atomic_feed_launch_keeps_queries_reading_and_holds_sync_and_writes` — environmental.
- `serve::tests::adoption_tests::reader_failure::failed_file_reader_refuses_without_waiting_for_the_writer` — environmental.
- `serve::tests::asset_list_tests::image_list_http_once_is_per_element_and_survives_reorder` — environmental.
- `serve::tests::delivery_tests::delivery_manifests_are_on_successful_answers_without_provenance_opt_in` — environmental.
- `serve::tests::delivery_tests::receipt_only_reports_and_replays_do_not_wake_change_waiters` — environmental.
- `serve::tests::effect_http_strictly_validates_present_fields_without_mutating_work` — environmental.
- `serve::tests::ephemeral_tests::rate_and_input_refusals_are_http_200_failed_under_dev_and_serve` — environmental.
- `serve::tests::full_poll_admission_preserves_short_request_progress` — environmental.
- `serve::tests::latency_tests::duration::latency_large_asset_total_includes_blocked_socket_write` — environmental.
- `serve::tests::latency_tests::headers::changes_reopens_after_a_commit_and_times_each_open_as_wait` — environmental.
- `serve::tests::latency_tests::headers::dev_headers_cover_operations_and_refusals_without_data_and_respect_the_fence` — environmental.
- `serve::tests::latency_tests::latency_engine_wait_is_attributed_to_its_request_and_dev_inspection_never_waits` — environmental.
- `serve::tests::latency_tests::latency_release_requires_a_live_service_and_never_allows_reset` — environmental.
- `serve::tests::latency_tests::latency_successful_asset_stream_and_range_refusal_are_both_measured` — environmental.
- `serve::tests::overload_tests::a_thousand_sequential_reads_reuse_bounded_request_threads` — environmental.

The single full-suite invocation also found `snapback4::lifecycle::abort_profile_reports_an_off_thread_panic_to_redirected_stderr` (ours): its generated standalone rustc source lacked the new thread-priority module. That fixture never calls the background helper, so it now declares a no-op scheduling dependency while continuing to test the real lifecycle panic/signal path. The actual scheduling implementation is tested independently, including the Darwin cross-check. The lifecycle file was rerun after this correction; its result and the full suite’s exact summary are in REPORT.md. Qualification target misses are measurements, not passing tests: all remain visible in RESULTS.md and the original samples.

The staged whitespace check initially flagged literal CRLF HTTP evidence, trailing blank log lines, and blank diff-context lines in the retained patch. These raw artifacts are now losslessly gzip-compressed; their bytes and failures are preserved. Source/doc whitespace checks pass.
