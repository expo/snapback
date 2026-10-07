# Snapback 4: stale-empty process-runner fixture fails on Darwin

Status: Open
Date: 2026-10-06
Found by: Lane RM full-suite verification on the Apartment mini
Scope: `snapback4/packages/snapback4/test/test-file-runner.test.mjs:424`,
`snapback4/scripts/run-client-tests.mjs`, `snapback4/scripts/test-processes.mjs`

The test “stale exited members do not reset empty snapshots; observed live leaks
remain failures” expects `emptyInspections === 2` at line 444. On macOS 27.0.1
arm64 with Node 24.19.0 it observed 47 in the complete suite, 44 in isolation,
and 53 when run from an untouched archive of base commit
`8e3062941096d465ec067b00d5eb37c7f1d9f8fd`. Each isolated run took about 5.7 s.
The earlier assertions (`passed === false`, reason `TEST_FILE_LEAK`) succeeded;
the inspection-count assertion failed.

Reproduce from `snapback4/` with the pinned Node on PATH:

```sh
node --test --test-name-pattern='stale exited members do not reset empty snapshots' packages/snapback4/test/test-file-runner.test.mjs
```

The baseline proof extracted only `snapback4/scripts/` and this test file from
`git archive HEAD` into a fresh temporary directory, ran that command there,
and removed the directory afterward. No RM contract, React, guide or starter
changes entered that proof. These modules have no matcher import. This is an
inherited harness failure, not qualification of the RM matcher as failing.

Investigate the fake inspector's repeated pre-cleanup snapshot versus the
completed-snapshot cleanup protocol (LLP 3000 §7, PS Round 2). Preserve the
owned-process boundary and live-leak refusal while deciding whether the test's
exact count or cleanup's stale-row handling needs correction. No runner or
process-custody change is included in RM.

Evidence: [RM report](../snapback4/reports/20261006-rm-read-match/REPORT.md),
[isolated run](../snapback4/reports/20261006-rm-read-match/runner-isolated.log.gz),
[untouched-base run](../snapback4/reports/20261006-rm-read-match/runner-baseline.log.gz).
