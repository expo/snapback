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
