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


EM investigation, 2026-10-07: **still open; historical cause unclassified.**
The [retained report](../snapback4/reports/20261007-em-export-maintenance-drain/REPORT.md)
records 200 passing short invocations and eight passing complete-file runs,
additional focused/original-binary controls, then 32 passes per affected case
under four-core bursty CPU/disk load. The final instrumented complete file also
passes (58 passed, 36 platform skips). No ordinary lost-wakeup path was found;
passing repetitions do not resolve the original failure.

Drain failure now captures queue/lease/journal files, process/descriptor evidence
and maintenance step timestamps before fixture cleanup. Set
`SNAPBACK4_MAINTENANCE_EVIDENCE` to retain successful snapshots during a soak too.
The exact 90-second predicate rejects both a held-lease stall and pending work
whose fixture observer was killed; both snapshots are retained. No bound,
process-identity check, retry policy or product scheduling behavior changed.
Rebuilding a live Linux CLI contaminated early experiments with spawn ENOENT;
those failures are disclosed separately, and subsequent tests pin an immutable
binary. This does not establish the cause of the historical incident.
Next: use the retained diagnostics on recurrence, including the operator's macOS
soak, before assigning a cause or closing this ticket.
