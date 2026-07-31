# LLP 0135: Sequence allocation and snapshot-batch composition

**Type:** Spec
**Status:** Draft
**Systems:** Application data API, Relational queries, Mutations, Code
generation, Authorization, Live Queries, Diagnostics, Testing, Demo apps
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:**
**Related:** LLP 0007, LLP 0043, LLP 0051, LLP 0053, LLP 0065, LLP 0080,
LLP 0108, LLP 0110, LLP 0113, LLP 0115, LLP 0120, LLP 0125, LLP 0127,
LLP 0130, LLP 0134, Diary 0033, Diary 0034, Diary 0039, issue
`20260730-move6-sequence-and-3a-design-passes`

## Summary

This Spec delivers the two move-6 design passes LLP 0127 names as its first
slice, in the shipping order 0127 decision 3 fixed on 2026-07-30: first the
**sequence-allocation primitive** — a named, transactionally incremented
monotonic counter with its full semantic surface mapped per LLP 0120 — then
**snapshot-batch composition** (LLP 0120 option 3a) — a static tuple of
already-admitted bounded-profile invocations executed at one snapshot.

Both designs land here, in LLP 0080/0110's orbit, as one reviewable Draft;
the dated amendments those authorities need are drafted in §4 and applied
only if this Spec is Accepted (LLP 0115 CV-8's rule — no widening of the
stable surface by inference). Neither design is an aggregate: no count,
sum, or grouping is readable anywhere here, and the contracted-aggregate
decision stays with LLP 0130 SD-2, adjudicated later from the 3a usage
evidence this Spec's acceptance produces.

## Part 1 — the sequence-allocation primitive

### 1.1 Counter identity and scope

A **sequence counter** is a declared, framework-owned monotonic counter
identified by `(counterName, scopeTable, scopeRowId, scopeIncarnation)`:
a declared stable name unique per app; one ordinary application table
declared by the counter (LLP 0110 §1.1's parent eligibility rules —
membership, permission-backing, protected/system, and maintained-projection
output tables refuse); a row of that table supplied at allocation time; and
that row's current active incarnation in LLP 0110's protected
relation-incarnation registry.

Incarnation coupling is the scope-identity answer LLP 0120 asks for: a
deleted-then-recreated scope row has a new incarnation, so its counter
restarts at the initial value, and the predecessor counter row is orphaned
exactly as 0110 orphans children — unreachable, never renumbered, never
revived. Any client-observable unique constraint over a field storing
allocated values must be scoped by the `(scopeId, relationIncarnation)`
prefix (LLP 0110's existing uniqueness rule), so a restarted counter cannot
collide observably with orphaned rows.

Counter state lives in a protected framework table,
`_snapback_sequence_counters_v1`, keyed by the full identity tuple and
holding one `next_value` integer per row. Direct application reads and
writes of it refuse, like the incarnation registry itself. The first
allocation for a scope creates the row transactionally; there is no
provisioning migration. V1 pins the closed numeric contract:
JavaScript-safe integers, first value 1, step 1, no authored start, step,
or format.

### 1.2 Allocation surfaces

Allocation is host-owned, exists only inside a mutation's authoritative
transaction, and is never a standalone client-callable operation. V1 admits
two surfaces:

1. **Generated plan step.** A closed `AllocateSequence { counter, scope,
   into }` step becomes admissible in `write-with-activity.v1` primary plans
   via the drafted LLP 0110 amendment (§4). The step is point-shaped — one
   guarded read-modify-write of the counter row — so LLP 0110 §2.1's
   point-operation-only admission is unchanged; the step removes the *need*
   for the range collect that admission refuses. At most one step per plan
   in v1. The bound value is an ordinary typed integer binding usable in
   inserts, patches, activity payloads, and results.
2. **Handler surface.** Inline JS mutations (LLP 0108's tier) may call
   `ctx.sequence.allocate(counterName, scopeId)` inside the mutation
   transaction. The handler's manifest must declare the counters it may
   allocate from in a `sequences` list, defaulting to empty; an undeclared
   allocation refuses at admission. Allocation reach thus stays a declared,
   reviewable fact even in the imperative tier.

On both surfaces, allocation against a scope row with no active incarnation
(missing, deleted, or never registered) refuses with the existing
`SNAPBACK_RELATION_PARENT_UNAVAILABLE` outcome — allocating from a scope is
relationally a write into it.

### 1.3 Allocation-versus-commit ordering and gap semantics

V1 pins the **same-transaction** posture from LLP 0120's map: the counter
advance is part of the invoking mutation's storage transaction, committing
or rolling back with it. Consequences, each a contract:

- **No gaps from aborts.** An aborted or refused transaction advances
  nothing and leaves no observable trace. Committed allocations within one
  `(counter, scope, incarnation)` are strictly increasing **and
  consecutive**. Density is a claim about allocation events, not surviving
  rows: deleting a row that stores value `n` renumbers nothing and is not a
  gap in this contract's sense.
- **Commit-order assignment.** Values are assigned in commit order within a
  scope. On the current single-writer SQLite target this follows from
  storage-transaction serialization; a future multi-writer target must
  prove value-order-equals-commit-order through the shared corpus before
  claiming the capability, or publish a structured GAP. The claim is per
  target, not free.
- **No preallocation.** A gap-admitting reserve-then-commit counter is a
  deliberately different future profile, not a mode of this one. V1
  consumers may rely on gaplessness; that reliance is exactly why the two
  postures must not share a profile id.

### 1.4 Idempotent re-allocation

Allocation composes with the durable settlement path rather than adding a
second idempotency mechanism. The allocated value is a recorded answer
under LLP 0051, exactly like `runtime.id`: the first successful invocation
stores its result and settlement evidence with the commit (LLP 0043
`ClientMutationIdentity`), and an exact duplicate returns the retained
result bytes without re-executing or advancing the counter — a retried
idempotent write cannot allocate twice. A failed attempt stores no
settlement and no advance; its retry allocates fresh. Handler-tier
mutations inherit the same behavior from the existing settlement machinery.

### 1.5 Exhaustion

An allocation whose next value would exceed the JavaScript-safe integer
maximum refuses with `SNAPBACK_SEQUENCE_EXHAUSTED` and rolls back the whole
transaction — source, scope, activity, counter, commit version, settlement.
No wraparound, saturation, or silent re-scope: saturation would corrupt
ordering silently, the same reasoning LLP 0120 applies to aggregate
overflow. The bound is practically unreachable at one allocation per
invocation; it is specified because "practically" is not a semantics.

### 1.6 Hot-key contention posture

Two statements, both **named empirical expectations**, not results
(LLP 0120 option 5's labeling rule): replacing a per-send range re-read
(Campfire's `send` scan, Diary 0034) with a point increment is expected to
reduce per-send work — the read-shape change is a static fact, but the
latency and throughput consequence is unmeasured; and the counter
serializes concurrent allocators on one hot key — no *additional*
serialization on the single-writer SQLite target, where writes already
serialize globally, but a real contention point on any multi-writer target.
LLP 0125's burst-profiling work (its option 5) owns the measurement. This
Spec claims no numbers and no relative performance.

### 1.7 Allocation authority and information flow

Allocation confers no authority and requires none of its own: it is
admitted exactly where the enclosing operation's declared authorization
already admits writing into the scope. In the generated profile the counter
scope must be the plan's authorized scope row, so `existing-owner.v1`'s
visibility check has already run; in the handler tier the declared
`sequences` entry plus the active-incarnation check are the structural
gates, and the operation's own declared authorization is the cut. Because
that cut is the enclosing operation's, an anonymous-callable mutation can
allocate: the primitive does not repeat the `existing-owner.v1`-only
narrowing that made `write-with-activity.v1` unusable by every anonymous
rerun arm. LLP 0120 open question 5 itself stays open for the write
profile; this Spec routes around it only for allocation.

The information-flow fact, stated plainly: an allocated value discloses the
count of prior committed allocations in its scope to anyone who can read a
row storing it. V1's containment rule: values from a counter may be stored
only in the scope row itself or in rows whose visibility is through that
scope row (LLP 0110's through-parent discipline). The generated profile
proves this at generation — the plan's writes are closed. The handler tier
declares the counter but cannot prove where the value flows: the same
declared-versus-proved split LLP 0120's option 2 names, recorded here as a
limitation, not hidden (open question 1).

There is no read surface for a counter's current value — no `current()`
call, no generated query, no inspection fact carrying it. A readable
current value would be a grouped count wearing a different name; the
aggregate question belongs to LLP 0130 SD-2, not this Spec.

### 1.8 Ceilings, receipts, and capability

The generated profile's effect ceiling gains exactly "zero or one sequence
allocation," counted as fixed host bookkeeping alongside settlement — the
three-application-write maximum of `WriteWithActivityEffectCeilingV1` is
unchanged. Effect receipts name the counter identity, scope, incarnation,
and allocated value. Inspection lists declared counters and their scope
tables; it never reveals current values.

The capability id is `sequence_allocation_v1`, entering the code-owned
registry at `experimental` on LLP 0113's qualification route — the default
for new profiles under 0127 decision 3 — with runtime support false until
qualified publication, acknowledgment of the experimental id required from
ordinary artifacts, and structured GAPs on every non-supporting target. Per
LLP 0113 §1, no publication CAS can promote it; promotion to stable runs
only through LLP 0134's path (§2.6).

### 1.9 What this lifts and what it does not

Lifted: LLP 0110 open question 4's live instance. Relay's `moveCard` —
otherwise the exact `write-with-activity.v1` shape — derived `nextSequence`
by collecting the board's whole activity range, which LLP 0110 §2.1
refuses; with `AllocateSequence` the plan stays point-operations-only and
fits.
Campfire's `send` drops its room-range scan for a declared handler-tier
allocation. Both are §5.1's acceptance shapes. Not lifted: `boardSummary`
and the Split ledger derivation (aggregates — no readable count exists
here); the write profile's anonymous-authority gap (LLP 0120 OQ5, still
open); batch allocation (one per invocation in v1); gap-admitting
preallocation; and any cross-scope or global counter.

## Part 2 — snapshot-batch composition (LLP 0120 option 3a)

### 2.1 Composite plan shape

The normalized manifest shape is `SnapshotBatchPlanV1`, identified by
`profile: "snapshot-batch.v1"`. One composite names a **static tuple** of
two through eight nodes:

- each node is one complete, individually valid, already-admitted plan of
  an admitted kind — v1 admits `bounded-children.v1` plans and
  `relational_query_v1` callable plans — under its own governing document,
  unchanged, keeping its own visibility declarations, projection, order,
  `take`, and `take + 1` examined-entry ceiling;
- the sum of node `take` values is at most 1,024, keeping the composite
  inside LLP 0007's established result frame;
- composite arguments are the merged node arguments; two nodes binding the
  same argument name must declare identical types; and
- no node's arguments may reference another node's output. The tuple is
  static. Data-dependent node invocation is option 3, not 3a, and refuses.

No reduction, aggregation, grouping, or new admission vocabulary exists in
the composite: every read inside it is a generated, already-proved plan,
and a composite never allocates — Part 1 is mutation-side, Part 2 is
read-only, and the two do not compose in v1.

### 2.2 One-snapshot execution and parent-authorization dedup

The composite executes in one authoritative transaction at one snapshot.
Nodes evaluate in declaration order, but every node observes the same
snapshot version, so evaluation order is unobservable. This is the
single-snapshot multi-child read the rerun lost: Relay's `boardView`
becomes three `bounded-children.v1` nodes over one board (LLP 0110 open
question 2's recorded instance).

**Parent-authorization dedup** is structural, not coincidental: nodes whose
parent declarations are structurally identical — same parent table, id
argument binding, and visibility declaration — share one parent point-read
and one visibility evaluation per invocation. Distinct arguments that
happen to hold the same id at runtime do not dedup. Dedup changes work
counting only; observable semantics are exactly as if each node evaluated
its own parent check against the shared snapshot.

### 2.3 Seal-entirely partial refusal

If any node's parent is absent or invisible, the composite seals entirely
— the evidence-clean answer LLP 0120 names, pinned as the only v1
behavior. The result is a one-row discriminator envelope:

```ts
type SnapshotBatchRow<Nodes> =
  | { kind: "absent"; nodes: null; continuation: null }
  | { kind: "visible"; nodes: Nodes; continuation: string | null }
```

The sealed `absent` row is byte-identical whichever node sealed, however
many sealed, and whether the cause was absence or invisibility — no other
node's data returns and no node index is disclosed. Extending LLP 0110
§1.3's ordering, every parent's visibility is established before composite
cursor validation, so the sealed result is identical even when raw cursor
bytes are malformed. In the `visible` row, `nodes` is the tuple of each
node's own visible-shape content: no per-node absent state, no partial
tuple, ever.

### 2.4 Composite cursor and coordinated resume

Per-node cursor identity does not survive composition (LLP 0120 open
question 4's within-3a half, answered): the composite mints its **own**
opaque `sbsb1` credential — an AEAD token under the shared cursor keyring
custody with its own mutually prefix-free registry entry, 1,024-byte wire
cap, and 14-day maximum age, following the `sbbc1` protocol shape — whose
plaintext binds app/database/target, the composite's exported function
identity and normalized plan hash, every node's parent id, incarnation, and
current parent `_version`, each node's complete boundary state **or**
terminal marker, the caller's authority partition, and issuance/expiry.

Coordinated resume: one continuation resumes all nodes together at a new
single snapshot. Non-terminal nodes resume from their bound boundaries;
terminal nodes are not re-read — zero examined entries — and return their
empty terminal page. The continuation is present exactly while some node is
non-terminal. Standalone node cursors refuse in the composite and composite
cursors refuse in standalone plans. A bound parent's incarnation or
`_version` change returns the single
`SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED` diagnostic; malformed,
cross-app, cross-plan, cross-authority, and boundary-invalid credentials
collapse to `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`. The snapshot claim is
per invocation only: successive pages are separate snapshots, and the
composite makes each node's no-skip/no-duplicate claim (LLP 0110 §1.4 /
LLP 0080 §2), jointly resumed, never a frozen cross-page snapshot.

### 2.5 Work ceiling, identity, and live classification

The composite work ceiling is the **sum of its nodes' ceilings**: at most
`Σ (takeᵢ + 1)` examined child/root entries plus one point-read per
deduplicated parent declaration — a static fact of the normalized plan,
encoded in the plan hash, and instrumented in acceptance exactly as
LLP 0080 instruments examined entries.

The composite is a new observable surface, not a client-invisible
evaluation detail — it has its own result envelope, cursor grammar, and
refusal codes — so it takes its own exported function identity, normalized
plan hash, and capability id. This decides the identity half of LLP 0120
open question 7 for this profile; 0127 decision 3 decided the
maturity-route half.

Live classification: callable, with the cursor-free first page
`live_replace` capable. Captured dependencies are the union of every node's
dependencies; any commit touching any of them conservatively resnapshots
the whole composite, table-granular per LLP 0080 §4. A cursor-bearing
subscribe refuses with `SNAPBACK_SNAPSHOT_BATCH_LIVE_CURSOR_UNSUPPORTED`
before storage work. No `live_delta`, no proved-disjoint skip, no
retention; `retention: "none"` is the only v1 value.

### 2.6 Maturity and the experimental-dependency acknowledgment

The capability id is `snapshot_batch_v1`, entering the registry at
`experimental` on the LLP 0113 route. Composed nodes keep their own
maturity, and the composite inherits it loudly: an ordinary artifact
claiming a composite must acknowledge `snapshot_batch_v1` **and** every
composed experimental id — today, `bounded_children_v1`; stable
`relational_query_v1` nodes need no acknowledgment. Runtime support
requires the target to support every composed node kind; a missing node
capability makes the composite unavailable, never degraded. And the
composite's maturity can never exceed the minimum maturity of its composed
profiles: promotion runs through LLP 0134 (capability maturity promotion —
CV-8 piece 2, Draft in this same wave) and cannot precede the composed
profiles' own promotion. LLP 0134 already names both of this Spec's ids as
default-route entrants.

The acknowledgment ceremony is deliberate: composing unproven parts should
be loud (LLP 0120 option 3a's own note), and until LLP 0134 is ratified,
both this profile and Part 1's primitive terminate at experimental by
design (LLP 0113 §1; LLP 0120 finding 9).

## 3. Capability ids and diagnostics

New registry entries, both `experimental`, both support-false until
qualified publication: `sequence_allocation_v1` and `snapshot_batch_v1`.
New stable authoring diagnostics:
`SNAPBACK_SEQUENCE_DECLARATION_INVALID`, `SNAPBACK_SEQUENCE_UNDECLARED`,
`SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID`,
`SNAPBACK_SNAPSHOT_BATCH_NODE_INELIGIBLE`, and
`SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED`. New stable public runtime
diagnostics: `SNAPBACK_SEQUENCE_EXHAUSTED`,
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`,
`SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED`,
`SNAPBACK_SNAPSHOT_BATCH_LIVE_CURSOR_UNSUPPORTED`, and inherited
`SNAPBACK_RELATION_PARENT_UNAVAILABLE` for allocation against a missing or
inactive scope incarnation.

## 4. Fold-on-acceptance amendments (drafted, not applied)

This Spec has no normative effect while Draft and edits no other document
now. Moving it to Accepted requires these same-landing dated amendments,
drafted here so their scope is reviewable:

1. **LLP 0110.** §2.1's primary-plan vocabulary gains the closed
   `AllocateSequence` step (point-shaped; the no-range-read admission
   unchanged); the mode effect formulas gain "zero or one sequence
   allocation" as fixed host bookkeeping; open question 4 is annotated
   answered-for-sequences; open question 2 gains a pointer to
   `snapshot-batch.v1` as the admitted multi-parent composition answer.
2. **LLP 0080.** Open questions 1 and 7 gain a pointer: snapshot-batch is
   the admitted answer for multi-child fan-out; OQ7's aggregate half stays
   open pending LLP 0130 SD-2.
3. **LLP 0051 orbit.** The `AllocateSequence` recorded-answer integration
   (replay names the recorded value; no second allocation) rides the same
   landing as amendment 1.

## 5. Executable acceptance

Falsifiable, per part. `Implemented` and any capability claim additionally
require the LLP 0113 qualification machinery; nothing below is claimed as
passing today.

### 5.1 Sequence allocation

- Allocations in one scope incarnation return 1, 2, 3, …; concurrent
  allocators produce a dense, strictly increasing committed history with no
  duplicates; an aborted transaction leaves `next_value` unchanged.
- Delete/recreate of the scope row restarts the counter at 1 under the new
  incarnation; orphaned rows stay physically stored but unreachable, and
  `(scopeId, relationIncarnation)`-prefixed unique constraints admit the
  restarted values.
- Exact settlement replay returns byte-identical retained results including
  the allocated value, with the counter advanced exactly once across
  sequential and concurrent duplicates.
- A counter seeded at the safe-integer maximum refuses with
  `SNAPBACK_SEQUENCE_EXHAUSTED` and rolls back source, activity, counter,
  and settlement together; an undeclared handler allocation refuses; a
  missing or inactive scope refuses with
  `SNAPBACK_RELATION_PARENT_UNAVAILABLE`; no generated or ctx surface
  exposes a counter's current value.
- **Relay `moveCard`** is expressed as `write-with-activity.v1` plus
  `AllocateSequence`: admission passes where the range collect previously
  refused; card patch, activity insert, and counter advance share one
  commit version; the exact `{cardId, activityId, sequence}` result
  (Diary 0033) replays byte-identically.
- **Campfire `send`** uses a declared handler-tier allocation: instrumented
  reads show no range read for sequence derivation, the anonymous arm
  passes unchanged, and committed message sequences are dense and strictly
  increasing under concurrent senders.

### 5.2 Snapshot batch

- **Relay `boardView`** runs as a three-node bounded-children composite
  over one board: instrumentation proves one deduplicated parent point-read
  and at most `Σ (takeᵢ + 1)` examined entries; all node results carry one
  snapshot version, and an injected concurrent write between node
  evaluations appears in no node.
- Absent board and invisible board return byte-identical sealed `absent`
  envelopes — same result, code, status, transport, live initial state, and
  ordinary inspection — including with malformed cursor bytes.
- Coordinated resume: per-node no-skip/no-duplicate holds across concurrent
  inserts, deletes, and order-key moves; a terminal node is not re-read on
  resume; the continuation disappears exactly when all nodes are terminal.
- Cursor matrix: malformed, cross-app, cross-plan, cross-parent,
  cross-authority-partition, and boundary-invalid composite cursors refuse;
  a standalone `sbbc1` cursor refuses in the composite and vice versa; a
  parent `_version` or incarnation change returns the restart diagnostic.
- A two-instance live test proves a commit to any node's table replaces the
  whole composite, authority rotation fences predecessor delivery, and a
  cursor-bearing subscribe refuses before storage.
- An artifact not acknowledging `snapshot_batch_v1` plus every composed
  experimental id refuses generation; a target missing any node capability
  reports the composite as a structured GAP.
- The run above is recorded as **3a usage evidence for LLP 0130 SD-2**,
  alongside the explicit record that `boardSummary` and the Split ledger
  derivation were *not* expressed (aggregates, outside both parts); SD-2's
  criteria — not this Spec — decide whether that residue gets the
  contracted-aggregate profile.

## Nonclaims

- **No aggregates, in either part.** No readable counter value, no counts,
  sums, or grouping, no reduction nodes. The contracted-aggregate decision
  is LLP 0130 SD-2's, made later from 3a usage evidence; this Spec neither
  pre-decides it nor smuggles a count through the counter.
- **No implementation, no capability support, experimental terminus.**
  Both ids are reserved; support is false everywhere; every §5 claim is a
  future witness, not a status. On the default LLP 0113 route both
  profiles terminate at experimental until LLP 0134's promotion path is
  ratified (LLP 0120 finding 9); this Spec cannot and does not shorten
  that.
- **No performance results.** §1.6's statements are named empirical
  expectations; LLP 0125's burst work owns the measurement.
- **No general query language.** Data-dependent node invocation, arbitrary
  predicates, and caller-composed shapes stay rejected (option 3's
  verdict); no stable surface widens — composing a stable
  `relational_query_v1` node changes that profile's admission not at all.
- **No cross-page snapshot.** The one-snapshot claim is per invocation;
  pagination across composite pages carries only the nodes' stated bounds.

## Open questions

1. Can §1.7's visibility-containment rule be validated at generation time
   against handler manifests, or does the handler tier stay
   declared-but-unproved — the generation-time-validation question LLP 0120
   open question 3 poses for budgets?
2. Should a later profile admit more than one allocation per invocation
   (bulk insert with consecutive values), and does density survive it?
3. What corpus obligations prove value-order-equals-commit-order on a
   multi-writer target — and if unprovable there, is the claim demoted to
   strictly-increasing-only under a distinct profile version?
4. Should parent-auth dedup ever extend beyond structural identity (two
   argument spellings provably bound to one value), or is structural
   identity the permanent rule?
5. Should the first `snapshot_batch_v1` publication admit
   `relational_query_v1` nodes, or start bounded-children-only to keep the
   qualification corpus smallest?
