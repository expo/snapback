# Snapback 4 device refusal after an unproved prediction reports a different code than the server

**Status:** Open
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
