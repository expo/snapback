# Round 1 failures and limits

All logs are retained. A later passing check does not erase an earlier failure.

| Invocation | Classification | Result and disposition |
|---|---|---|
| Darwin check 1 | Ours, corrected | Mixed i32/i16 spawn flags; cast the combined flags to the API's c_short. |
| Darwin check 4 | Ours, corrected | libc's QoS enum does not implement PartialEq; compare numeric class values. Subsequent target checks pass. |
| Mixed smoke 1 | Ours, fixture corrected | Invented service declaration and a job write outside a sweep; removed the declaration and used the documented seeded-domain job. |
| Mixed smoke 2 | Ours, fixture corrected | Primary index is byId, not id. |
| Mixed smoke 3 | Ours, harness corrected | Raw mutation wire reply carries result, not the SDK's data. |
| Mixed smoke 4 | Ours, harness corrected | Persisted job arguments use Value::Map/Int serialization; decode that shape before comparing schedule boundaries. |
| Mixed smoke 5 | Ours, harness corrected | Final deliberate worker pause extended past the observation window, leaving retry work pending and one unobserved requeue. Stop injecting abandoned claims 15 seconds before the window ends. Smoke 6 passes all checks. |
| Mixed deadline probe phase | Ours, qualification gap corrected | Review of the fixture found the slow effect was emitted alongside the lease probe before clock advancement. The advance could expire its deadline; those outcomes do not prove real-clock deadline handling. Move slow-effect emission after advancement, retain the original matrix source, and run separate real-clock deadline controls at every load on before/demoted/restored binaries plus a corrected complete-mode smoke; all twelve supplemental cells and the 65-second smoke pass. |
| Hardware-cycle probe | Environmental | perf is absent; direct perf_event_open(PERF_COUNT_HW_CPU_CYCLES) returns errno 13, Permission denied, with perf_event_paranoid=4. No privileges or host settings changed. Thread CPU time is not presented as hardware cycles. |
| First comparison summarizer | Ours, assertion scope corrected | Insights intentionally returns day(now) calendar buckets. The 96-CPU series ended before UTC midnight; the ten-CPU series began after it. Assert all eight hashes within each full ABBA matrix and retain both Insights hashes across dates; seven endpoints agree across all matrices. A -1d/current-day query control reproduces both exact hashes. No additional result field is dropped. |
| Inline binary tests | Ours, alternative corrected | 219 pass, 2 fail, 4 ignored. latency_admission_refusals_do_not_disappear caught capture after admission; move the latency sample before permit acquisition, matching the pool. The preserved patch includes the fix. |
| Inline binary tests: latency_held_poll_ends_at_final_frame_before_request_body_drain | Environmental timing under owned CPU load; retained | Final-frame duration 284.99 ms, registry total 422.10 ms; the fixed 100 ms allowance failed while the mixed run supplied contention. The wait/long-poll path uses the same pool in both designs. All 28 latency cases pass when run serially (two pre-existing ignored). |
| Final-pool binary tests: changes_refresh_is_engine_work_but_poll_sleep_is_not | Environmental timing under owned CPU load; final suite passes | 220 pass, 1 fail, 4 ignored. Engine wall 695.847 ms, total 1002.279 ms, wait 10.822 ms during full-host saturation. No /changes implementation changed. The final full-suite serving binary passes all 222 tests (four ignored) after owned contention stops; a separate unloaded focused recheck is also recorded below. |

The saved inline patch needed one context refresh after the maintenance-priority correction; `git apply --check` then passed. This was an artifact-generation fix, not a product or test failure.

Mac runtime priority and performance tests remain operator work. Cross-checking
Rust for aarch64-apple-darwin checks the bindings and test source, not effective
runtime scheduling. The Node addon is also cross-checked independently.

The single full suite passes: `== 0 failure(s) in 1411 s` (exit 0); there are
no final full-suite failures to classify. The previously failing latency case
also passes its separate unloaded recheck (1 passed, 225 filtered).
The 10 inherited conditional client skips are retained in `qualification/SKIPS.md`;
they are not passes or newly introduced failures. No baseline product failure
was observed in this round's final suite.

The staged whitespace check flags the unified patch's required blank context
prefixes and verbatim test logs' trailing blank lines. These raw artifacts are
preserved intentionally; generated Markdown's extra EOF blanks were removed.
The source/document whitespace check excluding `*.patch` and `*.log` passes.
This is an artifact-format check, not a product-test failure.
