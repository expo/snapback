# 0137 G1: run-capsule.v1 cannot represent the G1 qualification arm

**Date:** 2026-08-01
**Source:** LLP 0137 Stage 1 (G1 package qualification), records phase
**Finding record:** `demos/improvement-sweep/arms/g1-public-package-qualification/findings/0137-g1-f3-run-capsule-schema-cannot-represent-g1.json`

## Observation

LLP 0137's evidence protocol requires a machine-readable capsule for every
arm, including the G1 qualification smoke arm. But the frozen
`protocol/schemas/run-capsule.v1.schema.json` requires
`arm.contract ∈ {a1…a6}` (`additionalProperties: false`), and G1 implements
no contract. The G1 capsule had to record a placeholder (`"contract":
"a2"`, `armKind: "untimed-extension"`) with a disclaimer in
`environment.role`.

## Proposed fix

Prospective G0 amendment per `demos/improvement-sweep/README.md`'s
freeze-boundary rules: allow a contract-free qualification arm (add
`"none"`/`"g1"` to the contract enum, or a dedicated qualification
`armKind` that lifts the contract requirement), then re-freeze
(`npm run freeze`) with a dated amendment note. Never rewrite the retained
G1 capsule.

## Acceptance witness

A future qualification capsule validates without a placeholder;
`npm run verify` (verify-freeze) passes on the amended tree.
