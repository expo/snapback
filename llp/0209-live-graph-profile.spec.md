# LLP 0209: The bounded live graph profile — precision, shared evaluation, and incremental maintenance (the D2 owner-Spec)

**Type:** Spec
**Status:** Draft
**Systems:** Live queries, Relational queries, Schema, Auth, Performance, Client SDK
**Author:** Claude Fable 5 (commissioned by the LLP 0191 author rulings, Charlie Cheever, 2026-08-08)
**Date:** 2026-08-09
**Revised:** 2026-08-16 (v0.3 — D2-H1 measured; G1 key recorded as
session-exact; Status remains Draft)
**Related:** LLP 0183 (D2 charter this Spec owns), LLP 0191 (evidence and the
five-rung ladder), LLP 0200 (the D4-side sibling: scheduling/settlement;
measured Phase-1 record in its §6a), LLP 0008 (DK-3 `live_delta` precedent,
authorization-invalidation amendment, scheduler/coalescing dated decisions),
LLP 0020 (captured-dependency matcher), LLP 0056 (membership rules),
LLP 0080/0100/0110/0155 (current bounded relational plans and composition),
LLP 0170 (information flow), LLP 0190 (D3 seams; §4's authority question this
Spec shares an answer with), LLP 0007 (query semantics, order/tie-break),
`issues/closed/20260808-oq4-coalescing-measurement-spike.md` (measured basis),
`issues/20260808-live-query-reevaluation-cost-at-scale.md` (workstream anchor),
`issues/20260808-d2-d4-owner-specs-commission.md` (charter source)

## 0. Charter and position

LLP 0183 §D2 charters the *bounded relational graph profile*: generated,
bounded relational graphs replacing application-code joins, with declared
bounds, authorization at every node, and a conformance corpus. The LLP 0191
author rulings (2026-08-08, OQ1) commission this owner-Spec with rungs 2–4 of
§1's five-rung ladder as required content; rung 5 (delta-fed local replicas)
is *referenced* D3 scope reached through the D2–D3 interface in §8, not owned
here. Per LLP 0191 §5's decision, this Spec keeps what is architectural — the
finite graph IR, authorization at every node, affected-query dependencies,
completeness vocabulary, and server/local evaluator agreement — while the
schema-fidelity quick wins and the compiler prerequisite land independently
through their own owners: stored literal-union enums and structured
route-group argument lowering have since landed via the 2026-08-08 ticket
sweep, and numeric identity/default columns remain author-gated on the
identity-architecture decision
(`issues/20260808-identity-architecture-decision.md`). None of those are
D2 content.

The D4-side sibling, LLP 0200, owns evaluation scheduling, settlement
isolation, the authorization-lane split, and stream lifecycle (rung 1). The
two Specs are deliberately decoupled: LLP 0200 §5 records that rung 2 and
rungs 4–5 are not blocked by, nor blocking, its phases, and this Spec makes
the same commitment from its side. Where this Spec's mechanisms meet the
scheduler (memoization in §6, delta emission in §7), they slot into LLP 0200's
turn/frame machinery without changing its contracts.

## 1. Measured basis (what sizes this Spec)

All numbers are N=1 shape evidence under `benchmarks/protocol.md` unless
stated; sources: the OQ4 spike disposition
(`issues/closed/20260808-oq4-coalescing-measurement-spike.md`, twelve A/B
arms at the 5,549,113-row store) and LLP 0200 §6a (the Phase-1
implementation record and its A/B against the same baseline).

- **E-1 — evaluation cost is the unit everything multiplies.** One
  subscription evaluation at 5.5M rows: p50 863 ms, max 3.6 s (spike);
  the bounded list-engine run measured ~1.3 s standalone
  (`zb5-large.v3`). Six-observer arms delivered ~61–68 MB of frame bytes
  (full 1,000-row windows, replace lane, **zero** delta-lane deliveries —
  the hot queries are auth-scoped and relational, shapes today's
  `live_delta` lane excludes).
- **E-2 — matcher precision is already good on the measured inventory.**
  144 matcher decisions per six-observer arm: 75 match-replace, 69 skip,
  **0 conservative fallbacks, 0 delta**. The skip rate matched the
  receipt's 8-trigger/8-non-trigger partition; the 21 disagreements with
  predeclared relevance were the *predeclaration's* errors (18 ×
  `label.createAndAddToIssue`, which writes the `issueLabel` edge the
  list query joins — waking is correct; 3 × `viewState.set` waking only
  the writing principal's own observer — per-principal precision already
  working).
- **E-3 — sharing headroom is measured, not hypothesized.** Six
  same-partition observers (one principal, six subscriptions of the same
  query) cost the same as six mixed-partition observers (trigger settle
  p50 34.6 s coalesce-on / 40.4 s off): no sharing exists today, so
  same-authority memoization has clean ~6× headroom on this shape.
- **E-4 — after LLP 0200 Phase 1, per-turn evaluation cost is the binding
  constraint.** Phase 1 moved fan-out off the commit turn: burst trigger
  settle p50 15.3 s vs 45.3 s same-binary legacy (~3×), coalescer
  deferral 24/24 (vs 4/24), sustained settles 155/480 (vs ~105/480),
  durable→response p50 3.4–7.6 ms. But its H-1 was **not** met — settle
  p50 at six observers is ~15 s, not < 1 s, because mutations queue
  behind interleaved ~0.9 s evaluation turns — a scheduling-policy
  remainder (write priority,
  `issues/20260808-p1-write-priority-scheduling.md`) that LLP 0200 owns,
  multiplied by a per-turn cost only this Spec's rungs reduce. Whatever
  the D4 remainder recovers on settle latency, queue drain and
  convergence stay bounded by turn count × turn cost; making turns fewer
  (rung 3) and cheaper (rung 4) is this Spec's remit.

The leverage order these facts impose: **rung 3 first** (integer-factor
measured headroom, mechanism-cheap), **rung 4 where admitted shapes are
measured-hot** (orders of magnitude, but only for declared shapes),
**rung 2 demand-gated** (zero measured headroom on the hot inventory —
§5 says so plainly and scopes accordingly).

## 2. The graph IR

The profile is a **finite, acyclic, closed** intermediate representation.
An admitted graph is data, not code: no callbacks, no recursion, no
data-dependent graph construction, no unbounded child expansion, no
client-supplied ASTs (LLP 0183 §D2's exclusions, normative here).

**Node kinds** (the 0183 §D2 investigation list, made the v1 surface):

- one bounded **root window**: portable filters, stable multi-field order
  with the ascending `_id` tie-break (LLP 0007), keyset cursor, `take`;
- **equality to-one** relations;
- **bounded, parent-indexed to-many** relations;
- **exists/semi-join** nodes, including bounded repeated existence
  (all-selected-labels filtering) and declared through-tables;
- **principal-bound** relations, whose predicate binds the
  server-derived principal to private state (`viewState`, notification
  state);
- **admitted search membership** from D6 (an opaque membership input
  with a declared identity, not a re-implemented search);
- a **closed nested projection** over the above.

**Declared bounds.** Every admitted graph declares root, examined-entry,
relationship, fanout, argument, byte, summed-window, and maintained-write
bounds, sized from the normal and large fixtures — current ceilings are
not blindly reused (LLP 0183 §D2).

**Identity, two-layered.** Every admitted graph has a closed,
content-addressed, host-recomputed **plan identity** — the normalized
graph shape: nodes, projection, declared bounds, authority
classification (§3), result-contract identity — and every evaluation is
addressed by an **instance identity**: plan identity × canonical args ×
window/range identity. These are the LLP 0190 §4.1 admission-record
axes split into their stable and per-demand halves. The identity pair
is consumed by server execution, affected-read matching, memoization
keys (§6), delta emission (§7), retention and local evaluation (D3, via
§8), and inspection. The client's demand supplies args and window
values; both identities are host-recomputed from the admitted plan, and
the client can author neither the plan nor the admission
(LLP 0190 §3.3).

**Dependencies are part of the IR.** Each node kind defines the captured
read dependencies its execution contributes (§5). A graph plan without
per-node dependency capture would regress affected-read precision exactly
where the profile adds joins — today's two-source relational plans match
table-granularly by design (`src/live_matcher.rs`: a commit touching
either declared source resnapshots; LLP 0080 §4), which is honest for two
tables and unacceptable for a 22-relation graph.

## 3. Authorization at every node

LLP 0170 continues to govern; this section binds it to the IR.

- A visible parent does not make a child visible. Hidden rows may not
  affect an observable result, order, length, existence bit,
  completeness claim, search membership, or caller-visible hydration
  behavior unless policy explicitly admits that channel. Opaque handler
  assertions do not constitute mechanically proved protection.
- **Every node declares its authority-dependency class**, checked by the
  compiler, not asserted by the author:
  1. **authority-independent** — the node's rows and membership are
     invariant across principals and partitions (public data);
  2. **partition-scoped** — varies with the authority partition (role,
     project membership) but not the individual principal within it;
  3. **principal-scoped** — binds the server-derived principal
     (`viewState` and friends).
- **Classification is proved, not trusted.** The §9 conformance corpus
  includes paired-world rows — the same admitted graph evaluated against
  fixture pairs differing only in rows the policy hides — asserting the
  observable result, order, length, existence bits, completeness labels,
  and refusal reasons are identical across the pair (the LLP 0170
  discipline made mechanical). A node whose declared class the paired
  worlds falsify fails admission, not review.
- The per-node classification rolls up to the graph's **authority
  partition identity**: an owner-computed function of the policy inputs
  the partition-scoped nodes declare, versioned by LLP 0008's
  authorization-invalidation vocabulary (declared `permissionBacking`
  writes and the enumerated session/lease/grant/revocation events advance
  it). Two subscriptions share a partition iff this identity matches at
  the same authorization version.

This classification is load-bearing three times over: it is the §6 memo
key's soundness argument, it is the "authority-independent base"
declaration that alone can ever unlock cross-principal sharing, and it is
the answer to the trust question LLP 0190 §4 poses for projected facts —
*evaluated under whose authority?* Per LLP 0191 rung 3, the two designs
share this one answer rather than inventing two.

Authority *transitions* are not this Spec's concern: the fail-closed
fence, restoration scheduling, and quarantine lifecycle are LLP 0200
§2.4/§2.6 contracts and apply unchanged to graph subscriptions.

## 4. Completeness vocabulary

The result vocabulary distinguishes (LLP 0183 §D2, normative):

- `unknown` — useful facts exist without a sufficient proof;
- `complete` — the entire named graph at one
  authority/plan/args/version;
- `prefix` — only when ordering and continuation prove a stable prefix;
- `window` — a complete named interval without a whole-query claim;
- `refused` — with a stable reason.

Binding rules this Spec adds: every label is claimed *at* an
(instance identity, authority partition, version) tuple and
is meaningless without it; `prefix` requires the declared order including
the tie-break plus a keyset continuation proof; a delta-maintained result
(§7) carries the same label it would carry freshly evaluated, enforced by
the §7 convergence assertion; and a local evaluator (§8) must reproduce
the label exactly or answer `unknown` — a downgraded label is honest, an
upgraded one is a conformance failure.

## 5. Rung 2 — affected-read precision: extend and measure

**What exists** (grounded in `src/live_matcher.rs`, LLP 0020 Phase 4):
subscriptions capture read dependencies at evaluation — `Row`/`MissingRow`
point reads, `Query` dependencies carrying the serialized plan predicate,
order, limit, result count, and the window **boundary** (first/last sort
key plus a completeness bit), membership dependencies for declaration-bound
semi-joins (LLP 0056), and auth-scope disjointness summaries for Ibex
handlers. The matcher skips a commit only when every changed row is
provably disjoint from every captured dependency; everything unprovable
takes the conservative replace fallback. Since LLP 0200 Phase 1, every
disposition is recorded in the permanent matcher-decision ledger
(`LiveMatchOutcome` → skip / match / conservative-fallback counters on the
stats surface) — the spike's counter instrument, now a product surface.

**What the evidence says: rung 2 is not the near-term bottleneck.** E-2 is
unambiguous — on the hot inventory the matcher took zero conservative
fallbacks and its skip set matched the trigger partition; the only
"misses" were errors in the human predeclaration. The expensive problem is
what happens *after* a correct match (one full re-evaluation per
subscriber), not deciding whether to match. **This Spec therefore scopes
rung 2 as extend-and-measure, not build** — the commission's own
post-spike instruction ("rung 2 is not the binding constraint"): no
speculative precision machinery lands on the single-table path, and no
rung-2 work is scheduled ahead of §6. The widening axes the commission
names — joins, ranges, windows, authority partitions — are all specified
below; joins land with the IR because omitting them would *regress*
precision, while the rest are gated on ledger evidence.

**Required now, with the IR (not speculative — it prevents a regression):**
per-node dependency capture for graph plans, specified in §2. Each node
kind contributes the captured vocabulary it already has a precedent for:
root windows contribute predicate + boundary dependencies (the existing
`Query` vocabulary); to-one and to-many relations contribute
parent-indexed edge dependencies (table, join field, bound parent keys);
semi-join nodes contribute membership dependencies (the LLP 0056
mechanism, unchanged); principal-bound nodes contribute field-scope
dependencies (the `viewState.set` precision E-2 shows working); search
nodes stay table-granular until D6 supplies versioned invalidation facts
(OQ-4). The match/skip/fallback ledger reports **per node kind** so
coverage is measurable per the commission's requirement.

**Demand-gated (the widening this rung names, deliberately unscheduled):**
range/index intersection beyond the captured boundary, join-selectivity
proofs, and authority-partition-aware skipping (a commit provably confined
to partition P need not wake partition Q's partition-scoped nodes). The
gate is measured, not aesthetic: a real workload — the general shape LLP
0191 names, many subscriptions over *different* data, where sharing
collapses nothing — in which the decision ledger shows wake-rate ×
evaluation-cost material *and* attributes it to fallbacks or provable
false wakes. No widening lands without before/after ledger evidence on
the A/B harness.

## 6. Rung 3 — same-authority-partition memoization first

**Mechanism.** The evaluation scheduler memoizes evaluation results keyed
by **(instance identity, authority partition identity, evaluation cut
version)** — every component owner-computed (§2, §3; LLP 0200 §2.2's
atomic cut supplies the version). When N subscriptions
share the key, one evaluation turn produces one result consumed by N
per-subscription deliveries. E-3 measures the headroom at ~6× for the
same-partition six-observer shape: six serialized ~0.9 s turns become one
turn plus delivery.

**Soundness.** The key is exactly the tuple the completeness vocabulary
already claims results at (§4), so a memo hit delivers bytes the
subscriber's own evaluation would have produced — same instance, same
partition, same version, same label. Principal- and policy-ambience is why nothing weaker
is safe: LLP 0191 rung 3 records that an opaque handler partitioning
before counting cannot be evaluated under a super-principal and projected
afterward. The IR makes the ambient inputs declared inputs; the partition
identity makes "same authority" checkable instead of assumed.

**Invalidation is the matcher, not a second system.** A matcher wake for
any subscription holding the key retires the memo entry (the key's cut
version is superseded); an authority transition fences subscriptions and
thereby the entries their partition identity depends on (LLP 0200 §2.4's
fence semantics, unchanged). There is no TTL and no separate cache
coherence protocol to get wrong.

**Placement.** Memo entries live in the scheduler beside the pending-frame
structures, bounded (entry count and byte budget declared per instance,
overflow evicts oldest — eviction only costs a re-evaluation). Frames,
watermarks, obligations, and ordering are per-subscription and unchanged;
a memo hit skips the *turn*, never the delivery or its
witnessed-shrink/obligation accounting (LLP 0200 §2.4).

**Scope honesty.** The memo collapses only identical
(instance, partition) tuples. The hot inventory's *mixed*-partition six
observers gain nothing from this rung — their lever is §7 where the shape
admits it, or D3's retained facts. This rung is first because it is
mechanism-cheap (a cache with matcher-driven invalidation) against
measured integer-factor headroom, not because it solves the general case.

**Cross-principal sharing is gated, not designed here.** It becomes
credible only after a graph declares an authority-independent base (§3
class 1) with separately evaluated partition/principal overlays —
evaluate the base once under no principal's authority, then overlay
per-partition. This Spec names the gate and the shared answer with
LLP 0190 §4; designing the overlay evaluator is future work that must not
precede the classification's existence.

## 7. Rung 4 — incremental maintenance for admitted shapes (extending DK-3)

**Precedent, load-bearing.** LLP 0008 DK-3's `live_delta` lane is the
existing admitted-shapes IVM: single-table `HostPlan` queries classify
changed rows against the captured predicate and membership (no re-query,
no VM), emit `add`/`update`/`remove` ops as an additive wire kind, and
keep `live_replace` as the honest fallback. Its guards are the design
pattern this rung extends: conservative eligibility (only where
classification is exact), the **debug-build convergence assertion**
(delta-maintained membership must equal a fresh evaluation's — the L4
parity pattern), the **matcher/SQL agreement invariant** (the predicate
evaluator and the SQL `WHERE` must agree on every operator — the NULL
three-valued-logic HIGH), last-change-per-row-id collapse, and fail-closed
exclusion of membership-gated plans until proven (LLP 0067 §F2a).

**Extension: per-node-kind delta rules over the IR.** Eligibility grows
node kind by node kind, never generically:

- root windows: boundary-aware classification — the captured first/last
  sort keys and completeness bit (already in the dependency vocabulary)
  decide whether an op is inside the window, displaces the boundary, or
  falls outside; boundary displacement without a provable replacement row
  falls back to replace;
- equality to-one: row-keyed patch of the projected parent field;
- bounded to-many: parent-indexed insert/remove/update within the
  declared fanout bound; bound overflow falls back;
- semi-joins: membership-delta classification lands only behind the
  certified evaluator LLP 0056 already names as the condition — until
  then semi-join nodes pin their graph to replace, fail-closed;
- principal-bound nodes: their effective partition is the principal
  itself (partition-of-one) unless OQ-3 rules a coarser identity, so
  their deltas never cross principals by construction;
- search-membership nodes: never delta-maintained by this Spec; D6's
  writer owns their invalidation facts (OQ-4).

Each admitted node rule ships with its own convergence assertion and
conformance rows; a graph's delta eligibility is the conjunction of its
nodes' — one ineligible node pins the whole graph to replace, because a
frame is one graph result, not per-node fragments.

**Authorization-lane interaction.** Deltas ride the data-driven lane
only. Authority transitions are never delta-maintained — the fence and
restoration own them (LLP 0200 §2.4); a subscription resynced while
changes are pending is pinned to replace (LLP 0008's dated decision,
unchanged). A delta frame must carry the same resolution-ticket and
watermark obligations as any other frame.

**Opaque handlers stay re-run.** The no-IVM categorical is scoped to
opacity (LLP 0191's repaired framing): opaque JavaScript handlers cannot
be incrementally maintained, only re-run — and re-run plus rung-1
scheduling plus §6 memoization is a legitimate stable resting point, not
a waypoint (external prior art, non-load-bearing: Convex reportedly
stopped exactly there). This rung is the expensive one; it lands only
where the ledger shows an admitted shape's re-run cost × wake rate still
dominating after rungs 1 and 3.

## 8. Server/local evaluator agreement (the D2–D3 interface; rung 5 referenced)

D3 (LLP 0190) consumes owner-issued identities; it cannot infer a plan
from result bytes or add a graph node to make a retention experiment pass
(LLP 0190 §3.3). This Spec's side of that seam:

- **One IR, two evaluators.** A local evaluator for admitted graphs runs
  the same IR under the same authority classification and produces
  byte-identical results and identical completeness labels, or answers
  `unknown`. Conformance is corpus-based: the same corpus rows the server
  execution qualifies on (§9 G0), evaluated locally, compared exactly —
  the LLP 0008 DK-3 convergence-assertion discipline applied across
  runtimes.
- **Identity-stamped deltas, with an honest replica boundary.** §7's
  delta frames carry (instance identity, partition, version) so a
  retained-fact carrier can know exactly what a frame claims. A retained
  fact plus an ordered delta stream *is* the local replica — rung 5 —
  and it is D3's to build. But this Spec does **not** yet define the
  replica **continuity contract**: LLP 0200 §2.3's latest-value delivery
  may elide intermediate states, so replica application additionally
  needs per-frame base-version/predecessor stamping, cumulative (not
  compositional) delta semantics or a declared continuity mode, and a
  gap-to-replace rule — the LLP 0191 §2 replica-needs list. That
  contract is designed jointly at this seam when D3 takes up rung 5
  (OQ-6). Until then, §7's deltas are safe for live windows (each frame
  is convergence-asserted against fresh evaluation) and are *not*
  claimed replica-applicable.
- **Refusal parity.** A graph the server would refuse (bounds, policy,
  admission) must refuse identically locally; `refused` reasons are part
  of the conformance corpus.

## 9. Sequencing and measurement (what lands first, and how it is measured)

Instrument: the preserved spike harness
(`spike/oq4-coalescing-measurement` branch — per-arm APFS clones of the
5.5M-row baseline, minutes per arm;
`demos/zerobugs/control/scripts/run-oq4-arm.sh`/`run-p1-ab.sh`) for
per-phase A/Bs, plus the zb5-hot gate for requalification, fix-forward
per LLP 0189. Hypotheses are shape targets; N≥3 per
`benchmarks/protocol.md` before any published claim.

- **G0 — IR, identity, vocabulary, corpus (first; no runtime semantics
  change).** Specify the node kinds, bounds, authority classification,
  and plan identity; compile the Zerobugs issue-list and issue-detail
  queries (the control's corpus, per LLP 0191 §5) to admitted graphs or
  explicit refusals; freeze the conformance corpus (results, labels,
  refusals) against the oracle. Exit: corpus compiles/refuses with
  host-recomputed identities; **declared bound values sized from the
  normal and large fixtures** (LLP 0183 §D2's sizing requirement — this
  draft deliberately pre-commits no numbers, and G0 cannot exit without
  them); per-node dependency capture specified for every admitted node
  kind; the §3 paired-world authorization rows present in the corpus.
  (OQ-1's grammar ruling is a G0 input.)
- **G1 — same-partition memoization (rung 3), behind a kill switch.**
  Scheduler memo keyed per §6, `SNAPBACK_LIVE_EVAL_MEMO_DISABLED=1` as
  the control arm. **D2-H1:** on the same-partition six-observer burst
  arm, trigger settle p50 within 2× of the one-observer arm (vs ~6×
  serial today) and evaluation count ≈ one per drain cycle (vs six);
  mixed-partition arm unchanged; oracle-exact rows throughout. This
  phase does not require G0's full profile, but its pre-G0 scope is
  deliberately narrower than the partition key: **same-principal dedup
  only** — identical (function, canonical args, principal, cut version)
  tuples, exactly the spike's measured same-partition shape. That is
  re-execution deduplication, not plan inference: with LLP 0009's VM
  denying ambient nondeterminism (deterministic Date/Math policy) and
  every declared input identical including the principal, N
  re-executions are N copies of one evaluation. Partition-level
  memoization — sharing across principals inside one partition — waits
  for G0's §3 classification, because a deterministic VM proves nothing
  about *which* ambient authority inputs feed an opaque handler —
  LLP 0190 §4.3 admits conclusions about an opaque handler only from an
  extraction that proves its complete inputs, which same-principal
  identity sidesteps and partition-level sharing cannot.
- **G2 — graph-profile server execution + per-node matching (rung 2's
  required half).** Admitted graphs execute server-side with per-node
  captured dependencies feeding the existing matcher; the decision
  ledger reports per node kind. **D2-H2:** on the graph corpus, wake
  precision is at least the single-table baseline — conservative-
  fallback rate ≈ 0 and no table-granular full-graph wakes for commits
  provably disjoint at a node — with correctness pinned by the
  conformance corpus.
- **G3 — delta lanes for measured-hot admitted shapes (rung 4).**
  Per-node-kind delta rules from §7, narrowest first (root window +
  to-one), each behind the convergence assertion. **D2-H3:** on the
  target shape's arm, delivered frame bytes and per-commit evaluation
  cost drop materially (target sized at G2 from the ledger), replace
  fallback remains correct and honest, assertion green across the
  corpus.
- **Demand-gated, deliberately unscheduled:** rung-2 widening beyond
  per-node capture (§5's gate) and cross-principal sharing (§6's gate).

Capability publication rides LLP 0183 §D2's gate unchanged: the first D2
capability publishes only when the complete named corpus — pinned project
restriction, role visibility, open/creator/assignee/all-label/search
filters, selectable orders, two-way windows, private overlays, list
relations, and detail relations — passes one conformance corpus on every
claimed target. The G-phase exits above are engineering gates; none of
them is that publication.

Ordering rationale: E-3 gives G1 measured ~6× headroom for a cache
whose invalidation already exists; E-2 says precision work has no
measured payoff before graphs exist, so it rides in with the IR (G2)
rather than ahead of it; E-1 says delta maintenance pays orders of
magnitude but only per admitted shape, so it goes last and
shape-by-shape. Each phase lands separately and is A/B'd on the landed
commit per LLP 0189; no phase's claim outruns its arm.

## 10. Non-goals

Generic IVM for opaque handlers; cross-principal shared evaluation
(gated in §6, not designed); evaluation scheduling, settlement,
authorization-lane routing, fences, and quarantine lifecycle (LLP 0200);
retention carriers, local persistence, and replica lifecycle (D3 /
LLP 0190); D6 projection writers and search invalidation facts; any
weakening of declared bounds, refusal discipline, the fail-closed client
postures, or the server-authoritative trust model; client-authored plans
or identities.

## Open questions

- **OQ-1 (grammar lineage).** Does the graph IR extend the existing
  `RelationalQuery`/`BoundedChildrenQuery`/`SnapshotBatchV2` plan grammar
  in place, or supersede it with a migration path? The two-source plans
  are shipped surface with their own owners (LLP 0080/0100/0155); G0
  needs this ruled first.
- **OQ-2 (memo placement on hosted profiles).** On the Cloudflare DO
  target the single-threaded owner changes the memo's concurrency story
  (and LLP 0200 OQ-1's `waitUntil` question touches the same seam).
  Process-wide vs per-connection scope, and the byte budget, are sized
  at G1 on the local target and revisited for DO.
- **OQ-3 (partition identity function).** Is the authority partition
  identity derivable purely from LLP 0008's authorization-version
  vocabulary plus declared `permissionBacking` inputs, or does it
  require hashing resolved policy inputs at evaluation time? The former
  is cheaper and pre-declarable; the latter is more precise. G1 can
  start with the conservative choice (principal-scoped = partition of
  one) and widen.
- **OQ-4 (search-node invalidation).** When D6 lands versioned
  projection identities and writer/rebuild contracts, do search nodes
  get matcher facts (making them precision-bearing) or stay
  table-granular? Owned jointly with D6 at its landing, not before.
- **OQ-5 (the rung-2 widening gate's workload).** Which concrete
  workload represents the general many-subscriptions-over-different-data
  shape well enough to arm §5's gate, and does it need a new fixture or
  an extension of the existing harness? Deferred until after G2's
  ledger data exists.
- **OQ-6 (replica continuity contract).** When D3 takes up rung 5, the
  D2–D3 seam must define how a latest-value-elided delta stream becomes
  replica-applicable: per-frame base-version/predecessor stamping,
  cumulative delta semantics or a declared continuity delivery mode,
  gap detection, and the gap-to-replace rule (§8). Designed jointly with
  LLP 0190's owner at that point, not before; until ruled, no §7 delta
  is claimed replica-applicable.

## Revision history

- **v0.3 (2026-08-16).** G1 measured, and its shipped key recorded
  precisely. Two facts the D2-H1 run established:
  1. **The sound pre-G0 key is session-exact, not user-exact.** Opaque JS
     handlers can read `ctx.auth.sessionId` (and the full prepared
     projection), so LLP 0190 §4.3's complete-inputs standard forces every
     handler-visible authority field — session and authority-instance
     identity included — into the memo key (two independent review
     families converged on this). Consequently "N identical same-principal
     subscriptions" shares only when the N subscriptions present the
     *same session*. E-3's six-observer spike shape as operationalized by
     the OQ4 harness minted six sessions of one user; that shape gains
     little (~15% evaluation-count reduction measured) and its collapse
     is a G0-era target: sharing across sessions of one principal
     requires declared inputs proving sessionId non-consumption. The
     harness gained `--observer-session shared|distinct` to measure the
     truly-identical shape.
  2. **D2-H1 on the shared-session arm (2026-08-16, N=2, regenerated
     era-stamped 5.5M-row fixture, memo on/off interleaved on one host):**
     per-turn evaluation duration p50 869 ms → 42 ms; total serialized
     evaluation time 25.9 s → 10.7 s (2.4×, r2 pair; the r1 pair's
     memo-on arm paid cold page cache); one ~900 ms real evaluation per
     trigger version with the remainder memo hits (vs six real
     evaluations memo-off); mixed-partition arms byte-identical eval
     counts (47/47); 6-observer memo-on trigger settle p50 169–190 ms,
     inside 2× of the 1-observer arm (262–283 ms). Host-noise and
     store-era caveats recorded in the arm directories; the regenerated
     store's hot frames are ~5 MB (the 2026-08-08 store's 61–68 MB frames
     included burned-in diagnosis history), so byte-scale claims must
     requalify on a burned-in store. Kill switch
     `SNAPBACK_LIVE_EVAL_MEMO_DISABLED=1` is the control arm; memo
     entries are drain-cycle-scoped; oversize results are refused
     clone-free with a 256 MiB budget sized to the measured hot shape.
- **v0.2 (2026-08-15).** G1 same-principal live-evaluation memoization landed.
- **v0.1 (2026-08-09).** Initial draft per
  `issues/20260808-d2-d4-owner-specs-commission.md`, grounded in the OQ4
  spike disposition and LLP 0200 §6a. Before landing, one informal
  read-only pre-landing review pass from a second model family (Codex,
  gpt-5.6-sol, 2026-08-09) was taken on the draft; its corrections were
  folded into this same v0.1: skip-*rate* (not set) phrasing in E-2,
  honest E-4 attribution of the unmet H-1 to scheduling policy × turn
  cost, the plan/instance identity split (§2), paired-world proof rows
  for the §3 classification, the G0 bound-sizing exit and the LLP 0183
  §D2 capability-publication gate (§9), G1 narrowed to same-principal
  dedup pre-classification, and the §8/OQ-6 replica-continuity boundary.
  This was one informal pass, not a super-refine loop — the author runs
  that separately if wanted.
