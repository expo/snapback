# Round-3 failure ledger

No baseline product failure is inferred from an earlier round. Any baseline
classification must be reproduced on the current main commit.

| Invocation | Classification | Disposition |
|---|---|---|
| Initial directory/copy command and later patch attempt with root-relative paths from `snapback4/` | Ours, orchestration | No product edit in the failed commands; corrected paths. Empty mistakenly nested directories removed. |
| `affected-initial.log` and repeated `affected-initial2.log` | Ours | E0616: new schedule count used private `engine.schema`; changed to the public `schema()` method. Second invocation followed the failed path correction and repeated the same compile error. |
| `affected-initial3.log` | Environmental limit, triggered by our omitted shell setup | Shell retained 1,024 descriptors; concurrent HTTP tests hit OS error 24, with downstream resets/timeouts. Using round 2's `ulimit -n 4096`, the full affected binary passes 227/0 (four ignores). Every failing test is listed below. No baseline product claim. |
| `maintenance-core-wrong-target.log` | Ours, orchestration | Asked Cargo for nonexistent `row_views`; corrected to `row_keyed_views`. Both row-view and timeline test targets pass. |
| `drain-smoke/` | Ours, measurement defect (successful exit) | Synchronous queue snapshots blocked the query client's event loop and contaminated p95. Kept as exploratory evidence, excluded from performance comparisons. Final observer runs in a separate worker thread. |
| Source review during the sole full-suite run | Ours, timing-accounting defect | A generic FIFO coordination guard inherited engine-ownership timing. Added `FairMutex::gate` and a regression, then reran affected server and clock/latency/lifecycle checks; rebuilt the measured production binary. The full suite subsequently exposed the same defect in its already-compiled server target; it is not rerun. |
| `mixed-following-smoke/` | Ours, observation gap | Debug Following backlog completed during the final tail wait, after the 65-second sample window; no completion timestamp had been polled there. Extended the optional Following observer through final drain and scoped physical-expiry SQL to its own table; the corrected production smoke passes, including the completion timestamp. Retained original log/store locally; final qualification uses production and 125 seconds. |

Descriptor-limited affected run — each is environmental in that invocation:

- `serve::tests::adoption_tests::a2_adoption_fences_supervised_claims_before_the_old_child_stops`
- `serve::tests::adoption_tests::atomic_feed_launch_keeps_queries_reading_and_holds_sync_and_writes`
- `serve::tests::adoption_tests::reader_failure::failed_file_reader_refuses_without_waiting_for_the_writer`
- `serve::tests::adoption_tests::reader_failure::failed_reader_factory_recovers_on_maintenance`
- `serve::tests::asset_list_tests::image_list_http_placement_reorder_removal_and_delete`
- `serve::tests::dev_loopback_admits_eight_simultaneous_sign_ins_within_host_capacity`
- `serve::tests::effect_http_strictly_validates_present_fields_without_mutating_work`
- `serve::tests::ephemeral_tests::action_admission_notifies_held_polls_without_maintenance`
- `serve::tests::ephemeral_tests::durable_publication_does_not_acquire_the_ephemeral_hub`
- `serve::tests::latency_tests::duration::latency_disconnected_asset_records_exactly_one_sample_and_refusal`
- `serve::tests::latency_tests::headers::changes_refresh_is_engine_work_but_poll_sleep_is_not`
- `serve::tests::latency_tests::headers::clock_maintenance_retry_open_is_wait_not_engine`
- `serve::tests::latency_tests::latency_counts_queries_mutations_actions_fixed_routes_and_typed_refusals`
- `serve::tests::latency_tests::latency_engine_wait_is_attributed_to_its_request_and_dev_inspection_never_waits`
- `serve::tests::latency_tests::latency_successful_asset_stream_and_range_refusal_are_both_measured`
- `serve::tests::oidc_terminal_codes_survive_http_settlement_and_public_recollection`
- `serve::tests::overload_tests::a_thousand_sequential_reads_reuse_bounded_request_threads`
- `serve::tests::overload_tests::full_mutation_workers_refuse_upload_without_body_drain_or_eviction`
- `serve::tests::password_work_is_bounded_and_does_not_hold_the_query_engine`
- `serve::tests::pooled_readers_observe_new_commits_and_each_viewer`

Full-suite Rust failure (ours):

- `serve::tests::latency_tests::headers::clock_maintenance_retry_open_is_wait_not_engine`
  failed in the pre-correction server target: total 152.079 ms, wait 151.268 ms,
  engine 1.743 ms; wait + engine exceeded total. The new coordination gate had
  inherited engine-ownership accounting, double-counting nested admission time.
  `FairMutex::gate` fixes this without changing engine admission, and the final
  affected run passes this test plus the new inter-slice regression: 228 passed,
  zero failed, four ignored. Post-suite integration checks are recorded separately.

The sole complete suite ended exactly **`== 2 failure(s) in 1411 s`** (exit 1),
listing `cargo test` and `client tests`. Its pre-correction Rust server target
reported 226 passed, one failed, four ignored. Client tests: 5,741 passed, one
failed, ten skipped. Client models: all 79 passed.

The second full-suite failure is
`47 transient: local.ts:850 follow` in `delivery-fault-matrix.test.mjs:264`:
“the classified await must actually experience an injected fault.” No server is
started by this fixture: its transport is mocked over the real wasm device.
The whole file rerun on this branch passes all 321 cases. Classification: **environmental/transient fault-injection harness failure**, exact
scheduling cause unresolved. This is not a baseline product claim. On current
main 738d45830c9d51c9c92f65180c56cbecb2f2b068, archived without source changes,
the newly built wasm/client pass the isolated site-47 transient case (2/2 including
the classification guard) and complete matrix (321/321). The CT branch rerun also
passes 321/321. The open reachability issue records the remaining investigation.

`main-fault-matrix.log` exited 124: **ours, insufficient outer timeout**. Its
120-second guard expired while the matrix retained pending async work; the complete
240-second-guard attempt finished naturally in 140.235 seconds with all 321 passing.
This timeout is not a baseline product failure.

Post-correction integration tests passed: clock 19, latency 12, lifecycle 24,
replay 15 (70 total). The complete suite was not rerun.

Final artifact cross-check: **ours, measurement-tool mismatch**. A Python
`gzip.compress` comparison returned 604,752 bytes and failed an equality assertion
against 605,001. The ratchet's actual method is GNU `gzip -9 -c` on the named
artifact, as used by `build-wasm.sh`; that check confirms 605,001 bytes again.
No wasm source/artifact or budget changed. `wasm.json` records the final digest
and the correct measurement method.

Staged whitespace check: **ours, artifact formatting**. Eight raw qualification
logs end with Cargo's extra blank line. They are preserved byte-for-byte in
`.log.gz` form instead of altering tool output; the final staged check passes.
