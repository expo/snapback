# LLP 0244: MediaRef projection

**Type:** Spec
**Status:** Draft
**Systems:** Assets, Schema, Storage, Query planning, Live Queries, Runtime,
Mutation settlement, Authorization, Field masking, Offline retention, Code
generation, Diagnostics, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-12
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

1. `src/manifest.rs:2781-2800` (`result_contract_hash`) hashes canonical JSON
   for the complete result contract under `snapback:function-result:v1`.
   `src/manifest.rs:3837-3890` (`rqs_eligible_digest_kind`) admits only a public,
   authority-independent, single-table HostPlan LiveQuery whose complete read
   summary names exactly that one plan table.
2. `src/runtime.rs:594-670` (`run_ibex_query_with_reads_prepared`) executes JS
   query reads through one `DbRead` and reports the version from that same view.
   `src/local.rs:30194-30229` (`execute_query_invocation`) pins the live
   connection before any plan/handler work, then
   `src/local.rs:31337-31348` validates and publishes the returned rows while
   still inside that invocation.
3. `src/result_contract.rs:76-105` (`validate_handler_result`) serializes,
   bounds, and recursively shape-validates a supplied `serde_json::Value`. It
   accepts no database/snapshot argument and performs no projection.
4. `src/local.rs:11483-11545` and `src/local.rs:12226-12263` recover an exact
   client-mutation settlement before handler dispatch; the latter path also
   returns before active-function selection. `src/storage.rs:15215-15326`
   (`record_client_mutation_result`) serializes and inserts `output_json` in the
   committing transaction, while `src/storage/settlement.rs:411-620`
   (`client_mutation_result`) later decodes those bytes from a new pinned read.
5. `src/storage/asset_reads.rs:258-340` shows that an asset record is loaded
   before the separate `asset_read_authorized` decision and that the reserved
   live projection returns no row on denial. `src/storage/asset_reads.rs:650-725`
   applies the same policy before variant enumeration and requires `ready`
   before signed issuance.
6. `src/storage/asset_attempts.rs:323-430` creates an asset as `pending` and
   stores `declared_content_type` as optional request data. Trusted finalization
   records the detected primary `contentType` and transitions the asset to
   `ready` in one transaction at `src/storage/asset_attempts.rs:900-962`.
   The general attachment checker currently accepts both pending and ready
   assets at `src/assets.rs:2320-2398` (`verify_attachment`), which is why
   `v.media()` needs an explicit stricter field profile rather than an
   assumption about existing behavior.

## Decision

### D1. One authoritative media-result materialization cut

Codegen emits a closed `mediaRef.v1` result-contract node for every projected
`v.media()` occurrence. The semantic node contains:

- the source table and media-field identity;
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
cells. At result handoff, `MediaProjectionPlanV1` requires each `mediaRef.v1`
result occurrence to match a cell observed through that invocation's pinned
view. Copying, aliasing, or selecting an already-observed ref is allowed;
supplying an asset id that the handler never received through a declared media
source refuses with `SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED`. This prevents a
public handler from becoming an existing-id/kind oracle merely by accepting an
opaque id argument.

The handoff normalizer replaces any handler-supplied `kind` with the sidecar's
admitted kind before calling `validate_handler_result`. The shape validator
remains pure and is never taught to open storage.

V1 refuses `mediaRef.v1` in an Action's direct result contract with
`SNAPBACK_MEDIA_PROJECTION_SNAPSHOT_UNAVAILABLE`. Actions do not own one pinned
read view across their lifetime; an action returns an ordinary scalar/result or
invokes a Query/Mutation whose independently projected result the client reads
through that operation.

#### Mutation results

A mutation's raw handler/HostPlan result and `MediaProjectionPlanV1` enter the
storage mutation kernel together. After write validation and attachment
admission, but before exact result validation, settlement serialization, or
commit, the committing transaction resolves every media result occurrence
against the post-write application/asset state. A media id produced by a write
is provenance-admitted only when that same transaction verified and installed
its typed reference edge; a previously read media id must match the captured
read/write provenance and is rechecked in the commit snapshot.

The transaction then validates the projected result and, for an idempotent
mutation, writes those exact projected bytes to the settlement row. Failure to
project or validate aborts application writes, reference edges, grants,
settlement, and result publication together. Dry-run executes the same
materializer inside its rolled-back transaction and reports the projected
shape.

#### Replayed and settled result recovery

Recovery returns the exact projected settlement bytes. It performs no asset
lookup, does not require the old function/result contract to remain installed,
and never substitutes a successor projection profile. This preserves LLP
0043#settlement-consumption-and-acknowledgement-lifecycle-2026-08-01 and the
current recovery-first storage contract.

Corrupt settlement bytes still fail the existing storage-integrity checks.
They are not repaired by re-projecting against current metadata because doing
so would invent a new snapshot and result identity.

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

Class-M field denial is distinct. Class M replaces the entire application field
with `null` at its normal projection/handler-read seam before
`MediaKindProjectV1` may consume it. The media operator cannot feed filters,
ordering, grouping, counts, joins, index choice, cursor shape, diagnostics, or
timing-visible delivery. A masked field causes no asset join and exposes no
success/failure difference. Asset-policy changes may blank or restore the
separate media delivery controller, but they do not change or redeliver the
query row solely to alter `kind`.

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
- mutation commit-time projection before settlement serialization;
- exact recovery with zero re-projection;
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
  identity. They are not upgraded to `MediaRef` by bundle activation.
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
3. **JS provenance.** A pinned handler read returns `MediaRef`; aliasing and
   copying that value succeed; a forged `kind` is replaced; a guessed or
   argument-only asset id refuses as unprovenanced; class-M-masked cells reach
   JS as null and create no provenance entry.
4. **Atomic mutation settlement.** HostPlan and Ibex mutations project inside
   the commit transaction. Crash cuts before and after settlement insertion
   prove there is no committed app write with missing/unprojected result bytes.
   Dry-run reports the same projected shape and retains nothing.
5. **Exact recovery.** After a successful mutation response is lost, change or
   remove the function and alter unrelated asset policy. Replay of the exact
   identity returns byte-identical `{ assetId, kind }` without handler dispatch
   or asset metadata reads. Corrupt bytes fail; they are never repaired from
   current state.
6. **Unauthorized parity.** Two principals who can read the same app row but
   differ only in asset read authority receive byte-identical `MediaRef` fields
   and query shape. The authorized media controller reaches `ready`; the other
   reaches D5 `denied`. Neither query response nor denial diagnostic enumerates
   variants or richer metadata.
7. **Class-M noninterference.** Hidden-value pairs produce identical membership,
   order, count, cursor, refusal, public details, live delivery kind, and timing
   class. Masked media is null before the media operator; the target's physical
   certificate inventories and fences the operator under LLP 0235.
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
    and retained/settlement identity without recomputation from client data.
12. **Reference validation.** `./ref-check --verbose` reports zero errors after
    the Spec and issue pointer land.

## Open questions

None for the blocking v1 projection slice. Future demand may commission a
pending-media result state, a versioned RQS class for immutable system
projections, or direct action-result composition, but none is an implementation
choice left open by this Spec.

## Status

Draft. The author must accept this Spec before implementation or publication of
`assets.media-ref-projection.v1`; LLP 0239 remains the binding accepted public
contract.
