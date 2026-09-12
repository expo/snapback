## Verdict

**CHANGES REQUIRED.** Two P1 authority/false-ready counterexamples remain, plus two confirmed P2 structural performance issues. I ran no tests or benchmarks; implementation-team results in `inputs.json` were not treated as execution evidence.

## Confirmed material defects

1. **P1 — A receipt sequence advance leaves an already-materialized acquired resource usable.**  
   [client.ts:1163](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v4/source/snapback3/packages/snapback3/src/client.ts:1163) raises `minimumSeq` and calls `renewResources()`, which clears the pools but [client.ts:1241](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v4/source/snapback3/packages/snapback3/src/client.ts:1241) only changes an existing snapshot to `fresh:false`; it preserves `status:'ready'`, `data`, and its old sequence.

   Exact counterexample: acquire query Q at seq 5, call `watch(Q)` so its data is materialized, then receive a `committed`, `rejected`, or `conflict` receipt at seq 6 while terminal persistence is delayed. Before yielding at the persistence await, Q still exposes its seq-5 data as ready. After `setOnline(false)`, `refresh()` cannot find a qualifying pool, but `readLocal()` does not clear the existing snapshot, so `query(Q)` returns the withdrawn data.

   The receipt tests at `acquisition-client.test.ts:617` create the watched resource only after withdrawal, so they miss this pre-existing-resource case.

2. **P1 — Fail-closed cleanup does not prevent a concurrent close/reopen from restoring the old authority.**  
   [client.ts:1350](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v4/source/snapback3/packages/snapback3/src/client.ts:1350) writes `clearSession` only after the failed withdrawal settles. [client.ts:350](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v4/source/snapback3/packages/snapback3/src/client.ts:350) provides no close barrier, while [client.ts:367](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v4/source/snapback3/packages/snapback3/src/client.ts:367) trusts whatever a newly opened client loads.

   Exact counterexample using the packet’s supported custom-storage pattern:

   - Alice and a ready dataset are durable.
   - A successor/invalidation write is delayed and will fail.
   - Close the old client and immediately construct an offline client before releasing that failure.
   - Its `load()` sees and restores Alice’s old ready checkpoint.
   - Release the failure; the fallback `clearSession` succeeds.
   - Because `ClientStorage.subscribe` is optional and the test adapters omit it, the reopened client receives no notification and retains the withdrawn dataset in RAM indefinitely.

   This is not the acknowledged “every persistent write fails” limit: the conditional fallback succeeds. Tests at `acquisition-client.test.ts:518` and `:601` wait until the fallback has cleared storage before reopening, avoiding the race they claim to cover.

## Structural performance issues

3. **P2 — Stored envelopes are fully reconstructed and decoded repeatedly, not once.**  
   [acquisition.ts:117](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v4/source/snapback3/packages/snapback3/src/resource/acquisition.ts:117) constructs a fresh outer envelope on every call, defeating the object-identity ownership cache.

   For a legal fresh single-chain acquisition of P pages, finalization calls `walk(root)`, `chainValue(root)`, the all-chain walk, and `restoreAcquiredPool()` at `client.ts:727`, `:729`, `:738`, and `:752`. Each reconstructs and fully decodes every page, including the size traversal at `protocol.ts:155`. That is four additional full-envelope passes after the original network decode. No substantive test counts decoder/preparation work.

4. **P2 scaling limit — Whole retained state is remapped once per dataset/cycle.**  
   [client.ts:526](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v4/source/snapback3/packages/snapback3/src/client.ts:526) restores datasets in a loop, while [acquisition.ts:138](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v4/source/snapback3/packages/snapback3/src/resource/acquisition.ts:138) rebuilds a map of every retained row and scans every resource for each ready dataset. `acquisitionState()` similarly maps every row for each active cycle at `acquisition.ts:154–159`. With D datasets and N retained rows, this adds O(D×N) processing beyond the documented O(N) IndexedDB lifecycle load. Lack of old-version GC amplifies it.

## Other reviewed points

I found no additional confirmed counterexample in:

- Per-dataset denial isolation and sibling preservation.
- Transaction-current `clearSession` matching of token, principal, and auth epoch.
- Row content-address/table/id/map-key checks based on immutable owned values.
- List-only typed declarations and runtime admission.
- Cancellation, resume, reconnect, and current completion-cycle behavior.
- Fresh-only skip’s exact reachable-resource and expected-sequence checks.
- Prohibition on maximum-sequence relabeling.
- Durable progress/ready publication order and operation identity retention.
- Owner limits: 32 executions, 20 ms/1 MiB soft limits, 15 MiB hard limit, legal first-page soft overrun, and canonical continuations.

The stated lifecycle-load, GC, synchronous-compression, and universal-write-failure limits remain honest scope limits. With v4 performance, foreground, and real-IndexedDB controls pending, there is no qualified performance result.

## Exact hash binding

All 16 source hashes independently matched `inputs.json`.

```text
baseCommit  2ea99ca6c7d4f060b0c940d88e8e797e15f202e9
inputs.json d6e5093f617d0c0f37d386a75ddcbc729ada4c1f5e82821b66b288a729aa2cd8
delta.diff  790f4b9d5e0f92159af4b76d4c110af4be2027207897384cc965ffb747e035ce

8bb66126a9ca03c3c9492e83b0fb6dbfff74eb14f4a08400ba2c85848f9c7223  snapback3/packages/snapback3/src/client.ts
99fd5a3d50d28241637df65333d4d80116bdea2ca0c0a402d8624c6d137b1f1b  snapback3/packages/snapback3/src/resource/acquisition.ts
cf1869bbe3eae7c2afdd67d9d245fb35b192e3d2368c725dfcdb93b92b52f90a  snapback3/packages/snapback3/src/resource/storage.ts
6899cbdcfb4fb0a4dfb056a3da74ed2ea87155a7ec827b9b1bde6e078a97c46c  snapback3/packages/snapback3/src/resource/types.ts
443b83d2b025a7b6b5a718554aec98d67f69ea8bad1a1be9c085b946e50e55f2  snapback3/packages/snapback3/src/resource/facts.ts
96c6708a8147c6ab59335412feaad868ab0d62ce3c3c5c2877684a7da997217f  snapback3/packages/snapback3/src/resource/protocol.ts
459f2fe1bd8b2075e93fee4e19fa6fe5d1cfc94787da3c1707e0c7e902f04812  snapback3/packages/snapback3/src/resource/signal.ts
c27cb8f44114f1e12414a945eb22e3e3c626033172f57644471c53e6ce18772e  snapback3/packages/snapback3/src/resource/row-values.ts
36d24d5deca5533d34979ddb203c6c69c5e62f340a1675c308dc0cbf99e5d01f  snapback3/tests/acquisition-client.test.ts
eea6ff4c60de22ad9d32bc86acf5cc8cdd6c7c0059ff430f993ad90bbe017a36  snapback3/tests/resource-client.test.ts
b5224137ccbf53c4f181502004f49973be9601c83a2155a9df95369346b0a6aa  snapback3/tests/manifest-custody.test.ts
3a5f354bca9d84767667520e02719c263a0e3dd7b34155a4a852a0989dd84340  snapback3/crates/snapback3-worker/src/protocol.rs
16e29bd5cd5818278b376d171f3c71601c8ec7378239d1b219980fb2d6cfc195  snapback3/packages/snapback3/src/node/http.ts
37363b763cbe203cb1432d10ceae213784c6668a5cb06f2111c69107ad5cbd0c  snapback3/guide.md
91c11fb239baa32b845db6408d8cdd2199d715bac16860c2db5fc88e144c8226  llp/2000-snapback3.rfc.md
f9c0533d52429debcc7df6e7b6a647ad98fa2f1e4b9f16f797a90628b8ddddf0  snapback3/scripts/test-acquisition-storage.mjs
```