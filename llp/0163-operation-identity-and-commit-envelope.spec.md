# LLP 0163: Operation identity and commit envelope

**Type:** Spec
**Status:** Draft
**Systems:** Storage, Sync, Auth, Diagnostics, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-03
**Revised:** 2026-08-04 (narrow public owner-policy slice — exact generated
`owned-crud.v1`/`owner.v1` create and update envelopes can be explained only
after current function policy, client audience, executable artifact, current
row, retained historical row, and the complete closed fact set revalidate;
every other policy/fact shape remains fail-closed, the Spec remains Draft, and
all capabilities remain Missing); 2026-08-04 (host action-child carrier slice — job/cron action
parents now derive attempt-invariant child identities, managed HostPlan and
detached HostPlan/Ibex commits select explicit host writer adapters, and the
asymmetric/retry corpus is green; migrations, target activation, performance,
review, and publication remain open, so every capability stays Missing);
2026-08-04 (explanation/protected-custody slice — public and
AdminRead exact-operation transport, encrypted protected fact custody, and
fork-safe key rotation landed); 2026-08-04 (public client carrier slice — server-owned issue/refresh transport,
atomic file/IndexedDB outbox range custody, artifact-bound mutation carrier,
ordinary-writer activation/refusal seam, and response-loss/exhaustion corpus
landed; host caller and explanation transport residues keep the Spec Draft and
all capabilities Missing); 2026-08-03 (durable storage slice — authenticated epoch/range
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

**Implementation evidence:** 2026-08-04 (the public explanation lane now has a
narrow exact generated owner create/update evaluator; any artifact drift,
principal/incarnation/audience change, current or historical owner divergence,
permission/query/membership fact, context-answer widening, receipt divergence,
effect, truncation, or custody failure withholds the whole projection as
`authorization-unprovable`; admin explanation and encrypted protected-detail
custody remain wired, and derived forks scrub ciphertext and rotate its
owner-only sidecar); 2026-08-04 (job/cron action children carry
server-recorded host-incarnation issuance through the production HostPlan and
Ibex adapters; retry reconstruction and explicit asymmetric writer coverage
are green, while migrations and publication gates remain open); 2026-08-04 (public range transport, atomic client
custody, covered mutation carrier, and a dormant ordinary-writer activation
seam are wired; no production target activates it;
host callers, explanation transport/custody, complete acceptance corpus, and
paired performance remain open); 2026-08-03 (the durable slice is integrated with
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

## Implementation record — 2026-08-04, host action-child carrier slice

Job, cron, recovery, and manual action runs now construct one deterministic
host parent from their durable job name, slot key, and idempotency key. The
attempt-local run id and attempt number are deliberately excluded. Each nested
mutation consumes a stable child ordinal only when the explicit
`hostChildMutation` lane is active; retries reconstruct the same parent and
restart the ordinal sequence, so a committed prefix returns its retained
result instead of executing again.

The server records one range-less host epoch for the current data stream and
authorization-instance incarnation, and resolves every presented host child
against that live epoch and its authenticator before writing an envelope. The
production managed-action and detached-action adapters both carry the identity
through HostPlan and Ibex mutation commits. Their physical writer inventory is
the explicit pair
`LocalDatabase::execute_host_mutation_guarded_with_settlement_time` and
`LocalDatabase::commit_buffered_host_writes_guarded`; the buffered seam now
checks retained settlement before applying writes, matching HostPlan exact
replay.

Coverage classification is lane-specific rather than global. An
ordinary-only manifest leaves identityless host writes outside its claim, a
host-only manifest leaves identityless ordinary writes outside its claim, and
either covered lane requires issuance from its matching client-range or host-
incarnation namespace. Even when the preflight lane is uncovered, the shared
envelope hook refuses issuance whose lane is absent from the active manifest,
and the transaction leaves neither data nor a partial envelope. Focused corpus
also proves both covered lanes together, wrong-issuance refusal, production
HostPlan retry stability, and buffered host exact replay.

This slice does not cover migration transactions and does not activate either
lane on a production target. The complete target inventory, asymmetric-
retention tail, paired baseline-digest-bound active-lane performance record,
independent review, and author acceptance remain publication gates. LLP 0163
therefore remains Draft and every related capability remains `Missing`.

| LLP 0162 acceptance row | Status after this slice |
| --- | --- |
| 1 | **Partial** — job/cron action-child HostPlan and Ibex commits can atomically record host envelopes, and exact retry is green; migration and complete-target crash corpus remain open. |
| 2 | **Partial** — action-child host retry returns the retained settlement under stable upstream/ordinal identity; complete cross-arm acceptance remains gated. |
| 4 | **Partial** — ordinary-only, host-only, both, wrong-issuance, and identityless-asymmetric fixtures are green, but no production target activates a complete all-writer manifest. |
| 13 | **Partial** — unchanged: the qualified paired active-lane measurement is still required. |
| 14 | **Partial** — first-party job/cron action children are production-reachable across both runtime tiers; migration identities and the remaining capacity/purge corpus are open. |

No capability is advertised by this implementation record.

## Implementation record — 2026-08-04, public client carrier slice

The app-data router now serves the Rust-schema-owned
`POST /client-mutations/identity-range` issue/refresh contract. Its credential
is the live prepared authority; client-store identity, descriptor, and prior-
range fields are non-authorizing continuity assertions. The server derives the
audience from the authority and durable client-store identity, then chooses the
epoch, counter bounds, expiry, and authenticator digest. Refresh must present the
latest recorded range. A response lost after issuance is recoverable by
re-serving that exact range only while the epoch has admitted no identity;
after admission, missing durable custody refuses rather than risking counter
reuse.

`MutationRequest.operationIssuance` extends `clientMutationId` through the
existing retry settlement path. The transport rejects issuance without that
id and rejects the structurally disjoint host namespace. Covered retries bind
the complete selected artifact generation in addition to the shipped
function, canonical input, settlement, principal, audience, and authority
facts. The v1 issuance shape remains unwidened; mutation admission resolves its
audience from the exact durable range and authenticated authority epoch. Range
issuance never activates coverage. A dormant server-controlled publication
seam can activate a versioned entry naming both physical writer choke points;
the focused corpus proves that, once explicitly activated, either writer
refuses identity-less mutations before its first application write.

The JavaScript client exposes this pre-publication carrier only through the
explicit `operationIdentityProtocol: 1` opt-in. Its file and IndexedDB stores
persist the installed range, next counter, and queued intent in the same
existing outbox transaction. Range exhaustion queues an explicitly
`uncovered-range-exhausted` intent and refreshes before admission; no uncovered
intent is sent. Crash/reopen, exhaustion, server response-loss, contiguous
refresh, automatic carrier transport, and all-store parity fixtures are green.
The default remains disabled while this Spec is Draft and the capability rows
remain `Missing`.

This slice does not claim the remaining host-caller or explanation work.
Jobs, cron occurrences, and migrations still need first-party host identity
adapters (promotion already owns its authenticated host lease); public/admin
explanation transport, current policy evaluators, and a secret-bearing
protected-custody record also remain open. Acceptance row 13's genuinely
paired active-lane performance artifact is owned by the Track B acceptance
tail. No capability is advertised by this implementation record.

| LLP 0162 acceptance row | State after public client carrier slice |
| --- | --- |
| 1 | **Partial** — public issuance-bearing HostPlan/Buffered mutations enter the atomic hook under explicit corpus activation, and that covered stream refuses identity-less writes; no production target activates it and the full crash matrix remains with the acceptance tail. |
| 2 | **Partial** — server issue/refresh, response-loss recovery, atomic client custody, crash/reopen, exhaustion degradation, exact retry, and artifact binding are wired; cross-arm acceptance publication remains gated. |
| 3 | **Partial** — unchanged durable explanation substrate; public/admin transport and real current-policy/protected custody remain missing. |
| 4 | **Partial** — the dormant activation seam names both ordinary writer choke points and corpus activation refuses bypass; production activation plus full target inventory/asymmetric-retention acceptance remain gated. |
| 13 | **Partial** — the carrier exists but no production covered lane is active; the genuinely paired baseline-digest-bound measurement record remains with the acceptance tail. |
| 14 | **Partial** — client transport cannot mint `hostIncarnation`, and promotion holds authenticated host leases; job/cron/migration/child adapters remain missing. |

## Implementation record — 2026-08-04, explanation and protected custody

The Rust-owned exact-operation request/response pair is served at the app-auth
`POST /operations/explain` route and the independently AdminRead-gated
`POST /_snapback/api/operations/explain` route (strengthened to the existing
secret-read lease gate in sessions mode). The admin route evaluates the
current operator policy and can project all retained fact classes. The public
route re-attests the current principal and authority incarnation, derives and
compares the operation audience from the current incarnation plus the caller's
`clientAudienceId`, compares the retained executable-artifact digest with the
currently loaded function/schema generation, and re-runs the live
function/grant/profile policy. It recognizes only the exact generated
`owned-crud.v1` / `owner.v1` HostPlan create and update shapes. Create requires
the committed owner postimage to be the current subject. Update additionally
requires the captured historical row at the exact read version and the current
row to have that same owner. The evaluator requires the exact protected
read/write/context/receipt shapes and an empty effect set; receipt postimage,
snapshot, changed-row count, result, and context ledger must agree exactly.

Artifact drift, principal/incarnation/audience change, current or historical
owner divergence, missing/query/predicate/membership-shaped permissions,
non-empty context/effects, divergent receipts, expiry/truncation, unsupported
plans, and unavailable protected custody all produce one closed
`authorization-unprovable` result with stored metadata, digests, counts, and
detail withheld. Only the exact operation key supplied in the lookup and the
refusal disposition are echoed. Identity equality and ciphertext custody are
never themselves treated as authorization.

Read, write, context-answer, and receipt detail is encrypted under
XChaCha20-Poly1305 in `_snapback_operation_protected_detail_v1`; its root key
lives in a separate owner-only `*.operation-detail-keyring.json` sidecar.
Projection resolves the four protected classes plus inline-redacted effects as
one closed read/write/context/effects/receipt set and
returns `protected-custody-unavailable` if any required protected member is
missing or cannot authenticate. Detail expiry and compact-envelope pruning
delete the associated ciphertext transactionally. LLP 0158 classifies the
table as scrubbed and the sidecar as rotated: derived forks carry neither
parent ciphertext nor its key and their boot evidence requires the freshly
minted sidecar.

| LLP 0162 acceptance row | Status after this slice |
| --- | --- |
| 3 | **Partial** — exact public/admin transport and encrypted protected custody are wired. Admin current policy projects the complete retained fact set. Public current-policy projection is green only for the closed generated owner create/update profile; aggregate/non-row, delete, hand-written/opaque, predicate, membership, effect-bearing, and other unsupported shapes remain deliberately fail-closed. |
| 4 | **Partial** — protected-detail retention is independent and fork custody is closed, but complete-target activation/asymmetric-retention acceptance remains open. |
| 14 | **Partial** — unchanged: promotion is wired, while first-party job/cron/migration/child identities are not yet production-reachable. |

Every related capability remains `Missing`; this slice makes no advertisement.
