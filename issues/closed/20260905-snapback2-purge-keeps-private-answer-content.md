# P1 Snapback 2: purging a row leaves its body in persisted answers

**Status:** Closed
**Priority:** P1
**Systems:** client range-store eviction and persistence; all carriers
**Date:** 2026-09-05
**Source:** Codex local-data review; reproduced/inspected at `23e89b4a17fecb713b7ca61681cf6f4f969c8536` (product tree equal to locally tracked origin/main `11e2e60984e756128aa0091b4c6c36ff82094ecb`).
**Related:** LLP 1012 §5 (retention and revocation), §4 (rows stored once)

## Problem

The shared store retains private content after an authoritative tombstone or
primary absence evicts the source row. The delivery fingerprint is the complete
canonical delivery string, including pooled row bodies. Eviction deletes the
row and updates answer references but leaves that string. Inline projected
answer data is also retained.

Sites at the reviewed revision:
- `snapback2/packages/snapback2/src/store/range-store.ts:878` — fingerprint includes `delivery.rows`.
- The same file, lines 997–1003 — eviction changes refs/state/reason without
  removing the fingerprint or projected data.

## Reproduction and observed result

1. Open a `PersistentRangeStore` with a backend whose `replace(state)` captures
   the persisted state.
2. Commit a complete answer with `data: {$row: {table: "messages", id: "a"}}`
   and a pooled row `{table: "messages", id: "a", row: {id: "a", body: "SECRET_BODY_8412"}}`,
   sequence 1.
3. Commit `{tombstones: [{table: "messages", id: "a", seq: 2}]}`.
4. Observe that `coverage().rows` is empty, but
   `JSON.stringify(persistedState).includes("SECRET_BODY_8412")` is true:
   the fingerprint still carries the entire row.
5. Repeat with the original answer's data set to
   `{body: "SECRET_BODY_8412"}`, keeping the same pooled source row.
   After the tombstone, `store.answer(op, args)` still exposes that body in
   `data`, labeled `partial/evicted`.

Both paths were reproduced against the rebuilt package. This is content
retained in the current logical state, not forensic recovery of deleted
database pages. The state is shared by IndexedDB, SQLite and the file carrier.

## Resolution and acceptance

Use a digest instead of storing the delivery bytes as a fingerprint. Invalidate
or scrub derived answer data whose source rows have been evicted; changing its
status alone does not purge the content.

Verify tombstones and primary absences remove the sentinel from all current
persisted answer records, and from held-answer reads, across carrier round
trips. Preserve unrelated rows and answers.

## Review qualification

The package was rebuilt before verification. Existing selected client/carrier
suites passed 251/251 and Rust offline/replay/retention tests passed 37/37.
The new review reproductions expose gaps in that coverage. This ticket is
self-contained; temporary review artifacts are not required to implement it.

## Resolution — 2026-09-05

Delivery fingerprints now store SHA-256 digests, including normalization of
older snapshots. Purges scrub derived answer literals as well as pooled rows;
other still-held row references remain usable. Sanitized legacy fingerprints
persist on the next swap even when it changes only metadata. Current logical
state no longer keeps the purged body in either location.

Verified by the original privacy reproductions and carrier regressions in
`store-review.test.ts`, including reopen and immutable returned-row behavior.

The complete package run passed 364 tests with one existing skipped
process-control placeholder; no package tests failed. The implementation,
regressions, and guide/LLP updates ship together with this ticket closure.
