# LLP 0135: Sequence allocation and snapshot-batch composition

**Type:** Spec
**Status:** Accepted
**Systems:** Application data API, Relational queries, Mutations, Code
generation, Authorization, Live Queries, Diagnostics, Testing, Demo apps
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:** 2026-08-04 (dated diagnostic addition:
`SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID` joins the stable
authoring diagnostics — the load-time result-contract exactness refusal
the implementation already emits.) 2026-08-03 (snapshot-batch implementation: the experimental
local SQLite/Ibex target now emits and host-verifies LLP 0157 identity,
executes 2–8 bounded-child nodes at one snapshot, and resumes them with the
exact `sbsb1` grammar; the dated implementation record pins the previously
semantic-only `ParentAuthorizationKeyV1` carrier); 2026-08-03 (Accepted LLP 0157 boundary: snapshot-batch execution
semantics remain here; LLP 0157 now owns the composition identity,
completeness model, shared cursor registry, and exact `sbsb1` grammar, so the
held implementation may consume them without advertising capability early);
2026-08-02 (publication-honesty reconciliation: the commissioned
handler-tier sequence substrate landed — declarations,
`ctx.sequence.allocate`, authoritative commit/replay facts, order-field bounds,
and the A6 fixture — and the combined integration checkpoint adds generated
`AllocateSequence` plus mutation-atomic lane-Q withholding. This remains an
unpublished, support-false substrate pending the complete §5.1 qualification
train. LLP 0157 §D8 confirms Part 2 is
implementable as written and that LLP 0135 owns the cursor grammar, so the
snapshot-batch lane is unblocked rather than held); 2026-08-02 (the §4 acceptance folds landed as dated owner
amendments; implementation/capability claims remain gated); 2026-07-31 (ACCEPTED under LLP 0130 SD-4's standing
authorization: dual-family READY — Fable round 3, Codex round 4 —
with the three conditions checked and satisfied: (1) zero unresolved
MATERIAL concerns in either family's final round (Codex round 4
verified both round-3 MATERIALs resolved, no fresh defects; Fable's
round-3 details D-R1–D-R5 were applied in v0.4); (2) within the
decided scope of its commission (move6's sequence-allocation and
snapshot-batch designs plus the 3a composition per LLP 0129's
ledger); (3) no evidence boundary weakened — the thrown-error
disclosure channel was acknowledged and classified rather than
claimed away, lane-Q withholding was strengthened to
mutation-atomic, and every empirical claim keeps its code citation.
Recorded per SD-4's honesty rule: the author's standing acceptance
made in advance. Review artifacts:
reviews/0135-sequence-allocation-and-snapshot-batch.{fable,codex}.md.)
2026-07-31 (v0.4, round-3 fixes: round 3 of the loop
returned a split verdict
(`reviews/0135-sequence-allocation-and-snapshot-batch.fable.md`
round 3: READY — all five round-2 Fable items verified resolved
against their cited authorities, 5 new DETAIL D-R1–D-R5;
`reviews/0135-sequence-allocation-and-snapshot-batch.codex.md`
round 3: NOT READY — round-2 D1/D2 verified resolved, the M1
diagnostics residue held MATERIAL, 1 new MATERIAL on the lane-Q
overlay delta). Applied: Codex M1 residue = Fable D-R4/D-R5 (the
thrown-error payload channel classified: an uncaught handler error's
code and stringified message are encoded into the handler completion
envelope and ride the rejection as typed error details — a
protocol-carried vehicle with app-authored content, the handler
chose what to throw — named in §1.7's sink matrix as the second
app-authored disclosure channel beside console diagnostics, with
sanitizing rejected on the same taint argument as buffering; §1.2's
no-trace claim narrowed to durable and result surfaces — counter
state, stored rows, settlement, receipts, activity, declared result
contract — with a failed invocation's result record pinned clean,
keeping §5.1's "results record nothing" falsifiable; the impossible
single-run §5.1 vector split into run A, console disclosure aborted
by captured-read invalidation, and run B, thrown-error disclosure
aborted by its own throw — a throwing handler never reaches
captured-read validation, LLP 0003); Codex lane-Q MATERIAL = Fable
D-R3 (§1.4's per-projection omission replaced by mutation-atomic
withholding: if any row of a mutation's optimistic changeset would
require a sequence-projected placement, the entire changeset is
withheld from optimistic presentation until settlement — never
per-projection or per-row, preserving LLP 0043 M2 / LLP 0008
all-or-nothing changeset atomicity — with the LLP 0043/0008 fold
drafted as §4.7 and the cross-projection multi-row vector added to
§5.1); Fable D-R1 (§4.1 pins `maxEncodedBytes` single-valued per
`(table, field)` — schema-level, not per plan; conflicting
declarations refuse at admission); Fable D-R2 (§2.4's static worst
case computed over serialized plaintext bytes in the credential's
actual closed-record encoding, never the raw sum of declared
bounds).)
2026-07-31 (v0.3, round-2 fixes: round 2 of the loop
returned NOT READY from both families
(`reviews/0135-sequence-allocation-and-snapshot-batch.fable.md`
round 2: all fifteen round-1 Fable concerns verified resolved, 2 new
MATERIAL + 3 DETAIL;
`reviews/0135-sequence-allocation-and-snapshot-batch.codex.md`
round 2: round-1 items 2–12 verified resolved, the round-1 SD-2
adjudication ACCEPTED as not a defect, 1 new MATERIAL + 2 DETAIL).
Applied: Codex M1 (the §1.2/§1.3 no-trace claims narrowed to durable
and protocol surfaces — counter state, stored rows, settlement,
receipts, activity, results — with handler-authored diagnostics named
in §1.7's sink matrix as an app-authored disclosure channel that can
carry a tentative aborted value; the buffering alternative rejected
with rationale in §1.7 — sequence-bearing-only buffering is
unenforceable, whole-channel buffering blinds aborted attempts — and
the adversarial aborted-allocation diagnostic vector added to §5.1);
Fable M-A (the string order-field bound gets its declaration surface:
§4.1 drafts the LLP 0110 order-field-declaration `maxEncodedBytes`
member, write-enforced at every central writer with
`SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED` and a reviewed
adoption check over pre-existing rows, making §2.4's static budget a
real bound and §5.2's round-trip vector implementable); Fable M-B
(§1.7's no-reach refusal collapses into
`SNAPBACK_RELATION_PARENT_UNAVAILABLE` — for a non-public counter,
absent and hidden scope rows refuse byte-identically, the visibility
evaluation ordered before the incarnation check; §3 and §5.1 aligned,
closing the existence oracle); Codex D1 (§1.4's divergence claim
narrowed: sequence-bearing outcome changes are LLP 0133 class-3
outcome divergence, and the real gap is the missing typed mapping for
speculative values copied into later pending args, not a
fits-no-class anomaly); Codex D2 (§5.2's branch-uncertainty
overstatement removed — LLP 0120 already places the aggregate shapes
outside 3a, so the contracted branch is SD-2's expected consequence,
owned there); Fable D-N1 (§5.1's race vector rebound to the invariant
— no duplicate, no gap, commit-version order — admitting both
LLP 0003 recovery shapes, retry or typed conflict); Fable D-N2
(lane Q's presentation gap specified in §1.4: the optimistic overlay
omits the pending row from projections that project or order by the
sequence field until settlement — omission, not a sentinel — with
LLP 0043 M2 / LLP 0133 named the overlay owner); Fable D-N3
(cross-parent added to §2.4's cursor-refusal collapse list).)
2026-07-31 (v0.2, round-1 fixes: round 1 of the Wave-1
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
LLP 0120, LLP 0125, LLP 0127, LLP 0129, LLP 0130, LLP 0133, LLP 0134, LLP 0157,
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
concurrent advance detected at commit aborts the whole attempt, and any
fresh re-execution allocates fresh. Whether that contention surfaces as
serialization or as validate-and-retry, and under which diagnostic, is
owned by the target execution model (LLP 0003), not this Spec; the
normative contract is only that a committed allocation's counter read
was still current at its commit and that a failed attempt leaves no
trace on any durable or result surface — counter state, stored rows,
settlement, receipts, activity payloads, and the declared result
contract: a failed invocation stores no settlement row, retains no
result bytes, and returns no declared-contract result member. Two
app-authored disclosure channels are the named exceptions to that
enumeration (§1.7's sink matrix): handler console diagnostics,
forwarded immediately and never a protocol surface, and the
thrown-error rejection payload — an uncaught handler error's code and
stringified message are encoded into the handler completion envelope
and ride the rejection the submitting caller receives as typed error
details. That vehicle is protocol; its content is app-authored (the
handler chose what to throw). The abort causes are distinct and never
conflated: a throwing handler rejects on its own throw and never
reaches captured-read validation (LLP 0003), while a handler that
reaches captured-read validation completed without throwing.
The writer lock is never held across handler execution, the handler is
never re-entered mid-commit, and the integer returned mid-handler is
the value committed — or the transaction does not commit. This is what
makes §1.3's commit-order assignment hold on the buffered boundary.

On both surfaces, allocation against a scope row with no active incarnation
(missing, deleted, or never registered) refuses with the existing
`SNAPBACK_RELATION_PARENT_UNAVAILABLE` outcome — allocating from a scope is
relationally a write into it. §1.7 collapses the non-public no-reach
refusal into the same byte-identical outcome, so absence and
invisibility stay indistinguishable on this path.

### 1.3 Allocation-versus-commit ordering and gap semantics

V1 pins the **same-transaction** posture from LLP 0120's map: the counter
advance is part of the invoking mutation's storage transaction, committing
or rolling back with it. Consequences, each a contract:

- **No gaps from aborts.** An aborted or refused transaction advances
  nothing and leaves no trace on any durable or result surface
  (§1.2's enumeration; console diagnostics and the thrown-error
  rejection payload are §1.7's named app-authored disclosure
  channels). Committed allocations within one
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
accepted captured environment in any lane. Under re-derivation,
sequence-bearing result and row differences are ordinary LLP 0133
class-3 **outcome divergence** — the authoritative outcome wins — but
that class carries no typed mapping for a speculative value already
copied into later pending arguments: the id-map's leaf rewrite is
sound only for high-entropy minted strings, and a re-derived small
integer is unsafely leaf-matchable. V1 therefore scopes allocating
operations **out of local execution** entirely: neither surface is
admissible for lane-L capture, and no speculative surface presents an
allocated value (§Nonclaims; open question 6 records the successor
shape). A lane-Q queued intent that allocates still settles correctly
— its handler never runs client-side, so settlement executes it
authoritatively and allocates then — but the presentation gap is real
and specified: lane Q's optimistic overlay is computed from write
plans and args alone (LLP 0043 M2), the allocated value does not
exist before settlement, and a sequence order field is
schema-required and projected wherever it orders (LLP 0110). The v1
posture is **mutation-atomic withholding, not fabrication**: if any
row of a mutation's optimistic changeset would require a
sequence-projected placement, the entire changeset is withheld from
optimistic presentation — every row, in every projection — until
settlement supplies the authoritative value. The rule is
mutation-atomic, never per-projection or per-row: LLP 0043 M2 pins
overlay application all-or-nothing per changeset (LLP 0008's
multi-row atomicity), and a per-projection omission would present a
changeset's sequence-free rows while hiding its sequence-bearing
ones — exactly the partial presentation that atomicity rule exists
to prevent. A sentinel would be a presented speculative allocated
value, exactly what this section prohibits. §4.7 drafts the
LLP 0043/0008 fold; the overlay lifecycle owner (LLP 0043 M2, within
lane Q's capture semantics, LLP 0133) owns any richer successor
presentation, beside open question 6.

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

The gate's refusal mints no new code: for a non-public counter,
no-reach and absence refuse **byte-identically** with §1.2's
`SNAPBACK_RELATION_PARENT_UNAVAILABLE` outcome — the visibility
evaluation is ordered before (and collapses into) the incarnation
check — so a caller without declared reach cannot distinguish a
hidden scope row from a missing one, and no existence oracle opens on
the allocation path (LLP 0110's absent-versus-invisible discipline,
extended here on the write side as §2.3 extends it on the read side).
A public-scope counter's missing or inactive scope still refuses
`SNAPBACK_RELATION_PARENT_UNAVAILABLE`: the public declaration
already discloses existence semantics deliberately.

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
  conflicting value is not observable;
- **handler console diagnostics**: an app-authored disclosure
  channel, outside §1.2's no-trace enumeration — a handler holds the
  tentative integer as an ordinary value before commit and may
  stringify it into console output, and the diagnostics path forwards
  immediately (diagnostics are never control flow), so a tentative
  value can outlive an abort that commits nothing;
- **thrown-error rejection payload**: the second app-authored
  disclosure channel, and the one that rides protocol — an uncaught
  handler error rejects the mutation (LLP 0003; the throw itself is
  the abort, and such a handler never reaches captured-read
  validation), and the error's code and stringified message are
  encoded into the handler completion envelope and surfaced to the
  submitting caller as the rejection's typed error details. The
  vehicle is protocol; the content is app-authored — the handler
  chose what to throw — and the payload is distinct from the
  declared result contract, which a failed invocation never
  populates (§1.2), keeping "results record nothing" falsifiable
  rather than definitional. Sanitizing sequence-bearing values out
  of this payload is rejected on the same taint argument as
  buffering: a stringified or derived copy is untrackable in
  imperative code; and
- **timing**: a named nonclaim — no constant-work claim is made.

V1's containment rule: values from a counter may be stored only in the
scope row itself or in rows whose visibility is through that scope row
(LLP 0110's through-parent discipline). Its enforcement boundary,
stated honestly, is the allocating operation's own writes and nothing
more: the generated profile proves it at generation — the plan's
writes are closed; the handler tier declares the counter but cannot
prove where the value flows — the declared-versus-proved split
LLP 0120's option 2 names, recorded here as a limitation, not hidden
(open question 1); the same honesty extends to diagnostics — the tier
cannot prove a value stays out of the handler's own logs or thrown
errors, and v1 narrows the no-trace claim rather than buffering or
sanitizing either channel, because scrubbing or buffering only
sequence-bearing content is
unenforceable (a stringified or derived copy is untrackable in
imperative code) and buffering all handler diagnostics until commit
would blind exactly the aborted attempts diagnostics exist to
explain, while the generated profile authors no diagnostics at all;
and once a value is legitimately observed through
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
closed, and every string order field must carry the declared
`maxEncodedBytes` bound of §4.1's drafted order-field-declaration
member — schema-level and write-enforced, so no stored value can
exceed it — without which the composite refuses establishment. The
worst case is computed over **serialized** plaintext bytes: each
bound member's maximal value as encoded in the credential's actual
closed-record plaintext encoding (the encoding the golden vectors
pin), escaping and framing included — never the raw sum of declared
bounds, which can undercount an in-record string encoding and
reintroduce the mid-flight cliff on adversarial strings. A
composite whose computed worst case exceeds the
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
diagnostic; malformed, cross-app, cross-plan, cross-parent,
cross-authority, and boundary-invalid credentials collapse to
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
establishment-time refusal).

> Dated addition (2026-08-04): the implementation also emits
> `SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID`, a stable authoring
> diagnostic refusing load when a snapshot-batch function's declared
> result contract does not exactly match the declaration-ordered
> cursor-free visible page tuple. It is distinct from
> `SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID` (plan shape) because the plan
> can be well-formed while the authored result contract has drifted;
> collapsing the two would hide which artifact to fix. Recorded here so
> no parallel wire code rides unspecified
> (`issues/20260803-snapshot-batch-unspecified-diagnostic.md`). New stable public runtime diagnostics:
`SNAPBACK_SEQUENCE_EXHAUSTED`, `SNAPBACK_SEQUENCE_UNDECLARED` (a
runtime ctx-boundary refusal — generation cannot see through
imperative handler code, so the undeclared-allocation check enforces
where the call executes, §1.2),
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`,
`SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED`,
`SNAPBACK_SNAPSHOT_BATCH_LIVE_CURSOR_UNSUPPORTED`,
`SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED` (the §4.1
write-boundary refusal of a string order-field value exceeding its
declared `maxEncodedBytes`), and inherited
`SNAPBACK_RELATION_PARENT_UNAVAILABLE` — one code covering both
allocation against a missing or inactive scope incarnation and §1.7's
no-reach refusal on a non-public counter, byte-indistinguishable
between the absent and hidden causes (§1.7).

## 4. Fold-on-acceptance amendments (applied 2026-08-02)

This Spec was accepted before its required owner folds landed. The corpus
hygiene reconciliation applied the amendments below on 2026-08-02, explicitly
as design contracts rather than implementation or capability claims:

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
   `(scopeId, relationIncarnation)`-prefixed unique constraints; the
   order-field declaration gains an optional `maxEncodedBytes` member
   for string order fields — a declared UTF-8 encoded-length maximum,
   **single-valued per `(table, field)`**: the bound is schema-level,
   not per plan — every plan ordering the same string field binds the
   one authoritative value, and conflicting declarations refuse at
   admission — enforced at the write boundary by every central writer
   (an
   oversized value refuses with
   `SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED`), with adoption
   over pre-existing rows requiring the reviewed check that no stored
   value exceeds the bound (no row silently blessed); composite
   establishment requires the member on every composed string order
   field (§2.4), which is what makes the static cursor budget a real
   bound; open
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
7. **LLP 0043 / LLP 0008.** M2's overlay rule gains the withholding
   clause: a changeset any of whose rows would require a
   sequence-projected placement is withheld whole from optimistic
   presentation until settlement (§1.4) — extending, never weakening,
   the all-or-nothing-per-changeset atomicity LLP 0008 pins.

## 5. Executable acceptance

Falsifiable, per part. `Implemented` and any capability claim additionally
require the LLP 0113 qualification machinery. The dated implementation record
below names the sequence vectors exercised by the commissioned handler-tier
slice; unlisted sequence vectors and every snapshot-batch vector remain future
witnesses.

### 5.1 Sequence allocation

- Allocations in one scope incarnation return 1, 2, 3, …; concurrent
  allocators produce a dense, strictly increasing committed history with no
  duplicates; an aborted transaction leaves `next_value` unchanged; and
  the direct commit-order witness holds: the committed values sorted by
  their receipts' commit versions are exactly 1..n.
- **Commit-order falsifier**, the adversarial two-transaction race:
  T1 allocates and pauses before commit; T2 allocates and is driven to
  commit first. The vector binds the invariant, not the recovery
  shape: T1's stale attempt never commits its value — captured-read
  validation on the counter row aborts it — and the committed history
  stays dense, duplicate-free, and ordered by commit version
  (sequence order equals commit-version order). Whether T1's caller
  then observes a fresh re-execution allocating after T2 or a typed
  conflict is the target's per-LLP 0003 choice (§1.2); either
  recovery shape passes. Every target passes this exact vector or
  publishes the structured GAP (§1.3).
- **Aborted-allocation disclosure vectors**, adversarial, two runs
  with distinct abort causes — a throwing handler never reaches
  captured-read validation (LLP 0003), so no single run can exercise
  both channels. Run A (console): a handler allocates, stringifies
  the tentative integer into a console log, completes normally, and
  is driven to abort by captured-read invalidation on the counter
  row; the console channel may carry the tentative value (§1.7's
  app-authored disclosure). Run B (thrown error): a handler allocates
  and throws with the tentative integer in the error payload; the
  throw itself rejects the mutation, and the rejection's typed error
  details may carry the value (§1.7's protocol-carried app-authored
  channel). In both runs every durable and result surface is
  trace-free: counter state, stored rows, settlement, receipts,
  activity, and the declared result contract record nothing of the
  aborted attempt — no settlement row and no retained result bytes
  exist for either run (§1.2).
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
- **Mutation-atomic withholding**, cross-projection: a lane-Q queued
  mutation whose optimistic changeset mixes a sequence-bearing insert
  and a sequence-free patch presents neither row optimistically — in
  every projection, including projections of the sequence-free row
  alone — until settlement, after which both appear atomically with
  the authoritative value; no projection ever observes a partial
  changeset (§1.4).
- Exhaustion boundary rows: a counter driven to
  `next_value = MAX_SAFE_INTEGER − 1` allocates `MAX − 1`, then `MAX`
  (the last admitted value); the first post-maximum request refuses
  with `SNAPBACK_SEQUENCE_EXHAUSTED` and rolls back source, activity,
  counter, and settlement together, and every subsequent attempt
  refuses identically (§1.5). An undeclared handler allocation refuses
  at the ctx boundary; on a non-public counter, a handler allocation
  with neither declared scope reach nor a public-scope declaration
  and an allocation against a missing or inactive scope refuse with
  the single `SNAPBACK_RELATION_PARENT_UNAVAILABLE` outcome,
  byte-identical between the hidden and absent causes (§1.7's oracle
  collapse); no generated or ctx surface exposes a counter's current
  value.
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
  8,192-byte cap; a composite whose static worst case — computed over
  serialized plaintext bytes (§2.4) — exceeds the
  plaintext budget refuses establishment with
  `SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED`; a custody-ground
  mint failure refuses the page, never reporting a terminal page; and
  a write placing a string order-field value above its declared
  `maxEncodedBytes` refuses at the write boundary with
  `SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED`, so no stored
  boundary exceeds the computed worst case (§2.4, §4.1).
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
  exactly the input its branches consume. Because LLP 0120 already
  records those shapes as inexpressible under 3a, the
  contracted-profile branch is the expected consequence once SD-2's
  usage-evidence trigger fires — an outcome SD-2 plus LLP 0120 own
  and cause, not one this Spec newly decides; the trigger's firing
  and the branch adjudication themselves stay with SD-2's owner
  (LLP 0130), not this Spec.

## Implementation record — 2026-08-02

The source tree contains the commissioned local SQLite/Ibex **handler-tier
sequence substrate**. This is implementation evidence, not a published target
support claim. `defineJsMutation.sequences`
declares each counter's name, ordinary scope table, and either the exact
membership declaration/roles that make the scope reachable or the explicit
`public.v1` reach declaration. `ctx.sequence.allocate(counterName, scopeId)`
names the scope in the call itself. The host permits zero or one allocation,
captures the scope incarnation and counter read, and the serialized SQLite
commit advances the framework counter in the same transaction as application
writes and settlement. Exact replay retains the allocation fact and never
executes a second advance; ordinary live fanout strips that settlement-only
fact. Sequence-only mutations are admitted without a fictitious application
write.

The code-owned capability vocabulary includes `sequence_allocation_v1` at
Experimental maturity, but no target support is published. The required
posture remains support false with a structured GAP until the complete §5.1
corpus and LLP 0113 qualification/publication machinery are satisfied.
`OrderExpr.maxEncodedBytes` is the single declaration surface for string
ordering bounds. Admission reconciles it to one value per `(table, field)`,
scans existing rows, and every central insert/patch/seed path enforces UTF-8
byte length with
`SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED`.

Executable substrate evidence is:

- `sequence_host_bridge_is_declared_scoped_and_commits_with_the_mutation` in
  `src/runtime.rs` for the ctx boundary, explicit public scope, undeclared
  refusal, and the collapsed missing-scope refusal;
- `sequence_allocation_is_gapless_atomic_replay_safe_and_incarnation_scoped`
  in `src/storage.rs` for explicit brownfield-incarnation backfill refusal,
  abort-without-burn, dense allocation, stale allocator conflict, exact
  settlement replay, maximum/exhaustion rollback, and delete/recreate restart
  under a new incarnation;
- `order_field_utf8_bound_refuses_brownfield_and_all_central_writes` in
  `src/storage.rs` plus `packages/snapback-codegen/sequence-authoring.test.mjs`
  for authoring, identity/capability emission, brownfield adoption, and
  central-writer enforcement; and
- the A6 operations-ledger fixture, whose concurrent `createJob` calls now use
  `ctx.sequence.allocate('jobNumber', orgId)`, prove dense JOB-4..JOB-9
  allocation and receipt facts, and no longer patch an application-owned
  counter. Its three literal-seed allocations, and every historical export
  allocation before reset/restore, are recorded through the real primitive by
  a sequence-only brownfield bridge; and
- the combined sequence integration proof for the closed generated
  `AllocateSequence` plan step and mutation-atomic lane-Q withholding across
  projections.

This is deliberately not a whole-Spec `Implemented` claim or a capability
publication. Generated allocation and lane-Q withholding extend the implemented
substrate, but do not close the two app-authored abort-disclosure vectors, the
complete multi-writer performance/commit-order corpus, or the other unlisted
§5.1 qualification rows.

## LLP 0157 acceptance boundary — 2026-08-03

This Spec continues to own `snapshot-batch.v1` static admission,
one-snapshot execution, parent-authorization deduplication, seal-entirely
results, coordinated resume semantics, work ceilings, live classification,
experimental acknowledgment, and its executable capability gate. Accepted
LLP 0157 owns the query-node algebra around that substrate,
`NodePlanHashV1`/`PlanHashV1`/`QueryMaterializationKeyV1`, completeness
proofs and page-set composition, the shared `sbbc1`/`sbsb1` cursor-family
registry, and the exact `sbsb1` body/serializer/budget. The held implementation
must consume those records and may not mint a parallel cursor, liveness, or
identity shape. Acceptance unblocks implementation; it does not register or
advertise `snapshot_batch_v1`.

## Implementation record — 2026-08-03 (snapshot-batch v1)

The contributor local SQLite/Ibex target now supports the Experimental
`snapshot_batch_v1` capability. Codegen accepts a declaration-ordered tuple of
2–8 complete `bounded-children.v1` definitions with summed `take <= 1024`,
emits the exact heterogeneous result tuple, records the capability requirement
and acknowledgment, and emits LLP 0157's
`snapback.normalized-composite-plan.v1` record plus `PlanHashV1`. Artifact
admission reconstructs and exact-compares that identity before execution.

The earlier semantic definition of `ParentAuthorizationKeyV1` is frozen by
this implementation as the following closed record before RFC 8785 JCS. This
is the only v1 spelling consumed by LLP 0157's `keyJcsBase64url` and
`snapback:parent-authorization-key:v1:` digest; changing any member or value
requires a successor version, never tolerant reinterpretation:

```ts
type ParentAuthorizationKeyV1 = {
  format: "snapback.parent-authorization-key.v1";
  parentTable: string;
  parentIdArgument: string;
  parentIdType: { kind: "id"; table: string };
  visibility:
    | { kind: "public-read" }
    | { kind: "owner.v1"; field: string };
};
```

The executor pins one authoritative `DbRead` snapshot, evaluates every
structural parent group before cursor validation, seals the entire batch on
any unavailable parent, then evaluates nodes in declaration order. One outer
`sbsb1` credential carries the exact LLP 0157 §D8 body and compact serializer;
no `sbbc1` token or inner continuation survives composition. Static
worst-case plaintext sizing precedes parent storage reads, parent
incarnation/version and stream changes return restart-required, and all other
context or cryptographic mismatches return the uniform invalid-cursor class.
Cursor-free first pages admit whole-result `live_replace`; cursor-bearing
subscribe refuses before storage.

Executable evidence includes the fixed-nonce exact-order `sbsb1` golden and
cross-family refusal tests in `src/snapshot_batch_cursor.rs`, codegen/host
`ParentAuthorizationKeyV1` vectors, artifact identity exact-compare tests, and
`snapshot_batch_three_node_cursor_sealing_and_live_acceptance` in
`src/local.rs`. That acceptance executes three nodes over one deduplicated
parent group, crosses one coordinated continuation, proves sealed absence
before malformed-cursor validation, and observes whole-batch live replacement
plus cursor-bearing subscribe refusal. The local capability manifest now
publishes support; remote/hosted targets remain support-false. This claim does
not change the separate support-false sequence-allocation posture.

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
- **Sequence substrate remains unpublished.** The 2026-08-02 record above
  claims only the observed local handler-tier sequence substrate, not target support for
  `sequence_allocation_v1`. The capability remains Experimental,
  support-false, and represented as a structured GAP until the complete §5.1
  qualification and LLP 0113 publication requirements land. Generated
  allocation and lane-Q withholding are substrate evidence only; they do not
  imply the remaining unexercised vectors. `snapshot_batch_v1` is separately
  implemented and supported only on the experimental contributor local target
  under the dated record above. Any
  future promotion still follows LLP 0134; this Spec cannot and does not
  shorten that path.
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
