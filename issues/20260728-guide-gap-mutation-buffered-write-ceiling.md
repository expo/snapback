# Guide gap: mutation buffered-write ceiling

**Status:** Open
**Area:** Guide, mutations, bulk writes
**Found by:** LLP 0102 Linear/Snapback deep-round arm

## Problem

`guide/backend/mutations.md` explains atomic buffered writes but does not state
the frozen local target's exact 1,024-write ceiling. A production-shaped seed
attempt therefore failed only at runtime with:

`SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED: one mutation may buffer at most 1024 writes`

The diagnostic was actionable, but the guide should have prevented the failed
attempt.

## Suggested resolution

Document the exact ceiling on the local profile, explain which operations count
as buffered writes, and show the recommended bounded bulk-write or import
pattern. Add or update the corresponding capability-index row if bulk import is
not currently a paved product capability.

## Evidence

- `demos/backend-bakeoff/arms/linear/snapback/receipts/failed-attempts.v1.json`
- `diaries/0029-linear-backend-bakeoff.diary.md`
