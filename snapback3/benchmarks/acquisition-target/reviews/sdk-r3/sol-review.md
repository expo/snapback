Verdict: changes required. I found three high-priority correctness/authority defects and two structural performance defects. The sub-three-second target remains unqualified; I ran no tests or benchmarks.

## Confirmed material bugs

1. **[P1] A denial for one dataset destroys every dataset’s durable readiness.**  
   [snapback3/packages/snapback3/src/client.ts:827](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/sdk-r3/source/snapback3/packages/snapback3/src/client.ts:827) handles a denied page with `clearAcquisitions: true`. Both storage implementations consequently erase all acquisition metadata, rows, and resources at [storage.ts:66](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/sdk-r3/source/snapback3/packages/snapback3/src/resource/storage.ts:66) and [storage.ts:210](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/sdk-r3/source/snapback3/packages/snapback3/src/resource/storage.ts:210).

   Exact counterexample: acquire dataset A successfully, then acquire unrelated dataset B at the same sequence and receive `denied` for B. A remains `ready` in RAM because only B is removed from `acquiredFacts`, but A’s durable checkpoint has been deleted. After process reopen, A is unavailable. This violates dataset isolation and makes A’s current ready state falsely imply durability.

2. **[P1] A failed successor-manifest write permits an old-generation dataset to revive offline.**  
   On generation change, [client.ts:486](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/sdk-r3/source/snapback3/packages/snapback3/src/client.ts:486) seals RAM acquisitions before persisting the new manifest at line 502, but unlike denial/invalidation paths it has no session-clearing fallback when that write fails.

   Exact counterexample: generation A has a ready dataset; the client observes generation B; an adapter fails exactly the successor-manifest write; the process exits before retry; the old session, generation-A manifest, and ready acquisition remain durable. With the network unavailable, initialization restores them at [client.ts:386](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/sdk-r3/source/snapback3/packages/snapback3/src/client.ts:386), publishing data whose authority was already known to be obsolete.

3. **[P1] Restoring content-addressed rows trusts the stored claimed hash.**  
   [snapback3/packages/snapback3/src/resource/acquisition.ts:89](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/sdk-r3/source/snapback3/packages/snapback3/src/resource/acquisition.ts:89) looks up each row by `versionKey` but never recomputes `resourceVersionKey(row.row)` or compares it with that key.

   Exact counterexample: a mutable/custom storage adapter returns a retained row with the original `versionKey`, table, and ID but changes a field from `"Original"` to `"Forged"`. The envelope still validates structurally, the row reference resolves, and offline queries can return `"Forged"`. Manifest/schema custody correctly validates actual schema bytes; row custody does not provide the corresponding guarantee.

4. **[P2] Acquisition lifecycle operations scan the entire durable corpus.**  
   `runAcquisition()` loads complete storage at [client.ts:624](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/sdk-r3/source/snapback3/packages/snapback3/src/client.ts:624), while IndexedDB `load()` performs `getAll()` over every normal and acquisition row/resource store at [storage.ts:142](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/sdk-r3/source/snapback3/packages/snapback3/src/resource/storage.ts:142). Cancellation also takes this route at [client.ts:571](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/sdk-r3/source/snapback3/packages/snapback3/src/client.ts:571).

   Exact counterexample: after retaining a 100k dataset, starting or cancel/resuming a small unrelated dataset deserializes and allocates the entire 100k corpus. Work is proportional to all retained history rather than the affected dataset/checkpoint, creating an avoidable scaling and memory cliff.

5. **[P2] The bulk path performs redundant browser decoding and blocking owner compression.**  
   Each full page is decoded at [client.ts:810](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/sdk-r3/source/snapback3/packages/snapback3/src/client.ts:810), then cloned and decoded again at line 822 through [protocol.ts:145](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/sdk-r3/source/snapback3/packages/snapback3/src/resource/protocol.ts:145). Each decode also serializes the envelope solely to measure its size at line 155. On the owner, [http.ts:358](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/sdk-r3/source/snapback3/packages/snapback3/src/node/http.ts:358) synchronously stringifies and `gzipSync`s responses up to the 15 MiB hard limit.

   A legal large acquisition response therefore causes repeated whole-envelope main-thread traversal in the browser and blocks the Node event loop during compression, delaying concurrent foreground sends. This does not prove the three-second target is missed, but it directly conflicts with bounded publication/yielding and should be measured or removed before qualification.

## Test gaps and optional hardening

- The denial test at `acquisition-client.test.ts:328` contains only one dataset and therefore endorses an empty global acquisition store without detecting unrelated-data loss.
- No focused test exercises successor-manifest persistence failure followed by offline reopen.
- No test mutates a stored row while retaining its claimed `versionKey`.
- The “exact pages after offline reopen” test at `acquisition-client.test.ts:147` reads only one root page. The `< 100` stored-row assertion allows zero and does not verify the complete root-plus-derived reachable graph or a full digest.
- Owner tests for pinned sequence, continuation bounds, and conditional validation are non-vacuous. Manifest-custody mutation assertions are also substantive.
- Cross-tab acquisition-floor/invalidation writes are not broadcast—only session changes are. A second open client can retain old in-memory readiness until it independently contacts the owner. I consider this an authority-hardening gap unless “known” is explicitly scoped per client instance.
- No nit-only findings.

## Frozen sources reviewed

All source hashes matched `inputs.json` at base commit `2ea99ca6c7d4f060b0c940d88e8e797e15f202e9`.

```text
snapback3/packages/snapback3/src/client.ts                   d933517cb96671264964e7ac433deb5c193eef53f911f47b57c1c28ab4883615
snapback3/packages/snapback3/src/resource/acquisition.ts     d9184a764a4edbe435a0ce1912409cd3d4335a4a30f2bae4d31bb3d787398d59
snapback3/packages/snapback3/src/resource/storage.ts         cd673983349aeb73bd296f9ed0d6821eb45298280bb453a9856655038d1a6724
snapback3/packages/snapback3/src/resource/types.ts           5de0bffd40e075925ff2fa43f692f6762e86ab978354278e2125ad5453c0435d
snapback3/packages/snapback3/src/resource/facts.ts           443b83d2b025a7b6b5a718554aec98d67f69ea8bad1a1be9c085b946e50e55f2
snapback3/packages/snapback3/src/resource/protocol.ts        452a25fadf5d67090e6ecbeb6474b54a64e201eff5c4449886d08f65f69f152a
snapback3/packages/snapback3/src/resource/signal.ts          459f2fe1bd8b2075e93fee4e19fa6fe5d1cfc94787da3c1707e0c7e902f04812
snapback3/packages/snapback3/src/resource/row-values.ts      c27cb8f44114f1e12414a945eb22e3e3c626033172f57644471c53e6ce18772e
snapback3/tests/acquisition-client.test.ts                   49e6c5bd135767e459c5584af097543230e6d1115d5bc7756470945a377ca622
snapback3/tests/resource-client.test.ts                      eea6ff4c60de22ad9d32bc86acf5cc8cdd6c7c0059ff430f993ad90bbe017a36
snapback3/tests/manifest-custody.test.ts                     b5224137ccbf53c4f181502004f49973be9601c83a2155a9df95369346b0a6aa
snapback3/crates/snapback3-worker/src/protocol.rs            9307fa74ad3436fdd7e6f543e0b5deaf89ec65ef4ad61f92d3af2ea75102f022
snapback3/packages/snapback3/src/node/http.ts                16e29bd5cd5818278b376d171f3c71601c8ec7378239d1b219980fb2d6cfc195
snapback3/guide.md                                           535640216181c2f401b70195933a0ece830b71023f1a8449a3360acedb2fab7e
llp/2000-snapback3.rfc.md                                    3d012671a62786c18968b4f548d04d304fd70922bc0eaf4cfa3ce5ebf69e9ba2
```

`inputs.json` SHA-256: `5c239e784ded259131b72215c716886583a1b65b81c1114a5152f6550d703b88`.