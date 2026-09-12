## Verdict

**CHANGES REQUIRED.** The three v6 findings are repaired, but one P1 successor-preservation blocker remains in the v7 storage boundary. I ran no tests or builds; implementation-team results were not treated as reviewer evidence.

## Confirmed blocker

**P1 — A mismatched guarded fallback still broadcasts a false authority change and seals a successor client.**

At [storage.ts:113](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v7/source/snapback3/packages/snapback3/src/resource/storage.ts:113), `createMemoryStorage()` decides whether to notify listeners by matching only the session. It ignores the new nested acquisition identity:

```ts
owned.clearSession !== undefined && matchesSession(state.session, owned.clearSession)
```

The actual merge at [storage.ts:45](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v7/source/snapback3/packages/snapback3/src/resource/storage.ts:45) correctly refuses the clear when the checkpoint differs. Nevertheless, line 116 broadcasts an `authority` event. IndexedDB does not have this defect: it derives `authorityChanged` from the complete `conditionalClear`.

Concrete executable sequence:

1. Create one `createMemoryStorage()` instance.
2. Give clients A and B distinct wrapper adapter objects that delegate `load`, `write`, and `subscribe` to that memory store; A’s wrapper delays and rejects its first `cancelAcquisition` write.
3. A completes declaration v1, then cancels it and blocks in the failing write.
4. B completes successor declaration v2 with the same account/token and acquisition ID.
5. Release A’s failure. Its guarded `clearSession` fallback contains v1’s identity.
6. Durable merge correctly preserves v2 because its declaration hash differs.
7. The memory adapter nonetheless emits `authority`.
8. B handles that event by calling `clearAuthority()`, sealing and removing its v2 handle and withdrawing its live resources even though storage still contains ready v2.

Thus old failed work still withdraws successor live state. The successor test at [acquisition-client.test.ts:300](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v7/source/snapback3/tests/acquisition-client.test.ts:300) omits `subscribe` from `successorStorage` and checks only durable state, so it cannot expose this counterexample.

## Verified repairs

By inspection:

- Declaration replacement now withdraws held and newly requested acquired-origin values before asynchronous persistence.
- Ready cancellation removes the RAM pool and held snapshots; matching cancellation persists conditionally.
- Explicit resume waits for cancellation completion and can revalidate the cancelled checkpoint.
- Main cancellation matches the transaction-current token plus ID, declaration hash, principal, auth epoch, generation, and schema hash.
- The guarded fallback preserves different declarations, accounts, and newer same-principal tokens durably.
- Same-adapter initialization remains queued behind the complete primary-write/fallback job.
- Every final `acquiredFacts.delete(id)` branch is paired with acquired-origin withdrawal; whole-pool clear paths either withdraw explicitly or clear all resources through their caller.
- The new held-resource, ready-cancel/resume, immediate-reopen, conditional cancellation, token/account, and IndexedDB transaction tests contain substantive assertions. Only the live notification consequence above is missing.

The unchanged representation, protocol, worker-cap, gzip, whole-corpus mapping, and old-version-GC limits were not treated as blockers.

## Exact binding

Candidate `v7`, frozen `2026-09-12T20:58:13.917643+00:00`, base review `final-v6`.

```text
ae0086654affa8c832abc65e9c45449e4d943b1e4e4a8dd7a2d5b2e81e9c283e  inputs.json
8bbfa8f90cfb1fcb6a1486c56e4a68399aab961ccd3aa09e18458c66f8957129  delta.diff
314d95a3d210eeda6e6055977fb0cc9c91d96a139f2c0cf6845c6772d82e44fb  snapback3/packages/snapback3/src/client.ts
b53c8fabb5521a5ceb072d3f6c38b1bdd7dfedaab0f7c727f2a0764f23b6de20  snapback3/packages/snapback3/src/resource/storage.ts
d934bf6db72b46cfd8a4bd276bbed6229bd8074ef20334e22a5c86d61214e5a1  snapback3/packages/snapback3/src/resource/types.ts
454e5a7c3b4a09e8dba8e4848aef54d75a5d8007fe220661ae46ea52993c0893  snapback3/tests/acquisition-client.test.ts
6a3160cd78091849994009a390605c1040dbe4203c6620e41ec8550478996e3c  snapback3/scripts/test-acquisition-storage.mjs
f16c0a741299a0d6f37003967a7a33f1f691a61f2b550db89260d5e56c968a51  llp/2000-snapback3.rfc.md
```

All 17 source files matched the hashes and byte counts declared by `inputs.json`.