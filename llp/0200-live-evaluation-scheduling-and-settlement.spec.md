# LLP 0200: Live evaluation scheduling and settlement isolation (the server-side D4 Spec)

**Type:** Spec
**Status:** Review
**Systems:** Live queries, Performance, Auth, Storage, Client SDK
**Author:** Claude Fable 5 (commissioned by the LLP 0191 author rulings, Charlie Cheever, 2026-08-08)
**Date:** 2026-08-08
**Revised:** 2026-08-08 (v0.4 — post-round-3 repairs, **unreviewed**; final
review verdicts bind to v0.3; see Revision history)
**Related:** LLP 0191 (evidence and ladder), LLP 0008 (live protocol; dated
coalescing decision and authorization-invalidation amendment this Spec
binds to), LLP 0183 (D4 charter this Spec extends), LLP 0012/0043
(ordering and sessions contracts), LLP 0058 (auth-mode deployment state),
LLP 0020 (live matcher), LLP 0070 (runAfter), LLP 0093 (client protocol),
LLP 0135 (optimistic overlay / withheld changesets),
`issues/closed/20260808-oq4-coalescing-measurement-spike.md` (measured
basis), `issues/20260808-live-query-reevaluation-cost-at-scale.md`
(workstream anchor), `issues/20260808-d2-d4-owner-specs-commission.md`

## 0. Charter

LLP 0183 charters D4 as the *headless windowed-query controller* — a
client-side artifact. The commissioning ticket requires this Spec to either
extend that charter to server-side evaluation scheduling or name the runtime
owner. **This Spec extends the D4 charter**: D4 owns the window/stream
lifecycle end to end, and the server-side evaluation scheduler is the
server half of that lifecycle. The client-side controller remains LLP 0183
scope; this document specifies only the server: when evaluations run, what
the write path promises, what delivery may elide, and how streams recover.

## 1. Measured basis (what this Spec must fix)

From the OQ4 spike and its post-spike diagnostic (all N=1, shape evidence;
full numbers in the closed spike ticket):

- **B-1 Write-turn coupling.** Commit plus full fan-out is one exclusive
  write turn (`dispatch_live_data_fanout` inside the commit path's
  `&mut self`). At 5.5M rows with six auth-scoped observers, a frame costs
  ~5–6 s of serial ~0.9 s evaluations; the next mutation's *commit* waits.
  Zero observers settle the same inventory at ~0.2 s; six observers push
  settles to 18–43 s p50, refused commit-free mutations included, and
  sustained writes are throughput-bound at ≈0.85 settles/s.
- **B-2 Starved coalescer.** Rung-1 coalescing (LLP 0008 dated decision)
  defers a commit only if it arrives while a pending frame exists — but
  B-1 serializes commits behind fan-out, so almost none do (4/24 deferrals
  at full scale vs 15.6× on the synthetic fixture).
- **B-3 Auth-lane dominance.** On a sessions store every subscription is
  auth-scoped and every replace-lane re-evaluation is delivered as an
  `authorization_invalidation` envelope via the authorization-resolution
  path — ~90% of delivered frames — and the coalescer excludes that lane
  wholesale ("permission resyncs, authorization events, and refresh
  signals always run inline").
- **B-4 Quarantine churn.** Roughly half the delivered auth frames in a
  burst arm arrived without a usable resolution ticket and quarantined the
  client boundary until a later frame restored it (119/231 callbacks).

## 2. Contracts

### 2.1 Settlement is decoupled from subscriber work

Three separately named, separately measured milestones per mutation:

1. **Commit-ack** — the commit is durable (WAL write completed).
2. **Settlement** — the mutate response (result or refusal) is written to
   the caller. Applied mutations settle after commit-ack plus
   handler-result serialization only. **Refusals** never commit: they
   settle at refusal serialization, acquire nothing owned by delivery, and
   have no commit-ack or convergence milestone.
3. **Convergence** — a given subscription has delivered a frame at
   version ≥ the mutation's committed version.

Contract: **settlement never awaits fan-out or subscriber evaluation.**
Convergence is per-subscription and bounded by §2.5's scheduler bounds,
not by the write path.

**The causal-version handoff.** Settlement preceding delivery creates a
window in which a frame evaluated at version < V can arrive *after* the
client's own write at V settled. Client-side mechanisms whose correctness
silently depended on the old ordering must become version-gated, in the
same landing as the server change:

- The mutate response carries the committed version V (it already carries
  the result; V becomes contractual).
- **Every subscription carries a convergence watermark.** After each
  fan-out frame's disposition for a subscription — delivery, skip, or
  no-change — the subscription's watermark advances to that frame's
  version. Deliveries carry it intrinsically; skips and no-change
  evaluations advance it with a `current_as_of(V)` watermark envelope
  (LLP 0093's current-as-of acknowledgement is the precedent; if the
  served protocol lacks a standalone subscription-scoped variant this is
  an additive wire kind, amended into LLP 0008/0093 at Phase 1), which is
  latest-value-coalescible and may piggyback on the next delivered frame.
  **Envelope ordering invariant:** an envelope stamped V must not be
  delivered while a content frame stamped < V remains undelivered for
  that subscription — it is held to follow (or piggyback on) that frame,
  so watermark ≥ V always implies the client holds every content ≤ V it
  is entitled to. Standalone envelopes are pending subscription frames
  under §2.5's service bound (`max_hold` applies; they cannot be
  withheld indefinitely). Convergence for a write at V against a
  subscription is therefore well-defined for every subscription —
  including ones the matcher skips — as watermark ≥ V; a torn-down or
  unsubscribed handle ends its gates with it.
- LLP 0008's optimistic-suppression release and LLP 0135's
  withheld-changeset reveal move from settlement-gated to
  **watermark-gated per subscription**: the overlay for a write at V
  releases against a subscription only when that subscription's watermark
  is ≥ V, and release happens **after** the gating frame's own ops are
  applied (release-after-apply — the frame that proves convergence must
  not have its ops suppressed away). A stale-but-monotonic frame in the
  settlement→convergence window therefore cannot regress a confirmed
  write.
- Read-your-writes for request/response reads rides the same V (the
  client states the version it requires).

Phase 1 is **gated** on the ordering audit of LLP 0012, 0043, 0070
(runAfter), 0093, and the client SDK surfaces above; every dependent found
either moves to convergence-based gating or gets a named carve-out in this
section before the phase lands.

### 2.2 Fan-out leaves the write turn

Fan-out (matching, evaluation, delivery) runs on an evaluation scheduler
outside the commit turn. The write turn ends at commit-ack plus enqueue of
the frame's change list. Requirements:

- Commits admit while evaluations run (this also un-starves the rung-1
  coalescer — B-2 resolves without new coalescing machinery).
- **Evaluation reads current committed state, under an atomic coverage
  cut.** An evaluation runs against the newest committed state at its
  start; no historical snapshot is pinned (no unbounded WAL retention).
  The frame's version stamp and its change coverage are captured
  **atomically at dequeue**: a frame stamped V must cover every relevant
  change ≤ V. Concretely, the scheduler samples the store version and
  drains the pending change list in one step under the pending-frame
  lock; a commit landing after the cut goes to a new pending frame. If an
  evaluation observes state newer than its cut (a commit raced in before
  its reads), the **delta lane must not emit at the newer version** — it
  either re-cuts (absorbing the newer changes and re-stamping) or falls
  back to the replace lane, whose re-query content always matches its
  stamp. A delta frame whose stamp exceeds its coverage is a contract
  violation: the client would advance its watermark past changes it never
  received and §2.1's gate would release early. The cut samples the
  **enqueue-complete frontier**, not raw store visibility: the write turn
  ends with commit publication and change-list enqueue in one
  synchronization boundary, so no commit is visible at a version whose
  changes are not yet enqueued, and a frame stamped V provably holds
  every enqueued change ≤ V.
- The pending-frame structure is the **bounded** hand-off: merged change
  lists with LLP 0008's numeric bounds (today's `LiveCoalesceTunables`:
  max frames 4096, max changes 25,000, max
  hold). Their *enforcement moves to the scheduler*: 0008's inline-flush-
  on-next-commit rule is explicitly **not** carried over (it would re-enter
  the write turn). Bound overflow degrades the pending frame to a
  refresh-signal frame executed on the scheduler at priority (§2.5), and
  any witnessed-shrink obligations the discarded pending frame carried
  transfer to that refresh frame (§2.4's transfer rule applies to every
  supersession path, overflow included).
- LLP 0008's exclusions survive the move unchanged in meaning: **refresh
  signals** (including protected-record erasure) supersede and discard
  pending frames and run at the scheduler's front, never coalesced away;
  a subscription **resynced while changes are pending is pinned to the
  replace lane** at its next delivery (its membership changed under it, so
  delta classification is unsafe).

### 2.3 Latest-value delivery (absorbed from LLP 0008, now load-bearing)

Per subscription, delivery is latest-value: intermediate states may be
elided whenever more than one frame is pending. This was landed as an
optimization contract; this Spec makes it the *default semantic* of live
delivery — subject to the obligation-transfer rule in §2.4: elision never
discharges a witnessed delivery obligation except by a delivery that
provably subsumes it. Clients requiring every intermediate state are out
of scope for live queries; the prospective home is the D3 retained-facts /
delta-replica lane (LLP 0191 rung 5), which does not exist yet — this Spec
promises nothing there.

### 2.4 The authorization lane splits in two — by declared classification

B-3 shows "authorization lane" currently conflates two different things.
The split is decided here, and the classifier is **LLP 0008's
authorization-invalidation vocabulary**, not implementer judgment:

- **Authority transitions** — commits or writeless events that advance the
  authorization version under LLP 0008's amendment: declared
  `permissionBacking` writes and the enumerated session/lease/grant/
  revocation events. These split into a cheap security step and an
  expensive restoration step, with different bounds:
  - **The fail-closed fence** is the security-critical step and is not an
    evaluation: at authority dispatch, every affected subscription is
    immediately marked authority-stale — no further frames deliver from
    its pre-transition authority, reads against it fail closed
    (quarantine posture) until re-resolution. **Fence application is
    scheduler-state marking, concurrent with any executing evaluation
    turn** — it touches subscription registry state no evaluation holds,
    waits on no turn, and is O(affected subscriptions). What makes
    concurrency sound without VM preemption is the **delivery-time
    authority gate**: every frame carries the authority version it was
    resolved under, checked at delivery against the subscription's
    fenced authority version; a frame resolved under pre-transition
    authority is discarded at the gate (its subscription is fenced and
    owed re-resolution), so an in-flight evaluation completing after the
    fence cannot deliver stale-authority content. Fencing is idempotent
    monotone marking at the latest authority version — a fence job for
    an already-fenced subscription collapses — so outstanding fence work
    is bounded by live-subscription count regardless of transition rate,
    and fence preemption cannot starve the lanes. Server-side marking
    composes with, and does not replace, LLP 0008's client-side durable
    fence/tombstone and ACK machinery for already-retained data (that
    contract is unchanged). Numeric target: fence applied p95 ≤ 500 ms
    under the six-observer burst arm, measured at Phase 1 — a bound on
    the marking + gate path, which waits on no evaluation.
    **Revocation safety is the fence plus the gate, not the
    resnapshot.**
  - **Restoration** — re-resolving and re-delivering the affected
    subscriptions — is ordinary evaluation work: it runs on the authority
    lane ahead of pending data frames, collapses latest-authority-wins
    per subscription (a newer transition supersedes an unstarted
    restoration; the fence of the newer transition already holds), and
    its cost is the measured evaluation cost (spike: p50 863 ms, max
    3.6 s per subscription at 5.5M rows) times affected subscriptions.
    No sub-evaluation-cost latency is promised: the structural bound is
    fence + queue position + per-subscription turns; the numeric
    restoration target is set from Phase-1 measurements at Phase 2, and
    tightens when Phase 3 cancellation and later D2 sharing reduce turn
    cost. Authority-lane backlog is bounded by the same rule that bounds
    data frames: per-subscription latest-value collapse means at most one
    pending restoration per subscription; if authority demand still
    exceeds capacity, subscriptions stay fenced (fail-closed — staleness
    never fails open) and degrade to §2.5's refresh-obligation path.
    Sustained authority traffic cannot starve the data lane indefinitely:
    the scheduler alternates lanes once each authority transition's
    fences are applied — fences always preempt; restorations share.
- **Data-driven resolution refresh** — everything else: an ordinary data
  commit re-evaluating an auth-scoped subscription and re-delivering its
  resolution snapshot. Contract: participates in coalescing, cancellation,
  and scheduling exactly like plain replace delivery, and must carry a
  usable resolution ticket so delivery does not quarantine the boundary it
  feeds (B-4).
- **Witnessed shrinks are an obligation, not a lane.** A matcher-observed
  shrink of an auth-scoped result rides the data lane *but* carries LLP
  0008's persistent composite-witness delivery obligation (level-
  triggered, ACK-backed negative delivery). Coalescing and cancellation
  must **transfer** that obligation to the superseding frame; it is
  discharged only by a revision-bound ACK of a delivery that subsumes the
  shrink, or by authenticated retirement — never by elision alone.

### 2.5 Cancellation, fairness, and bounded staleness

- A queued evaluation for a subscription is cancelled when a newer frame
  supersedes it (latest-value makes this sound; obligations transfer per
  §2.4).
- At most one evaluation per subscription is in flight, and delivered
  versions are monotonically non-decreasing per subscription (delivery-
  side version gating; carries LLP 0008's ordering contract).
- In-flight cancellation is best-effort at handler-turn boundaries; the
  scheduler must not require VM preemption.
- **Evaluation turns are time-bounded, with a terminal state.** A hard
  per-turn timeout (`max_eval_turn`, default 30 s; tunable) bounds the
  unit everything else waits behind. Timeout **abandons the waiter**: the
  scheduler releases the subscription's slot and discards the
  evaluation's result on eventual completion; whether the runtime can
  also terminate the turn is runtime-dependent (Hermes interrupt support;
  the DO profile's own limits) and not assumed — concurrency slots are
  bounded, so a wedged turn costs one slot and surfaces as a typed
  scheduler-health diagnostic, never a wedged scheduler. Persistent
  failure terminates rather than loops: after a timeout the subscription
  gets **one** refresh retry; a second consecutive timeout is a typed
  subscription failure and the stream is torn down with LLP 0008's
  resync-required signal — the terminal state. A minimal form of this
  timeout (abandon + degrade, no cancellation machinery) lands **with
  Phase 1**, since the fence's wait bound and H-1 cite it; full §2.5
  enforcement lands in Phase 3.
- **Service rule (replaces the old lock-FIFO fairness):** the scheduler
  serves pending subscription frames oldest-first with per-subscription
  latest-value collapse, where **a superseding frame inherits the age of
  the oldest undelivered content it replaces** (continuous supersession
  cannot reset the clock). Authority fences, then refresh signals,
  preempt the queue front (§2.2, §2.4).
- **The staleness bound, honestly scoped.** Service bound: no pending
  frame's (inherited) age exceeds `max_hold` (LLP 0008 tunable, default
  5 s) plus one in-flight turn without its delivery *starting*.
  End-to-end convergence is that bound **plus** at most one
  `max_eval_turn` plus transport; it holds only while scheduler demand
  is within capacity. When demand exceeds capacity (pending-subscription
  count × evaluation cost > the bound — an explicit overload state, not
  a silent violation), or when a turn times out, the affected
  subscriptions degrade **fail-closed and immediately**: pending state
  collapses to a refresh-signal obligation (full resnapshot, carrying
  any witnessed-shrink obligations) delivered at priority, and if the
  transport cannot accept it the stream is torn down with LLP 0008's
  resync-required signal. Stated plainly: the refresh-obligation step is
  a **semantic conversion** (staleness promise → resnapshot obligation),
  not load relief — a refresh re-query costs what the evaluation it
  replaces cost — and **teardown is the true capacity escape** under
  sustained overload; "fail-closed" here guarantees the shrink-obligation
  and bounded-resnapshot properties, not a client-visible stale marker in
  the degrade window (a client-visible staleness signal is future
  protocol surface, not promised here). With the timeout terminal state
  above, a connected client is never left indefinitely stale — the chain
  ends in delivery or typed teardown — and an omitted shrink is never
  the omitted state. The same degrade path serves per-subscription
  pending-memory overflow. A slow or disconnected subscriber costs the
  write path nothing and other subscribers only its scheduler share.

### 2.6 Quarantine-recovery lifecycle

Quarantine is for **authority uncertainty**, not ordinary data delivery;
with §2.4's resolution tickets, routine data refresh must not quarantine
(the B-4 churn pattern must not survive this Spec). A quarantined stream
re-establishes liveness only by an *accepted authority proof*: a
successful resolution delivery for that subscription, or an authority
transition that re-admits it. Client resubscribe is a request that
triggers re-resolution — the stream stays quarantined until the fresh
authorized snapshot is accepted (LLP 0008's rule). Quarantine entry and
exit are observable events (§3).

## 3. Observability

The spike's counter families become permanent surfaces **in Phase 1**,
because every later phase's A/B depends on them: matcher decisions
(match/skip/fallback by lane), evaluation lifecycle (queue/start/finish/
cancel, duration, frame bytes, kind), coalescer stats
(`LiveCoalesceStats`, already landed), settlement decomposition
(commit-ack/settlement timestamps), authority-lane dispatch latency, and
quarantine entry/exit. Landing them on the serialized inspect surface
rotates drift-gated schemas — that cost is accepted once, in Phase 1.

## 4. Acceptance instruments and predeclared hypotheses

Instrument: the preserved spike harness (`spike/oq4-coalescing-measurement`
branch — twelve-arm A/B matrix, minutes per arm against the persistent
baseline) for per-phase A/Bs, and the zb5-hot gate for requalification per
LLP 0189. Predeclared post-landing hypotheses (shape targets, N≥3 per
`benchmarks/protocol.md` before any published claim):

- H-1 (Phase 1): burst commit-ack p50 < 250 ms and settlement p50 < 1 s at
  six observers; refused mutations settle < 250 ms; zero-observer settle
  unchanged; authority-fence-applied p95 ≤ 500 ms (§2.4).
- H-2 (Phase 1): coalescer deferral engages on a majority of backlogged
  burst commits **counted over the data-driven lane including auth-scoped
  refreshes** (vs 4/24 — Phase 1 integrates that lane, so the count is
  the workload, not a counter artifact), and sustained-write settle
  throughput reaches ≥ 50% of the **same run's zero-observer settle
  throughput** (the capacity denominator; ~4–7/s in the spike).
- H-3 (Phase 2): six-observer burst convergence p50 below the same run's
  serial-evaluation floor (six × measured single-evaluation p50); zero
  quarantine callbacks on ordinary data delivery; restoration latency
  distribution measured and its Phase-2 numeric target set (§2.4).
- H-4 (Phase 3): under the sustained arm, no pending frame's inherited
  age exceeds `max_hold` plus one in-flight turn without delivery
  starting, no turn exceeds `max_eval_turn`, overload degrades are
  observed fail-closed (§2.5), and superseded-evaluation cancellations
  are observed.

## 5. Implementation phases

1. **Settlement isolation + classification + safe coalescing
   integration** (§2.1, §2.2, §2.4's classifier + fence + obligation
   transfer, §3): respond at commit-ack + handler result; move fan-out
   onto the scheduler with the atomic-cut pending-frame hand-off and the
   convergence watermark; stand up the classifier and the fail-closed
   authority fence (moving fan-out off-turn without them would either
   delay revocations or leave the whole auth lane inline and defeat
   H-1/H-2); land witnessed-shrink obligation transfer **in this phase**
   — it is the safety precondition for coalescing the auth-scoped data
   lane, which this phase integrates; land the §3 counters; complete the
   §2.1 ordering audit. Exit: H-1, H-2.
2. **Resolution tickets + quarantine narrowing + restoration targets**
   (§2.4 remainder, §2.6): resolution tickets accompany data-driven
   deliveries; quarantine stops firing on ordinary data; restoration
   latency measured and its numeric target set. Exit: H-3.
3. **Cancellation and service bounds** (§2.5): queued-evaluation
   cancellation, one-in-flight rule, the service rule with age
   inheritance, `max_hold`/`max_eval_turn` enforcement, overload
   degrade. Exit: H-4.
4. **Quarantine lifecycle closure** (§2.6) and any inspect-surface
   schema rotation deferred from Phase 1 (§3 accepts the cost once; if
   part must defer for schema-freeze reasons, this phase pays the
   remainder — one of the two, stated at Phase-1 landing).

Each phase lands separately, A/B'd, fix-forward per LLP 0189. Rung 2
(matcher widening), rungs 4–5 (IVM, replicas), and cross-principal sharing
are D2/D3 scope and are not blocked by, nor blocking, these phases.

## 6. Open questions

- **OQ-1 (hosted profiles).** On the Cloudflare DO target the single-
  threaded owner *is* the write turn. Does fan-out-off-the-turn map to
  `waitUntil`-style deferral with the same contracts, or does the DO
  profile document a narrower guarantee? (LLP 0014's designed read
  ceiling already accepts per-app serialization; §2.1 must still hold.)
- **OQ-2 (ordering-audit findings).** The §2.1 audit is now a Phase-1
  gate; this OQ holds its findings — any dependent that cannot move to
  convergence-gating gets its carve-out recorded here before Phase 1
  lands.
- **OQ-3 (watermark wire economics).** §2.1's `current_as_of` watermark
  gives skips a deliverable; its cost under high commit rates (many tiny
  frames) is unmeasured. Piggybacking and coalescing should make it
  negligible — Phase 1 measures it and, if needed, adopts lazy watermarks
  (emit only when a client has announced a pending write gate).
- **OQ-4 (client contract surface).** Do any published client surfaces
  (LLP 0093 protocol docs, guide pages) describe settlement as implying
  delivery? Those surfaces revise with Phase 1, same commit. Acceptance
  of this Spec additionally requires the owner-document review the
  capsule audits could not perform (LLP 0012/0043/0053/0070/0093/0135 —
  the ordering, authority-vocabulary, and overlay owners), since this
  document binds to their semantics sight-unseen from reviewers'
  perspective.

## 7. Non-goals

Incremental view maintenance, delta-fed replicas, matcher vocabulary
widening, cross-principal shared evaluation, multi-process realtime, and
any change to the one-authority-per-app storage contract (LLP 0007/0128).

## Revision history

- **v0.1 (2026-08-08).** Initial draft from the OQ4 spike results and
  post-spike diagnostic.
- **v0.2 (2026-08-08).** Super-refine round-1 revision (both families
  NOT READY). Added: causal-version handoff with convergence-gated
  overlay/suppression release and the Phase-1 ordering-audit gate (§2.1);
  latest-state evaluation semantics resolving the snapshot-pinning
  question (§2.2); scheduler-enforced bounds replacing 0008's inline
  flush, with refresh-signal and resync-pinned-replace exclusions carried
  explicitly (§2.2); classification bound to LLP 0008's
  authorization-invalidation vocabulary, the authority dispatch lane with
  a structural + numeric revocation bound, and witnessed-shrink
  obligation transfer (§2.4); one-in-flight/monotonic-delivery rule, the
  oldest-first service rule, and fail-closed slow-subscriber degrade
  (§2.5); quarantine exit requiring accepted authority proof (§2.6);
  refusal settlement milestone (§2.1); counters moved to Phase 1 (§3);
  H-2/H-3 given measurable denominators; phases restructured so the
  classifier lands with settlement isolation (§5); D3-lane reference
  corrected and marked prospective (§2.3).
- **v0.3 (2026-08-08).** Super-refine round-2 revision (delta round; both
  families: no MATERIAL in pre-existing text, all remaining MATERIAL
  in-delta). Convergence gate rebuilt on a per-subscription **watermark**
  advanced by delivery, skip, and no-change (`current_as_of` envelopes),
  with release-after-apply (§2.1); delta-lane **atomic coverage cut** —
  a frame stamped V must cover every relevant change ≤ V, else re-cut or
  fall back to replace (§2.2); overflow supersession transfers
  witnessed-shrink obligations explicitly (§2.2); authority transitions
  split into the **fail-closed fence** (p95 ≤ 500 ms target, the security
  bound) and **restoration** (evaluation-cost-honest, latest-authority
  collapse, lane-bounded, never fails open) replacing the contradicted
  1 s resync target (§2.4); `max_eval_turn` timeout, supersession age
  inheritance, capacity-scoped staleness bound with explicit fail-closed
  overload degrade (§2.5); obligation transfer and auth-scoped coalescing
  integration moved into Phase 1 with H-2 counting the integrated lane
  (§4, §5); §3/Phase-4 schema-rotation phrasing reconciled; OQ-3 replaced
  (watermark wire economics); owner-document review added to the
  acceptance requirement (OQ-4).
- **v0.4 (2026-08-08, UNREVIEWED).** Post-round-3 repairs applied after
  the round budget closed; both families' final verdicts (NOT READY, all
  MATERIAL findings IN-DELTA, pre-existing text clean in rounds 2 and 3)
  bind to **v0.3**, not this revision. Repairs, addressing the round-3
  union: envelope ordering invariant (an envelope stamped V never
  overtakes an undelivered content frame < V) and envelopes placed under
  §2.5's service bound; `current_as_of` wire-kind claim restated as
  precedent-plus-additive-amendment (§2.1); enqueue-complete frontier
  closes the commit-visibility-vs-enqueue race (§2.2); concrete
  `LiveCoalesceTunables` numbers cited (§2.2); fence restated as
  concurrent scheduler-state marking with a delivery-time authority gate
  (no evaluation wait), idempotent-monotone fence collapse bounding fence
  work by subscription count, and explicit composition with LLP 0008's
  client-side fence/tombstone machinery (§2.4); `max_eval_turn` given
  abandon-the-waiter semantics, a one-retry-then-typed-teardown terminal
  state, and a minimal Phase-1 landing (§2.5, §5); overload degrade
  restated honestly — semantic conversion, teardown as the true capacity
  escape, fail-closed scoped to shrink/resnapshot guarantees (§2.5).
