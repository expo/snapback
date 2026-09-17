# Snapback 4: Durable record retention has no coordinated lifecycle

Status: Open
Priority: P2
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15`

## Evidence

Lead/Sol traced retained partition and membership history and operation receipts; Muse V2 traced guest principals. Identity admission deletes expired sessions but never retires the guest principal. These records grow throughout a store's lifetime. Rate limits bound arrival rate, not retained size. Deleting guest principals merely because their session expired can orphan rows and queued work; deleting receipts can execute an old retry twice.

## Acceptance

Define ownership and retention for principals, memberships/logs, operation receipts and work/step records together. Include a minimum resumable watermark/reset policy, an explicit retry horizon, and application data references. Measure sustained guest creation and membership churn. Implement conservative compaction only after these contracts are defined. LLP 3000.002 contains the alternatives; no destructive automatic cleanup is part of this review repair.

## Design proposal — 2026-09-17

The author-requested [Draft proposal for coordinated durable retention](../llp/3000.002-end-to-end-resource-bounds.research.md#durable-retention)
records the recommendation, alternatives, implementation sequence, validation
and remaining decisions. This ticket remains open; writing the proposal does
not establish implementation or acceptance.
