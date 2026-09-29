No correctness findings or landing blockers in `78bcc92c8..62e5ec73ac`.

The conflict resolutions preserve both lanes’ rules:

- `read-observation.ts` retains plain revalidation indefinitely, preserves offline freshness and `since`, and remembers queued change evidence through later plain reloads. Attempt execution starts the bound; subsequent queueing never renews it. Both retaining policies withdraw on bounded failure or timeout.
- `client.ts` preserves bounded scheduling for durable/ephemeral notifications and mutation receipts, alongside cancellation, sequence checks and deadline floors.
- `local-query.ts`, `local-reads.ts` and `local.ts` retain both fences: change versions reject pre-change completions; pending cuts prevent old replicas from discharging notifications before sync. Ordinary and background presence paths check eligibility. Generation changes reset before table filtering.
- The resolved tests distinguish enqueue time from attempt start without removing withdrawal assertions. LLP §10 accurately describes the combined behavior.

I found no path that restores removed membership rows, publishes a queued completion across a generation boundary, extends an existing episode, or introduces `loading` during plain revalidation. Immediate successful replica replacements remain direct.

Independent verification, entirely in disposable copies:

- **527 targeted tests passed**, including all eighteen facade schedules.
- **20 schedule histories per host** passed on process and wasm.
- Real-clock **1,000-hook** runs produced **zero loading renders** on wasm, Worker and process.
- Removal controls detected losses of plain retention, pending change bounds, pending cuts, queue caps, cancellation release, selective memory clearing, deadline floors and publication fences. The generation-removal control reached the model’s **240-second timeout**, rather than a focused invariant assertion.
- I did not rerun the complete suite.

**Surviving mutation:** removing only `changeVersion !== watch.changeVersion` from the early comparison at [local.ts:1004](/home/ccheever/sb4-intent/review-pq-r7-astra/snapback4/packages/snapback4/src/local.ts:1004) passes **352 tests** in the removal run. Evaluation checkpoints and the final publication comparison remain protective. This identifies overlapping coverage; I found no unsafe publication from that mutation. Removing the final comparison is detected.

The review worktree remains unchanged. No commit was made.

**READY**