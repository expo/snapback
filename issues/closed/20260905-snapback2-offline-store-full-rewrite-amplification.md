# P2 Snapback 2: a small outbox update rewrites all retained history

**Status:** Closed
**Priority:** P2
**Systems:** range-store commit, SQLite and IndexedDB persistence
**Date:** 2026-09-05
**Source:** Codex local-data review; reproduced/inspected at `23e89b4a17fecb713b7ca61681cf6f4f969c8536` (product tree equal to locally tracked origin/main `11e2e60984e756128aa0091b4c6c36ff82094ecb`).
**Related:** LLP 1013 §2 and §14 (measure before incremental writes), LLP 1012 §4

## Measured problem

`snapback2/packages/snapback2/src/store/sqlite.ts:97–105` deletes and
reinserts all rows, answers and outbox entries for every swap, including a
swap that only adds one small outbox entry. The shared commit path also
clones/serializes the full state. IndexedDB similarly clears its state stores.

## Reproduction method and evidence

Desktop Node SQLite, the existing `nodeSqliteDriver`, `SqliteBackend`
and `PersistentRangeStore`. Seed N messages with 500-character bodies in
50-row held answers. Then perform three successive commits, each adding
one small queued outbox entry and changing no history rows. Instrument
`tx.run` to count INSERTs; measure `await store.commit(...)` with
`performance.now()`.

| Rows | Update times (ms) | INSERTs in last update | Serialized state bytes |
|---:|---:|---:|---:|
| 1,000 | 22 / 22 / 16 | 1,024 | 1,324,230 |
| 5,000 | 112 / 105 / 97 | 5,104 | 6,658,555 |
| 10,000 | 195 / 204 / 209 | 10,204 | 13,326,555 |

The serialized size is not physical flash-write volume. These are desktop
measurements, not Expo simulator measurements. They establish proportional
history work for a tiny metadata update. Repeated enqueue, grant and
settlement swaps amplify it. Plaintext delivery fingerprints contribute
to the size (see the purge-content ticket).

LLP 1013 deliberately deferred incremental writes until measurement; this
ticket supplies that measurement rather than treating the initial decision
as an undocumented regression.

## Resolution and acceptance

Preserve atomic state/byte transactions while writing only changed state
entries. Avoid full-history cloning for outbox-only updates.
Repeat the documented workload and show that changing one outbox entry
does not reinsert unchanged history rows. Keep existing crash/rollback
and carrier parity proofs. Measure Expo before making phone-latency claims.

## Review qualification

The package was rebuilt before verification. Existing selected client/carrier
suites passed 251/251 and Rust offline/replay/retention tests passed 37/37.
The new review reproductions expose gaps in that coverage. This ticket is
self-contained; temporary review artifacts are not required to implement it.

## Resolution — 2026-09-05

SQLite and IndexedDB write changed rows, answers, outbox records, and
metadata fields in the same atomic transaction as byte changes. SQLite has
a metadata table for independently changing fields; the scalar header remains
small. Custody-only swaps share unchanged immutable history, and projection
caches advance only after successful commit.

The documented 1k/5k/10k workload now writes exactly two records per enqueue
(one outbox entry and the scalar header), with no history inserts/deletes.
Ordinary updates measured below 0.5 ms for all nine desktop samples; the
original instrumentation omitting the previous-state hint measured 7/6/6 ms
at 10k rows, versus 195/204/209 ms before. LLP 1013 records the method and
scope. These are desktop measurements, not phone-latency claims.

Carrier parity, rollback/SIGKILL, legacy normalization, and returned-data
immutability regressions pass.

The complete package run passed 364 tests with one existing skipped
process-control placeholder; no package tests failed. The implementation,
regressions, and guide/LLP updates ship together with this ticket closure.
