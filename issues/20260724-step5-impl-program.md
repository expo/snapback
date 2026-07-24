# Step 5 semantics implementation program (LLP 0065/0080/0081) — index

**Status:** Open
**Severity:** P2
**Systems:** Codegen, Storage, Query planning, Live Queries, Authorization, Migrations, CLI, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0065/0080/0081 (authorities), LLP 0004/0007/0051/0053/0055/0056/0058/0063/0072
**Marker:** program-index, step5-impl

Umbrella index for implementing the three Accepted Step 5 semantic
authorities. Acceptance (2026-07-24, dual-family LLP 0005 loops) authorized
implementation; `Implemented` status and LLP 0063's Step 5 executable
witnesses are gated on the conformance suites below. Step 0 remains the
conjunctive prerequisite for *claiming* any Step 5 gate — building these does
not require it.

Three lanes run in parallel; the coupled suite joins the 0080/0081 lanes at
the end. `20260724-step5-impl-0007-implicit-id-suffix.md` is a shared early
dependency of both the 0065 and 0080 lanes.

LLP 0065 lane (standard patterns):
- `20260724-step5-impl-0065-candidate-conformance.md` — move the shipped
  candidate to the accepted spec
- `20260724-step5-impl-0065-conditional-lowering.md` — server-evaluated
  conditional update/delete
- `20260724-step5-impl-0065-effect-ceiling.md` — `EffectCeilingV1`
- `20260724-step5-impl-0065-dto-manifest.md` — versioned DTOs in the
  Rust-owned manifest
- `20260724-step5-impl-0065-conformance-suite.md` — the §6 suite (gates
  `Implemented` + `STEP5.DECLARATION_REDUCTION`)

LLP 0080 lane (relational):
- `20260724-step5-impl-0080-plan-codegen.md` — closed plan normalization +
  validation
- `20260724-step5-impl-0080-root-window-evaluator.md` — `root-window-v1`
  across evaluators + result encoding + cursors
- `20260724-step5-impl-0080-live-0053.md` — live_replace/0053 inheritance +
  retention capability
- `20260724-step5-impl-0080-maintained-projections.md` — same-transaction
  maintenance + fan-out proof
- `20260724-step5-impl-0080-rebuild.md` — barrier rebuild under the split
  oracle
- `20260724-step5-impl-0080-acceptance-corpus.md` — the §Acceptance suite
  (0080 half of the coupled suite)

LLP 0081 lane (migrations):
- `20260724-step5-impl-0081-plan-artifact.md` — canonical artifact, planner
  determinism, deterministic IDs
- `20260724-step5-impl-0081-approval-admission.md` — approval/admission
  records + CLI surface
- `20260724-step5-impl-0081-executor-state-machine.md` — durable executor,
  fence, lifecycle (local SQLite profile)
- `20260724-step5-impl-0081-typed-steps-keyset-scan.md` — closed steps +
  `MigrationKeysetScanV1`
- `20260724-step5-impl-0081-journal-events.md` — LLP 0007 schema-transition
  events + 0053 activation + client handshake
- `20260724-step5-impl-0081-content-digest.md` — `ContentDigestV1`
- `20260724-step5-impl-0081-verification-rollback.md` — proof, receipts,
  `generationRepublish`
- `20260724-step5-impl-0081-retained-work.md` — retained-work postures
- `20260724-step5-impl-0081-acceptance-corpus.md` — the §Acceptance suite
  (0081 half of the coupled suite)

Join + deferred:
- `20260724-step5-impl-coupled-suite.md` —
  `RELATIONAL_MIGRATION_COUPLED_SUITE_V1`; flips both docs to Implemented on
  pass
- `20260724-step5-impl-0081-hosted-do-executor.md` — Deferred: hosted Durable
  Object executor as a separately versioned LLP 0072 conformance profile
