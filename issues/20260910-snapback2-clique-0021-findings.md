# snapback2: platform findings from the Clique rerun on 0.0.21 (astra)

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
