# LLP 0200: Live evaluation scheduling and settlement isolation (the server-side D4 Spec)

**Type:** Spec
**Status:** Review
**Systems:** Live queries, Performance, Auth, Storage, Client SDK
**Author:** Claude Fable 5 (commissioned by the LLP 0191 author rulings, Charlie Cheever, 2026-08-08)
**Date:** 2026-08-08
**Revised:** 2026-08-26 (§6e draft-pending-review narrowed to this server
owner's V/watermark facts and exact participating-subscription
Data-to-Refresh → pressure hand-off → Refresh-publication ordering; group,
lifecycle, wire evolution, carrier, and episode registry delegated to LLPs
0114/0095/0094/0219/0267; design only). 2026-08-25 (§2.4
declaration-boundary clarification; previously
2026-08-09, when §6d recorded Phase 4 landing and the §5
four-phase program is COMPLETE — quarantine entry/exit observable on
the inspect surface, the §2.6 recovery rule test-pinned with
unresolved-quarantine data/watermark suppression, coalesce counters
truthful under the turn scheduler; open remainders listed in §6d.
Earlier same day: §6c recorded Phase 2 — B-4 root cause corrected via
same-envelope atomic resolution application, the scheduler-era
revocation-obligation-delivery main red fixed forward, authority
transitions made measurable, fence p95 and restoration measured, the
§2.4 restoration target set, split H-3 verdict; §6b recorded Phase 3;
§6a closed the zero-observer commit-turn remainder; v0.4 post-round-3
repairs remain **unreviewed**; final review verdicts bind to v0.3; see
Revision history)
**Related:** LLP 0191 (evidence and ladder), LLP 0008 (live protocol; dated
coalescing decision and authorization-invalidation amendment this Spec
binds to), LLP 0183 (D4 charter this Spec extends), LLP 0012/0043
(ordering and sessions contracts), LLP 0058 (auth-mode deployment state),
LLP 0020 (live matcher), LLP 0070 (runAfter), LLP 0093 (client protocol),
LLP 0094 (wire negotiation and pressure-interest registration),
LLP 0114 (query groups), LLP 0135 (optimistic overlay / withheld changesets),
LLP 0219 (client diagnostic carrier), LLP 0267 (overload episode registry),
`issues/closed/20260808-oq4-coalescing-measurement-spike.md` (measured
basis), `issues/shelved/20260808-live-query-reevaluation-cost-at-scale.md`
(workstream anchor), `issues/shelved/20260808-d2-d4-owner-specs-commission.md`

## 0. Charter

LLP 0183 charters D4 as the *headless windowed-query controller* — a
client-side artifact. The commissioning ticket requires this Spec to either
extend that charter to server-side evaluation scheduling or name the runtime
owner. **This Spec extends the D4 charter**: D4 owns the window/stream
lifecycle end to end, and the server-side evaluation scheduler is the
server half of that lifecycle. The client-side controller remains LLP 0183
scope; this document specifies only the server: when evaluations run, what
the write path promises, what delivery may elide, and how streams recover.
Cross-owner amendments may name client facts that consume these server
outputs, but they do not transfer React/group lifecycle, client state, wire
shape, or diagnostic storage into this Spec. Section 6e is therefore limited
to V/watermark production and the Data-to-Refresh hand-off order.

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

#### Dated clarification — 2026-08-25: the fence is declaration-bound

The Familiar capstone removed a member by patching an `active` field on an
ordinary `public-read` + `sync()` roster. That shape exposed an ambiguity in
the served authoring story, not a new inferred-authority rule. The classifier
above is closed over declared authorization facts: table names, handler reads,
an `active`/`removedAt` convention, or a result that happens to shrink do not
turn an ordinary data commit into an authority transition. Those commits stay
on the data-driven resolution lane.

The retained characterization runs that undeclared shape rather than replacing
it with an authority declaration. Its safer live handler's generated read set
contains both the ordinary roster and messages. The generic removal patch
drives data-lane reevaluation, the handler's persisted server-time cutoff
excludes the later sentinel on both the open and fresh read, and the fence
count does not advance.

A second leg reproduces the capstone's materially different split graph. One
authenticated live query reads only the ordinary `public-read` messages table;
another independently reads the current principal's ordinary membership row;
browser-cutoff logic composes their latest values client-side. The membership
stream reaches `active: false`, while the messages-only stream is expected to
receive the post-removal sentinel because it declared no roster or authority
dependence. The test records, but does not assert, whether callback ordering
temporarily includes that sentinel in the composed view. There is no
cross-subscription order to assert: the two stream-local results are guaranteed
and the composition race is application-owned. This is the reproduction-backed
explanation of the capstone bubble.

A membership/profile transition does create the fence. Its authorization epoch
advances in commit order, so a later data commit cannot deliver a frame under
the predecessor epoch even when quarantine/restoration callbacks have not yet
reached the client. This is the declaration-bound meaning of “subsequent” for
revocation: a write committed after the generated transition settles is on the
post-transition side of the delivery gate; no resnapshot, separate membership
subscription, or browser signal is part of the security condition.

The acceptance evidence separates this gate from application filtering. A
`hasRole('member')` control has no access-window read and no cutoff predicate:
it receives a message under the predecessor role, then quarantines and restores
empty after `member` → `former`, while the owner continues to receive later
messages. A coalescer unit independently fences at epoch 8, rejects an epoch-7
frame without clearing stale state, and restores only on an exact epoch-8
proof. Engine-crate coverage separately evaluates under the predecessor epoch,
installs the successor through `apply_live_authority_fences`, and sends the
stale snapshot through the production `deliver_authorization_snapshot` wrapper;
the wrapper must return before enqueue and leave restoration owed. Those forced
predecessor-frame assertions, not a fixed tail delay or the history predicate,
pin the fail-closed rule and its production call sites.

When a removed principal must retain pre-removal history, the paved composition
is a transition from the delivery role to a non-delivery active role plus an
ordinary persisted cutoff. The application records the cutoff first, then
awaits the generated role transition, then admits later sends. Restoration may
therefore return the pre-cutoff rows without admitting later rows. Generated
`remove` remains the simpler path when history should blank entirely.

Declaring a hand-written roster `permissionBacking()` does not license its old
generic writers. LLP 0274's refusal remains load-bearing: authority tables use
declaration-owned/generated transition operations, while the companion cutoff
stays ordinary application data. A permission-backing declaration broader than
a finite role roster uses its own governed writer; it is not unconditionally
converted to membership. The authoring guide and codegen repair route must make
that boundary discoverable. The current conservative steering is explicitly
same-handler: it requires a principal-scoped read of the exact roster and a
lifecycle-field control dependency on another table result. It neither treats
field names as authority nor claims to discover the capstone's independently
delivered client graph, which the backend artifact does not contain.

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
  lands. **Carve-out: the stream-attempt/job-claim terminal publication
  path keeps job-status fan-out inline.** Its fenced CAS transition,
  job-status publication, and synchronous drain receipt remain one atomic
  control-plane publication; this low-volume path is not the hot data path.
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

## 6a. Phase-1 implementation record (dated note, 2026-08-08)

Phase 1 landed on this date (stages: scheduler + settlement isolation +
fence/gate/classifier; watermark + Contract convergence gating; §3
counters + inspect rotation + obligation-transfer proof; served-suite
migration). Every §5 Phase-1 deliverable shipped; correctness evidence:
full Rust suite green (2914 tests / 102 targets), 13 served acceptance
suites green under Phase-1 semantics, and the receipt-exported revocation
contract (`blankBeforeMutationReturn`) intact ×4 — the fence blanks
inline in the commit turn as §2.4 requires.

**§2.1 ordering-audit outcome (OQ-2 closure).** The audit found ~28
doc-level dependents, two client-code hazards, one server atomic
publication, and ~55 test sites. Dispositions landed with Phase 1: the
Contract package's overlay release is watermark-gated with
version-regression guards; LLP 0135's composite replace frames were
proven already version-truthful (pinned by tests); the
stream-attempt/job-claim publication keeps inline fan-out (OQ-2
carve-out above); served suites migrated to convergence waits; Rust
unit-test drains are unaffected (scheduler absent = inline). One
adjacent main red was found and fixed forward
(`issues/closed/20260808-stream-attempt-terminal-reap-breaks-cursor-signal.md`).

**A/B against the OQ4 baseline (N=1 per arm, shape evidence; arms
preserved under the committed harness):**

- Improvements: burst trigger settle p50 15.3 s vs 45.3 s same-binary
  legacy (~3×); coalescer deferral engaged on 24/24 backlogged commits
  (vs 4/24 pre-Phase-1 — B-2 resolved); sustained-arm settles 155/480 vs
  ~105/480; durable→response leg p50 3.4–7.6 ms (settlement isolation
  works at the response layer).
- **H-1: NOT met.** Settle p50 at six observers is ~15 s, not < 1 s:
  mutations and evaluation turns share the instance lock without write
  priority, so burst settles queue behind interleaved ~0.9 s turns
  (`issues/shelved/20260808-p1-write-priority-scheduling.md` — §2.5's fairness
  content pulled into the immediate remainder). Zero-observer settle
  regressed 171→629 ms (~4× per-commit-turn overhead,
  `issues/20260808-p1-commit-turn-overhead.md`). Fence-applied p95 is
  unmeasured — the hot inventory fires no mid-burst authority
  transitions; the requalification arm needs one.
- **H-2: split.** Deferral-majority clause met (24/24); throughput
  clause not met (sustained settle throughput ≈32% of same-run
  zero-observer capacity, target ≥50%).

Landed default-on per LLP 0189 fix-forward: correctness is proven, the
hot shape improved, and the served suites now encode Phase-1 semantics
(a matcher-skip converges via a watermark that counts as one delivery).
H-1/H-2 requalification (N≥3) happens after the two remainder tickets
close.

**Zero-observer remainder closed (dated note, 2026-08-09).** Profiling
refuted the commit-turn-overhead ticket's scheduler suspects: at zero
observers the scheduler is never woken, and everything after
commit-durable measured 0.26 ms p50 (kill-switched arm equally slow —
the regression was not scheduler-conditional). The measured cause was
the two-turn staged authorization write: a ~29 ms lock-held stage turn
per attempt plus a released-lock stage→commit window in which any
interleaved commit staled every in-flight staged mutation (data-head +
auth-witness snapshot equality), producing a 60%-stale retry cascade
(5.6 attempts per applied commit). Fixed by committing
authorization-neutral preflights in the same Local turn that staged
them (no lock release, no stale window; auth-event preflights keep the
split reservation path; the mispreview fail-closed contract is
unchanged and test-pinned). p1-burst-obs0 settle p50: 629/728 ms
recorded → 139/27 and 83/33 ms (N=2), vs the 171/130 ms pre-Phase-1
baseline — H-1's "zero-observer settle unchanged" clause is now
satisfiable; formal N≥3 requalification rides the Phase-3 exit
measurement. Split-out remainders:
`issues/20260809-mutate-stage-turn-cost-bisect.md` (unconditional
per-turn drift-window slowdown),
`issues/closed/20260809-mutation-facts-turn-extra-lock.md` (post-commit facts
re-lock).

## 6b. Phase-3 implementation record (dated note, 2026-08-09)

Phase 3 (§2.5) landed in three stages plus the Lane C commit-turn fix:

1. **Write priority** — `LiveFanoutCoalescer` carries a writer-visibility
   gate (atomic count + RAII guard + drained notify); the staged
   authorization write holds it across its lock acquisitions (HTTP
   mutations, host-ops function.run, and the mutation-class scoped-token
   authority resolve); the scheduler defers before each subscription turn
   while writers are visible, capped at `max_hold/4` per turn gap. The
   post-commit facts turn was folded into the commit turn (one fewer
   global-lock round trip per applied mutation).
2. **Cancellation + age inheritance** — every pending-entry replacement
   inherits the oldest undelivered `first_deferred_at` and trace frontier
   (continuous supersession cannot reset the clock); within each lane the
   scheduler serves the oldest inherited age; a supersession that discards
   queued work emits a trace-only "superseded" eval event.
3. **Bounds + overload degrade** — selection-time conversion of a
   Data-lane entry whose inherited age exceeds `max_hold` into a
   priority Refresh obligation (fail-closed semantic conversion,
   `SNAPBACK_LIVE_OVERLOAD_DEGRADE` scheduler-health diagnostic +
   trace event); the `max_eval_turn` one-retry-then-typed-teardown
   terminal state and the send-failure teardown escape are now
   behaviorally test-pinned.

**Exit A/B vs the recorded Phase-1 arms (same harness, same 5.5M-row
baseline, N=1 per arm, shape evidence; trigger/non-trigger settle p50 ms):**

| arm | Phase-1 recorded | Phase-3 exit |
|---|---|---|
| burst 6-obs | 15,269 / 42,856 | 1,648 / 1,579 |
| burst 0-obs | 629 / 728 | 38 / 23 |
| sustained 6-obs | 68,127 / 178,705 | 6,761 / 6,533 |
| sustained 0-obs | 35 / 28 | 31 / 26 |

**H-4: met.** Superseded-evaluation cancellations observed (12 burst /
28 sustained trace events); overload degrades observed fail-closed
(12 burst / 1 sustained `overload_degrade` conversions, semantics
test-pinned); no turn exceeded `max_eval_turn` (max observed turn
1.15 s vs 30 s). Staleness bound: holds within capacity by
construction (oldest-inherited-age service + degrade conversion); the
six-observer arms run beyond single-evaluator capacity by design
(6 subscriptions × ~0.9–1.15 s turns per frame wave > `max_hold` 5 s),
so delivery-start ages reached 13.1 s (burst) with degrade conversions
firing — the §2.5 overload scoping (semantic conversion; teardown is
the capacity escape), not a silent violation.

**H-1 re-check: partially met.** Zero-observer settle is restored past
the original baseline (38/23 vs pre-Phase-1 171/130 — the §6a dated
note's fix, plus write priority, held). At six observers settle p50 is
1.65 s (burst) vs the < 1 s target, and commit-ack ≈ settle minus a
sub-millisecond response leg, vs < 250 ms — a ~9× improvement over
Phase 1 that still misses the numeric bar on this hardware. The
remainder is (a) the unpreemptible in-flight evaluation turn a
just-arrived writer waits behind (structural until turn cost falls),
(b) the ticketed drift-window stage-turn slowdown
(`issues/20260809-mutate-stage-turn-cost-bisect.md`), and (c) raw
evaluation cost at 5.5M rows — the D2 sharing/widening ladder, not
scheduling. Fence-applied p95 remains unmeasured (the hot inventory
still fires no mid-burst authority transitions; the requalification
arm still needs one). `issues/shelved/20260808-p1-write-priority-scheduling.md`
is refreshed to carry exactly this remainder. Formal N≥3
requalification per LLP 0189 stays gated on the remainder ticket.

## 6c. Phase-2 implementation record (dated note, 2026-08-09)

Phase 2 (§2.4 remainder + §2.6) landed in three pieces plus a discovered
main-red fix:

1. **B-4 root cause corrected; same-envelope atomic application
   (bc26e015b).** The Phase-1 diagnostic's reading of B-4 ("frames arrived
   without a usable resolution ticket") was imprecise: the recorded arms
   show every data-driven re-resolution envelope already carried
   obligation + usable ticket + snapshot atomically
   (`deliver_authorization_snapshot` raises and issues in one lock step).
   The churn was client-side: one envelope was applied as two observable
   boundary commits — `receiveObligation` committed the quarantine
   disposition (blank + `authorization_quarantine` callback +
   `onUpdate([])`), then `applyResolution` committed the snapshot. Fix:
   the fence gained `deferCommit` + a `commitCurrentDisposition` repair —
   a same-envelope SNAPSHOT resolution defers the intermediate commit and
   the envelope commits once; any failure repairs fail-closed against the
   exact current fence generation. `terminalDelete` proofs never defer
   (revocation blanks at obligation receipt). Obligations without a
   same-envelope resolution — authority transitions, overflow roots,
   reprojection hints — keep the immediate quarantine commit: §2.6's
   narrowing, quarantine marks authority uncertainty only. LLP 0053's
   closed disposition enumeration, obligation merge, queue suspension,
   and ACK custody are unchanged; §2.4's "must carry a usable resolution
   ticket" is test-pinned server-side and the atomic application is
   pinned in the contract and client packages.
2. **Main red found and fixed forward in the same landing:** the
   scheduler path skipped the legacy inline delivery of preprojected
   obligation envelopes, so under Phase-3 write priority the revocation
   blank lost the settle race and the receipt-exported
   `blankBeforeMutationReturn` contract broke
   (`tests/acceptance/require-role-live-revocation.mjs` red at clean
   65064cd3a; green with `SNAPBACK_LIVE_SCHEDULER_DISABLED=1`). The
   fail-closed obligation projection publication is §2.4's cheap
   security step and now publishes inline in the commit turn on both
   paths; restoration stays on the authority lane. Suite green ×4 after
   the fix
   (`issues/closed/20260809-main-red-scheduler-defers-revocation-obligation-delivery.md`).
3. **Authority transitions are now measurable on the A/B inventory
   (d885c5a8f):** a probe membership table + alternating
   grant/revoke mutations (permission-backing writes that change no
   observer's access), a `--authority-transitions` harness arm, an
   authority-fixture derivation script, and the analyzer's
   fence/restoration decomposition (fence p95 from trace events per the
   Phase-1 stage-3 note).

**Exit A/B (pinned post-landing binary, same 5.5M-row baseline, N=1 per
arm, shape evidence):**

| arm | quarantine callbacks (before → after) | settle p50 t/nt ms | conv p50 first/last ms |
|---|---|---|---|
| burst 6-obs | 24 → **0** | 1719 / 1652 | 4972 / 14577 |
| sustained 6-obs | 135 → **42** | 6343 / 6458 | 5959 / 17691 |
| burst 0-obs | — | 37 / 24 | — |

The sustained arm's 42 residual quarantines are not delivery-caused: every
delivery now commits exactly once (104 snapshot commits, all but the
initial six carrying ack tickets), and the residue is isolated
obligation-only frames (no same-envelope proof — reprojection/backpressure
hints under sustained load) each restored by the next delivery. Whether
those hint frames should carry the current ticket or ride LLP 0053's
retain producer is
`issues/shelved/20260809-sustained-reprojection-hints-still-quarantine.md`.

Authority arm (burst 6-obs, 4 mid-burst transitions 1.5 s apart):
fence-applied p95 **0.09 ms** across 20 per-subscription markings
(target ≤ 500 ms — met by more than three orders of magnitude; marking
is registry mutation, no evaluation). Restoration latency per
(epoch, subscription): p50 **4598 ms** / p95 **6959 ms** / max
**8067 ms** across the 6 restorations that ran to completion — the other
14 fences were superseded by newer transitions before their restoration
started (§2.4's latest-authority-wins collapse, working as specified);
0 stale-authority frame discards. The authority arm's 31 quarantine
callbacks are §2.6-correct (authority uncertainty until restoration) and
excluded from the data-only clause by construction.

**Phase-2 numeric restoration target (§2.4):** restoration p95 ≤ 10 s
per subscription under the six-observer burst arm at the 5.5M-row
baseline (N=1 basis: measured p50 4.6 s / p95 7.0 s / max 8.1 s;
structural bound = sub-ms fence + authority-lane queue position +
~0.7–0.9 s per-subscription turns; tightens as D2 sharing/widening
reduces turn cost).

**H-3 verdict: split.** The zero-quarantine clause is **met on the
burst instrument** — zero `authorization_quarantine` callbacks on
ordinary data delivery (teardown deletes excluded; the sustained arm's
42 non-delivery-caused hint-frame quarantines are disclosed above and
ticketed). The restoration clause is **met** — the distribution is
measured and the numeric target set. The convergence clause is **not
met**: six-observer burst full-convergence p50 14.6 s vs the same run's
serial-evaluation floor 6 × 717 ms = 4.3 s — unchanged in shape from
Phase 3 (13.9 s), because convergence under a 16-mutation burst is
evaluation-cost × wave-depth bound; the remainder is raw evaluation
cost at 5.5M rows (the D2 sharing/widening ladder), the same structural
residue H-1's settle clause carries. Formal N≥3 requalification per
LLP 0189 remains gated on the H-1 remainder ticket.

## 6d. Phase-4 implementation record and program closure (dated note, 2026-08-09)

Phase 4 (§2.6 lifecycle closure + the §3/§5 deferred remainder) landed:

- **Quarantine entry/exit are observable events on the inspect surface.**
  `LiveAuthorityLaneStats` gains `quarantineEntries` (first transition of
  a live subscription scope into an active quarantine-or-worse
  obligation; revision merges into an already-quarantined scope do not
  double-count) and `quarantineExits` (exact revision-bound ACK
  discharging an accepted resolution); the spike trace emits matching
  `quarantine_entry`/`quarantine_exit` fence events; the serialized
  inspect schemas rotated once more (§3's accepted cost).
- **The §2.6 recovery rule is test-pinned**
  (`quarantined_resubscribe_stays_fail_closed_until_accepted_authority_proof`):
  resubscribe triggers re-resolution but the stream stays quarantined —
  ordinary data deltas and standalone convergence watermarks are
  suppressed server-side while a quarantine-class obligation is
  UNRESOLVED (no issued resolution covering its current revision);
  recovery only via the accepted proof's delivery and exact ACK.
  Proof-in-flight windows (an issued resolution riding to the client —
  ordinary ACK lag on data-driven refreshes) deliberately do NOT
  suppress: that is §2.4's data-driven classification, not authority
  uncertainty.
- **The Phase-1 stage-3 coalesce-counter residue is fixed:**
  `coalescedFlushes` counts scheduler turns that merged more than one
  commit, `backstopFlushes` only turns the serving backstop task
  executed (a distinct entry point), and `lastFlushMergedFrames` is the
  latest turn's accepted frame count — the counters are truthful under
  the turn scheduler.

**The four-phase program of §5 is complete.** All phases landed
default-on, A/B'd, fix-forward per LLP 0189. Open remainders, by owner:

- H-1 numeric remainder + N≥3 requalification of H-1/H-2/H-3/H-4
  (`issues/shelved/20260808-p1-write-priority-scheduling.md`): the
  unpreemptible in-flight turn and raw evaluation cost are D2-ladder
  scope; the stage-turn bisect is
  `issues/20260809-mutate-stage-turn-cost-bisect.md`.
- H-3 convergence clause (evaluation-cost bound; D2 sharing/widening).
- Sustained-load hint-frame quarantines
  (`issues/shelved/20260809-sustained-reprojection-hints-still-quarantine.md`).
- OQ-1 (hosted DO profile mapping), OQ-3 (watermark wire economics at
  high commit rates), and the OQ-4 owner-document review remain open
  spec questions; v0.4's post-round-3 repairs remain unreviewed.

## 6e. Draft amendment (2026-08-26) — own-write atomic composition gate

**DRAFT-PENDING-REVIEW — design only.** This amendment has not been accepted
and changes no served protocol or client behavior. It is the proposed closure
mechanism for Wanted #4 in
`issues/shelved/20260820-familiar-live-subscription-contention.md`, after the
2026-08-25 review retracted the commit-relative five-second client timer. An
implementation round may begin only after this amendment survives review.

This amendment is intentionally limited to this server Spec's charter. It owns
only (a) the committed revision V and per-subscription watermarks already
defined in §2.1 and (b) the ordering cut around §2.5's existing
Data-to-Refresh conversion. LLP 0114 owns query-group semantics, LLP 0095 owns
client/subscription lifecycle, LLP 0219 owns the negotiated carrier and client
event, and LLP 0267 owns the overload-episode registry and inspection join.
Nothing below enlarges this Spec into a React, client-state, wire-shape, or
diagnostic-storage owner.

### Decision and deliberately narrow claim

Choose the ticket's option **(c): deliberately gate a defined atomic
composition surface**. The proposed LLP 0114 surface consumes two facts from
this Spec and no others:

1. a committed settled mutation supplies the exact storage revision V from
   §2.1's server-issued disposition; no client counter or inspection snapshot
   may synthesize it; and
2. every subscription can prove coverage through V by accepted content or the
   §2.1 `current_as_of(V)` watermark, including matcher skip and value-equal
   paths.

This Spec continues to promise only independently versioned, latest-value
subscriptions. The opt-in cross-subscription publication claim and all
pre-transport acquisition, bounded hold, generation, staging, refusal, and
external-store behavior are the dated LLP 0114 amendment. Ordinary callers
remain unchanged under §2.3.

### Server conversion and hand-off ordering

The sole pressure producer is the same semantic event §2.5 already owns:
`select_pending_live_subscription` converts an over-age pending Data entry to
the priority Refresh obligation and records
`SNAPBACK_LIVE_OVERLOAD_DEGRADE`. At that exact off-commit scheduler seam, the
server performs the LLP 0267 episode transition and requests the LLP 0219
durable pressure hand-off.

Grant negotiation alone does not enter the new path. Before allocating an
episode, the conversion must find the exact LLP 0094 pressure-interest pair on
that subscription registry row. If it is absent or stale, conversion follows
the pre-amendment §2.5 path byte-for-byte: no LLP 0267 episode transition, no
pressure enqueue, and no pressure-caused client/public notification.

For an exactly negotiated connection and exactly interested subscription,
ordering is normative:

```text
Data-to-Refresh conversion
  < LLP 0267 episode allocate/extend
  < LLP 0219 pressure durable-enqueue success
  < converted Refresh LiveEvaluationControl::begin_publication()
```

The Refresh cannot enter publication when the pressure enqueue fails; it takes
§2.5's typed `resync_required`/teardown capacity escape. The hand-off never
runs in the commit turn, so settlement remains decoupled under §2.1. LLP 0219
owns the durable `LiveEnvelope` shape, per-subscription FIFO, negotiation,
both-lane carriage, and enqueue-failure projection. LLP 0267 owns episode
allocation, reuse, coverage, transfer, and clearing.

After the real conversion has created the episode, every strict
`coverageThrough` raise is a new logical pressure enqueue before the Refresh it
covers, including a coalesced/latest-value supersession that adds a newer owed
revision without another conversion. The durable queue may replace an
undelivered older projection in place under the same episode key only if it
preserves the older FIFO position and records the higher coverage as the
successful enqueue; coalescing with no coverage raise performs no pressure
enqueue.

### Healthy convergence cannot trigger the warning

The producer is the §2.5 semantic conversion, not client elapsed time,
revision skew, `server-pending`, or an inspection snapshot. Ordinary queued,
coalescing, evaluating, in-flight transport, and commitless restoration states
therefore remain silent.

Section 2.5 permits delivery start at `max_hold + one in-flight turn` and
end-to-end convergence at that bound plus one `max_eval_turn` and transport
while demand is within capacity. A subscription may therefore still be
uncovered when a client clock first reaches five seconds; that fact alone
produces nothing. The within-capacity Data path does not record an overload
conversion or invoke either owner hand-off. A client clock reaching five
seconds cannot enter the producer.

### Ordering claim exported to the client owners

This Spec does **not** claim that pressure precedes every child delivery. That
claim is false when an earlier sibling internally delivers before a later
subscription reaches conversion. The server exports only the conversion-to-
enqueue-to-Refresh order above. LLP 0219/0114 compose it into the narrower
**diagnostic-before-post-gate-group-notify** invariant; subscription-internal
advances and ordinary independent consumers may precede the diagnostic.

Group replacement, bounded-hold expiry, staging, security preemption, and the
typed blank boundary are LLP 0114/0095 lifecycle rules, not this scheduler
Spec's publication rules.

T-RECONNECT's HTTP snapshot ordering is likewise outside this queue: LLP 0094
requires any transferred current/transferable episode to ride the subscribe
response and be applied before its successor snapshot. An episode allocated
after that establishment cut returns to the durable order above.

### Required acceptance

This owner requires the integrated acceptance trace to prove that the actual
`select_pending_live_subscription` Data-to-Refresh branch produced the episode
hand-off, the pressure durable enqueue succeeded before the converted Refresh
crossed `begin_publication()`, and enqueue failure suppressed that Refresh and
took typed resync/teardown. It must also prove a strict coalesced coverage raise
performs the logical enqueue/position-preserving replacement and an equal
coverage coalesce does not. The silent controls must exercise both bounded Data
work and overload conversion on a negotiated-but-uninterested subscription and
show no episode hand-off. LLP 0094/0095/0114/0219 add the live, poll,
duplicate/reconnect, group-generation, bounded-hold, and client-notification
assertions.

### Compatibility and rejected shapes

Legacy/non-opted subscriptions keep §2.3's ordinary independent service and do
not take the pressure hand-off. An exact grant without an exact current
subscription-interest witness is non-opted for this purpose. The negotiation, query-state addition,
group refusal, `PublicInspect`, hosted, and telemetry postures are owned by the
companion amendments; this Spec makes no new claim for them.

The following stay rejected:

- any fixed or adaptive client timer — it can fire after partial publication
  and inside §2.5's healthy interval;
- warning on revision skew or W5 `server-pending` — both are normal for
  independent subscriptions;
- polling `app.inspect` or recorder rings — the pull is not causally aligned
  with publication and can return snapshot-skew;
- a per-subscription overload event without the group gate — an earlier
  sibling may already have published;
- default gating of every independent query — it would silently replace the
  shipped latest-value contract; and
- scheduler parallelism/capacity changes — they may improve latency but do not
  define the diagnostic ordering contract.

Implementation, if these amendments are accepted, must co-land the LLP 0095,
0114, 0219, and 0267 owner contracts. No such implementation is present or
authorized by this draft.

## 7. Non-goals

Incremental view maintenance, delta-fed replicas, matcher vocabulary
widening, cross-principal shared evaluation, multi-process realtime, and
any change to the one-authority-per-app storage contract (LLP 0007/0128).

## Revision history

- **v0.6 (2026-08-26, DRAFT-PENDING-REVIEW; revised after deep review).**
  Exports only §2.1's V/watermark facts and the real Data-to-Refresh → episode
  hand-off → pressure enqueue → Refresh-publication server order, with a
  silent within-capacity control and real-producer acceptance. Group,
  lifecycle, carrier, and registry semantics moved to LLPs
  0114/0095/0219/0267. Design only; no served contract or implementation
  changes until accepted.

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
- **v0.5 (2026-08-25, UNREVIEWED).** Clarified that LLP 0200 fences only
  declared authority transitions: ordinary roster conventions remain data
  events. Recorded both the no-leak same-read-set characterization and the
  capstone-faithful split membership/messages characterization, with the
  latter's cross-stream ordering left explicitly application-owned; separated
  a no-cutoff membership control from the retained-history filter; pinned
  predecessor-frame rejection at the engine delivery wrapper; and recorded
  the generated former-role plus ordinary-cutoff composition for retaining
  pre-removal history without post-removal delivery (§2.4).
