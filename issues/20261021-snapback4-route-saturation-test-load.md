# Snapback 4 route-saturation test intermittently misses verification under broad test load

Status: Open
Date: 2026-10-21
Scope: `serve::tests::route_tests::saturated_legacy_waits_cannot_starve_route_verification_or_registry_execution`

Integration 20's five-crate Linux run on da83e95c83 failed at
`crates/snapback4/tests/serve_routes/mod.rs:234`: verification response `ok`
was null rather than true. The CLI unit target otherwise had 505 passes and
5 ignores. This test uses a 2500 ms route lifetime and the run used default
libtest concurrency on a 96-CPU shared host while another superseded full run
and client/packed qualification were active. Concurrency is an observation,
not an established cause. No runtime capacity or test assertion was changed.

The unchanged test passed alone in 0.10 seconds. A subsequent complete
five-crate run uses eight libtest threads; its result is recorded in
Integration 20's report and raw logs. The earlier run was stopped after main
advanced with store-boundary changes, rather than claimed as a completed run.

Investigate the exact verification response and route lifetime/admission
ordering under load. Preserve the saturation, progress, authority and deadline
assertions. Do not infer a product fix or close the ticket from repetitions.

Evidence: `~/sb4-loop/integration20/logs/cargo-full-final.log`,
`route-saturation-alone.log`, and `cargo-integrated-main.log`.
