# snapback4: witness driver "refuses an existing app" test is flaky under host load

- **Status:** open
- **Found:** 2026-09-15, lead, wave-3 integration suite (`e41a564ab`).

`driver::cli_refuses_an_existing_app_and_never_terminates_a_replacement`
(`crates/snapback4/tests/witness.rs:174`) failed once in the full blocking
suite on a loaded host (stderr lacked `E_WITNESS_APP: dev.test is already
running on dedicated; quit it before starting the witness`) and passed three
consecutive isolated runs (20 of 20). The fake `simctl` fixture's
running-instance state likely races the driver's first `launchctl list`
check under load. Next: make the fixture's pre-running state deterministic
(written before the driver starts) and assert on the coded exit, not only on
stderr text timing.

## FS investigation — 2026-10-08 (remains open)

The exact driver case is `#[cfg(target_os = "macos")]` and cannot run on the authorized eb1000-only Linux host. The test still covers useful refusal and replacement custody, so this is not closed as obsolete. No Darwin reproduction or 30-run driver qualification is claimed.

The original pre-running-state hypothesis is not supported by the fixture: `running` has synchronously returned PID 6999 without an `app-pid` file since `cdae076a803` (2026-09-14), before this ticket. FS ran that cold-state fixture, the no-app control and replacement PID 9999 30 times under taskset CPU load. All passed; replacing the fallback with no PID fails the negative control. Thirty concurrent loaded runs of the portable `witness.rs` cases also pass, but do not include this Darwin-only case. The driver's normal per-step test budget changed to the published 120 seconds in `5593f264df1`; its original small-budget failure cannot be diagnosed from the old missing-stderr assertion alone. No bound is changed by FS.

Next: run this exact driver case with its Darwin neighbours on the publication host, retaining its coded refusal/manifest when it fails. [FS commands, limitations and logs](../snapback4/reports/20261008-fs-witness-worker-flakes/REPORT.md).
