**Three Medium defects block landing, independently of the wasm budget.**

I ran the requested diff and remerge diff. On disposable copies, all **300 seeds per host**, **22 differential schedules per host**, **85 named JavaScript tests**, and **21 affected Rust tests** passed. The review worktree is unchanged.

1. **Medium — `immutable` does not prevent cross-scope ID reuse. Blocks landing.**

   Location: [ordinary.rs:139](/home/ccheever/sb4-intent/review-os-r56-astra/snapback4/crates/snapback4-core/src/search_plan/ordinary.rs:139).

   Reproduced on **process and wasm**: acquire `m001` in `left`, leave that room, then execute an authorized mutation that deletes `m001` and reinserts that ID into `live`. The table declares `immutable room`; immutability constrains updates, not replacement rows.

   With **no writes during traversal**, search returns both:

   - Current `m001`, `at: 3000`, `"coffee reborn"`.
   - Retained `m001`, `at: 1001`, `"coffee"`.

   The admission proof still does not establish disjoint row identities. SDK accumulation can subsequently replace the current image with the older retained image because it arrives later.

   **Smallest conservative fix:** decline composition unless scope ownership is preserved across the ID’s entire lifetime, including deletion/reinsertion. An update-only immutability check is insufficient. Add the reproduced replacement sequence to both host tests.

2. **Medium — generic page deduplication deletes distinct projected results. Blocks landing.**

   Location: [react-pages.ts:109](/home/ccheever/sb4-intent/review-os-r56-astra/snapback4/packages/snapback4/src/react-pages.ts:109).

   This valid Quarry query reproduces it:

   ```quarry
   return messages first 2 by .at after c { id: .room, body }
   ```

   Two messages in one room produce two distinct server results. `Pages` collapses them into one, keeps the second body, and reports `complete: true`. An arbitrary projected field named `id` is not necessarily source-row identity.

   **Smallest fix:** apply automatic deduplication only where row identity is established by query metadata; preserve ordinary projection-list semantics otherwise. An explicit accumulation key is another viable boundary.

3. **Medium — early input refusals become loading and an immediate retry loop. Blocks landing.**

   Location: [local-search.ts:200](/home/ccheever/sb4-intent/review-os-r56-astra/snapback4/packages/snapback4/src/local-search.ts:200), interacting with [serve.rs:826](/home/ccheever/sb4-intent/review-os-r56-astra/snapback4/crates/snapback4/src/serve.rs:826).

   With all rooms current, call search with `{ q: 123 }`. On both hosts, the server returns `E_INPUT` with the correct `store_id` and `head`, but its early-refusal response lacks `generation`. Composition rejects its identity **before handling the refusal**, returning loading.

   A mounted observation made **82 requests in 200 ms**, remaining loading: `refreshSearch` repeatedly restarts the permanently invalid query.

   **Smallest fix:** give early query refusals consistently captured identity/generation metadata, and ensure permanent refusals terminate observation instead of triggering identity refresh. Test both the one-shot refusal and bounded observation request count.

4. **Low — the oracle is not fully independent on reset/cut paths. Does not independently block landing.**

   Locations: [ordinary-search-oracle.test.mjs:126](/home/ccheever/sb4-intent/review-os-r56-astra/snapback4/packages/snapback4/test/ordinary-search-oracle.test.mjs:126), [:139](/home/ccheever/sb4-intent/review-os-r56-astra/snapback4/packages/snapback4/test/ordinary-search-oracle.test.mjs:139), and [:151](/home/ccheever/sb4-intent/review-os-r56-astra/snapback4/packages/snapback4/test/ordinary-search-oracle.test.mjs:151).

   Returned cursor fields help decide whether to restart and whether retained rows belong in the expected domain. The offline/mutable cut branch advances the model using `read.data` itself. Consequently, the blanket claim that returned results never determine expectations is inaccurate.

   **Smallest fix:** derive restart and expected lane suspension from modeled events/fixture conditions; distinguish partial-result safety checks from independently modeled keyset-page checks. Do not use returned rows to establish the model’s next expected position.

5. **Low — argument binding has no effective regression. Does not independently block landing.**

   Location: [ordinary-search-oracle.test.mjs:84](/home/ccheever/sb4-intent/review-os-r56-astra/snapback4/packages/snapback4/test/ordinary-search-oracle.test.mjs:84).

   **Demonstrated surviving mutation:** remove query arguments from the cursor binding in `local-search.ts:168`. All **600 seeds and 85 named JavaScript tests**, including mounted React, still pass.

   A new test changes the needle from `coffee` to `tea` while supplying the previous cursor. The original implementation restarts and finds the new head; the mutation incorrectly returns an empty page. This fails on both hosts.

   **Smallest fix:** add that parameter-change regression.

The oracle’s **uncut row model is sound**: it independently models server writes and acquired device images, uses the correct per-lane visibility, and compares complete ordered row images against its own consumed key. Its stable-row checks and server differential provide useful evidence. Mutation results confirm that:

| Mutation | Detected by |
|---|---|
| Always merge descending | Seeds **1 and 3**, both hosts |
| Seek the server’s separate consumed position | Seed **159**, both hosts |
| Remove reply-identity rejection | Seed **15**, plus store/generation regressions |
| Remove reset-counter persistence | Named pagination-epoch Rust regression |
| Remove immutable-scope admission | Named mutable-scope Rust regression |
| Remove SDK deduplication | Both search/history accumulation tests |

For ordinary updates, mutable-scope admission gives a clear `N_SEARCH_MUTABLE_SCOPE` explanation and conservative fallback. Store/generation withdrawal, reset identity, and the combined-cursor correction withstand these mutations. Newest-image accumulation handles genuine repeated row identities correctly; its applicability to arbitrary projections is the defect above.

I found no hidden-room, hidden-count, or hidden-order-key disclosure in the reviewed changes. The merge resolution preserves EQ’s descriptor validation and OS’s public-index mapping. The wasm budget remains the supervisor’s stated landing decision.

Reproductions are retained in [the disposable test directory](/tmp/os-r56-astra-6clswkv0/snapback4/packages/snapback4/test): `astra-rebirth`, `astra-projection`, `astra-invalid-input`, and `astra-arguments`.

**Verdict: NOT READY.**