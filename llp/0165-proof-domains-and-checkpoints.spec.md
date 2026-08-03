# LLP 0165: Proof domains and checkpoints

**Type:** Spec
**Status:** Draft
**Systems:** Storage, Migrations, Diagnostics, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-03
**Revised:** 2026-08-03 (initial Draft — extracted from Accepted LLP 0162
§§4, 6 under its OQ14 decision; this is the "focused promotion-proof Spec"
LLP 0162 §4 names as a prerequisite for the core tier's boundary-proof
component)
**Related:** LLP 0035, LLP 0037, LLP 0053, LLP 0081, LLP 0088, LLP 0158,
LLP 0162, LLP 0163, LLP 0164

## Purpose

This Spec owns the digest domains, checkpoint substrate contracts, and
publication/erasure machinery of the agent-safe storage profile. LLP 0162
(Accepted) is the umbrella and holds the acceptance corpus. Its acceptance
is a named
prerequisite for `AgentSafeV1-core`'s boundary-proof component. §4 is
shared with LLP 0164 under an explicit split: this Spec owns journal
completeness, digest domains, and checkpoints; LLP 0164 owns the diff
surfaces; on a §4 divergence the owning Spec per this split is the defect.
Where this
Spec and LLP 0162 §§4/6 diverge, this Spec is the defect until a dated
revision reconciles them.

## Contract summary (normative; details per LLP 0162 §§4, 6)

- **Proof discipline.** LLP 0081's rule governs: a digest without a
  predecessor-derived expected value is inventory. Proof classes are
  three-valued — inventory, `verifiedCopyFidelity`, independent boundary
  proof — so copy fidelity can never be projected upward.
- **Promotion digest domain (to define here).** Canonical header,
  domain-separated preimage, expected-state derivation from base plus the
  approved facts of LLP 0164's `PromotionRequestV1`, actual-state scan,
  coverage binding, and golden vectors committed before any caller wires
  in. The shipped `ContentDigestHeaderV1` is migration-instant-bound and is
  not reused across domains.
- **Journal completeness.** Covered-lane physical writes transit a write
  authority choke point — a generated transaction API (LLP 0037 pattern)
  with an unforgeable lane-writer token, backed by a SQLite authorizer
  denying out-of-seam writes to covered tables — with compile-level and
  runtime negative fixtures. Until the seam lands, coverage and diff
  advertise the enumerated-fixture inventory class, not completeness.
- **Checkpoints.** Two substrate classes: materialized (physical copy;
  alone can base a non-promotable fork) and receipt-only (boundary receipt;
  no retained state; inventory unless dual-path-verified at creation, and
  outside every aggregate when unverified). Materialized-checkpoint
  verification is dual-path over one pinned source snapshot and claims
  `verifiedCopyFidelity` only; the snapshot-pinning mechanism (backup API
  under a held source read transaction; WAL-growth bound) is a named spike
  and refusal — never a digest over drifted bytes — is the fallback.
- **Publication and erasure.** Checkpoint publication imports LLP 0158's
  publication state machine completely (staging sentinel, fsync order,
  atomic rename, directory fsync, orphan recovery, receipt linearization)
  with the intra-state crash-cut matrix; one declared deviation — validity
  after erasure is registry-authoritative, because erasure obligations need
  an authority that outvotes a self-evident copy. Custody registry, key
  shredding, destroyed-versus-unreachable receipts, and "an unreachable
  copy is an honest open erasure obligation" per LLP 0162 §6. History and
  checkpoint pins are finite renewable leases; only materialized copies may
  outlive the history window.

## Owned artifacts

The per-domain digest headers and preimages with golden vectors, the
checkpoint receipts and custody-registry records, the publication state
machine's checkpoint-specific instantiation, and their wire projections —
generated per LLP 0037.

## Acceptance

LLP 0162 Acceptance row 12, row 11's checkpoint half, row 4's
journal-completeness leg (the choke point this Spec owns), and row 13's
applicable submetrics gate these components. This Spec's golden vectors
are committed before any caller wires in, independently of sequencing
step 0 (the performance baseline). No parallel corpus here.

## Open items

1. The snapshot-pinning spike (LLP 0162 OQ13) — its outcome may narrow the
   dual-path contract to a refusal-first posture.
2. Concrete per-domain preimage field lists and golden vectors.
3. Implementation details of the write-authority choke point — both
   controls (the generated transaction API with lane-writer token AND the
   SQLite authorizer) are decided by LLP 0162 §4; open here are only the
   generated-facade surface and the migration path for existing direct-SQL
   write sites.
