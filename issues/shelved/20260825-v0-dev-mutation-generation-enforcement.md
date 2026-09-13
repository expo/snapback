# Enforce asserted mutation generation in v0-dev

**Status:** Open
**Opened:** 2026-08-25
**Owner:** Server
**Systems:** Runtime, Invocation, Mutation transport, Testing
**Related:** LLP 0043, LLP 0058,
`issues/closed/20260816-public-dashboard-offline-acceptance-outbox-red.md`

## Problem

`crates/snapback-engine/src/local/engine.rs` function
`validate_expected_generation_against_manifests` returns `Ok(())` whenever
`active_mode != AuthMode::Sessions`. A replay carrier can therefore pin its
persisted `expectedGeneration` on the wire while a v0-dev server tolerates the
assertion and executes the mutation against a different manifest generation.

The JS client now re-inspects immediately before the replay POST and pauses
`SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH` when the served generation differs.
That narrows the deployment race but does not make inspection and mutation
dispatch atomic. Sessions servers already enforce the assertion against the
manifest pair selected for invocation; v0-dev does not.

The round-32 dual review found the same residual window on queue-capable
**foreground string-named mutations**. The call has no generated-reference
generation, but its successful capability inspection does establish a complete
operation target. Before the client fix, the foreground POST omitted
`expectedGeneration`; a same-origin, same-app deployment switch after the final
capability answer could therefore execute generation-one intent under
generation two even on a Sessions target, because there was no wire assertion
for the server to reject. The JS client now derives the assertion from the
inspected operation target and locally refuses a changed durable target fact,
but only mutation-time server validation can close the remaining
answer-to-POST window atomically.

## Required behavior

- `validate_expected_generation_against_manifests` must validate a supplied
  `expectedGeneration` against the exact active schema/function manifest pair
  used for the mutation in v0-dev as well as Sessions mode.
- A mismatch or an asserted generation that cannot be derived from that pair
  must refuse before application effects and durable replay settlement.
- Absence of `expectedGeneration` may retain the documented compatibility
  behavior; presence must never be silently ignored by an auth-mode branch.
- Tests must exercise the real v0-dev invocation path across a generation
  change after inspection and prove zero application effects and zero replay
  settlement for the stale carrier.
- The same real invocation-path coverage must include a queue-capable
  foreground string-named mutation whose final capability answer names G1,
  whose POST carries G1 in `expectedGeneration`, and whose selected active
  manifests are G2. It must prove zero G2 application effects and no durable
  settlement for the stale identity.
- Sessions behavior must remain unchanged and covered.

## Bound on current evidence

The public-dashboard offline-local-first 9/9 acceptance does not cover the
inspection-to-POST deployment race. Client tests prove both the persisted
replay wire pin/immediate pre-POST reinspection and the foreground string-name
wire assertion against a Sessions-shaped rejection fixture; they do not prove
v0-dev server-side mutation-generation enforcement.
