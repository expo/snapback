# LLP 0278: Paged live results and relational composition

**Type:** RFC
**Status:** Draft
**Systems:** Live Queries, Application data API, Code generation, Runtime,
Client integration, React, Guide, Testing, Developer experience
**Author:** Claude (Fable 5) / Charlie Cheever
**Date:** 2026-08-17
**Revised:** 2026-08-21 (records the LLP 0295 D0.4/D0.5 rulings' query-shape
half: the generated authority product projection reads through D1/D4 shapes,
and the provisional subscription budget contract with the independent-versus-
aggregate consistency ruling lands as a dated amendment). 2026-08-17 (initial
Draft from the LLP 0277 findings register:
F1 window/whole-list reconciliation, F2 aggregate fan-out, F3 chunked
semi-join)
**Related:** LLP 0095, LLP 0236, LLP 0240, LLP 0264, LLP 0265, LLP 0266,
LLP 0267, LLP 0270,
LLP 0274, LLP 0277, LLP 0279, LLP 0280, LLP 0295, Diary 0078, Diary 0086,
Diary 0105,
`issues/20260817-coterie-message-envelope-growth.md`,
`issues/20260817-guide-gap-chunked-semijoin-feed-recipe.md`,
`issues/20260821-provider-connection-subscription-budget-decision.md`,
`issues/20260821-private-authority-product-roster-decision.md`,
`issues/20260820-familiar-live-subscription-contention.md`

## Summary

Snapback's bounded live-query model is sound: windows are capped, reads are
declared, and refusals are structured. What is missing is the layer that lets
an ordinary application *compose* those bounded pieces without designing its
own pagination protocol, page-boundary convention, membership semi-join, and
aggregate fan-out from first principles. The Coterie and Clique runs built
each of those four things by hand, twice each in some cases, and one of the
hand-built architectures (live head plus merged keyset archive) shipped a
split-brain consistency bug before review deleted it.

This RFC proposes four first-class pieces, all inside the existing bounded,
declared-cost model:

1. a **declared paginated result contract** for list queries — page rows,
   a continuation cursor, and an explicit boundary fact — generated once
   instead of restated per app;
2. a **paved live-window-plus-snapshot-pages composition** on the client for
   feeds that scroll beyond one window;
3. a **closed membership semi-join** ("top-N per chunk of a bounded actor
   set, merged on an immutable sort key") as a declarable plan with
   codegen-checkable cost facts, replacing hand-chunked `in()` compositions;
4. **set-keyed aggregate projections** so a list consumer can subscribe to
   stats for N entities in one live result instead of N streams.

None of these adds unbounded reads. Each replaces a pattern applications are
already forced to build with a declared form the platform can verify.

## Motivation

Evidence from the run (LLP 0277 F1–F3; Diary 0086; Diary 0078):

- **Every paginated surface invented its own page-boundary convention.** The
  memory provider used a 21-row lookahead as an overflow witness; the
  Snapback backend returns exactly 20 rows, so a full page "conservatively
  carries a next cursor" — a weaker fact. Coterie's cursor carries
  `{v, mode, sortAt, eventId}`; the backend accepts `<16-digit-ms>:<id>`;
  the adapter validates and translates both directions. All of this is
  boilerplate a result contract could own.
- **Infinite scroll was re-derived, with a real bug on the way.** The M2
  Contract feed learned the "newest page live, older cursor pages are
  snapshots, merge by event ID, reset on tab/create/session actions" shape
  only through an adversarial round that distinguished *replacing the live
  window* from *accumulating pages*. The M3 adapter first built a live head
  plus keyset archive and shipped stale receipt/membership projections in the
  archive before the envelope ruling deleted it.
- **Membership feeds outgrow `in()` and fall off the paved road.** The
  builder-bound 500-operand ceiling would refuse the benchmark's 500-follow
  probe. The working fix — chunk actors at ≤499, indexed top-20 per chunk,
  merge by immutable page key, prove with an acceptance-only chunk-size
  argument — is exact but opaque: codegen cannot see its cost or cursor
  facts, and the next app will rebuild it. Diary 0086 asks directly for the
  guide to teach the pattern or the platform to ship a closed helper.
- **Aggregates over entity sets fan out into per-entity streams.** The
  adapter kept one `profileStats` stream per visible profile and hit both
  zero-count exposure during stream open and auth-establishment throttling on
  reconciliation — failure modes that exist only because the composition
  lives client-side.
- The generation-time `take` ceiling refusal (landed 2026-08-15) fixed the
  *refusal timing* of the window bound; this RFC is about making what
  authors do *within* the bound composable.

Competitive context: Convex's live paginated query and reactive functions
make these shapes ordinary; the run's diaries repeatedly measured Snapback's
delivery as equally live but its composition as bespoke. Closing this gap is
parity work on the surface and differentiation work underneath, because
Snapback can attach declared cost and authority facts to the composed plans —
something no evaluated control offers (LLP 0236 R7 makes the same argument
for authority).

## Design

### D1. Declared paginated result contract

A list query may declare `page: { size: N, order: <index>, cursor: <shape> }`
in its result contract. The generated result is then an envelope, not a bare
row list:

```
{ rows: Row[?N], cursor: Cursor | null, boundary: 'exact' | 'at-limit' }
```

- `cursor` is opaque to clients, versioned, and validated/refused by the
  runtime on re-entry (malformed, cross-query, or cross-mode cursors get a
  structured refusal — the checks Coterie's adapter hand-wrote).
- `boundary` states whether the page end is a proven boundary (the engine
  looked ahead) or a limit truncation. This gives every consumer the memory
  provider's 21st-row witness without each backend re-implementing it.
- Codegen emits the same envelope type for every declared paged query, so
  Exact-style foreign adapters translate one shape, not one per app.
- The declared page size composes with the existing window ceiling rules
  (the `@expo/snapback-contract/limits` canon); an impossible declaration is
  a generation-time refusal, consistent with the landed take-ceiling rule.

### D2. Paved live-plus-snapshot accumulation on the client

For surfaces that scroll beyond one window, provide a small client-side
composition (per arm: React hook + headless helper) over D1:

- page 0 stays a live subscription; older pages are one-shot snapshots keyed
  by their cursor;
- merged output is deduplicated on the row identity the declared order key
  provides;
- an explicit `reset()` and documented reset triggers (query-arg change,
  auth change) — the accumulator never pretends old snapshots are live;
- optional local intent overlay hooks for optimistic row state beyond the
  live window (the like/repost overlay Coterie built), clearly labeled as
  presentation state.

This is deliberately a *composition over existing primitives*, not a new
protocol: the live-query ownership rules, retention classification, and
polling posture are unchanged. Whether it ships as generated code, a client
library export, or (minimum bar) a CI-checked guide recipe is an open
question below; the run's evidence is that prose alone was not enough.

### D3. Closed membership semi-join

A declarable plan for the shape "top-N rows from an indexed table where an
actor column is in a bounded set derived from another indexed read":

```
semiJoin({
  actors: <indexed read, declared bound>,   // e.g. follow edges for viewer
  rows:   <indexed read per actor chunk>,   // e.g. feedEvents by actor
  order:  <immutable sort key>,             // e.g. pageKey
  take:   N,
})
```

- The runtime owns chunking (≤ the `in()` operand bound), per-chunk indexed
  reads, and the merge; the author never sees the chunk seam.
- Codegen can state the plan's cost facts (max chunks × per-chunk take) and
  its authority facts, which the hand-built composition could not surface —
  Diary 0086 explicitly flags the opacity.
- Cursor semantics come from D1, so a semi-joined feed pages identically to
  a single-table feed.
- The bounded-actor-set precondition is declared and refused when violated
  (an unbounded follow graph is not silently accepted).

Until this lands, the guide should carry the hand-chunked recipe verbatim
from the Coterie backend (`issues/20260817-guide-gap-chunked-semijoin-feed-recipe.md`).

### D4. Set-keyed aggregate projections

Allow an aggregate projection to be declared over a bounded key set rather
than one key: `profileStats(profileIds: bounded[])` returning one live list
row per requested key. Delivery follows the normal live-query rules; the
consumer holds one stream for N entities. This retires the
per-entity-stream fan-out layer and both of its observed failure modes
(partial-open exposure, reconnect thundering herd). The bounded-set
declaration reuses D3's operand-bound handling.

### Non-goals

- No SQL breadth, no unbounded joins, no ad-hoc aggregation language. Every
  piece above is a closed shape with declared bounds.
- No change to window ceilings themselves. The Coterie 1,024 envelope ruling
  stands as the current product posture; the growth options in
  `issues/20260817-coterie-message-envelope-growth.md` (larger engine
  windows vs. token-bumped cursor continuation) become a choice *about D1
  configuration* once D1 exists, which is the cleanest argument for doing D1
  first.
- No weakening of the mock/memory provider's role; the memory provider
  should adopt D1's envelope so both lanes prove the same boundary facts.

## Sequencing

1. D1 result contract + codegen + runtime cursor refusals (unlocks D2/D3
   cursor semantics and reframes the envelope-growth ticket).
2. D2 client composition, proved against the Coterie feed as the acceptance
   case (it already encodes the adversarial scenarios: duplicate cursors,
   empty older windows, reset triggers, beyond-window intent overlay).
3. D3 semi-join, proved against the Clique/Coterie following-feed with the
   500-follow probe and the multi-chunk acceptance path.
4. D4 set-keyed aggregates, proved by deleting the Coterie adapter's
   per-profile stream layer.

Each step should include the guide page in the same landing (LLP 0061
posture) and a regression that replays the run's originating failure.

## Open questions

1. Does D2 ship as generated per-app code, a client-library export, or a
   CI-checked recipe? (Generated code risks freezing presentation policy;
   a library export is the default proposal.)
2. Should D3 be expressible in Familiar directly, or Explicit-first with a
   Familiar name following once the shape stabilizes (LLP 0252/0253
   vocabulary rules)?
3. Is `boundary: 'exact'` worth its lookahead read cost as the default, or
   opt-in per declaration?
4. Does D4 subsume the "generated multi-query composition" idea from Diary
   0086, or is a general composition primitive still needed for
   heterogeneous joins (profiles + stats + follow state in one result)?

## Amendment (2026-08-21 — LLP 0295 D0.4/D0.5 rulings, query-shape half)

**Adopted per LLP 0295; author may revise.** LLP 0095 carries the companion
connection-lifecycle half; LLP 0240 carries the authority half of D0.4. The
decision tickets are
`issues/20260821-provider-connection-subscription-budget-decision.md` (D0.5)
and `issues/20260821-private-authority-product-roster-decision.md` (D0.4).

### D0.4 read surface

The LLP 0240 amendment selects platform-generated product-projection facts
declared on the authority profile. Their read shapes are this RFC's, under
LLP 0240's preserve-and-extend compatibility ruling: the shipped roster
`list`/`myRole` contract (`AuthorityRosterPageV1 { rows, cursor }`) is
unchanged, while the **new** generated history/incarnation operations adopt
the D1 envelope (`rows`/`cursor`/`boundary`) and reuse D3-of-0240's admission
and AEAD cursor custody, so no bespoke roster page shape is invented and no
shipped consumer breaks (`boundary` may join the shipped roster page only as
an explicitly additive optional field). Receipt/aggregate membership counts
over a bounded entity set are ruled to ship as D4 set-keyed projections over
the product receipt rows. Neither side may weaken the other: authority
admission and non-enumerability come from LLP 0240; cost and cursor facts
come from here (LLP 0295 W4).

### D0.5 subscription budgets (provisional)

The transport facts are already hard ceilings, not composition guidance:
64 live subscriptions per connection and 2,048 durable registry rows per app
(`MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION`, `MAX_LIVE_SUBSCRIPTIONS`,
`crates/snapback-engine/src/local/engine.rs`). This amendment adds the missing
*application composition contract* on top of them. All numbers below are
**explicit provisional bounds**: the six-subscription investigation
(`issues/20260820-familiar-live-subscription-contention.md`, LLP 0295 1D) is
running in parallel, and its classification may tighten — or confirm — them.
They are commissioning bounds for design and diagnostics, not yet
conformance-frozen values.

- **Correctness envelope = the hard ceiling.** Any admitted count of
  independent live subscriptions, up to 64 per connection, must be *correct*:
  live delivery within ordinary latency, per-subscription version-guard
  consistency, and no cross-subscription starvation. Six ordinary independent
  subscriptions are well inside the supported envelope; the Diary 0105
  observation is a suspected defect under investigation, not a documented
  bound.
- **Ordinary per-view/provider budget: 16 (provisional).** A single rendered
  view or provider cell composing more than 16 concurrent live subscriptions
  is supported but flagged: a structured diagnostic (proposed
  `SNAPBACK_LIVE_SUBSCRIPTION_VIEW_BUDGET` class; final code named by the
  implementation ticket) names the owning view, the count, and the aggregate
  alternatives below, *before* the hard connection ceiling refuses.
- **Independent versus aggregate (LLP 0295 risk 7).** Both forms have
  explicit supported bounds. Independent subscriptions do **not** share a
  snapshot/version boundary: each holds its own `LIVE(version)` and may be
  transiently ahead of or behind a sibling; a UI that requires one atomic
  cross-set fact (e.g. a set-membership toggle derived from two sets) should
  read it from one relational/aggregate query, which delivers one versioned
  result. That is the *consistency* criterion for choosing the aggregate
  form. Below the consistency criterion, consolidating N independent reads
  into one relational singleton is only an optimization — it is never
  required for correctness, and the relational-singleton workaround must not
  be standardized as the sole correct path.
- **Fan-out composition.** One stream per visible entity is supported up to
  the per-view budget; past it, the paved path is D4's set-keyed aggregate
  projection (one live result for N keys, reusing this RFC's D3 semi-join
  operand-bound handling). The budget diagnostic names D4 as the remediation.
- **Equal-snapshot deduplication.** The version guard (LLP 0095 §1.3) already
  drops stale/equal-version durable frames. This ruling extends the contract
  one layer up: providers/hooks own value-equality dedup of consumer
  notification, and the answer for advancing versions is explicit — a
  snapshot whose rows are value-equal to held rows must not notify consumers
  **whether or not its version advances** (reconnect's fresh
  snapshot-with-subscribe routinely delivers equal rows at an advanced
  version). Version and resume-token bookkeeping always advances internally
  per the LLP 0095 transitions; only the consumer notification is suppressed.
  A transport-only event — reconnect supersession, resubscribe, lane change —
  is therefore never a render or a republished tree.
- **Nested queries from update callbacks.** Snapshot-delivery callbacks are
  not a scheduling context: issuing subscribe/unsubscribe or mutation
  dispatch synchronously from within a delivery callback is unsupported
  composition — clients defer such work to a scheduler boundary (microtask or
  framework effect), and a synchronous attempt earns a structured diagnostic
  rather than undefined reentrancy. One-shot reads from a callback are
  admitted but discouraged in favor of sampling already-delivered rows.

Exact's provider runtime consumes these budgets and lifecycle facts through
LLP 0295 W7's coordination sequence (step 3, provider lifecycle integration
with D0.5), delivered on the Exact side under LLP 0279's graduation posture —
Exact-repository tickets, coordinated here, with no parallel Snapback-specific
adapter policy invented there.
