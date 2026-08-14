# Tiny data surface evaluation harness

This is the frozen, pre-run LLP 0256 harness area. Phase 4 installs the
configuration, capsule schema, aid scaffold, InstantDB corpus pin, and D10
backstop. It contains no timed attempts and no promotion evidence.

The D9 clock is deliberately unarmed until the qualified publisher writes
`clock/publication-receipt.v1.json`. From then on the scheduled
`node scripts/drift-prone-gates.mjs backstop` path invokes
`scripts/tiny-data-evaluation-backstop.mjs`. At the earlier of three complete
qualified rounds or the active 90-day stop, no timely author ruling produces
the stable `SNAPBACK_DATA_SURFACE_D10_MISSED_DISPOSITION` verdict and exactly
one signature-bound open repository ticket. The check verifies, but never
rewrites, the Experimental and non-default doorway freeze.

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
  `clock/publication-receipt.v1.json` remains absent until qualified
  publication arms the clock.

Before any run, execute
`node --test scripts/tiny-data-evaluation-readiness.test.mjs`, satisfy every
run-time gate named above, then persist each attempt as one schema-valid
capsule. Phase 4 intentionally created no `runs/` directory and produced no
timed evidence.
