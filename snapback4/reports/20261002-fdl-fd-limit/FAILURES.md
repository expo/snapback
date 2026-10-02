# Every observed failure

Classes: **ours** = introduced code/test or measurement error; **baseline** = reproduced in the saved, unmodified base; **environmental** = timing failure under contention, with no descriptor exhaustion and passing isolated controls. A classification does not turn a failed run into a pass.

## baseline-1024

[Raw log](baseline-1024.log). Exit 101; completed summary: `{"event": "failed", "exec_time": 7.776759366, "failed": 5, "filtered_out": 0, "ignored": 4, "measured": 0, "passed": 229, "type": "suite"}`.

- **baseline — descriptor exhaustion, fixed in this lane**: `serve::tests::overload_tests::a_thousand_sequential_reads_reuse_bounded_request_threads`.

```text
thread '<unnamed>' (1876322) panicked at vendor/tiny_http/src/util/refined_tcp_stream.rs:28:77:
called `Result::unwrap()` on an `Err` value: Os { code: 24, kind: Uncategorized, message: "Too many open files" }

thread 'serve::tests::overload_tests::a_thousand_sequential_reads_reuse_bounded_request_threads' (1874989) panicked at crates/snapback4/src/serve_tests.rs:99:58:
called `Option::unwrap()` on a `None` value
```

- **baseline — descriptor exhaustion, fixed in this lane**: `serve::tests::asset_list_tests::image_list_http_regression_with_scalar_upload_admission`.

```text
thread '<unnamed>' (1876173) panicked at vendor/tiny_http/src/util/refined_tcp_stream.rs:28:77:
called `Result::unwrap()` on an `Err` value: Os { code: 24, kind: Uncategorized, message: "Too many open files" }

thread 'serve::tests::asset_list_tests::image_list_http_regression_with_scalar_upload_admission' (1874903) panicked at crates/snapback4/src/serve_tests.rs:96:32:
called `Option::unwrap()` on a `None` value
```

- **baseline — descriptor exhaustion, fixed in this lane**: `serve::tests::effect_http_strictly_validates_present_fields_without_mutating_work`.

```text
thread '<unnamed>' (1876396) panicked at vendor/tiny_http/src/util/refined_tcp_stream.rs:28:77:
called `Result::unwrap()` on an `Err` value: Os { code: 24, kind: Uncategorized, message: "Too many open files" }

thread 'serve::tests::effect_http_strictly_validates_present_fields_without_mutating_work' (1874933) panicked at crates/snapback4/src/serve_tests.rs:96:32:
called `Option::unwrap()` on a `None` value
```

- **baseline — descriptor exhaustion, fixed in this lane**: `serve::tests::adoption_tests::worker::serve_rotation_fences_a_valid_credential_while_retirement_is_locked`.

```text
thread '<unnamed>' (1875485) panicked at vendor/tiny_http/src/util/refined_tcp_stream.rs:28:77:
called `Result::unwrap()` on an `Err` value: Os { code: 24, kind: Uncategorized, message: "Too many open files" }

thread 'serve::tests::adoption_tests::worker::serve_rotation_fences_a_valid_credential_while_retirement_is_locked' (1874897) panicked at crates/snapback4/src/serve_tests.rs:92:39:
called `Result::unwrap()` on an `Err` value: Os { code: 104, kind: ConnectionReset, message: "Connection reset by peer" }
```

- **baseline — descriptor exhaustion, fixed in this lane**: `serve::tests::latency_tests::duration::latency_held_poll_ends_at_final_frame_before_request_body_drain`.

```text
thread 'serve::tests::latency_tests::duration::latency_held_poll_ends_at_final_frame_before_request_body_drain' (1874954) panicked at crates/snapback4/src/../tests/latency/duration.rs:24:45:
called `Result::unwrap()` on an `Err` value: Os { code: 11, kind: WouldBlock, message: "Resource temporarily unavailable" }
```

## baseline-loaded-4

[Raw log](baseline-loaded-4.log). Exit 101; completed summary: `{"event": "failed", "exec_time": 6.825796933, "failed": 1, "filtered_out": 0, "ignored": 4, "measured": 0, "passed": 233, "type": "suite"}`.

- **baseline — store ownership refusal, reproduced at soft 4096**: `verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock`.

```text
thread 'verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock' (2291613) panicked at crates/snapback4/src/verbs/witness/smoke.rs:313:53:
called `Result::unwrap()` on an `Err` value: "E_WITNESS_BACKEND: cannot acquire backend store; stop its owner and check store permissions"
```

## baseline-loaded-5

[Raw log](baseline-loaded-5.log). Exit 101; completed summary: `{"event": "failed", "exec_time": 6.765442189, "failed": 1, "filtered_out": 0, "ignored": 4, "measured": 0, "passed": 233, "type": "suite"}`.

- **baseline — store ownership refusal, reproduced at soft 4096**: `verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock`.

```text
thread 'verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock' (2296643) panicked at crates/snapback4/src/verbs/witness/smoke.rs:313:53:
called `Result::unwrap()` on an `Err` value: "E_WITNESS_BACKEND: cannot acquire backend store; stop its owner and check store permissions"
```

## final-1024-2

[Raw log](final-1024-2.log). Exit 101; completed summary: `{"event": "failed", "exec_time": 8.295691997, "failed": 1, "filtered_out": 0, "ignored": 4, "measured": 0, "passed": 236, "type": "suite"}`.

- **baseline — store ownership refusal, reproduced at soft 4096**: `verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock`.

```text
thread 'verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock' (2064050) panicked at crates/snapback4/src/verbs/witness/smoke.rs:313:53:
called `Result::unwrap()` on an `Err` value: "E_WITNESS_BACKEND: cannot acquire backend store; stop its owner and check store permissions"
```

## final-1024-4

[Raw log](final-1024-4.log). Exit 101; completed summary: `{"event": "failed", "exec_time": 24.205565016, "failed": 3, "filtered_out": 0, "ignored": 4, "measured": 0, "passed": 234, "type": "suite"}`.

- **environmental — scheduling-sensitive timing assertion; isolated controls pass**: `serve::tests::ephemeral_tests::blocked_poll_wakes_without_lost_notification_and_is_paced`.

```text
thread 'serve::tests::ephemeral_tests::blocked_poll_wakes_without_lost_notification_and_is_paced' (2085626) panicked at crates/snapback4/src/../tests/serve_ephemeral/mod.rs:154:5:
wake took 401.733072ms
```

- **environmental — scheduling-sensitive timing assertion; isolated controls pass**: `serve::tests::latency_tests::headers::changes_refresh_is_engine_work_but_poll_sleep_is_not`.

```text
thread 'serve::tests::latency_tests::headers::changes_refresh_is_engine_work_but_poll_sleep_is_not' (2085650) panicked at crates/snapback4/src/../tests/latency/headers.rs:210:5:
poll sleeping entered engine/wait: {"cpu": 9.459, "engine": 406.246, "total": 1000.814, "wait": 3.897}
```

- **baseline — store ownership refusal, reproduced at soft 4096**: `verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock`.

```text
thread 'verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock' (2099966) panicked at crates/snapback4/src/verbs/witness/smoke.rs:313:53:
called `Result::unwrap()` on an `Err` value: "E_WITNESS_BACKEND: cannot acquire backend store; stop its owner and check store permissions"
```

## final-256-5

[Raw log](final-256-5.log). Exit 101; completed summary: `{"event": "failed", "exec_time": 6.58433974, "failed": 4, "filtered_out": 0, "ignored": 4, "measured": 0, "passed": 233, "type": "suite"}`.

- **ours — invalid measurement setup**: `serve::tests::adoption_tests::reads::process_exit_during_build_retains_the_old_generation_and_restart_rebuilds`.

```text
thread 'serve::tests::adoption_tests::reads::process_exit_during_build_retains_the_old_generation_and_restart_rebuilds' (2202661) panicked at crates/snapback4/src/../tests/serve_adoption/reads.rs:196:10:
called `Result::unwrap()` on an `Err` value: Os { code: 2, kind: NotFound, message: "No such file or directory" }
```

- **ours — invalid measurement setup**: `verbs::witness::lookup_tests::app_lookup_preserves_safe_simctl_diagnostics`.

```text
thread 'verbs::witness::lookup_tests::app_lookup_preserves_safe_simctl_diagnostics' (2207677) panicked at crates/snapback4/src/verbs/witness.rs:544:27:
called `Result::unwrap()` on an `Err` value: Os { code: 2, kind: NotFound, message: "No such file or directory" }
```

- **ours — invalid measurement setup**: `store_owner::tests::database_ownership_preserves_sqlites_posix_locks`.

```text
thread 'store_owner::tests::database_ownership_preserves_sqlites_posix_locks' (2207412) panicked at crates/snapback4/src/store_owner_tests.rs:35:41:
called `Result::unwrap()` on an `Err` value: Os { code: 2, kind: NotFound, message: "No such file or directory" }
```

- **ours — invalid measurement setup**: `store_owner::tests::database_renamed_to_auxiliary_name_is_never_opened_or_truncated`.

```text
thread 'store_owner::tests::database_renamed_to_auxiliary_name_is_never_opened_or_truncated' (2207416) panicked at crates/snapback4/src/store_owner_tests.rs:155:69:
called `Result::unwrap()` on an `Err` value: Os { code: 2, kind: NotFound, message: "No such file or directory" }
```

## verified-1024-5

[Raw log](verified-1024-5.log). Exit 101; completed summary: `{"event": "failed", "exec_time": 6.617222034, "failed": 1, "filtered_out": 0, "ignored": 4, "measured": 0, "passed": 236, "type": "suite"}`.

- **baseline — store ownership refusal, reproduced at soft 4096**: `verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock`.

```text
thread 'verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock' (2357284) panicked at crates/snapback4/src/verbs/witness/smoke.rs:313:53:
called `Result::unwrap()` on an `Err` value: "E_WITNESS_BACKEND: cannot acquire backend store; stop its owner and check store permissions"
```

## verified-256-1

[Raw log](verified-256-1.log). Exit 101; completed summary: `{"event": "failed", "exec_time": 6.614713705, "failed": 1, "filtered_out": 0, "ignored": 4, "measured": 0, "passed": 236, "type": "suite"}`.

- **baseline — store ownership refusal, reproduced at soft 4096**: `verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock`.

```text
thread 'verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock' (2365845) panicked at crates/snapback4/src/verbs/witness/smoke.rs:313:53:
called `Result::unwrap()` on an `Err` value: "E_WITNESS_BACKEND: cannot acquire backend store; stop its owner and check store permissions"
```

## verified-256-4

[Raw log](verified-256-4.log). Exit 101; completed summary: `{"event": "failed", "exec_time": 7.115037225, "failed": 1, "filtered_out": 0, "ignored": 4, "measured": 0, "passed": 236, "type": "suite"}`.

- **environmental — scheduling-sensitive timing assertion; isolated controls pass**: `serve::tests::ephemeral_tests::blocked_poll_wakes_without_lost_notification_and_is_paced`.

```text
thread 'serve::tests::ephemeral_tests::blocked_poll_wakes_without_lost_notification_and_is_paced' (2382373) panicked at crates/snapback4/src/../tests/serve_ephemeral/mod.rs:154:5:
wake took 282.517195ms
```

## baseline-load-1

[Raw log](baseline-load-1.log). Exit 101; completed summary: `{"event": "failed", "exec_time": 63.556558459, "failed": 4, "filtered_out": 0, "ignored": 4, "measured": 0, "passed": 230, "type": "suite"}`.

- **ours — invalid measurement setup**: `serve::tests::adoption_tests::worker::serve_rotation_fences_a_valid_credential_while_retirement_is_locked`.

```text
thread 'serve::tests::adoption_tests::worker::serve_rotation_fences_a_valid_credential_while_retirement_is_locked' (2217807) panicked at crates/snapback4/src/../tests/serve_adoption/worker.rs:25:9:
worker/adoption setup did not reach serve worker ready
```

- **ours — invalid measurement setup**: `serve::tests::adoption_tests::worker::production_accept_loop_reads_after_delayed_worker_exit`.

```text
thread 'serve::tests::adoption_tests::worker::production_accept_loop_reads_after_delayed_worker_exit' (2217802) panicked at crates/snapback4/src/../tests/serve_adoption/worker.rs:144:5:
worker/adoption setup did not reach worker ready
```

- **ours — invalid measurement setup**: `serve::tests::adoption_tests::worker::production_accept_loop_reads_while_exited_worker_waits_for_adoption`.

```text
thread 'serve::tests::adoption_tests::worker::production_accept_loop_reads_while_exited_worker_waits_for_adoption' (2217804) panicked at crates/snapback4/src/../tests/serve_adoption/worker.rs:144:5:
worker/adoption setup did not reach worker ready
```

- **ours — invalid measurement setup**: `serve::tests::adoption_tests::worker::production_accept_loop_waits_for_complete_worker_readiness`.

```text
thread 'serve::tests::adoption_tests::worker::production_accept_loop_waits_for_complete_worker_readiness' (2217805) panicked at crates/snapback4/src/../tests/serve_adoption/worker.rs:140:9:
worker/adoption setup did not reach worker token file opened
```

## baseline-load-2

[Raw log](baseline-load-2.log). Exit -9; completed summary: `{}`.

## Development checks (ours; corrected)

- `lifecycle-fd.log`: the new `dev_and_serve_raise_low_soft_limits_and_doctor_reports_the_server` initially expected exit zero after SIGTERM. Corrected to the existing signal-preserving exit contract; `lifecycle-fd-fixed.log` passes.
- `affected-final.log`: `clone_emfile_closes_the_connection_and_preserves_the_listener` timed out at clone stage 3. The test reused one process across stages; asynchronous cleanup from the preceding server could free descriptors during the next exhaustion probe. Each stage now has a fresh child; `affected-final-2.log` and `affected-final-3.log` pass that regression.
- `affected-final-2.log`: `startup_refusals_name_the_unserved_generation` found the extra startup line on an invalid `dev` invocation. Moved initialization past required project/deployment arguments, retaining one call before opening server resources. The unchanged refusal assertion passes in `affected-final-3.log`.
- `final-256-5.log`: Cargo replaced the running test executable during an exploratory run. Four self-spawning tests got ENOENT: process-exit adoption, simctl diagnostic lookup, and two SQLite lock/alias cases. These are our invalid measurement, not product failures. Stable copied-binary measurements retain every test.
- `baseline-load-1.log` and `baseline-load-2.log`: the baseline copy was outside `target/debug/deps`, so worker fixtures derived a nonexistent sibling CLI. The first run failed four worker readiness tests; the second was interrupted when this mistake was identified. All valid comparison runs use `target/debug/deps/fdl-baseline-unit`.
- Two initial shell setup commands used the wrong working directory for report redirection; no test ran in those commands. Paths were corrected before running builds.

## Passing affected checks

`policy-tests.log`: 2 policy tests. `affected-final-3.log`: 2 HTTP streaming tests, 1 EMFILE test covering three separate child processes, 27 lifecycle tests. `many-servers-2.log`: 1 repeated many-server child regression. `guide.log`: 110 guide tests. `macos-typecheck.log`: exact host_limits.rs type-checks for aarch64-apple-darwin against libc/serde/serde_json, with stub logging/admission declarations; no Darwin runtime test or full binary link is claimed. `ref-check.log`: 525 LLP documents, 10,084 references, zero errors or unchecked references.

## Complete suite

The single final `scripts/test.sh`, launched from shell soft NOFILE 1024, exited 0 and printed exactly `== 0 failure(s) in 1506 s`. No failure category or failed test. Its binary unit target passed 237/0 (four ignores), lifecycle 27/0, guide 110/0, client pool 5,768/0 (ten skips), and all 79 final models. See `full-suite.log`. Expected fault-injection refusal messages and deliberately failed retry attempts inside passing tests are not test failures.

## Final direct matrix on the complete-suite build

Seven of ten runs pass. The following three each pass 236 tests, fail one and retain four existing ignores. Every failure below is **baseline**, reproduced separately on unchanged source at soft 4096.

- [commit-1024-2](commit-1024-2.log): `verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock` — **baseline**.

```text
thread 'verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock' (3016438) panicked at crates/snapback4/src/verbs/witness/smoke.rs:313:53:
called `Result::unwrap()` on an `Err` value: "E_WITNESS_BACKEND: cannot acquire backend store; stop its owner and check store permissions"
```

- [commit-256-2](commit-256-2.log): `verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock` — **baseline**.

```text
thread 'verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock' (3053687) panicked at crates/snapback4/src/verbs/witness/smoke.rs:313:53:
called `Result::unwrap()` on an `Err` value: "E_WITNESS_BACKEND: cannot acquire backend store; stop its owner and check store permissions"
```

- [commit-256-4](commit-256-4.log): `verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock` — **baseline**.

```text
thread 'verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock' (3067937) panicked at crates/snapback4/src/verbs/witness/smoke.rs:313:53:
called `Result::unwrap()` on an `Err` value: "E_WITNESS_BACKEND: cannot acquire backend store; stop its owner and check store permissions"
```
