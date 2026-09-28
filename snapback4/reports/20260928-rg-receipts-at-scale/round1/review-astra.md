One correctness blocker: the optional server probe can turn a valid receipt update into a non-retryable refusal.

1. **Medium — probe work is not deducted from the fallback recount allowance.**
   [snapback4/crates/snapback4-core/src/engine/row_views/live.rs:93](/home/ccheever/sb4-intent/review-rg-r0-astra/snapback4/crates/snapback4-core/src/engine/row_views/live.rs:93)

   `small_view_range` spends 65 examined-row charges before abandoning a large range. The fallback then uses the `limit` calculated **before** those charges, through `remaining = limit` at line 101.

   **Reproduced:** using `row-keyed-view.q`, seed 1,000 unexpired messages with ordinals 1–1000 and a member with `readUpTo = 0`. Calling `mark` with `readUpTo = 1` succeeds with an examined allowance of 210, but returns non-retryable `E_BOUND` with allowances of 240, 256, 300 and 500. Under the default 8,192-row allowance, a mutation updating eight members likewise fails; seven succeeds.

   These writes should commit with a pending recount when immediate certification cannot fit.

   **Smallest fix:** after an unsuccessful probe, reduce the fallback recount allowance to account for the consumed work, retaining the publication headroom. Keep the probe charged. Add the moderate-budget and default-budget reproductions above; the existing 48-row test never enters the probe.

2. **Low — the new certification tests miss the exact cutoff.**
   [snapback4/crates/snapback4-core/src/engine/row_views/batch/tests.rs:31](/home/ccheever/sb4-intent/review-rg-r0-astra/snapback4/crates/snapback4-core/src/engine/row_views/batch/tests.rs:31)

   A mutation changing the candidate loop at `live.rs:57` from `0..n` to `0..n.min(LIMIT - 1)` would survive the added regressions while silently counting only 63 of exactly 64 candidates.

   **Smallest fix:** add 63-, 64- and 65-candidate cases with independent expected counts and probe/decode bounds. Include rejected candidates followed by a live candidate.

The remaining server logic looks sound. The range is a necessary predicate restriction; member and source-group authorization precede probing, and decoded candidates still undergo expiry and full-predicate checks. I found no stale-count, tombstone, membership or unauthorized-count shortcut. Large ranges retain the shared walk. Public disclosure reservations remain unchanged, apart from the writer-admission regression above.

The client changes also look sound. Pending observations remain scoped by client and operation, with stale-read fencing and final-subscriber teardown. Clock deduplication preserves failed-save retries and attachment identity; the durable admission floor remains separately committed by the device. Settlement retains FIFO dispatch, durable receipts and retryable-head blocking, with follow sync providing convergence. Reverting the recovered-receipt optimization in memory was caught by the new held-sync test.

The guide correctly moves delivery collection to the SDK while retaining visible-screen `seen` reporting and exact disjoint coverage. Old hooks remain API-compatible, but successful full-scale operation of the unchanged hook is **not established**: the retained intermediate unmigrated run timed out, and the report records an examined-row refusal. It should not be described simply as “slower, but working.”

The measurement claims are appropriately qualified. I recomputed the recorded p95 values: **15.596 s published, 9.275 s starting main, 913 ms final**. The final run has one measured send above one second. Warmups and intermediate misses are retained. The loaded miss belongs to an earlier implementation; there is no final loaded-run qualification. The report also correctly distinguishes visible rendering from server settlement.

Validation on copies/in-memory modules: seven batch tests, 29 clock tests, 29 settlement/replacement tests, and a 10,000-subscriber lifecycle check passed. The additional budget reproductions failed as described. The worktree remains unchanged.

**Verdict: NOT READY.**
