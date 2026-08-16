# Tiny data surface evaluation harness

**Closed 2026-08-15:** after the 0.1.21 publication armed the D9 clock, the
author selected LLP 0254 D10 Withdraw before any timed run. The immutable
decision receipt is
`rulings/d10-disposition.v1.json`; LLPs 0254–0256 are tombstoned. This area is
retained as historical evidence and is not an active harness.

This was the frozen, pre-run LLP 0256 harness area. Phase 4 installed the
configuration, capsule schema, aid scaffold, InstantDB corpus pin, and D10
backstop. It contains no timed attempts; the qualified publication evidence is
retained under `clock/`.

The qualified 0.1.21 publication wrote `clock/publication-receipt.v1.json` and
armed D9 on 2026-08-14. The author closed the evaluation early through D10 on
2026-08-15, before any timed run. The scheduled backstop and missed-disposition
diagnostic were removed with the doorway.

No timed lane may begin until the runtime pin, aid digests, prompts, target,
model, proof, capsule validator, closure receipt, and clock receipt meet every
LLP 0256 gate.

## Phase 4 handoff

- `preregistration/d9-cell-table.v1.json` freezes the six D9 configurations,
  five runs per cell, and the required bare-before-assisted ordering.
- `schemas/run-capsule.tiny-data-evaluation.v1.json` is the closed capsule
  schema, including timing marks, concept counts, corrections, mistakes,
  function escapes, interventions, and evidence links.
- `aids/assisted-v1/manifest.v1.json` binds the symmetric aid bytes. Token
  counts remain deliberately unset until the run-time model tokenizer is
  recorded.
- `inventories/instantdb-2026-08-14.v1.json` is the offline Phase 0 pin from
  LLP 0082. It is not run-eligible until its required dated network refresh.
- `clock/backstop-installation.v1.json` records the installed D10 schedule;
  `clock/publication-receipt.v1.json` records the 0.1.21 publication that armed
  the clock before D10 withdrawal closed the evaluation.

No run may now begin from this retired harness. Phase 4 intentionally created
no `runs/` directory and produced no timed evidence.
