# LLP 0242: Bounded query composition

**Type:** RFC
**Status:** Accepted
**Systems:** Application data API, Relational queries, Live Queries, Query
planning, Authorization, Code generation, Client integration, Diagnostics,
Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-12 (post-acceptance authoring-program amendment: names
Draft LLP 0248 as the imperative bounded-batch fallback; no new projection node
or accepted v1 semantic changes). 2026-08-12 (entered Review for the author-directed single-family
`llp-super-refine` loop: Codex GPT-5.6-sol xhigh only; Claude intentionally
skipped). 2026-08-12 (mechanically renumbered from LLP 0240 to LLP 0242 after
origin assigned LLPs 0234–0235). 2026-08-12 (author-directed acceptance after
Round-3 same-revision Codex GPT-5.6-sol xhigh convergence). 2026-08-12 (round-1 revision: selected exact-or-refuse count/exists,
added the common-snapshot completeness witness, and replaced per-scope feed
caps with a bounded exact top-k frontier protocol). 2026-08-12 (round-2
revision: required same-snapshot proof of the complete authorized scope set,
with a bounded 257th-scope refusal and cursor-bound witness). 2026-08-12
(initial Draft synthesized from LLP 0236 P10 and the comparison research in
LLP 0120)
**Related:** LLP 0004, LLP 0007, LLP 0008, LLP 0053, LLP 0061, LLP 0080,
LLP 0100, LLP 0110, LLP 0115, LLP 0118, LLP 0120, LLP 0131, LLP 0155,
LLP 0178, LLP 0208, LLP 0231, LLP 0236, LLP 0237, LLP 0240, LLP 0243, LLP 0248,
Diary 0033, Diary 0036, Diary 0039, Diary 0073

## Summary

Snapback should stabilize four common bounded query shapes—children,
aggregates, activity streams, and scoped feeds—without attempting SQL breadth
or weakening declared cost and authorization.

The current system has two strong ends of a spectrum:

- generated relational/query plans are portable, indexed, bounded, inspectable,
  and suitable for retention and target parity; and
- JavaScript live queries can express arbitrary transformations under explicit
  handler contracts.

The recurring gap is the middle. Agents hand-write imperative loops or opaque
JavaScript for shapes common enough to deserve a plan, while the stable
declarative API is narrower than the domain. This RFC adds a small compositional
plan algebra whose bounds, indexes, authority inputs, result contracts, live
dependencies, and client capabilities are generated together.

## Motivation

LLP 0236 records repeated friction around follower feeds, children/activity
projections, multi-level aggregates, and count backfills. The seven-app workout
also records substantial progress: indexed range/order/take and full-text search
closed earlier complaints. The next move should follow that successful pattern:
stabilize observed bounded shapes rather than grow an open-ended database
language.

LLP 0080 owns the portable relational foundation, LLP 0110 owns bounded
children, and LLP 0120 maps the remaining composition gap. This RFC is their
narrow successor. It leaves arbitrary transformation in JS live queries, now
improved by LLP 0237’s helper composition, while making the common path exact
and inspectable.

## Constraints

- Every plan declares and enforces collection/page/fan-in bounds and required
  indexes. No generated shape falls back to a full scan silently.
- Authorization is evaluated at the source and projection boundaries; a join or
  aggregate cannot reveal hidden-row existence through count, ordering, empty
  groups, or cursor shape (LLP 0053; LLP 0231).
- Local and hosted targets share one logical plan/result contract, with declared
  capability gaps rather than target-specific surprise.
- Query results keep exact generated contracts and deterministic total ordering.
- Live invalidation is conservative unless dependency completeness is proved;
  optimization cannot suppress an update.
- Offline/local execution is separately admitted. A server-portable plan does
  not automatically become safe to execute over retained client fragments
  (LLP 0155#move-2-first-class-query-scoped-local-materialization).

## Decision

### D1. One closed `projection` algebra

V1 adds four builder families under one generated plan representation:

```js
projection.children(...)
projection.aggregate(...)
projection.activity(...)
projection.feed(...)
```

The representation is a Rust-owned, versioned `ProjectionPlanV1` enum emitted
to JSON Schema/TypeScript under LLP 0037. Builders are authoring conveniences;
the manifest IR is the runtime authority.

Every plan carries:

- root/source tables and indexes;
- canonical arguments and cursor contract;
- visibility/authorization plan per source;
- bounded cardinalities and cost class;
- deterministic ordering with `_id` tie-break;
- exact result contract;
- captured/declarative live dependencies;
- local-retention/execution eligibility and reasons; and
- target capability requirements.

Every composite result also carries LLP 0155’s public completeness state and a
compositional witness over plan hash, canonical args, authority partition,
never-reused query instance/generation, one authoritative snapshot/version,
all declared nodes, per-node cursors, and any sealed refusal. `complete` means
every node was established at that one snapshot. A missing/refused node,
advancing one cursor, changing one node’s args, or invalidating one membership
returns the whole composite to `unknown` until one common snapshot is
re-established; one sealed node seals the composite. Useful skewed fragments
may remain inspectable but are never presented as exact complete output.

Unknown plan nodes or versions refuse at generation/load. There is no “best
effort” decoder.

### D2. Children is the existing bounded relation, made composable

`children` extends LLP 0110 rather than creating a second relation:

```js
export const roomWithMessages = defineLiveQuery({
  args: { roomId: v.id("rooms") },
  result: results.records(v.object({
    room: result.document("rooms"),
    messages: result.page("messages"),
  })),
  plan: projection.children({
    parent: query.byId("rooms", arg("roomId")),
    child: query.index("messages", "byRoomCreated", {
      where: { roomId: parent("_id") },
      order: "desc",
      take: 50,
    }),
  }),
});
```

V1 admits one parent source and up to four named child collections. Each child
has an independent bound/cursor and can project fields from its own row plus
explicit parent keys. It cannot recursively nest children. Parent denial
returns the query’s declared denial/null shape without probing child existence.

Child names are manifest-stable cursor slots. Arguments carry an optional
cursor map keyed by those names; results return the same map plus each node’s
page. Supplying/advancing one child cursor re-evaluates the parent and every
child window at one new authoritative snapshot (unchanged child cursors may be
reused as positions, not as old-snapshot proof). Unrelated pages are never
silently combined across snapshots, and a node refusal returns the composite
sealed/unknown rather than preserving a false complete sibling tuple.

The plan supports one-to-one lookup as `take: 1` with an exact optional result,
eliminating ad hoc post-query array indexing for a common relation.

### D3. Aggregates are exact-or-refuse and authorization-preserving

V1 `aggregate` admits only `count()` and `exists()` over one declared indexed
range. Every node requires an authored `maxExamined`, a positive safe integer
at or below the target profile ceiling:

Example:

```js
projection.aggregate({
  source: query.index("reactions", "byMessageKind", {
    where: { messageId: arg("messageId") },
  }),
  maxExamined: 10_000,
  measures: {
    total: aggregate.count(),
    hasMine: aggregate.exists({ userId: auth.userId() }),
  },
})
```

Visibility is applied before aggregation. To keep success-versus-refusal from
becoming a hidden-row cardinality oracle, a protected-source v1 aggregate is
admitted only when the compiler proves the indexed range is public or
authority-partitioned so authorization-hidden rows cannot enter its examined
population. A residual policy that would filter hidden entries after range
admission refuses at generation. If exact completion would exceed
`maxExamined`, the invocation returns one sealed
`SNAPBACK_PROJECTION_AGGREGATE_WORK_LIMIT` carrying the declared bound and
repair, but no observed count or partial result. When returned,
`count` is exact over the full caller-visible range and lies in
`0..maxExamined`; empty is zero. `exists` is an exact boolean and may stop once
a visible match is proved; a negative answer requires exact range completion
within the ceiling. Ordering and arithmetic are deterministic and count never
exceeds JavaScript’s safe-integer range because admission ceilings are lower.

V1 has no grouping, `sum`, `min`, `max`, real accumulation, partial/capped
result, or transparent maintained implementation. Each has materially different
overflow, empty, write, and noninterference semantics under LLP 0120. A
maintained exact aggregate is a distinct future versioned node with
transactional write/rebuild/activation rules, never an invisible execution
swap under this result contract.

### D4. Activity is a bounded declared union

`activity` merges 2–8 declared event sources into one cursor-ordered result:

```js
projection.activity({
  sources: [
    activity.source("messages", "byRoomCreated", mapMessage),
    activity.source("memberEvents", "byRoomCreated", mapMemberEvent),
  ],
  scope: { roomId: arg("roomId") },
  orderBy: "createdAt",
  take: 50,
})
```

Each source has its own visibility plan and maps to one arm of a discriminated
result union. The cursor binds source, ordered key, stable row id, plan identity,
and authorization/version witnesses; it never leaks the presence of a hidden
source row. The merge performs bounded N-way index reads and returns at most the
declared page size.

V1 sources are self-contained and do not join payload tables after the merge.
The formerly proposed “authorization-equivalent” one-to-one lookup is deferred
until a generated equivalence predicate and noninterference proof exist;
payload enrichment uses children or a JS live query.

### D5. Feed is bounded fan-in over visible scopes

`feed` covers the canonical follower/membership shape:

```js
projection.feed({
  scopes: query.index("follows", "byFollowerScope", {
    where: { followerId: auth.userId() },
  }),
  maxScopes: 256,
  items: query.index("posts", "byAuthorCreated", {
    foreignKey: { authorId: scope("followedId") },
  }),
  orderBy: "createdAt",
  take: 50,
  maxExamined: 1024,
})
```

V1 limits:

- a complete authorized scope set of at most 256 distinct scope keys;
- at most 50 returned items by default, maximum 200;
- an explicit cumulative `maxExamined` per invocation, default 1024 and no
  larger than the target profile;
- one stable indexed ordering shared by every item source; and
- no recursive feed or per-item arbitrary handler call.

Before any item read, the executor proves the complete authorized scope set at
the page's authoritative snapshot. Admission requires either a generated
schema/policy cardinality invariant proving the range has at most `maxScopes`,
or an authority-pushdown-complete ordered enumeration that probes through
`maxScopes + 1` (the 257th scope at the portable maximum). The scope index must
prove one visible row per canonical scope key; otherwise generation refuses.
The invariant route still enumerates the exact set and proves range exhaustion.
The probe route returns sealed
`SNAPBACK_PROJECTION_FEED_SCOPE_LIMIT`, with no rows, cursor, count, or item
read, if a 257th scope exists. A residual scope policy whose hidden rows could
affect exhaustion or overflow refuses at generation.

Scope enumeration has a separate fixed ceiling of `maxScopes + 1` (257 at the
portable floor); item `maxExamined` remains 1024 by default. Explain, target
capability, execution receipt, and metrology report both bounds and their summed
worst-case work, so the scope proof is never unaccounted fan-in.

After that proof, the executor performs an exact bounded top-k merge. It opens
every scope’s index frontier, reads the next candidate from each non-exhausted
scope, and advances/refills the winning frontier through a deterministic heap
until `take` exact visible items are proved or every scope is exhausted. All
item reads—including rows rejected by composed visibility—count toward
`maxExamined`. If the ceiling is reached before the next global item or
exhaustion can be proved, the whole page returns a sealed
`SNAPBACK_PROJECTION_FEED_WORK_LIMIT`; it never returns a short or misordered
partial page.

As with aggregates, each item range must be public or provably
authority-partitioned/pushdown-complete so authorization-hidden rows cannot
change success, work-limit refusal, or frontier shape. A feed needing residual
post-range visibility filtering refuses generation and uses a JS live query or
future noninterfering node.

The opaque, server-authenticated cursor is client-carried and binds plan,
canonical args, snapshot/version, authority generation, last emitted total-order
key, a scope-completeness witness containing the complete ordered set digest/
count, exact range exhaustion, and invariant-or-probe identity, and a
frontier-or-exhausted witness for every scope. Its serialized size is capped at
64 KiB. Continuation revalidates that same-snapshot completeness witness;
inserts/deletes after it appear only after a fresh snapshot. Snapshot-retention
loss, cursor-size overflow, or any scope-set/authority-generation change returns
a typed fresh-snapshot requirement rather than skipping or duplicating rows.

The portable `projection.feed.v1` capability floor is 256 scopes, a 257-entry
scope-completeness probe, 200 output items, 1024 examined item entries, and a
64-KiB cursor. Plans may narrow those limits. A target supporting less
advertises a distinct target-qualified profile identity; codegen/activation
refuses package-to-target skew before execution.

LLP 0240 authority profiles are a convenient scope source, not a prerequisite.
Owner/public, follower, and other admitted visibility plans may provide the
same closed scope set.

### D6. Composition is shallow and explicit

V1 may compose:

- one root query plus children;
- one source query plus aggregate;
- an activity union of source queries; or
- a scope query plus item query for feed.

It cannot arbitrarily nest these nodes. The generator prints the normalized
plan and cost before emission. When a desired shape does not fit, the refusal
names the closest admitted form and generates a typed JS live-query scaffold
containing:

- args/result contracts;
- declared source tables/indexes;
- authority inputs;
- collection bounds; and
- an `@ref`/guide link to the non-portable escape boundary.

The scaffold is ordinary bounded handler-module code under LLP 0237, not a
return to string registries or untyped handlers.

When the shape is naturally imperative but consists of repeated exact id or
unique-index lookups, the separately versioned batch host operations proposed
by LLP 0248 are the bounded fallback. They do not add a fifth projection node,
infer a join, or grant local/retained eligibility.

### D7. Live, local, and retained capability are separate facts

Every plan is eligible for server execution. Live eligibility requires a
complete conservative invalidation strategy for each source; the plan manifest
states table/row/predicate granularity. A target that cannot maintain precision
wakes more broadly, never less.

Client-local transform eligibility is separately derived from the exact result
fragment and LLP 0155/0166 rules. Server source-plan portability does not grant
custody of hidden source rows. Protected retention is owned by LLP 0243 and may
admit the final projected result only when its authority/lease contract is
complete.

Generated refs and LLP 0238 hooks expose:

```ts
capabilities: {
  server: "supported",
  live: "supported" | "coarse" | "unsupported",
  localTransform: "supported" | "unsupported",
  retained: "public" | "protected-profile" | "none",
}
```

No one `live` or `offline` boolean carries all four claims.

### D8. Explain and errors teach the plan

`snapback query explain <ref> --args ... --json` returns:

- normalized plan tree;
- index and bound per node;
- authorization/visibility locus;
- expected cardinality class and target ceilings;
- live invalidation profile;
- local/retention eligibility with reasons;
- semantic/artifact identity; and
- actionable gaps.

Generate-time errors identify the exact node/property/source span and never
fall through to generic handler failure. Runtime resource-limit refusals name
the declared bound, target limit, and whether the repair is narrower pagination,
a separately versioned maintained projection, or JS escape. Aggregate/feed
sealed refusals never include observed counts or frontier details that could
reveal protected rows.

## Compatibility and migration

Existing relational queries, bounded children, search, and JS live queries keep
their identities and behavior. Builders may adopt the new plan node by node.

Codegen can recognize a narrow set of existing equivalent plans and offer a
read-only rewrite, but it never rewrites JavaScript handlers based on sampled
behavior. App-maintained counter rows or fan-out tables remain ordinary app
data until an explicit migration chooses a generated aggregate/feed; the
migration preview checks data equivalence and rollback under LLP 0081.

## Alternatives considered

### Add a general SQL/query DSL

Declined. It expands portability, authorization, live matching, cost, and local
execution obligations far beyond the repeated app shapes.

### Use arbitrary JS live queries for everything

Insufficient. They remain the general escape hatch, but common shapes then
repeat plan, cost, authority, result, retention, and client declarations and
lose portable inspection.

### Maintain all aggregates and feeds eagerly

Declined as a semantic requirement. On-demand bounded plans should be correct;
maintained projections may graduate only as a distinct versioned node/API with
their write-side semantics proved.

### Normalize/replicate full source tables to clients

Declined. It breaks query-scoped custody and creates field/existence oracles.
Local/retained capability applies to projected results under separate proof.

## Rollout

1. Freeze `ProjectionPlanV1`, explain output, target limits, and cross-target
   conformance corpus.
2. Generalize existing bounded children with the common-snapshot/completeness
   witness and named cursor map.
3. Land exact-or-refuse count/exists with protected-row noninterference; defer
   numeric/grouped/maintained aggregates.
4. Add self-contained activity union with cursor/non-disclosure adversarial
   tests.
5. Add feed only with the exact top-k frontier/cursor vectors and declared
   work ceiling.
6. Rerun Relay Board and Clique follower/activity slices from a
   published npm package; retain JS controls for behavior/cost comparison.

## Acceptance

- Children, exact-or-refuse count/exists, activity union, and
  follower/membership feed each
  have a complete generated example with no imperative aggregation loop.
- Every plan has deterministic ordering, exact result types, required indexes,
  declared bounds, authority inputs, explain output, and target capability.
- Hidden rows do not leak through counts, aggregate work refusal, activity
  cursors, feed length, work refusal, or continuation errors.
- Multi-child output is complete only under one common snapshot witness;
  advancing or invalidating one node returns the composite to unknown until all
  nodes are re-established together.
- Local and hosted twins return byte-equivalent canonical results over the
  adversarial corpus or refuse a declared unsupported target at generation.
- Live writes to every source wake/recompute the affected projection; a coarse
  target may over-wake but never miss.
- Feed scope changes force a typed fresh snapshot and cannot reuse an old
  cursor under a new authority generation; a 257th authorized scope seals with
  `SNAPBACK_PROJECTION_FEED_SCOPE_LIMIT` before item reads and returns no rows.
- A feed page with all top items in one scope remains globally ordered; if the
  examined ceiling prevents exact proof the page seals instead of shortening or
  emitting a lower-ranked item.
- Unsupported nesting produces a typed JS live-query scaffold with contracts,
  bounds, and authority declarations.
- The benchmark records p50/p95 and read amplification for bounds 1, 16, 64,
  256 across the admitted on-demand nodes; no unmeasured default flip occurs.

## Risks

- Four nodes can still accrete into a second SQL. The enum is closed and
  shallow; new composition requires a new RFC/version.
- Aggregates can disclose hidden cardinality. Disclosure policy and adversarial
  zero/nonzero tests are part of plan admission.
- Feed fan-in can be expensive at the maximum bound. Target ceilings, explain,
  pagination, and measurements precede default enablement.
- Cross-target cursor behavior can drift. Cursor vectors and result/order
  goldens run in every target twin.
- Generated convenience can obscure when JS is simpler. Explain shows plan
  complexity and the escape hatch stays first-class.

## Open questions

1. Which of these plan nodes are eligible for the LLP 0166 local result
   transform without widening client custody?
2. Should future generated maintained projections ever be app-visible tables,
   or stay implementation-owned with only explain/health exposure?

## Status

Accepted. This RFC asks the author to accept a closed four-shape projection
algebra with common-snapshot completeness, exact-or-refuse count/exists, and a
bounded exact feed frontier. It does not change protected offline retention,
which is the separate decision in LLP 0243.
