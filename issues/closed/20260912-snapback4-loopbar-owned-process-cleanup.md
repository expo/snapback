# Snapback 4: Limit loop-bar cleanup to recorded process ownership

Status: Closed
Resolved: 2026-09-13
Priority: P2
Observed: 2026-09-12
Review finding: R30
Evidence: Code traced; no cleanup command executed
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.002](../../llp/3000.002-end-to-end-resource-bounds.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

`stopLaneServers` discovers processes by a name regex and kills them when an
`lsof` cwd string starts with the lane path. Prefix matching considers
`/runs/run-10` a child of `/runs/run-1`, so cleanup can stop a different lane's
server. It also conflicts with the adopted rule to kill only PIDs recorded at
launch, not processes discovered by pattern.

Track the PIDs launched for the lane, bind cleanup to that recorded ownership,
and use exact normalized path containment where paths are needed. Do not use
process names or a raw string prefix as evidence of ownership. Exercise the
selection logic with sibling names `run-1` and `run-10`, a missing process, and
an unrelated Snapback server. The test must never send a signal to a real
unowned process. Keep temporary store deletion similarly confined to the
owned lane; this review did not execute that deletion path.

## Implementation locations

- [loopbar/run.mjs](../../snapback4/loopbar/run.mjs)

## Resolution — 2026-09-13

Loop-bar verification uses an isolated project/store and owns launched process handles. Cleanup no longer enumerates or signals processes by global command/path patterns.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [packages/snapback4/test/loopbar.test.mjs](../../snapback4/packages/snapback4/test/loopbar.test.mjs)
