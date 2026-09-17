# Snapback 4: Client ID minting advances wall time per ID and falls back to weak entropy

Status: Open
Priority: P2
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (0.2.26)
Review: complete code review requested by Charlie Cheever; lead validation with independent Grok, Muse and Sol reviews.

## Evidence

Code traced, raised by Muse. `mintId(now)` replaces now with max(now,lastMinted+1), so 100000 calls at one real millisecond encode a time roughly 100 seconds in the future. If crypto.getRandomValues is missing it silently uses Math.random.

## Implementation locations

Paths are relative to `snapback4/`: `packages/snapback4/src/client.ts:mintId`. `minted_at` is used as author-visible time. Expo/browser fallback capabilities must be qualified before dropping the existing path.

## Acceptance

Keep monotonic IDs by incrementing the entropy field within one logical millisecond rather than the time field for every mint; preserve rollback uniqueness. Establish secure entropy on every supported client, or fail clearly when unavailable. Test burst minting, backward clock, entropy exhaustion and unavailable crypto without relying on random collisions.

## Partial repair — 2026-09-16

The clock/ordering half is implemented in repair candidate `f6b514c35`: entropy
increments at one logical millisecond, rollback stays monotonic, timestamp
range and exhaustion are checked, and an RNG exception cannot poison state.
Burst, rollback, exhaustion and RNG-failure regressions accompany it.

This ticket stays open for the secure-entropy half. Hosts lacking Web Crypto
still use the documented non-cryptographic fallback. Removing it without a
qualified synchronous source for every supported client can break native app
admission; an injected source or supported native bridge needs separate
implementation and platform qualification. IDs are not capabilities.

## Design proposal — 2026-09-17

The author-requested [Draft proposal for secure client ID sources](../llp/3000.001-durable-replica-and-write-lifecycle.research.md#secure-client-entropy)
records the recommendation, alternatives, implementation sequence, validation
and remaining decisions. This ticket remains open; writing the proposal does
not establish implementation or acceptance.
