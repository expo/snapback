# LLP 0163: Operation identity and commit envelope

**Type:** Spec
**Status:** Draft
**Systems:** Storage, Sync, Auth, Diagnostics, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-03
**Revised:** 2026-08-03 (durable storage slice — authenticated epoch/range
admission, atomic envelope/suppression recording for issuance-bearing ordinary
mutations, replay/tombstone/floor lifecycle, bounded explanation, and coverage
guards landed; public issuance/client custody and runtime coverage activation
remain explicit gaps, so every capability remains Missing); 2026-08-03 (implementation substrate — Rust-owned
`OperationIdentityV1` and `CommitEnvelopeV1` landed with generated schemas and
focused namespace/stream/bound-fact validation tests; no storage wiring,
coverage, or capability claim); 2026-08-03 (initial Draft — extracted from Accepted LLP 0162
§§0-2 under its OQ14 decision; carries the identity/envelope contracts so
they can version independently of the profile umbrella)
**Related:** LLP 0012, LLP 0037, LLP 0043, LLP 0055, LLP 0095, LLP 0133,
LLP 0148, LLP 0162

**Implementation evidence:** 2026-08-03 (the durable slice is integrated with
ordinary history operation joins and dated candidate observations; the valid
paired protocol, measurement-time baseline digest binding,
public carrier, production coverage activation, protected explanation custody,
host callers, and active-lane performance confirmation remain open, so the
Spec stays Draft and every capability stays `Missing`)

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

The generated artifacts are
[`operation.identity-v1.schema.json`](../schemas/operation.identity-v1.schema.json)
and [`commit.envelope-v1.schema.json`](../schemas/commit.envelope-v1.schema.json),
plus
[`operation.identity-range-v1.schema.json`](../schemas/operation.identity-range-v1.schema.json),
[`operation.identity-epoch-v1.schema.json`](../schemas/operation.identity-epoch-v1.schema.json),
[`operation.suppression-v1.schema.json`](../schemas/operation.suppression-v1.schema.json),
[`operation.identity-tombstone-v1.schema.json`](../schemas/operation.identity-tombstone-v1.schema.json),
[`operation.explanation-v1.schema.json`](../schemas/operation.explanation-v1.schema.json),
and
[`operation.coverage-manifest-v1.schema.json`](../schemas/operation.coverage-manifest-v1.schema.json),
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

1. *(Partially decided 2026-08-03.)* The operation-identity, commit-envelope,
   suppression, tombstone, epoch/range, explanation-projection, and coverage
   manifest v1 schema shapes are fixed by the Rust-owned artifacts above.
   A secret-bearing protected-custody record beyond the existing
   `protectedLane` reference, public transport projections, and final
   diagnostic consolidation remain open.
2. *(Partially decided 2026-08-03.)* LLP 0043 now fixes the v1 client range
   maxima and ACK reclamation rule. The detail/envelope/checkpoint windows
   stay with LLP 0162 OQ1 until this Spec and LLP 0165 land them.
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
| 13 | **Historical state at initial slice** — the candidate comparison had not run, so the row had not passed. See the durable-slice table below for current evidence. |
| 14 | **Partial** — host namespace/derivation validation exists; server authentication, admission exclusion, reclamation, and corpus legs are missing. |

Every related capability therefore remains `Missing`.

## Implementation record — 2026-08-03, durable storage slice

[`src/operation_ledger.rs`](../src/operation_ledger.rs) now owns durable
SQLite records for authenticated client and host epochs, finite client ranges,
per-audience epoch floors, commit envelopes, suppression results, payload-free
tombstones, and stream coverage manifests. `record_operation_in` deliberately
accepts a caller transaction: its corpus proves rollback leaves none of the
application row, change journal, envelope, suppression record, or receipt, and
commit leaves all of them. Admission compares the exact authenticated range
bounds and epoch authority, refuses overlap/exhaustion/closed epochs, preserves
unacknowledged results, converts acknowledged payloads to tombstones, and
answers in suppression → compact/tombstone → floor order.

The existing `ClientMutationIdentity` is widened in place with optional
authenticated issuance; the already-shipped digest preimage stays unchanged
when issuance is absent. The retained replay row persists and compares those
issuance facts, so the predecessor lookup cannot bypass a divergent LLP 0163
identity. Both ordinary durable writer implementations — HostPlan and Ibex
buffered mutation settlement — call one envelope hook inside their existing
data/journal transaction. Coverage remains fail-closed: an issuance-bearing
write requires an active matching stream manifest, and the store rejects a
produced-commit envelope whose write count does not match the transaction's
journal rows.

Bounded explanation lookup/enumeration joins retained envelopes to the journal,
distinguishes detail-expired/truncated and journal-expired states, and withholds
even digest/count facts when current authority is unprovable. Host records use
a structurally disjoint namespace and close only after server-incarnation
rotation plus the declared terminal-receipt window. Host-only admission now
authenticates the deterministic upstream/ordinal derivation against an open
server-recorded epoch and its authority/authenticator; rotation durably creates
the successor while retiring the predecessor, so closure no longer accepts a
caller-supplied rotation assertion. A live promotion ticket also holds a
durable host-identity lease: the rotated epoch cannot close until that exact
ticket completes or expires, and closure reclaims the finished lease.

When a finite history policy retains rows for an issuance-bearing ordinary
mutation, the HostPlan/Buffered transaction also fills those history rows with
the same operation identity before commit. The focused join corpus proves that
multiple versions retain their owning operation ids and that the update rolls
back with the rest of the operation transaction.

The public mutation wire does not yet issue/carry authenticated ranges, the
clients do not yet atomically persist a range with queued intent, no production
target activates a complete writer manifest, and no host-originated job/cron/
migration caller invokes the host seam. Those residues are tracked in
[`issues/20260803-0163-public-operation-identity-carrier.md`](../issues/20260803-0163-public-operation-identity-carrier.md)
and prohibit capability publication.

| LLP 0162 acceptance row | State after durable storage slice |
| --- | --- |
| 1 | **Partial** — issuance-bearing ordinary HostPlan and Buffered mutations have an atomic data/journal/envelope/suppression/receipt hook and rollback corpus; the public lane cannot enter it yet. |
| 2 | **Partial** — exact retry/divergence, authenticated finite ranges, exhaustion, ACK reclamation, tombstones, epoch closure, floors, and two-identities-in-one-epoch corpus are green; server issuance transport and atomic client range custody are missing. |
| 3 | **Partial** — durable exact/bounded explanations, current-authority fail-closed behavior, and expiry dispositions are green; public/admin transport, real policy evaluators, and secret-bearing protected custody remain missing. |
| 4 | **Partial** — a versioned stream manifest names both ordinary writer choke points and bypass/journal-retention adversaries are green; no production target activates a complete all-writer inventory. |
| 13 | **Partial** — the dated comparable candidate observations are within the registered binary read/write/idle bounds on the step-0 machine, but the historical/candidate runs are not experimentally paired; a post-run baseline digest cannot supply measurement-time binding. No production target activates the public issuance-bearing covered lane, so a qualified digest-bound active-path run and applicable crash-cut corpus are still missing. |
| 14 | **Partial** — host namespace authentication, client/host key separation, terminal receipt window, live promotion-ticket leases, and incarnation closure corpus are green; first-party host callers, transport-level client exclusion, and the full capacity/purge corpus are not wired. |

Every related capability remains `Missing`; this slice makes no advertisement.
