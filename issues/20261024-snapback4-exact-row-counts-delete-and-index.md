# Snapback 4: require exact row counts for serial deletes and index writes

**Status:** Open
**Opened:** 2026-10-24
**Area:** snapback4 store adapters (SQLite and Postgres), committer outcomes
**Related:** LLP 3000.009.001.000.002 §3.3/§6 G3b fix round 1

G3b fix round 1 made serial `put` require exactly one affected row on both
stores, so a suppressed row-image write (e.g. a `BEFORE UPDATE` trigger that
returns NULL / `RAISE(IGNORE)`) is a store error instead of a phantom commit.
The fix-round review (Sol, 2026-10-24) found two inherited holes of the same
class, predating G3b:

1. **Deletes.** `postgres/store.rs` (~944) and `store.rs` (~829) discard the
   primary `DELETE` count. A suppressed delete leaves the row while index
   entries and cap counts are removed and the deletion event and keyed
   receipt commit.
2. **Index writes.** Index `INSERT`/`DELETE` counts are unchecked
   (`postgres/store.rs` ~924, `store.rs` ~810). A suppressed index insert
   commits a row without its index entry; unique probes can then miss it.

Fix: every serial adapter write validates its expected affected-row count
(row and each index delta); a mismatch is a store error that rolls back.
Witnesses on both stores with suppressing triggers on `r` (delete) and the
index relation (insert/delete), future deadlines so retry paths run.

Reachability: requires triggers on Snapback-managed relations, outside the
managed profile; landed as fix-forward per LLP 0232.
