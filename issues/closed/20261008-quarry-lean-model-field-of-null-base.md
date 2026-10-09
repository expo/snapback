# Quarry Lean model: field access on a null base refuses E_MODEL_TYPE

**Status:** Closed (2026-10-08, model fixed from `why E_FIELD`)
**Impact:** 4
**Urgency:** 3
**Ease:** 5
**Confidence:** 5
**Systems:** Snapback 4, Lean model (`snapback4/lean/Quarry/Eval.lean`), Lean oracle
**Class:** Lean model defect (OPEN E4); not an engine defect
**Date:** 2026-10-08
**Related:** LLP 3000.035 §5.1 (found by the widened generator, lane GW, `run-devices`/`run-lean --seed 0 --cases 20000`)

The documents say ordinary field access propagates a null base as null
(`snapback4 why E_FIELD`; `why E_QUARRY_UNSUPPORTED`: "`row.body` is null
when `row` is null"); the engine does. The model's `.field` arm in
`Eval.lean` refuses `E_MODEL_TYPE` when the base is not a row. The widened
generator's blocks read `(items[key].score ?? 0)` after their writes; on a key
with no visible row the engine evaluates 0 and the model refuses. This is the
largest class of Lean disagreements in seeds 0–19,999 (2,221 of 2,552) and it
masks whatever else those cases would compare.

**Fix:** `.field a c` on `null` evaluates to `null` (one arm), plus an example
citing `why E_FIELD`, then `./check.sh`. Lane GW's brief forbade changing the
model's semantics, so it is recorded as `lean/OPEN.md` E4 and classified in
`tests/lean.rs`; after the fix, these retained cases should replay as passes
(move them to `RESOLVED`) or reveal what they masked.

- `lean--code--E_CONSTRAINT~E_MODEL_TYPE`: 51
- `lean--code--E_OVERFLOW~E_MODEL_TYPE`: 62
- `lean--code--E_RULE~E_MODEL_TYPE`: 74
- `lean--code--NOT_FOUND~E_MODEL_TYPE`: 279
- `lean--code--REQUIRED~E_MODEL_TYPE`: 101
- `lean--kind--committed~E_MODEL_TYPE`: 148
- `lean--prelude-code--E_CONSTRAINT~E_MODEL_TYPE`: 129
- `lean--prelude-code--E_OVERFLOW~E_MODEL_TYPE`: 56
- `lean--prelude-code--E_RULE~E_MODEL_TYPE`: 174
- `lean--prelude-code--NOT_FOUND~E_MODEL_TYPE`: 571
- `lean--prelude-code--REQUIRED~E_MODEL_TYPE`: 207
- `lean--prelude-kind--committed~E_MODEL_TYPE`: 369

## Scheduled-run signatures

**Failure signature:** `lean--code--E_CONSTRAINT~E_MODEL_TYPE`  
**Failure signature:** `lean--code--E_OVERFLOW~E_MODEL_TYPE`  
**Failure signature:** `lean--code--E_RULE~E_MODEL_TYPE`  
**Failure signature:** `lean--code--NOT_FOUND~E_MODEL_TYPE`  
**Failure signature:** `lean--code--REQUIRED~E_MODEL_TYPE`  
**Failure signature:** `lean--kind--committed~E_MODEL_TYPE`  
**Failure signature:** `lean--prelude-code--E_CONSTRAINT~E_MODEL_TYPE`  
**Failure signature:** `lean--prelude-code--E_OVERFLOW~E_MODEL_TYPE`  
**Failure signature:** `lean--prelude-code--E_RULE~E_MODEL_TYPE`  
**Failure signature:** `lean--prelude-code--NOT_FOUND~E_MODEL_TYPE`  
**Failure signature:** `lean--prelude-code--REQUIRED~E_MODEL_TYPE`  
**Failure signature:** `lean--prelude-kind--committed~E_MODEL_TYPE`  

Recurrences:

## Resolution

**Fixed 2026-10-08 (lane GW).** `snapback4/lean/Quarry/Eval.lean`'s `.field`
arm returns null for a null base, citing `why E_FIELD`; example
`field-of-null` added (32 examples). `./check.sh`: 38 theorems audited,
standard axioms only; 32/32 examples agree; 5 oracle fixture cases agree.
`lean/OPEN.md` E4 is marked confirmed by that document.

All twelve retained `…~E_MODEL_TYPE` cases now replay as passes and moved to
`RESOLVED` in `tests/lean.rs`. `run-lean --seed 0 --cases 20000` afterwards
(with the R2 engine fix `b2036dd821` also on main): 14,614 supported, 14,272
agree, 342 disagree, under four signatures: OPEN C2 (203 + 112) and OPEN W4
(24 + 3, one new signature `lean--code--E_RULE~NOT_FOUND`). The fix uncovered
no engine defect.
