# Snapback 4: require exact row counts for serial deletes and index writes

**Status:** Closed
**Closed:** 2026-10-24
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


## Resolution — 2026-10-24, lane FF1

Both serial adapters now validate exactly one affected row for primary
`DELETE` and every individual index `INSERT`/`DELETE`, using the existing
driver return value. Mismatch is E_STORE and rolls back the transaction.
PostgreSQL's existing zero-row primary-insert Rule refusal is unchanged.

The ten `serial_delta_*` suppressing-trigger witnesses in
`snapback4-core/src/store/serial_write_tests.rs` fail on `115be62c28` with
only the witnesses added (0 passed/10 failed). On the fix all ten pass;
40 keyed attempts reject suppression, including live named recovery under
30-second deadlines. They compare complete durable snapshots and physical
index entries, then prove progress after removing the trigger.

Strict checks also exposed legitimate incomplete heaps during activation.
Retained-only retirement now removes provenance without a phantom live-row
delete; restored unindexed source retirement checks its primary deletion;
capture maintains predecessor/identity indexes until the candidate rebuild.
The existing dormant and generated-lifetime witnesses fail on the initial
strict-check implementation and pass after this phase correction. Full core
qualification is 1,231 passed/0 failed/387 ignored; the final complete
binary, RT0 and PostgreSQL results are recorded in the FF1 JOURNAL entry.

The paired N=32 durable PG16 loopback diagnostic measures W4 medians
3055.5 → 2976.6 writes/s (−2.58%) and W5 shared 2375.2 → 2322.5 (−2.22%).
Counterbalanced block means are +0.48%/+0.20%, with intervals spanning zero:
no marginal cost is detected, while small differences remain unresolved.
There are 0 added SQL statements/flights; all 194,974 timed acknowledgements
reconcile, with zero errors. This is a native core diagnostic, not a scale/SLO
claim.

No extra query or flight is introduced by the count checks. See
`snapback4/JOURNAL.md`, “FF1: exact serial deltas and write-stack witnesses”,
and LLP 3000.009.001.000.002 §6 for the complete scope and qualification.
