# P1 — server-side CompletenessProofV1 issuance

**Status:** Closed (program: `20260803-local-first-continuation-program.md`;
Rust — see the program's step-0 constraint)

Implement LLP 0157 §D3's server half: the
`trusted-composition-activation` artifact + `ProofKeyManifestV1` emitted
through the trusted generated/deployment-output path at activation
preparation; Ed25519 signing of `CompletenessProofV1` at establishment
(page + page-set), binding materialization key, instance,
activation/plan hashes, version, the authorization-witness digest, page
identity, batch identity, and result digest exactly per §D3's closed
records; signing/verification-key custody per §D3's lease-lifetime rule;
golden + near-miss vectors frozen (the client verifier already exists —
L2's fixtures are the compatibility target). Oracle: 0157 A5's proof
half end-to-end against the real server; the client's existing fixture
suite passes unchanged against real proofs.

## Wire-governance flag — 2026-08-04 (amendment landed)

The live establishment carrier is the optional
`LiveSubscribeOutput.completenessProof` member. LLP 0094 §0C.2 classifies
that server→client family as open and licenses additive optional fields, so
this carrier neither changes a frame kind nor changes the closed LLP 0157
semantic preimage.

Finite retained-query establishment is not covered by that license.
`AuthorizedLeaseQueryResponse` is a closed exact-protocol family (LLP 0094
§0C.2) even though its request already carries the exact `clientStoreId`,
`queryKey`, and `queryInstanceId` needed by `CompletenessProofV1`. LLP 0094's
2026-08-04 dated amendment now owns the following normative text, and LLP 0093
v0.13 cross-references it. This closes only the wire-governance flag; this
ticket's server-issuance and decoder-compatibility implementation scope stays
open:

> **Dated amendment — completeness-proof response carrier.** A successful
> `AuthorizedLeaseQueryResponse` may carry one optional
> `completenessProof: CompletenessProofV1`, issued only for an LLP 0157-admitted
> plan and bound to the request's exact materialization namespace. Its signed
> bytes and semantics are exclusively LLP 0157 §D3; the lease envelope may
> convey but must not rewrite them. Because this response family was closed,
> deployment must first prove every supported decoder accepts the member or
> bind the addition to a successor offered wire version. Absence, an unknown
> or retired proof key, or verification failure is availability-only: the
> consumer classifies completeness as unknown and performs a fresh sync.

Ordinary finite `QueryOutput` has no materialization namespace in its request,
so extending it would additionally require a separately gated request-context
carrier; this lane does not invent one. Snapshot-batch continuation pages and
server delivery of a composed `PageSetIdentityRecordV1` therefore remain on
the finite-carrier side of this amendment boundary.

## Resolution — 2026-08-04

LLP 0093 and LLP 0094 now carry dated normative amendments for both finite
families. Ordinary finite queries can opt into the exact materialization
namespace in their request and receive optional `completenessProof` plus its
`authorizationWitness`; `AuthorizedLeaseQueryResponse` can convey the same
pair without rewriting the LLP 0157 preimage. Snapshot-batch continuation
requests can additionally present the already-verified ordered prior proofs,
and the terminal response atomically carries the current proof, witness, and
composed `pageSetManifest`. The amendments explicitly preserve compatibility:
the newly admitted members are optional, old decoders ignore unknown optional
members, and new decoders tolerate their absence.

The server now uses one issuance path for live establishment and finite
answers. It verifies every supplied prior proof, mints before response
publication, composes LLP 0157's page-set identity only for a terminal
snapshot-batch page, and refuses the complete carrier with the existing
`SNAPBACK_COMPLETENESS_PROOF_ISSUANCE_FAILED` diagnostic on signing or prior
proof failure. The query and authorized-lease JSON schemas were regenerated
additively, together with the affected remote-service review manifest.

The shipped materialization verifier now exposes finite-carrier verification
through the same Ed25519/JCS proof path and rejection classes used by live
establishment. Its Rust-fixture compatibility test accepts the canonical
proof and rejects tampered bytes and the wrong materialization identity.

Closure evidence:

- Rust artifact-schema suite: 33 passed, 0 failed.
- Rust completeness unit suite: 4 passed, 0 failed.
- In-process snapshot-batch proof/composition/refusal test: 1 passed, 0 failed.
- Client materialization-store suite: 18 passed, 0 failed.
- Client strict TypeScript fixture check: passed.
- Generated-artifact reproducibility gate: passed with the intentional review
  manifest held in an isolated temporary index; no additional drift.
- Package test inventory: 195 reviewed files.
- `ref-check --verbose`: 168 LLP documents, 3,630 references in 8,790 files,
  0 errors and 0 unchecked references.
