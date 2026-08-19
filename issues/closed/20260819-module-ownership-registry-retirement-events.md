# Module-ownership registry retirement events

**Status:** Closed
**Date:** 2026-08-19
**Systems:** Drift registry, workspace graph, LLP 0232
**Authority:** LLP 0276 Phase 3; LLP 0232 D-4

## Source registry event

- Retired gate IDs: `module-ownership` and `module-ownership-fixtures`.
- Removed the source gate from `driftAlwaysRunGates`,
  `driftFailClosedCoreGates`, `driftProneGates`, selection groups, and the
  canonical local-proof runner.
- Registered `workspace-graph` as the drift-prone, always-run, fail-closed
  core replacement. Its record is
  `crates/allowed-dependencies.v1.json`; its check covers all current Rust
  modules, exact named assigned-home exceptions, the engine residue denylist,
  the crate dependency matrix, and confined externals.

## Open health-signature events

| Retired signature | Administrative event | Product disposition |
| --- | --- | --- |
| `issues/20260810-main-module-ownership-red-jobs-edges.md` | Closed because its source registry retired. | The kernel/runtime crate carve removed the forbidden direction; no waiver entered the replacement matrix. |
| `issues/20260816-main-red-unmanifested-modules-elevated-read-visibility-gov.md` | Closed because its source registry retired. | Exact current-module membership is green. The unrelated visibility-governance harness concern was split to `issues/20260819-visibility-governance-drift-harness-bypass-posture.md`. |

These are administrative source-registry retirements, not claims that an
unrelated red became green. Future workspace-graph health signatures use the
replacement registry and its current fingerprints.
