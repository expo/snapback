**Verdict: request changes.** Bound to `inputs.json` (`candidate: v7`, `frozenAt: 2026-09-12T20:58:13.917643+00:00`, `baseReview: final-v6`) and the FILE SHA256 headers below. I did not run tests, builds, or the IndexedDB harness; implementation-team results are not my evidence.

The v6 P2 is fixed in the client: declaration replacement and ready cancel both call `retireAcquisition`, which drops the pool and origin-tagged snapshots **before** the write, and cancel is a conditional `cancelAcquisition` patch rather than load-then-rewrite. IndexedDB fail-closed uses the nested checkpoint identity. The memory adapter’s authority notification was not updated to match, so a no-op nested `clearSession` can still sign out a successor client that subscribed to the inner store.

---

## Confirmed defect

### P2 — Memory adapter treats session-matched, checkpoint-mismatched `clearSession` as an authority change

**Files:** `snapback3/packages/snapback3/src/resource/storage.ts` `113–116` vs IndexedDB `209–212`

`merge` correctly refuses `clearSession` unless the nested acquisition still matches (`52–54`). IndexedDB only sets `authorityChanged` from that same `conditionalClear` (`209–212`). Memory still does:

```113:116:snapback3/packages/snapback3/src/resource/storage.ts
        const authorityChanged = owned.session !== undefined
          || owned.clearSession !== undefined && matchesSession(state.session, owned.clearSession);
        state = merge(state, owned);
        if (authorityChanged) for (const listener of listeners) listener({ source: owned.source, type: 'authority' });
```

A failed cancel’s fallback is `clearSession: { token, principal, authEpoch, acquisition: <old six fields> }` (`client.ts` `1395–1396`). If the durable checkpoint is already a successor, merge is a no-op, but memory still notifies. Any other client subscribed to that store runs `clearAuthority()` (`227–233`): session RAM is cleared, acquisition handles are sealed, snapshots go to loading. Disk still has the successor.

**Counterexample:**

1. `const memory = createMemoryStorage()`.
2. Client A uses a write wrapper that delays/`throw`s on `patch.cancelAcquisition`, then `memory.write`. Client B uses `memory` itself (so `subscribe` is live). This is the v7 successor test with B on the real memory adapter instead of `{ load: memory.load, write: memory.write }`.
3. A: `persona('alice')`, `await acquire(spec()).completed`.
4. `block = true`; `v1.cancel()`; wait until the cancel write is in flight.
5. B: `await ready`; `await acquire({ ...spec(), revision: 'v2' }).completed` so disk is alice + v2 ready.
6. Release A’s write. Cancel throws. Fallback `clearSession` has v1 identity. Merge keeps alice/v2. Memory fires `authority`. B seals the v2 handle and blanks acquired snapshots.

IndexedDB two-connection `BroadcastChannel` does not do this. The v7 successor test hides it by giving B a subscribe-less wrapper and only asserting disk `status: 'ready'`.

Fix: compute memory `authorityChanged` with the same nested `matchesAcquisition` predicate as `merge` / IDB `conditionalClear`. Assert B’s handle is still `ready` after a delayed failed cancel, using a subscriber on the inner memory store.

---

## What this delta did fix

I am not re-litigating v6 source. Inspection only.

| v6 hole / v7 claim | Result |
| --- | --- |
| Prefill + declaration change / ready cancel | `retireAcquisition` `548–550` deletes the pool and `withdrawAcquiredResources(id)` synchronously. `acquire()` `268–270` and `cancelAcquisition` `602–608` both go through it. `runAcquisition` `!compatible` also withdraws `664–665`. Denial still withdraws `861–865`. |
| Cancel load-then-rewrite | Gone. Conditional `cancelAcquisition` matches current session token plus id/declarationHash/principal/authEpoch/generation/schemaHash (`storage.ts` `37–41`, `83–85`, `241–246`). |
| Failed cancel/replace vs successor/account/token | Fallback `clearSession` carries the captured checkpoint (`client.ts` `1383–1396`). Merge/IDB require that checkpoint to still be the one at that id. Same-adapter `storageJob` still wraps write+fallback as one job, so immediate reopen cannot load in the gap. |
| Explicit resume after ready cancel | Handle waits `this.cancellation`; start requires `acquiring`. Test resumes to `{ status: 'ready', seq: 5 }` and refills the held watch. |
| Envelope / worker / gzip | Unchanged hashes: `acquisition.ts`, `protocol.ts`, `protocol.rs`, `http.ts`. |

Per-id pool-drop branches: `retireAcquisition`, `acquire` replacement/mismatch, `cancelAcquisition`, `runAcquisition` `!compatible`, denial, `suspendAcquisitions` (all), `clearAuthority`/`sealAcquisitions` (full resource reset). I did not find another missed held-snapshot path.

---

## Tests (assertion review only)

These do exercise the v6 counterexamples:

- Declaration change: watch **before** replace; held and a newly requested page are undefined; sibling `root-only` stays (`208–232`).
- Ready cancel: held + new page + offline `query` fail; `resume()` restores (`235–250`).
- Failed cancel/replace + immediate same-adapter reopen: `ready` stays false during the delay; after fallback, offline `query` is `S3_AUTH` (`253–297`).
- Stale cancel vs successor / other account / newer token: disk checkpoint stays `ready` (`300–369`).
- IDB harness: mismatched cancel is a no-op; exact cancel only flips that status; old token cannot cancel a newer-token checkpoint; old nested `clearSession` cannot erase a successor (`235–271`).

Gap: successor SDK tests use a subscribe-less wrapper, so they never see the memory notify bug above.

---

## Optional / not blockers

- Guide.md is unchanged; RFC still describes fail-closed as token/principal/epoch only. Implementation is stricter (nested checkpoint). Doc lag, not a false-ready.
- Denial `persistFailClosed` still has no nested acquisition identity. Not claimed in this delta.
- 5ms `setTimeout` fences in the reopen tests remain scheduling checks, not queue joins.

Known limits unchanged: whole-corpus `load`/maps, no old-version GC, synchronous finite gzip, separate-adapter notifications, all-write-failure cannot guarantee erasure.

---

## Hash binding

| Path | SHA256 |
| --- | --- |
| `snapback3/packages/snapback3/src/client.ts` | `314d95a3d210eeda6e6055977fb0cc9c91d96a139f2c0cf6845c6772d82e44fb` |
| `snapback3/packages/snapback3/src/resource/acquisition.ts` | `5de8e5cdf29bb8f603813839a85bf8b13df6876e2d887d9d30facffbeaf01e56` |
| `snapback3/packages/snapback3/src/resource/storage.ts` | `b53c8fabb5521a5ceb072d3f6c38b1bdd7dfedaab0f7c727f2a0764f23b6de20` |
| `snapback3/packages/snapback3/src/resource/types.ts` | `d934bf6db72b46cfd8a4bd276bbed6229bd8074ef20334e22a5c86d61214e5a1` |
| `snapback3/packages/snapback3/src/resource/facts.ts` | `443b83d2b025a7b6b5a718554aec98d67f69ea8bad1a1be9c085b946e50e55f2` |
| `snapback3/packages/snapback3/src/resource/protocol.ts` | `96c6708a8147c6ab59335412feaad868ab0d62ce3c3c5c2877684a7da997217f` |
| `snapback3/packages/snapback3/src/resource/signal.ts` | `459f2fe1bd8b2075e93fee4e19fa6fe5d1cfc94787da3c1707e0c7e902f04812` |
| `snapback3/packages/snapback3/src/resource/row-values.ts` | `c27cb8f44114f1e12414a945eb22e3e3c626033172f57644471c53e6ce18772e` |
| `snapback3/packages/snapback3/src/node/http.ts` | `16e29bd5cd5818278b376d171f3c71601c8ec7378239d1b219980fb2d6cfc195` |
| `snapback3/crates/snapback3-worker/src/protocol.rs` | `3a5f354bca9d84767667520e02719c263a0e3dd7b34155a4a852a0989dd84340` |
| `snapback3/tests/acquisition-client.test.ts` | `454e5a7c3b4a09e8dba8e4848aef54d75a5d8007fe220661ae46ea52993c0893` |
| `snapback3/tests/resource-client.test.ts` | `eea6ff4c60de22ad9d32bc86acf5cc8cdd6c7c0059ff430f993ad90bbe017a36` |
| `snapback3/tests/manifest-custody.test.ts` | `b5224137ccbf53c4f181502004f49973be9601c83a2155a9df95369346b0a6aa` |
| `snapback3/tests/acquisition-envelope-cache.test.ts` | `18cf5b2ad20f2cc4879fae5f030e4a399b7e84a9a0f097c67fe37a9915325096` |
| `snapback3/scripts/test-acquisition-storage.mjs` | `6a3160cd78091849994009a390605c1040dbe4203c6620e41ec8550478996e3c` |
| `snapback3/guide.md` | `60e20e0cfa8a4820509251091ad715e566021d8a460bd28c959e398900ab56e5` |
| `llp/2000-snapback3.rfc.md` | `f16c0a741299a0d6f37003967a7a33f1f691a61f2b550db89260d5e56c968a51` |

**Blocker:** `storage.ts` `113–116` — memory `clearSession` notify ignores nested checkpoint identity, unlike merge/IDB. Align the predicate and cover a subscribed successor client. The rest of the v7 cancel/retire boundary holds under inspection.
