# Grok continuous builder evidence

**Status: builder complete; independent grading pending.** The foreground
`grok-4.6` xhigh builder exited 0 at `2026-09-14T00:40:23Z`. The driver-measured
wall was 12,499.35 seconds. Builder-authored reports and clocks are preserved
verbatim; the qualifications below are orchestration findings, not edits to
those assertions.

The original lane is
`/Users/ccheever/clique-sb4-20260913-full-3models/lanes/grok-snapback4`.
Relative report links absent here resolve against that external lane. The
canonical 228-file source snapshot and raw CLI logs remain external. Their
hashes are retained in [`snapshot-manifest.json`](./snapshot-manifest.json) and
[`raw-cli-log-references.json`](./raw-cli-log-references.json); raw model stream
bodies and private reasoning are not copied.
The post-builder
[`instrument-integrity-after-builder.json`](./instrument-integrity-after-builder.json)
receipt independently verifies all 177 frozen instrument files, read-only
modes and prompt-template hashes after the builder exited.

## Builder result and receipt qualification

| Milestone | Builder assertion | Retained public evidence | Orchestration qualification |
| --- | --- | --- | --- |
| M1 | green | passing suite receipt with 7 mapped IDs and 3/3 required choreography checks pass | Web green is supported; no successful native Hermes artifact. Exact first-green time is unbound. |
| M2 | green | passing suite receipt with 22 mapped IDs and 9/9 required choreography checks pass | Web green is supported; no successful native Hermes artifact. Exact first-green time is unbound. |
| M3 | capability-failure | partial HTTP suite passes; 1 of 6 implemented choreography checks passes | Among five required checks, one passes and four fail. The milestone stopped before its four-hour allowance was exhausted. |
| M4 | blocked-by-M3 | partial HTTP suite passes; no choreography receipt | Partial suite coverage is not a milestone green. |
| M5 | blocked-by-M3 | partial HTTP suite passes; no choreography receipt | Partial suite coverage is not a milestone green. |
| M6 | blocked-by-M3 | partial HTTP suite passes; no choreography receipt | Partial suite coverage is not a milestone green; scale did not verify. |
| M8 | blocked-by-M3 | partial HTTP suite passes; no choreography receipt | Partial suite coverage is not a milestone green. |
| M7 | not-run | none | Separate fresh phase remains pending. |

The suite receipts cover 7, 22, 7, 5, 6, 5 and 6 assertion IDs for M1, M2,
M3, M4, M5, M6 and M8 respectively. They do not establish full milestone
coverage by themselves. The aggregate `receipts/suite-status.json` is also
preserved verbatim even though its final overwrite reports only M8 true;
individual suite-status and suite files retain the other partial passes.

The builder attempted iOS exports for M1 and M8 and reported Hermes private
field failures. No valid native Hermes bundle is claimed for any milestone.

## Timing and budget limits

The builder wrote M1 and M2 first-green epochs of `1789336500` and
`1789337500`. The retained passing segment summaries are timestamped
`1789336765.868` and `1789338595.219`, 265.868 and 1,095.219 seconds later.
The orchestrator captured both receipt sets at `1789338857` and explicitly
recorded that this was not a reconstructed first-green observation. M1 and M2
are therefore supported as green, while their exact first-green epochs remain
unknown. [`timing-audit.json`](./timing-audit.json) keeps the driver,
builder-authored, receipt and observation clocks separate.

The frozen prompt allows four hours per milestone; unused time is not a single
session-wide pool. Replay execution has a separate recorded clock and cap. The
builder stopped M3 after reporting more than two hours of correction and
stopped scale 233 seconds after its recorded start, citing remaining session
wall. Neither interval exhausted its applicable allowance. This result is a
partial attempt and does not measure capability or scale correctness under the
full permitted time. Scale ended before invariant verification and produced no
passing fixture-bound result.

## Custody

The copied `final-report.md`, `diary.md`, `essay.md` and `run-log.md` are the
builder's verbatim narrative. `receipts/` preserves all public suite, coverage,
suite-status and available M1–M3 choreography receipts. The orchestrator
observation copies under `observed-milestones/` bind the later M1/M2
observation without changing their timing meaning.

Verbatim custody includes the original Markdown hard-break spaces in
`final-report.md` and final blank line in `diary.md`. Authored record files
pass the whitespace check; those two source copies intentionally retain their
original bytes and hashes.

[`COPIED_FILES.json`](./COPIED_FILES.json) lists every copied file with its
source root, original path, byte count and source SHA-256; destination bytes
were checked against each source. The source-capture replacement and corrected
helper digest are recorded in
[`source-capture-correction.md`](./source-capture-correction.md).
