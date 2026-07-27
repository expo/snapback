# Mutation-wire artifact identity (blind predecessor writes)

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 2
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Mutation-wire artifact identity (blind predecessor writes)” shows the issue reaches a security, correctness, release, or core product boundary; delay compounds an active rollout, reliability, or verification risk, while the repair crosses several runtime, host, protocol, or policy seams, with specific cited code, progress, or acceptance criteria.
**Severity:** P3
**Systems:** Client protocol, Migrations, Storage
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-26
**Related:** Implemented LLP 0081 §6, LLP 0093

Carried out of `issues/closed/20260724-step5-impl-0081-journal-events.md`
when it resolved (2026-07-26): a blind (read-set-free) predecessor write is
undetectable at the migration floor — the successor-only gate validates
read-set baselines, and a mutation that carries none presents nothing to
refuse. Detecting it needs the client's artifact identity
(schemaHash/generation) on the mutation wire, which is LLP 0093-lane
protocol surface. Until then: baseline-bearing replays are floor-gated
(witnessed), incompatible attest is refused (`SNAPBACK_MIGRATION_UPGRADE_REQUIRED`),
and the JS Contract store's artifact privacy boundary prevents its own
cross-artifact replay client-side — the gap is a hand-rolled wire caller
that ships predecessor writes with no read set and no attest.
