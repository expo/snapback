# LLP 1018 panel review — gemini

**Change:** `llp/1018-structural-moves-to-surpass-convex.research.md`, the 2026-09-06 draft (uncommitted at review time; its revised form landed with this record).
**Reviewer:** Gemini 3.8 Flash (High) — Antigravity CLI `agy --model gemini-3.8-flash-high --effort high`.
**Orchestrator:** Claude Fable 5.1, session `session_01N6HHCXSkeacu8sJfsUH38L`, 2026-09-06/07.
**Provenance:** every review below was actually received from the named model; verbatim text per round. Round one was blind; round two showed each panelist all five round-one positions and the orchestrator's provisional decisions on the browser-tab policy and cap metering. Reviews are input to the orchestrator's decision (LLP 1018 §9), not verdicts on a code change.

| Round | Reviewed | Received |
|---|---|---|
| 1 | the draft, blind | yes |
| 2 | all five round-one positions plus the provisional decisions | yes |

## Round 1 (verbatim)

## Verdict on the thesis

The thesis—that Snapback 2's backend primitives are competitive while its composition and client-side plumbing remain the barrier to beating Convex on Clique—is strongly supported by the evidence. In the interim holistic score ([`score.md`](file:///Users/ccheever/projects/snapback/benchmarks/runs/2026-09-06-clique-improvement/evidence/astra-008-interim-holistic/score.md)), Snapback 0.0.8 beats Convex on authorization (92 vs 82), media assets (94 vs 76), and offline sync (68 vs 48), while remaining competitive on writes/transactions (89 vs 93) and background work (89 vs 88). However, Snapback loses decisively where developers assemble applications: client integration (63 vs 83), queries and live updates (65 vs 87), diagnostics and dev loop (65 vs 87), and scale/limits (58 vs 80).

Targeting "application-owned infrastructure removed" (hand-rolled inbox caches, custom indexers, subscription coordinators, permanent resume anchors, and recovery scripts) correctly identifies what punished builder velocity in M5, M6, and M8. However, this measure is necessary but incomplete. A system can eliminate application-owned infrastructure by moving the burden into restrictive compiler ceilings and leaky runtime abstractions, which merely shifts developer friction into diagnostic loops. The metric must be paired with **builder loop iterations to first green** (as codified in [`rules/NOT-DOING.md`](file:///Users/ccheever/projects/snapback/rules/NOT-DOING.md) under the loop bar: building M1–M3 in under 1,200 s with at most one Snapback-attributed correction loop). If a builder avoids writing an inbox cache only to spend three rounds working around uncertifiable multi-row inserts or opaque compiler collisions, Convex still wins.

---

## The four moves (keep / change / drop / add)

- **Move 1: One coherent reactive client — KEEP.**
  This directly attacks the 20-point deficit in client integration (63 vs 83) and queries/live (65 vs 87). The evidence ([`astra-008-interim-holistic/score.md`](file:///Users/ccheever/projects/snapback/benchmarks/runs/2026-09-06-clique-improvement/evidence/astra-008-interim-holistic/score.md)) explicitly cites SDK defects that forced builders to build an app-owned inbox cache, fresh time-dependent query workarounds, and a root resume anchor. 

- **Move 2: Efficient execution and certification that agree — KEEP.**
  The cap-metering ticket ([`issues/20260906-snapback2-cap-metering-makes-multi-row-inserts-uncertifiable-at-large-caps.md`](file:///Users/ccheever/projects/snapback/issues/20260906-snapback2-cap-metering-makes-multi-row-inserts-uncertifiable-at-large-caps.md)) proved that charging $N$ examined rows per inserted row forced a 50-member group creation to be fragmented into non-atomic 7-member chunks. When static certification fights ordinary data modeling, builders must write procedural compensation. Aligning execution strategies with certified cost bounds is essential.

- **Move 3: Quarry owns semantics and earns its learning cost — CHANGE.**
  Keep engine-maintained prefix search and symbol hygiene, but **drop** the proposal to build a new typed Quarry intermediate representation (IR) or replace the compiler lowering path. The evidence cited for this rewrite ([`issues/20260906-snapback2-quarry-operation-table-name-collision.md`](file:///Users/ccheever/projects/snapback/issues/20260906-snapback2-quarry-operation-table-name-collision.md)) was simply a naming collision in emitted TypeScript between a table import and an operation export (`reactions`), surfacing as `E_OPAQUE`. Rewriting the compiler lowering pipeline is a multi-week distraction; fixing identifier mangling in the TypeScript emitter takes a few hours. Furthermore, [`rules/NOT-DOING.md`](file:///Users/ccheever/projects/snapback/rules/NOT-DOING.md) explicitly forbids a plan algebra or a second authoring profile.

- **Move 4: Evolution of the whole application — DROP (DEFER).**
  The benchmark record across all three backends ([`score.md:183`](file:///Users/ccheever/projects/snapback/benchmarks/runs/2026-09-06-clique-improvement/evidence/astra-008-interim-holistic/score.md#L183)) confirms: "M7 was not run in any lane, so operations scores rely on observed seeding, schema changes or backfills, recovery and cleanup rather than assumed day-two migration results." Operations already scored 80 for Snapback. The survivor-uniqueness ticket ([`issues/20260906-snapback2-rebuilt-survivor-uniqueness.md`](file:///Users/ccheever/projects/snapback/issues/20260906-snapback2-rebuilt-survivor-uniqueness.md)) is an unverified static edge case. Spending bandwidth on theoretical three-generation migration traps while the active client runtime is broken squanders engineering leverage.

- **ADD: React query ergonomics and hook simplification.**
  The document overlooks why Convex scored 87 on Queries & Live while Snapback scored 65. In Convex, `useQuery` transparently delivers live, subscribed results. In Snapback, builders must grapple with `drain: true`, cursor pagination loops, watermark management, and outbox readiness states ([`snapback2/packages/snapback2/guide/offline.md`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/guide/offline.md)). The client needs a high-level React hook surface where log draining, catch-up, and live subscription tailing are handled seamlessly under the hood.

- **ADD: Hard budget adherence in client consolidation.**
  [`rules/RULES.md`](file:///Users/ccheever/projects/snapback/rules/RULES.md) enforces a strict 1,500-line source file limit. [`snapback2/packages/snapback2/src/client.ts`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/client.ts) currently sits at 1,491 lines (9 lines from violation). Concurrently, the offline local runtime gzip candidate reached 72,555 bytes against the 66,000-byte hard ceiling ([`rules/NOT-DOING.md:164`](file:///Users/ccheever/projects/snapback/rules/NOT-DOING.md#L164)). Any structural move on the client must delete redundant code rather than add new wrapping layers.

---

## Ordering and the first slice

Recommended execution order:
1. **Move 2 slice (Cap metering fix):** 1 day. High leverage, unblocks atomic relational writes.
2. **Move 1 (Client coherence & multi-tab coordination):** Core focus to eliminate app-owned sync infrastructure.
3. **Move 3 bounded fix (Quarry emitter hygiene & indexed search):** Resolves naming collisions without compiler overhaul.
4. **Move 4 (Application evolution):** Deferred until M1–M6 loop bar criteria are met.

### The Single Highest-Leverage First Slice (1 to 3 days)
Implement two tightly bounded, complementary fixes:
1. **Per-key cap check metering in `snapback2-core`:**
   Charge cap checks once per distinct partition key or against maintained count indexes rather than $N$ per inserted row ([`issues/20260906-snapback2-cap-metering-makes-multi-row-inserts-uncertifiable-at-large-caps.md`](file:///Users/ccheever/projects/snapback/issues/20260906-snapback2-cap-metering-makes-multi-row-inserts-uncertifiable-at-large-caps.md)). 
   *Builder impact:* Eliminates chunked 7-invitee group creation workarounds; allows group creation (49 members) to execute as a single, natural, atomic mutation.
2. **Leader-election tab coordination for the browser offline carrier:**
   Replace the fatal `E_OFFLINE_LOCK` refusal in [`snapback2/packages/snapback2/src/client-offline.ts:85`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/client-offline.ts#L85) with a Web Lock / BroadcastChannel leader-follower pattern. A primary tab holds the carrier and outbox, while secondary tabs proxy mutations and mirror queries.
   *Builder impact:* Removes the need for builders to partition databases per browser tab and write secondary-tab queue merge scripts ([`issues/20260906-snapback2-second-browser-tab-cannot-share-the-offline-carrier.md`](file:///Users/ccheever/projects/snapback/issues/20260906-snapback2-second-browser-tab-cannot-share-the-offline-carrier.md)).

---

## Move one: decomposition

The proposal identifies the right high-level goals (one transactional boundary, delivery identity, browser-tab policy, shared subscriptions), but the internal decomposition must avoid adding more coordination apparatus.

### Where Current Code Has the Right Shape
- **`RangeStore.commit(swap)`** ([`store/range-store.ts:296`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/store/range-store.ts#L296)): Atomic carrier swaps across rows, answers, receipts, evictions, and outbox settlements are sound and prevent partial on-disk state.
- **`DeliveryEnvelopeV1`** ([`llp/1012-local-first-v1.spec.md:975`](file:///Users/ccheever/projects/snapback/llp/1012-local-first-v1.spec.md#L975)): Server-certified receipts (ranges, absences, verdicts) provide exact authority proofs without requiring full relational database replication.
- **Grant-sliced deterministic IDs** ([`store/outbox.ts:52`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/store/outbox.ts#L52)): Slicing `s2id` blocks ensures optimistic client writes match server-minted IDs without ID-remapping layers.

### Where Current Code Fights Itself
1. **Fragmented state custody:**
   State transitions are split across [`client.ts`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/client.ts) (1,491 lines), [`client-offline.ts`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/client-offline.ts) (529 lines), [`offline.ts`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/offline.ts) (863 lines), [`drain.ts`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/drain.ts) (216 lines), and [`store/outbox.ts`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/store/outbox.ts) (411 lines). Each module maintains independent abort controllers, generation counters, and recovery promises. When an auth transition or network cut occurs, these layers can disagree on whether the store is sealed, open, or hydrating.
2. **Drain loops vs. query subscriptions:**
   [`drain.ts`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/drain.ts) implements an ad-hoc pagination state machine on top of standard subscriptions, manually advancing cursors and updating watermarks. Draining should be an internal concern of the query subscription manager, not an external wrapper.

### Recommended Clean Decomposition
- **Single Client Reducer:** Consolidate `OfflineRuntime`, `OutboxLedger`, and drain tracking into a unified event-driven state machine. All external inputs (SSE deliveries, mutation enqueues, network transitions, tab elections) feed one reducer that outputs store swaps and view updates.
- **Leader Tab with Thin Followers:** Do not implement complex multi-tab log merging. One tab acquires the Web Lock and runs the transport, outbox, and carrier; secondary tabs communicate over a `BroadcastChannel` port as thin reactive mirrors. When the leader closes, the next tab acquires the lock.

---

## Biggest risk and what to cut

1. **The Compiler IR Rewrite (Cut):**
   The biggest risk of wasted effort is embarking on an intermediate representation rewrite for Quarry. This would consume weeks of effort, introduce compiler regressions, and fail to move the Clique score. Cutting this to simple TypeScript emitter hygiene preserves velocity.
2. **Evolution & Rebuilt Survivor Uniqueness (Defer):**
   M7 was not run in any lane, and operations already scored 80. Debugging static rebuild anomalies ([`issues/20260906-snapback2-rebuilt-survivor-uniqueness.md`](file:///Users/ccheever/projects/snapback/issues/20260906-snapback2-rebuilt-survivor-uniqueness.md)) provides zero score leverage for the next run.
3. **Repository Line & Bundle Ceilings (Enforce):**
   With `client.ts` at 1,491 lines and gzip size at 72,555 bytes (over the 66,000 ceiling), any refactoring that adds adapter code without deleting legacy paths will trigger blocking check failures (`caps` and `measure.mjs`). Consolidation must be net-negative on line count and byte size.

---

## Corrections

1. **Clock Query Ticket Status:**
   Section 3 of LLP 1018 (lines 98–99) states: *"The clock query reproduction and its unlanded candidate verification are concrete starting points."* 
   **Correction:** This issue is already resolved and closed. As documented in [`issues/closed/20260906-snapback2-clock-query-delivery-identity.md:3`](file:///Users/ccheever/projects/snapback/issues/closed/20260906-snapback2-clock-query-delivery-identity.md#L3), it was repaired on `main` on 2026-09-07 by adding `DeliveryEnvelopeV1.readTime` to allow same-sequence clock re-evaluations, verified on Expo SQLite and Node file carriers.
2. **Author Attribution:**
   LLP 1018 §0 lists the author as *"Codex, commissioned by Charlie Cheever"*. The panel brief clarifies that Astra (gpt-6-astra) drafted the document.
3. **Date Discrepancy:**
   LLP 1018 §2 (line 64) cites checkpoint *"2026-09-07 00:33Z"* and published version 0.0.13, while the document header is dated 2026-09-06.
4. **Collision Root Cause:**
   LLP 1018 §5 presents the `reactions` collision as evidence that lowering through TypeScript requires a typed IR. The issue record ([`issues/20260906-snapback2-quarry-operation-table-name-collision.md`](file:///Users/ccheever/projects/snapback/issues/20260906-snapback2-quarry-operation-table-name-collision.md)) confirms it is an identifier collision in generated TypeScript (`E_OPAQUE: Individual declarations in merged declaration 'reactions' must be all exported or all local`), which can be solved with distinct generated symbol names without changing compiler architecture.

---

## Summary for the author

The thesis of LLP 1018 is correct: Snapback 2's backend primitives (authorization, media, offline sync, transactions) are already beating or matching Convex, but its fractured client runtime and punitive compiler metering impose heavy application-side plumbing that ruins developer experience. To surpass Convex on Clique, ruthlessly narrow scope: drop the speculative Quarry compiler IR rewrite in favor of simple symbol hygiene in the TypeScript emitter; defer whole-application evolution (Move 4) since M7 was never executed in any lane; and focus immediately on a 1-to-3-day first slice that fixes cap-metering multiplier charges on multi-row inserts and replaces multi-tab `E_OFFLINE_LOCK` failures with a leader-follower BroadcastChannel pattern. Then, consolidate the client runtime into a single state machine while actively deleting lines to bring `client.ts` well below 1,500 lines and compress the local bundle back under the 66,000-byte gzip ceiling.

## Round 2 (verbatim)

## (a) Tab policy — verdict and the sharpest objection

**Verdict: Reject the online-only follower mutation path; it is an architectural trap.**

Exposing mutations in a follower tab without an outbox creates severe correctness defects:

1. **FIFO & causality inversion:** In [`snapback2/packages/snapback2/src/client-outbox.ts:89`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/client-outbox.ts#L89), if `runtime` is undefined, `submitMutation` falls back to un-enveloped `plain()` HTTP POSTs. If Tab A is offline with queued intents $M_1, M_2$ in its durable outbox, and the user runs $M_3$ in online Tab B, $M_3$ hits the server immediately via `plain()`. When Tab A closes and Tab B takes over the Web Lock, Tab B drains $M_1, M_2$—landing earlier writes *after* later writes.
2. **Readiness & offline disparity:** In Tab B, `useOutbox().ready` is false ([`react-core.tsx:275`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/react-core.tsx#L275)). If connectivity drops, Tab A functions offline with held reads and queued writes, while Tab B shows blank screens (`no held answers`) and refuses writes with `E_NETWORK` ([`client-offline.ts:101`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/client-offline.ts#L101)). Upon leader close, Tab B jolts as IndexedDB opens and hydrates from scratch.
3. **Lock leakage across auth transitions:** In [`store/locks.ts:37`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/store/locks.ts#L37) and [`store/indexeddb.ts:195`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/store/indexeddb.ts#L195), `locks.request("snapback2:" + partition)` waits indefinitely. Without an `AbortSignal` tied to session teardown, switching users (Alice $\to$ Bob) in Tab B causes it to acquire Alice's lock once Tab A closes, opening Alice's partition and draining her queue while displaying Bob's UI.
4. **Leader crash vs. background freeze:** Browsers release Web Locks on process termination, but NOT when a background tab is throttled or frozen by the OS. A background leader permanently starves the foreground tab.

If BroadcastChannel command forwarding is deferred, follower tabs must be **strictly read-only** (subscribing online, refusing writes until lock acquisition), never un-enveloped writers.

## (b) Cap metering — verdict and the sharpest objection

**Verdict: Adopt the `maintain` probe, but account for the Twin's authority drop.**

Inside a server transaction, statement ordering **is exact**: in [`runner_ops.rs:23`](file:///Users/ccheever/projects/snapback/snapback2/crates/snapback2-core/src/engine/runner_ops.rs#L23), `check_constraints` probes the count before inserting the row, and line 48 calls `self.maintain(...)` synchronously before the next statement runs. Sequential inserts in one transaction see exact running increments.

**The sharpest objection is the Twin prediction cliff:**
In [`evaluator/runner.ts:758–763`](file:///Users/ccheever/projects/snapback/snapback2/packages/evaluator/src/runner.ts#L758-L763), evaluating a mutation against a maintained count without a held row triggers `this.partial.add("missing-authority")`. In `groupCreate` (49 invitees under `cap 1000 by principal`), the viewer (Alice) does not hold count rows or membership ranges for foreign principals. Under the fallback to scan/partial ([`runner.ts:871`](file:///Users/ccheever/projects/snapback/snapback2/packages/evaluator/src/runner.ts#L871)), `partial` is populated, so `OutboxLedger.enqueue` cannot predict the mutation (`predicted: false`, [`outbox.ts:350`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/store/outbox.ts#L350)). The server certifies and commits the write, but the client completely loses optimistic UI updates.

**Trade-offs & hazards:** Requiring `maintain <t> = count ...` mildly violates "one declaration supplying several guarantees" (LLP 1001 §1), but an engine-owned hidden count is worse: it silently imposes write-amplification and index maintenance on small caps (`cap 5`) where naive scans cost negligible budget. Successor migrations ([`successor.rs:502–508`](file:///Users/ccheever/projects/snapback/snapback2/crates/snapback2-core/src/successor.rs#L502-L508)) rebuild targets cleanly, though backfilling a new count on a populated table requires a blocking scan.

## One thing in another panelist's position that is wrong and matters

Claude (`r1/claude/final.md:46–50`), Grok (`r1/grok/log.txt:37`), and Gemini (`r1/gemini/log.txt:41–43`) all asserted that charging $N$ "once per distinct `(table, key)`" fixes the 49-row `groupCreate` benchmark. **This is mathematically false.** In `groupCreate`, 49 distinct invitees are inserted under `cap 1000 by principal`. That is 49 *distinct* cap keys. Charging $N$ per distinct key meters $49 \times 1{,}000 = 49{,}000$ examined rows, vastly exceeding the 10,240 ceiling ([`certificate.rs:34`](file:///Users/ccheever/projects/snapback/snapback2/crates/snapback2-core/src/certificate.rs#L34)). Per-distinct-key charging fails to certify the benchmark.

## Anything that should change my direction (or "nothing")

1. **Change Tab Policy:** Disallow un-enveloped `plain()` writes in follower tabs. Make followers read-only until lock takeover, and pass an `AbortSignal` to `locks.request` in [`store/locks.ts:37`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/store/locks.ts#L37) to abort waiting on auth change.
2. **Accept Twin Unpredicted Writes:** Document that multi-principal batch writes under `maintain` will certify and commit on the server but run unpredicted (`predicted: false`) in the client Twin due to unheld foreign authority.
3. **Respect File Budgets:** [`client.ts`](file:///Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/client.ts) has 1,491 lines ([`rules/RULES.md:20`](file:///Users/ccheever/projects/snapback/rules/RULES.md#L20) limit is 1,500). Tab and cap logic must delete existing coordination code to avoid tripping blocking line-count caps.
