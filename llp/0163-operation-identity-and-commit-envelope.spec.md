# LLP 0163: Operation identity and commit envelope

**Type:** Spec
**Status:** Draft
**Systems:** Storage, Sync, Auth, Diagnostics, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-03
**Revised:** 2026-08-03 (implementation substrate — Rust-owned
`OperationIdentityV1` and `CommitEnvelopeV1` landed with generated schemas and
focused namespace/stream/bound-fact validation tests; no storage wiring,
coverage, or capability claim); 2026-08-03 (initial Draft — extracted from Accepted LLP 0162
§§0-2 under its OQ14 decision; carries the identity/envelope contracts so
they can version independently of the profile umbrella)
**Related:** LLP 0012, LLP 0037, LLP 0043, LLP 0055, LLP 0095, LLP 0133,
LLP 0148, LLP 0162

## Purpose

This Spec owns the committed contracts and artifact schemas for the
operation-identity and commit-envelope half of the agent-safe storage
profile. LLP 0162 (Accepted) is the umbrella: it holds the rationale, the
profile-at-a-glance mapping, the claim boundary, and the acceptance corpus
(rows 1-4, 13, 14 gate these components). This Spec restates the normative
contract at implementation altitude and is where the wire/table schemas land
via LLP 0037's generated-schema pattern. Where this Spec and LLP 0162 §§0-2
diverge, this Spec is the defect until a dated revision reconciles them.

## Contract summary (normative; details per LLP 0162 §§0-2)

- **Identity.** `operationId` is the shipped `ClientMutationIdentity`
  widened to every originator (LLP 0133's extend-don't-ride-beside rule).
  The physical key is `(streamId, originatorClass, operationId)`; the
  audience and every other bound fact are compared, never key components —
  divergence fails closed in the shipped reused/stale diagnostic families.
  Host-derived identities are server-authenticated and deterministic from
  durable upstream identities (job id + attempt-invariant key, cron
  occurrence, migration operation id; child identities per commit from
  parent + stable ordinal); the host namespace is unwritable by
  client-originated admission.
- **Epochs and ranges.** Identities carry a server-issued authenticated
  issuance epoch bound to the authority-instance/session incarnation.
  Offline minting draws from server-preallocated authenticated finite
  identity ranges persisted atomically client-side; range exhaustion
  degrades to disclosed uncovered queueing with refresh at reconnect. A
  client epoch closes only when both hold: its issuer is terminated **or
  revoked**, and every ranged identity is **admitted-and-acknowledged**,
  never-admitted and range-window-expired with an explicit outcome-unknown
  classification, or operator-purged (LLP 0043's acknowledgement — an
  admitted-but-unacknowledged identity holds its epoch open). The
  per-audience floor advances past closed epochs only. Host-originated
  identities carry their own predicate (they have no client
  acknowledgement): a server-authenticated host identity reclaims after
  its terminal receipt ages past a declared host window, and a range-less
  host epoch — bound to the server incarnation, including the promotion
  admission-ticket identities — closes when the incarnation has rotated
  and every identity minted under it has a terminal receipt older than
  that window or is purged.
- **Suppression lifecycle.** Unacknowledged receipts are never evicted
  (LLP 0043's refuse-at-capacity rule). Reclamation is post-acknowledgement
  (or past the host window, for host identities) or explicit operator
  purge; an identity whose last durable record would
  be reclaimed inside an open epoch leaves a payload-free tombstone until
  the floor passes (tombstone growth in an open client epoch is bounded by
  the range size). Lookup precedence: suppression record → compact
  envelope or tombstone (`result-expired`, outcome-known/payload-gone) →
  epoch floor (`identity-horizon-passed`, outcome-unknown, never a terminal
  client `failed`).
- **Envelope.** One `CommitEnvelopeV1` per covered durable operation, keyed
  by the identity above; commit version is a stream-qualified snapshot
  association, not the key. Required facts, per-fact read-set provenance
  classes (`serverCaptured` / `clientSuppliedValidated` /
  `serverEvaluatedConditional`), the two effect-classification axes (egress
  family; LLP 0066 settlement capability), and field applicability marks
  are per LLP 0162 §1. Atomicity: data change, journal rows, envelope,
  suppression record, and initial receipt state commit in one transaction.
- **Retention and explanation.** Three declared independent clocks (detail,
  compact envelope identity, suppression) — none may pin the sync-resume
  replay floor; the envelope window is at least the journal window on
  covered lanes. Dispositions owned here: `detail-expired`,
  `detail-truncated`, `journal-expired`, `authorization-unprovable`,
  `result-expired`, `identity-horizon-passed`. Bounded enumeration by
  principal/session/time authorizes fail-closed.

## Owned artifacts

`CommitEnvelopeV1`, the suppression/tombstone records, the epoch/range
issuance artifacts, the disposition vocabulary above (spellings and
schemas; semantics stay with LLP 0162/0133), the protected-lane custody
schema for secret-bearing envelope facts (ctx answers, effect payloads),
and their wire projections — all Rust-owned generated schemas per LLP 0037. Amendments to
LLP 0133/0043 (identity semantics, retention parameters) and LLP 0012/0095
(client conformance) are dated in those documents and reference this Spec.

The first generated artifacts are
[`operation.identity-v1.schema.json`](../schemas/operation.identity-v1.schema.json)
and
[`commit.envelope-v1.schema.json`](../schemas/commit.envelope-v1.schema.json),
both generated from
[`src/commit_envelope.rs`](../src/commit_envelope.rs). Schema presence is an
implementation substrate, not evidence that any lane has envelope coverage.

## Acceptance

LLP 0162 Acceptance rows 1-4, 13, and 14 gate these components; this Spec
adds no parallel corpus. Fixture families named there (squatting, two
identities in one epoch, range crash cuts and exhaustion, closure predicate,
asymmetric envelope/journal joins) are implemented against this Spec's
schemas.

## Open items

1. *(Partially decided 2026-08-03.)* The operation-identity and commit-envelope
   v1 schema shapes are fixed by the Rust-owned artifacts above. Suppression,
   tombstone, epoch/range, explanation-projection, and protected-custody
   record shapes, plus exact diagnostic spellings, remain open.
2. Final parameter values: range size/window and ACK/retention parameters
   land by dated revision in LLP 0043; the detail/envelope/checkpoint
   windows stay with LLP 0162 OQ1 until this Spec and LLP 0165 land them.
3. `result-expired` is normative per the landed 2026-08-03 LLP
   0043/0012/0095 amendments; a later dated reconciliation of 0162, this
   Spec, and those amendments could still collapse it into
   `identity-horizon-passed`, but that is a future decision, not an open
   review question.

## Implementation record — 2026-08-03

The initial slice extends the shipped `ClientMutationIdentity` through
`OperationIdentityV1::from_client_mutation`: the existing client mutation id,
function, auth fingerprint, authority-instance id, and input fingerprint are
preserved as the widened operation identity's key or compared facts. It does
not introduce an independent retry identity.

The generated schema makes the physical key exactly `(streamId,
originatorClass, operationId)`, keeps audience as a compared bound fact, uses
structurally disjoint authenticated issuance variants for finite client ranges
and host incarnations, and stream-qualifies produced-commit versus observed-
snapshot associations. The envelope requires digests/counts/provenance for
read, write, ctx-answer, and effect fact sets; models lane-defined fields and
bounded detail states explicitly; carries both effect-classification axes; and
uses protected-lane custody references for non-inline secret-bearing detail.

Focused tests establish that audience divergence collides rather than becoming
novel, stream and originator partitions do become novel, a client-range
issuance cannot validate in the host namespace, host derivation is stable by
upstream identity plus commit ordinal, and envelope stream/audience facts must
match their identity. These are schema/validation foundations only:

| LLP 0162 acceptance row | State after this slice |
| --- | --- |
| 1 | **Partial** — v1 envelope and validation shape exist; atomic data/journal/envelope/suppression/receipt storage and crash cuts are missing. |
| 2 | **Partial** — exact-replay versus bound-fact-divergence comparison exists at the type boundary; stored retry settlement, range issuance/persistence/exhaustion, suppression lifecycle, tombstones, floors, and crash corpus are not wired. |
| 3 | **Missing** — durable provenance joins, bounded enumeration, detail dispositions, and fail-closed explanation authorization are not wired. |
| 4 | **Missing** — covered-lane inventory/choke point and asymmetric retention corpus are not wired. |
| 13 | **Gate artifact recorded separately** — candidate comparison has not run, so the row has not passed. |
| 14 | **Partial** — host namespace/derivation validation exists; server authentication, admission exclusion, reclamation, and corpus legs are missing. |

Every related capability therefore remains `Missing`.
