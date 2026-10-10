# Quarry differential test: widened shapes reach OPEN W4 (and reached R2, now fixed)

**Status:** Open (W4); the R2 part is resolved
**Impact:** 3
**Urgency:** 2
**Ease:** 4
**Confidence:** 5
**Systems:** Snapback 4, Quarry write refusals, Lean oracle
**Class:** open question OPEN W4 (the refusal code of a hidden clash on an absent upsert's insert arm); the R2 part was an engine defect (security), fixed
**Date:** 2026-10-08
**Related:** LLP 3000.035 §5.1 (lane GW, the widened generator), `snapback4/lean/OPEN.md` R2 and W4

**R2 (security): resolved by `b2036dd821` / `cda33a8e27`.** An unnamed
`update <- .owner = viewer` judged only the next image, so a viewer could take
over another principal's row with a blind `upsert` or `update` setting
`owner: viewer`. The widened generator (mutation blocks, a prelude of
mutations) reached it under eight signatures besides the original two; the
takeover happened in an earlier statement or prelude step and the difference
surfaced later. After the fix, all eight replay as passes and are kept as
regressions (`tests/lean.rs`, `RESOLVED`; each DIAGNOSIS.md says so):
`lean--code--E_CONSTRAINT~NOT_FOUND`, `lean--code--E_OVERFLOW~NOT_FOUND`,
`lean--code--REQUIRED~NOT_FOUND`, `lean--prelude-code--E_CONSTRAINT~E_RULE`,
`lean--prelude-code--E_CONSTRAINT~NOT_FOUND`,
`lean--prelude-code--REQUIRED~NOT_FOUND`,
`lean--prelude-kind--committed~E_RULE`, `lean--prelude-kind--committed~NOT_FOUND`.
A recurrence would be a regression of the security fix and should get its
own ticket.

**W4 (open; not security-relevant beyond what a unique key already reveals).**
An absent `upsert` whose insert arm puts a unique `tag` held by a row the
viewer cannot read:

```quarry
table items:
  owner: principal
  ...
  tag: id
  unique byTag: tag
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  ...
mutation run(key: id, k2: id, ...):
  upsert items[key] { owner: viewer, ..., tag: 'tag0' }
  return 0
```

bob's row `r0` holds `tag0`; alice upserts the absent `missing`. The engine
refuses `E_RULE` ("a unique key ... contains a row you cannot read"); the
model `NOT_FOUND` (OPEN W4's choice). The documents are silent on a hidden
clash on the upsert's insert path; a plain insert's hidden clash is `E_RULE`
on both sides (W1). **Needs a ruling on the code;** then either the model's W4
choice or the engine changes, with a document.

Counts in `run-lean --seed 0 --cases 20000` after the R2 and E4 fixes: 24
under `lean--prelude-code--E_RULE~NOT_FOUND` and 3 under
`lean--code--E_RULE~NOT_FOUND` (the same shape in `run`).

Retained cases: `snapback4/crates/snapback4-difftest/cases/found/<signature>/DIAGNOSIS.md`.

## Scheduled-run signatures

**Failure signature:** `lean--code--E_RULE~NOT_FOUND`  
**Failure signature:** `lean--prelude-code--E_RULE~NOT_FOUND`  

Recurrences:

- 2026-10-09: run `20261009T011321Z-eb3eb4e7`, seed `3200`, commit `74f3a1dd3240287cd7f5405ed55588e0c93db8e5`.

- 2026-10-09: run `20261009T011321Z-eb3eb4e7`, seed `1749`, commit `74f3a1dd3240287cd7f5405ed55588e0c93db8e5`.

- 2026-10-10: run `20261010T000005Z-fe12e802`, seed `17349`, commit `e92ba8687bc6e363cf5f76436f53d8b3bacdd284`.

- 2026-10-10: run `20261010T000005Z-fe12e802`, seed `16015`, commit `e92ba8687bc6e363cf5f76436f53d8b3bacdd284`.
