# Snapback 4 device predicts an insert whose caller-supplied id belongs to a row it does not hold

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** Snapback 4, device prediction, engine write path
**Date:** 2026-10-08
**Related:** LLP 3000.035 §5.1 (found by the server-against-device oracle, slice C), guide `prediction`, LLP 3000.007 §8 item 7

The device oracle admits each generated mutation on a device that acquired the
same rows through `/sync`, then runs it on the server. A device admission is
either a definite refusal (final for the client), a prediction, or a queued
write without a row (`E_PREDICT`). On an insert with a caller-supplied id into a
table synced only to its owner, the device predicts and the server refuses:

```quarry
table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: id
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

mutation run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  insert items { id: key, owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  return true
```

With bob's row `items { id: "r0", owner: "bob", … }` on the server, alice calls
`run(key: "r0", …)`:

- **Device** (both stores): `admit` predicts it (`predictable: true`,
  `predicted: ["items/r0"]`); `observe("r0")` shows alice's pending row.
- **Server**: refuses with `E_RULE` ("… a unique key or cap group contains a row
  you cannot read …").

After `settle` and the next sync round the device withdraws the row and agrees
with the server, so LLP 3000 §6 invariant 4 (convergence or a typed conflict)
holds. What fails is the guide's eligibility statement: a prediction needs its
facts on this device, and the absence of `r0` is not one alice's partition can
establish (`sync to .owner` never delivers bob's rows).

**Cause, from the lane's reading.** An `upsert` proves its insert arm's absence
on a device (`engine/write.rs::insert_attempt` calls `prove_upsert_insert` when
`self.device`); a plain `insert` does not check the uniqueness of a
caller-supplied id against rows outside the held partition. An update or delete
of an unheld target queues instead (`write_target.rs::write_miss`, `E_PREDICT`).

**The question.** Either a device insert with a caller-supplied id (or any
supplied unique key) into a partitioned table must prove absence, or queue
with `E_PREDICT` as an update does; or the contract states that such a
prediction can end in a typed conflict, and the oracle gets a named exception
for it. Client-minted ids are not affected in practice.

**Reproduce** (from `snapback4/`; no database):

```sh
cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/device-sqlite--write-predicted-refused--admitted
cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/device-memory--write-predicted-refused--admitted
```

Exit 1 with the signature means it still reproduces.

## Scheduled-run signatures

**Failure signature:** `device-sqlite--write-predicted-refused--admitted`  
**Failure signature:** `device-memory--write-predicted-refused--admitted`  

Recurrences:
