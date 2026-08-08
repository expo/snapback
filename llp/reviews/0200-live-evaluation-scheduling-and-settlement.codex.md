# Reviews — LLP 0200 (Codex family)

## Round 1 — 2026-08-08 — full review, no lens

**Provenance:** codex exec, model gpt-5.6-sol, reasoning effort xhigh,
read-only sandbox, capsule-only (structurally blind — capsule excludes
`llp/reviews/0200*`, run journal, orchestrator notes). Target revision
d2fa426f57eba385 (Status flipped Draft→Review at loop start). Capsule
sha256-vector hash 21ef90c1d52f14b8 (same 8-file capsule as the Claude
family). Review received and recorded verbatim below.

---

1. `severity:` MATERIAL  
   `section:` §2.3–§2.5  
   `concern:` The authorization split drops LLP 0008’s negative-delivery invariant. Data-driven auth refreshes are made cancellable and coalescible exactly like ordinary replacements, but LLP 0008 requires any auth-scoped removal or potential shrink to remain a witnessed, level-triggered obligation until revision-bound ACK or authenticated retirement. A usable resolution ticket does not replace that durable obligation. Cancellation must transfer the obligation to a provably subsuming delivery; a newer version alone is insufficient.

2. `severity:` MATERIAL  
   `section:` §2.2–§2.3  
   `concern:` The claimed absorption of LLP 0008 omits two correctness exclusions: refresh signals must run inline and supersede pending frames, and a subscription resynced while changes are pending must flush through replacement because its newer membership makes delta classification unsafe. The target’s general latest-value rule and cancellation contract preserve neither requirement, permitting stale-membership deltas or loss of a required refresh.

3. `severity:` MATERIAL  
   `section:` §2.5  
   `concern:` Degrading an over-limit subscription to “resync-on-reconnect” can leave a slow but connected client stale indefinitely, contradicting both the target’s convergence/fairness claim and LLP 0008’s recoverable-limit contract. This is security-relevant when the omitted state is a shrink. Bound exhaustion must trigger an immediate fail-closed resnapshot/sentinel, authenticated retirement, or forced reconnect—not wait for a reconnect that may never occur.

4. `severity:` MATERIAL  
   `section:` §2.4–§2.5, OQ-4  
   `concern:` “Authority transitions are never delayed behind data evaluation” is incompatible with best-effort cancellation only at handler-turn boundaries and no VM preemption. The spike measured evaluations up to 3.6 seconds, and OQ-1 explicitly identifies a single-threaded owner profile. The Spec must define whether authority work has a separate execution lane or may wait for one bounded non-preemptible turn, and must set the revocation bound before implementation rather than choosing a p95 target during Phase 2.

5. `severity:` MATERIAL  
   `section:` §5 Phases 1–2  
   `concern:` The first two phases are not safely separable in the stated order. The evidence says the current authorization lane conflates ordinary data refreshes with true authority transitions for every sessions-mode subscription. Phase 1 therefore cannot move that fan-out off-turn while preserving inline revocation unless it already performs the Phase-2 classification; leaving the lane inline preserves the measured settlement coupling and defeats H-1. The split must precede or land atomically with settlement isolation.

6. `severity:` MATERIAL  
   `section:` §2.1, OQ-2, OQ-5  
   `concern:` The unconditional claim that settlement may precede delivery is not adequately guarded by post-decision audits. LLP 0012/0043/0070/0093 are absent, yet they own the load-bearing session, ordering, `runAfter`, and client behavior being asserted. The included LLP 0008 proves that versions are carried on durable envelopes, but not that the mutation response exposes or installs the committed bookmark before fan-out. Phase 1 must be gated on these audits and explicitly require the causal-version handoff needed for read-your-writes; any carve-out must be resolved in the contract before landing.

7. `severity:` MATERIAL  
   `section:` §2.2, OQ-3  
   `concern:` Evaluation at exactly the frame’s version while later commits proceed is an unresolved feasibility decision, not merely an implementation detail. The capsule establishes a read-during-write lane, but not the ability to open an arbitrary historical SQLite snapshot after a queued frame waits. Pinning every frame’s snapshot could retain WAL state without bound; reading current state would violate the stated version contract. OQ-3 must decide the snapshot/version model and its resource bound before §2.2 is implementable.

8. `severity:` MATERIAL  
   `section:` §2.2, §2.5, §4 H-4  
   `concern:` The target says LLP 0008’s starvation bounds carry over unchanged, but those bounds relied on the fair-FIFO global writer lock and an inline flush on a later commit—the mechanism this Spec removes. “Fair,” “scheduler share,” and “no starvation-bound violations” define no replacement maximum wait or service rule, so convergence is not actually bounded and H-4 is not falsifiable. The off-turn scheduler needs its own explicit service and hold bounds.

9. `severity:` minor  
   `section:` §3–§5  
   `concern:` Observability is internally mis-sequenced: §3 says the permanent counters land in the Spec’s first landing, while Phase 4 lands observability after three phases whose A/B claims require those counters. H-2 also uses the non-falsifiable phrase “approaches write-path capacity,” and H-3 targets convergence “under” a quantity it calls an evaluation floor. The counters should land with Phase 1 and the hypotheses should use numeric, internally consistent thresholds.

10. `severity:` minor  
    `section:` §2.1, §2.6  
    `concern:` Two lifecycle edges are underspecified. Commit-free refusals cannot “follow commit-ack,” so they need a distinct terminal path in the milestone model. Likewise, resubscription is a request rather than proof sufficient to exit quarantine; LLP 0008 requires a fresh authorized snapshot, so recovery must remain quarantined until a valid resolution ticket or equivalent authority proof is accepted.

Overall assessment: The Spec correctly identifies settlement isolation, auth-lane classification, cancellation, and quarantine churn as the right architectural seam, and its measured prioritization is strong. It is not yet safe to implement, however: the latest-value contract loses existing negative-delivery obligations and refresh/resync exclusions, the revocation guarantee conflicts with the execution model, the first two phases cannot land independently, and the snapshot, causal-version, and scheduler-bound contracts remain unresolved in ways that can change §2’s decisions.

VERDICT: NOT READY

## Round 2 — 2026-08-08 — DELTA round

**Provenance:** codex exec, model gpt-5.6-sol, reasoning effort xhigh,
read-only sandbox, capsule-only (structurally blind). Target v0.2 revision
9bfdf62d09be11ef. Capsule sha256-vector hash d550849ccb4fecdf (delta-round
CONTEXT.md enumerating the v0.1→v0.2 delta, IN-DELTA vs PRE-EXISTING
classification required). Review received and recorded verbatim below.

---

1. 
   - `severity:` MATERIAL
   - `classification:` IN-DELTA
   - `section:` §2.1
   - `concern:` The causal-version handoff has no implementable way to identify when each affected subscription has converged. The mutate response carries only V, while affectedness is determined server-side and a matched evaluation may produce no delivery. With multiple subscriptions, matcher skips, no-change evaluations, unsubscribe, or teardown, the client cannot know which convergence gates exist or when to retire them; it must either retain an overlay indefinitely or release it prematurely. The ordering audit may discover dependents, but it does not supply the missing affected-subscription/no-change convergence carrier.

2. 
   - `severity:` MATERIAL
   - `classification:` IN-DELTA
   - `section:` §2.2, affecting §2.1 and §2.5
   - `concern:` Latest-state evaluation is unsound for `live_delta` without an atomic coverage cut. An older frame can be selected, a newer commit can become visible before evaluation starts, and the evaluation can then emit a frame tagged with the newer store version while its merged change list omits that commit. A client may advance to that version and permanently discard the later equal-version delta, while §2.1 also falsely treats the subscription as converged. The contract must require that a delta tagged V covers every relevant change through V, otherwise fall back to replace, and must make the evaluation snapshot and sampled version atomic.

3. 
   - `severity:` MATERIAL
   - `classification:` IN-DELTA
   - `section:` §2.4 and §2.5
   - `concern:` The claimed authority-transition wait of “at most one in-flight turn” ignores authority-lane backlog and fan-out. Because authority work is never coalesced or cancelled, a second transition—and later subscriptions produced by one transition—can wait behind earlier authority evaluations in addition to the data turn already in flight. Unbounded priority authority/refresh traffic can also starve ordinary data frames, contradicting §2.5’s unconditional staleness bound. The lane needs an explicit queue/service bound or a cheap fail-closed fence separated from potentially lengthy resnapshot work.

4. 
   - `severity:` MATERIAL
   - `classification:` IN-DELTA
   - `section:` §2.5, affecting §2.1 and OQ-3
   - `concern:` `max_hold` plus one in-flight turn does not actually bound convergence. No maximum evaluation-turn duration is decided, the bound ends when delivery merely starts rather than when the client receives it, and latest-value replacement is not required to inherit the oldest undelivered frame’s age. A hanging evaluation, slow transport, or continuous supersession can therefore leave a connected client indefinitely stale while the stated queue-age condition remains technically satisfied. This contradicts §2.1’s claim that convergence is bounded by §2.5; OQ-3 leaves the load-bearing decision unresolved.

5. 
   - `severity:` MATERIAL
   - `classification:` IN-DELTA
   - `section:` §4 H-2 and §5 Phases 1–2
   - `concern:` The phase plan is internally inconsistent about data-driven authorization refreshes. Phase 1 must pass H-2’s majority-coalescing test on the measured auth-scoped workload, but Phase 2 is where those refreshes “join coalescing.” If they remain excluded through Phase 1, H-2 cannot test the intended workload; if Phase 1 already coalesces them, the witnessed-shrink obligation transfer assigned to Phase 2 has not landed, violating §2.3–§2.4’s safety precondition. The integration, obligation transfer, and corresponding acceptance hypothesis must be placed in the same safe phase.

6. 
   - `severity:` minor
   - `classification:` IN-DELTA
   - `section:` §2.1 and §2.4
   - `concern:` The absent LLP 0012/0043/0070/0093/0135 contracts are load-bearing for the new convergence-gated client behavior, and LLP 0053/0058 are load-bearing for the exact authority-event vocabulary, proof, and ACK rules. The available LLP 0008 summary supports the broad direction but is insufficient to verify those exact compatibility claims. The explicit audit gate mitigates this, but acceptance should review those owners or make the required contract self-contained.

The revision substantially improves settlement isolation, authority classification, obligation preservation, and recovery posture, and I found no MATERIAL concern in PRE-EXISTING text. The remaining concerns are all introduced by the v0.2 delta, but they leave the core convergence, delta-versioning, priority-lane, staleness, and phase-safety contracts unsound or underdetermined.

VERDICT: NOT READY

## Round 3 — 2026-08-08 — DELTA round (final budgeted round)

**Provenance:** codex exec, model gpt-5.6-sol, reasoning effort xhigh,
read-only sandbox, capsule-only (structurally blind). Target v0.3 revision
8305537c3fadab51. Capsule sha256-vector hash 900d79780c853554 (delta-round
CONTEXT.md enumerating the v0.2→v0.3 delta). Review received and recorded
verbatim below.

---

1. `severity:` MATERIAL  
   `classification:` IN-DELTA  
   `section:` §2.2  
   `concern:` The concrete atomic-cut mechanism does not close the commit-to-enqueue race. A commit can become visible at version V before its change list is enqueued; the scheduler can then lock the pending frame, sample V, and drain only earlier changes. That emits a frame stamped V without V’s changes, prematurely advances the watermark, and may cause the later same-version frame to be deduplicated. Commit publication and enqueue must participate in the same synchronization boundary, or the stamp must use an enqueue-complete frontier.

2. `severity:` MATERIAL  
   `classification:` IN-DELTA  
   `section:` §2.4 and §5 Phase 1  
   `concern:` The fail-closed fence does not establish revocation safety at the authority transition boundary. It may wait behind one in-flight evaluation, while neither settlement nor authority-version visibility is held until the fence applies and no delivery-time authority-version gate is specified. A pre-transition evaluation can therefore deliver after the transition commits. Server-side authority-stale marking also does not by itself provide LLP 0008’s durable client fence/tombstone and ACK guarantee for already-retained data. Phase 1 compounds this by depending on `max_eval_turn`, which is not implemented until Phase 3.

3. `severity:` MATERIAL  
   `classification:` IN-DELTA  
   `section:` §2.4  
   `concern:` The claimed bounded authority backlog and non-starvation rule contradict the fence rules. Restorations collapse per subscription, but fences never coalesce or cancel and always preempt. Authority transitions arriving faster than the O(affected-subscriptions) fence work can therefore create an unbounded fence queue and indefinitely starve both restoration and data work. The overload degrade only bounds restorations; it does not bound these fence jobs.

4. `severity:` MATERIAL  
   `classification:` IN-DELTA  
   `section:` §2.5  
   `concern:` A hard `max_eval_turn` cannot bound opaque, non-yielding handler execution while the scheduler is simultaneously forbidden to require VM preemption. Timing out the waiter does not release the scheduler or resources held by the evaluation. Moreover, the timeout degrade retries the same handler as a full resnapshot, with no bounded retry or teardown rule when that refresh also times out. Consequently, “never wedges” and “never left indefinitely stale” are not established.

5. `severity:` minor  
   `classification:` IN-DELTA  
   `section:` §2.1 and §6 OQ-4  
   `concern:` The supplied corpus cannot verify that `current_as_of` already exists with the claimed wire semantics or that per-subscription release-after-apply is compatible with the ordering, session, `runAfter`, protocol, and withheld-overlay owners. The target correctly makes those absent owner-document reviews an acceptance gate; acceptance must not precede that review.

6. `severity:` minor  
   `classification:` PRE-EXISTING  
   `section:` §2.2  
   `concern:` The target delegates maximum pending frames and changes to “LLP 0008’s numeric bounds,” but the supplied LLP 0008 states those bounds only qualitatively. `max_hold` is named here, while the other referenced numeric limits remain unverifiable.

The revised watermark and obligation-transfer contracts address the prior delta’s main correctness gaps, and I found no MATERIAL defect in pre-existing text. The new atomic-cut mechanism, authority fence, and timeout/degrade decisions still leave correctness, security, boundedness, and feasibility failures in the v0.3 delta, so the target is not ready.

VERDICT: NOT READY
