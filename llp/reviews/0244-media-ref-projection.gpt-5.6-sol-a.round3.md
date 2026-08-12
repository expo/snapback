# Round-3 FINAL delta review — LLP 0244 MediaRef projection

## Provenance

- **Model:** GPT-5.6-sol
- **Provider/runtime:** OpenAI Codex
- **Date:** 2026-08-12
- **Reviewed content SHA-256:** `afd3e3758d36582880476780dd5da503f2b8627cada6c557e98e2b9d0d521994`
- **Review mode:** Fresh reviewer-A FINAL delta review against the round-2
  artifact and its bound predecessor SHA-256
  `d3fb99c4422dc1d82ec5b13c7374d63dcb44aeeedf25c62baa15c6da95d5866d`.
- **Blindness statement:** I did not author LLP 0244, either prior review, or
  either revision; I received no private author rationale and did not
  communicate with the author during this review.
- **Method:** Verified the target hash before review; read the Spec and both
  prior review artifacts completely; isolated the round-3 delta from the exact
  round-2 predecessor; checked the governing LLP sections and the cited
  runtime, OCC, settlement, asset-authorization, finalization, and attachment
  seams; traced preview, guarded commit, same-id race recovery, warm/fresh realm
  custody, legacy migration, and request-derived settlement identity; and ran
  `./ref-check --verbose` successfully (5,136 refs, zero errors, zero
  unchecked).

## Overall assessment

The revision genuinely closes all four round-2 IN-DELTA MATERIAL findings.
External movement is now rejected by ordinary captured-read OCC before the
transaction overlay or commit-egress projection can run. JS provenance has one
host-owned, single-attempt carrier from handoff through preview and commit, with
closed expiry on every terminal path. An exclusive format-epoch migration gives
legacy settlements an independent durable classification, and new media seals
bind the canonical output to the request-derived settlement identity, logical
store, and never-reused row sequence.

The added rules agree with the governing pinned-read, authorization,
exact-recovery, and asset contracts and with the cited implementation seams
they must extend. I found no new MATERIAL concern in the delta and no MATERIAL
PRE-EXISTING concern.

## Round-2 closure verdicts

### M1 — OCC-before-egress race disposition: CLOSED

D1 now puts ordinary stale-read admission before both overlay application and
commit-egress. Every exact media source cell, related row, and class-M
condition-input fact observed by Ibex enters the captured read set, while the
prepared policy program and activation identity enter the guarded commit
dependencies. External movement therefore returns the existing
`SNAPBACK_MUTATION_CONFLICT` with `retryPolicy: "reject"` and commits no app
write, edge, grant, settlement, or result.

The later commit-egress cut is explicitly limited to this already-admitted
transaction's own overlay. Its disclosed-to-masked, delete/replace, and
still-disclosed outcomes are separate from external races, and HostPlan keeps
its existing atomic/client-baseline isolation model. Acceptance 4 exercises the
external and transaction-local cases separately. This preserves LLP 0003 and
LLP 0235 OCC rather than rebasing handler effects from a stale observation.

### M2 — provenance preview/commit/retry lifecycle: CLOSED

`MediaProvenanceTokenV1` now has a process epoch, non-reused invocation and
entry nonces, and a sidecar scope bound to authority, function/artifact
generation, result contract, and pinned snapshot. Before a realm can be pooled,
handoff validates the semantic occurrences, moves the matched facts into one
typed process-local `StagedMediaProjectionProofV1` owned by the exact
`BufferedCommitPayload`, invalidates the registry and JS tags, and keeps the
carrier out of every JSON, ledger, request, receipt, output, log, and settlement
surface.

Preview can only borrow that proof. The authoritative commit takes sole
ownership and the proof expires after commit, conflict, refusal, cancellation,
drop, same-id loss, or any other end of that attempt. Fresh execution mints a
fresh proof; exact replay and same-id winner recovery dispatch no handler and
use only verified settlement bytes. Acceptance 3 covers preview/commit,
conflict and fresh execution, same-id loss, cancellation/drop, nonce
exhaustion, and stale warm-realm objects. The lifecycle no longer permits a
main-honest implementation to consume at preview, serialize across retry, or
reuse a VM-global token.

### M3 — legacy seal-downgrade fence: CLOSED

Legacy status is no longer inferred from nullable seal fields or result shape.
Before activation, one exclusive migration stamps the complete predecessor set
as `legacy-settlement.v1`, assigns independent positive row sequences at or
below an immutable watermark, creates the protected store epoch, and excludes
unaware writers. New rows are necessarily above the watermark and explicitly
identify plain versus media-projected format.

Recovery admits the legacy branch only for a stamped legacy row on the legacy
side of the watermark. Missing or unknown format, missing sequence, wrong-side
format, seal fields on a legacy/plain row, or an incomplete media seal all fail
with the one integrity diagnostic. Erasing every media-seal field therefore
leaves an independently identified media row that fails closed rather than an
all-null row that can masquerade as a predecessor. The revision also states the
honest boundary: these are unkeyed integrity witnesses under trusted storage,
not authentication against an actor able to rewrite protected metadata and row
data and recompute witnesses.

### M4 — settlement-identity binding: CLOSED

The v3 digest preimage now binds
`media-projected-settlement.v1`, `settlementStoreScopeId`, the independent
`settlementRecordSequence`, LLP 0043's request-derived `settlementId`, the
originating result-contract and media-projection hashes, and the complete
canonical `MutationOutput`. Recovery compares the seal against the independent
row/store facts and request-derived identity before publication.

The cited `ClientMutationIdentity::activity_digest` already covers client id,
function, input fingerprint, auth fingerprint, authority instance, and any
operation issuance. A complete output/seal transplant between two rows, or
between logical stores, therefore fails even when their result contracts and
output versions agree. Acceptance 5 includes both substitutions in addition to
the valid-JSON `kind` edit. This closes the cross-row misassociation left by the
round-2 seal.

## New findings

None. I found no new MATERIAL or MINOR concern in the revision delta.

## Author questions

None.

VERDICT: READY
