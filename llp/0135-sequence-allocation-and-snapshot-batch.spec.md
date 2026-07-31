# LLP 0135: Sequence allocation and snapshot-batch composition

**Type:** Spec
**Status:** Draft
**Systems:** Application data API, Relational queries, Mutations, Code
generation, Authorization, Live Queries, Diagnostics, Testing, Demo apps
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:** 2026-07-31 (v0.2, round-1 fixes: round 1 of the Wave-1
Spec loop returned NOT READY from both families
(`reviews/0135-sequence-allocation-and-snapshot-batch.fable.md`:
1 BLOCKING + 5 MATERIAL + 9 DETAIL, with SD-2 hygiene explicitly
verified PASS;
`reviews/0135-sequence-allocation-and-snapshot-batch.codex.md`:
12 MATERIAL). Applied: Fable B1 = Codex 4 (declaring a counter enrolls
its scope table in LLP 0110's incarnation registry as a second
registration ground with the full lifecycle/backfill gates reused, the
stamp obligation for prefixed unique constraints stated, and §4.1
extended accordingly — the Campfire acceptance is now admissible);
Codex 2+3 = Fable M2 (the buffered read-modify-write transaction
protocol with captured-read commit validation specified; the
"exactly like `runtime.id`" misstatement corrected — the allocated
value is settlement-replay evidence, never a `{ids, now}` ctx-ledger
member; allocating operations scoped out of lane-L local execution as
a nonclaim with OQ6; LLP 0129/0133 joined Related and §4's fold list);
Codex 5 + Fable D1 (complete `next_value` state transition,
maximum-allocatable boundary, durable exhausted state, and
MAX−1/MAX/post-MAX acceptance rows); Codex 6 + Fable D2 (the
two-transaction pause-and-race commit-order falsifier binding values
to commit versions); Codex 7 = Fable M1 (handler-tier scope-visibility
gate — declared read-or-write reach or an explicit public-scope
declaration — plus the observation/sink matrix with the containment
rule's enforcement boundary stated honestly, folding Fable D5);
Codex 8 = Fable M4 (v1 composites narrowed to bounded-children-only,
resolving OQ5 per both reviewers' lean; relational admission recorded
as a dated successor question); Codex 9 + Fable D3/D4 (every resume
point-reads every deduplicated parent, terminal nodes included;
"zero examined entries" redefined to child-range entries; cursor-free
node-page shape with inner cursors prohibited); Codex 10 = Fable M3 +
D9a (`sbsb1` cap raised to 8,192 with the sizing arithmetic shown, a
static establishment-time worst-case budget with the coded refusal
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED`, deduplicated
parents bound once, and order-field width bounds required); Codex 11
(canonical `ParentAuthorizationKeyV1` in normalized plan hashing with
golden and near-miss vectors); Codex 12 = Fable D9c (the min-maturity
coupling recast as a proposed LLP 0134 prerequisite routed to 0134's
own loop, not an enforced rule here; the LLP 0113 family-kind
amendment added to §4); Codex 4 = Fable M5 (the drafted LLP 0108
amendment — `sequences` manifest member, `implementationHash`
field-list extension, ctx surface — and `SNAPBACK_SEQUENCE_UNDECLARED`
reclassified as a runtime ctx-boundary refusal); Fable D6/D7/D8/D9b
(the eligibility enumeration completed, conflict-outcome ownership
delegated to LLP 0003's target execution model, the moveCard
acceptance arm stated owner-provenanced, and admission named as the
acknowledgment gate's locus). Adjudicated, not applied — Codex 1 (the
Spec pre-decides LLP 0130 SD-2): verified against SD-2's text,
LLP 0120 option 3a, and this Spec's §5.2 — Fable's explicit
SD-2-hygiene PASS survives. SD-2's criteria are the author's own
decision instrument, adopted 2026-07-31 with LLP 0120 in evidence,
and LLP 0120 already places the aggregate shapes outside 3a from the
start ("it does not touch aggregation"); recording the aggregates as
not-expressed is exactly the usage evidence SD-2's branches consume,
so supplying that record honestly is compliance with SD-2, not
pre-decision, and the branch outcome stays SD-2's alone. The
reasoning is now explicit in §5.2 and §Nonclaims.)
**Related:** LLP 0003, LLP 0007, LLP 0008, LLP 0043, LLP 0051,
LLP 0053, LLP 0065, LLP 0080, LLP 0108, LLP 0110, LLP 0113, LLP 0115,
LLP 0120, LLP 0125, LLP 0127, LLP 0129, LLP 0130, LLP 0133, LLP 0134,
Diary 0033, Diary 0034, Diary 0039, issue
`20260730-move6-sequence-and-3a-design-passes`

## Summary

This Spec delivers the two move-6 design passes LLP 0127 names as its first
slice, in the shipping order 0127 decision 3 fixed on 2026-07-30: first the
**sequence-allocation primitive** — a named, transactionally incremented
monotonic counter with its full semantic surface mapped per LLP 0120 — then
**snapshot-batch composition** (LLP 0120 option 3a) — a static tuple of
already-admitted bounded-profile invocations executed at one snapshot.

Both designs land here, in LLP 0080/0110's orbit, as one reviewable Draft;
the dated amendments the affected authorities need are drafted in §4 and
applied only if this Spec is Accepted (LLP 0115 CV-8's rule — no widening
of the stable surface by inference). Neither design is an aggregate: no count,
sum, or grouping is readable anywhere here, and the contracted-aggregate
decision stays with LLP 0130 SD-2, adjudicated later from the 3a usage
evidence this Spec's acceptance produces.

## Part 1 — the sequence-allocation primitive

### 1.1 Counter identity and scope

A **sequence counter** is a declared, framework-owned monotonic counter
identified by `(counterName, scopeTable, scopeRowId, scopeIncarnation)`:
a declared stable name unique per app; one ordinary application table
declared by the counter (LLP 0110 §1.1's parent eligibility rules —
membership, permission-backing, protected/system, maintained-projection
output, retired, and independently authority-bearing tables refuse); a
row of that table supplied at allocation time; and that row's current
active incarnation in LLP 0110's protected relation-incarnation
registry.

Declaring a counter **enrolls** its scope table in that registry:
sequence-counter scope is a second registration ground beside 0110's
"named as a bounded-children parent," under the identical lifecycle —
every insert into an enrolled table creates one active incarnation in
the same transaction, delete marks it inactive, recreating the
application id mints a new UUIDv7, patch preserves it, and restore
preserves the carried active registry transactionally. Enrollment
reuses 0110's activation gates wholesale: adopting a scope table with
pre-existing rows requires the explicit reviewed backfill before
`sequence_allocation_v1` can activate — no row is silently blessed —
and restore validation runs in both directions. The alternative, a
self-owned counter-incarnation mechanism, is rejected with rationale:
a table that is both a counter scope and a bounded-children parent
would carry two incarnation authorities that could disagree about one
row's identity, and the uniqueness-prefix rule below is meaningful
only if the prefix names this registry's incarnation values.

Incarnation coupling is the scope-identity answer LLP 0120 asks for: a
deleted-then-recreated scope row has a new incarnation, so its counter
restarts at the initial value, and the predecessor counter row is orphaned
exactly as 0110 orphans children — unreachable, never renumbered, never
revived. Any client-observable unique constraint over a field storing
allocated values must be scoped by the `(scopeId, relationIncarnation)`
prefix (LLP 0110's existing uniqueness rule), so a restarted counter cannot
collide observably with orphaned rows. The prefix presumes a stamp
source, so the obligation is stated rather than assumed: a table
carrying such a constraint declares LLP 0110's framework-owned
`relationIncarnationOf {foreignKeyField, parentTable}` field against
the scope table, written only through the protected stamping boundary
by every central writer, with the same reviewed backfill on adoption.
Enrollment (above) makes the registry rows exist for that field to
reference even where the storing table is not a bounded-children
child. The stamping half of activation applies exactly where stamped
fields exist: a counter-only scope with no value-storing tables under
prefixed constraints has nothing to stamp, and its activation gate is
the registry-lifecycle validation alone.

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
   allocate from in a `sequences` list, defaulting to empty (the drafted
   LLP 0108 amendment, §4.4); an undeclared allocation refuses at the
   ctx boundary when the call executes, with
   `SNAPBACK_SEQUENCE_UNDECLARED` — generation cannot see through
   imperative handler code (this Spec's own declared-versus-proved
   premise), so the declaration is admission-visible but the refusal's
   enforcement locus is runtime. Allocation additionally passes §1.7's
   scope-visibility gate. Allocation reach thus stays a declared,
   reviewable fact even in the imperative tier.

On both surfaces the execution shape under the buffered mutation
boundary (LLP 0003) is the same: allocation is a **buffered
read-modify-write** of the counter row. The returned integer is derived
from the transaction's snapshot of the counter state plus its own
buffered advances; the counter row joins the captured read set; and the
brief authoritative commit validates that read like any other. A
concurrent advance detected at commit aborts the whole attempt, and the
fresh re-execution allocates fresh. Whether that contention surfaces as
serialization or as validate-and-retry, and under which diagnostic, is
owned by the target execution model (LLP 0003), not this Spec; the
normative contract is only that a committed allocation's counter read
was still current at its commit and a failed attempt leaves no trace.
The writer lock is never held across handler execution, the handler is
never re-entered mid-commit, and the integer returned mid-handler is
the value committed — or the transaction does not commit. This is what
makes §1.3's commit-order assignment hold on the buffered boundary.

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
  §1.2's protocol — the serialized brief commit plus captured-read
  validation of the counter row, which guarantees a committed value was
  derived from counter state still current at its commit; the
  arrangement is specified, not assumed, and §5.1's two-transaction
  race is its direct falsifier. A future multi-writer target must prove
  value-order-equals-commit-order through the shared corpus before
  claiming the capability, or publish a structured GAP. The claim is per
  target, not free.
- **No preallocation.** A gap-admitting reserve-then-commit counter is a
  deliberately different future profile, not a mode of this one. V1
  consumers may rely on gaplessness; that reliance is exactly why the two
  postures must not share a profile id.

### 1.4 Idempotent re-allocation

Allocation composes with the durable settlement path rather than adding a
second idempotency mechanism. The allocated value is **settlement-replay
evidence** under LLP 0043: the first successful invocation stores its
result and settlement evidence with the commit (`ClientMutationIdentity`),
and an exact duplicate returns the retained result bytes without
re-executing or advancing the counter — a retried idempotent write cannot
allocate twice. A failed attempt stores no settlement and no advance; its
retry allocates fresh. Handler-tier mutations inherit the same behavior
from the existing settlement machinery.

What the value is **not**: a member of LLP 0051 D1's closed ctx-answer
ledger. That ledger is `{ids, now}`, and LLP 0133's lanes give exactly
those members their capture semantics — lane Q's wire pin transmits
`{generatedIds, now}` and the server accepts them (LLP 0008); lane L
re-derives them, reconciling id divergence through a leaf-match id-map
that is sound only because minted ids are high-entropy strings. An
allocated sequence value has neither property: a client cannot know the
authoritative next value, so nothing sequence-shaped may ever join the
accepted captured environment in any lane, and a re-derived small
integer is unsafely leaf-matchable — its divergence fits none of
LLP 0133's three divergence classes. V1 therefore scopes allocating
operations **out of local execution** entirely: neither surface is
admissible for lane-L capture, and no speculative surface presents an
allocated value (§Nonclaims; open question 6 records the successor
shape). A lane-Q queued intent that allocates is unaffected — its
handler never runs client-side, so settlement executes it
authoritatively and allocates then — but its optimistic overlay cannot
present the allocated value either, because the value does not exist
before settlement.

### 1.5 Exhaustion

Allocated values are JavaScript-safe integers, 1 through
`MAX_SAFE_INTEGER` (2^53 − 1), and the maximum itself **is**
allocatable. The complete state transition: the counter row stores
`next_value`, the value the next successful allocation returns; the
first allocation for a scope creates the row transactionally, returns
1, and leaves `next_value` at 2; every allocation returns `next_value`
and advances it by one. After the maximum is allocated the stored
`next_value` is 2^53 — exactly representable in the i64 storage
domain, never returned as a value — and that row is the durable
exhausted state. An allocation finding `next_value` greater than
`MAX_SAFE_INTEGER` refuses with `SNAPBACK_SEQUENCE_EXHAUSTED` and
rolls back the whole transaction — source, scope, activity, counter,
commit version, settlement; the refusal itself commits nothing, so
every subsequent attempt refuses identically. No wraparound,
saturation, or silent re-scope: saturation would corrupt ordering
silently, the same reasoning LLP 0120 applies to aggregate overflow.
The bound is practically unreachable at one allocation per
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

Allocation confers no authority, and reach into the scope is a
structural gate on both surfaces — declared, and evaluated against the
scope row, not merely asserted. In the generated profile the counter
scope must be the plan's authorized scope row, so `existing-owner.v1`'s
visibility check has already run before any allocation. In the handler
tier, `ctx.sequence.allocate` refuses unless one of two declared facts
holds: the enclosing operation's declared authorization proves the
effective subject's read-or-write reach into the named scope row (a
declared visibility over the scope table, evaluated against that row
at allocation time), or the counter's declaration explicitly marks its
scope public (`scopeAccess: "public.v1"`) — a reviewed, inspectable
disclosure. Bare invocation authority alone no longer reaches a
non-public counter. The primitive still does not repeat the
`existing-owner.v1`-only narrowing that made `write-with-activity.v1`
unusable by every anonymous rerun arm — the public-scope declaration
is the explicit route an anonymous-callable mutation (Campfire's
`send`) uses — and LLP 0120 open question 5 itself stays open for the
write profile; this Spec routes around it only for allocation.

The information-flow fact, stated plainly: an allocated value discloses
the count of prior committed allocations in its scope to anyone who can
observe it. The observation surface is enumerated, not implied — the
**sink matrix**:

- **mutation results**: whatever the declared result contract returns,
  to the submitting caller;
- **retained settlements**: the retained result bytes, republished only
  to the same settlement identity (LLP 0043), auth-bound;
- **effect receipts**: counter identity, scope, incarnation, and value
  ride the submitting authority's own receipt/replay ledger only;
  fan-out receipts to other subscribers carry no allocated values (the
  receipt privacy rule);
- **activity payloads**: visible exactly through the activity table's
  own through-scope declaration (LLP 0110 §2.2);
- **stored rows**: the containment rule's subject, below;
- **unique-constraint signals**: prefix-partitioned by
  `(scopeId, relationIncarnation)` (§1.1), so another scope's
  conflicting value is not observable; and
- **timing**: a named nonclaim — no constant-work claim is made.

V1's containment rule: values from a counter may be stored only in the
scope row itself or in rows whose visibility is through that scope row
(LLP 0110's through-parent discipline). Its enforcement boundary,
stated honestly, is the allocating operation's own writes and nothing
more: the generated profile proves it at generation — the plan's
writes are closed; the handler tier declares the counter but cannot
prove where the value flows — the declared-versus-proved split
LLP 0120's option 2 names, recorded here as a limitation, not hidden
(open question 1); and once a value is legitimately observed through
any matrix row, downstream republication by a later operation is
ordinary application dataflow no rule here can reach. Under the
visibility gate, the allocate-and-return count oracle is available
exactly to subjects with declared reach into the scope row — for whom
the disclosure is the stated information-flow fact — or, for a
public-scope counter, to everyone, which is precisely what the
explicit public declaration makes reviewable.

There is no read surface for a counter's current value — no `current()`
call, no generated query, no inspection fact carrying it. A readable
current value would be a grouped count wearing a different name; the
aggregate question belongs to LLP 0130 SD-2, not this Spec.

### 1.8 Ceilings, receipts, and capability

The generated profile's effect ceiling gains exactly "zero or one sequence
allocation," counted as fixed host bookkeeping alongside settlement — the
three-application-write maximum of `WriteWithActivityEffectCeilingV1` is
unchanged. Effect receipts name the counter identity, scope, incarnation,
and allocated value, on the submitting authority's own receipt only
(§1.7's sink matrix). Inspection lists declared counters, their scope
tables, and their scope-access declarations; it never reveals current
values.

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
allocation — its rooms table enrolls in the incarnation registry via
the counter declaration (§1.1), and its anonymous arm allocates under
an explicit public-scope declaration (§1.7). Both are §5.1's
acceptance shapes. Not lifted: `boardSummary`
and the Split ledger derivation (aggregates — no readable count exists
here); the write profile's anonymous-authority gap (LLP 0120 OQ5, still
open); batch allocation (one per invocation in v1); gap-admitting
preallocation; and any cross-scope or global counter.

## Part 2 — snapshot-batch composition (LLP 0120 option 3a)

### 2.1 Composite plan shape

The normalized manifest shape is `SnapshotBatchPlanV1`, identified by
`profile: "snapshot-batch.v1"`. One composite names a **static tuple** of
two through eight nodes:

- each node is one complete, individually valid, already-admitted
  `bounded-children.v1` plan — v1 admits no other node kind — under its
  own governing document, unchanged, keeping its own visibility
  declarations, projection, order, `take`, and `take + 1`
  examined-entry ceiling;
- the sum of node `take` values is at most 1,024, keeping the composite
  inside LLP 0007's established result frame;
- composite arguments are the merged node arguments; two nodes binding the
  same argument name must declare identical types; and
- no node's arguments may reference another node's output. The tuple is
  static. Data-dependent node invocation is option 3, not 3a, and refuses.

V1 is **bounded-children-only**, resolving this Spec's original open
question 5 to its smaller branch, per the design's own acceptance
shapes: every §5.2 shape is bounded-children nodes, the cursor, seal,
restart, and ceiling semantics below are exact for that kind, and the
qualification corpus stays smallest. Admitting `relational_query_v1`
nodes is a dated successor question, not a first-publication one; open
question 5 now enumerates what the successor must specify before
admission.

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

**Parent-authorization dedup** is structural, not coincidental, and the
equivalence is pinned at plan-hash time: dedup groups are the
equivalence classes of a canonical `ParentAuthorizationKeyV1` — the
canonical bytes (RFC 8785 JCS over a closed record) of the parent
table, the merged composite argument name and declared type bound as
the parent id, and the complete visibility declaration including its
kind, parameters, and policy/version identity. Equality is of those
canonical bytes, never runtime values and never an implementation's
AST equality; the derived grouping is part of the normalized plan and
enters the normalized plan hash. Nodes in one group share one parent
point-read and one visibility evaluation per invocation. Distinct
arguments that happen to hold the same id at runtime do not dedup.
Dedup changes work counting only; observable semantics are exactly as
if each node evaluated its own parent check against the shared
snapshot. Golden vectors freeze the grouping, and near-miss vectors —
the same parent table under a different argument binding, the same
binding under a different visibility declaration — must not dedup
(§5.2).

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
node's own **cursor-free page** — `{parent, children}` under the node's
own projections, with no per-node `continuation` member: per-node
cursor identity does not survive composition (§2.4), and no `sbbc1`
credential ever appears inside a composite result. The composite-level
`continuation` is the only resume credential. No per-node absent
state, no partial tuple, ever.

### 2.4 Composite cursor and coordinated resume

Per-node cursor identity does not survive composition (LLP 0120 open
question 4's within-3a half, answered): the composite mints its **own**
opaque `sbsb1` credential — an AEAD token under the shared cursor keyring
custody with its own mutually prefix-free registry entry and 14-day
maximum age, following the `sbbc1` protocol shape with one deliberate
divergence: its wire cap is **8,192 bytes**, not `sbbc1`'s 1,024,
because the composite binds up to eight nodes' state and the sizing
must be shown, not inherited. The plaintext binds app/database/target,
the composite's exported function identity and normalized plan hash,
the composite's complete non-cursor argument values — for
bounded-children nodes these are exactly the parent ids, bound **once
per deduplicated parent declaration** together with that parent's
incarnation and current `_version` — each node's complete boundary
state **or** terminal marker, the caller's authority partition, and
issuance/expiry.

**Static size budget — no mid-flight cliff.** The 8,192-byte cap
leaves at most 8,186 base64url characters after the `sbsb1.` prefix,
decoding to at most 6,139 bytes, of which 6,099 remain after the
24-byte nonce and 16-byte tag: the plaintext budget. Composite
establishment computes the worst case against that budget statically:
the shared envelope's fixed members, plus each deduplicated parent
binding, plus each node's boundary worst case derived from its
declared order-field types — integer, boolean, and id widths are
closed, and every string order field must carry a declared maximum
encoded length in its contract, without which the composite refuses
establishment. A composite whose computed worst case exceeds the
budget refuses **at establishment** with
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED` — a coded
authoring-time refusal, never a data-dependent runtime cliff. Runtime
mint failure therefore has custody grounds only (keyring unavailable
or retired) and keeps LLP 0110's rule: refuse the page rather than
falsely reporting a terminal page.

Coordinated resume: one continuation resumes all nodes together at a
new single snapshot. On **every** resume, every deduplicated parent
declaration — terminal nodes' included — is point-read and
visibility-checked against the new snapshot: seal-entirely and the
`_version`/incarnation restart binding require it, and the parent
projection each node returns is re-read from the current snapshot,
never carried in the token. Non-terminal nodes resume from their bound
boundaries; terminal nodes examine **zero child-range entries** — the
zero-examined claim counts child-range entries, not parent
point-reads — and return their empty terminal page. The continuation
is present exactly while some node is non-terminal. Standalone
`sbbc1` cursors refuse in the composite and composite cursors refuse
in standalone plans. A bound parent's incarnation or `_version` change
returns the single `SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED`
diagnostic; malformed, cross-app, cross-plan, cross-authority, and
boundary-invalid credentials collapse to
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`. The snapshot claim is
per invocation only: successive pages are separate snapshots, and the
composite makes each node's no-skip/no-duplicate claim (LLP 0110 §1.4 /
LLP 0080 §2), jointly resumed, never a frozen cross-page snapshot.

### 2.5 Work ceiling, identity, and live classification

The composite work ceiling is the **sum of its nodes' ceilings**: at most
`Σ (takeᵢ + 1)` examined child-range entries plus one point-read per
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
composed experimental id — with v1 bounded-children-only, exactly
`snapshot_batch_v1` plus `bounded_children_v1`. The gate's enforcement
locus is **admission** (LLP 0134's acknowledgment-gate rule): an
artifact without the acknowledgments refuses at admission, whether or
not generation also refuses earlier. Runtime support requires the
target to support every composed node kind; a missing node capability
makes the composite unavailable, never degraded. Composite promotion
order is recorded here as a **proposed LLP 0134 prerequisite, not an
enforced rule of this Spec**: LLP 0134's maturity is a registry-global
constant with no dependency vocabulary, so the coupling —
`snapshot_batch_v1` promotion requires the prior promotion of every
admissible composed profile — is proposed into LLP 0134's own review
loop (its promotion evidence bar is the natural locus), and until
adopted there the binding facts are the registry-global model plus
the per-artifact acknowledgment gate above. LLP 0134 already names
both of this Spec's ids as default-route entrants.

The acknowledgment ceremony is deliberate: composing unproven parts should
be loud (LLP 0120 option 3a's own note), and until LLP 0134 is ratified,
both this profile and Part 1's primitive terminate at experimental by
design (LLP 0113 §1; LLP 0120 finding 9).

## 3. Capability ids and diagnostics

New registry entries, both `experimental`, both support-false until
qualified publication: `sequence_allocation_v1` and `snapshot_batch_v1`.
New stable authoring diagnostics:
`SNAPBACK_SEQUENCE_DECLARATION_INVALID`,
`SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID`,
`SNAPBACK_SNAPSHOT_BATCH_NODE_INELIGIBLE`,
`SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED`, and
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED` (§2.4's static
establishment-time refusal). New stable public runtime diagnostics:
`SNAPBACK_SEQUENCE_EXHAUSTED`, `SNAPBACK_SEQUENCE_UNDECLARED` (a
runtime ctx-boundary refusal — generation cannot see through
imperative handler code, so the undeclared-allocation check enforces
where the call executes, §1.2),
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
   allocation" as fixed host bookkeeping; the relation-registry
   lifecycle's registration clause extends from "named as a
   bounded-children parent" to "…or declared as a sequence-counter
   scope," with the same same-transaction insert registration, reviewed
   backfill before activation, and restore validation applying to
   enrolled scope tables (§1.1), and the protected
   `relationIncarnationOf` stamping boundary stated available to — and
   required of — tables storing allocated values under
   `(scopeId, relationIncarnation)`-prefixed unique constraints; open
   question 4 is annotated answered-for-sequences; open question 2
   gains a pointer to `snapshot-batch.v1` as the admitted multi-parent
   composition answer.
2. **LLP 0080.** Open questions 1 and 7 gain a pointer: snapshot-batch is
   the admitted answer for multi-child fan-out; OQ7's aggregate half stays
   open pending LLP 0130 SD-2.
3. **LLP 0051 orbit.** The `AllocateSequence` settlement-evidence
   integration (replay republishes the retained value; no second
   allocation) rides the same landing as amendment 1 — with the
   restriction pinned: the allocated value never joins LLP 0051 D1's
   closed `{ids, now}` ctx-answer ledger, and no capture lane
   transmits it (§1.4).
4. **LLP 0108.** The JS-mutation manifest gains the per-kind
   `sequences` member (default empty); the frozen `implementationHash`
   ordered field list gains `sequences` as a dated extension, with new
   golden vectors freezing the extended preimage; and the harness ctx
   surface gains `ctx.sequence.allocate` under §1.7's scope-visibility
   gate.
5. **LLP 0133.** A dated note under its element-4 (host-call answer
   surface) section: sequence allocations are settlement-only host
   answers, outside both lanes' captured environments; the
   admission-vocabulary exclusion of allocating operations from local
   execution registers with LLP 0129 row 2's owner when that
   vocabulary lands (§1.4, open question 6).
6. **LLP 0113.** §4's closed `familyKind` union gains dated entries
   for `sequence_allocation_v1` and `snapshot_batch_v1` when hosted
   qualification is first sought (LLP 0134 §1's rule: family kinds are
   added by dated LLP 0113 amendment, never by inference).

## 5. Executable acceptance

Falsifiable, per part. `Implemented` and any capability claim additionally
require the LLP 0113 qualification machinery; nothing below is claimed as
passing today.

### 5.1 Sequence allocation

- Allocations in one scope incarnation return 1, 2, 3, …; concurrent
  allocators produce a dense, strictly increasing committed history with no
  duplicates; an aborted transaction leaves `next_value` unchanged; and
  the direct commit-order witness holds: the committed values sorted by
  their receipts' commit versions are exactly 1..n.
- **Commit-order falsifier**, the adversarial two-transaction race:
  T1 allocates and pauses before commit; T2 allocates and is driven to
  commit first. Recorded authoritative commit versions must order the
  committed values — sequence order equals commit-version order — with
  T1's paused attempt aborted by captured-read validation on the
  counter row and its fresh re-execution allocating after T2 (§1.2).
  Every target passes this exact vector or publishes the structured
  GAP (§1.3).
- Delete/recreate of the scope row restarts the counter at 1 under the new
  incarnation; orphaned rows stay physically stored but unreachable, and
  `(scopeId, relationIncarnation)`-prefixed unique constraints admit the
  restarted values.
- Allocation against a scope table with pre-existing rows never
  registered in the incarnation registry refuses until the explicit
  reviewed backfill runs (§1.1); after the backfill, allocation
  proceeds under the registered incarnations.
- Exact settlement replay returns byte-identical retained results including
  the allocated value, with the counter advanced exactly once across
  sequential and concurrent duplicates.
- Exhaustion boundary rows: a counter driven to
  `next_value = MAX_SAFE_INTEGER − 1` allocates `MAX − 1`, then `MAX`
  (the last admitted value); the first post-maximum request refuses
  with `SNAPBACK_SEQUENCE_EXHAUSTED` and rolls back source, activity,
  counter, and settlement together, and every subsequent attempt
  refuses identically (§1.5). An undeclared handler allocation refuses
  at the ctx boundary; a handler allocation with neither declared
  scope reach nor a public-scope declaration refuses (§1.7); a missing
  or inactive scope refuses with
  `SNAPBACK_RELATION_PARENT_UNAVAILABLE`; no generated or ctx surface
  exposes a counter's current value.
- **Relay `moveCard`** is expressed as `write-with-activity.v1` plus
  `AllocateSequence`: admission passes where the range collect previously
  refused; card patch, activity insert, and counter advance share one
  commit version; the exact `{cardId, activityId, sequence}` result
  (Diary 0033) replays byte-identically. The acceptance arm is
  owner-provenanced — `write-with-activity.v1` remains
  `existing-owner.v1`-only, and this Spec lifts no anonymous-arm gap
  (§1.9).
- **Campfire `send`** uses a declared handler-tier allocation whose
  counter carries the explicit public-scope declaration (§1.7), with
  the rooms table enrolled by the counter declaration (§1.1):
  instrumented reads show no range read for sequence derivation, the
  anonymous arm passes under the public-scope declaration, and
  committed message sequences are dense and strictly increasing under
  concurrent senders.

### 5.2 Snapshot batch

- **Relay `boardView`** runs as a three-node bounded-children composite
  over one board: instrumentation proves one deduplicated parent point-read
  and at most `Σ (takeᵢ + 1)` examined child-range entries; all node
  results carry one snapshot version, and an injected concurrent write
  between node evaluations appears in no node.
- Absent board and invisible board return byte-identical sealed `absent`
  envelopes — same result, code, status, transport, live initial state, and
  ordinary inspection — including with malformed cursor bytes.
- Coordinated resume: per-node no-skip/no-duplicate holds across concurrent
  inserts, deletes, and order-key moves; a terminal node examines zero
  child-range entries on resume while its deduplicated parent is still
  point-read and visibility-checked (§2.4); the continuation disappears
  exactly when all nodes are terminal; no node page contains a
  `continuation` member or any `sbbc1` credential (§2.3).
- Cursor matrix: malformed, cross-app, cross-plan, cross-parent,
  cross-authority-partition, and boundary-invalid composite cursors refuse;
  a standalone `sbbc1` cursor refuses in the composite and vice versa; a
  parent `_version` or incarnation change returns the restart diagnostic.
- Cursor budget: a maximum-width eight-node composite at its declared
  order-field bounds round-trips its `sbsb1` continuation inside the
  8,192-byte cap; a composite whose static worst case exceeds the
  plaintext budget refuses establishment with
  `SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED`; a custody-ground
  mint failure refuses the page, never reporting a terminal page
  (§2.4).
- Dedup identity: `ParentAuthorizationKeyV1` golden vectors reproduce
  the dedup grouping cross-language, and the near-miss vectors — same
  parent table under a different argument binding, same binding under
  a different visibility declaration — must not dedup (§2.2).
- A two-instance live test proves a commit to any node's table replaces the
  whole composite, authority rotation fences predecessor delivery, and a
  cursor-bearing subscribe refuses before storage.
- An artifact not acknowledging `snapshot_batch_v1` plus
  `bounded_children_v1` refuses at admission — the acknowledgment
  gate's locus (§2.6) — whether or not generation also refuses
  earlier; a target missing any node capability reports the composite
  as a structured GAP.
- The run above is recorded as **3a usage evidence for LLP 0130 SD-2**,
  alongside the explicit record that `boardSummary` and the Split ledger
  derivation were *not* expressed (aggregates, outside both parts); SD-2's
  criteria — not this Spec — decide whether that residue gets the
  contracted-aggregate profile. The record is evidence, not a
  decision: SD-2 is the author's pre-adjudicated decision instrument,
  adopted with LLP 0120 — which already places the aggregate shapes
  outside 3a — in evidence, and recording them as not-expressed is
  exactly the input its branches consume. Whether the
  contracted-aggregate branch fires therefore remains genuinely
  reachable-or-not per SD-2 alone: its first branch's `boardView` half
  (expression within ceilings, acceptance green) is empirically open,
  evidence can land outside both branches and escalate, and any claim
  that a branch is already forced is an adjudication for SD-2's owner
  (LLP 0130), not for this Spec.

## Nonclaims

- **No aggregates, in either part.** No readable counter value, no counts,
  sums, or grouping, no reduction nodes. The contracted-aggregate decision
  is LLP 0130 SD-2's, made later from 3a usage evidence; this Spec neither
  pre-decides it nor smuggles a count through the counter. SD-2's
  criteria are the decision instrument; this Spec supplies the usage
  evidence those criteria consume and decides no branch (§5.2's final
  bullet states the reasoning in full).
- **No local execution of allocating operations.** Neither allocation
  surface is admissible for lane-L local execution (LLP 0133); the
  allocated value exists only at authoritative settlement, is never a
  client-capturable environment member in any lane, and no speculative
  surface presents one (§1.4). Admission of allocating operations to
  local execution is out of scope pending LLP 0129 row 2's admission
  vocabulary (open question 6).
- **No implementation, no capability support, experimental terminus.**
  Both ids are reserved; support is false everywhere; every §5 claim is a
  future witness, not a status. On the default LLP 0113 route both
  profiles terminate at experimental until LLP 0134's promotion path is
  ratified (LLP 0120 finding 9); this Spec cannot and does not shorten
  that.
- **No performance results.** §1.6's statements are named empirical
  expectations; LLP 0125's burst work owns the measurement.
- **No general query language, and no relational nodes in v1.**
  Data-dependent node invocation, arbitrary predicates, and
  caller-composed shapes stay rejected (option 3's verdict); no stable
  surface widens — v1 composes no `relational_query_v1` node at all
  (§2.1), and a successor admitting one changes that profile's own
  admission not at all.
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
5. (Resolved for v1 in v0.2: bounded-children-only, §2.1.) The dated
   successor question — what must be specified before
   `relational_query_v1` nodes are admissible: binding the composite's
   merged normalized argument values in the `sbsb1` cursor (a
   relational node's argument-referencing filters are bound in its
   standalone cursor and must not come unbound in composition); the
   node's boundary, terminal, and restart mapping under root-window
   semantics (what replaces parent `_version`); its seal semantics
   (it has no protected parent to seal on); and counting its
   per-consumed-root joined-side unique-index lookups in the composite
   ceiling.
6. The successor shape for locally executed allocating operations: a
   speculative placeholder re-derived at settlement would need a
   sequence-map analog, and a small-integer leaf rewrite is unsound
   (§1.4) — typed declarations (LLP 0133 OQ2's graduation path) look
   like the prerequisite. Owned by LLP 0129 row 2's admission
   vocabulary; recorded here so §Nonclaims' exclusion has a named
   successor.
