# Snapback 4: Restore confirmed state when a predicted write is refused

Status: Open
Priority: P1
Observed: 2026-09-12
Review finding: R10
Evidence: Reproduced end to end against the real HTTP server
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.001](../llp/3000.001-durable-replica-and-write-lifecycle.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

Predictions overwrite confirmed rows in place. The outbox records touched ids
without enough before-state to undo an update or delete. On server refusal,
flush deletes a pending row rather than restoring its confirmed image. The
server made no commit, so subsequent incremental sync does not repair it.

Reproduction: sync `items['a'] = {body: "start"}` with `body: text <=5`.
Call an edit mutation with `"too-long"`. Local prediction admits it; the server
returns `E_INPUT`. The local row becomes null and remains null after explicit
sync, while the server still returns `"start"`. The local read reports
`complete: true, fresh: true`.

Keep a recoverable confirmed base and rebase/remove the refused prediction.
Cover update, delete, maintained values, and two queued writes touching the
same row so rejecting or acknowledging the first cannot erase the second.
Local argument validation should avoid this particular bad prediction, but
validation alone is not a fix: valid predictions can still be refused because
server state changed. See LLP 3000.001 for representation alternatives.

## Implementation locations

- [packages/snapback4/src/local.ts](../snapback4/packages/snapback4/src/local.ts)
- [packages/snapback4/src/replica/interpreter.ts](../snapback4/packages/snapback4/src/replica/interpreter.ts)
