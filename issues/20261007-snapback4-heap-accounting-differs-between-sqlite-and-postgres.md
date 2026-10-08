# Snapback 4 heap accounting differs between SQLite and Postgres

**Status:** Open — ruled 2026-10-08: fix the engine (see Ruling)
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Snapback 4, engine meter, SQLite store, Postgres store
**Date:** 2026-10-07
**Related:** LLP 3000.035 §5.1 (found by the store oracle), LLP 3000.009 §11.1 (every outcome field identical across stores)

The Quarry differential harness runs one program on the engine over SQLite
and over Postgres. At low `heap_bytes` ceilings, the two stores disagree. In
the 2,000-case pilot, 1,184 of 30,584 Postgres attempts per prefetch mode
(3.9%) disagree, under six signatures (each with prefetch on and with it
off):

| Signature suffix | Per mode | What differs |
|---|---:|---|
| `heap-bytes-metered--value` | 969 | different retained scratch charge reported at a heap cut |
| `heap-bytes-data--value` | 83 | SQLite completes a read that Postgres cuts |
| `heap-bytes-why--NOT_FOUND` | 49 | SQLite cuts before target resolution; Postgres reaches NOT_FOUND |
| `steps-metered--value` | 54 | same step cut and site, different heap charge |
| `heap-bytes-result--bool` | 16 | Postgres commits a write that SQLite refuses |
| `heap-bytes-result--E_BOUND` | 13 | SQLite commits a write that Postgres refuses |

The sharpest shape is one row and one update, with a heap ceiling of 10,525:

```quarry
table items:
  score: int
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

mutation run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  update items[key] { score: 0 }
  return true
```

With the row `items { id: "r0", score: 9007199254740991 }`:

- **SQLite** commits the write (`state: sent`, `heap_bytes: 348`).
- **Postgres** refuses it with `E_BOUND` at `run:2` ("heap bytes reached the
  ceiling 10525") while reporting `heap_bytes: 133`.

The refusal therefore depends on reservations the public meter does not show.

**Cause, from the lane's reading.**

- `store.rs::scan_metered` (SQLite) charges page, row and decoder
  allocations.
- `engine/postgres/store.rs::scan_metered` charges two ranges, a fixed
  4,096-byte reservation, payload bytes × 256 and vector growth.

Both are physical-scratch estimates, and they differ by design.

**The question.** LLP 3000.009 §11.1 requires every outcome field, including
every meter field, to be identical across stores. Either:

- heap charging becomes a store-independent logical charge, so the same
  program under the same ceiling has the same outcome on both stores; or
- the contract rules `heap_bytes` (and the cuts and refusals it causes)
  store-specific, and the harness gets a named, argued exception.

The second option means a program that passes its heap ceiling in
development on SQLite can be refused in production on Postgres.

**Reproduce** (from `snapback4/`, with a Postgres evaluation cluster in
`SNAPBACK4_EVAL_POSTGRES`):

```sh
cargo run --release -p snapback4-difftest --features postgres -- replay crates/snapback4-difftest/cases/found/store-postgres-off--heap-bytes-result--E_BOUND
```

Exit 1 with this signature means it still reproduces. The test target
`tests/stores.rs` pins the eight signatures its fixed 33-case corpus
produces. Fixing the engine changes that set, and the test must be updated
with the fix.

## Ruling (Charlie, 2026-10-08)

Charge the public `heap_bytes` meter the same way on every store.

- Compute it from the encoded size of the values and rows that a step
  holds, not from physical scratch. The same program under the same ceiling
  then has the same outcome on SQLite, Postgres and the device.
- Protect the server's real memory with a separate internal guard in each
  store. Set it well above any realistic ceiling, and make it refuse with
  its own distinct code, never `E_BOUND`.

**Order of work.** Slice C (server against device, LLP 3000.035 §5.1) runs
first, to find out whether the device store accounts heap a third way, so
the fix is made once. The fix lane must first confirm the store-specific
charging the harness lane identified.

**Done when** the six signatures above stop reproducing, the pinned set in
`snapback4-difftest/tests/stores.rs` is updated to match, and a scheduled
store run reports no heap or step signatures.

## Scheduled-run signatures

The nightly runner (`snapback4/scripts/difftest-scheduled.sh`, LLP 3000.035
§5.1) matches open tickets by these exact lines. It appends recurrences here
and does not file a new ticket for each one.

**Failure signature:** `store-postgres-on--heap-bytes-metered--value`  
**Failure signature:** `store-postgres-on--heap-bytes-data--value`  
**Failure signature:** `store-postgres-on--heap-bytes-why--NOT_FOUND`  
**Failure signature:** `store-postgres-on--steps-metered--value`  
**Failure signature:** `store-postgres-on--heap-bytes-result--bool`  
**Failure signature:** `store-postgres-on--heap-bytes-result--E_BOUND`  
**Failure signature:** `store-postgres-off--heap-bytes-metered--value`  
**Failure signature:** `store-postgres-off--heap-bytes-data--value`  
**Failure signature:** `store-postgres-off--heap-bytes-why--NOT_FOUND`  
**Failure signature:** `store-postgres-off--steps-metered--value`  
**Failure signature:** `store-postgres-off--heap-bytes-result--bool`  
**Failure signature:** `store-postgres-off--heap-bytes-result--E_BOUND`  

Recurrences:
