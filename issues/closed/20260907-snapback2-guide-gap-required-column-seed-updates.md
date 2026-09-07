# guide-gap: required-column migration also needs valid seed rows

Status: Closed
Date: 2026-09-07
Scope: Snapback 2 operator guide, LLP 1016 D4

The published 0.0.14 evolution diagnostic followed expand/fill/contract but
first met `E_SEED_VALUE` when its final schema required a field omitted by
`seed.ts`. Static `check` succeeded; the owner retained the prior generation.
Updating the seed exposed the expected `E_SUCCESSOR_NARROWING` for three
missing live values. Updating seed values did not fill the existing store.

The operator guide now explains that the owner validates seed rows before
applying a successor and that a fill job remains necessary for existing rows.
The prepared diagnostic then rehearsed, filled, narrowed, compared all original
rows, and restarted successfully. This is documentation of existing behavior,
not a migration engine change or a full M7 qualification.

[Retained diagnostic and exact command receipts](../../benchmarks/runs/2026-09-07-snapback2-evolution-diagnostic/README.md).
