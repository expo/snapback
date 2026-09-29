Two correctness regressions block landing. Both reproduce on copies of PQ and pass against `ee514de11`.

1. **High — active reads can starve every later observation.** [snapback4/packages/snapback4/src/read-work.ts:22](/home/ccheever/sb4-intent/review-pq-r0-astra/snapback4/packages/snapback4/src/read-work.ts:22)

   Slots remain occupied until the entire read promise settles; `cancel()` only removes pending work. Hold eight query responses, close all eight watches, then mount an unrelated healthy query. Its request never starts: eight occupied slots, zero healthy requests, `{loading:true}` indefinitely. A direct query still succeeds.

   **Smallest fix:** give active attempts cancellation and a bounded lifetime, releasing capacity on cancellation/expiry. Closing the last owner must cancel active work too; retries should rejoin the queue. Preserve publication fences for late completions. **Blocks landing.**

2. **Medium — unknown apply footprints withdraw observations without refreshing them.** [snapback4/packages/snapback4/src/local.ts:281](/home/ccheever/sb4-intent/review-pq-r0-astra/snapback4/packages/snapback4/src/local.ts:281)

   On an acquired device, let an apply reply omit `touched`, as the conservative unknown-footprint path permits. `answers.committed()` withdraws every affected watch, but this line suppresses scheduling. The final drain has no recorded tables; a withdrawn device watch is neither `kept` nor server-running, so it stays loading. With a real wasm device behind an adapter omitting that field, a committed edit caused **zero reevaluations**. Baseline reevaluated and displayed the edit.

   **Smallest fix:** retain immediate scheduling when `touched === undefined`, or propagate an explicit unknown-footprint flag into the final all-observation drain. **Blocks landing.**

3. **Low — the client card overstates the concurrency bound.** [snapback4/crates/snapback4-lang/src/guide/client.md:73](/home/ccheever/sb4-intent/review-pq-r0-astra/snapback4/crates/snapback4-lang/src/guide/client.md:73)

   Timed presence refreshes call their separate refresh path and bypass `ReadWork`. Sixteen mounted observations with server-requested refresh intervals produced **16 simultaneous held refreshes** in my probe.

   **Smallest fix:** qualify the eight-in-flight statement as applying to queued evaluations, excluding timed presence probes, matching the report’s existing caveat. **Does not independently block landing.**

4. **Low — the queue tests do not establish fairness under continuing arrivals.** [snapback4/packages/snapback4/test/per-row-work.test.mjs:15](/home/ccheever/sb4-intent/review-pq-r0-astra/snapback4/packages/snapback4/test/per-row-work.test.mjs:15)

   A mutation adding `pending.delete(watch)` immediately before `pending.set(watch, run)` **survives all seven new tests**. It moves repeated requests to the tail; sustained arrivals plus repeated invalidations can indefinitely postpone an existing queued observation.

   **Smallest fix:** interleave new arrivals and duplicate scheduling across turns, asserting bounded progress for an already queued owner. Also cover cancellation of active owners—the current cancellation test cancels only pending ones. **Non-blocking separately; the liveness fixes need regressions.**

What is sound:

- The queue preserves insertion order when requests coalesce, so it is fair **provided active jobs settle**.
- I found no deferred-publication disclosure regression. Withdrawal remains synchronous, and execution/publication retain their revision, credential, dependency-cut and expiry checks. A probe holding eight old responses while revocation arrived recovered 25 observations across all retention policies without republishing private data. Proven nonrevoking public puts may retain old data marked `revalidating`; that remains LV’s intended policy.
- The clock fix is correct: future deadlines are rearmed, all due raw/held answers withdraw before callbacks, and due owners refresh once. Restoring the old sweep makes the new clock test fail.

The 1,000 reevaluations are required by the **current table-granularity dependency contract**, not inherently by point reads. Certified row dependencies could reduce the simple single-row edit from 1,000 evaluations to one; authorization dependencies, missing-row reads and page ranges must remain covered. This matters materially: the recorded wasm relevant-write time is **796 ms versus 240 ms** for the list, both including the same 200 ms settlement wait.

The list advice and **593 ms versus 23 ms** mount comparison are accurate for the measured simple fixture. They should not be extrapolated to the joined ChatRail workload. Finer dependencies are worthwhile follow-up work, not a landing prerequisite.

Independent verification: all seven new tests passed; both blocking probes failed only on PQ; the deferred-revocation probe passed. The checkout remained unchanged.

**Verdict: NOT READY.**