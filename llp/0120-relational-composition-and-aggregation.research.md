# LLP 0120: Relational composition and aggregation

**Type:** Research
**Status:** Active
**Systems:** Competitive evaluation, Relational queries, Application data API,
Authoring, Code generation, Developer experience
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:** 2026-08-02 (Accepted LLP 0135 reconciliation: snapshot-batch is
the admitted bounded multi-child composition and sequence allocation is its
own primitive; aggregate design and maturity remain open); 2026-07-30 (v0.2, round-1 dual-family fix application — both
reviews NOT READY:
`reviews/0120-relational-composition-and-aggregation.fable.md` (C1 blocking,
C2 material, C3–C8 detail, four suggestions) and
`reviews/0120-relational-composition-and-aggregation.codex.md` (four
blocking-for-bar, four material, one detail). Every finding was independently
verified against the tree, diaries, and governing documents before
application; none was refuted; all were applied. Major additions: the
bounded-aggregate result-semantics map (five variants with overflow,
empty-group, and admitted-range behavior) and the aggregate-noninterference
analysis, with option 1's full-evidence claim conditioned on both; option 3a
(snapshot-batch composition of admitted bounded nodes) assessed first-class
instead of inheriting option 3's sequencing verdict; option 2 split into
enforced (2a) versus diagnostic-only (2b) variants with cumulative-budget and
rollback semantics, 2b named a no-evidence-regression failure as a tier; the
maturity-route symmetry — the 0113 experimental terminus costed against
options 1/3a/5 as against 6, the verified 0080 direct-to-stable precedent
named, and §Relationship's independence claim corrected to one direction
(new finding 9, open question 7). Corrections: per-kind `define.mjs` tier
requirements (result contracts and mutation-only `outgrewIr` are optional;
the rerun arms' usage is application practice); workload shapes (fixed
fan-out / N+1 / unbounded scan; "correct" narrowed to retained acceptance);
"structurally cannot" narrowed to current-surface language with provenance
labels; sequence allocation deepened (scope identity, gaps, idempotency,
exhaustion, ordering, contention, authority) with the Linear demand
downgraded to labeled inference; Non-goal/refusal/deferral categories
separated; the Diary 0039 scoring-frame citation moved to the executive
table; index use restated as handler opt-in; option 5's contention claim
relabeled a named empirical expectation; the static-proof-versus-dynamic-
enforcement rephrase; and the reviews' non-blocking sweeps. New open
questions 7–8. Rejected findings: none.)
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
(LLP 0110/0113), and the shapes that actually dominate the rerun apps all
fall outside the generated surface — though the corpus excludes them in
three distinct ways it keeps separate: grouped counts and multi-table
derivation are enumerated Non-goals of both relational documents;
multi-child fan-out is an LLP 0110 Non-goal but LLP 0080's *deferred* open
question 1; and sequence allocation is a Non-goal of neither, being instead
an LLP 0110 §2.1 admission refusal and the live subject of its open
question 4. The apps therefore stay on imperative inline handlers — fixed
fan-out (Relay), N+1 (Split), and unbounded-scan (Campfire) shapes — that
passed their retained acceptance checks and are snapshot-consistent but
carry none of the bounded-work or declared-reach evidence the generated
profiles exist to provide.

The document collects the evidence, states honestly what each side proves and
does not prove, and lays out seven paths (six options plus a composition
sub-option) with their evidence-model consequences.
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
did not measure — because Convex's current surface does not expose it (this,
too, is general product background rather than a diary measurement) — any
bound on how much work such a query performs, any declaration of what it may
read, or any reviewable artifact describing its shape. A Convex query that
scans a table looks identical, at the authoring boundary, to one that does
bounded indexed reads.

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
`crates/snapback/src/manifest.rs`, where `relational_query_v1` takes the default `Stable`
maturity.

**The experimental profiles.** LLP 0110 (Review) specifies
`bounded-children.v1` (one explicitly authorized parent, one bounded
index-served child page, at most `take + 1` examined entries, sealed
absent/invisible parent results) and `write-with-activity.v1` (a closed
point-operation primary plan plus exactly one provenance-bearing activity
insert, durable idempotency, a complete quantitative effect ceiling). Both
builders exist in `packages/snapback-codegen/define.mjs`
(`defineBoundedChildrenQuery`, `defineWriteWithActivity`), and
`crates/snapback/src/manifest.rs` pins `BoundedChildrenV1 | WriteActivityV1` to
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
the in-handler query builder — the `lt`/`order`/`take` plan surface in
`packages/snapback-harness/ctx-bootstrap.js` — whose index use is opt-in
(`indexed_by` defaults to null; `withIndex` selects one), and these handlers
chose indexes, so their individual reads are index-served. What the tier
*requires* is per-kind, and narrower than what the rerun arms supplied: JS
queries must declare non-empty `reads` (their `writes` are pinned empty); JS
mutations must declare non-empty `writes`, with `reads` defaulting to empty;
result contracts are optional for both kinds; and `outgrewIr` is an optional
mutation-only field. That the rerun arms declared exact nested result
contracts and `outgrewIr` classes throughout is application practice —
evidence about those arms, not an invariant the tier enforces. What this
tier does *not* carry: read declarations are table-granular, not
index-range-shaped; there is no examined-entry ceiling, no per-invocation
bounded-work proof, no cardinality proof, no generated visibility
composition, and no missing-versus-invisible noninterference claim. An N+1
loop over an unbounded participant list and a bounded fan-out look identical
in the manifest. The
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
3. **Aggregation has no story at all.** Counts, sums, and groupings are
   enumerated Non-goals of both relational documents; sequence derivation is
   not a Non-goal but is refused by `write-with-activity.v1`'s
   point-operation-only admission (LLP 0110 §2.1). Either way nothing
   generated expresses them, so `boardSummary`, the Split ledger
   derivation, and both sequence counters (Campfire's `send` scan, Relay's
   `moveCard` activity-range collect — a live instance of LLP 0110's open
   question 4) are imperative with no generated alternative even proposed.
   Campfire's scan is also a latent contention concern: a production
   append-heavy room needs sequence allocation that does not re-read the
   range on every send (Diary 0034).

What must not get lost in the comparison: Snapback's bounded profiles prove
things Convex does not currently surface or enforce. (This characterization
of Convex is general product background, like §What Convex does;
"structurally cannot" would overstate it — static analysis, restricted
helper APIs, or external review could in principle prove properties of
imperative code, and the claim here is about the current product surface.)
A generated plan declares its read reach before any invocation runs; its
work bound is a static fact (`take + 1` examined entries, fan-out ceilings)
checkable in review and enforced fail-closed; its shape is a closed
reviewable artifact rather than whatever the code did this time; and its
authorization behavior (visibility-before-limit, sealed absence) is
corpus-proved per target. Convex proves per-execution facts after the fact —
its captured read set is real and powers real reactivity — but a reviewer
cannot bound a Convex query without reading its code, and nothing in the
current product refuses a query whose reach grew. The rerun's own scoring
frame ("Convex infers more, Snapback proves more" — Diary 0039's executive
answer table; the §2 body's own wording is "Convex is terser; Snapback is
more inspectable") is accurate. The design question is whether the proving
can be extended to the shapes agents actually write, without collapsing into
either theater or a general query planner.

## Option space

The paths below are not all mutually exclusive; several combine. Each is
stated with its tradeoffs and its interaction with the evidence model
(LLP 0115 governing constraint 1: no evidence regression). Two pieces of
analysis are prerequisite to weighing them and are stated once, here: what a
"bounded aggregate" can actually return, and what visibility must mean for
aggregates over protected rows.

### Result semantics of bounded aggregation

"Bounded grouped counts" is not one product. The phrase hides a
result-semantics decision that splits into five variants, and options 1, 2,
and 5 land on different ones. For each: what the caller gets, what happens
at the work ceiling, what an empty or absent group means, and what evidence
claim survives.

1. **Exact over an admission-bounded domain.** Generation refuses any
   aggregate whose matching population is not already capped by admission
   (declared group count times per-group range, at or under the ceiling).
   Result: exact; overflow impossible by construction. But this only fits
   domains whose cardinality is schema-bounded, and none of the rerun shapes
   are — a column's card count grows with data.
2. **Exact-or-refuse.** Count the whole group; if examined entries exceed
   the declared ceiling, fail closed with a per-invocation sealed refusal.
   When it returns, the result is exact over the whole group, not an
   admitted subrange. This is the strongest claim a callable aggregate can
   carry (bounded work *and* exactness), at the price that availability
   degrades with data growth: an invocation that returned yesterday can
   refuse today. Empty group: exact zero. The refusal must not disclose
   whether protected rows caused the overflow.
3. **Capped.** Count up to a declared cap K and return `min(count, K)` with
   an explicit at-cap marker. Bounded work always; the result contract must
   carry the cap so a capped value cannot be read as exact. The count is
   over the admitted range only. Empty group: exact zero. A weaker result
   claim, made honestly and visibly.
4. **Partial with continuation.** A paginated fold: each invocation
   aggregates one admitted range and returns a cursor; exactness exists only
   at fold completion, and snapshot consistency across pages holds only if
   the cursor pins a snapshot — otherwise the folded total is a claim the
   caller assembled, not one the server proved.
5. **Maintained exact (option 5's shape).** The aggregate row updates in the
   same commit as the source write; reads are point-reads, exact at the read
   snapshot, with no read-time scan. Overflow moves to the write path: an
   integer-sum overflow needs a declared behavior (refuse the write, or
   widen — saturating would corrupt silently). Empty group becomes a
   *representation* question with a visibility consequence:
   absent-row-means-zero must be declared, and for protected sources
   absent-versus-invisible must be sealed exactly as LLP 0110 seals
   absent-versus-invisible parents.

Variant choice is an evidence-model decision, not an implementation detail:
variants 1–2 preserve exactness with static or fail-closed work bounds,
3–4 trade result strength for availability, and 5 relocates both the work
and the overflow question to the write side. Which variant Split's ledger
requires is itself undecided — if the product requirement is an exact
current ledger for an arbitrarily populated group, only variants 2 and 5
fit (open question 8).

### Noninterference for aggregates over protected rows

Whether a grouped-count profile needs its own noninterference statement is
analytically answerable now, and the answer is yes whenever an invisible row
can affect a returned value: a count over rows the caller cannot see
discloses their existence even though no row is returned. Row-result
noninterference (LLP 0080's sealed audit boundary, LLP 0110's
absent-versus-invisible parents) does not transfer automatically, because
aggregation is precisely the operation that summarizes rows the caller may
not be entitled to observe. Any aggregate over protected sources therefore
requires a noninterference contract; the viable shapes are:

- **Public-only sources.** Admit aggregates only over public-read tables.
  Sidesteps the problem entirely and covers `boardSummary` in the anonymous
  rerun arms; excludes every owner-scoped aggregate.
- **Visibility-before-aggregation.** The returned value is a function of the
  caller-visible subset only. The work model must then count
  examined-but-invisible entries as work without letting them affect the
  result — and the refusal threshold itself becomes a side channel unless
  the ceiling is stated so that refusing does not reveal invisible-row
  counts.
- **Sealed refusal.** Refuse at generation time when visibility composition
  across the aggregated source cannot be proved. Fail-closed and
  evidence-clean; narrows the admitted surface.
- **Partition by authority.** Maintained aggregate rows keyed per owner or
  subject, so no output row summarizes rows its reader cannot see. Fits
  option 5 naturally; a global total over protected sources remains the
  unsolved, existence-leaking case.
- **Weaker claims, declared.** An aggregate that visibly does not claim
  noninterference — which forfeits the full evidence model by construction.

Consequently, option 1's "preserves the full evidence model" holds only with
one of the first four shapes specified and proved. Until a noninterference
contract is part of the profile, a protected-source aggregate is an evidence
regression, not an extension.

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

*For:* can preserve the full evidence model — declared reach, static work
ceilings (sum of per-collection bounds), closed reviewable shapes, corpus-
proved target parity — *provided* the profile pins an exactness-preserving
result-semantics variant (§Result semantics, variants 1–2) and a
noninterference shape for protected sources (§Noninterference); without
both, "full evidence model" is not claimable. It finally fits the apps that
exist. Multi-child is the smallest extension: the binding constraint the
rerun exposed is one-child-collection-per-invocation, not nesting depth
(LLP 0110 OQ2 note).

*Against:* the design cost is demonstrated and high. LLP 0080 spent multiple
review rounds and ~700 lines on the narrowest possible join; LLP 0110 is
~1,700 lines across nine-plus reconciliation rounds for one parent and one
child page. Each aggregate shape adds its own cursor identity, live
classification, and refusal grammar. Grouped counts need a work model in
which an invisible-to-the-caller row still consumes counted work
(§Noninterference's visibility-before-aggregation shape). And a generated
Split profile would change observable ordering: the current handler — which
lives in the rerun workspace (`snapback-workout-matrix-20260729`), outside
this repository; the provenance chain runs through Diary 0036 and 0080
OQ7 — sorts with `localeCompare`, a locale-sensitive collation LLP 0080's
portable value model deliberately excludes, so migration is a behavior
change, not a refactor.

*Maturity route (finding 3 applied symmetrically):* the LLP 0113
experimental terminus is a cost input for a *new* profile exactly as for
promoting the existing ones, and the corpus contains two routes. On the
0113 route, a new capability id enters the code-owned registry at
`experimental`, runtime support is qualification-gated, and ordinary
artifacts must acknowledge the id — precisely the properties that made the
rerun arms bypass the 0110 profiles. A third profile shipped this way
enters the next rerun as bypassable as they are, and CV-8's exit criterion
("no experimental capability claimed") is then reachable only through CV-8
piece 2, the stable-promotion design. The 0080 precedent is the other
route: `relational_query_v1` was promoted to stable in both registries as
the same act as its witnessed Implemented transition (0080 Revised
2026-07-26), without 0113 machinery — a direct route that demonstrably
existed before 0113 was authored (2026-07-28). Whether that direct route
remains available to a new relational id under current governance, or the
qualification route is now mandatory, is undecided in the corpus and is
itself an 0113-frame question (open question 7).

### Option 2 — Endorse the imperative handler as paved, with an evidence story

Accept that free-composition handlers are the general answer — as they are in
Convex — and invest in evidence *over* imperative code instead of evidence
*instead of* imperative code. Concretely: extend LLP 0108's table-granular
`reads` declarations toward index-range-shaped read declarations (table,
index, prefix arity, per-loop bound); have the runtime instrument examined
entries per invocation and check them against the declared budget; and
document the pattern (builder reads via `ctx-bootstrap.js`'s plan surface
with `withIndex`, assembly, one result contract) as the guide's blessed
composition recipe.

What the runtime does at budget excess splits this option into two variants
with different evidence consequences — and only one of them is an evidence
tier:

- **2a — enforced.** Fail closed: the invocation that would exceed its
  declared budget refuses mid-flight, and for mutations the transaction
  rolls back — the same observed-subset-of-ceiling discipline
  `write-with-activity.v1` already applies to effects, where exceeding the
  ceiling rolls back source, scope, activity, and commit version
  (LLP 0110). Because handlers run in one authoritative transaction, a late
  budget exhaustion has ordinary transaction-abort semantics. The cost is
  availability: a previously working invocation can start refusing as data
  grows (the same trade as result-semantics variant 2). This variant
  preserves a real bounded-work claim — no execution observes more than the
  declared budget.
- **2b — diagnostic-only.** The over-budget execution completes and emits a
  loud diagnostic. This does not preserve the bounded-work claim: the work
  was already done, so the budget describes intent, not behavior. As an
  evidence tier, 2b fails LLP 0115's no-evidence-regression constraint. Its
  honest role is transitional — an observation stage while migrating
  existing handlers toward 2a budgets — never the endorsed endpoint.

The declaration model also needs more than a per-loop bound to bound an
invocation. A per-read bound does not bound the number of loop iterations;
the budget that carries the claim is cumulative per invocation (examined
entries summed across all reads), with per-read and per-loop bounds as
reviewable structure inside it, and dynamic index prefixes constrained to
the declared prefix arity so a loop cannot widen its range at runtime. Open
question 3 asks how much of this is validatable at generation time against
the builder calls the handler actually contains.

*For:* cheapest path to honesty about what apps already do; converts the
escape hatch from "no evidence" to "declared budget plus runtime
enforcement" (in the 2a variant); no new query language; composes with
CV-7's helper bundling. The declaration is conservative and checkable in
review even though it is not statically proved against the code.

*Against:* dynamically enforced budgets are weaker than static
generation-time proofs — not because the refusal is untestable (2a's
refusal is exercisable in acceptance and qualification runs exactly as
0110's effect ceilings are), but because code inspection cannot prove that
every execution fits: the runtime is the enforcement cut, and the first
proof that a deployed budget was mis-sized is a refused invocation on real
data. There is no visibility composition or noninterference claim, so
protected multi-tenant composition stays out of reach of this tier; and
blessing the pattern risks normalizing N+1 shapes the third profile would
have made unnecessary. It also does nothing for result-contract verbosity,
the half of the felt gap that CV-4/6 own.

### Option 3 — A general declarative query/graph language

Go toward Convex/GraphQL expressiveness: a composed object-graph query
language (nested selections, filters, aggregates) compiled to plans. The
research question is where the evidence collapses. The 0080/0110 experience
suggests the collapse points are precise: data-dependent fan-out without
per-parent bounds breaks examined-entry counting; post-filter predicates
(anything not index-served) break the bounded-root-access proof;
caller-composed shapes break closed-plan review and cursor identity; and
visibility widening across composed sources reopens the inference failures
LLP 0065 forbids. Composition of already-admitted bounded nodes is *not*
this option — it is option 3a, assessed on its own below, because its
premise is already satisfied. Beyond that static-tree boundary (arbitrary
predicates, unbounded traversal, caller-supplied shape), *static* declared
reach is forfeited; a dynamically enforced global ceiling — capped node
invocations plus a cumulative examined-entry budget, option 2a's
mechanism — could still bound work at runtime, but that is option 2's
evidence tier wearing a query syntax, not a generation-time proof. At that
point Snapback would be running a worse Convex.

*For:* the only option that structurally matches Convex's authoring
surface.

*Against:* largest specification surface by far; the honest version of the
general language is "options 1 and 3a, iterated, with an algebra" — meaning
it is sequenced *after* the profiles and their composition exist, not
instead of them. The unbounded version is ruled out by LLP 0115's governing
constraints as long as they stand.

### Option 3a — Snapshot-batch composition of admitted bounded nodes

The narrow end of option 3 deserves its own assessment because — unlike the
general language — its premise is already satisfied: the admitted bounded
nodes exist (`relational_query_v1` stable; `bounded-children.v1` specified,
with a built builder). The shape: one generated composite invokes N
statically declared profile instances inside one authoritative transaction
at one snapshot; each node keeps its own cursor, its own `take + 1`
examined-entry ceiling, and its own visibility contract; the composite
carries a work ceiling that is the sum of its nodes' ceilings and a result
contract that is the tuple of theirs. Relay's `boardView` is then three
`bounded-children.v1` invocations over the same board at one snapshot — no
new admission vocabulary and no monolithic multi-child profile design.
Data-dependent node invocation is not admitted: the tree is static, or the
composite is option 3, not 3a.

This differs materially from its neighbors: from option 1 (no new per-shape
cursor identity, live classification, or refusal grammar — the nodes bring
their own), from option 3 (no new predicate or traversal vocabulary), and
from option 2 (every read inside the composite is a generated proved plan,
not imperative code under a budget).

*For:* the cheapest route to the single-snapshot multi-child read the rerun
actually lost. LLP 0110 OQ2's annotation records that under v1 `boardView`
becomes three separate live queries composed client-side, forfeiting the
single-snapshot property — which is also why the client-composition
alternative LLP 0080 OQ1 names ("a direct child query plus client
composition") loses as an answer to this shape. Evidence is the sum of
already-proved parts, and the composite is a plausible long-term shape for
option 1's profiles to grow into rather than a rival to them.

*Against, costed fairly:* it does not touch aggregation — `boardSummary`
and the Split derivation need reduction nodes that do not exist, so 3a fits
Relay's fan-out and nothing else among the rerun's felt losses. Parent
authorization is re-established per node unless a shared-parent rule is
specified (three nodes over one board should not triple the parent check,
but deduplicating it is new composite semantics). Cursor coordination is a
real design question: independent per-node cursors resume nodes at
different positions on the next invocation, undermining the one-snapshot
read the composite exists to provide, and a coordinated resume is new
machinery (the cursor-identity concern LLP 0110 OQ2 names). Partial refusal
needs semantics: if one node seals (absent or invisible parent), does the
composite seal entirely or return the remaining nodes? Sealing entirely is
the evidence-clean answer and must be stated. The composite needs a result
identity and a live classification of its own. And the maturity-route
question applies in full: the composite is either a new capability id
(option 1's route paragraph — including that a composite claiming
`bounded-children.v1` nodes while that id is experimental inherits the
acknowledgment ceremony, which is exactly what the ceremony exists to make
loud) or a client-invisible evaluation detail of existing plans, and which
one it is belongs to LLP 0110's frame (open question 7).

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
source rows, so the split oracle needs an incremental-delta correctness
proof and the fan-out counting rule needs an aggregate variant. "Trivial
for count/sum" holds only after the non-trivial parts are specified: a
patch that moves a row between groups is a decrement plus an increment,
deletes need the preimage, sum overflow needs the declared write-side
behavior of §Result semantics variant 5, and replayed maintenance must be
idempotent; min/max are not claimable at all without rescan. This is a
maintenance-delta spec, not a formula.

Separately, mint a dedicated primitive for **sequence allocation**: a
named, transactionally incremented monotonic counter. Two demand sites are
demonstrated in the diaries: Campfire's `send` range scan (Diary 0034's
contention concern) and Relay `moveCard`'s activity-range collect
(LLP 0110 OQ4's live instance). A third is labeled inference, not
evidence: the Linear arm's immutable sequence-cursor scheme *worked*
(Diary 0029 records correct page unions and no allocation pain), so "would
have shortened it" is possible reuse, not a demand. And "small" describes
the primitive's work bound (one row), not its semantic surface, which
needs mapping before the primitive can be called sufficient: scope
identity (what happens to a counter whose scope row is deleted and
recreated — 0110's incarnation registry is the obvious precedent);
allocation-versus-commit ordering (a same-transaction counter allocates in
commit order with no gaps but full serialization on the hot key; a
preallocating counter admits gaps after aborts and retries, and the
consumer contract must say whether gaps are observable); interaction with
durable idempotency (a retried idempotent write must not allocate twice);
integer exhaustion; and who is authorized to allocate within a scope — the
same authority question that made `write-with-activity.v1`
existing-owner-only, so open question 5 applies to this primitive too.

*For:* `boardSummary`-class reads become index point-reads of a maintained
output with the full projection evidence story — for protected sources,
under §Noninterference's partition-by-authority shape; the sequence
primitive is high-leverage and evidence-friendly (its work bound is one
row). The expected contention improvement — a point increment replacing a
per-send range re-read — is a **named empirical expectation**, not a
result: only running code under contention can establish it, and the
hot-key serialization the counter introduces is part of the same open
measurement.

*Against:* maintained aggregates answer the *read* side only where the
aggregate is anticipated — Split's ad-hoc four-table derivation over
arguments is a callable-plan shape, not a projection; hot-counter update
contention replaces scan contention and needs its own statement; the
projection adoption cost (activation proofs, rebuild recipes) is real; and
the maturity route applies symmetrically (option 1's route paragraph):
aggregate outputs are either an admission widening of the stable
maintained-projection surface — which CV-8's "do not widen the stable
surface by inference" bars without its own ratified act — or a new
capability id facing the same 0113-versus-0080-precedent question.

### Option 6 — Promote what exists and accept the aggregate gap

Execute only LLP 0115 CV-8 pieces 1 and 2: finish LLP 0110's review to
Accepted, close its publication gates through the LLP 0113 machinery to
honest experimental maturity, author the stable-promotion design 0113
requires, and declare the aggregate shapes out of scope with the imperative
handler as the undocumented-but-tolerated fallback.

*For:* lowest new-design risk; 0110's evidence investment pays off; no
premature commitment in a space where three other options (1, 3a, and 5)
are still being weighed.

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
   shape falls outside both documents' admitted surface, though not
   uniformly as Non-goals: the aggregate shapes (boardSummary, the Split
   ledger) are enumerated Non-goals of both, multi-child fan-out
   (boardView) is an LLP 0110 Non-goal but LLP 0080's deferred open
   question 1, and the sequence counters are refused by LLP 0110 §2.1's
   admission rules while being the live subject of its open question 4.
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
   multi-child snapshot assembly (callable — option 1's profile or
   option 3a's composition of existing nodes), bounded grouped
   counts/derivations (callable or maintained), and monotonic sequence
   allocation (a write-side primitive with two demonstrated demand sites
   and one inferred reuse). That the sequence counter should ship first is
   this document's visible lean, labeled as such for the OQ1
   decision-maker: it is the smallest of the three once its semantic
   surface (scope identity, gaps, idempotency, exhaustion, authority) is
   mapped.
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
8. **"Bounded aggregate" is five different products.**
   Exact-over-bounded-domain, exact-or-refuse, capped,
   partial-with-continuation, and maintained-exact carry different work
   bounds, overflow and empty-group behavior, and evidence claims
   (§Result semantics); and any variant over protected sources requires a
   noninterference contract, because a count can disclose the existence of
   rows it does not return (§Noninterference). Neither choice is an
   implementation detail; both are part of the profile decision OQ1 feeds.
9. **The claimable-maturity route question applies symmetrically.**
   Finding 3's terminus is a cost for options 1, 3a, and 5 exactly as for
   option 6: a new profile id on the 0113 route stays experimental — and
   bypassed by ordinary artifacts — until CV-8 piece 2's stable-promotion
   design exists, while the 0080 precedent (stable in both registries as
   the same act as witnessed implementation, before 0113 existed) may or
   may not remain available under current governance. Which route governs
   is a live sequencing input, not a detail (open question 7).

## Confidence

High confidence in the repository facts: the builder and registry locations
(`packages/snapback-codegen/define.mjs`, `crates/snapback/src/manifest.rs`,
`packages/snapback-harness/ctx-bootstrap.js`), the profile admission limits,
the maturity model, and the Non-goal boundaries were verified against the
current tree and the governing documents for this write-up. High confidence
in the diary-sourced comparisons, which cite retained acceptance evidence.
Medium confidence in the characterization of Convex internals (serializable
transactions, post-hoc read-set capture driving reactivity): it is consistent
with the diaries' observed behavior but rests on general product knowledge,
not instrumentation performed here. The per-option cost estimates are
judgment extrapolated from the 0080/0110 review history, not measurements.
The result-semantics and noninterference maps are pre-empirical analysis of
the governing documents, not implemented behavior; and the maturity-route
reading rests on the 0080 Revised header and 0113 §1 texts, which support
either route for a new capability id — that ambiguity is stated as open
question 7 rather than resolved here.

## Open questions

1. Which option leads: a third bounded profile (1), snapshot-batch
   composition of existing nodes (3a), the endorsed-imperative evidence
   story (2a), or maintained aggregates (5)? They are complementary — 1/3a
   and 5 for anticipated shapes, 2a as the honest general tier — but the
   sequencing and the first shape shipped are the real decision (LLP 0080
   OQ7's frame).
2. Is sequence allocation its own small primitive, or a special case of
   option 5's maintained aggregates? Its two demonstrated demand sites
   suggest it should not wait for the aggregate design.
3. For option 2, can index-range-shaped read declarations be validated at
   generation time against the builder calls the handler actually contains,
   or only enforced at runtime? The answer determines whether option 2a is
   a real evidence tier or a budget annotation.
4. Where exactly is option 3's collapse point beyond option 3a — and within
   3a, does per-node cursor identity survive a coordinated resume, or does
   the composite need a cursor model of its own?
5. How should any new profile treat the anonymous/workout authority gap?
   `write-with-activity.v1`'s existing-owner-only admission made it unusable
   by every anonymous rerun arm; a third profile that repeats this will again
   be bypassed by exactly the fixtures meant to prove it.
6. Which noninterference shape should the first protected-source aggregate
   admit — public-only, visibility-before-aggregation, sealed refusal, or
   authority-partitioned outputs (§Noninterference establishes that one is
   required) — and can a single shape serve both the callable and
   maintained variants?
7. Which claimable-maturity route governs a new relational capability id:
   is the 0080 direct-to-stable act (ratified design plus witnessed
   implementation) still available under current governance, or has
   LLP 0113 made the qualification route — and therefore CV-8 piece 2's
   stable-promotion design — mandatory? The same question decides whether
   option 3a's composite is a new capability id at all or a
   client-invisible evaluation detail of existing plans.
8. Is Split's required result an exact current ledger for an arbitrarily
   populated group, or is a declared cardinality admission (bounded group
   sizes) acceptable product behavior? Only result-semantics variants 2
   and 5 fit the former; the answer changes which options fit at all.

## Relationship to LLP 0115 and owning documents

This document is the option analysis LLP 0115 CV-8 names as its load-bearing
piece 3 ("specify a third bounded aggregate profile … or endorse the
imperative handler pattern as the paved answer with its evidence story"). It
does not alter CV-8's pieces 1 and 2 — finishing LLP 0110's review and
publication path, and authoring the stable-promotion design LLP 0113
requires — and those pieces need not wait on the aggregate decision. The
converse does not hold, however: under the 0113 maturity route a new
aggregate profile stays experimental — and bypassed by ordinary artifacts —
until piece 2's stable-promotion design exists, so piece 3 is sequenced
behind piece 2 unless the 0080 direct-to-stable precedent is ruled
available (finding 9, open question 7). Ownership stays
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

## Dated reconciliation: LLP 0135 acceptance — 2026-08-02

Accepted LLP 0135 resolves only the two decisions this Research delegated to
its successor. For open question 1, `snapshot-batch.v1` is the admitted answer
for static multi-child fan-out over bounded nodes; the aggregate half remains
open under LLP 0130 SD-2 and this document's noninterference/result-semantics
requirements. For open question 2, sequence allocation is a dedicated
point-shaped primitive, not a special case of maintained aggregation. LLP
0135 owns both normative contracts and their implementation gates. Neither
acceptance nor this reconciliation claims either capability is implemented or
promoted.
