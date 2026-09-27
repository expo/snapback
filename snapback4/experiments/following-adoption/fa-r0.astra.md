The core finding is right, and “start this feed now” is a sound contract. Two liveness assumptions need correction before this design is ready.

`E_TIMELINE_ACTIVATE` prevents a reconstruction from inventing event identities, admission order, delivery progress and cleanup history. The RFC correctly qualifies the diagnostic: existing declaration-specific slots preserve live repost identities, but those slots do not recover the rest of the history. Device acquisition history is a separate boundary; adoption must invalidate acquisition, not reconstruct its old floor.

The §6 counterexamples are real for the alternatives stated. Two qualifications matter: copying every retained event is a different, more expensive product contract rather than inherently incorrect; and the cross-incarnation identity counterexample concerns reuse that the proposed first-use namespace restriction already excludes. Incarnation-salted identities remain a sensible precaution.

I found no disclosure counterexample under the retained public-source prerequisites. Source metadata is public; inboxes and reader work remain private. The epoch, birth-token and tombstone checks prevent adoption work from copying through an unfollow, resurrecting a removed event, or confusing a recreated repost with its predecessor. Filling slots before publication and requiring a fresh namespace correctly address stale device images.

The proposed atomic publication and cursor/copy commits also form a coherent crash-safety argument: before publication, readers cannot interpret missing work as completion; afterward, pending or parked work keeps the affected reader incomplete. That argument remains untested at the actual publication boundary.

1. **High — The existing scheduler does not guarantee adoption progress.**  
   Location: RFC §4, particularly “existing fair work scheduler” and the termination claim; [work.rs:149](/home/ccheever/sb4-intent/review-fa-r0-astra/snapback4/crates/snapback4-core/src/engine/timeline/work.rs:149).

   Every worker invocation starts with the first declaration and returns after processing its first pending task. Suppose an existing declaration continuously has pending delivery, while the newly adopted declaration comes second. The latter receives no chunks: its frozen roster is finite, but its readers remain incomplete indefinitely. The FIFO engine mutex provides fairness between lock holders, not between declarations.

   **Smallest fix:** require round-robin selection across nonempty declarations and bounded progress for adoption alongside ordinary delivery and cleanup. Add a regression with an earlier declaration continuously replenishing work while a later adoption finishes. Qualify the termination argument with this scheduling guarantee.

2. **Medium — Releasing the writer lock does not preserve admission for independent operations.**  
   Location: [RFC §4:203](/home/ccheever/sb4-intent/review-fa-r0-astra/llp/3000.026-following-over-a-populated-store.rfc.md:203); [serve.rs:376](/home/ccheever/sb4-intent/review-fa-r0-astra/snapback4/crates/snapback4/src/serve.rs:376), especially dispatch at line 405.

   Thirty-two application mutations waiting behind the fence can occupy the entire `Mutation` request budget. Authentication writes, ephemeral mutations and mutation retries seeking an existing receipt use that same budget and are aborted before reaching the supposedly permitted execution path. `/changes` has a separate wait budget, so it should not be included in this particular counterexample.

   There is also an implementation trap around background work: a fenced job must be skipped or deferred, rather than synchronously waiting inside the maintenance loop that must advance initialization.

   **Smallest fix:** explicitly separate fence-wait admission from independently executable requests; preserve bounded capacity for identity, ephemeral operations and authenticated receipt replay. Specify that blocked maintenance releases its turn without waiting. Test these paths with a saturated fence queue and a parked candidate.

3. **Low — The historical comparison omits newly appearing old events.**  
   Location: [RFC §3:180](/home/ccheever/sb4-intent/review-fa-r0-astra/llp/3000.026-following-over-a-populated-store.rfc.md:180).

   Adoption can add events that a hypothetical continuously materialized feed never delivered. Example: an actor has 2,000 posts; a reader follows and receives the newest 1,000. After those 1,000 originals are removed, the historical inbox is empty. Fresh adoption copies the older 1,000 still-live posts.

   This is acceptable for “start now,” but applications can notice more than missing history and changed repost keys.

   **Smallest fix:** document this example alongside the losses. Also state plainly that concurrent removals distinguish adoption from ordinary live backfill: ordinary backfill can reach older replacements, whereas the frozen launch window deliberately does not refill.

4. **Medium — The measurements support construction feasibility, not an acceptable live adoption pause.**  
   Location: RFC §5; [experiment README:46](/home/ccheever/sb4-intent/review-fa-r0-astra/snapback4/experiments/following-adoption/README.md:46).

   The 127.835 s and 1,699.416 s figures are credible as single construction samples. Counts are checked independently, process accounting corroborates elapsed time, and the record candidly limits the heap estimate.

   Their availability coverage is narrow: source reads access a separate frozen database; candidate reads repeatedly query one reader through detached connections. There is no application write traffic, HTTP authentication, shaped-card workload or publication handoff. Scaling principals along with events preserves roughly the same per-actor history and per-reader follow count; it does not exercise a hot actor or heavily connected reader. The 10× candidate also occupies **11.54 GB**, making peak staging/WAL space and reclamation material.

   **Smallest fix:** retain these numbers with their existing qualifications, then measure the actual initialization pause, queued-write latency, signed-in reads, background delivery delay, peak disk usage and publication recovery on a skewed fixture. Do not infer initialization latency from the current phase subtotals.

The newest-1,000-per-follow window is a reasonable default for a genuinely new social feed: it preserves the established admission allowance and bounds initial foreign copies per edge. Applications using feed identities for notifications, saved positions or historical reconciliation will notice the differences and need a separate import contract. Own-event retention and the device’s merged 1,000-copy acquisition floor should remain distinct.

Show the planned query immediately in the feeds card and refusal guidance. It is sufficient for smaller or sufficiently dense workloads, but the evidence does not establish that it serves **most** builders. The reproduced 9,000-unrelated-row case returns unavailable with no continuation, so it is not a general escape hatch for a live social product. Adoption should wait for the liveness corrections and integrated evidence; the documentation improvement should not wait.

For the five open questions:

| Question | Recommendation |
|---|---|
| **1. Launch window** | Accept 1,000 per existing follow, including pruning without refill. Document both lost historical deliveries and newly included older events. |
| **2. Initialization fence** | Accept in principle, contingent on measuring its actual pause and fixing admission isolation. Fully online initialization can remain separate work. |
| **3. Grandfather retained reposts** | Accept: it follows the authored unfiltered repost branch and public-card contract. Refuse orphan/self-follow input with table/count summaries and bounded operator-only details; never silently omit it. |
| **4. Catalog publication** | Not established by this probe. Build a focused publication/recovery prototype covering the RFC’s listed cases, plus saturated admission and multi-declaration scheduling, before enabling adoption. |
| **5. Birth records directly `done`** | Accept. Retained births precede adopted edges, so adoption backfill owns their foreign copies. Commit birth records with their initialization progress, preserve normal authority/meters, and test later follows and removal/id reuse. |

I reran the three in-memory research tests from the existing executable; all passed. I did not rerun file-writing crash tests or benchmarks. The worktree remains unchanged.

**Verdict: NOT READY.**