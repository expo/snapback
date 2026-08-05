# Write-rung-2 IR evaluator sizing spike

This directory is throwaway evidence for lane W1 of the 2026-08-04 Move-4
program. It is deliberately outside every package export, package test
inventory, capability manifest, and generated-artifact registry.

- `calendar-fixture.mjs` is the exact Candidate-A mutation-plan witness for
  Contention Calendar's frozen common path. It uses the already-shipped
  `Insert` ceiling; loser correction is settlement-layer retirement, not a
  `Delete` mutation step, and retry idempotence is protocol identity, not a
  `Let` step.
- `calendar-fixture.spike.mjs` proves that common-path witness executes through
  the shipping rung-1 evaluator and pins the frozen check inventory.
- `measure.mjs` makes in-memory, unregistered variants of the shipping
  evaluator and measures the ruling's three candidate verbs alone and
  cumulatively. `Delete` and `Let` activate already-landed D5 execution
  branches. The `AllocateSequence` profile includes a minimal bounded
  claim-ledger skeleton solely to avoid reporting a classifier-only bundle;
  that skeleton is not an admitted contract and does not override LLP 0133's
  settlement-only boundary.
- `measurement.v1.json` is the retained output of that measurement under
  `volta run node` (Node 24.18.0).

Nothing here is shipping code, codegen, an evaluator export, or a capability
claim.
