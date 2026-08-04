# P1 — server-side CompletenessProofV1 issuance

**Status:** Open (program: `20260803-local-first-continuation-program.md`;
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

## Wire-governance flag — 2026-08-03 (not landed as an amendment)

The live establishment carrier is the optional
`LiveSubscribeOutput.completenessProof` member. LLP 0094 §0C.2 classifies
that server→client family as open and licenses additive optional fields, so
this carrier neither changes a frame kind nor changes the closed LLP 0157
semantic preimage.

Finite retained-query establishment is not covered by that license.
`AuthorizedLeaseQueryResponse` is a closed exact-protocol family (LLP 0094
§0C.2) even though its request already carries the exact `clientStoreId`,
`queryKey`, and `queryInstanceId` needed by `CompletenessProofV1`. Before a
finite carrier lands, LLP 0093/0094 need this dated amendment in substance:

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
