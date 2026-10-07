# Snapback 4: skipped export maintenance deadline test times out

Observed during RX round-1 qualification on eb1000, 2026-10-07. Open;
cause and baseline reproducibility are unconfirmed.

`packages/snapback4/test/export-background.test.mjs:532` was cancelled at its
120,000 ms test timeout in the full 24-file client pool. The case is
`skipped maintenance never blocks publication and drains under deadline (off)`.
Its contract includes the real 30-second retention deadline, owned compression
group cleanup, exited custodians and five full/twenty compressed retained runs.
The log has no assertion stack identifying which step or cleanup await held.
The file completed with 57 passes, one cancellation and 36 platform skips;
the runner confirmed cleanup of the file's owned process group.

The test and exporter paths are unchanged by RX. This is distinct from
`20261006-snapback4-native-export-status-intermittent.md`, which records a
different exit-status assertion. Published 0.4.13 is not a valid control for
the current export-maintenance protocol, so no baseline claim is made.

The complete file then passed through the normal serial runner: 58 passed,
36 platform skips, no failures/cancellations, 309 seconds. This establishes an
intermittent outcome, not its cause; keep this ticket open. No implementation,
deadline, assertion or test count changed between runs.

Evidence: [first failure](../snapback4/reports/20261006-rx-rule-hops/round-1/export-background-first-failure.log),
[complete rerun](../snapback4/reports/20261006-rx-rule-hops/round-1/export-background-rerun.log.gz)
and [RX report](../snapback4/reports/20261006-rx-rule-hops/REPORT.md#round-1--legacy-identity-and-merged-qualification-2026-10-07).
Reproduce from `snapback4/` using
`node scripts/run-client-tests.mjs 1 files packages/snapback4/test/export-background.test.mjs`,
or select the exact case with Node's `--test-name-pattern` flag. Keep the real
deadline, existing assertions and full-count qualification unchanged.

Next: preserve the fixture's maintenance log and custody records on timeout
to identify whether deadline enforcement, group observation or final cleanup
failed to progress.
