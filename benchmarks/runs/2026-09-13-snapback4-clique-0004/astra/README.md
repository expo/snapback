# Astra continuous builder evidence

**Status: builder complete; independent grading pending.** The foreground
`gpt-6-astra` medium builder exited 0 at `2026-09-13T21:10:50Z`. Its outer
lifecycle was 9,614.013 seconds. These files preserve builder-produced evidence
and custody receipts; they are not an independent grade.

The original lane is
`/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4`.
Relative links in the copied reports that are absent here resolve against that
external lane. The complete source snapshot, 86 MB settlement stream, raw CLI
logs, native bundles, screenshots and other bulky evidence remain external.
Their relevant hashes or locations are retained in
[`snapshot-manifest.json`](./snapshot-manifest.json) and
[`raw-cli-log-references.json`](./raw-cli-log-references.json), with settlement
and native-bundle hashes in [`retained-artifacts.json`](./retained-artifacts.json).

## Builder result

M1, M2, M3, M4, M5, M6 and M8 are all reported green. The final suite,
coverage and choreography receipts for each milestone are retained under
[`evidence/`](./evidence/), with the builder's milestone clocks in
[`milestones.json`](./milestones.json).

The scale replay settled all 167,157 source actions and passed invariant and
entity-total verification. The compact record retains its clocks, settlement
accounting, 10%, 50% and final verification/API/browser checkpoints, and final
entity totals. The implementation changed after the 10% checkpoint, and the
original 50% browser startup timed out before the builder repaired the repost
aggregate and resumed the same store and clock. The retained performance
summary therefore declines a uniform-code comparison. Its strict Insights and
Trending midpoint checks fail; the other recorded degradation checks pass.

Published authentication admission at 30 attempts per socket peer per minute
drove registration pacing; the builder used backoff and did not bypass it. The
first M5 green suite bytes were overwritten before archival, leaving the
recorded hash without matching retained bytes. The final M5 suite and green
choreography are hash-bound and retained. See
[`scale-auth-rate-limit.txt`](./evidence/scale-auth-rate-limit.txt),
[`scale-performance-summary.json`](./evidence/scale-performance-summary.json),
and [`record-custody-gap.md`](./evidence/record-custody-gap.md).

[`run-record.pending.json`](./run-record.pending.json) preserves the builder's
known values and explicit nulls. It is intentionally not a scored,
schema-valid run record because driver custody and independent grader fields
were unavailable inside the lane; the exact validation result is retained in
[`run-record-validation.json`](./evidence/run-record-validation.json).
Twenty-five explicit correction loops are retained: 2 attributed to a
Snapback defect and 23 to agent error.

## Retained files

The builder's report, diary, essay, run log and terminal answer are copied
verbatim beside its start/end lifecycle receipts. Compact evidence includes:

- canonical final suite, coverage, choreography and observation receipts for
  all seven continuous milestones;
- scale clocks, verification, API probes, browser checkpoints, entity totals,
  settlement accounting, celebrity-write and group-render probes;
- correction-loop, record-validation, authentication-limit and M5 custody-gap
  records.

[`COPIED_FILES.json`](./COPIED_FILES.json) lists every one of the 62 copied
files with its source root, original relative path, byte count and source
SHA-256. Each destination was compared byte-for-byte with its source after
copying. The independently produced `cli-usage.json` and
`instrument-integrity-after-builder.json` are separate run-custody receipts
owned by the orchestrator.
