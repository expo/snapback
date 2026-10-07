**APPROVE WITH CHANGES.** The resumable per-author merge is a sound direction. I recommend using it **from the first online Following page**, with SDK-owned continuation, instead of making option A the ordinary feed experience.

The [detailed review](/home/ccheever/sb4-intent/reviews/fh-d0.astra.evidence/REVIEW.md) includes findings against the pinned code and the required contract changes.

1. **§9 is sound algorithmically, but its protocol needs tightening.**

   The prefix argument holds: establish every eligible lane’s head or end, select the greatest `(at, eventId)`, and finish that lane’s refill before selecting another head. Immutable ordering, engine-birth fencing and graph-revision invalidation support that argument. The report accurately distinguishes this from the existing source-filtering merge.

   Required changes before coding:

   - **Authorization and revisions:** Capture roster/revision/B consistently, then recheck authority in the publication transaction. Specify block direction, negative dependencies, original-author blocking through reposts, and same-transaction unfollow/refollow. Avoid restarting on every unrelated store commit. Birth witnesses currently live in actor-private delivery `Work` rows; accessing them needs narrow internal authority and lawful accounting.
   - **Deletion and publication:** Define removal of buffered heads and staged rows, including deletion of the final staged row or the entire page. Revalidate and shape fresh cards at publication. Removing an original must preserve the independent repost behavior that existing code implements.
   - **Replay:** Atomic checkpointing alone is insufficient. Preserve page identity and successor without consuming again. Reauthorize retries; if the previously selected page cannot be returned safely, reset or supersede it explicitly. Do not silently replace an old token’s page with newly selected events. Define acknowledgements, stale tokens after payload reclamation, concurrent advances and reordered responses.
   - **Disclosure:** Hiding rejection counts is necessary but insufficient. Preparation-round counts, ready/preparing transitions, refusal details and exposed revisions can also disclose hidden work. Specify permitted observables and use the existing public-reservation/private-accounting separation. Respect the documented paging residual without introducing an unspecified new progress oracle.
   - **Custody and bounds:** Specify actual storage quotas, TTL, cancellation, bounded cleanup and ownership across tabs/devices. “One active traversal per reader/declaration” must not let two consumers evict each other or consume each other’s pages. Charge frontier updates, final validation, retry storage and checkpoint work; count abandoned state until reclaimed.

   The draft correctly acknowledges that a finite birth domain does **not** guarantee termination under continuous adversarial backdating. Also define live refresh: a birth after B may belong inside an already displayed range. The SDK must refresh/reconcile that epoch or mark it stale; it cannot silently call the old epoch currently complete.

2. **Prefer exact-first online reading: B’s prefix guarantee without traversing all history first.**

   Open every eligible author lane and establish one head or end. If setup, shaping and checkpointing fit the actual request meters, return the first page immediately. Otherwise resume the same state machine. Preserve its frontier for subsequent pages.

   This needs O(F) setup, **not a complete historical scan before first display**. Small follow sets can finish in one request; small sets with expensive rejection/shaping may still require preparation.

   | Choice | Assessment |
   |---|---|
   | **A: inbox, then restart from the top** | Correct as a labeled recovery mode. Poor default: missing events appear above an anchor the user has already passed. |
   | **B: establish coverage before publishing** | Correct direction. Prove the requested prefix; do not require materializing all history. |
   | **Exact merge from first online page** | Recommended initial design. One reader and one correctness argument eliminate the inbox/history seam. |
   | **Certified “complete down to” boundary** | Possible later optimization, but requires coverage evidence for every lane plus graph/birth/delivery fencing. |

   The boundary alternative must stop publishing inbox rows below its proven boundary. Pending delivery, backfill, new follows, tied keys and backdated births all matter. The oldest inbox row supplies none of that proof. Maintaining this certificate adds implementation risk before its performance benefit has been established.

3. **The engine and SDK should own the handoff; the application should not.**

   The engine owns authorization, ordering and continuation. The SDK owns preparation, retries, resets, cancellation, event identity, reconciliation and withdrawal of accumulated results.

   A Following-specific SDK controller/hook is a reasonable first implementation. Extending `usePage` is also possible through explicit generated capability metadata, but today’s implementation cannot simply absorb this protocol: it observes ordinary cursor pages independently, preserves first display positions when deduplicating, and ANDs their completeness bits. It also needs a defined way to revalidate older mounted pages after their replay payloads have been reclaimed.

   The builder should author one Following selection and card projection. They should never translate cursors, compose a second history query or determine whether a gap was repaired.

   Protocol machinery can be invisible. Loading, offline withholding, expiry and refresh remain real states. Preserving pixel position requires cooperation with the list/virtualizer; a data hook alone cannot guarantee that universally.

4. **Keep §9.5’s matrix, and strengthen these acceptance conditions.**

   The existing oracle, mutation, tied-ordering, large-roster and meter-cut cases are appropriate. Add or make explicit:

   - Assert **every published page is a correct prefix**, not merely that eventual drainage produces the right set.
   - Interleave mutations before publication and replay, including original removal with surviving reposts, blocked original authors, negative visibility probes and edge/event reincarnation.
   - Test forged and cross-viewer/store/declaration/argument tokens, lost replies and acknowledgements, expired replay state, concurrent consumers and obsolete SDK responses.
   - Compare paired worlds across progress states, tokens, refusals and public meters, explicitly identifying any permitted disclosure residual.
   - Exercise final publication costs, indivisible shapes, all-empty/all-rejected lanes, storage exhaustion, cancellation storms, reclaim accounting and fairness under concurrent load.
   - Prove one-query SDK journeys through exhaustion, live refresh, backdated arrival, expiry, reconnect and revocation of older mounted pages, preserving pending-prediction and own-edge fences.
   - Measure first displayed page, preparation requests, later-page latency, total work and storage/reclamation—not just engine metadata-query latency.

   Require independence from scanning unrelated authors’ posts. Do **not** require identical physical I/O or latency as the overall B-tree grows.

   Keep compatibility and release checks. Device-local traversal parity is unnecessary for a server-only implementation; client routing and withholding tests remain necessary. Universal completion under endless backdating is unnecessary unless the design adds the storage mechanism needed to promise it.

5. **Yes: cut device traversal from the first implementation.**

   Ship server-only exact traversal with SDK integration, honest offline withholding and existing pending-intent fences. Defer device frontiers, retained index snapshots, inbox coverage certificates, general private sources and a general resumable-query framework.

   A server reader alone is a useful internal milestone. The product goal is complete only when the SDK and paved authoring surface remove builder-owned handoff work.

I reran all three existing research cases: **3 passed, 0 failed**, reproducing the sparse failure, 8,200-follow opening failure and handoff counterexample. [Verification evidence](/home/ccheever/sb4-intent/reviews/fh-d0.astra.evidence/verification.json) is retained outside the disposable checkout. This qualifies the diagnosis, not the proposed reader. Work stayed on eb1000; no lane files changed and nothing was pushed.