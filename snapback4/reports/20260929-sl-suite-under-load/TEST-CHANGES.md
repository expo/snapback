# Changed test inventory

Parameterized rows below name the complete generated family; all original
parameters, assertions, sample counts and seed ranges remain. Shared helpers
are listed with every affected testing purpose. No new skip is introduced.
The [main report](REPORT.md) binds these changes to whole-run results;
[case notes](CASE-NOTES.md) contain the cause controls.

| Test or generated family | Failure mode | Change; check retained |
|---|---|---|
| `clique_03::application_fixture`, ordinary and full fixtures | Independent wall-time batches charge unrelated scheduling to the celebrity population | Rotate/interleave controls and charge single-thread engine CPU; preserve 3 warmups, 20 samples, 3× ceiling, row/work meters and model equality; still print wall p95. A 10 ms charged regression fails at 12.1146×. |
| `release_token_owns_the_resolved_database_before_sqlite_open` | Four slow competitor starts exhaust the owner's SQLite busy wait | Require a direct sidecar flock probe to return `WouldBlock` while SQLite is blocked; then release SQLite and hold final stdout while all four CLI contenders refuse the same owner. The final probe also passes with every child exec delayed 1500 ms; the original pre-fix control fails under that delay. |
| `production_accept_loop_reads_while_exited_worker_waits_for_adoption`; `production_accept_loop_reads_after_delayed_worker_exit`; `production_accept_loop_waits_for_complete_worker_readiness` | Shared 10-second setup guard expires before worker startup/readiness | 60-second per-state hang guard covers process setup; actual readiness predicates and 2-second response checks remain. |
| `doctor_idle_cpu_is_empty_before_traffic_and_after_reset` | A reply can precede sample recording and race reset | Wait for the exact completed sample before resetting; keep empty CPU snapshot checks. |
| `doctor_latency_json_default_summary_all_operations_and_reset` | Metric snapshot can precede sample recording | State wait for five samples and the post-reset sample; keep all counts, operations and reset checks. |
| `doctor_inspects_fresh_and_memory_at_the_printed_url_without_records` | Count assertion races the completed request | Exact-count state barrier; fresh/memory and discovery-record checks remain. |
| `doctor_discovers_persisted_host_and_url_selects_a_simultaneous_temporary_host` | Two host snapshots race their sample completion | Wait on each host's own count; preserve host selection and cross-operation zero counts. |
| `doctor_checks_the_servers_project_before_read_or_reset_for_both_address_sources` | The initial invariant snapshot has zero samples; the later one has one | Freeze the snapshot after sample completion; preserve complete JSON equality across every refused read/reset. |
| `doctor_rejects_a_stale_serve_lock_store_identity` | Same invariant-snapshot race | Wait for the request sample before capturing the snapshot; preserve refused operations and exact equality. |
| `symlinked_snapback_directory_starts_and_serves_in_every_dev_mode` | Doctor count can precede the sample | State barrier before doctor; keep all persisted/fresh/memory and symlink checks. |
| `doctor_url_inspects_and_resets_ipv6_loopback` | IPv6 timing snapshot races recording | Exact-count barrier before inspection/reset; all IPv6 and zero-after-reset assertions remain. |
| macOS `witness::driver::*` using `Fixture::command` | Fake xcrun startup consumes the 5-second step allowance before the named premise | Use the published 120-second per-step guard. All success, receipt validation, crash, custody, output and cleanup assertions remain. Linux does not execute this module. |
| `cli_invalid_receipts_missing_video_and_step_timeout_fail_and_stop_backend`, timeout mode | Timeout might occur during preparation instead of missing `offline-done` | Still withhold the receipt and assert its exact timeout phase, text and stopped backend, using the real 120-second guard. |
| `cli_preparation_timeout_still_records_failure_manifest` | A finite fake sleep could finish when the host is slow | Fake simctl waits for a signal indefinitely; the driver's real step timeout must terminate it and record preparation failure. |
| Online/local session state machines, each 5,000 seeded three-runtime sequences | Fixed 240-second aggregate deadline | Two seconds per history, at least the former guard; all 5,000 seeds per tier, I1–I13, fair recovery and coverage remain. |
| Online clients, 3,000 seeded interleavings | Fixed 180-second aggregate guard has the same throughput premise | Two seconds per history, at least the former guard; all 3,000 seeds, R1–R6, coverage and runtime alternation remain; check abort per seed. |
| `useQuery expires 4.5 s typing rows aged {0,3000} ms before mount on both clients` | Setup/IPC scheduling consumes semantic lifetime; cleanup shares the 30-second guard | Controlled browser clock and supported dev-server clock advance, real React/HTTP/device; exact pre-expiry visibility added, original no-polling/deadline/aged-delay/offline/DOM assertions retained. Resume the clock after assertions for cleanup. Four stages receive one minute each as a hang guard. |
| `web admission review: recovery and transport respect the session boundary`, all 54 scenarios | Silent held poll triggers the real 4-second watchdog and unplanned probe; the parent also exhausts 180 seconds across 54 cases | Heartbeats hold evidence while preserving transport liveness. Keep the 5-second orphan response wait and every outcome/audit/authority assertion. Each case has a 60-second guard; parent covers 54 cases plus startup/cleanup. |
| `online: revoked data, keep={undefined,false}, {held,retryExhausted,unavailable,throw}` | Initial catch-up starts an unarmed read that can complete after kick | Hold initial change feed until kick commits; preserve old-answer/withdrawal and replacement result assertions. |
| `{wasm,native}: population growth cannot mint new IDs during prediction replay` | An independent background observer legitimately rejects its obsolete acquisition capture | Hold background probe/feed while explicit sync tests replay; preserve the full refusal census and all generated-ID/authoritative stream assertions. Store-reset tests still require the stale-capture refusal. |
| `{online,wasm,process} keep={undefined,false,true}: eight closed active reads...`, and the corresponding expiry family | 2,000 parent turns can finish before device IPC | Wait for actual state under a 60-second barrier; freeze semantic time until explicit lifetime expiry; all eight reads, cancellation, ninth observation, late-publication and owner checks remain. |
| `{online,wasm,process} keep={undefined,false,true}: a pre-reset attempt reaches final publication without replacing the reset` | 60 parent turns finish before the replacement reaches transport | Wait for replacement transport entry; keep exact query count, loading snapshot and no-old-data subscriber checks. |
| `per-row-retry` due-completion and eight-expiry-backoff families | Custom global fetch bypasses SDK dispatcher; Node 24's bundled parser dereferences a collected parser after mocked timers reset | Use the already-pinned SDK dispatcher below the custom fixture transport; preserve retry deadlines, newer answers, capacity, cancellation and FIFO checks. |
| `{online,wasm,process} keep={undefined,false,true}: a due completion preserves a newer answer and retries` | Sixty parent turns do not prove that device continuation installed its backoff; the test can advance fake time too soon | Observe the real retry installation before the 25 ms advance; preserve newer-answer, reset-version, pacing and final query-count assertions; additionally require exactly one 25 ms retry. A delayed-continuation before/after control fails/passes. |
| `{wasm,process}: eight expiry backoffs leave capacity for a ninth observation` | Same fixed-turn premise leaves backoff installation unobserved | Wait for eight installed backoffs; add distinct-owner and exact 25 ms checks; preserve all eight due answers and ninth-read capacity assertions. |
| Mock-clock cleanup shared by those eleven cases | A failed assertion can leave close joining a frozen one-second background sleep | Start close before advancing the sleeping clock, then restore real timers for device cleanup. Four-stage parent guard and per-state guards detect hangs; no semantic pacing limit changes. |
| `rate_and_input_refusals_are_http_200_failed_under_dev_and_serve` | Direct drain and HTTP handler use different instants; descheduling allows a legitimate refill | Freeze the per-host test clock at admission, keep both dev/serve hosts, 40 initial admissions and every whitespace/refusal assertion; explicitly advance 50 ms and require HTTP success. Existing 49/50 ms pure limiter boundary test remains. |
| `guide::familiar::every_moved_fact_has_its_why_or_details_home` (`reads-11` fixture) | SL changed the guide's deadline wording but initially left the fact registry stale | Update that paragraph in its existing Details home; preserve all 133 facts and the exact normalized-text presence assertion. |
| `mixed evidence schedule {process,wasm}: 300 independent histories` | One allowance per seed omits two fresh hosted schedules; timeout then tears down the clock while its body continues | Count all three hosted schedules at two seconds each (1800 s for 300 seeds); check cancellation before each new schedule. Preserve all 300 seeds, all three schedules, failure aggregation and outcome assertions. |
| `changed_default_rechecks_unchanged_unique_index`; `changed_default_rechecks_unchanged_cap` | A queued host-capacity diagnostic can follow the direct lifecycle exit line; parsing the whole stderr suffix fails with trailing JSON | Require exactly one `SNAPBACK4_EXIT` line with dev/generation-0/status-1 metadata and parse its reason. Preserve complete E_ADOPT message/rewrite equality, check status, problem count and source site. The same trailing-line control fails both originals and passes both corrected cases; all 82 check tests pass under heavy load. |
| `identity::device_cannot_clear_a_running_servers_rows` | Correct startup refusal may close stdin before the descheduled parent writes | Preload the same `clear_rows` JSON before launch; keep failed-exit, `E_STORE_BUSY`, row-count and absent-side-table assertions. Forced child-before-parent control reproduces the original `Broken pipe`. |
| Browser helper for `immediate mounted form waits for identity and second save works`, `pre-identity burst admits in call order with ordinary prediction`, `reload discards only the unadmitted call`, and `identity {timeout,adoption,incarnation,restore} refuses publicly without custody`, each wasm/Worker (14 cases) | Browser close races a still-running replacement-store route callback after assertions finish | Remove routes and wait for active callbacks before browser close; retain cleanup in `finally`, all refusal/custody/prediction/order/lookup assertions and the 90-second guards. The event-controlled overlap fails the original and passes the corrected helper; callback errors remain visible. |
| New `serve::dev_refusals::console::tests::shutdown_diagnostic_cannot_split_a_counted_refusal_line`; existing `shutdown::{sigterm,sigint}_{with,without}_worker_flushes_refusals_while_a_poll_is_held` remain unchanged | Product `writeln!` emits formatting fragments; raw shutdown diagnostics can split the counted refusal line | Format the entire line before writing it. A deterministic writer interleaves a lifecycle diagnostic after the first write: the original fails, the fix preserves two intact lines and all eight refusals. All four console checks and all 20 real refusal checks pass under heavy load; no existing shutdown assertion or guard is changed. |

The dev refusal writer has one product correction: complete line formatting
before descriptor writes. Lifecycle/signal handling, aggregation windows, queue
bounds and shutdown deadlines are unchanged. The HTTP limiter still samples `Instant::now`;
its per-instance fixed-clock field and setter exist only under `cfg(test)`.
The product text changes in the guide and
client operations document remove an unsupported wall-clock frame promise.
The guide fact inventory records that revised statement. The only dependency
change is the test-only `libc` entry for the existing clock API.

## macOS driver coverage affected by the shared startup guard

The shared command helper changes the startup allowance for the following
existing test functions. Their individual premises and assertions are unchanged;
the two timeout functions are also detailed in the table above.

- `smoke_facts_come_from_the_generation_served_after_a_source_edit`
- `smoke_wrong_origin_marks_the_segment_failed`
- `smoke_wrong_generation_marks_the_segment_failed`
- `smoke_collection_revalidates_query_generation`
- `smoke_runs_three_cold_launches_and_a_broken_offline_run_fails`
- `smoke_rejects_unconsumed_barrier_and_native_crash_after_done`
- `smoke_rejects_native_crash_after_prime`
- `smoke_rejects_native_crash_after_offline`
- `cli_missing_app_and_ambiguous_simulator_never_start_a_backend`
- `cli_cold_start_and_relaunch_capture_real_backend_refusal_and_bound_artifacts`
- `cli_invalid_receipts_missing_video_and_step_timeout_fail_and_stop_backend`
- `cli_preparation_timeout_still_records_failure_manifest`
- `cli_rejects_failure_in_the_milestone_batch`
- `cli_rejects_failure_appended_after_done`
- `cli_rejects_milestone_appended_after_done`
- `cli_rejects_step_change_appended_after_done`
- `cli_rejects_malformed_envelope`
- `cli_refuses_an_existing_app_and_never_terminates_a_replacement`
- `cli_preserves_every_existing_output`
- `cli_restart_and_relaunch_keep_logs_and_terminate_only_launched_pids`
- `cli_concurrent_runs_into_one_namespace_have_one_owner`

The two deliberate witness timeout paths now each allow 120 seconds. Compared
with their former five-second guards, that is about 230 seconds more aggregate
intentional waiting on macOS; it is not a measured increase in the whole-suite
critical path. The named missing milestone and preparation-timeout assertions
remain. This Linux host verifies the Python fixture syntax but cannot execute
the Darwin-only Rust driver module, so no native macOS pass is claimed here.
