# Mutation-wire artifact identity (blind predecessor writes)

**Status:** Closed
**Impact:** 5
**Urgency:** 4
**Ease:** 2
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Mutation-wire artifact identity (blind predecessor writes)” shows the issue reaches a security, correctness, release, or core product boundary; delay compounds an active rollout, reliability, or verification risk, while the repair crosses several runtime, host, protocol, or policy seams, with specific cited code, progress, or acceptance criteria.
**Severity:** P3
**Systems:** Client protocol, Migrations, Storage
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-26
**Related:** Implemented LLP 0081 §6, LLP 0093

Carried out of `issues/closed/20260724-step5-impl-0081-journal-events.md`
when it resolved (2026-07-26): a blind (read-set-free) predecessor write is
undetectable at the migration floor — the successor-only gate validates
read-set baselines, and a mutation that carries none presents nothing to
refuse. Detecting it needs the client's artifact identity
(schemaHash/generation) on the mutation wire, which is LLP 0093-lane
protocol surface. Until then: baseline-bearing replays are floor-gated
(witnessed), incompatible attest is refused (`SNAPBACK_MIGRATION_UPGRADE_REQUIRED`),
and the JS Contract store's artifact privacy boundary prevents its own
cross-artifact replay client-side — the gap is a hand-rolled wire caller
that ships predecessor writes with no read set and no attest.

## Status note (2026-07-30 triage)

Verified still open and agent-executable (implementation may proceed under
LLP 0093's Review status as the P0–P4 cluster did; the change should land as
dated amendments to LLP 0093 and LLP 0081 §6). Interim mitigations confirmed
present (SNAPBACK_MIGRATION_UPGRADE_REQUIRED family; 5e244bf9
resync-before-replay settlement). The LLP 0094 wire-version negotiation
surface needed to introduce the field compatibly has landed (cea20de7).
Large — Rust wire + committed schemas + both first-party clients + fixture
corpus + two LLP amendments.

## Triage freshness note (2026-08-01 sweep)

Still valid; landing sites named for precision: the mutation input
schema (schemas/mutation.input.schema.json) carries read_set and
generatedIds but no artifact-identity/schemaHash field; schemaHash
appears only in src/migration.rs (migration state), not on the handler
wire. Interim mitigations verified real: SNAPBACK_MIGRATION_UPGRADE_
REQUIRED (src/local.rs, src/server.rs), 5e244bf9 resync-before-replay,
cea20de7 wire-version offer.

## Scoping note (2026-08-01, backlog lane P) — read, verified, not landed here

Re-verified open at 367e8c57 and sharpened the landing shape; deliberately
NOT implemented in this batch lane because it is a full protocol tranche
that needs its own lane with a complete proof cycle (Rust wire + committed
schema regen + both first-party clients + fixture corpus + LLP 0093/0081
amendments), and a partial landing would ship an incoherent wire contract.

Verified facts that bound the implementation:

- The absence is exactly as triaged: `schemas/mutation.input.schema.json`
  carries `read_set`/`generatedIds` but no artifact-identity field; the
  committed schema is drift-gated by `tests/artifact_schemas_v0.rs`
  (accept/reject vectors at lines ~517-569), so the schema change and its
  vectors land together.
- The client-side identity source needs a design decision the implementer
  must record: the JS client already RECEIVES the server's
  `deploymentIdentity` (schemaHash/bundleHash/inputsHash) through the
  auth/session handshake projection
  (packages/snapback-client/index.mjs `projectDeploymentIdentity`), but
  echoing a handshake-learned value back proves nothing about the
  artifact the CLIENT was generated against. The wire field must carry
  build-time artifact identity (Contract-store/generated-api provenance),
  which today is not embedded in client-consumed generated output — so the
  change reaches codegen emission surface as well.
- The field must ride behind the LLP 0094 wire-version negotiation
  (cea20de7): the floor gate can only REQUIRE it at/after a negotiated
  version; before that it is present-if-sent advisory evidence. The gate
  itself extends the successor-only floor in src/local.rs (the
  SNAPBACK_MIGRATION_UPGRADE_REQUIRED family) for read-set-free mutations.
- Interim mitigations re-verified still present at 367e8c57
  (SNAPBACK_MIGRATION_UPGRADE_REQUIRED refusal family, 5e244bf9
  resync-before-replay, artifact privacy boundary in the JS Contract
  store).

## Resolution (2026-08-10)

Implemented the coherent protocol slice in Lane J. Finite mutation requests
now carry an exact `wireVersion` offer; the JavaScript and Swift clients send
`snapback.v1`, and generated JavaScript references supply the existing exact
build-time `expectedGeneration`. At a successor-only migration floor, fresh
read-set-free writes require the active schema hash when v1 is offered, while
offerless legacy requests retain the documented compatibility envelope.
Unknown offers and predecessor identities fail before handler effects.

The Rust carrier, committed mutation schema, both clients, codegen provenance,
focused Rust/HTTP/schema tests, Swift tests, JavaScript client/codegen tests,
and dated LLP 0081/0093 amendments landed together in the uncommitted Lane J
worktree. `ref-check` and focused verification pass; the full Rust library
suite's remaining failures are the filed rehearsal fork-custody family plus
unrelated pre-existing diagnostic/capability drift recorded in
`LANE-J-NOTES.md`.
