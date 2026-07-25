# 0081: approval/admission records + migrate CLI surface

**Status:** In progress (types landed 2026-07-25; CLI + enforcement are Wave 2)
**Severity:** P2
**Systems:** Migrations, CLI, Authorization
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §2, LLP 0072 (identities)
**Marker:** step5-impl

Typed authenticated MigrationApprovalV1 (plan/observation/policy digests,
complete 0072 target audience incl. releaseId, approver, issue/expiry, fresh
operationId) and barrier-time MigrationAdmissionV1; operationId+audience
keying for admission, journal lookup, replay, cancellation, and receipts;
local authenticated operator record vs hosted control-plane operation;
`snapback migrate preview|approve|apply|cancel|verify|rollback` with the
shared result envelope and machine-readable dry run; stale/mismatch/expiry
refusals. M/L-sized.

**Progress (2026-07-25, Wave 1 — types only):** `MigrationApprovalV1`
(plan/observation/policy digests, the complete LLP 0072
`MigrationAudienceV1` — deployment-class fields optional at the type
level, the local profile's resolved identity (databaseId,
streamIncarnation, activationGeneration, targetProfileId) required —
approver, `generatorIsApprover`, issue/expiry, fresh
`operation-v1:<uuid>` operationId) and barrier-time `MigrationAdmissionV1`
(actual predecessor head, enforced ceilings, consumed approval digest),
each with its own domain-separated digest
(`snapback:migration-approval:v1` / `snapback:migration-admission:v1`).
Structural gates witnessed: plan-derived operation ids, expiry ≤ issue,
missing approver/resolved-identity refuse. **Wave 2 consumes:** semantic
admission (audience equality against the resolved target, expiry at
barrier time, policy-digest enforcement, operationId+audience keying for
journal/replay/cancel/receipts), the `snapback migrate` CLI, and the
local-operator vs control-plane authentication split.

**Progress (2026-07-25, Wave 2):** semantic enforcement + the CLI landed on
the local profile: `snapback migrate preview|approve|apply|cancel|verify|
rollback` with the hostOpsResult envelope; preview is read-only and builds
the deterministic plan from explicit intents plus the separately digested
observation; approve is the LOCAL authenticated operator record —
authority is filesystem custody of the database plus the recorded local
operator principal (`$USER` unless `--approver`), with
generator-is-approver recorded; apply consumes the approved file by path
(never regenerates), supports `--dry-run`, and enforces the §2 admission
matrix (see the executor ticket); cancel requests the next admitted
boundary; verify recomputes the receipt's journal projection; rollback
refuses honestly (`SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE`). Remaining:
the hosted/control-plane approval class (LLP 0072 operation), policy-digest
semantics beyond the local constant, and the §5/§6 verify/rollback faces
(Wave 3).
