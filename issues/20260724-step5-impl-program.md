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

**Phasing (author-ratified 2026-07-24):**

- **Phase A (now):** the 0007 implicit-suffix ticket, the full 0065 lane,
  and the 0080 callable-query slice (plan codegen, root-window evaluator,
  live/0053). Rationale: highest value density — generated CRUD removes
  boilerplate from every app and feeds `STEP5.DECLARATION_REDUCTION`;
  bounded joins are the most user-visible gap. No maintained-projection or
  migration machinery required.
  **Status (2026-07-25): executed.** 0007 suffix, the full 0065 lane
  (candidate-conformance, conditional lowering, effect ceiling incl. the
  new runtime subset enforcement, DTO identities, opaque keyset cursors,
  principal profile-class admission, and the §6 suite index in
  `20260724-step5-impl-0065-conformance-suite.md`), and the 0080 callable
  slice (plan codegen, root-window evaluator with opaque cursors +
  `RelationalResultEncodingV1`, live/0053 inheritance + retention
  default-deny + capability facts) are landed and witnessed. Named
  residuals live in the 0065 suite ticket and the 0080 live-0053 ticket
  (retention successor class, disabled-skip capability record,
  Sessions-mode negative matrix, acceptance corpus).
- **Phase B (next):** maintained projections + rebuild, the minimal 0081
  slice they force (barrier/executor, journal events, plan artifact +
  approval for `RebuildMaintainedProjection`), and the coupled suite.
  **Status (2026-07-25): executed.** Maintained projections landed whole
  (core engine in both mutation tiers, activation validation, the local
  IMMEDIATE-transaction barrier rebuild with receipts and the streaming
  split-oracle digest, `defineMaintainedProjection` authoring + demo +
  guide) and `RELATIONAL_MIGRATION_COUPLED_SUITE_V1`'s v1 fixtures are
  green (`tests/relational_migration_coupled_suite_v0.rs` +
  `tests/relational_corpus_v0.rs` + the src witnesses; item→witness map
  in the coupled-suite ticket). The minimal 0081 slice is deliberately
  narrowed to the local profile — the durable batch-cursor executor,
  full approval records, journal events, and verification/rollback stay
  the complete Phase C lane. `Implemented` status flips and the
  `relational_query_v1` maturity promotion are author decisions gated on
  the ticket-recorded residuals (hosted arms, retention lease class,
  obligation-fault e2e, Step 0).
- **Phase C (when real deployments need schema changes):** the rest of the
  0081 lane. 0081 is safety machinery and should land essentially whole —
  do not trim it; defer it. The hosted DO executor stays deferred behind an
  LLP 0072 target selection.
- Step 0's exit remains the critical path for *claiming* any Step 5 gate
  and outranks Phase B/C work when capacity is contended.

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
