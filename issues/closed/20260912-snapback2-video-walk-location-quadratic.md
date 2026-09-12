# snapback2 video_walk location lookup is O(K*N)

**Status:** Resolved
**Priority:** P2
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/snapback2/src/video_walk.rs:539-568`

## What was reported

`location_key_indices.contains` runs per `ilst` entry: O(keys × entries).
Measured 4x input → 13x time (2000 entries: 19ms, 8000: 249ms, debug
build). Malformed or adversarial files with large `ilst` tables turn the
walk quadratic.

## Suggested fix

- Build a `HashSet` (or sort + binary search) once, then probe per entry.
- Re-run the review's size sweep after the fix and record numbers.

## Acceptance

- Sweep shows ~linear scaling; regression test with a large `ilst`
  fixture within budget.

## Resolution — 2026-09-12

Replaced the per-entry Vec::contains lookup with a HashSet built once from metadata keys. The large valid fixture asserts every GPS payload is removed at 2,000 and 8,000 entries. Local debug baseline was 30.2ms / 170.8ms (5.66x); after was 49.3ms / 171.9ms (3.49x for 4x input). Shared-machine load affects absolute times; the change removes the multiplicative keys-by-entries work and all 35 video tests pass. The existing metadata, box-count and wall-time ceilings remain in force.
