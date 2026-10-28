# Frozen day-two conservation includes release anchor metadata

Status: Open
Date: 2026-10-28
Scope: Snapback 4 release inspection / frozen proof compatibility (REL4 / DX16)
Related: LLP 3000.000.000.003 §2; LAT4; issues/20261028-snapback4-proof-loop-residual-wall-time.md

The frozen wave33 day-two proofs for 012 picture-book illustration and 020
horseback trail rides pass with LAT3's retained 0.4.44 native, then fail with
0.4.45 on disappearance of `rollbackParent_manuscripts` and
`rollbackParent_permits`. The fields are present in a rollback view's owner
inspection snapshot and absent after the next transition. The literal
assertions treat them as conserved authored values. Wave33/038 dry-ice deliveries
shows the same signature on `rollbackParent_deliveryProofs`; its complete
ordered same-version control also reproduces the failure on both binaries.

Fresh private-copy controls compare the unoptimized 0.4.45 native against LAT4's
optimized 0.4.45 native. Both fail on 012, 020 and 038 with the same field/value
assertion. Thus those failures are not introduced by LAT4's pure compiler reuse
or finite runner. No original store is opened, and no assertion is removed.

Control native SHA-256:

- unoptimized 0.4.45: `510fc4051021c19aa89e01e298f9c5fd14ae1861f913ea5bd8dd6200b4a84fdb`
- optimized 0.4.45: `d7b9f49589401aca80918f53730ad4086e2e54d3b12ab05a4a8b339dda320fd3`
- frozen LAT3 0.4.44: `d1bd7db63769424373915c61bcf1338f5893adea9be908eac8f6227f492b3d6c`

Private control rows/logs are under `/tmp/lat4/native45-control/` and
`/tmp/lat4/native45-control.log`; safe summary/evidence is retained with LAT4.
The complete ordered census (acceptance → frontend → day-two → client calls)
finished all 400 pairs across 120 lanes. It reproduces all three version-related
verdict differences. Only 012 and 038 belong to LAT3's successful 33-lane target;
020 was already outside that target. The 038 ordered control is under
`/tmp/lat4/native45-more/`, using final optimized native
`3fdd8109f2a76eb9f4d1f39d1418786091f29d9b3fd9854b959e17c3ca746a12`.
The safe LAT4 summaries retain the actual failed statuses. No qualification is
relabeled as passing.

Decide whether owner inspection should expose these engine-owned anchor fields
and/or the frozen proof should explicitly project authored fields. The paved
production guide's runnable migration example uses an explicit named-column SQL
projection; the general admin inspection helper reads complete active rows.
A fix must preserve receipt-owned child identity, current authorization and
actual authored population/value conservation. Do not weaken conservation by
arbitrarily ignoring missing application columns. No release or inspection
semantics are changed by LAT4.
