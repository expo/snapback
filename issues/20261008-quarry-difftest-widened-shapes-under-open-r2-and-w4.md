# Quarry differential test: widened shapes reach OPEN R2 (security) and W4 under new signatures

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 3
**Confidence:** 4
**Systems:** Snapback 4, Quarry rules (write authority), Lean oracle
**Class:** open questions OPEN R2 (security-relevant) and W4; R2 is the engine defect already ticketed
**Date:** 2026-10-08
**Related:** LLP 3000.035 §5.1 (found by the widened generator, lane GW, `run-devices`/`run-lean --seed 0 --cases 20000`)

**Security-relevant (R2):** an unnamed `update <- .owner = viewer` judges only
the next image, so a viewer can take over another principal's row with a
blind `upsert` or `update` that sets `owner: viewer`. That is ticketed in
`issues/20261008-quarry-difftest-lean--kind--committed-not-found-2b9511f3e782.md`
and `…-committed-e-rule-0ffb8dcbc8aa.md` and is being fixed in another lane.
This ticket only collects the new signatures under which the widened
generator (mutation blocks, a prelude of mutations) reaches it, so the
nightly runner does not file each one separately: the takeover happens in an
earlier statement or prelude step, and the difference surfaces later (a
second insert's `E_CONSTRAINT`, an overflow, a `require`, a prelude step's
outcome). Every retained R2 case was checked by hand: the first differing
write is an unnamed-rule `upsert`/`update` of another principal's row setting
`owner: viewer`. When the R2 fix lands, replay them; each should pass.

R2 counts in seeds 0–19,999:

- `lean--code--E_CONSTRAINT~NOT_FOUND`: 1
- `lean--code--E_OVERFLOW~NOT_FOUND`: 2
- `lean--code--REQUIRED~NOT_FOUND`: 2
- `lean--prelude-code--E_CONSTRAINT~E_RULE`: 1
- `lean--prelude-code--E_CONSTRAINT~NOT_FOUND`: 3
- `lean--prelude-code--REQUIRED~NOT_FOUND`: 1
- `lean--prelude-kind--committed~E_RULE`: 2
- `lean--prelude-kind--committed~NOT_FOUND`: 9

**W4 (open, not security-relevant beyond what a unique key already reveals):**
`lean--prelude-code--E_RULE~NOT_FOUND`. An absent `upsert` whose insert arm
puts a unique `tag` held by a row the viewer cannot read: the engine refuses
`E_RULE`, the model `NOT_FOUND` (OPEN W4's choice). The documents are silent;
a plain insert's hidden clash is `E_RULE` on both sides (W1). Needs a ruling
on the code. Count: 8.

Retained cases: `snapback4/crates/snapback4-difftest/cases/found/<signature>/DIAGNOSIS.md`.

## Scheduled-run signatures

**Failure signature:** `lean--code--E_CONSTRAINT~NOT_FOUND`  
**Failure signature:** `lean--code--E_OVERFLOW~NOT_FOUND`  
**Failure signature:** `lean--code--REQUIRED~NOT_FOUND`  
**Failure signature:** `lean--prelude-code--E_CONSTRAINT~E_RULE`  
**Failure signature:** `lean--prelude-code--E_CONSTRAINT~NOT_FOUND`  
**Failure signature:** `lean--prelude-code--E_RULE~NOT_FOUND`  
**Failure signature:** `lean--prelude-code--REQUIRED~NOT_FOUND`  
**Failure signature:** `lean--prelude-kind--committed~E_RULE`  
**Failure signature:** `lean--prelude-kind--committed~NOT_FOUND`  

Recurrences:
