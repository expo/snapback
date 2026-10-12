# Snapback 4 device refusal after an unproved prediction reports a different code than the server

**Status:** Closed (2026-10-12, fixed: a refusal after an unproved insert queues for the server's verdict; lane EX, branch `sb4/device-meter-expiry`)
**Impact:** 3
**Urgency:** 2
**Ease:** 2
**Confidence:** 4
**Systems:** Snapback 4, device admission, mutation blocks
**Class:** device defect (admission contract); not security-relevant
**Date:** 2026-10-08
**Related:** LLP 3000.035 §5.1 (found by the widened generator, lane GW, `run-devices`/`run-lean --seed 0 --cases 20000`)

Not security-relevant: nothing commits on either side and the device's code
is computed from its own predicted state.

The device's admission refusal is final for the client (`local.ts`): the
write is never sent and the client reports the device's code. The oracle
requires that refusal to equal the server's. With multi-statement mutations
(the widened generator's blocks) it does not when the block's first write
rests on an unproved fact: an insert over an id or a secondary unique value
held by a row the device does not hold. The device predicts that insert (the
ruled behaviour, and the shape of the secondary-unique ticket), continues over
its own predicted row, and reaches a definite refusal later; the server
refuses `E_RULE` at the first insert.

```quarry
mutation run(key: id, k2: id, ...):
  insert items { id: key, owner: viewer, ... tag: 'tag' }
  insert items { id: key, owner: viewer, ... tag: 'tag' }
  return false
```

alice holds `r0`; bob runs with `key: "r0"`: server `E_RULE`; device
`E_CONSTRAINT` ("items already has a row with id r0"), from the second
insert over its predicted row. The other two retained cases end in
`NOT_FOUND` (a second `delete` of the predicted row) and `E_OVERFLOW` (an
arithmetic read of the predicted row).

The 2026-10-08 ruling says such a prediction "can end in a typed server
refusal that withdraws the pending row"; here the client instead reports a
local code and never asks the server. **The question:** should a definite
local refusal that depends on an unproved prediction be downgraded to a
queued write (`E_PREDICT`) so the server's code is the one reported, or should
the guide say the client may report a later statement's code?

Counts in seeds 0–19,999: one per store per signature.

## Scheduled-run signatures

**Failure signature:** `device-memory--write-refused--E_CONSTRAINT`  
**Failure signature:** `device-memory--write-refused--E_OVERFLOW`  
**Failure signature:** `device-memory--write-refused--NOT_FOUND`  
**Failure signature:** `device-sqlite--write-refused--E_CONSTRAINT`  
**Failure signature:** `device-sqlite--write-refused--E_OVERFLOW`  
**Failure signature:** `device-sqlite--write-refused--NOT_FOUND`  

Recurrences:

- 2026-10-09: run `20261009T011321Z-eb3eb4e7`, seed `89`, commit `74f3a1dd3240287cd7f5405ed55588e0c93db8e5`.

- 2026-10-09: run `20261009T011321Z-eb3eb4e7`, seed `11906`, commit `74f3a1dd3240287cd7f5405ed55588e0c93db8e5`.

- 2026-10-09: run `20261009T011321Z-eb3eb4e7`, seed `10442`, commit `74f3a1dd3240287cd7f5405ed55588e0c93db8e5`.

- 2026-10-10: run `20261010T000005Z-fe12e802`, seed `15623`, commit `e92ba8687bc6e363cf5f76436f53d8b3bacdd284`.

- 2026-10-11: run `20261011T000003Z-f1e6f481`, seed `26630`, commit `2135415fe9484dd8ba17466b9c80bcb05536cb44`.

- 2026-10-11: run `20261011T000003Z-f1e6f481`, seed `27883`, commit `2135415fe9484dd8ba17466b9c80bcb05536cb44`.

- 2026-10-12: run `20261012T000004Z-bbc18bf6`, seed `35109`, commit `1c47f02cd8faca7b0997644f4cc111711f7c8291`.

- 2026-10-12: run `20261012T000004Z-bbc18bf6`, seed `32196`, commit `1c47f02cd8faca7b0997644f4cc111711f7c8291`.

- 2026-10-12: run `20261012T000004Z-bbc18bf6`, seed `42429`, commit `1c47f02cd8faca7b0997644f4cc111711f7c8291`.

## Resolution

**Answer to the question:** downgrade. A device refusal that follows an insert
the device predicted without proof is not final: the write queues without a row
(`E_PREDICT`) and the server's refusal is the one the client reports. A refusal
with no unproved insert before it stays final and local.

**Implementation.** `engine/write.rs::insert_attempt`: each authored plain device
insert (not `if absent`, not an upsert's insert arm, not the engine's timeline
writes) runs the upsert insert-arm proof `prove_upsert_insert` on the separate
device allowance (`device_work`) for its id (unless minted for the call), its
unique values and its cap groups; a minted id on a table with no other unique key
or cap needs none. The proof's own unknown fact is discarded so it never changes
the prediction's coverage; an insert after an earlier unknown fact counts as
unproved. An unproved insert sets `Runner::unproved_write`;
`engine/local.rs::predict` turns any later refusal (not a store failure, not
already `E_PREDICT`) into `RuntimeError::Prediction`, which `Device::admit_checked`
already queues without a row. `device_work` was split into non-generic
enter/leave halves to pay for this in the wasm budget.

**Tests.** `snapback4-difftest/tests/devices.rs`:
`a_refusal_after_an_unproved_insert_queues_for_the_server` (the three retained
shapes: second insert of a hidden id, double delete, arithmetic after a hidden
secondary-unique value; both device stores; the harness's write comparison
then counts `prediction-declined` and convergence passes; fails on the old
engine) and `a_refusal_the_device_can_prove_stays_final_and_local` (a minted id
on a table with no other unique key, and a refusal before any write: the local
`E_OVERFLOW` stays final and equals the server's). Existing tests whose programs
inserted a literal id into a partitioned table before a refusal (readauth
`hidden_inside_prediction`, `counterfactual_branch`, `mixed_probe_boundary`,
`witness_fetch_budget`; `event_slots_trace` under a reposts horizon) now expect the
queued write.

**Docs.** Guide `prediction` (Refusals), `contract.ts` `Write`, LLP 3000.007 §20.5,
LLP 3000.035 §5.1.

The ticket was copied into this branch from the generator lane's saved file
before main carried it; on rebase, main's copy (with its scheduled recurrences)
replaced that copy and moved here.
