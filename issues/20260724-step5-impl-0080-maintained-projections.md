# 0080: transactionally maintained projections + global fan-out proof

**Status:** Open — narrowed 2026-07-26 to capability-artifact facts for projections (everything else landed; LLP 0080 is Implemented)
**Severity:** P2
**Systems:** Storage, Query planning, Authorization
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0080 §5
**Marker:** step5-impl

Same-transaction maintenance: affected keys closed over pre/post-image union,
one evaluation per output row against the final snapshot, changed-bytes
counted unit; the global fan-out/write proof with reverse-index ranges and
the active-plan set as commit dependencies (reverse-index-entry counting);
flat projections only; output-table write refusal and read enforcement
(closed HostPlans compose the output predicate; opaque handlers refused);
deterministic mapper constraints; stored projection identity + the output
_id rule as approved activation inputs; plan activation proof under the 0081
barrier with the per-source non-key-moving bound. L-sized.

**Progress (2026-07-25, core landed):**

- `MaintainedProjectionPlanV1` manifest types (`MaintainedProjectionPlan`
  on `FunctionManifest.projections`; closed output key = root `_id` |
  immutable unique root index tuple; declarative source/output
  visibility; `rootReverseIndex`; `fanOutLimit 1..=1023`;
  `sharedFanOutDisclosure`; `rebuild-v1` recipe pin). Dropped from the
  public inspect projection like every HandlerPlan body.
- Activation validation (`validate_maintained_projections`): chain/diamond
  refusal first, schema binding, cardinality + reverse-index proofs, §3
  owner-derivation/same-subject/no-widening rules, disclosure requirement
  (`SNAPBACK_RELATIONAL_DISCLOSURE_REQUIRED`), output-table write fence and
  owner-read enforcement over the whole function set (opaque handlers
  refused outright), and the static per-source write-budget proof
  (`SNAPBACK_PROJECTION_WRITE_BUDGET_EXCEEDED`).
- The maintenance engine (`maintain_projections_in_tx`) runs in BOTH
  mutation tiers' commit transactions (HostPlan step loop and the
  buffered/Ibex `apply_buffered_writes`): first-touch pre-images,
  affected-key closure over pre/post images, reverse-index admission
  (`SNAPBACK_PROJECTION_FANOUT_EXCEEDED`, whole-mutation refusal),
  one evaluation per key against the final snapshot, changed-bytes-only
  writes, deterministic `_id` (identity+key digest in UUIDv7 shape with
  the activation-timestamp constant; identity persisted in
  `_snapback_meta`), key-immutability refusal
  (`SNAPBACK_PROJECTION_MAINTENANCE_INVALID`), and the 1,024 direct+output
  write bound.
- Witnesses: `maintained_projection_engine_end_to_end` (materialize on
  joined-arrival, same-commit fan-out at one version, unchanged-bytes
  no-write, key-stable row identity across delete/re-insert, fan-out
  admission rollback, key immutability) and
  `maintained_projection_activation_refusals`.

**Remaining (the only open item, 2026-07-26):** capability-artifact facts for projections — the generated bundle does not surface a projection-carrying schema as a target capability requirement, so a non-relational target refuses only at activation, not at generation/admission. The
concurrent-admission race and 1,023/1,024-boundary fixtures landed in
`tests/relational_migration_coupled_suite_v0.rs` (2026-07-25; item→witness
map in the coupled-suite ticket).

**Authoring surface (2026-07-25, landed):** `defineMaintainedProjection`
in packages/snapback-codegen (generation mirrors activation: chains,
disclosure, left-owner, reverse-index, output-key, budget, and output
read/write fences all refuse at generation;
`maintained-projections.test.mjs`); the manifest emits the top-level
`projections` array; competitive-checkpoint carries a live projection
(`conversation-cards`: conversations ⟕ models → conversationCards) with
an acceptance check proving root-commit materialization, joined-side
reverse-index fan-out, and owner scoping end to end; guide page +
capability index updated.
