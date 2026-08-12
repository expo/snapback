# Fresh review — LLP 0244 media-reference projection

## Provenance

- **Model:** GPT-5.6-sol
- **Provider/runtime:** OpenAI Codex
- **Date:** 2026-08-12
- **Reviewed content SHA-256:** `af19d1ae7b0b79ea286984ce3b284e82611f6bff8df4d795320fce088149801b`
- **Blindness statement:** I did not author LLP 0244, received no author commentary or private rationale, and did not communicate with its author during this review.
- **Method:** Read the bound Spec completely; read the charter-named governing documents and the actual cited code seams; checked every cited anchor with `./ref-check --verbose` (5,136 refs, zero errors).

## Overall assessment

The projection-level declassification is narrow and mostly coherent: `kind` is coarse, provenance-bound, independent of asset-read policy, available only after trusted finalization, and immutable for one asset id. The same-transaction query/mutation cut, verbatim settlement recovery, retention-after-projection, and current-RQS refusal are the right overall shapes.

The draft is not yet closed enough to implement safely. A masked reverse edge can still become an asset-authorization oracle under the accepted LLP 0044 `via-references` rule; mutation disclosure provenance is not re-established precisely at the commit snapshot; the JS provenance rule does not say whether source-field identity must match; and the claimed settlement corruption behavior is not provided by the cited storage implementation.

## Findings

### MATERIAL — A class-M-masked reverse edge can still confer `via-references` asset authority

Exact Spec text at issue:

> “Asset read authorization remains at record inspection, live asset state, issuance, and delivery.”

> “Class M replaces the entire application field with `null` at its normal projection/handler-read seam before `MediaKindProjectV1` may consume it.”

> “A masked field causes no asset join and exposes no success/failure difference.”

These statements fence the query projection, but they do not close the separate accepted LLP 0044 authorization path. LLP 0044 `via-references` currently treats a typed reverse edge on a row admitted by the table's asset-sharing-declared row policy as asset read authority. It does not account for per-field class-M disclosure. Therefore two states differing only in a masked media field can produce different asset-record/issuance authorization for a caller who presents the candidate asset id: the state containing the hidden edge can authorize while the other denies. That reveals equality/existence of the hidden field through a governed read boundary even though the media projection itself returns `null` in both states.

Opaque ids are not a proof: the same id may be known through another context, and LLP 0044 explicitly says possession is not metadata authority. This violates LLP 0235's complete-observable noninterference property.

Resolution requires one explicit rule at the asset authorizer, not only at `MediaKindProjectV1`: either a reverse edge from a class-M-masked field is ineligible to satisfy `via-references` for that principal, with the disclosure condition evaluated in the authorizer's pinned snapshot and included in dependency/invalidation custody, or such a field/read-policy composition is refused. The Spec must also require the class-M masked-field writeback refusal to occur before finalized-asset/intent lookups, so a forbidden patch cannot use attachment diagnostics as the same oracle.

### MATERIAL — Mutation result disclosure is not re-established unambiguously at the committing snapshot

Exact Spec text at issue:

> “A previously read media id must match the captured read/write provenance and is rechecked in the commit snapshot.”

> “After write validation and attachment admission, but before exact result validation, settlement serialization, or commit, the committing transaction resolves every media result occurrence against the post-write application/asset state.”

> “Class M replaces the entire application field with `null` at its normal projection/handler-read seam before `MediaKindProjectV1` may consume it.”

The draft does not say that the commit kernel must re-evaluate the source field's class-M disclosure, nor which class-M snapshot governs that evaluation. An Ibex handler can observe a disclosed `MediaRef` in its pinned handler view; before the storage transaction commits, a policy fact can change so that the source cell is masked. Rechecking only the asset id, typed edge, and kind would publish a value that is hidden at the claimed authoritative commit snapshot. Conversely, evaluating a condition from the post-write overlay can conflict with LLP 0235's pinned-persisted-snapshot rule unless this commit-egress case is deliberately defined as a separate atomic declassification seam.

Freeze one rule for HostPlan and Ibex results: the exact source cell, its class-M condition, and its media metadata must all be established at one named commit snapshot; specify whether that snapshot is pre-write persisted or post-write committed state; and specify `null` versus refusal when a previously observed cell is absent or masked there. The provenance sidecar alone is evidence of an earlier observation, not authority for the later result.

### MATERIAL — JS result provenance does not define source-field equivalence

Exact Spec text at issue:

> “The semantic node contains: - the source table and media-field identity;”

> “At result handoff, `MediaProjectionPlanV1` requires each `mediaRef.v1` result occurrence to match a cell observed through that invocation's pinned view.”

> “Copying, aliasing, or selecting an already-observed ref is allowed; supplying an asset id that the handler never received through a declared media source refuses with `SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED`.”

The result node binds a particular source table/field, but the handoff rule can honestly be implemented in two incompatible ways: key provenance only by `(assetId, kind)` and accept a value observed through any declared media source, or require the value to have been observed through the exact source table/field/generation bound to that result node. The former permits cross-source laundering between fields with different class-M conditions, admitted-kind sets, upload intents, or retention classes; the latter refuses it. Both satisfy the current words, and they have different public refusal and durable-retention semantics.

Define the sidecar key and the match relation exactly, including source table, source field/generation, row identity if required, and how aliases/copies preserve that provenance. If cross-source copying is intentionally allowed, remove the misleading source-field binding from the node or define and prove the compatibility relation that makes it safe.

### MATERIAL — “Corrupt settlement bytes fail” is not supported by the cited settlement carrier

Exact Spec text at issue:

> “Corrupt settlement bytes still fail the existing storage-integrity checks. They are not repaired by re-projecting against current metadata because doing so would invent a new snapshot and result identity.”

> “Corrupt bytes fail; they are never repaired from current state.”

The cited implementation serializes `MutationOutput` directly into plain `output_json` in `record_client_mutation_result`. Recovery checks JSON decoding, the broad `MutationOutput` shape, settlement/output versions, and sequence-allocation facts. It stores and verifies no digest over the exact projected result bytes and no historical `resultContractHash`/projection-profile binding. A syntactically valid edit such as changing a retained `kind` string can pass all existing checks while violating the promised byte-identical result.

The Spec must either narrow the claim to the corruption classes the existing checks actually detect, which would weaken the exact-byte acceptance, or add a persisted, domain-separated digest over the canonical settlement bytes plus the result/projection identity and verify it before recovery publication. It also needs an explicit predecessor-row policy for settlements created before that carrier exists. Acceptance should mutate valid JSON while preserving the stored version fields, not test only malformed JSON.

### MINOR — The no-observing-position sentence is overbroad for disclosed values in JS

Exact Spec text at issue:

> “The media operator cannot feed filters, ordering, grouping, counts, joins, index choice, cursor shape, diagnostics, or timing-visible delivery.”

> “The handler sees either `null` under optional/class-M treatment or a `MediaRef`; it never sees the raw physical media column through an application read API.”

Once a field is disclosed, an opaque JS handler can branch, filter, order, count, or diagnose using the declassified `MediaRef.kind`; LLP 0235 explicitly permits normal use of visible values. The surrounding paragraph appears to mean that a *masked* field and its skipped media operator cannot feed those positions. Qualify the sentence accordingly so an implementer does not infer an impossible whole-handler non-use proof or, conversely, overlook the masked-only physical fence.

## Author questions

1. Must `asset_read_authorized` ignore a `via-references` edge whenever that exact field is class-M-masked for the caller, or is the composition meant to be generation-refused?
2. At mutation result materialization, is class-M disclosure evaluated against pre-write persisted state or post-write committed state, and what happens when a handler-observed source cell is masked or absent at that cut?
3. Must a JS result occurrence match the exact source table/field identity in its `mediaRef.v1` node, or may any observed media source supply it?
4. What durable carrier binds settlement bytes to their original `resultContractHash`/projection profile and detects semantically valid JSON corruption after the old function is gone?

VERDICT: NOT READY
