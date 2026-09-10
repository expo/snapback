# snapback2: platform findings from the Clique rerun on 0.0.21 (astra + grok)

**Filed:** 2026-09-10 (orchestrator, wave 3 of the RFC implementation program)
**From:** `benchmarks/runs/2026-09-10-clique-ri-0.0.21/` — the astra scorer's notes, the M7 diary,
the day-2 brief diary and run log. Each is a builder-observed platform behavior; none is yet
reproduced in this repository.

1. **View-once descriptor omitted from durable snapshots.** The scorer's media note: "a platform
   defect stripped `oncePhoto` from durable snapshots" (M5 view-once refusal worked live; the
   durable query's snapshot lost the descriptor). Reproduce with a `image <=N once` column in a
   durable query and a cold reopen.
2. **Maintained-aggregate disagreement on durable queries.** M8: "durable queries returned zero
   maintained aggregates despite receipt guards, requiring authenticated transport" — the twin
   served a maintained count of zero before the server receipt arrived and the builder had to route
   around it ("Insights rendered local twin zero before server receipt (before=0 after=52)").
   LLP 1012's typed-zero completeness rule (a maintained value the client never held is `partial`,
   never zero) is the contract to check against this shape.
3. **A schedule/schema diagnostic** the run log names as a third platform finding (the diary:
   "binder-ID type diagnostic while trying to keep the count update rule narrowly expressed";
   "a text slice did not reduce the compiler's inferred bound") — the run record cites them as
   limitations with workarounds; reproduce from the M7 lane's schema.
4. **Group-route resolution over the first 20 memberships.** The day-2 brief's extra M7 run hit
   "a pre-existing first-20-memberships limitation in group-route resolution after repeated fixture
   creation"; fresh accounts pass. Likely the template's/app's `first 20` on a membership read;
   decide whether the guide should warn or the app shape should page.
5. **Day-two friction to weigh for LLP 1020's next round:** the global-search closure budget
   refusing a page of 20 after adding one nullable column (CR1: page 20 → 19), and the drain's
   ascending-append-only contract making a descending mutable list (pins) need a live query (CR2).

**From the grok wave** (the grok-4.6 scorer's notes, the build diary, the claude-opus-5 grader's
defect list; same run record):

6. **Live vs one-shot disagreement, second family.** The grok build's diary: "live `useQuery` for
   insights returned 0 while `createClient().query` returned 3" (M8), and the scorer names the same
   split for view-once photos, `groups.get`, and poll tallies (M5, M7). This is item 2's class
   (maintained-aggregate disagreement on durable queries) reproduced by a second builder on a
   second app shape; treat items 2 and 6 as one defect to find.
7. **Browser mutations through the IndexedDB range store hang while a bare token client commits
   in 50 ms** — the grok diary (M6, M8) and the scorer ("stalling mutations past 15 s forced a
   token-only aux client for online writes and the offline flush, including dual-Alice and
   m7-a05"). The dual-Alice shape (two browser contexts for one persona in one Playwright
   partition) is the known shared-storagePartition custody artifact — the follower tab waits on
   the writer — so check the harness partitions before filing this as a store defect; but a
   single-context mutation stalling past 15 s (m7-a05's offline vote flush, first run) is not
   explained by that artifact and needs a reproduction against the 0.0.21 web client.
8. **`E_ASSET_NOT_READY` for a consumed or deleted asset** (grader d-10, cosmetic): a raw fetch of
   a consumed view-once URL refuses with `{"code":"E_ASSET_NOT_READY","family":"input"}` — the
   refusal is right, the diagnostic reads as a transient staging state. Name the terminal case
   (consumed / deleted) with its own word or wording.
9. **Evidence for LLP 1019 D6** (no action): the grok build authored `purgeMessage` setting
   `tombstone: true` on expiry, and the grader's d-06 found an expired message left as a
   persistent "This message was deleted" bubble — the authored purge/tombstone pattern conflates
   expiry with delete-for-everyone. D6 removes that pattern from the template (native `removed`
   events; expiry is a direct deletion).

