# Wave-1 remainder: implement LLP 0134 — capability maturity promotion

**Status:** Open
**Systems:** Testing, Deployment, Runtime
**Related:** LLP 0134 (Accepted 2026-07-31; its record root
tests/acceptance/maturity/ does not exist; in-doc Status section still says
"Draft" — fix with this landing), LLP 0058 (the pre-existing
CapabilityMaturity enum this formalizes over)

Implement the promotion machinery the spec defines: per-route soak witnesses
with digest-bound `soakEvidence`, promotion commits pinned to
`candidateSourceSha`/`stagedTreeManifestSha256`, `MaturityDemotionRecordV1`,
the grandfather set, and records rooted at `tests/acceptance/maturity/`.

Care point: `src/manifest.rs`'s existing `CapabilityMaturity` enum is
LLP 0058 machinery (hand-maintained experimental list, `_ => Stable`
default). 0134 replaces judgment with evidence — the landing must reconcile
the two rather than leaving parallel authorities, and the grandfather set is
how existing Stable claims survive honestly.

This is process-infrastructure with immediate consumers: several
capability-index rows are stuck at "contributor source builds only," and the
npm default-channel decision (packet Tier 1) will want the promotion bar in
place when it lands.

**Exit:** the record root exists with at least one real capability's soak
evidence exercised end to end (promotion + demotion paths both tested); the
in-doc Status drift fixed; dated implementation-record amendment; LLP 0115
board row updated.
