# Snapback 4: A stale local refusal can cancel a stranded journal intent

Status: Closed
Priority: P2
Observed: 2026-09-16
Reproduction: repair candidate `f6b514c35`, full Linux client suite

## Evidence

The W4R1 C cancellation test fails when neither localStorage nor IndexedDB can
record cancellation of a known local refusal. After storage recovers and the
server condition changes, lazy VM restoration immediately recovers the executable
journal against old local rows. The old LOCKED condition becomes a permanent
cancellation before sync can acquire the server's change. Orphan recovery uses
the same admission path and can make the same stale decision. The earlier fixture's
no-owner opening suppressed journal recovery and hid this composition.

## Resolution — 2026-09-16

Recovery treats a surviving executable journal entry as a replay candidate.
The existing device admission path retains successful prediction but converts a
local refusal into an unpredicted durable outbox entry; the server decides its
outcome. Live admission and cancellation are unchanged. Transfer markers,
store identity fences, original IDs and FIFO still apply. This also preserves
offline custody without a new host callback or wire operation.

The original cancellation assertion is retained, with custom-ownership,
orphan and offline-reopen coverage. Integrated qualification and reviewed
commits are in [the review index](../../llp/reviews/3000-complete-code-review-20260916.md).

Follow-up implementation: `7e0fc21da8d7675b4a5ec2a418604b2135c438a9`.
