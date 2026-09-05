# P1 Snapback 2: shrinking a query array evicts a row in the new delivery

**Status:** Open
**Priority:** P1
**Systems:** client range-store hidden-row detection and eviction
**Date:** 2026-09-05
**Source:** Codex local-data review; reproduced/inspected at `23e89b4a17fecb713b7ca61681cf6f4f969c8536` (product tree equal to locally tracked origin/main `11e2e60984e756128aa0091b4c6c36ff82094ecb`).
**Related:** LLP 1012 §5, default retain until-revoked

## Problem

`hiddenRefs` compares array positions. A shortened array is treated as if an
old trailing slot became hidden, even when that row moved earlier in the new
array. The resulting eviction applies globally and defeats the freshly
delivered row at the same sequence.

Site: `snapback2/packages/snapback2/src/store/range-store.ts:422–425`.

## Reproduction and observed result

Use the default retention policy and the same operation and arguments:

1. At seq 1, deliver `[a, b, c]` as three row references with all three rows pooled.
2. At seq 2, deliver `[b, c]` with both rows pooled.
3. Read the held answer.

Expected: the two new rows, `[b, c]`.
Observed: `[b, null]`, with `state: "partial", reason: "evicted"`.

The vanished third array slot is mistaken for revocation of c. Its seq-2
eviction deletes the seq-2 row. Other answers holding c can lose it too.

## Resolution and acceptance

Recognize row identities present elsewhere in the fresh delivery and
distinguish an array shortening from a null in a stable slot. Use receipt
extents for page membership rather than treating truncation as hidden-row
evidence.

Verify deleting first/middle items, reorderings, and shortened limited pages
preserve fresh rows and other held answers. Keep genuine null/denied
revocation behavior and explicit absences/tombstones.

## Review qualification

The package was rebuilt before verification. Existing selected client/carrier
suites passed 251/251 and Rust offline/replay/retention tests passed 37/37.
The new review reproductions expose gaps in that coverage. This ticket is
self-contained; temporary review artifacts are not required to implement it.
