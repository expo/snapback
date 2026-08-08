# Reviews — LLP 0200 (Claude family)

## Round 1 — 2026-08-08 — full review, no lens

**Provenance:** fresh-context claude-fable-5 agent (capsule-only; structurally
blind — capsule excludes `llp/reviews/0200*`, run journal, orchestrator
notes). Target revision d2fa426f57eba385 (Status flipped Draft→Review at
loop start). Capsule sha256-vector hash 21ef90c1d52f14b8 (8 files: LLP
0200/0191/0008/0183, spike closed ticket, evidence ticket, commission
ticket, CONTEXT.md instructions). Reviser for subsequent revisions: the
orchestrating session (did not author this review). Review received and
recorded verbatim below.

---

1. `severity:` MATERIAL
   `section:` §2.1 (with OQ-2/OQ-5)
   The claim "Read-your-writes is unchanged" is not established for the live-subscription + optimistic-overlay path, and the two guarding OQs as scoped do not cover it. Under the current coupled design (B-1: fan-out inside the commit turn, settlement after), by the time a client receives settlement for its mutation at version V, every frame at version ≤ V has already been evaluated and dispatched — so a post-settlement frame showing pre-write state could not occur. §2.1 inverts that ordering: settlement now precedes delivery, so a frame evaluated at version V−1 can legitimately arrive *after* the client's write has settled. LLP 0008's mutation-replay contract clears the doc-id optimistic-suppression set "incrementally as each write is confirmed" — i.e., at settlement — precisely to reopen delta application; with the new ordering, a stale-but-version-monotonic frame arriving in the settlement→convergence window will regress the client's own confirmed write until the ≥V frame lands. That is exactly the flicker class 0008's suppression was built to prevent ("would flicker the UI back before the local mutation confirms"), and latest-value elision (§2.3) does not guarantee the stale frame is elided (elision requires another frame pending). The guards miss it: OQ-2 audits *internal* callers (effects, runAfter, acceptance suites); OQ-5 audits *published docs* (LLP 0093, guide pages) for "settlement implies delivery" language. Neither names client-SDK mechanisms whose correctness implicitly depended on the old ordering (0008's suppression release; the LLP 0135 withheld-changeset reveal at settlement). The Spec needs either a contract addition (mutate responses carry the committed version and overlay/suppression release is convergence-gated to ≥ that version per affected subscription) or an OQ explicitly scoped to client-side ordering dependents — "states the version it requires" covers request/response reads, not frames pushed at the client.

2. `severity:` MATERIAL
   `section:` §2.4
   The lane split's classification rule is undefined at exactly the point where it is security-load-bearing, and the "narrows to exactly this class" sentence strips inline treatment from classes the capsule shows are security-relevant. (a) On a sessions store, authority is substantially *data-derived*: deleting a membership row, or updating a row so a principal no longer satisfies a protected predicate, arrives as an ordinary data commit but is a revocation in effect. §2.4 enumerates authority transitions as "grant, revocation, session invalidation, lease change" without saying what mechanically decides whether a given commit is a "revocation" versus a "data-driven resolution refresh" — the very lane assignment that determines whether the shrink is coalescible/cancellable (fairness-bounded, no security bound) or inline (OQ-4-bounded). LLP 0008's authorization-invalidation amendment already provides the vocabulary the Spec should bind to (declared `permissionBacking`/enumerated writeless events advance the authz version; matcher-observed ordinary shrinks ride the normal path *but* carry a "persistent composite-witness delivery obligation" with ACK-backed negative delivery); the Spec cites neither. (b) That amendment's witnessed-shrink obligation is a third class the dichotomy omits: §2.4 assigns all data-driven re-evaluation to the coalescing/cancellation lane without stating how a level-triggered, ACK-backed shrink obligation survives frame supersession/cancellation. (c) 0008's dated coalescing decision also holds refresh signals inline — including protected-record erasure — and "the existing inline guarantee narrows to exactly this class" reads as revoking that for everything not in the four-item list. The decision to split the lane is right and B-3 demands it; but as written an implementer can lawfully classify a membership-row deletion as coalescible data refresh and delay a de facto revocation behind scheduler fairness. The Spec must give the classification criterion (or delegate it explicitly to LLP 0053's machinery) and state the disposition of witnessed shrinks and erasure-class refresh signals.

3. `severity:` minor
   `section:` §2.2
   "The LLP 0008 starvation bounds (max frames, max changes, max hold) carried over unchanged" imports bounds whose defined enforcement in 0008 is "force an *inline* flush on the next commit" — i.e., evaluation on the write turn — which would contradict "Evaluation must not block subsequent commits" and reopen §2.1's contract exactly under overload. The Spec's own overflow sentence (degrade to a refresh-signal frame) suggests the intent is different, but the text should state explicitly that the starvation/overflow path executes on the scheduler and never re-enters the write turn; "carried over unchanged" is the wrong words for a mechanism that must in fact change.

4. `severity:` minor
   `section:` §2.5
   Per-subscription delivery monotonicity is assumed but not stated as a scheduler obligation. Cancellation covers *queued* evaluations superseded by newer frames, but nothing forbids an in-flight evaluation at version V and a newly scheduled one at V+1 completing out of order; 0008's contract (ordered changesets, non-decreasing versions) needs a one-line carrying rule here (e.g., at most one in-flight evaluation per subscription, or delivery-side version gating).

5. `severity:` minor
   `section:` §4 (H-2)
   "Sustained-write settle throughput approaches write-path capacity" is not testable as stated because no capacity figure or measurement is defined; the zero-observer arm of the same harness implicitly supplies one (~4–7/s from the 0.13–0.24 s settles), but the hypothesis should name how capacity is measured so "approaches" has a denominator.

6. `severity:` minor
   `section:` §2.3
   "That need is the D3/event-log lane" mislabels the escape hatch: in the capsule, D3 is projected facts / retained local data (LLP 0183 §D3) and rung 5 is delta-fed replicas, while LLP 0008 explicitly rejected event-log sync as a product model. Pointing clients who need every intermediate state at a lane that does not exist under that name invites confusion; name the actual intended lane or mark it prospective.

7. `severity:` minor
   `section:` §5
   Phase 2 has the data-driven auth lane "join coalescing/cancellation" while cancellation machinery is Phase 3; harmless (H-3 depends only on coalescing) but the phase text should say "joins coalescing at Phase 2, cancellation when Phase 3 lands" so Phase 2's exit criteria are self-contained.

Overall assessment: this is a strong Spec on the axis the evidence demanded — the B-1→§2.1/§2.2 chain (settlement isolation as both the dominant latency lever and the coalescer un-starver) is faithfully derived from the spike and the post-spike diagnostic, the milestone decomposition (commit-ack / settlement / convergence) matches the measured decomposition, the B-4 resolution-ticket fix and quarantine-lifecycle narrowing are correct readings of the churn data, the phases are the right increments with a real A/B instrument, and the hypotheses are mostly concrete and falsifiable. The two MATERIAL defects are both at the seams the Spec's own contracts create: §2.1 changes an ordering that a client-side correctness mechanism (0008's optimistic suppression release) silently depended on while claiming read-your-writes is unchanged and scoping its audit OQs too narrowly to find it; and §2.4's lane split — the Spec's central security decision — lacks the classification criterion that determines which lane a commit takes on exactly the store shape (sessions-mode, data-derived authority) that motivated it, and drops 0008's witnessed-shrink and erasure-class inline obligations without disposition. Both are fixable with bounded text (a convergence-gated overlay-release contract or a widened OQ; a classification rule bound to LLP 0053's permissionBacking/enumerated-event vocabulary plus named dispositions for witnessed shrinks and refresh signals), and neither invalidates the architecture. The minors are wording and testability polish.

VERDICT: NOT READY

## Round 2 — 2026-08-08 — DELTA round

**Provenance:** fresh-context claude-fable-5 agent (capsule-only,
structurally blind). Target v0.2 revision 9bfdf62d09be11ef (revised by the
orchestrating session after round 1; reviser did not author this review).
Capsule sha256-vector hash d550849ccb4fecdf (same 8-file set, v0.2 target,
delta-round CONTEXT.md enumerating the v0.1→v0.2 delta and requiring
IN-DELTA vs PRE-EXISTING classification). Review received and recorded
verbatim below.

---

1. `severity:` MATERIAL
   `classification:` IN-DELTA
   `section:` §2.2 (interacting with §2.1 and §2.5)
   The evaluation-read decision states "the delivered frame's version is the store version at evaluation start" while delta classification uses "the merged change list against that same state." These two captures are not required to be atomic, and §2.2's whole point is that commits admit concurrently: a commit can land after the pending frame is dequeued (its changes go into a *new* pending frame) but before the evaluation's state read, so a delta frame can be labeled with a version whose changes it does not carry. §2.1's convergence gate trusts exactly that label — a client write at V whose ops are missing from a frame stamped ≥ V releases the overlay early, producing precisely the regression the causal-version handoff exists to prevent. The replace lane is safe (re-query content matches the stamp), but the delta lane as specified is not. The fix is small — require delta-frame version = max merged commit version, or make change-list capture atomic with the version read (and clarify whether §2.5's "monotonically non-decreasing" admits the equal-version corrective frame this race produces) — but the contract as written is unsound, and both halves of the unsoundness (the version rule and the convergence gate) are delta text.

2. `severity:` MATERIAL
   `classification:` IN-DELTA
   `section:` §2.4 (bound to §4 H-1, §5 Phase 1, §6 OQ-3)
   The numeric target "authority-transition resync p95 ≤ 1 s under the six-observer burst arm, measured at Phase 1" is contradicted by the document's own measured basis. The spike measured per-evaluation cost at this store shape at p50 863 ms, max 3.6 s — and an authority resync is itself a full re-resolution evaluation of the same shape. Even with zero queue wait, the resync's own turn consumes essentially the whole 1 s budget at p50, so its p95 almost certainly exceeds 1 s; a single transition affecting several of the six observers must run several such turns (serially, per the one-in-flight-turn structural model the same paragraph relies on), putting the tail at multiple seconds. OQ-3 hedges only the *wait* term (the in-flight data turn), not the dominant term (the resync evaluation's own duration), and H-1 makes the target a Phase-1 exit gate. Either the target needs re-derivation from the measured evaluation cost (or explicit conditioning on evaluation-cost reduction work), or OQ-3 must be widened to cover the resync's own turn — as written the spec predeclares a Phase-1 exit criterion its own evidence says will fail.

3. `severity:` minor
   `classification:` IN-DELTA
   `section:` §2.1
   The convergence gate leaves "affected subscription" undetermined: the client computes affectedness from its optimistic changeset (document ids vs local membership), the server from matcher decisions, and these can disagree — a subscription the client deems affected but the matcher provably skips never delivers a frame ≥ V until unrelated traffic arrives, leaving a vacuous-but-lingering overlay entry. The gate's liveness in the non-vacuous case rests on the matcher's no-false-negative invariant plus §2.5's service bounds; that argument is real but unstated. Separately, release-vs-apply atomicity on the gating frame needs pinning: suppression must not drop the gating frame's own ops for the confirmed document before release, or the authoritative value is lost until the document next changes. Both are recordable for Phase 1 / the ordering audit; the gating decision itself is sound.

4. `severity:` minor
   `classification:` IN-DELTA
   `section:` §2.2 / §2.4
   Bound-overflow degrades the pending frame to a priority refresh-signal frame, but obligation transfer is stated only for coalescing/cancellation (§2.4) and for the slow-subscriber memory degrade (§2.5, which says "carrying any witnessed-shrink obligations" explicitly). The §2.2 overflow path — a supersession that discards a pending frame — does not explicitly state that witnessed-shrink obligations transfer to the refresh frame. One sentence closes the gap; the surrounding rules make the intent clear.

5. `severity:` minor
   `classification:` IN-DELTA
   `section:` §2.5
   The service bound (no pending frame's age exceeds `max_hold` + one in-flight turn without delivery starting) is arithmetically unsatisfiable once pending-subscription count × evaluation cost exceeds the bound — at ~0.9 s per evaluation that is roughly ten backlogged subscriptions. H-4 scopes the falsifiable claim to the six-observer sustained arm, which is fine, but as contract text the bound implies an unstated capacity ceiling, and the only specified degrade trigger is per-subscription memory, not scheduler overload. Name the overload behavior or condition the bound; no defective decision, but the contract over-promises at the margin.

6. `severity:` minor
   `classification:` IN-DELTA
   `section:` §4 H-2 / §5
   With Phase 2 deferred ("data-driven resolution refreshes join coalescing" only then) and B-3 establishing that essentially every subscription on the sessions store is auth-scoped, H-2's first clause — "coalescer deferral engages on a majority of backlogged burst commits" — measures a near-vacuous quantity at Phase 1: deferrals can tick while the dominant delivery lane still runs uncoalesced until Phase 2. The throughput clause carries the real Phase-1 signal. Clarify what a Phase-1 "deferral" must cover for the clause to be evidence rather than a counter artifact.

7. `severity:` minor
   `classification:` IN-DELTA
   `section:` §3 / §5 Phase 4
   §3 says the inspect-surface schema-rotation cost "is accepted once, in Phase 1," while Phase 4 carries "any residual inspect-surface schema rotation not landed with Phase 1." Small internal tension — either the cost is paid once in Phase 1 or a residual exists; pick one phrasing.

8. `severity:` minor
   `classification:` PRE-EXISTING
   `section:` Related / §2.1 / §6 OQ-1
   Load-bearing referenced documents are absent from the capsule and unverifiable here: LLP 0012/0043/0070/0093 (the ordering-audit surface) and LLP 0135's exact withheld-changeset semantics (the capsule's LLP 0008 fold describes withholding "until settlement," and moving reveal later to convergence is conservative, but the primary text is unseen). The Phase-1 audit gate is the right mitigation. Also pre-existing and honestly held: OQ-1's acknowledgment that §2.2's "commits admit while evaluations run" cannot hold structurally on the single-threaded DO profile — acceptable as an open question, but Phase-1 claims should state their target scope when they land.

Overall assessment: v0.2 is a substantial and mostly successful revision — the causal-version handoff, the LLP 0008-vocabulary lane classifier, the fail-closed slow-subscriber degrade, refusal settlement, and the Phase restructure putting the classifier and counters into Phase 1 all resolve real round-1-shaped gaps, and the document is unusually well grounded in its measured basis. The two remaining MATERIAL defects are both in delta text and both concretely fixable: the frame-version labeling rule is unsound for the delta lane in exactly the way that defeats the new convergence gate it must serve, and the authority-resync p95 ≤ 1 s target contradicts the spike's own per-evaluation cost measurements while serving as a Phase-1 exit gate with an open question that hedges only the wrong term. Nothing MATERIAL was found in pre-existing text; the minors are one-sentence-to-one-paragraph repairs appropriate for the next bounded round.

VERDICT: NOT READY

## Round 3 — 2026-08-08 — DELTA round (final budgeted round)

**Provenance:** fresh-context claude-fable-5 agent (capsule-only,
structurally blind). Target v0.3 revision 8305537c3fadab51 (revised by the
orchestrating session after round 2). Capsule sha256-vector hash
900d79780c853554 (delta-round CONTEXT.md enumerating the v0.2→v0.3 delta).
Review received and recorded verbatim below.

---

1. severity: MATERIAL
   classification: IN-DELTA
   section: §2.1 (watermark advancement vs in-flight content)
   The watermark contract does not pin per-subscription ordering between skip/no-change dispositions and undelivered content frames. Concrete hazard: subscription S has an in-flight (or pending) content evaluation cut at V′; a later commit V > V′ is matcher-skipped for S and a `current_as_of(V)` envelope is emitted immediately. The envelope advances S's watermark to V; when the content frame stamped V′ completes, the monotonic delivery gate (§2.5, "delivered versions are monotonically non-decreasing per subscription") drops it as stale — but nothing re-covers its content, because the changes in (V′, V] were irrelevant to S. The client is left with stale content while its watermark certifies convergence at V, and §2.1's overlay/withheld-changeset gates release against state the client does not have — exactly the regression the watermark was built to prevent. §2.2's atomic coverage cut protects delta stamps against this class; the analogous invariant for envelope stamps (an envelope at V may not overtake an undelivered content frame at V′ < V — it must be sequenced after it or piggyback on it) is permitted by the text ("may piggyback") but nowhere required. This is a correctness invariant, not implementation detail: the safe and unsafe implementations both satisfy the current text.

2. severity: MATERIAL
   classification: IN-DELTA
   section: §2.4 / H-1 (fence target vs fence mechanism)
   The fence's numeric target (fence-applied p95 ≤ 500 ms under the six-observer burst arm) is arithmetically incompatible with the stated wait bound under the natural reading of the mechanism. The spec says the fence's worst-case wait is "one in-flight non-preemptible evaluation turn," and the same document records measured evaluation turns of p50 863 ms / max 3.6 s at 5.5M rows under precisely that burst arm, where evaluations run back-to-back. If fence marking serializes behind the executing turn (the reading the worst-case sentence implies for a scheduler that "must not require VM preemption"), a fence arriving during a burst waits a uniform fraction of an ~863 ms turn — p95 ≈ 0.8 s+, structurally above the 500 ms target. The target is achievable only if marking proceeds concurrently with an executing turn (touching subscription state the turn does not hold), in which case the "worst-case one turn" wait needs a different justification. The spec must either state that fence application is concurrent with in-flight evaluation (and say what, if anything, it actually waits on) or set a target consistent with the mechanism. As written, the security-critical numeric bound and the mechanism it binds to cannot both be true under the document's own measurements.

3. severity: MATERIAL
   classification: IN-DELTA
   section: §2.5 (turn-timeout degrade has no terminal state)
   A timed-out evaluation "fails that subscription's frame to the degrade path" — but the degrade path is a full-resnapshot refresh obligation, which re-runs the same handler at equal or greater cost. For a handler that persistently exceeds `max_eval_turn` (the spec's own scale ambitions make this reachable — 3.6 s max at 5.5M rows leaves only ~8× headroom on the 30 s default), the state machine is: timeout → refresh obligation → timeout → refresh obligation, indefinitely. The only specified escape (stream teardown with resync-required) triggers on transport rejection, which is not the failing condition here. Either the refresh evaluation is exempt from the timeout (re-wedging the scheduler the timeout exists to protect) or the loop never terminates and the §2.5 contract "a connected client is never left indefinitely stale" is violated with no typed failure. The degrade chain needs a specified terminal state for persistent turn timeout (escalation to teardown, or a typed subscription failure).

4. severity: minor
   classification: IN-DELTA
   section: §2.1 (envelope delivery bound)
   Standalone `current_as_of` envelopes are "latest-value-coalescible and may piggyback on the next delivered frame," with no stated bound on how long coalescing/piggybacking may withhold them. §2.5's service bound governs "pending subscription frames"; whether a watermark envelope is such a frame is unstated. Without a bound (or the OQ-3 lazy-watermark rule that makes withholding explicitly demand-driven), a convergence gate on a quiet, always-skipped subscription can stall arbitrarily. Tie envelope emission to §2.5's `max_hold` or to announced write gates explicitly.

5. severity: minor
   classification: IN-DELTA
   section: §2.1 / OQ-3 (existing-wire-frame claim)
   "the cheap ~200-byte frame the wire already has" is unverifiable from the capsule and sits uneasily with LLP 0008's enumerated wire kinds (`live_replace`, `live_delta`, `resync_required`, mutation results — no no-change/watermark envelope appears). If the frame does not exist, `current_as_of` is a new additive wire kind requiring 0008/0093 amendment. Additive evolution is permitted, so this is not blocking, but the factual claim should be verified or restated, and the OQ-4 owner-document review should name it explicitly.

6. severity: minor
   classification: IN-DELTA
   section: §2.4 / §2.5 (overload degrade sheds no load)
   Both the authority-backlog degrade and the data-lane overload degrade convert pending work into full-resnapshot refresh obligations "delivered at priority." A refresh re-query costs at least as much as the evaluation it replaces (on this workload, identically — the replace lane dominates), so the degrade reduces no demand; under sustained overload the only true load-shedding step is transport-reject → teardown, and elevating refreshes to priority can pressure the data lane §2.4 promises not to starve. The chain is not incoherent, but the spec should state plainly that teardown is the actual capacity escape and that the refresh-at-priority step is a semantic conversion (staleness promise → resnapshot obligation), not load relief.

7. severity: minor
   classification: IN-DELTA
   section: §2.5 (client-visible staleness during data-lane overload)
   In the overload state, pending frames collapse server-side to refresh obligations, but between degrade and refresh delivery the client renders stale data with no stale marker — unlike the authority path, where fencing/quarantine is client-visible. "Fail-closed" here is server-side bookkeeping; either a client-visible staleness signal should precede the refresh, or the fail-closed wording should be scoped to the shrink-obligation guarantee it actually provides.

8. severity: minor
   classification: IN-DELTA
   section: §2.4 / §5 (fence bound cites a Phase-3 mechanism)
   The fence's formal wait bound is "bounded by §2.5's turn timeout," but `max_eval_turn` enforcement lands in Phase 3 while the fence and its H-1 target land in Phase 1. The Phase-1 fence therefore has only the empirical ~0.9–3.6 s turn costs as its bound, not a stated worst case. State the Phase-1 interim bound or move minimal timeout enforcement forward with the fence.

9. severity: minor
   classification: PRE-EXISTING
   section: §2.1, §2.4, Related (sight-unseen owner bindings)
   The Spec binds load-bearingly to LLP 0053's witnessed-shrink obligation semantics, LLP 0135's withheld-changeset rules, LLP 0012/0043 ordering, LLP 0070 runAfter, and LLP 0093's protocol surface — none present in the capsule, so none of those bindings are verifiable here. OQ-4's extension making owner-document review a hard acceptance precondition is the correct mitigation and should remain non-negotiable; recording this so the acceptance gate is not weakened later.

Overall assessment: the v0.3 delta is a substantial improvement in exactly the places the round-2 MATERIALs lived — the watermark makes convergence well-defined for skipped subscriptions, release-after-apply closes the self-suppression hole, the atomic coverage cut closes the delta-stamp race, the fence/restoration split replaces a contradicted latency promise with an honest security bound plus measured-cost restoration, and the age-inheritance and capacity-scoped staleness bounds remove the ways the old service rule could lie. The pre-existing structure (milestone decomposition, lane classification, obligation transfer, quarantine lifecycle, phases and hypotheses) is coherent and well-grounded in the spike evidence, and I find no MATERIAL defect in it. The three remaining MATERIALs are all introduced by the delta and are all of the same species: a newly added mechanism whose text admits both a safe and an unsafe reading (envelope ordering), or whose numbers and mechanism cannot simultaneously hold (fence p95 vs non-preemptible turns), or whose failure loop lacks a terminal state (turn-timeout degrade). All three are narrowly fixable — an ordering invariant sentence, a stated concurrency posture or corrected target, and an escalation rule — and none undermines the design's architecture; they are exactly the kind of remaining in-delta findings the author can disposition directly in this final budgeted round.

VERDICT: NOT READY
