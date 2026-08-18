# LLP 0244: MediaRef projection

**Type:** Spec
**Status:** Accepted
**Systems:** Assets, Schema, Storage, Query planning, Live Queries, Runtime,
Mutation settlement, Authorization, Field masking, Offline retention, Code
generation, Diagnostics, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-12 (author acceptance after the round-3 READY convergence;
metadata-only transition, no decision bytes changed); 2026-08-12 (round-2 review response: OCC-before-egress race
disposition, a single-attempt `MediaProvenanceTokenV1` lifecycle, an explicit
settlement-format epoch and legacy watermark, and settlement-identity-bound
seals); 2026-08-12 (round-1 review response: class-M-aware
`via-references`, post-write commit-egress disclosure, exact source-cell JS
provenance, a sealed settlement carrier with legacy-row policy, and the
masked-only logical-position qualification); 2026-08-12 (initial Draft)
**Related:** LLP 0239, LLP 0210, LLP 0211, LLP 0235, LLP 0242, LLP 0243,
LLP 0044, LLP 0053, LLP 0043,
`issues/20260812-media-ref-snapshot-projection.md`

## Summary

This Spec defines the server seam that turns the compact asset id stored by a
`v.media()` field into LLP 0239's exact `{ assetId, kind }` result. One typed
media projection runs inside the authoritative storage cut that produces a
fresh result: inside the pinned read transaction for queries and inside the
committing transaction for mutations. Settlement recovery and protected
retention preserve those already-projected bytes and never look up asset
metadata again.

The four-valued `kind` is deliberately disclosed with a class-M-disclosed media
field even when the caller cannot read or deliver the referenced asset. Asset
read policy still controls all richer metadata and issuance; denial therefore
appears at LLP 0239 D5's media-store seam, with the structurally unchanged
`MediaRef` available to form its `denied` state. Projection success, nullability,
row membership, ordering, and result refusal do not vary with asset read policy.

V1 permits attachment to a `v.media()` field only after the asset is `ready`
and its primary bytes have a server-detected kind. Once attached, an asset id's
kind is immutable. Pending attachment, provisional kinds, and in-place
content-kind replacement are outside this capability.

## Motivation

LLP 0239#d1-vmedia-is-the-zero-or-one-application-field binds the public
contract:

- the application row stores only the opaque asset id;
- the server supplies `kind` from admitted metadata at the same authoritative
  snapshot as the application result;
- `{ assetId, kind }` is part of the exact online and retained result contract;
- clients do not manufacture `kind` with an undeclared metadata read; and
- public writes do not gain authority by carrying a claimed `kind`.

The current runtime has no common post-handler lookup that can meet that
contract. Query execution does have a pinned view, but result validation is a
pure JSON-shape check. Mutation results are retained during commit, and an
already-settled duplicate may be recovered after both the originating snapshot
and the active function have disappeared. Asset record projection separately
applies asset read policy, while pending assets may not yet have a detected
content type. The STOP record
`issues/20260812-media-ref-snapshot-projection.md` correctly refused to paper
over those differences.

This Spec treats the accepted LLP 0239 result shape as binding. It selects the
storage/result materialization seam, the disclosure treatment of `kind`, and
the finalized-only v1 rule without changing LLP 0239 or the general
`v.assetRef()` contract.

## Binding constraints

- A media reference remains an addressable typed asset edge governed by
  LLP 0044#typed-references-and-atomic-attachment, not an opaque structured
  value. LLP 0211#declaration-closed-dispatch-closed-interior continues to
  refuse asset references inside structured interiors.
- All facts in one projected result come from one authoritative read or commit
  snapshot. LLP 0242#d1-one-closed-projection-algebra's exact result contract
  and completeness witness may not call a skewed result complete.
- A caller cannot use projection success, failure, result shape, or delivery
  timing to distinguish asset-policy outcomes. LLP 0235#22-logical-plan-position-audit
  applies to the media field and the projection operator; LLP 0053#the-one-constraint-everything-follows-from
  leaves authorization authority on the server.
- A class-M-masked media edge is not asset-read authority. LLP
  0044#asset-read-authorization's `via-references` decision must evaluate the
  exact referencing field's disclosure before treating its reverse edge as an
  authorizing edge, and LLP 0235#31-read-modify-write's field-keyed writeback
  refusal precedes asset admission diagnostics.
- Retained data is the already-authorized exact result, under the existing
  lease, descriptor, exclusion, and purge machinery. It is not a license to
  re-run joins offline (LLP 0243#d2-the-retained-view-descriptor-is-complete-and-content-addressed;
  LLP 0243#d4-exclusion-happens-before-bytes-enter-the-durable-store).
- Delivery denial stays at LLP 0210#d1--client-arm-signed-issuance-and-ttl-refresh-projection's
  typed issued-URL state machine. Projection neither issues a URL nor probes a
  delivery route.
- V1 may narrow LLP 0044's general pending-attachment allowance for the new
  `v.media()` subtype. It does not change pending attachment for plain
  `v.assetRef()` fields.

## Current runtime anchors

These are implementation anchors, not claims that the missing projection
already exists.

1. `crates/snapback/src/manifest.rs:2781-2800` (`result_contract_hash`) hashes canonical JSON
   for the complete result contract under `snapback:function-result:v1`.
   `crates/snapback/src/manifest.rs:3837-3890` (`rqs_eligible_digest_kind`) admits only a public,
   authority-independent, single-table HostPlan LiveQuery whose complete read
   summary names exactly that one plan table.
2. `crates/snapback/src/runtime.rs:594-670` (`run_ibex_query_with_reads_prepared`) executes JS
   query reads through one `DbRead` and reports the version from that same view.
   `crates/snapback/src/local.rs:30194-30229` (`execute_query_invocation`) pins the live
   connection before any plan/handler work, then
   `crates/snapback/src/local.rs:31337-31348` validates and publishes the returned rows while
   still inside that invocation.
3. `crates/snapback/src/result_contract.rs:76-105` (`validate_handler_result`) serializes,
   bounds, and recursively shape-validates a supplied `serde_json::Value`. It
   accepts no database/snapshot argument and performs no projection.
4. `crates/snapback/src/local.rs:11483-11545` and `crates/snapback/src/local.rs:12226-12263` recover an exact
   client-mutation settlement before handler dispatch; the latter path also
   returns before active-function selection. `crates/snapback/src/storage.rs:15215-15326`
   (`record_client_mutation_result`) serializes and inserts `output_json` in the
   committing transaction, while `crates/snapback/src/storage/settlement.rs:411-620`
   (`client_mutation_result`) later decodes those bytes from a new pinned read.
5. `crates/snapback/src/storage/asset_reads.rs:258-340` shows that an asset record is loaded
   before the separate `asset_read_authorized` decision and that the reserved
   live projection returns no row on denial. `crates/snapback/src/storage/asset_reads.rs:650-725`
   applies the same policy before variant enumeration and requires `ready`
   before signed issuance.
6. `crates/snapback/src/storage/asset_attempts.rs:323-430` creates an asset as `pending` and
   stores `declared_content_type` as optional request data. Trusted finalization
   records the detected primary `contentType` and transitions the asset to
   `ready` in one transaction at `crates/snapback/src/storage/asset_attempts.rs:900-962`.
   The general attachment checker currently accepts both pending and ready
   assets at `crates/snapback/src/assets.rs:2320-2398` (`verify_attachment`), which is why
   `v.media()` needs an explicit stricter field profile rather than an
   assumption about existing behavior.

## Decision

### D1. One authoritative media-result materialization cut

Codegen emits a closed `mediaRef.v1` result-contract node for every projected
`v.media()` occurrence. The semantic node contains:

- the source table, media-field identity, and schema field generation;
- outer optionality and class-M treatment identity;
- upload-intent identity and the closed admitted-kind set;
- the literal kind-classification profile `detected-content-type.v1`; and
- the media-reference retention class.

The runtime lowers those nodes into one `MediaProjectionPlanV1`. This plan is
not a callback and does not contain client-authored lookup code. It identifies
the exact result paths and the storage source of each asset id, so all targets
can reproduce the same output and read summary.

The logical projection operator is:

```text
MediaKindProjectV1(disclosed app media cell, finalized asset record)
  -> { assetId, kind }
```

It runs inside the **authoritative result materialization cut**. There is no
valid state in which raw result bytes have been published or durably settled
and `kind` is filled later.

#### Declarative Query and LiveQuery plans

The storage read plan projects media fields server-side in the same pinned
transaction that reads, filters, orders, and versions the application rows.
The local SQLite lowering joins each disclosed non-null asset id to the
finalized asset record's admitted `mediaKind`; other targets implement the
same typed operator in their transaction substrate. A row is not read in one
transaction and enriched by `asset_load_record` in another.

The projection is part of the plan's field-use inventory and completeness
witness. A composite node is complete only when its application rows and every
media projection were established at the one LLP 0242 snapshot/version.
LiveQuery reevaluation reproduces the whole operator; it never sends an
unprojected id for client enrichment.

#### JavaScript Query and LiveQuery results

Every `ctx.db.get/query` media cell is materialized by that same typed storage
operator before serialization into the handler realm. The handler sees either
`null` under optional/class-M treatment or a `MediaRef`; it never sees the raw
physical media column through an application read API.

The invocation retains a host-private media provenance sidecar for disclosed
cells. Each non-null media cell delivered to JS carries an unforgeable,
non-JS-visible `MediaProvenanceTokenV1`; the sidecar entry is keyed by that
token and records exactly `(sourceTableId, sourceFieldId,
sourceFieldGeneration, sourceRowId, assetId)`, the admitted kind, the class-M
program identity, and the pinned snapshot version. The dynamic row id lives in
the token rather than the semantic result-contract node.

At result handoff, each non-null `mediaRef.v1` result occurrence MUST carry a
token whose source table, field, and field generation exactly equal that
occurrence's semantic node; a value observed through another media field is
not interchangeable even when its asset id, kind, allowed-kind set, or policy
text is equal. Aliasing or selecting the original host-tagged value preserves
the token. Object spread, destructuring into a new object, JSON round-trip,
structured clone, or construction of a lookalike `{ assetId, kind }` does not
preserve it and refuses with `SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED`.
Supplying an asset id that the handler never received through the exact
declared media source refuses with the same code. This prevents a public
handler from becoming an existing-id/kind oracle merely by accepting an
opaque id argument or laundering a value across source fields.

The handoff normalizer replaces any handler-supplied `kind` with the sidecar's
admitted kind before calling `validate_handler_result`. The shape validator
remains pure and is never taught to open storage.

`MediaProvenanceTokenV1` has one closed host-owned lifecycle. At process
startup the host creates a process-local media-token epoch; every handler
invocation allocates a monotonically increasing, nonzero invocation nonce and
every disclosed media cell allocates a monotonically increasing, nonzero entry
nonce within it. Neither counter wraps or reuses a value: exhaustion refuses
with value-free `SNAPBACK_MEDIA_PROJECTION_TOKEN_EXHAUSTED`, and a process
restart discards the old epoch and every carrier that referred to it. The
sidecar scope also binds the prepared principal/authority instance, function
and artifact generation, `resultContractHash`, and pinned snapshot version.
A token is valid only for its exact process epoch, invocation nonce, sidecar
entry, and semantic result occurrence; it is never a VM-global capability.

Before an Ibex realm can return to the warm pool, result handoff MUST validate
every occurrence and move the matched entries out of the invocation registry
into one typed, process-local `StagedMediaProjectionProofV1` owned by that
invocation's `BufferedCommitPayload`. The carrier records the exact semantic
occurrence paths and source tuples, admitted kinds, disclosure-policy
identities, pinned snapshot, and captured dependency identities. It MUST NOT
enter the result JSON, `ctxLedger`, mutation request or identity, logs,
receipts, output bytes, or settlement row. Handoff then invalidates the entire
invocation registry and all JS object tags before the realm is pooled; a tagged
object retained in warm module state therefore refers only to an expired nonce
and cannot validate in a later invocation.

Storage preview receives a read-only borrow of
`StagedMediaProjectionProofV1`; preview may normalize and validate the result
inside its rolled-back transaction, but MUST NOT consume, clone, refresh, or
replace the proof. The one authoritative commit call takes sole ownership,
checks that its prepared invocation, payload, function generation, and request
identity match the carrier, and admits it for that attempt only. The carrier
expires whether that attempt commits, conflicts, refuses, is cancelled, loses
to a concurrent same-id settlement, or is dropped before commit. No second
commit attempt may reuse it.

A retry that executes application code again, including same-id re-entry after
an attempt for which no settlement exists, performs fresh reads and mints a new
process/invocation-scoped proof. An already-settled replay and recovery after a
concurrent same-id winner dispatch no handler, use no token or staged proof,
and return only D1's verified settlement bytes. Query handoff consumes its
tokens during normalization and destroys the invocation registry immediately;
queries have no commit carrier. HostPlan results mint no JS token and carry the
same source lineage in their typed plan.

V1 refuses `mediaRef.v1` in an Action's direct result contract with
`SNAPBACK_MEDIA_PROJECTION_SNAPSHOT_UNAVAILABLE`. Actions do not own one pinned
read view across their lifetime; an action returns an ordinary scalar/result or
invokes a Query/Mutation whose independently projected result the client reads
through that operation.

#### Mutation results

A mutation's raw handler/HostPlan result and `MediaProjectionPlanV1` enter the
storage mutation kernel together. The one named mutation projection snapshot
is the **commit-egress snapshot**: the committing transaction's final
post-write view after all application writes, reverse-reference edges, grants,
and system metadata for the mutation are staged, but before result validation,
settlement serialization, publication, or commit. This is a deliberate atomic
declassification seam distinct from LLP 0235's handler-read rule: handler reads
still evaluate class M against their pinned pre-write persisted snapshot, while
both HostPlan and Ibex mutation egress establish the exact source cell, its
class-M condition, and its media metadata together in the commit-egress
snapshot.

The commit-egress snapshot decides projection only **after** ordinary stale-read
admission has succeeded; it does not rebase an invocation whose persisted view
moved. Every exact media source cell, related row, and class-M condition-input
fact observed by Ibex MUST enter the invocation's captured read set, and the
prepared class-M program/activation identity MUST enter the guarded commit
dependencies. Before applying the buffered overlay or evaluating
commit-egress, the kernel validates those dependencies under the same OCC gate
as every other handler read. If another writer changed any source-cell or
class-M condition-input fact between the pinned handler view and that gate,
the attempt refuses with `SNAPBACK_MUTATION_CONFLICT` and
`retryPolicy: "reject"`; it emits neither `null` nor an updated `MediaRef`, and
commits no application write, edge, grant, settlement, or result. A moved
program/activation identity likewise fails its existing artifact/admission
guard before commit-egress and is never normalized under the successor policy.

Only changes made by this same, already-admitted transaction participate in
the later commit-egress decision. Thus a transaction-local condition change
from disclosed to masked emits `null`; a transaction-local delete, field-
generation change, or asset-id replacement follows the unprovenanced refusal
below; and a transaction-local change that leaves the exact cell disclosed
emits its overlay value. A HostPlan has no earlier opaque handler view: it first
validates any client read set and other pre-transaction plan dependencies, then
its reads and overlay share the committing transaction. These rules preserve
ordinary HostPlan isolation without inventing an external-race rebase.

For Ibex, the consumed `StagedMediaProjectionProofV1` supplies the source tuple;
a closed HostPlan carries the same tuple as typed plan lineage and never
manufactures a JS token. For each non-null result occurrence, the kernel
re-resolves that exact source row, field generation, field value, class-M
condition, and finalized asset record in the commit-egress snapshot. If the
source row is absent, its field generation changed, or the cell no longer
contains the staged proof's asset id, the mutation refuses with value-free
`SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED`; it does not publish an earlier
observation. If the exact cell exists but is masked there, the normalizer emits
`null`, even when the Ibex handler observed a disclosed `MediaRef` in its
earlier pinned view. If it remains disclosed, the normalizer emits the
same-snapshot `{ assetId, kind }`. A media id produced by a write is
provenance-admitted only when that same transaction verified and installed the
typed reference edge for the exact source row and field; a previously read id
must carry its exact staged proof and pass the same commit-egress
re-establishment.

The transaction then validates the projected result and, for an idempotent
mutation, writes those exact projected bytes to the settlement row. Failure to
project or validate aborts application writes, reference edges, grants,
settlement, and result publication together. Dry-run executes the same
materializer through the read-only preview borrow inside its rolled-back
transaction and reports the projected shape; only the later guarded commit
consumes the staged proof.

#### Replayed and settled result recovery

Recovery returns the exact projected settlement bytes. It performs no asset
lookup, does not require the old function/result contract to remain installed,
and never substitutes a successor projection profile. This preserves LLP
0043#settlement-consumption-and-acknowledgement-lifecycle-2026-08-01 and the
current recovery-first storage contract.

Before this capability activates, one exclusive storage migration MUST create
a protected `SettlementFormatEpochV1` store record containing an immutable
`storeScopeId` and `legacySequenceWatermark`. In the same migration, while old
settlement writers are excluded, it assigns every existing settlement a unique
positive store-local `settlementRecordSequence` no greater than the watermark
and stamps the independent, non-null row discriminator
`settlementFormat: "legacy-settlement.v1"`. The classification comes only from
membership in the pre-activation row set, never from `output_json`, the current
bundle, or the apparent presence of `{ assetId, kind }`. Activation refuses
until every predecessor is stamped and the store rejects writers that do not
understand the format epoch.

After activation, every new settlement atomically allocates a strictly
increasing `settlementRecordSequence` greater than the legacy watermark and
never reuses it, even after acknowledgement GC. This is a server-owned replay-
ledger row sequence, distinct from the client's queue-order sequence and from
sequence values inside `MutationOutput`. A new result contract without
`mediaRef.v1` writes `settlementFormat: "plain-settlement.v1"`; a contract with
any `mediaRef.v1` writes
`settlementFormat: "media-projected-settlement.v1"` and a complete
`SettlementProjectionSealV1` in the same transaction as `output_json`.

The store scope is the logical settlement-ledger scope, not a physical file
path. Backup/restore of that logical store preserves its `storeScopeId`, format
epoch, watermark, and sequence allocator; creating a distinct logical store
mints a distinct scope id. Sequence allocation exhaustion refuses before the
settlement or application effects commit and never wraps.

`SettlementProjectionSealV1` contains:

- the originating `resultContractHash`;
- `mediaProjectionProfileHash`, SHA-256 over
  `"snapback:media-projection-profile:v1\n"` followed by the JCS encoding of
  the complete `MediaProjectionPlanV1`;
- `settlementId`, exactly LLP 0043's request-derived
  `ClientMutationIdentity::activity_digest`, which already binds
  `clientMutationId`, function, input, auth/authority, and any operation
  issuance;
- `settlementStoreScopeId`, equal to the active format epoch's `storeScopeId`;
- `settlementRecordSequence`, equal to the independent row column; and
- `settlementDigest`, SHA-256 over the JCS encoding of
  `{ domain: "snapback:client-mutation-settlement:v3",
  settlementFormat: "media-projected-settlement.v1",
  settlementStoreScopeId, settlementRecordSequence, settlementId,
  resultContractHash, mediaProjectionProfileHash, output }`, where `output` is
  the complete `MutationOutput` value.

The stored `output_json` bytes MUST themselves equal the JCS encoding of that
`MutationOutput`. For a media-projected row, recovery first requires the
complete seal, compares its format, store scope, row sequence, and
`settlementId` with the independent row/store fields and the request-derived
identity, parses the output, byte-compares its JCS encoding with the stored
bytes, and recomputes the digest before running the existing version,
sequence-allocation, and broad `MutationOutput` checks. Transplanting an
otherwise valid `(output_json, seal)` between client-mutation rows therefore
fails on `settlementId` and/or `settlementRecordSequence`; transplanting it
between logical stores also fails on `settlementStoreScopeId`.

Once `SettlementFormatEpochV1` exists, recovery MUST NOT infer legacy status
from an all-null seal group. A `legacy-settlement.v1` row is eligible for the
predecessor checks only when its stamped sequence is at or below the immutable
legacy watermark; `plain-settlement.v1` and
`media-projected-settlement.v1` are eligible only above it. Legacy and plain
rows require the seal group to be wholly absent, while media-projected rows
require it to be complete. Missing or unknown row format, missing row sequence,
a format on the wrong side of the watermark, any seal field on a legacy/plain
row, a partially present seal, or a media-projected row with any missing or
mismatched seal field refuses with the one value-free
`SNAPBACK_CLIENT_MUTATION_RESULT_INTEGRITY` diagnostic. A genuine stamped
predecessor remains recoverable only through the legacy checks that existed
when it was written; it is never backfilled or upgraded from result bytes and
makes no sealed-media integrity claim.

Noncanonical encoding, digest mismatch, or a valid-JSON semantic edit—including
changing only a media `kind`—uses the same integrity refusal and is never
repaired by re-projecting against current metadata. The seal and watermark
detect accidental corruption, incomplete writes, and record misassociation
under the trusted storage boundary. They are unkeyed integrity witnesses, not
authentication against an actor able to rewrite both protected store metadata
and row data and recompute the digest; defense against such a database writer
is explicitly outside this capability's claim.

#### Retained query results

LLP 0243 receives the already-projected exact online result. Its result
normalizer applies declared media/reference retention or exclusion before the
durable client-store write. A retained `MediaRef` contains only `assetId` and
`kind`; it never contains a signed URL, rendition list, delivery bearer, or
other asset record metadata. Offline clients do not recompute `kind` and must
reauthorize online before issuing delivery URLs.

### D2. `kind` is disclosed-with-field; delivery policy produces `denied`

For v1, the coarse kind of a finalized attached media value is **not
asset-read-policy-bearing metadata**. It is a designated declassification of
the `v.media()` field contract. Once class R admits the row and class M
discloses that field, the result always contains the same structural
`{ assetId, kind }` value whether asset read policy currently allows or denies
the caller.

This declassification is narrow:

- it covers only `image | video | audio | file`;
- it grants no authority to inspect the asset record, list variants, observe
  availability transitions, read dimensions/duration, issue a URL, or fetch
  bytes;
- it applies only through a provenance-bearing `v.media()` result occurrence,
  not through the reserved asset-record endpoint or an arbitrary asset id; and
- it is governed by the application row/media-field disclosure policy, not by
  possession of the asset id.

`MediaKindProjectV1` therefore does not call `asset_read_authorized` and does
not branch on grants, membership, owner identity, or delivery profile. Asset
read authorization remains at record inspection, live asset state, issuance,
and delivery. A caller denied there passes the unchanged `MediaRef` to LLP
0239 D5's controller, which maps the structured authorization refusal to:

```ts
{ status: "denied", media: { assetId, kind }, diagnostic }
```

This is the one unauthorized-asset outcome. The query does not refuse, the
field does not become null because of asset policy, and the contract does not
grow a second denied-reference union.

At those separate asset-read boundaries, a `via-references` reverse edge from a
class-M field is authorizing for a principal only when that exact field is
disclosed for that principal in the authorizer's pinned storage snapshot. The
authorizer MUST evaluate the field's class-M condition before admitting the
edge; a masked edge is ignored, not treated as owner-only failure of the whole
search and not exposed through a distinct diagnostic. The reverse edge, source
row and field identity, condition-input reads, class-M program/activation
identity, and resulting disclosed-or-masked decision all enter the captured
dependency and LLP 0053 invalidation witness. Any other disclosed edge or
active grant may independently authorize the asset, but the masked edge itself
confers no authority.

On every caller-visible patch or replacement that names a class-M `v.media()`
field, the field-keyed writeback check runs against the pinned persisted source
row before the runtime parses or looks up the proposed asset id and before any
intent, owner, lifecycle, readiness, or kind admission. A masked field refuses
with `SNAPBACK_FIELD_MASK_HANDLER_WRITEBACK_INVALID` using public bytes that are
identical for unknown, pending, ready, wrong-intent, wrong-kind, and otherwise
admissible ids. V1 defines no separate explicit write intent that bypasses this
ordering.

Class-M field denial is distinct. Class M replaces the entire application field
with `null` at its normal projection/handler-read seam before
`MediaKindProjectV1` may consume it. When a media field is masked, neither the
masked cell nor the skipped media operator may feed filters, ordering,
grouping, counts, joins, index choice, cursor shape, diagnostics, or
timing-visible delivery. A masked field causes no asset join and exposes no
success/failure difference. Once a `MediaRef` is disclosed into JS, handler
code may use that visible value normally; the fence applies to the masked
execution path, not to ordinary computation over disclosed values. Asset-policy
changes may blank or restore the separate media delivery controller, but they
do not change or redeliver the query row solely to alter `kind`.

An impossible storage invariant—missing asset record, non-ready media edge,
missing admitted kind, kind outside the field's closed set, or content/profile
disagreement—returns one value-free
`SNAPBACK_MEDIA_PROJECTION_INTEGRITY` server diagnostic. It is independent of
caller and asset-read policy. Every public write path prevents those states;
activation/migration validates pre-existing rows before enabling the
capability.

### D3. `v.media()` attachment is finalized-only in v1

A `v.media()` field accepts an asset id only when the commit transaction proves:

1. the asset is `ready`;
2. the current primary rendition exists and is ready;
3. finalization recorded a trusted detected content type;
4. `detected-content-type.v1` maps that type to an admitted field kind; and
5. the ordinary LLP 0044 app, intent, owner, lifecycle, field, and attachment
   admission checks pass.

The kind mapping is closed:

```text
image/* -> image
video/* -> video
audio/* -> audio
everything else -> file
```

Trusted finalization persists nullable `mediaKind` on the system asset record
in the same transaction that installs the primary rendition and moves the
asset to `ready`. It is null while pending and non-null for every ready v1
asset. Existing ready assets are backfilled from their admitted primary
rendition/blob under a proof-bearing migration; capability activation refuses
until every candidate record agrees with the mapping.

Pending assets remain representable and retryable in the asset pipeline, and a
plain `v.assetRef()` may continue to use LLP 0044's existing pending-attachment
profile. They cannot enter a `v.media()` field. The media command already waits
for required uploads to finalize under LLP 0239#d3-one-mediacommand-owns-multi-upload-plus-atomic-commit;
direct writes receive `SNAPBACK_MEDIA_ASSET_NOT_FINALIZED` with guidance to
await finalization.

A pending asset may reuse its asset id across successor attempts and may
ultimately detect a different kind than an earlier failed attempt declared.
That does not rotate an observable `MediaRef` because no `v.media()` edge or
projection exists before readiness. After readiness, v1 does not replace
primary content in place: changing content kind requires a new asset id and an
ordinary media-field update. Thus one asset id never projects two kinds across
time, replay, retention, restore, or retry.

### D4. Result, artifact, retention, and RQS identity rotate explicitly

`mediaRef.v1`, its source-field identity, allowed kind set, and
`detected-content-type.v1` profile are semantic members of the exact result
contract. Adding a media ref where the predecessor returned an asset-id string,
changing optionality, changing the admitted kind set, or changing the
classification profile rotates `resultContractHash` under the existing
`snapback:function-result:v1` hash. It also rotates every function/plan
semantic identity that carries that contract.

For a mutation settlement, that originating `resultContractHash`, the
`mediaProjectionProfileHash`, the request-derived LLP 0043 `settlementId`, the
store scope, and the row's never-reused settlement sequence are copied into
D1's durable seal before commit. Recovery verifies those stored values against
the independent request, row, and store facts and never derives the contract or
projection identity from the currently active bundle.

A runtime asset's concrete `image` versus `video` value does **not** rotate the
contract hash; it is result data. An asset id cannot change kind under D3, so it
also creates no hidden per-id projection generation. A class-M policy-program
edit rotates the policy/activation identity under LLP 0235 even when the public
result type is unchanged.

For LLP 0243 protected retention, the result-contract change and media
retention/exclusion descriptor produce a successor `descriptorContractHash`.
Predecessor bytes never slide under it; they follow the ordinary
quarantine/delete and fresh-snapshot path. The descriptor records whether each
media field is retained as the two-member reference or excluded before write.

A plan containing `MediaKindProjectV1` is not eligible for the current RQS
single-table class. Its complete read summary includes the asset system record
in addition to the application table, so it fails the exact
`rqs_eligible_digest_kind` predicate rather than pretending the system read did
not happen. Consequences are closed:

- the server mints no current RQS resume token for that LiveQuery;
- Channel-B authority-independent RQS persistence does not store its rows;
- a predecessor RQS entry is not adopted under the media-bearing successor;
  and
- protected retention may still be independently admitted through LLP 0243's
  descriptor/lease path.

A future RQS class may admit an immutable media-kind projection only with a
new versioned read-summary grammar, plan/digest identity, dependency proof, and
client capability. This Spec does not silently widen the shipped class.

### D5. Forged kinds never become write or result authority

The v1 public write input for a `v.media()` field is an asset-id string (or
`null`/omission where the field contract permits it), not `MediaRef`. An object
containing `assetId`, `kind`, or lookalike fields refuses with
`SNAPBACK_MEDIA_WRITE_FORGED_KIND`; callers that hold a read-side `MediaRef`
write `media.assetId`. The commit boundary then runs D3's ordinary server
admission.

A JavaScript result may naturally contain a `MediaRef` previously received
from `ctx.db`. Its `kind` is not trusted: D1 replaces it from the host-private
same-snapshot provenance sidecar. A mismatched claimed kind neither changes the
output nor grants authority; an unprovenanced occurrence refuses. Declarative
plans and HostPlan mutations never accept a client kind member at all.

Import, seed, migration, admin edit, and generated mutation paths use the same
finalized-only commit check. Restore/import carries the system asset record and
typed reference edge in one consistent cut; it cannot reconstruct kind from an
app-row object.

### D6. Projection is a capability-gated storage feature

`assets.media-ref-projection.v1` is available only when the target proves all
of the following together:

- ready-transition persistence and validation of immutable `mediaKind`;
- Query/LiveQuery typed projection inside a pinned transaction;
- JS read/result provenance custody;
- preview/commit/retry/replay token lifecycle and warm-realm expiry;
- mutation commit-time projection before settlement serialization;
- OCC-before-egress plus post-write class-M re-establishment for HostPlan and
  Ibex;
- exact recovery with zero re-projection;
- the canonical identity-bound settlement seal, store format epoch, legacy
  watermark, and predecessor-row downgrade fence;
- class-M-aware `via-references` authorization and pre-lookup writeback
  ordering;
- class-M logical and physical-plan treatment;
- result-contract/codegen/hash parity; and
- protected-retention composition or an honest target-specific GAP.

Partial support does not make `v.media()` generate. A target missing any
required leg reports the exact missing fact and keeps the field unavailable;
codegen never emits client types for a server producer the selected target
cannot execute.

## Alternatives considered

### Look up kind after `validate_handler_result`

Rejected. The validator is intentionally pure, a mutation may already have
released its write snapshot, and exact settlement recovery may run after the
old function is gone. A second lookup produces temporal skew and cannot repair
retained bytes.

### Enrich on the client through the asset-record endpoint

Rejected by LLP 0239 D1. It creates an undeclared request, makes generic types
network-dependent, loses exact retained parity, and lets asset-record policy
change the result shape.

### Gate kind on asset read policy

Rejected in all three common shapes. Whole-result refusal is a policy oracle
and erases readable app data; null substitution conflates asset denial with
class-M/optional emptiness and breaks required fields; a new denied-reference
union changes LLP 0239's binding `MediaRef` and its D5 state algebra.

### Store `{ assetId, kind }` in the application row

Rejected. It duplicates server metadata, permits stale/forged kind values,
changes the compact physical reference contract, and splits reference/GC
authority between two fields.

### Project declared content type for pending assets

Rejected. The declaration is untrusted and optional, while finalization may
detect another type or refuse the bytes. A provisional kind would make one
asset id change projected identity after retry/finalization.

### Keep media queries RQS-eligible by omitting the asset table from the read summary

Rejected. The current class requires a complete one-table summary. Hiding a
real projection input would make token/digest eligibility depend on an
incomplete witness and violate the exact-class contract.

### Re-project old settlements and retained results on recovery

Rejected. Recovery owns immutable result bytes from the original cut. Current
asset metadata belongs to another snapshot and possibly another contract,
policy, or artifact generation.

## Compatibility and migration

- `v.assetRef()` and its pending-attachment policy do not change.
- `v.media()` is additive and unavailable until its target capability is
  qualified. No predecessor string-valued result silently changes shape.
- Existing ready assets receive a proof-bearing system-record backfill of
  `mediaKind`; pending assets retain null. A mismatch between detected primary
  type and the backfill aborts activation without rewriting app rows.
- Converting an existing asset-ref field to `v.media()` is a schema/result
  migration. It validates every non-null edge as ready and kind-admitted,
  rotates result/plan/retention identities, and requires a fresh snapshot.
- Existing settlements remain byte-for-byte recoverable under their original
  identity. Before capability activation, the exclusive format-epoch migration
  stamps the pre-seal row set as `legacy-settlement.v1`, assigns its bounded
  store-local sequences, and records the immutable legacy watermark; it does
  not inspect or rewrite result bytes. Those rows remain on the explicit legacy
  recovery branch and are not upgraded to `MediaRef` by bundle activation.
- Backup/restore preserves the logical settlement store scope, format epoch,
  legacy watermark, and next sequence together with settlement rows. A new
  logical store receives a new scope id rather than adopting seals from another
  store.
- Existing retained descriptors are deletion-only predecessors unless their
  exact result contract already contained the same `mediaRef.v1` node, which no
  pre-capability artifact can claim.

## Acceptance

1. **Contract and hash goldens.** Rust and codegen agree byte-for-byte on
   `mediaRef.v1`, `MediaRef<K>`, optionality, allowed kinds, the classification
   profile, and `resultContractHash`. Every semantic edit named in D4 rotates;
   changing only a runtime value does not.
2. **One-snapshot declarative projection.** Query and LiveQuery race fixtures
   pause between application-row selection and media projection while another
   writer attempts a relevant change. The result is wholly before or wholly
   after one storage cut, never row/kind skew, and the LLP 0242 completeness
   witness names that cut.
3. **JS provenance.** A pinned handler read returns a host-tagged `MediaRef`;
   aliasing or selecting that exact value succeeds, while cross-field reuse,
   object spread, structural copy, JSON round-trip, a forged `kind`, and a
   guessed or argument-only asset id exercise the exact source-token rules.
   The original tagged value has its forged `kind` replaced; every lost or
   mismatched token refuses as unprovenanced. Class-M-masked cells reach JS as
   null and create no provenance entry. Preview borrows one staged proof and
   the authoritative commit consumes it once; preview cannot consume or clone
   it. OCC rejection followed by fresh execution mints a new invocation nonce,
   a same-id loser expires its proof and returns the winner's sealed bytes, and
   a tagged object retained by a warm realm cannot validate in the next
   invocation. Cancellation, refusal, dropped staged work, and nonce exhaustion
   exercise their value-free expiry/refusal paths, and no token appears in any
   JSON, ledger, receipt, output, or settlement carrier.
4. **Atomic mutation settlement.** HostPlan and Ibex mutations project inside
   the commit transaction. An external writer changing the exact source cell,
   a related class-M condition input, or its disclosed/masked outcome after
   Ibex observation loses captured-read validation with
   `SNAPBACK_MUTATION_CONFLICT` / `retryPolicy: "reject"` before overlay or
   egress; no handler effect or settlement commits. Separate fixtures make this
   mutation's own admitted overlay mask the source (result `null`), delete or
   replace the source (unprovenanced atomic refusal), and leave it disclosed
   (same-overlay `MediaRef`). HostPlan client/declarative baselines retain their
   ordinary validation semantics. Crash cuts before and after settlement
   insertion prove there is no committed app write with missing/unprojected
   result bytes. Dry-run reports the same projected shape, borrows rather than
   consumes provenance, and retains nothing.
5. **Exact recovery.** After a successful mutation response is lost, change or
   remove the function and alter unrelated asset policy. Replay of the exact
   identity returns byte-identical `{ assetId, kind }` without handler dispatch
   or asset metadata reads. Mutate `output_json` to different but valid JSON
   while preserving every stored version field, including changing only
   `kind`; canonical-byte or seal verification refuses it before publication.
   The migration fixture stamps genuine predecessors and its watermark without
   reading result shape; stamped legacy rows alone follow predecessor checks.
   Erasing every seal field from a media row, clearing/changing its row format
   or sequence, placing `legacy-settlement.v1` above the watermark, and using a
   partial or unknown format all fail closed. Swap a complete `(output_json,
   seal)` between two same-contract client-mutation rows and between two store
   scopes: settlement-id, row-sequence, or store-scope comparison refuses each
   substitution before publication. No failure is repaired from current state.
6. **Unauthorized parity.** Two principals who can read the same app row but
   differ only in asset read authority receive byte-identical `MediaRef` fields
   and query shape. The authorized media controller reaches `ready`; the other
   reaches D5 `denied`. Neither query response nor denial diagnostic enumerates
   variants or richer metadata. Two states differing only by a class-M-masked
   media edge also produce identical asset-record and issuance denial for that
   principal; making that exact field disclosed makes the edge eligible and
   exercises captured invalidation.
7. **Class-M noninterference.** Hidden-value pairs produce identical membership,
   order, count, cursor, refusal, public details, live delivery kind, and timing
   class. Masked media is null before the media operator; the target's physical
   certificate inventories and fences the operator under LLP 0235. A patch
   naming the masked field returns the same writeback refusal before asset
   lookup for unknown, pending, ready, wrong-intent, wrong-kind, and admissible
   candidate ids.
8. **Finalized-only attachment.** Every write route refuses a pending media
   asset, including one with a declared content type. Finalization followed by
   the same write succeeds. Successor attempts may disagree before readiness;
   after readiness no operation changes an asset id's kind, and different-kind
   replacement uses a new id.
9. **Forgery and corruption.** Write-side `{ assetId, kind }` objects refuse on
   every route. Missing asset, non-ready edge, missing/out-of-set kind, and
   mismatched stored classification produce the one value-free integrity code
   independent of caller policy.
10. **RQS and retention classification.** A media-bearing LiveQuery mints no
    current RQS token and creates no Channel-B entry. An eligible LLP 0243
    protected view retains the exact two-member ref only when declared, excludes
    it before durable write otherwise, never stores a delivery URL, rotates its
    descriptor on contract change, and deletes/quarantines predecessor bytes
    before a fresh snapshot.
11. **Cross-target and restore parity.** Every target claiming the capability
    passes the same kind mapping, result bytes, transaction-cut, recovery, and
    denial fixtures. Backup/restore preserves asset records, kind, app edges,
    retained/settlement identity, settlement store scope, format epoch, legacy
    watermark, and next row sequence without recomputation from client data; a
    distinct logical store mints a different scope.
12. **Reference validation.** `./ref-check --verbose` reports zero errors after
    the Spec and issue pointer land.

## Open questions

None for the blocking v1 projection slice. Future demand may commission a
pending-media result state, a versioned RQS class for immutable system
projections, or direct action-result composition, but none is an implementation
choice left open by this Spec.

## Status

Accepted by the author on 2026-08-12. Implementation and publication of
`assets.media-ref-projection.v1` may proceed under this Spec; LLP 0239 remains
the binding accepted public contract.
