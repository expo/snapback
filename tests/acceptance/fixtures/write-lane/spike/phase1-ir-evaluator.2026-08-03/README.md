# Phase-1 IR evaluator sizing spike

This directory is throwaway evidence for the 2026-08-03 LLP 0129 Phase-1
sizing spike. It is deliberately outside every package export, package test
inventory, capability manifest, and generated-artifact registry.

- `browser-evaluator.mjs` is a browser-safe sizing skeleton. It reuses the
  shipped JS value/plan evaluator, the canonical client-value validator, and
  the LLP 0166 answer classifier. It writes no store state: its only output is
  a private, in-memory layer description.
- `kanban-fixture.mjs` expresses the five Kanban operations as real serialized
  mutation-IR values.
- `browser-evaluator.spike.mjs` is a feasibility witness for the four admission
  outcomes, the five operations, ledger consumption, and the locked-card case.
- `measure.mjs` reproduces the LLP 0145 browser-bundle method and prints JSON;
  it does not update a package baseline.
- `measurement.v1.json` is the retained output of that measurement.

Nothing here is shipping code or a capability claim.
