# LLP 0163: Operation identity and commit envelope

**Type:** Spec
**Status:** Accepted
**Systems:** Storage, Sync, Auth, Diagnostics, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-03
**Revised:** 2026-08-06 (accepted by Charlie Cheever after three mutually blind dual-family review rounds converged `READY`; acceptance approves this Spec's contract without publishing the broader agent-safe-storage aggregate, filling Track B rows, or adding operation attribution to the narrow derived-fork receipts — those facts remain `Missing` or explicitly absent); 2026-08-06 (post-landing row-13 result recorded — landed commit a0852be… preserved a valid paired failure on current-range p95 only; scope corrections: row-9 assertion ceded to LLP 0164/0165, derived-fork net-diff attribution named out of this Spec's acceptance rows; Draft/Missing unchanged); 2026-08-05 (exact C30 review stop and prospective C31 repair — global Host-lease and pending-capacity projection validation plus client-suppression closure symmetry; Draft/Missing unchanged); 2026-08-05 (exact C29 review stop and prospective C30 repair — terminal-supplement retention coherence, automatic sessions ACK custody, closed public explanation lookup, and direct Host writer rollback matrix; Draft/Missing unchanged); 2026-08-05 (merged C28 review stop and prospective C29 repair — automatic sessions range custody, nullable-required Host tombstones, terminal-time coherence, and pending-writer rollback; Draft/Missing unchanged); 2026-08-05 (C27 pre-result abandonment and C28 lifecycle repair — comparison-complete tombstones, contiguous floors, bounded ranges, and transactional writer guards; Draft/Missing unchanged); 2026-08-04 (explicit activation transport — an authenticated,
managed-admission AdminWrite command now accepts only the versioned local
target/profile pair and publishes the exact four-adapter manifest; it remains
inactive until an operator invokes it, and independent review, author
acceptance, performance, and complete-target publication gates keep the Spec
Draft and every capability Missing); 2026-08-04 (identity lifecycle/public carrier tail —
outcome-known/payload-gone is now a distinct durable `result-gone` outbox
state across all three stores, exact terminal-fact retry is idempotent while
divergence refuses, a recreated file-backed client never redelivers it, and
the real host-child writer covers retry, bounded capacity, client-purge
isolation, authority rotation, and delayed first delivery; branch recreation,
performance, review, and publication remain open, so the Spec stays Draft and
capabilities stay Missing); 2026-08-04 (writer-inventory activation tail — the local target
now has 23 individually named physical writer families, stable executable
exclusion reasons instead of a grouped specialized row, fail-closed armed
refusal for every non-envelope app writer, and one production storage cut that
can publish exactly the four authenticated ordinary/host adapters; the cut is
not invoked while review and publication gates remain open, so the Spec stays
Draft and capabilities stay Missing); 2026-08-04 (migration aggregate settlement tail — P now atomically
retains a truthful Pending envelope/lifecycle and T appends a digest-linked
Committed/RolledBack supplement with bounded Host retention; H1/H2/C and the
aggregate boundary remain uncovered, the Spec remains Draft, and every
capability stays Missing); 2026-08-04 (public current-policy evaluation tail — exact
generated `owned-crud.v1` / `owner.v1` create envelopes can now project only
after their current row, retained insert postimage, write, receipt, and exact
private mint-site chain agree; the private settlement observation is stripped
before public projection, generated delete remains fail-closed under the
current-plus-per-version rule, unsupported fact/profile classes remain
metadata-free refusals, and every capability stays Missing); 2026-08-04 (migration transaction carrier slice — every new
migration-journal transaction now carries an authenticated approval-derived
Host identity with a durable pre-transaction ordinal, including lease-
superseding crash/retry and cleanup-reopen paths; migration remains explicitly
uncovered because publication and terminal receipt are separate transactions,
so every capability stays Missing); 2026-08-04 (write-authority enforcement slice — an armed local
coverage manifest now installs a connection-local SQLite authorizer and a
module-private generated writer token for the four ordinary/host physical
adapters; raw, cached, trigger-mediated, system-field, and DDL bypasses refuse,
while grouped specialized writers remain explicitly non-enumerated and every
capability remains Missing); 2026-08-04 (narrow public owner-policy slice — exact generated
`owned-crud.v1`/`owner.v1` update envelopes can be explained only
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
**Qualification amendment (2026-08-05):** C31 was abandoned before review
results or performance after the mandatory fetch found newer main. C32 is the
normally merged, regenerated successor; the Spec remains `Draft` and every
related capability remains `Missing`.

**Qualification amendment (2026-08-05, C33):** C32 was abandoned before a
qualifying dual review completed and before performance after newer mainline
cuts were detected. Normal merge commits `cc5d6bce64550210d7b55b929841a8f9af8f2f68`
and `211f85714cdac7abdf4022b77cb08bce4419a35c` preserve this Spec's carrier,
custody, and fail-closed projection repairs while incorporating the current
fork/AppBinding work. C33 is the next prospective exact clean candidate; the
Spec remains `Draft` and every related capability remains `Missing`.

**Qualification amendment (2026-08-06, landing ruling):** Exact C33 received
fresh mutually blind Codex-family and Fable-family `READY` verdicts. Per the
author ruling recorded in
`issues/20260803-0163-public-operation-identity-carrier.md`, subsequent normal
mainline merges preserve that reviewed work and do not create C34/C35 or
require re-review. The conflict-resolved tree lands after proportional
build/test verification; row 13 then runs against the landed commit. The Spec
remains `Draft` and every related capability remains `Missing` until the
post-landing performance result and every other named gate pass.

**Related:** LLP 0012, LLP 0037, LLP 0043, LLP 0055, LLP 0095, LLP 0133,
LLP 0148, LLP 0162

**Implementation evidence:** 2026-08-04 (memory, IndexedDB, and file outboxes
persist a fourth `result-gone` state before surfacing a result-expired error;
equal outcome/digest replay is idempotent, divergent custody refuses, ordered
successors remain fenced until explicit discard, and file close/recreate never
redelivers; the production host-child adapter additionally proves exact retry
under full custody, novel capacity refusal, survival across client operator
purge and authority rotation, and retired-epoch delayed-first-delivery refusal);
2026-08-04 (the local target inventory names 23
physical writer families; only the four ordinary/host adapters lack an
exclusion reason and each maps to the authenticated envelope seam, while
schema, migration, reset/seed, membership, projection rebuild, and strict
promotion refuse generated writer authority after coverage is armed; a
non-test production activation cut checks the closed inventory and exact
four-writer manifest but remains uninvoked pending review/publication);
2026-08-04 (the approval-derived migration
aggregate has an immutable P-side Pending envelope plus an additive,
receipt-byte-verified T supplement; exact replay, divergent refusal, P/R
journal singleton checks, response loss, cleanup resume, capacity, corruption,
and bounded Host-window retention are exercised without activating coverage);
2026-08-04 (the closed public owner evaluator now
admits exact generated create as well as update, binds create's private mint
observation to the active plan's exact site/id/occurrence, strips that private
ledger before projection, recognizes generated delete but refuses it because
no current row can satisfy owner policy, and keeps aggregate/non-row,
membership, effect-bearing, opaque, truncated/expired, and changed-authority
cases metadata-free); 2026-08-04 (new migration journal rows carry one
authenticated Host identity per physical transaction, derived from the
approval operation and durable pre-transaction journal-row count; production
apply/release, rollback, cleanup-reopen, multi-entry transaction, and lease-
superseding retry fixtures are green, while the migration lane remains absent
from coverage manifests pending a separately accepted pending→terminal
lifecycle); 2026-08-04 (the local writer connection arms its
SQLite authorizer from durable coverage state, disables prepared-statement
cache reuse across token lifetime, and admits covered application-table DML
only inside the closed ordinary/host adapter facade; the complete migration,
seed/reset, admin, projection, and specialized inventory remains open);
2026-08-04 (the public explanation lane now has a
narrow exact generated owner-update evaluator; any artifact drift,
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
  identity ranges persisted atomically client-side. Each range holds at most
  256 counters and an epoch holds at most four contiguous ranges (1,024
  identities total, matching the client outbox and per-auth settlement
  bounds). Exact response-loss recovery may re-serve an unadmitted successor;
  a fifth same-epoch range refuses `SNAPBACK_OPERATION_RANGE_EXHAUSTED`, and
  further admission requires a fresh authenticated epoch. Range exhaustion
  degrades to disclosed uncovered queueing with refresh at reconnect. A
  client epoch closes only when both hold: its issuer is terminated **or
  revoked**, and every ranged identity is **admitted-and-acknowledged**,
  never-admitted and range-window-expired with an explicit outcome-unknown
  classification, or operator-purged (LLP 0043's acknowledgement — an
  admitted-but-unacknowledged identity holds its epoch open). The
  per-audience floor advances only over the contiguous closed prefix; closing
  a later sequence cannot leap an earlier nonclosed sequence. Host-originated
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
  the floor passes. The tombstone retains separate domain-separated digests
  of the full identity and its authorization facts plus the terminal outcome
  class. It retains the audience/epoch/counter routing projections needed for
  floor and uniqueness checks, but not the individual principal, authority,
  input, or issuance-authenticator facts. Exact agreement returns
  `result-expired`; authorization divergence returns
  `SNAPBACK_AUTH_STALE_RESULT`; other identity divergence returns
  `SNAPBACK_CLIENT_MUTATION_ID_REUSED`. Tombstone growth in an open client
  epoch is bounded by the 1,024-identity aggregate epoch cap. Lookup
  precedence: suppression record → compact
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
  Both terminal and pending writer seams re-run the retained classifier in
  that transaction before publication; prior handler lookup is not insertion
  authority, and refusal rolls back staged app and journal writes.
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
[`operation.coverage-activation-request-v1.schema.json`](../schemas/operation.coverage-activation-request-v1.schema.json),
[`operation.coverage-activation-response-v1.schema.json`](../schemas/operation.coverage-activation-response-v1.schema.json),
and
[`operation.coverage-manifest-v1.schema.json`](../schemas/operation.coverage-manifest-v1.schema.json),
all generated from
[`crates/snapback/src/commit_envelope.rs`](crates/snapback/src/commit_envelope.rs). Schema presence is an
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

[`crates/snapback/src/operation_ledger.rs`](crates/snapback/src/operation_ledger.rs) now owns durable
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

## Implementation record — 2026-08-04, migration transaction carrier

Every new `MigrationJournalEntryV1` records the authenticated Host
`OperationIdentityV1` of the physical SQLite transaction that appended it;
legacy entries may omit the field. The migration approval's `operationId` is
the durable upstream identity. The child ordinal is the count of that
operation's durable journal rows before the transaction begins, so all entries
from a multi-entry transaction share one child and the next transaction starts
at the first still-unoccupied ordinal. Attempt-local timestamps, executor
instances, and fencing lease epochs are excluded from derivation.

The migration executor provisions the range-less Host incarnation in its own
durable transaction after semantic admission but before the first migration
transaction. Apply, rollback, release, cancellation/abort, step wrappers, and
both cleanup cuts then authenticate their child against that incarnation.
Cleanup recovery provisions it on reopen as well, preserving compatibility
with legacy migrations. The focused crash fixture rolls a journal transaction
back, supersedes its fencing lease, and proves retry reconstructs the identical
authenticated child; the production apply/release corpus proves every emitted
row has a carrier and every transaction group's ordinal equals its durable
starting row.

This is provenance carriage, not migration envelope coverage. Publication
commits the live successor schema, application version, schema-resync change
row, and `published-held` journal transition at version P. A later transaction
records `released`, deletes the fence, and seals the terminal migration
receipt; rollback has its own republish-and-terminal cut. The aggregate
settlement amendment below now represents that split truthfully, but neither
the aggregate P/T boundary nor the H1/H2/C transaction children have been
activated in a coverage manifest. The generated journal artifact therefore
continues to declare every migration boundary uncovered.

| LLP 0162 acceptance row | Status after this slice |
| --- | --- |
| 1 | **Partial** — migration transactions now have durable Host carriers, but publication and terminal receipt remain non-atomic across transactions and no migration envelope is written. |
| 2 | **Partial** — a rolled-back migration journal cut retries under the same identity even after fencing-lease supersession; the aggregate pending/terminal replay contract was not part of this carrier-only slice and is implemented by the amendment immediately below. |
| 4 | **Partial** — the generated migration artifact explicitly declares the lane uncovered; no coverage manifest includes it, so it cannot inflate the complete-target writer claim. |
| 13 | **Partial** — unchanged: the qualified paired active-lane measurement remains required for lanes eligible for publication. |
| 14 | **Partial** — first-party migration transaction identities are now production-reachable and authenticated; migration aggregate settlement plus the remaining capacity/purge corpus are open. |

Every related capability remains `Missing`; this slice makes no advertisement.

## Implementation record: 2026-08-04, migration aggregate settlement tail

One migration aggregate identity is derived from the approved migration
`operationId`, authenticated by the durable range-less Host incarnation, and
persisted at admission. Attempt time, executor identity, and fencing lease are
not identity facts. The separate per-transaction H1/H2/C children remain
provenance carriers only.

Publication P is one SQLite transaction containing the live successor
schema/generation, application version P, retention floor, exactly one
schema-resync change row, `published-held`, an immutable
`CommitEnvelopeV1` whose receipt state is `Pending`, and a pending lifecycle
row. Its produced snapshot is P; its one write fact is the exact schema-resync
row. Lookup decodes and validates the retained envelope, recomputes the JCS
pending-receipt digest from its actual retained projection, and requires exact
identity, P, state, digest, timestamp, and payload equality. A missing,
swapped, or corrupt envelope refuses; an exact pending lookup returns
`published-held`/outcome-pending without writing.

T-release and T-rollback never rewrite P. In the same transaction as the
terminal migration journal/receipt cut, they append
`PendingOperationTerminalSupplementV1`, binding the exact aggregate identity,
P, pending receipt digest, terminal outcome (`Committed` or `RolledBack`),
terminal write-set digest/count, and terminal receipt digest. The migration
adapter computes that receipt digest from the receipt JSON read back from the
owning `_snapback_migration_ops` columns and re-verifies those retained bytes
on public lookup. The supplement contains no duplicate terminal payload and
uses a new additive outcome vocabulary; the existing v1 suppression and
tombstone schemas are unchanged.

Pending is not ACKable or reclaimable, consumes the one-entry migration
aggregate lane budget, and holds its Host epoch through an effectively
unbounded lease. T completes that lease and starts the ordinary 24-hour Host
receipt window. A rotated epoch cannot close while the supplement is young;
after the window it atomically compacts the Pending envelope payload and
removes both lifecycle rows. Thus no terminal plaintext is duplicated and no
full supplement is retained forever.

The dated corpus cuts P before commit, P transaction interior, after P/before
T, T-release interior and response loss, T-rollback interior and response
loss, cleanup resume, divergent pending/terminal replay, capacity pressure,
and retained-envelope corruption. It also asserts exact singleton
schema-resync counts at P and rollback-resync counts at R. Exact terminal
retry returns the stored receipt; divergent finalization or approval facts
refuse before application writes.

| LLP 0162 acceptance row | Status after this amendment |
| --- | --- |
| 1 | **Partial** — aggregate P and terminal T/R facts now have truthful atomic carriers, while full target coverage and H1/H2/C envelope mapping remain open. |
| 2 | **Partial** — pending and terminal retry/corruption cuts are green for the aggregate; the complete named-target corpus remains open. |
| 4 | **Partial** — the generated artifact enumerates aggregate P/T plus carrier-only H1/H2/C as uncovered, so this implementation cannot inflate coverage. |
| 13 | **Partial** — unchanged: fixed-Air paired active-lane performance and its independent gate remain required. |
| 14 | **Partial** — aggregate lifecycle/capacity/retention are production-reachable, but remaining writer, performance, review, and publication gates stay open. |

This is an implementation amendment to the Draft Spec, not author acceptance
or capability publication. Independent review is still required. Every
related capability remains `Missing`.

## Implementation record — 2026-08-04, lifecycle and atomic-envelope tail

The two declared ordinary writers now expose deterministic test-only crash cuts
before predecessor settlement, after predecessor settlement but before the
CommitEnvelope, and after the envelope but before SQLite COMMIT. HostPlan and
Buffered corpus runs each cut against a file database, reopen it, and prove
that application rows, version/change journal, predecessor replay row,
envelope, suppression row, and protected custody are either all absent or all
committed. A successful commit is then reopened and exact-replayed without a
second write.

The predecessor `_snapback_client_mutations` row is no longer the only retry
authority. When that full payload is absent, an issuance-bearing retry resolves
its server-recorded audience and applies LLP 0162's suppression, tombstone,
compact-envelope, then floor lookup order. Exact replay opens the digest-bound
protected receipt reference and reconstructs `MutationOutput`; suppression
JSON retains no receipt plaintext. ACK and explicit operator purge reclaim the
full result while preserving `result-expired` duplicate prevention. Epoch
closure plus independent compact-envelope expiry classifies both a previously
committed retry and a never-delivered preallocated identity below the floor as
`identity-horizon-passed` / outcome unknown before writer dispatch.

Operator purge now converts only the active-stream client partition selected by
the predecessor settlement into tombstone/compact state in the same
transaction, and writes a payload-free selector/key digest audit row. Corpus
uses the same operation-id text in a retired client stream and an active-stream
host partition under divergent principals; both unrelated keys survive while
the exact active client key becomes result-expired. Bounded-retention corpus
also proves an unacknowledged first result refuses a second operation without
evicting exact replay.

The JavaScript outbox distinguishes `result-expired` from a failed operation
and `identity-horizon-passed` from any terminal result. Before a
result-expired error is surfaced, memory, IndexedDB, and file stores atomically
move the pending record to the durable fourth state `result-gone`, retaining
the known outcome and receipt digest. Equal terminal facts are idempotent;
different outcome or digest refuses as divergent custody. `result-gone` never
re-enters transport, keeps later ordered submissions fenced until explicit
discard, and is projected separately by `outboxStatus` and the React outbox
binding. A file-backed client closed and recreated over the same store restores
that state without a network delivery. Identity-horizon-passed remains pending
and outcome unknown. HTTP
maps result-expired to 410 and the identity horizon/stored-refusal classes to
409.

The production host-child HostPlan adapter now exercises the same lifecycle
with server-issued host-incarnation identities. Exact retry returns the
retained result while one-entry settlement custody is full; a novel child
refuses without writing. Client operator purge removes predecessor full-result
custody but leaves the Host suppression record authoritative, so exact replay
still returns without dispatch. After a durable host-incarnation rotation,
that settled retry remains replayable while a delayed first delivery under the
retired epoch refuses the no-longer-live server issuance before any write.

| LLP 0162 acceptance row | Status after this tail |
| --- | --- |
| 1 | **Partial** — durable client result-gone custody and production host retry/capacity/purge/rotation cuts are green; complete named-target and migration/cross-lane acceptance remains open. |
| 2 | **Partial** — file-backed client recreation does not redeliver result-gone work, and retired-authority delayed Host delivery refuses before dispatch; recreated-branch and complete cross-arm lifecycle corpus remain open. |
| 14 | **Partial** — host child current-authority, retry, capacity, and purge isolation are exercised through the real writer; remaining first-party/cross-lane and publication gates stay open. |

This closes additional LLP 0162 rows 1, 2, and 14 corpus cells but does not
activate a production coverage manifest. Recreated-branch end-to-end corpus,
migration/cross-lane retention closure, active-lane paired performance,
independent review, and named-author acceptance remain open. This Spec remains
Draft and every related capability remains `Missing`.

## Implementation record — 2026-08-04, SQLite write-authority slice

[`crates/snapback/src/storage/write_authority.rs`](crates/snapback/src/storage/write_authority.rs) installs
one connection-local SQLite authorizer after boot and reconstructs its armed
state from the durable stream coverage manifest. Its
`GeneratedWriterTokenV1` constructor and fields are private to the closed
writer facade. The ordinary HostPlan, ordinary Ibex-buffered, host-child
HostPlan, and host-child Ibex-buffered adapters select distinct physical
writer classes before their transaction prepares application DML. Once any
manifest is armed, raw application-table insert/update/delete and application
DDL prepared outside the facade are denied by SQLite itself.

Because SQLite authorization occurs at prepare time, the armed writer
connection has a zero-capacity prepared-statement cache; the facade does not
return raw statements. Corpus prepares a covered write under a live token,
drops it, and proves a same-SQL cached prepare is re-authorized and denied.
Trigger- or view-mediated application DML is also denied even inside a token:
the generated `ChangedRow` set has no trigger adapter and therefore cannot
journal that hidden effect. Raw trigger source and target changes roll back
together. The positive issuance-bearing HostPlan and buffered corpus still
commits, retains one envelope per operation, and compares the exact stored
postimage — including `_id`, `_version`, `_createdAt`, and `_updatedAt` — with
the journal postimage.

The target/app-effective projection is deliberately not a completeness claim.
It now names 23 physical families individually: the four ordinary/host
adapters; schema activation; migration; destructive reset; standalone seed;
membership transition; projection rebuild and derived projection maintenance;
auth/admin, assets, search, vector, push, jobs/cron, operation-ledger,
history/checkpoint, and branch-registry system writers; strict promotion; and
rollback-only dry runs. There is no grouped `specializedSystem` escape hatch.
Every row is physically enumerated and is exactly one of envelope-mapped or
bound to a stable exclusion reason.

The exclusion is executable, not documentary. Once coverage is armed,
schema, migration, reset/seed, standalone seed, standalone membership,
projection rebuild, and strict-promotion writers cannot acquire the generated
writer token and fail with `SNAPBACK_OPERATION_WRITER_EXCLUDED`; they cannot
fall back to raw SQL because SQLite still denies it. Projection maintenance
runs only within its parent writer transaction, and the remaining specialized
families write Snapback-owned system state rather than originating
application-table DML. A production (non-test, non-benchmark) storage cut now
checks the closed inventory and can publish exactly the two ordinary and two
host-child adapters. It is deliberately not called by open or range issuance
while independent review, author acceptance, and performance publication are
open. Therefore row 4 and row 9 remain Partial, the Spec remains Draft, and
every related capability remains `Missing`.

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
re-serving that exact latest range only while that range has admitted no
identity; after admission from that range, missing durable custody refuses
rather than risking counter reuse.
Each range contains 256 counters and one epoch may own at most four contiguous
ranges (1,024 identities in aggregate). The fifth range refuses atomically
with `SNAPBACK_OPERATION_RANGE_EXHAUSTED`; the client retains uncovered intent
locally and obtains a fresh authenticated epoch before admission continues.
An uncovered intent has no server-admitted operation identity, so after an
authenticated session rotates the client may atomically bind it to the fresh
descriptor/range only when the durable predecessor principal id equals the
fresh authenticated principal id. A missing or different principal keeps the
intent pending with `uncovered-reauth-required`; it is never terminalized or
submitted across principals.

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
the committed owner postimage to be the current subject, but generated creates
also carry a private minted-id context answer and therefore remain unprovable
under the closed empty-context v1 profile. Update additionally
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
The owning connection performs sealing and opening inside a direct-only scalar
function whose captured root key zeroizes on connection drop and is never an
SQL input or result; key custody does not retain a separate TEMP database pager
or make the key durable in the data file.
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
| 3 | **Partial** — exact public/admin transport and encrypted protected custody are wired. Admin current policy projects the complete retained fact set. Public current-policy projection is green only for the closed generated owner-create/update profiles; delete is exactly recognized but remains fail-closed because no current row can satisfy owner policy. Aggregate/non-row, hand-written/opaque, predicate, membership, effect-bearing, and other unsupported shapes remain deliberately fail-closed. |
| 4 | **Partial** — protected-detail retention is independent and fork custody is closed, but complete-target activation/asymmetric-retention acceptance remains open. |
| 14 | **Partial** — unchanged: promotion is wired, while first-party job/cron/migration/child identities are not yet production-reachable. |

Every related capability remains `Missing`; this slice makes no advertisement.

## Implementation record — 2026-08-04, public current-policy evaluation tail

The public evaluator now treats exact generated `owned-crud.v1` / `owner.v1`
create and update plans as two separate closed profiles recovered from the
currently loaded artifact. Create requires exactly one inserted row whose
current owner and retained insert postimage are the current subject, one
matching ctx id, and one server-captured private settlement-mint observation
bound to the active plan's exact `plan/steps/0/insert/row-id` site, occurrence
zero, and the inserted id. The observation is checked only as captured
consistency evidence; it supplies no authority and its private site/occurrence
ledger is removed before the protected receipt enters the public projection.

Generated owner delete is also recognized from its exact get/guard/delete
plan, but deliberately returns `authorization-unprovable`: LLP 0088's
current-plus-per-version rule cannot authorize an absent current row, and the
retained historical owner, operation identity, audience, and ciphertext
custody cannot substitute for that missing current authority. Hand-written or
opaque artifacts remain outside the closed profile regardless of matching
metadata strings.

The focused corpus covers changed current and historical owners; missing-row,
predicate/query and aggregate result-membership facts; membership-shaped
permission facts; widened ctx answers; effect-bearing envelopes; divergent or
unknown receipt shapes; wrong-site, extra, and reordered private mint
observations; truncation and expiry; artifact, principal, audience, and
authority-incarnation change; and unsupported policy shapes. Every refusal
withholds stored metadata, counts, digests, and detail behind the stable
`authorization-unprovable` disposition. Membership, general predicate/query,
aggregate/non-row, effect-bearing, opaque/hand-written, and other generated
profiles still have no positive evaluator, so row 3 remains **Partial**, the
Spec remains Draft, and every related capability remains `Missing`.

## Implementation record — 2026-08-04, explicit local activation transport

The production server now registers authenticated
`POST /_snapback/api/storage/operation-coverage/activate` as a managed-
admission `AdminWrite` command with a dedicated authority-only invocation
source. Its Rust-owned closed request accepts only schema version 1, target
`local-dev-sqlite-ibex`, and coverage profile
`local-envelope-mapped-writers.v1`; unknown targets, profiles, versions, and
fields refuse before publication. The handler revalidates administrative
authority, fences publication against revocation, and then calls the existing
storage chokepoint that rechecks the complete 23-family inventory before
persisting and arming exactly the two ordinary and two host-child adapters.

Database open, operation-range issuance, and capability inspection do not call
the command. A repeated exact request is idempotent and returns the same active
manifest. Focused production-profile HTTP corpus proves unauthenticated,
wrong-target, and wrong-version refusal without arming; exact activation;
exact lane/writer contents; and idempotent retry. The existing corpus continues
to prove every excluded app-effective writer refuses after arming.

This transport closes the previously private activation reachability gap, not
the complete-target coverage or publication gates. Excluded app-effective
writers remain outside the manifest; the fixed-Air active-lane performance
record, applicable cross-lane/asymmetric-retention corpus, independent review,
and named-author acceptance remain required. LLP 0163 therefore remains
Draft, no activation occurs by default, and every related capability remains
`Missing`.

## Implementation record — 2026-08-05, C27 abandonment and C28 lifecycle repair

Exact candidate `cf56fd38229cebe3616f18c5f51e48c295f15d7c` was stopped
pre-result and produced no paired artifact; the absolute recorder was not run.
Independent review found four correctness defects: tombstones lacked enough
payload-free comparison authority, later epoch closure could leap the floor
over an earlier open epoch, same-epoch successor issuance was unbounded, and
direct writer insertion could bypass a tombstone after ACK plus compact
pruning.

C28 gives each tombstone separate domain-separated full-identity and
authorization-facts digests, validates its SQL/JSON epoch and counter
projections, and
preserves the exact/auth-stale/other-divergence diagnostic split after compact
pruning. Floors advance only over the contiguous closed prefix. Client epochs
are capped at four contiguous 256-counter ranges, aligned with the existing
1,024-record client outbox and per-auth settlement bound; exact lost-response
re-service remains available and a fifth range refuses. Capacity-stranded
uncovered intent can adopt a fresh authority/range only under a durable
same-principal comparison; a missing or different principal remains pending.
Both terminal and pending writer insertions run the retained
suppression/compact/tombstone/floor
classifier inside their publication transaction before authentication,
capacity, or insertion. Suppression replay also validates the retained record
against its identity and SQL projection.

Focused corpus covers digest golden vectors; input, audience, principal, and
authority divergence after compact pruning; SQL/JSON counter corruption;
terminal and pending direct-writer tombstone refusal; rollback; a later ready
epoch closing while an earlier epoch remains open; bounded successor issuance,
exact response-loss recovery, atomic capacity refusal, and same-principal fresh
authority continuation. Pre-C28 tombstones lack the required comparison fields
and therefore fail closed as ledger-invalid rather than replaying; because the
capability is still Missing, no published active lane can have created them.
This repair is not a capability claim: LLP 0163 remains `Draft`, and
every related capability remains `Missing` pending fresh full correctness,
fixed-Air performance, independent review, and named-author acceptance.

## Implementation record — 2026-08-05, merged C28 review stop and C29 repair

Exact merged C28 commit `e60473b41159d639bb35ac926564ae49b64f9f51`
received independent `NOT READY` verdicts before performance. No paired or
absolute process ran. The defects were automatic sessions-mode range custody,
Host tombstone schema nullability, retention-critical terminal-time SQL/JSON
coherence, and missing staged app/journal rollback proof at the pending writer
seam.

C29 obtains and durably records the current sessions authority descriptor and
authenticated principal before the first range assignment; the request layer
also injects that descriptor on the range route. The Rust-owned tombstone
schema now makes `counter` required and nullable, with a representative Host
instance validated against the committed artifact. Suppression lookup compares
SQL terminal/acknowledgement projections to the JSON record, and Host closure
re-runs exact lookup before trusting the terminal-time projection. The pending
writer negative stages application and journal rows under a savepoint, refuses
the tombstoned identity, rolls the savepoint back, and proves no app, journal,
envelope, or pending lifecycle row survived while the tombstone remains.

Focused repair proof is 42/42 client tests, the exact writer/Host-closure test,
35/35 artifact-schema tests, and the schemagen ownership/reaping test. This is
not publication evidence: the Spec stays `Draft` and all related capabilities
stay `Missing` pending a fresh clean exact candidate, independent reviews, and
the unchanged performance/publication gates.

## Implementation record — 2026-08-05, exact C29 stop and C30 repair

Fresh Codex and Fable review of exact clean C29 commit
`3f5c587fbe58533a6d471b0e13f238e6baabf774` returned two `NOT READY`
verdicts before performance. No paired or absolute process ran. The shared
blocker was the sibling pending-terminal table's unchecked SQL retention-time
projection; the remaining carrier blockers were automatic sessions ACK
selection before authority resolution, a public cross-principal
existence/divergence oracle, and a Host writer rollback matrix that did not
distinguish staged caller writes or cover both terminal and pending seams.

C30 makes the retention check comparison-complete across ordinary suppression,
pending lifecycle, and terminal-supplement rows. Host closure enumerates the
global retained Host set, checks physical keys and JSON identities, validates
lane/audience/epoch/time/ack projections, and only then trusts indexed SQL
retention predicates. It resolves current session descriptor/principal custody
before ACK cohort selection and proves the next automatic sessions mutation
carries and confirms the consumed obligation. Public foreign and absent keys
share one metadata-free `authorization-unprovable` response; only AdminRead
retains exact collision diagnostics. Direct Host terminal and pending tests
prove staged app/journal rows exist before caller rollback, no forbidden
envelope/suppression/pending/lease row is written, rollback removes the staged
publication, and the retained tombstone survives. Host closure additionally
proves JSON-side terminal/ack corruption, terminal-supplement SQL corruption,
the young-window hold, and final lifecycle reclamation/floor state.

The required-nullable tombstone counter is now required by Rust decoding as
well as the generated schema. This Spec remains `Draft`; all related
capabilities remain `Missing` pending fresh exact review, the unchanged
performance gates, and publication acceptance.

## Implementation record — 2026-08-05, exact C30 stop and C31 repair

Fresh review of exact merged C30 commit
`365a3f21117cbaecdf80b8e5bff7debea47fc2d0` returned Fable `READY` and
Codex `NOT READY` before performance. Codex found that Host closure still
trusted lease audience/epoch lookup projections and that pending-capacity
admission still counted unvalidated lifecycle lane/audience projections.
Fable separately identified the analogous client-suppression closure
asymmetry as low priority. No paired or absolute process ran.

C31 globally decodes and validates Host lease rows before register, complete,
or closure; the physical key and SQL audience/epoch must match the retained
identity. Pending-capacity admission likewise enumerates every lifecycle,
checks physical key plus lane/audience/epoch JSON coherence through exact
pending lookup, and counts only validated outcome-pending rows. Client and
Host closure now share the global suppression comparison pass. Moved lease,
pending, and client-suppression projections have direct fail-closed fixtures.

This Spec stays `Draft` and every related capability stays `Missing` pending
a fresh exact candidate, dual review, the unchanged performance gates, and
publication acceptance.

## Implementation record — 2026-08-05, C31/C32 pre-result abandonments and C33 merge

Exact clean C31 commit `58ec598c38b3f8077682266727dbe3e0dc574b1d`
was abandoned before either fresh review returned because the mandatory fetch
found newer `origin/main` at `2bb84423b59e81e4afa865339765142ad2769bc2`.
No C31 review artifact, paired record, or absolute record was accepted.

Merge commit `1eaa30b7f4e810476c556c3c4206b3deb6597849` preserves the C31 global
lease, lifecycle, and suppression validation while compositionally adding the
upstream AppDescriptor and artifact-index changes. All maintained generated
closures were regenerated from the combined source and the full Rust,
client, schema, publication, guide, reference, and catalog gates were green.
The Spec remains `Draft` and every related capability remains `Missing`. C32
received one fresh Fable `READY`, but the Codex review did not complete as a
qualifying result before the remote-tip check found newer main; no final C32
review artifact was accepted and no performance process started. The newer
mainline cuts were merged normally as `cc5d6bce64550210d7b55b929841a8f9af8f2f68`
and `211f85714cdac7abdf4022b77cb08bce4419a35c`, with combined guide/generated
closures regenerated. C33 must receive fresh exact dual review before any
performance process starts.

## Implementation record — 2026-08-06, C33 dual-READY landing chain

Exact clean C33 commit `60637db377a681ff1f22cbe19f7b49b96b20ab9f`
and implementation digest
`sha256:40789d24edf34b3a9cb9544e94e47337d5beb35ef065d290e19bcc67e610010d`
received independent fresh `READY` verdicts from the Codex and Fable model
families. The required post-review fetch then found newer main at
`d4ac75595d85e532d9938ea56b8cee03f929eaf4`. Under the author ruling now
recorded in the carrier ticket, C33's reviewed work remains authoritative
through the normal conflict-resolving merge chain beginning at `d56721ca5a`;
the interim C34/C35 labels are rescinded and do not name qualification cuts.
The merge chain retains the Track B carrier, custody, and fail-closed
projection repairs while adding the fork asset-recovery, LLP 0158 acceptance,
fork lifecycle evidence, and client/demo fixes from main. The merged tree must
land after proportional verification, and row 13 then runs against the landed
commit. The Spec remains `Draft` and every related capability remains
`Missing` until post-landing performance and every other named gate pass.

## Implementation record — 2026-08-06, post-landing row-13 result and scope reconciliation

The C33 merge chain landed; landed commit
`a0852be190d7a908e2419ccaac43f30eee977ee2` then ran the row-13 paired gate
and produced a preserved paired record (SHA-256
`8e1f6a4cbbe786eb4eba71c8dc435457331d87446dd26a39a80314a4c6272ab0`). Eight
of nine read/write comparisons and every idle gate passed; current-range p95
alone crossed the unchanged faster-side equivalence edge, and the absolute
process did not run. The fix-forward restores the pinned per-call range
preparation boundary without changing the measurement contract (LLP 0162
v0.39). A new landed successor must pass the unchanged paired and
conditional absolute gates; the Spec remains `Draft` and every related
capability remains `Missing`.

Two scope corrections for earlier records in this Spec:

- The 2026-08-04 write-authority record's closing sentence asserts "row 4
  and row 9 remain Partial." Row-9 state is not this Spec's to assert: under
  the LLP 0185 Phase 0 ownership split, LLP 0164 owns the fork/diff rows and
  LLP 0165 owns the journal-completeness leg. The row-4 half of that
  sentence stands.
- This Spec's acceptance scope (rows 1–4, 13, 14) does not include the
  derived-deployment fork net diff as an attribution consumer. The
  derived-deployment diff receipts do not carry LLP 0163 operation identities
  today: both the journal-sequence `snapback.fork-journal-diff.v3` receipt and
  the independent `snapback.fork-net-diff.v3` receipt say so machine-readably
  (`attribution: "absent-v1"`, 2026-08-06). That deferral is owned by LLP 0185
  Phase 4 item 8 ("absence of attribution stays explicit") and is not a gap in
  this Spec's rows.

## Status

**Accepted 2026-08-06 (Charlie Cheever).** Three mutually blind rounds of
Codex- and Fable-family review converged `READY` for this Spec. Acceptance is
of the operation-identity and commit-envelope contract. It does not make the
broader `AgentSafeV1` aggregate, the storage publication, uncovered Track B
rows, or any target-manifest predicate positive. The narrow local derived-fork
publication also retains machine-readable `attribution: "absent-v1"`; every
wider fact remains `Missing` or an explicit nonclaim under its owning record.
