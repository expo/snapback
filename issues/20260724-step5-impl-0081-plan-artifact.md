# 0081: MigrationPlanArtifactV1 — canonical bytes, deterministic planner, deterministic IDs

**Status:** Open
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
