**Verdict: request changes.** Bound to `inputs.json` (`candidate: v6`, `frozenAt: 2026-09-12T20:31:17.934256+00:00`, `baseReview: final-v4`) and the FILE SHA256 headers below. I did not run tests, builds, or benchmarks; implementation-team results are not my evidence.

The v4 P1 (cancel during automatic revalidation republishing `ready`) and P2 (same-adapter reopen in the failed-write/`clearSession` gap) are addressed in source, and the new tests actually assert those contracts. Envelope reuse is fail-closed on caller mutation, missing/replaced rows, and authority mismatch. One v6 withdraw path is still missing: dropping an acquired pool does not always clear an already-displayed acquired snapshot, so offline `query` can return pages the new declaration and a reopen would refuse.

---

## Confirmed defect

### P2 — Prefilling a watch, then changing the declaration (or cancelling a ready dataset), leaves withdrawn acquired pages queryable on the same client

**Files:** `snapback3/packages/snapback3/src/client.ts` `261–289`, `517–544`, `591–597`, `909–916`

`withdrawAcquiredResources` only runs from `suspendAcquisitions` and denial. `acquire()` on a changed `id`/`revision` deletes `acquiredFacts` and seals the old handle, and `cancel()` persists `status: 'cancelled'`, but neither clears origin-tagged snapshots. `readLocal` only writes when it finds a value; the offline `acquireResource` path then returns the leftover snapshot.

**Counterexample 1 (public APIs; matches the existing scope-withdraw test, with the watch created first):**

1. `await client.auth.persona('alice')`; `await client.acquire(spec()).completed` so dataset `history` is ready (rooms + messages).
2. `const held = client.watch('feed.conditional', { c: null, global: false })`. `readLocal` (`517–536`) tags `held.acquisition = { id: 'history', seq: 5 }` and shows message rows.
3. `client.setOnline(false)`.
4. `client.acquire({ ...spec(), revision: 'v2', expand: () => [] })` (`263–273`): deletes `acquiredFacts`/`acquiredIdentities` for `history`, seals the old handle, does **not** call `withdrawAcquiredResources('history')`.
5. `held.getSnapshot().data` is still the old messages. `await client.query('feed.conditional', { c: null, global: false })` hits `acquireResource` `916`, `readLocal` finds nothing and leaves the snapshot, `query` `298` returns those rows.
6. Close and reopen the same adapter offline: messages are unavailable (`resourceKeys: []` on the acquiring checkpoint). Same-client RAM and durable restore disagree.

The current test `an offline changed declaration withdraws only its old scope…` (`acquisition-client.test.ts` `208–228`) only `watch`es **after** the revision change, so it never exercises this origin tag.

**Counterexample 2 (cancel of an already-ready dataset):**

1. Complete `spec()`, prefill the same watch.
2. `acquisition.cancel()` (`104–111` → `591–597`): handle is `cancelled` and disk is written `cancelled`; `acquiredFacts` is not deleted and snapshots are not withdrawn.
3. `client.setOnline(false)`; `query` of the prefilled resource still returns the rows. Reopen refuses them (`restoreAcquiredPool` requires `status === 'ready'`).

Denial (`850–854`) and receipt/invalidation (`568–573`) already withdraw. Call `withdrawAcquiredResources(id)` wherever that pool is dropped (declaration change, cancel, incompatible resume). Add a prefilled-watch assertion to the existing declaration-change test.

This is withdrawn-scope display, not a cross-account leak. Direct live snapshots stay untagged (`1032–1038`, `1046`) and still follow ordinary stale display, as the new direct-receipt test describes.

---

## What held up under inspection

I am not treating tests I did not run as execution proof.

| Invariant | Result |
| --- | --- |
| v4 P1: cancel during captured automatic restart | `startAcquisition` `608` and `runAcquisition` `629` both require handle `status === 'acquiring'`. `prepareAutomaticResume` `126` refuses `cancelled`. `finish` `133` is a no-op on cancelled. Captured `persistFailClosed.then(startAcquisition)` `575–578` cannot persist `ready` over a cancel. |
| v4 P2: same-adapter reopen vs failed withdrawal | `persistFailClosed` `1372–1391` runs write and conditional `clearSession` as **one** `storageJob`. `initialize` load is also a `storageJob` `52–56`. Same adapter object cannot `load()` in the swallowed-tail gap. Distinct adapter instances remain on their notification contract (stated limit). |
| Prefill withdraw on seq/invalidation/denial | `suspendAcquisitions` clears pools then `withdrawAcquiredResources()`; denial withdraws that `id` only. Direct snapshots have `acquisition === undefined` and are left stale on receipt advance (`renewResources` → `staleResources`). |
| Envelope cache custody | Cache is keyed only on module-owned resource objects (`111–116`, `173–176`). Hit requires same manifest **object**, schema object, generation, schemaHash, and row object identities `166–169`. Missing rows throw before hit `155–161`; mutable/replaced rows miss and re-hash; `restoreAcquiredPool` still gates session/generation then `FactPool.admit` authority `186–201`. |
| Receipt seq before yield | Unchanged: advanced `committed`/`rejected`/`conflict` still `renewResources()` before `persist({ operations })`. New tests cover all three plus a held acquired snapshot. |
| No max-seq relabel | `acquiredFacts` still picks one coherent pool; `unchanged` still retags seq only after owner re-execution + validator match `834–843`. |
| Owner 32 / storage | `protocol.rs` `18–21` still 32 / 20ms / 1MiB / 15MiB. `storage.ts` hash unchanged from v4. `gzipSync` still synchronous on finite `/api/acquire` replies (`http.ts` `358–372`). |
| Journal | Terminal persist still writes the original intent id/body. |

Honest leftover limits, not hidden passes: IndexedDB `load()` still `getAll`s the retained corpus; old row versions are not GC’d until authority cleanup; if every write fails, disk erasure is not guaranteed; separate adapter instances are not on this queue. LLP 16’s timings remain unqualified for this v6 tree.

---

## Tests (assertion review only)

New tests have real assertions, not names:

- **Immediate same-adapter reopen** (`4501–4517`): `restored` stays false across the delayed failure, then offline watch data is undefined after `ready`.
- **Cancel during delayed suspension** (`4519–4542`): no extra `/api/acquire` calls, durable `cancelled`, offline query throws, explicit `resume()` reaches `ready`.
- **`committed`/`rejected`/`conflict`** (`4544–4565`): held acquired snapshot goes `loading` before terminal persist; offline query throws; handle is not `ready`.
- **Same-sequence invalidation** (`4567–4588`): held acquired snapshot is withdrawn, then republished at seq 5.
- **Direct stale** (`4590–4601`): live snapshot stays `ready`/`fresh: false` across a rejected receipt and still answers offline `query`.
- **Envelope cache** (`4745–4804`): `toBe` reuse only for owned+immutable+same row objects; missing/replaced/tampered/mutable headers/schema-delete do not inherit the cached envelope; `restoreAcquiredPool` still rejects other `authEpoch` and mutated envelope authority.

Gap: the declaration-change test still watches after the change, so it cannot catch the P2 above. I did not run these tests.

---

## Optional / nits (not blockers)

- `cancelAcquisition` `594` does `this.persistence.then(load)` **outside** `storageJob`, then enqueues the cancelled write. Cancel+close+immediate reopen **before** that write is queued can restore last durable `ready` (crash-before-cancel-write). That is not the v4 fail-closed gap; making the cancelled persist a `storageJob` would close it.
- Immediate-reopen test’s 5ms `setTimeout` is a scheduling fence, not a logical wait on the queue.
- `pages(string, …)` is still not list-constrained at the type level; runtime still refuses composites.

---

## Hash binding

| Path | SHA256 |
| --- | --- |
| `snapback3/packages/snapback3/src/client.ts` | `05e6374c9575d6099a67e4926e2f830a7e19c7d788937e780af1b27f5cdccaab` |
| `snapback3/packages/snapback3/src/resource/acquisition.ts` | `5de8e5cdf29bb8f603813839a85bf8b13df6876e2d887d9d30facffbeaf01e56` |
| `snapback3/packages/snapback3/src/resource/storage.ts` | `cf1869bbe3eae7c2afdd67d9d245fb35b192e3d2368c725dfcdb93b92b52f90a` |
| `snapback3/packages/snapback3/src/resource/types.ts` | `6899cbdcfb4fb0a4dfb056a3da74ed2ea87155a7ec827b9b1bde6e078a97c46c` |
| `snapback3/packages/snapback3/src/resource/facts.ts` | `443b83d2b025a7b6b5a718554aec98d67f69ea8bad1a1be9c085b946e50e55f2` |
| `snapback3/packages/snapback3/src/resource/protocol.ts` | `96c6708a8147c6ab59335412feaad868ab0d62ce3c3c5c2877684a7da997217f` |
| `snapback3/packages/snapback3/src/resource/signal.ts` | `459f2fe1bd8b2075e93fee4e19fa6fe5d1cfc94787da3c1707e0c7e902f04812` |
| `snapback3/packages/snapback3/src/resource/row-values.ts` | `c27cb8f44114f1e12414a945eb22e3e3c626033172f57644471c53e6ce18772e` |
| `snapback3/packages/snapback3/src/node/http.ts` | `16e29bd5cd5818278b376d171f3c71601c8ec7378239d1b219980fb2d6cfc195` |
| `snapback3/crates/snapback3-worker/src/protocol.rs` | `3a5f354bca9d84767667520e02719c263a0e3dd7b34155a4a852a0989dd84340` |
| `snapback3/tests/acquisition-client.test.ts` | `3670f0f41d7a706bc1a9caaa01fb7ded50576dde497c21ac7bb45146f1ac979a` |
| `snapback3/tests/resource-client.test.ts` | `eea6ff4c60de22ad9d32bc86acf5cc8cdd6c7c0059ff430f993ad90bbe017a36` |
| `snapback3/tests/manifest-custody.test.ts` | `b5224137ccbf53c4f181502004f49973be9601c83a2155a9df95369346b0a6aa` |
| `snapback3/tests/acquisition-envelope-cache.test.ts` | `18cf5b2ad20f2cc4879fae5f030e4a399b7e84a9a0f097c67fe37a9915325096` |
| `snapback3/scripts/test-acquisition-storage.mjs` | `214b6208aa53e5539b7ac0fcb6befcf6cbc41bbb48a6e1f1b91a5d3549aad960` |
| `snapback3/guide.md` | `60e20e0cfa8a4820509251091ad715e566021d8a460bd28c959e398900ab56e5` |
| `llp/2000-snapback3.rfc.md` | `39029642455df547724b4a8d493057bbc6fd60e1651a8dfc5aadbe26bba17c83` |

**Blocker:** `client.ts` `268–273` + `539–544` + `916` — prefilled acquired snapshots survive declaration change (and cancel-after-ready) so offline `query` returns pages a reopen will not restore. Wire `withdrawAcquiredResources` into those pool-drop paths and assert a watch created **before** the change.
