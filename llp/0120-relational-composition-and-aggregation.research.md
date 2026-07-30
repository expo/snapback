# LLP 0120: Relational composition and aggregation

**Type:** Research
**Status:** Draft
**Systems:** Competitive evaluation, Relational queries, Application data API,
Authoring, Code generation, Developer experience
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:**
**Related:** LLP 0080, LLP 0110, LLP 0113, LLP 0115, LLP 0116, Diary 0029,
Diary 0033, Diary 0034, Diary 0036, Diary 0039

## Summary

This Research document maps the option space behind LLP 0115 CV-8's
load-bearing half: what Snapback should do about relational composition and
aggregation, the one authoring area where every recent comparison — the
seven-backend Linear bakeoff (Diary 0029) and the 2026-07-30 seven-app rerun
(Diary 0039) — scored Convex ahead for the same structural reason. Convex lets
one transactional function read an arbitrary object graph and return it;
Snapback's stable relational surface is deliberately a closed two-source
unique-join (LLP 0080), its better-fitting bounded-children and
write-with-activity profiles are experimental and publication-gated
(LLP 0110/0113), and the shapes that actually dominate the rerun apps —
multi-child fan-out, grouped counts, multi-table derivation, sequence
allocation — are explicit Non-goals of both relational documents. The apps
therefore stay on imperative, N+1-shaped inline handlers that are correct and
snapshot-consistent but carry none of the bounded-work or declared-reach
evidence the generated profiles exist to provide.

The document collects the evidence, states honestly what each side proves and
does not prove, and lays out six paths with their evidence-model consequences.
It deliberately makes no final call: that decision belongs to LLP 0080's frame
(its open question 7) under LLP 0115 CV-8.

## What Convex does

Convex's query model is "a query is just code over the database." A query or
mutation is an ordinary TypeScript function executing inside one serializable
transaction; it may perform any sequence of point reads, index scans, and
in-memory joins, and whatever it assembles is the result, with the result type
inferred by TypeScript. Two properties fall out of this design (this paragraph
is general Convex background, not something the diaries measured): the runtime
records the read set of each execution after the fact, which is what powers
both optimistic-concurrency validation and reactive re-execution when any read
value changes; and because the whole function runs at one snapshot, any
composed object graph is automatically snapshot-consistent.

The diary evidence shows what this buys in practice:

- **Linear issue detail** (Diary 0029, Convex round): "A single transactional
  query composed the issue detail graph" — issue, project, labels, comments,
  and activity in one function, one snapshot, one inferred result type. The
  same arm's mutations "combined the issue edit, activity record,
  authorization check, and revision compare-and-set in one serializable
  operation." The diary's Lessons for Snapback section names the target
  directly: "One server query should naturally compose a bounded detail
  graph, and one mutation should naturally own authorization, conflict
  policy, data change, and activity receipt."
- **Relay Board** (Diary 0033/0039 §2): the Convex arm returns
  board + columns + cards through "a more natural inferred TypeScript shape"
  and passed the same 6/6 acceptance, including atomic move/audit and
  rollback, with less authored ceremony.
- **Split Ledger** (Diary 0036/0039 §5): the Convex arm derives the
  four-table balance view inside one query; combined with
  `v.array(v.object(...))` argument validation, the diary scores it a slight
  Convex win.

Note the asymmetry in the evidence: what the diaries actually measured is
authoring terseness, inferred types, and snapshot-consistent assembly. They
did not measure — because Convex does not surface it — any bound on how much
work such a query performs, any declaration of what it may read, or any
reviewable artifact describing its shape. A Convex query that scans a table
looks identical, at the authoring boundary, to one that does bounded indexed
reads.

## What Snapback does today

Snapback's answer is layered, and every layer is narrower than Convex's
free-form model on purpose.

**The stable surface.** `relational_query_v1` (LLP 0080, Implemented;
promoted to stable 2026-07-26 in both registries) is a closed generated plan:
exactly one root table and one joined table, at most four equality pairs
against a declared unique index on the joined side, index-served root filters,
deterministic ordering ending in the `_id` tie-break, explicit `take` in
`0..=1024`, and explicit visibility declarations for both sources and the
output. Its `root-window-v1` pipeline is normative across every evaluator, its
cursor binds plan hash and authority partition, and its acceptance corpus
instruments examined-entry ceilings so a bounded result is provably a bounded
root access. Maintained projections reuse the same core with transactional
same-commit maintenance and a global fan-out proof. Aggregation, grouping,
many-to-many fan-out, and recursive queries are enumerated Non-goals. The
authoring builders are `defineRelationalQuery` and `defineMaintainedProjection`
in `packages/snapback-codegen/define.mjs`; the capability registry lives in
`src/manifest.rs`, where `relational_query_v1` takes the default `Stable`
maturity.

**The experimental profiles.** LLP 0110 (Review) specifies
`bounded-children.v1` (one explicitly authorized parent, one bounded
index-served child page, at most `take + 1` examined entries, sealed
absent/invisible parent results) and `write-with-activity.v1` (a closed
point-operation primary plan plus exactly one provenance-bearing activity
insert, durable idempotency, a complete quantitative effect ceiling). Both
builders exist in `packages/snapback-codegen/define.mjs`
(`defineBoundedChildrenQuery`, `defineWriteWithActivity`), and
`src/manifest.rs` pins `BoundedChildrenV1 | WriteActivityV1` to
`CapabilityMaturity::Experimental` as a static code-owned constant. Runtime
support is false until the LLP 0113 claim-family machinery verifies a
qualified publication, ordinary artifacts must acknowledge the experimental
ids, and — the fact LLP 0115 v0.2 corrected — the 0113 path **terminates at
experimental maturity by design**: publication CAS never touches the maturity
constant, and "promotion to stable requires a later ratified design and
evidence" (LLP 0113 §1). There is no existing machinery by which these
profiles become the boring default.

**What the profiles refuse.** `bounded-children.v1` admits exactly one parent
table and one bounded child page per invocation — no second child collection,
no aggregates, no grouping, no additional child filter (LLP 0110 §1.1).
`write-with-activity.v1`'s primary plan is point-operations only: no range
read, no set-oriented step (§2.1), and its first publication admits
`existing-owner.v1` authority only, so anonymous callers refuse with
`SNAPBACK_ACTIVITY_AUTHORITY_UNPROVENANCED`. LLP 0080's callable plans are
two-source unique-join only with aggregation excluded.

**The imperative escape hatch, and what it lacks.** What the rerun apps
actually ship is inline JS handlers (LLP 0108): Relay's `boardView` does one
board point-read plus three flat child fan-outs (columns, cards, activity)
assembled into one nested result inside one query transaction; `boardSummary`
derives per-column counts; Split Ledger's `ledger` runs one split-index query
per participant across four tables; Campfire's `send` scans the room's
messages to derive the next sequence (Diary 0033/0034/0036). The handlers use
the in-handler query builder — the indexed `lt`/`order`/`take` plan surface in
`packages/snapback-harness/ctx-bootstrap.js` — so individual reads are
index-served, and each handler declares its read/write tables
(`define.mjs` requires non-empty `reads`/`writes` declarations), an exact
result contract, and an `outgrewIr` tier rationale. What this tier does *not*
carry: read declarations are table-granular, not index-range-shaped; there is
no examined-entry ceiling, no per-invocation bounded-work proof, no
cardinality proof, no generated visibility composition, and no
missing-versus-invisible noninterference claim. An N+1 loop over an unbounded
participant list and a bounded fan-out look identical in the manifest. The
handler is snapshot-consistent — it runs in one authoritative transaction —
but nothing about its reach is machine-checkable beyond the table list.

## How they differ and why agents preferred Convex

The honest reading of the diaries is that the semantic core is closer than the
scores suggest. A Snapback inline handler already has Convex's two central
properties: arbitrary reads composed in one snapshot, and atomic multi-row
writes. Relay's Snapback arm proved the card patch and activity insert share
one commit version — evidence the Convex arm does not emit. The agent-felt gap
decomposes into three separable pieces:

1. **Inference versus declaration.** Convex's result types flow from
   TypeScript; Snapback requires the exact nested result contract to be
   spelled out. Relay's authored backend grew from 148 to 224 lines largely
   from the contract block (Diary 0033); Split's grew from 379 to 427
   (Diary 0036). This is CV-4/CV-6 territory (LLP 0115), not a relational
   problem per se — but agents experience it *as* one because the verbose
   part is precisely the composed-graph result.
2. **The paved surface refuses the common shapes.** The stable join does not
   fit one-parent/many-children; the fitting profiles are experimental and
   the guide correctly says not to select them merely because their builders
   exist. So the "right" Snapback answer for the rerun apps was to bypass the
   generated relational surface entirely — which reads as "Snapback has no
   answer" even though the imperative answer passed every check.
3. **Aggregation has no story at all.** Counts, sums, groupings, and
   sequence derivation are Non-goals of both relational documents and
   inexpressible in the profiles, so `boardSummary`, the Split ledger
   derivation, and both sequence counters (Campfire's `send` scan, Relay's
   `moveCard` activity-range collect — a live instance of LLP 0110's open
   question 4) are imperative with no generated alternative even proposed.
   Campfire's scan is also a latent contention concern: a production
   append-heavy room needs sequence allocation that does not re-read the
   range on every send (Diary 0034).

What must not get lost in the comparison: Snapback's bounded profiles prove
things Convex's free-form reads structurally cannot. A generated plan declares
its read reach before any invocation runs; its work bound is a static fact
(`take + 1` examined entries, fan-out ceilings) checkable in review and
enforced fail-closed; its shape is a closed reviewable artifact rather than
whatever the code did this time; and its authorization behavior
(visibility-before-limit, sealed absence) is corpus-proved per target. Convex
proves per-execution facts after the fact — its captured read set is real and
powers real reactivity — but a reviewer cannot bound a Convex query without
reading its code, and nothing refuses a query whose reach grew. The rerun's
own scoring frame ("Convex infers more, Snapback proves more", Diary 0039 §2)
is accurate. The design question is whether the proving can be extended to the
shapes agents actually write, without collapsing into either theater or a
general query planner.

## Option space

The paths below are not all mutually exclusive; several combine. Each is
stated with its tradeoffs and its interaction with the evidence model
(LLP 0115 governing constraint 1: no evidence regression).

### Option 1 — A third bounded aggregate profile

Specify, in LLP 0080's frame, a profile family covering the three rerun
shapes: multi-child fan-out with snapshot-consistent assembly (Relay's
`boardView`: one parent, N declared child collections, each with its own
index, order, and per-collection `take`), bounded grouped counts (Relay's
`boardSummary`: counts grouped by a declared child field, bounded by declared
group count times per-group index range), and bounded multi-table derivation
(Split's ledger: per-participant reductions over declared index ranges with a
closed reduction vocabulary — sum, count — over portable integer fields).
This is LLP 0115 CV-8's piece 3 stated affirmatively, and the concrete demand
recorded in LLP 0080 open question 7 and LLP 0110 open question 2.

*For:* preserves the full evidence model — declared reach, static work
ceilings (sum of per-collection bounds), closed reviewable shapes, corpus-
proved target parity — while finally fitting the apps that exist. Multi-child
is the smallest extension: the binding constraint the rerun exposed is
one-child-collection-per-invocation, not nesting depth (LLP 0110 OQ2 note).

*Against:* the design cost is demonstrated and high. LLP 0080 spent multiple
review rounds and ~700 lines on the narrowest possible join; LLP 0110 is
~1,700 lines across nine-plus reconciliation rounds for one parent and one
child page. Each aggregate shape adds its own cursor identity, live
classification, and refusal grammar. Grouped counts need a work model in
which an invisible-to-the-caller row still consumes counted work. And a
generated Split profile would change observable ordering: the current handler
sorts with `localeCompare`, a locale-sensitive collation LLP 0080's portable
value model deliberately excludes (0080 OQ7) — so migration is a behavior
change, not a refactor.

### Option 2 — Endorse the imperative handler as paved, with an evidence story

Accept that free-composition handlers are the general answer — as they are in
Convex — and invest in evidence *over* imperative code instead of evidence
*instead of* imperative code. Concretely: extend LLP 0108's table-granular
`reads` declarations toward index-range-shaped read declarations (table,
index, prefix arity, per-loop bound); have the runtime instrument examined
entries per invocation and refuse — or loudly diagnose — executions that
exceed the declared budget, the same observed-subset-of-ceiling discipline
`write-with-activity.v1` already applies to effects; and document the pattern
(builder reads via `ctx-bootstrap.js`'s indexed plan surface, assembly, one
result contract) as the guide's blessed composition recipe.

*For:* cheapest path to honesty about what apps already do; converts the
escape hatch from "no evidence" to "declared budget plus runtime enforcement";
no new query language; composes with CV-7's helper bundling. The declaration
is conservative and checkable in review even though it is not statically
proved against the code.

*Against:* runtime-enforced budgets are weaker than generation-time proofs —
the refusal arrives in production, not in review; there is no visibility
composition or noninterference claim, so protected multi-tenant composition
stays out of reach of this tier; and blessing the pattern risks normalizing
N+1 shapes the third profile would have made unnecessary. It also does
nothing for result-contract verbosity, the half of the felt gap that CV-4/6
own.

### Option 3 — A general declarative query/graph language

Go toward Convex/GraphQL expressiveness: a composed object-graph query
language (nested selections, filters, aggregates) compiled to plans. The
research question is where the evidence collapses. The 0080/0110 experience
suggests the collapse points are precise: data-dependent fan-out without
per-parent bounds breaks examined-entry counting; post-filter predicates
(anything not index-served) break the bounded-root-access proof;
caller-composed shapes break closed-plan review and cursor identity; and
visibility widening across composed sources reopens the inference failures
LLP 0065 forbids. A language confined to *composition of already-admitted
bounded nodes* — each node a proved profile instance with its own `take`, the
composition a static tree — might retain every proof at roughly additive
cost. Anything beyond that (arbitrary predicates, unbounded traversal,
caller-supplied shape) forfeits declared reach and bounded work, at which
point Snapback would be running a worse Convex.

*For:* the only option that structurally matches Convex's authoring surface;
the bounded-node-composition variant is a plausible long-term shape for
option 1's profiles to grow into rather than a rival to them.

*Against:* largest specification surface by far; the honest version is
"option 1, iterated, with an algebra" — meaning it is sequenced *after* the
profiles exist, not instead of them. The unbounded version is ruled out by
LLP 0115's governing constraints as long as they stand.

### Option 4 — Free-form reads with post-hoc read-set capture as the evidence

Adopt Convex's mechanism directly: let handlers read freely and have the
runtime capture the actual read set per execution, publishing the capture as
the evidence artifact (and, eventually, using it for invalidation the way
Convex does). This is the capture-versus-declare question stated cleanly.
Capture proves what one invocation *did*; declaration bounds what any
invocation *can do*. As the sole evidence, capture is a genuine regression
against LLP 0074's posture: no review-time reach, no refusal of growth, no
static ceiling — the artifact describes behavior after the budget is already
spent.

*For:* capture has a legitimate subordinate role, and Snapback partly plays
it already: runtime subset checks against declared ceilings are exactly
"capture used to police a declaration." Extending that to reads — captured
read ranges checked against option 2's declared budgets, with drift surfaced
as a diagnostic — strengthens option 2 substantially and is the honest way to
import Convex's best mechanism.

*Against:* as a replacement for declaration it fails the no-evidence-
regression constraint outright, and it would be the first Snapback surface
whose claims are unfalsifiable before production traffic.

### Option 5 — Materialized aggregate views, plus sequence allocation

Extend LLP 0080 §5's maintained projections from row-mapped outputs to
transactionally maintained *aggregate* outputs: per-group counts and integer
sums whose output rows update incrementally in the same commit as the source
write. The machinery half-exists — same-transaction maintenance, `fanOutLimit`
admission, the rebuild equivalence oracle — but aggregation breaks the current
model in a specific place: an aggregate row depends on unboundedly many
source rows, so the split oracle needs an incremental-delta correctness proof
(trivial for count/sum under insert/delete/patch; not claimable for min/max
without rescan) and the fan-out counting rule needs an aggregate variant.
Separately, mint a small dedicated primitive for **sequence allocation**: a
named, transactionally incremented monotonic counter. That single primitive
retires Campfire's send-scan (Diary 0034's contention concern), Relay
`moveCard`'s activity-range collect (LLP 0110 OQ4's live instance), and would
have shortened the Linear arm's cursor scheme — three independent demands for
one mechanism.

*For:* `boardSummary`-class reads become index point-reads of a maintained
output with the full projection evidence story; the sequence primitive is
small, high-leverage, and evidence-friendly (its work bound is one row).
Contention behavior improves rather than merely being documented.

*Against:* maintained aggregates answer the *read* side only where the
aggregate is anticipated — Split's ad-hoc four-table derivation over
arguments is a callable-plan shape, not a projection; hot-counter update
contention replaces scan contention and needs its own statement; and the
projection adoption cost (activation proofs, rebuild recipes) is real.

### Option 6 — Promote what exists and accept the aggregate gap

Execute only LLP 0115 CV-8 pieces 1 and 2: finish LLP 0110's review to
Accepted, close its publication gates through the LLP 0113 machinery to
honest experimental maturity, author the stable-promotion design 0113
requires, and declare the aggregate shapes out of scope with the imperative
handler as the undocumented-but-tolerated fallback.

*For:* lowest new-design risk; 0110's evidence investment pays off; no
premature commitment in a space where two other options (1 and 5) are still
being weighed.

*Against:* the rerun already tested this future and scored it: even at full
promotion, `bounded-children.v1` does not fit `boardView` (three child
collections), `write-with-activity.v1` does not fit `moveCard` (range-derived
sequence) or any anonymous arm (existing-owner-only), and nothing fits
`boardSummary` or the Split derivation. The Relay/Split arms would enter the
next rerun unchanged, and LLP 0115's exit criterion for those arms would be
unsatisfiable through this option alone. It is a sequencing stance, not an
answer.

## Findings

1. **The gap is aggregation and multi-child fan-out, not joins.** The stable
   two-source unique-join fits none of the rerun's felt losses; every cited
   shape (boardView, boardSummary, Split ledger, both sequence counters) falls
   in territory both LLP 0080 and LLP 0110 declare Non-goals.
2. **The DX gap and the evidence gap are separable.** Snapback's imperative
   handlers already deliver Convex's semantic core — snapshot-consistent
   free composition and atomic multi-row writes, with commit-version proof
   Convex lacks. What agents felt was result-contract verbosity (CV-4/6
   territory) plus the paved surface refusing their shapes (CV-8 proper).
3. **"Promote what exists" cannot close CV-8.** The LLP 0113 path terminates
   at code-owned experimental maturity by design, and the profiles' admitted
   shapes (one child collection, point-operations-only, existing-owner-only)
   exclude the concrete rerun demands even at full promotion.
4. **The aggregate demand decomposes into three primitives, not one:**
   multi-child snapshot assembly (callable), bounded grouped
   counts/derivations (callable or maintained), and monotonic sequence
   allocation (a write-side primitive with three independent demand sites).
   Option 5's sequence counter is the smallest and most leveraged of the
   three.
5. **Capture and declaration are complements, not substitutes.** Post-hoc
   read capture (Convex's mechanism) used to police declared budgets extends
   the existing observed-subset-of-ceiling discipline; used as the sole
   evidence it regresses LLP 0074's posture and fails LLP 0115's governing
   constraint 1.
6. **Specification cost scales with admitted generality, and the corpus
   proves it:** ~700 reviewed lines for the minimal join, ~1,700 for one
   parent/one child page. A per-shape third profile is expensive but bounded;
   an unbounded general query language extrapolates to the point where the
   evidence model is the casualty.
7. **Migrating existing handlers into any generated aggregate profile is an
   observable behavior change**, not a refactor — Split's `localeCompare`
   ordering is outside the portable value model, so the profile decision
   carries an ordering-semantics decision with it.

## Confidence

High confidence in the repository facts: the builder and registry locations
(`packages/snapback-codegen/define.mjs`, `src/manifest.rs`,
`packages/snapback-harness/ctx-bootstrap.js`), the profile admission limits,
the maturity model, and the Non-goal boundaries were verified against the
current tree and the governing documents for this write-up. High confidence
in the diary-sourced comparisons, which cite retained acceptance evidence.
Medium confidence in the characterization of Convex internals (serializable
transactions, post-hoc read-set capture driving reactivity): it is consistent
with the diaries' observed behavior but rests on general product knowledge,
not instrumentation performed here. The per-option cost estimates are
judgment extrapolated from the 0080/0110 review history, not measurements.

## Open questions

1. Which option leads: a third bounded profile (1), the endorsed-imperative
   evidence story (2), or maintained aggregates (5)? They are complementary —
   1 and 5 for anticipated shapes, 2 as the honest general tier — but the
   sequencing and the first shape shipped are the real decision (LLP 0080
   OQ7's frame).
2. Is sequence allocation its own small primitive, or a special case of
   option 5's maintained aggregates? Its three demand sites suggest it should
   not wait for the aggregate design.
3. For option 2, can index-range-shaped read declarations be validated at
   generation time against the builder calls the handler actually contains,
   or only enforced at runtime? The answer determines whether option 2 is a
   real evidence tier or a budget annotation.
4. Where exactly is option 3's collapse point — is the
   composition-of-admitted-bounded-nodes algebra provable at additive cost,
   or does cursor identity across composed nodes already break it?
5. How should any new profile treat the anonymous/workout authority gap?
   `write-with-activity.v1`'s existing-owner-only admission made it unusable
   by every anonymous rerun arm; a third profile that repeats this will again
   be bypassed by exactly the fixtures meant to prove it.
6. Does a grouped-count profile need its own noninterference statement
   (counts leak existence across visibility boundaries in ways row results
   do not)?

## Relationship to LLP 0115 and owning documents

This document is the option analysis LLP 0115 CV-8 names as its load-bearing
piece 3 ("specify a third bounded aggregate profile … or endorse the
imperative handler pattern as the paved answer with its evidence story"). It
does not alter CV-8's pieces 1 and 2 — finishing LLP 0110's review and
publication path, and authoring the stable-promotion design LLP 0113 requires
— which proceed independently of the aggregate decision. Ownership stays
where LLP 0115's governing constraint 3 puts it: the aggregate decision lands
in LLP 0080's frame (its open question 7), multi-parent and primary-plan
vocabulary questions in LLP 0110 (its open questions 2 and 4), maturity
mechanics in LLP 0113, handler evidence extensions in LLP 0108's family, and
result-contract verbosity in CV-4/CV-6's owners. This Research document
decides none of them.

This is one part of the Convex-parity research series:

| LLP | Topic |
| --- | --- |
| 0116 | convex-parity-research-series (overview) |
| 0117 | typescript-type-flow-parity |
| 0118 | handler-composition-and-helper-reuse |
| 0119 | reactive-by-default-and-live-search |
| 0120 | relational-composition-and-aggregation (this document) |
| 0121 | transactional-one-off-scheduling |
| 0122 | installed-product-coherence-and-packaging |
| 0123 | runtime-readiness-and-operational-edges |
| 0124 | product-breadth-storage-and-vector-search |
| 0125 | concurrency-and-conflict-ergonomics |
