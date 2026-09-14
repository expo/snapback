# Muse continuous builder evidence

**Status: continuous builder captured with actual exit 130; holistic score 80,
independent grading pending.** The foreground `muse-spark-1.3` xhigh builder started at
`2026-09-14T00:40:41Z` and ended at `2026-09-14T05:34:59Z`, with a
driver-measured wall of 17,657.686 seconds. The exit code is preserved exactly.
After three public `run.terminal.completed` events, the Muse runtime submitted
two empty background-terminal continuation turns and restarted managed shell
work. The orchestrator sent SIGINT to the foreground wrapper to stop that loop;
these records do not relabel the resulting exit 130 as success.

The original lane is
`/Users/ccheever/clique-sb4-20260913-full-3models/lanes/muse-snapback4`, and the
canonical private source capture is
`/Users/ccheever/clique-sb4-20260913-full-3models/snapshots/muse-continuous`.
Relative links absent from this archive resolve against those external paths.
The copied reports are builder assertions. Qualification receipts retain
orchestrator observations without changing the report bytes.

## Builder result and evidence limits

The builder reports M1, M2, M3, M4, M5, live, M6 and M8 green. Its
per-suite counts sum to 129 checks, while its prose says 133; this discrepancy
is retained, and neither count is an independent grade. The lane contains no separate
per-milestone suite receipts. The compact retained coverage consists of seed
receipts for M1–M3, a 50-action replay, and the final reduced scale replay and
verifier. The builder also produced a 2,788,000-byte iOS Hermes bundle pinned by
SHA-256; it produced no interactive iOS simulator evidence.

Four replay-producing scale attempts are preserved:

| Attempt | Selected local corpus | Replay | Verifier | Qualification |
| --- | ---: | ---: | ---: | --- |
| 1 | 36,809 actions | 33,696 pass, 3,113 fail | absent | red |
| 2 | 36,809 actions | 36,809 pass | absent | replay only; exact start bytes were not retained |
| 3 | 36,805 actions | 36,805 pass | 87/88 | red |
| 4 | 36,804 actions | 36,804 pass | 88/88 | reduced local pipeline green, with a non-atomic start-hash limit |

Four earlier scale-driver launches failed before these four reports were
produced. The final reduced log has SHA-256
`9680fdc1fc2165ee69f94f478aa996fa0cbd027d67cd2b3fd4491c646f38356b`.
It was observed during attempt 4 and remained unchanged after that attempt and
at builder exit. The full replay chronology and corpus bindings are preserved
in the
[`final-scale-choreography-audit.json`](./qualifications/final-scale-choreography-audit.json)
receipt.

The frozen fixture contains 167,157 actions and has SHA-256
`b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9`.
It was readable through the lane's pre-existing `instrument` symlink, contrary
to the builder report's literal statement that it was not present in-lane.
All eight observed scale-driver invocations selected the locally generated
`scale.log`; the frozen corpus was never replayed or qualified.

The lane copied all 16 frozen choreography files byte-for-byte. It created no
choreography result receipt, and its only direct choreography entrypoint call
was `--help`. No frozen choreography execution result is claimed.

## Fairness and timing qualifications

The metadata-only source-access audit found 23 public commands that targeted
installed Snapback implementation JavaScript or TypeScript: 21 completed with
exit 0 and two exited 1 after explicitly targeting implementation paths. No
public command argument named a Snapback repository checkout. This violates the
builder brief's source-access boundary and is carried as an orchestration
qualification; it is not folded into an independent assertion score.
[`muse-finished-builder-source-access-audit.json`](./qualifications/muse-finished-builder-source-access-audit.json)
records event hashes and normalized paths without raw commands or tool output.

The run-log clock observation found authored epochs up to 959.834 seconds ahead
of the observer clock. Builder-authored milestone and correction epochs are
therefore kept separate from the foreground start/end receipts and are not
treated as independently qualified timing.
The lifecycle and intervention evidence is retained under
[`qualifications/`](./qualifications/), alongside the capture preflight and
post-terminal cleanup receipt.

## Custody

[`COPIED_FILES.json`](./COPIED_FILES.json) lists the 34 verbatim copied files,
their source roots, byte counts and SHA-256 digests. Source and destination
bytes were compared after exclusive creation. Candidate text and JSON were
checked for credential-bearing lines before copying; none of the selected
files required alteration or omission.

The raw CLI streams, 195-file compressed source snapshot, final reduced
`scale.log`, frozen full-scale fixture, and Hermes bytecode remain external.
Their full paths, byte counts and hashes are in
[`retained-artifacts.json`](./retained-artifacts.json). The raw CLI streams are
represented only by hashes because they may contain private model bodies.
Credential and runtime-state files, including replay credentials, worker
credentials and `.snapback4`, were excluded from the canonical source capture
and are not recorded by value or hash here. The copied
[`snapshot-manifest.json`](./snapshot-manifest.json) binds the source archive,
its [`source-inventory.sha256`](./source-inventory.sha256), capture helpers,
package-pin receipt, native artifact receipt and lifecycle qualifications.
