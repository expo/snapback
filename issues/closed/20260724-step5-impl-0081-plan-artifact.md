# 0081: MigrationPlanArtifactV1 — canonical bytes, deterministic planner, deterministic IDs

**Status:** Closed (2026-07-26)
**Severity:** P2
**Systems:** Migrations, Codegen
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §§2-3, LLP 0062 (JCS posture)
**Marker:** step5-impl

JCS body canonicalization with the single domain-separated digest preimage
and golden vectors; deterministic planner (schema-manifest order,
declared-intent order with per-intent dependency chains, lexicographic
tie-breaks, canonical step IDs); MigrationPreviewObservationV1 separately
digested and snapshot-pinned; resource ceilings, execution strategy, and
proof method as canonical body fields; the deterministic UUIDv7 ID namespace
with fixed version/variant bits, 48-bit range refusal, and conformance
vectors; authority-bearing-table step refusal. M/L-sized.

**Progress (2026-07-25, Wave 1):** `src/migration.rs` lands the canonical
foundations: the closed §3 step enum with per-step
preconditions/reads/writes/bounds/reversibility/verification;
`MigrationPlanArtifactV1 { body, planDigest, planId }` with the pinned
preimage (`snapback:migration-plan:v1` + `\n` + JCS body bytes; digest =
64 lowercase hex, `planId = migration-v1:<digest>`); the deterministic
planner (`derive_plan_steps` over a closed `MigrationIntent` vocabulary:
successor-schema declaration order, then declared-intent order, chains in
required sequence — validate before tighten, copy before retire — with the
pinned lexicographic backstop) and canonical
`s<ordinal>:<stepType>:<target>` IDs (target forms pinned: `table`,
`table.field`, `table#index`, `table@g<N>`, `projection:<id>`);
the deterministic synthesized-row UUIDv7 namespace (48
publication-timestamp bits, fixed version/variant, exactly 74 digest bits
from the domain-separated hash over plan digest/step/source/destination/
ordinal, 48-bit range refusal); `MigrationPreviewObservationV1` separately
digested; closed-backfill-vocabulary validation (ambient
time/randomness/auth/args/membership refused; `Arg` must name a declared
plan constant); authority-bearing-table refusal over both schema
generations; the deferred `transformed` retained-work posture refused as
`SNAPBACK_MIGRATION_PROFILE_UNSUPPORTED`. Golden vectors committed at
`schemas/migration.vectors-v1.json` (generated through the implementation,
drift-gated, byte-pinned in `migration::tests::golden_vectors_are_byte_pinned`)
plus JSON Schemas for plan/observation/approval/admission.

**Honest scoping:** the planner's input is the closed `MigrationIntent`
vocabulary; diffing two schema manifests into intents is a later-wave
consumer. The precondition/verification vocabularies are the minimal
closed v1 sets (`MaxAffectedRows`/`TotalConversion`/`TableEmpty`;
`RowCountMatchesSource`/`ContentDigest`); the executor (Wave 2) and
verification (Wave 3) widen by version if their tickets require.

## Resolution (2026-07-26)

The v1 artifact scope is complete: canonical bytes and digest/ID derivation,
deterministic intent planning and step IDs, separately digested preview
observations, ceilings, deterministic UUIDv7 synthesis, closed backfill
validation, authority-bearing-table refusal, committed schemas, and pinned
golden vectors all landed. Schema-diff-to-intent derivation remains an
explicit later consumer rather than an unfinished part of this artifact.
