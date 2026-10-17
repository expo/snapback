# Snapback 4: intermittent macOS C ABI ownership fixture refusal after both handles close

Status: Open
Date: 2026-10-17
Scope: `crates/snapback4/tests/run_admission/identity.rs::two_c_abi_opens_share_ownership_until_both_close`

Integration 15's first complete five-crate run on Mac Studio
`macstudio-charlie-apt101-a`, source `0130e0f041`, failed the final local `run put`
with E_STORE_BUSY after both C ABI handles had been dropped. The other 27 tests
in that target passed. The exact case then passed alone in 0.15 seconds without
changing its source or assertions. Linux's complete first run passed this case.
The final complete Mac repetition passed (five crates, exit 0; eight libtest
threads), including this case. Passing repetitions do not identify or fix the
cause. Do not suppress the test or add a retry around ownership.

Investigate descriptor/sidecar ownership lifetime and concurrent child launches,
without assuming either is the cause. Preserve the shared ownership, first-drop
exclusion, second-handle usability and final successful write assertions.

Raw first-run and isolated logs are retained in
`snapback4/reports/20261017-integration15/`; the final integration report records
the complete-repeat verdict. Cargo used `CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0` and six build jobs.
The first run used default libtest concurrency; the repeat uses eight threads.
