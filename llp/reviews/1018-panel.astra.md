# LLP 1018 panel review — astra

**Change:** `llp/1018-structural-moves-to-surpass-convex.research.md`, the 2026-09-06 draft (uncommitted at review time; its revised form landed with this record).
**Reviewer:** Astra — codex `gpt-6-astra`, reasoning xhigh, read-only sandbox; the document's drafter.
**Orchestrator:** Claude Fable 5.1, session `session_01N6HHCXSkeacu8sJfsUH38L`, 2026-09-06/07.
**Provenance:** every review below was actually received from the named model; verbatim text per round. Round one was blind; round two showed each panelist all five round-one positions and the orchestrator's provisional decisions on the browser-tab policy and cap metering. Reviews are input to the orchestrator's decision (LLP 1018 §9), not verdicts on a code change.

| Round | Reviewed | Received |
|---|---|---|
| 1 | the draft, blind | yes |
| 2 | all five round-one positions plus the provisional decisions | yes |

## Round 1 (verbatim)

## Verdict on the thesis

**Keep the thesis, but make “reliable composition” the target.** Application-owned infrastructure removed is a useful architectural measure: it distinguishes a platform capability from a primitive that requires another synchronization system around it. Count responsibilities removed, rather than lines deleted.

The evidence supports this direction. Snapback’s authority, media, and offline mechanisms compare favorably, while confirmed delivery and recovery defects forced architectural workarounds. However, that establishes a combination of **correctness defects and integration friction**, not that the underlying architecture needs wholesale replacement. [The scored narratives](/Users/ccheever/projects/snapback/benchmarks/runs/2026-09-06-clique-improvement/evidence/astra-008-interim-holistic/score.md) support the opportunity more strongly than any particular redesign.

Add two measures using existing benchmark records:

- Fresh-builder time and Snapback-attributed correction loops to accepted behavior.
- Complete acceptance and scale evidence, including native offline and M7.

These prevent “less application code” from hiding fragile behavior. Also prioritize the remaining scale failures collectively: under the [rubric](/Users/ccheever/projects/snapback/benchmarks/briefs/social-messenger.md:839), one failed degradation predicate keeps O5 at 30 unless an earlier zero condition applies. Fixing the feed alone cannot lift that band.

## The four moves (keep / change / drop / add)

- **Client coherence — keep, narrow.** This is the strongest investment. Define the change around observable transitions—enqueue, delivery, revocation, restart, reconnect—and the application workaround each transition currently requires. “One ownership boundary” should strengthen existing machinery.
- **Execution and certification — keep.** The cap ticket gives an unusually concrete target: restore atomic 50-member group creation by changing actual cap enforcement and its accounting together. Maintained counts must account for their own writes, rollback, and successor initialization. Query composition also belongs here: one enriched message page can remove many distinct subscriptions that deduplication cannot.
- **Quarry semantics — change.** Separate language correctness and diagnostics from compiler architecture. Repair binding hygiene and authored source locations immediately. A typed intermediate representation remains a hypothesis requiring several demonstrated failure classes or substantial machinery deletion. One name collision does not justify a compiler replacement. Keep `fn` deferred.
- **Whole-application evolution — keep, evidence-led.** Run M7 with the existing operator tools before commissioning a larger migration framework. Investigate the survivor-uniqueness defect promptly as a correctness repair; it should not wait for the evolution tranche.

**Add diagnostics and recipe quality as work across all four moves.** The 65-versus-87 diagnostics gap deserves immediate attention. There is fresh supporting evidence: [guide/live-query.md](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/guide/live-query.md) opens with TypeScript backend authoring despite Quarry being the sole language. Correct the existing compact recipes and diagnostic rewrites; this needs no documentation platform.

## Ordering and the first slice

Keep the broad investment order, but not as a serial pipeline. Finish already-authorized search and publish qualified repairs while developing client coherence. Compiler hygiene and actionable diagnostics should start alongside it.

**My first one-to-three-day slice: a shared, observable query entry in the headless client, updated by committed local changes.**

For existing supported query shapes, each authority/program/query/argument identity should own one subscription and one current snapshot. React consumers observe that entry. Durable prediction, settlement, and eviction notify affected entries after commit. Closing one consumer releases its reference without disturbing another.

The builder-visible witness is concrete: two components observe the same thread; an offline send appears through that query without application cache merging or corrective polling; removing one component leaves the other working; reconnect settles the same message identity.

This removes duplicate subscription coordination and a central reason to build separate pending/live/held views. It does not eliminate the legitimate need to render an unpredicted intent from its arguments when coverage is insufficient.

## Move one: decomposition

**The current code already has much of the right foundation.**

[PersistentRangeStore.commit](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/store/range-store.ts:752) prepares a swap, persists it, then publishes state. Its swap includes coverage, outbox, overlays, and retirement. [OutboxLedger.enqueue](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/store/outbox.ts:295) commits grant consumption, intent, and prediction together. [OfflineRuntime.commitMany](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/offline.ts:501) already combines deliveries and settlements. Preserve these boundaries.

I would decompose the remaining work into four responsibilities:

1. **One committed local revision.** Coverage, effective rows, overlays, and query evaluation must refer to a consistent snapshot. This revision differs from server sequence: enqueue changes local state without a server commit. Currently [Twin.hydrate](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/twin.ts:228) reads coverage, overlays, and entries separately and constructs a new evaluator store. Coverage-changing commits also clone the retained state. Consolidate snapshot access and reuse the authorized indexed-twin work; adding another retained cache would fight the resource goal.

2. **Shared query ownership above transport.** [live.ts](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/live.ts) already multiplexes one physical SSE connection. The missing sharing is logical: [client.ts](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/client.ts:370) creates a new reconnecting subscription for every caller. Its `mounted` map uses one entry per query key, but closing either duplicate deletes that entry. Meanwhile [react-core.tsx](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/react-core.tsx:171) keeps a reducer per hook. A reference-counted query entry addresses this mismatch. These are static code observations, not newly reproduced failures.

3. **Recovery owned by the client lifecycle.** Persist the intended synchronization query independently of component mounting. Today [tailWatermark](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/store/range-store.ts:583) selects the first recorded drain. That makes an incidental ordering decision load-bearing. Preserve the distinction between ascending synchronization logs and descending display queries; silently treating the latter as logs would violate the [offline contract](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/guide/offline.md).

4. **One browser carrier owner, with thin followers.** I favor a leader holding the existing writer lock, accepting commands, and publishing query results. A queued acknowledgment must follow durable admission; takeover must reload committed custody and preserve retry identity. Followers should not each mirror the entire retained database. This deserves a separate bounded design, particularly for account transitions and leader loss.

I would not introduce a durable universal event log. An internal reducer over committed revisions may simplify implementation; another persisted history adds recovery and retention obligations. Clock-dependent delivery identity is necessary, but its repair now exists.

## Biggest risk and what to cut

The greatest risk is turning observed integration defects into three simultaneous rewrites: client storage, compiler lowering, and application evolution.

The [R8 report](/Users/ccheever/projects/snapback/benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-full-r8-review/astra/REPORT.md:65) records 72,555 gzip bytes against 66,000, missed movement deadlines, and pending realistic resident-memory evidence. Another coordination layer can remove application code while increasing package complexity and memory.

Cut or defer the direct compiler replacement, generic helpers, universal event logging, and broad migration machinery. Do not spend the first slice solving full browser leadership and all query dependencies simultaneously.

Respect [the rules](/Users/ccheever/projects/snapback/rules/RULES.md): delete superseded machinery, keep the existing checks and loop budgets, and do not finance coherence by quietly expanding deferred offline scope.

## Corrections

**Correction:** LLP 1018 §3 links an open clock-delivery ticket and describes unlanded verification. The ticket now lives under [issues/closed/](/Users/ccheever/projects/snapback/issues/closed/20260906-snapback2-clock-query-delivery-identity.md) and records a main repair dated September 7 UTC, including native verification. It states that published 0.0.13 does not contain the repair. Treat this as publication/qualification follow-through, not unimplemented design.

**Clarification:** Atomic store swaps and physical subscription multiplexing already exist. LLP 1018 should identify their remaining integration gaps explicitly.

I did not independently reproduce the tickets, inspect the candidate branches, or run builds or tests.

## Summary for the author (one paragraph)

Build a client-owned reactive query lifecycle first, using the existing transactional store and indexed-twin direction. Make held reads, predictions, settlements, and live deliveries update ordinary consumers without application synchronization code. Repair diagnostics immediately, restore natural atomic transactions through honest execution improvements, and finish search qualification. Keep compiler replacement and broad evolution machinery conditional on stronger evidence. Judge success by a fresh builder completing Clique with fewer correction loops and fewer infrastructure responsibilities, under the existing correctness and resource constraints.

## Round 2 (verbatim)

## (a) Tab policy — verdict and the sharpest objection

**Accept the restricted behavior; reject the “one flag, zero bytes” estimate.** Online-only until takeover is honest if readiness exposes that restriction before the user attempts an offline write.

The sharpest objection is **account custody while waiting**. [LLP 1012](/Users/ccheever/projects/snapback/llp/1012-local-first-v1.spec.md:322) promises wiping on sign-out/replacement. A follower owns no partition, and [OfflineRuntime.wipe](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/offline.ts:358) returns without wiping when none is open. Cancelling Alice’s waiter when switching to Bob prevents late acquisition; it does not erase Alice’s shared partition. Explicitly settle whether follower logout affects the shared store. Preserving the existing wipe promise requires additional coordination or a durable deferred action.

The implementation needs these boundaries:

- **Separate online readiness from acquisition.** [Client startup and query](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/client.ts:198) await partition opening. Simply waiting on the lock stalls ordinary queries. The browser’s actual lock request is separately implemented in [indexeddb.ts](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/store/indexeddb.ts:186), not just `store/locks.ts`.
- **Cancel and fence acquisition.** Logout, replacement, close, and discarded StrictMode clients must cancel pending requests; callbacks must recheck identity and lifetime after acquisition. [Runtime close](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/offline.ts:373) currently waits behind opening. A queued close cannot itself cancel an indefinitely waiting open.
- **Separate online sending from durable readiness.** [Outbox status](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/client-outbox.ts:320) currently reports `ready:true`, `remaining:0` without an open partition; [both hooks](/Users/ccheever/projects/snapback/snapback2/packages/snapback2/src/react-core.tsx:269) consume that status. A follower needs explicit unavailable custody, with the leader’s queue count unknown. Never report “queued” without persistence or re-enqueue an uncertain online write upon takeover.
- **Distinguish termination from unresponsiveness.** Close/crash takeover is the [Web Locks design](https://www.w3.org/TR/web-locks/#termination-section); waiting supplies no deadline for a hung holder. Reload committed state and revalidate authority before replay.

This removes separate databases by allowing only one durable queue. It does **not** satisfy LLP 1018’s existing “both queues” criterion; rewrite that criterion.

## (b) Cap metering — verdict and the sharpest objection

**Approve explicit maintained counts for this slice.** Another declaration is a reasonable optimization contract; hidden counts would introduce additional storage and lifecycle obligations.

The engine’s ordering supports exact probes: [runner_ops.rs](/Users/ccheever/projects/snapback/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:15) checks constraints, writes the source, then updates aggregates before returning. Thus the probe sees the count **before this write, including earlier writes in the transaction**. Refuse an insertion/group move when that destination count is already `>= cap`; skip group-preserving updates. Keep maintenance costs separate from the one-row probe.

The sharpest objection is **“held count” must mean authoritative count, not merely a present row**. In the [twin](/Users/ccheever/projects/snapback/snapback2/packages/evaluator/src/runner.ts:750), an absent aggregate starts at zero only with an absence proof. Preserve that distinction and transaction-local aggregate updates. Its [existing cap fallback](/Users/ccheever/projects/snapback/snapback2/packages/evaluator/src/runner.ts:847) requires complete range coverage for certainty. Reconcile its potentially N-row work with the one-row cost claim; missing coverage must remain partial.

Successor admission should retain its [base-row validation before rebuild](/Users/ccheever/projects/snapback/snapback2/crates/snapback2-core/src/successor.rs:271). Also, [rebuild preserves ordinary target survivors](/Users/ccheever/projects/snapback/snapback2/crates/snapback2-core/src/engine/mod.rs:961): challenge a surviving row at a future aggregate key for an empty group. Establish count provenance before trusting it. Rebuild and recertification must accompany changes to the maintained declaration.

## One thing in another panelist’s position that is wrong and matters

Gemini dismisses rebuild anomalies as having “zero score leverage.” Once maintained rows enforce caps, rebuild correctness becomes a dependency of this immediate slice. It cannot all wait for M7.

## Anything that should change my direction (or "nothing")

Keep the direction. Resolve follower sign-out semantics before calling the tab policy complete, and include successor count provenance in cap qualification.

I did not check runtime reproductions, browser crash/StrictMode behavior, or the implementation branches now underway.
