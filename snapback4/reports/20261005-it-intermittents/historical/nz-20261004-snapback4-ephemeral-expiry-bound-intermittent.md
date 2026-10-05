# Snapback 4: ephemeral expiry acceptance intermittently exceeds 4.5 seconds

- **Opened:** 2026-10-04, lane NZ round 4 on the Apartment mini.
- **Area:** `snapback4/packages/snapback4/test/ephemeral-e2e.test.mjs:103`.
- **Status:** Open; cause unestablished. Preserve the acceptance bounds.
- **Governing contract:** [LLP 3000.017 §4.7](../llp/3000.017-ephemeral-tables.rfc.md#47-tests).

The third complete NZ round-4 Mac suite failed the disappearance bound on
trial 5: first sight **3.024 ms**, disappearance **5979.005 ms** after the
last call (limit **4500 ms**), **2** ephemeral requests. This was an assertion
failure, not a hang or an indefinitely loading watch. The first two complete
runs on this host passed all five trials, with expiry near 3.94–3.96 seconds.

The test and client implementation are unchanged from base `e7e325b7d1`.
NZ changes publication/retention and their docs/tests, not ephemeral behavior.
The ambient host load was not controlled, and this record does not attribute
the failure to load without component timing evidence. No timeout, work count,
assertion or performance ceiling has been relaxed.

Evidence: [NZ Round 4 report](../snapback4/reports/20261003-nz-native-proof-zero-cost/REPORT.md#round-4--publication-and-retention-races),
`round4/full-suite-qualified.json`, `round4/full-suite-qualified-inputs.json`,
and `round4/ephemeral-expiry-failure.json` under that report. The complete log
is `/tmp/sb4-nz-r4-full-suite-qualified.log`; the report's evidence manifest
retains its content hash in the external archive. The earlier passing logs
are `full-suite.json` and `full-suite-final.json`.

Reproduce from `snapback4/` on physical Node 24 with
`node --test packages/snapback4/test/ephemeral-e2e.test.mjs`, or the complete
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`.
The old [FK disappearance issue](closed/20260927-snapback4-ephemeral-e2e-disappearance-flaky.md)
fixed a stranded-watch race and supplies background; this shorter bound miss
is not assumed to be the same defect. Capture scheduling, send/receipt and
server-expiry times before assigning a cause. Preserve all five trials and
the appearance, disappearance, request-count and notification assertions.

## Follow-up: unchanged standalone replay, 2026-10-04

After the complete suite finished, the unchanged test passed all five trials
in 62.102 s. Ephemeral expiry was 3,932.912–3,962.861 ms after the last call,
first sight 3.897–39.473 ms, and every trial sent two ephemeral requests. No
acceptance bound was changed. `round4/ephemeral-replay.json` retains the test
hash, before/after host snapshot and raw-log content hash. This confirms an
intermittent observation, not a root cause or a fix. The issue remains open.

## Follow-up: next full-pool sample, 2026-10-04

The next complete-suite attempt also passed this unchanged file (all five
trials, 64.635 s).
The complete attempt is recorded in NZ `round4/full-suite-complete.json`.
This passing sample does not close the issue or erase the prior failure.
