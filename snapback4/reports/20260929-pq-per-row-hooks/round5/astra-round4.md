One **Medium regression blocks landing**.

**Medium — resubscribing a raw local handle bypasses retention policy.** [local.ts:1209](/home/ccheever/sb4-intent/review-pq-r4-astra/snapback4/packages/snapback4/src/local.ts:1209).

Concrete reproduction, on both wasm and process:

1. Observe an owned row with default retention; wait for its completed answer.
2. Close that handle.
3. Transfer ownership away and sync. A direct query now returns `null`.
4. Subscribe again to the original handle, holding its replacement device read.

The removed row remains displayed as `fresh: true`, without `revalidating` or an episode deadline—even after the replacement attempt has run beyond one second. The start callback uses `acquireRead`; `rerun` only calls `reload()` when `watch.kept` is already true. This completed snapshot has `kept === false`.

Both reproductions **pass on `7f540f094` and fail on `6369b9012`**. Changing this callback to `scheduleRead(watch)` passes both in an isolated copy.

**Smallest fix:** use `scheduleRead` for local observation subscription/resubscription; retain `acquireRead` for expiry sweeps. Add the real-client regression. The existing [raw-read-deadlines.test.mjs:55](/home/ccheever/sb4-intent/review-pq-r4-astra/snapback4/packages/snapback4/test/raw-read-deadlines.test.mjs:55) manually calls `owner.reload()`, masking the missing production call. **Blocks landing.**

**Low — the final cancellation guard lacks isolated detecting coverage.** [local.ts:1014](/home/ccheever/sb4-intent/review-pq-r4-astra/snapback4/packages/snapback4/src/local.ts:1014).

Deleting only `signal.aborted ||` from this callback passes **99 cancellation, publication, boundary, and retention tests**. They do not isolate cancellation between the earlier `checkRead(signal)` and this callback.

**Smallest fix:** inject cancellation at the late publication boundary, analogous to the new reset test, and assert no publication or watch update. This is a coverage gap, **not a demonstrated production defect; non-blocking**.

What is sound:

- The port introduces no dependency on removed LV code and does not restore touched-dependency withdrawal. Ordinary commits retain according to policy; expiry and scope resets withdraw.
- Queue bounds, cancellation/lifetime release, FIFO fairness, delayed expiry retries, canonical React keys, due-only sweeps, and rollback floors passed targeted checks.
- The earlier findings have fixes and detecting regressions:

| Earlier finding | Detecting coverage |
|---|---|
| Unknown-footprint final drain | `per-row-publication` |
| Floor rejection overwrites newer data | `per-row-publication`, `per-row-boundaries` |
| Reset-version fences, including final callback | `per-row-publication`, `per-row-retention` |
| Queued `keep:false` withdrawal | `per-row-boundaries` |
| Abort corrupts transport diagnostics | `per-row-liveness` |
| Unrelated writes erase offline fallback | `per-row-retention` |
| Sweep refresh, sign-out, queue-start episodes | `per-row-retention`, `per-row-boundaries`, real-clock React tests |
| Due-result preservation, backoff capacity, accept-time floor | `per-row-retry` |

Independent removals of the unknown drain, final floor checks, abort-diagnostic guards, final reset comparison, and memory-footprint propagation produced **25 detecting failures**.

The unchanged implementation passed **219 targeted tests plus five React tests**. The 1,000-hook real-clock cases produced zero loading renders on wasm, Worker, and process, with replacement starts spanning over two seconds. I did not rerun the full suite.

All builds, reproductions, and mutations ran in temporary copies. The review worktree remains unchanged.

**NOT READY**