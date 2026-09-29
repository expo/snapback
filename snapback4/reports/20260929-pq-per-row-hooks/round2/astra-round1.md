No new production blocker found. Two non-blocking findings remain.

1. **Medium — unknown-footprint refresh can still finish before its dependency fence clears.** [local.ts:282](/home/ccheever/sb4-intent/review-pq-r1-astra/snapback4/packages/snapback4/src/local.ts:282), with the final drain at [local.ts:790](/home/ccheever/sb4-intent/review-pq-r1-astra/snapback4/packages/snapback4/src/local.ts:790).

   Scenario: `/changes` fences a device query; an apply omits `touched`; the immediate refresh returns `loading` before sync publishes its watermark. The final drain sees no touched tables and skips the loading device owner. It remains loading although a direct query returns the committed row.

   Reproduced on wasm and process, **also on `f56e8048a`**. This is inherited, not a PQ regression, so it does **not block PQ landing**. Smallest fix: carry an unknown-footprint flag into the final drain and schedule affected owners after watermark publication. That change passes both [reproductions](/tmp/pq-review-pya2ts7e/snapback4/packages/snapback4/test/review-unknown-fence.test.mjs:9).

2. **Low — the requested reset-version mutation coverage remains incomplete.** [keep-clock.test.mjs:387](/home/ccheever/sb4-intent/review-pq-r1-astra/snapback4/packages/snapback4/test/keep-clock.test.mjs:387).

   Replacing `resetVersion !== watch.resetVersion` with `false` independently in `client.ts` and throughout `local.ts` leaves all **74 PQ/clock tests passing**. The local mutation also passes 68 additional LV/reset tests. The new rollback test correctly exercises recovery beginning *after* withdrawal; it does not isolate an already-running attempt crossing a reset.

   Smallest fix: add a controlled pre-reset attempt/final-publication regression that fails when the reset fence is removed. **Non-blocking coverage gap; these surviving mutations alone do not establish a production defect.**

What is sound:

- Active cancellation releases slots despite ignored aborts; 30-second expiry releases capacity and retries behind queued owners. Shared owners preserve their attempt, and tested late completions cannot publish.
- The original missing-`touched` regression is fixed, subject to the inherited ordering case above.
- Withdrawn-deadline floors reject actual post-rollback bodies across all three tiers and retention policies.
- Canonical React keys preserve loaded queries and page chains.
- The card correctly excludes direct queries and timed presence refreshes.
- Continuing-arrival FIFO coverage now kills the duplicate-to-tail mutation.

I independently confirmed failing controls for cancellation, lifetime expiry, unknown-footprint scheduling, FIFO order, deadline-floor removal, and raw React keys. The rebuilt copy passed 74 targeted regressions; LV/React coverage passed after completing the copied native fixtures. No new membership-disclosure or LV publication-order failure appeared.

The bound covers queued attempts, not a guaranteed successful first answer under indefinitely unavailable transport. The review worktree remains unchanged.

**READY WITH CHANGES**
