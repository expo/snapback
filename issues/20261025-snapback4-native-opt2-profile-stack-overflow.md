# Native execution fails under temporary opt-level 2 verification profiles

Status: Open
Date: 2026-10-25
Scope: device native Following, simulator native continuation, SDK bounded Following

Integration 25 temporarily set CARGO_PROFILE_DEV_OPT_LEVEL=2 and
CARGO_PROFILE_TEST_OPT_LEVEL=2 to shorten verification. Both the candidate
70365904e6 and archived pre-merge main25ee876966 abort with stack overflow
in device native_following_memory and the simulator case
`a_native_continuation_parks_when_module_bytes_change_and_new_work_runs`.
The same 32 MiB RUST_MIN_STACK and existing per-package device opt-level3
are retained. Baseline locks match their committed versions.

Repository-configured profiles pass the isolated device case and repeated
complete target (2/2), and the isolated simulator case and complete target
(12 passed / 1 existing ignore). The SDK bounded Following native case also
fails alone against the temporary-profile CLI; a separate configured-profile
CLI passes the isolated case and complete file (39/39). The SDK case itself
was not rerun on the baseline. No assertion, workload, stack size or gate is
changed, and the temporary opt-level overrides are never shipped.

Evidence: snapback4/reports/integration25/*profile-control.json and compressed
logs. Preserve the raw selector reds alongside configured-profile supplements.
The temporary baseline source/targets were removed after evidence collection.
Investigate before adopting opt-level2 as a verification profile. Publication
still owns the normal packed/native qualification of the landed source.
