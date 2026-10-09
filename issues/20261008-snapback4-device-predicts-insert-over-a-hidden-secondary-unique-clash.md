# Snapback 4 device predicts an insert whose secondary unique value clashes with an unheld row

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 5
**Systems:** Snapback 4, device prediction, unique keys
**Class:** device defect or contract gap (prediction eligibility); not security-relevant
**Date:** 2026-10-08
**Related:** LLP 3000.035 §5.1 (found by the widened generator, lane GW, `run-devices`/`run-lean --seed 0 --cases 20000`)

Not security-relevant: the server refuses the write; the device's pending row
is withdrawn on settlement and the device converges.

The closed ticket `issues/closed/20261008-snapback4-device-predicts-insert-over-an-unheld-id.md`
was ruled (keep predicting supplied-id inserts; document the typed refusal).
Its named harness outcome covers only an insert whose **id** belongs to an
unheld row. The widened generator now reaches the other shape that ticket's
test planted by hand (`tests/devices.rs::a_predicted_refusal_of_another_shape_is_still_a_disagreement`):
a fresh id whose **secondary unique** value is held by a row the device does
not hold.

```quarry
table items:
  owner: principal
  ...
  tag: id
  unique byTag: tag
  read <- .owner = viewer
  insert <- .owner = viewer
  ...
  sync to .owner

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  insert items { id: k2, owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag0' }
  return true
```

alice's row `r0` holds `tag: 'tag0'`; bob inserts `missing2` with `tag0`. The
device (both stores) predicts `items/missing2`; the server refuses `E_RULE`
("a unique key ... contains a row you cannot read"). The prediction card says
"A hidden unique collision or cap population cannot be ruled out locally" for
`upsert`'s insert arm, which therefore queues; a plain insert predicts.

**The question:** extend the 2026-10-08 ruling to secondary unique keys (and
then the oracle's named outcome too), or make a plain insert with an
uncovered secondary unique key queue like the upsert. In seeds 0–19,999: 5 per
store under this signature; 7 per store matched the ruled unheld-id outcome
(the named condition now also recognises a block whose first write is that
insert, `device_writes.rs::first_insert`).

The signature string is shared with the ruled regression cases retained under
`cases/found/device-*--write-predicted-refused--admitted` (which replay as the
named outcome); a shrunk case of this shape is above.

## Scheduled-run signatures

**Failure signature:** `device-memory--write-predicted-refused--admitted`  
**Failure signature:** `device-sqlite--write-predicted-refused--admitted`  

Recurrences:
