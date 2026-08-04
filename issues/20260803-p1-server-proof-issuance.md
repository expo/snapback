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
