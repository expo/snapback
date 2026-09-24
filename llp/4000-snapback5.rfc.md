# LLP 4000: Snapback 5 — the bridge is invisible

**Type:** RFC
**Status:** Draft
**Role:** Root of a proposed Snapback 5 corpus (LLPs 4000 and up), if commissioned
**Systems:** A Snapback 5 authoring surface over the Snapback 4 engine; derived residency; the device replication policy; the client contract; `check`; the calibration protocol
**Author:** Claude Fable 5.1, at Charlie Cheever's request
**Date:** 2026-09-24
**Revised:** 2026-09-24 (initial)
**Related:** [LLP 3000](./3000-snapback4.explainer.md) (Snapback 4, the engine this proposal keeps and the control it is judged against), [LLP 3000.007](./3000.007-relaxed-quarry-and-explicit-residency.rfc.md) (explicit residency, the position this proposal inverts), [LLP 3000.012](./3000.012-application-still-owns-derived-data.research.md) (the plateau and the charge ledger), [LLP 3000.013](./3000.013-quarry-states-intent.rfc.md) (the planner and `view`, which this proposal keeps), [LLP 3000.014](./3000.014-a-child-reads-through-its-parent.rfc.md) (inherited audiences, taken here in its narrower form), [LLP 2000.000](./2000.000-keep-the-core-flip-two-substrates.rfc.md) (the brief Snapback 4 built), [calibration #19](../benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/README.md), [`benchmarks/TREND.md`](../benchmarks/TREND.md)

## Summary

Quarry exists to carry one declaration across the client–server bridge: the
same tables, rules and queries run on the server and on the device, so a
write can be predicted locally and a read can be answered offline under the
server's authority. The calibration record says the bridge itself scores
well. What scores badly is that the author has to learn how the bridge
works to use it: residency (`sync`, horizons, `retain`), completeness classes
and their notes, prediction eligibility, and the bounds the engine could
choose. Nineteen Clique calibrations sit on a holistic plateau of 88–92 with
`data_modeling`, `queries_and_live` and `scale_and_limits` at the bottom of
every window (LLP 3000.012 §2.1). Two architectural waves have gone at
`data_modeling` directly: 0.3.0 moved three derived forms into the engine
and read 87; 0.4.0 added a planner and `view` and read 90, inside one run's
noise. The same builder family gave Supabase 94 in the same category for
"SQL familiarity and composability." Every one of the sixteen charged runs
in LLP 3000.012 §2.2 carries the learning-cost column.

Snapback 5 is the bet that the bridge can be made **invisible**: the author
declares a model with a fixed, small concept budget; the engine derives
everything the bridge needs from the rules and the program's declared
queries; the client sees two runtime facts, `complete` on a read and
`pending` on a row, and never a compile-time class. Scale evidence stays,
as an opt-in report, not as notes in the author's path.

Concretely, Snapback 5 is:

1. **Snapback 4's engine, kept.** Rules with hoisting, the runtime meter,
   the partition log, at-most-once writes, the planner of LLP 3000.013, the
   device interpreter, the simulator. Nothing in `snapback4-core` is
   rewritten to start.
2. **Derived residency, inverting LLP 3000.007.** No `sync` line, no
   horizon, no `retain`, no residency vocabulary at all. A device holds the
   pages the program's declared queries have asked for, plus a warm set the
   compiler derives from the queries that take no arguments. What a device
   holds is decided by what the app reads, not by what the author declares.
3. **Completeness and prediction as runtime facts.** Every read carries
   `complete`. Every row a local write touched carries `pending` until the
   server settles it. The engine decides prediction by proof from held rows
   and rules; the author never learns eligibility. The sixteen `N_*` note
   codes leave the default compile.
4. **A concept budget with a ratchet**, tested like the wasm byte budget:
   the number of distinct declaration forms and keywords an author meets
   before the Clique brief compiles, and the length of the first account.
   Additions must pay for themselves in the budget.
5. **Two additions, both subtractive for the application:** `through .ref`
   as a read rule (LLP 3000.014's narrow form), and a `per viewer` column
   that replaces hand-kept receipt rows.
6. **A pre-registered bar, in this order:** the Clique brief on Snapback 5,
   same builder and grader, (a) time to first green below the Convex and
   Supabase lanes on the same brief, (b) correctness at or above the best
   of the three by the independent grade, (c) the score as a floor, not a
   target: holistic ≥ 89 and no category below Snapback 4's series median.
   The author's ruling of 2026-09-24: a score near 89–90 is acceptable if
   the clock beats both incumbents and the results are very correct.
   Snapback 4 continues as the control.

This is a proposal for the author's decision. Nothing here is built.

## 1. Evidence

The claim this RFC rests on is narrow: *the remaining `data_modeling` cost
is the cost of learning the bridge, and it cannot be removed by adding
capability.* The record:

| Observation | Source | What it supports |
| --- | --- | --- |
| Bottom three categories are `queries_and_live` 83.5, `scale_and_limits` 84.5, `data_modeling` 85.0 medians over 16 runs; the eight-to-thirteen-point gap to the top four survives every window and every leave-one-out population | LLP 3000.012 §2.1 | The gap is structural, not a run |
| The four categories at 94–97 are the ones Snapback turned into a declaration on a table (`image <=N once`, read rules, client-minted ids, `expire at`) | LLP 3000.012 §2.1 | Declarations that match a builder's prior score at the ceiling |
| All 16 charged `data_modeling` runs carry LC, the cost of learning Quarry and its execution model; notes name "index prefixes, bounds, residency", "structural completeness", "prediction constraints", "residency proofs" | LLP 3000.012 §2.2 | The bridge's vocabulary is the charge |
| Same builder family: Supabase 94, Convex 88, Snapback 2 68 in `data_modeling`; Supabase credited with familiarity and composability | LLP 3000.012 §2.1, the 2026-09-05 record | 94 is reachable in this category with this grader |
| 0.3.0 moved three derived forms into the engine: `data_modeling` 87, `queries_and_live` 90, unchanged | LLP 3000.013 Summary | Adding engine capability did not move the category |
| 0.4.0 (planner, `view`, Following without caps): `data_modeling` 90, charged for "prediction/completeness introduced learning overhead" and "recipient receipts required explicit rows/helpers"; credited for "shared Quarry declarations unified server and replica logic" | Calibration #19 FINAL | The bridge is praised; learning it is charged; one capability gap remains (per-viewer state) |
| The 0.2.x series: a wave of six advice repairs removed every diagnostic shape it targeted (`int has no fields` 20→0, the ESM loop 7→0) and `setup_and_docs` did not move (0.14 sd) | LLP 3000.007 §20.23 and calibration #14 | Better explanation of a concept does not remove the concept's cost |
| A "removal wave" was proposed under LLP 3000.007 ruling 40 and judged not earned while the holistic decline read as noise | LLP 3000.007 §20.22.7 | The subtractive strategy has been considered and deferred, never run |
| `snapback4-lang` today: 16 `N_*` note codes, 163 `E_*` codes across lang and core; the 0.4.0 Clique target still authors `sync public`, `sync to members[.conversationId]`, `retain delivered-history`, `cap 50 by conversationId`, `shape`, `view`, `search`, `immutable`, `public '…'`, `emit … once`, `schedule` | `snapback4/crates`, `~/sb4-intent/target-clique.q` | The concept surface after two subtractive waves is still wide |
| Builder wall clock, Astra medium, whole brief: 0.2.29 122 min (89), 0.2.30 118 min (90), 0.2.31 77 min (91), 0.2.32 79 min, 0.2.33 82 min, 0.3.0 90 min, 0.4.0 115 min (88; M8 first green at 54 min, the rest post-green scale work) | the run READMEs | The shortest run scored highest and the longest lowest, but the clock includes post-green work and the brief grew; the correlation is suggestive, not established |
| The only Convex and Supabase clocks on record are M7 alone, on the 2026-09-05 brief against Snapback 2: Convex 13 min, Snapback 2 19 min, Supabase 25 min (Astra). Independent grade: Supabase 92/0/9 of 101 checks, Convex 84/8/9, Snapback 2 81/11/9 | `~/clique-full-20260905/scores/record-tables.md` | No incumbent has been clocked on the current brief; the reference clock the bar needs does not exist yet |

What the evidence does not show: that the client story of Snapback 4 is
wrong. `client_integration` read 80 in #19 for a specific reason (a missing
`createApp` asset-retention option), and `offline_sync` has a series median
of 93. The device, the outbox and prediction work. The proposal keeps them.

## 2. The bet on one page

**Snapback 4's position** (LLP 3000.007, "relaxed Quarry and explicit
residency"): the author states what lives on the device and how much, the
compiler proves the statement, and notes tell the author when a query cannot
be complete or a write cannot be predicted. Honesty at compile time, in
exchange for vocabulary.

**Snapback 5's position:** the author states only the model and the
product's reads and writes. The engine derives what the device must hold
from the declared queries, decides prediction by proof, and reports
completeness at runtime. Honesty at run time, in exchange for the author's
control over residency.

The two are not the same product with different defaults. In Snapback 4 the
unit of replication is the viewer's partition (LLP 2000.000's second flip):
everything the viewer can read under a declared horizon. In Snapback 5 the
unit of replication is the **page**: the result of one declared query with
pinned arguments, held as rows so the device can evaluate the same query and
the same rules over them. A partition gives full offline coverage and asks
the author to bound it. A page gives coverage of what the app has shown and
asks nothing.

The risk the bet takes on is named in §10: per-page delivery is the
invalidation problem that Convex solves on the server and that Snapback 4's
partition log avoids. Snapback 5 solves it with the planner's own predicates,
because every held page is a declared query, and it measures whether that
costs `scale_and_limits` what it earns in `data_modeling`.

## 3. The author's surface

### 3.1 What a program is

Six declaration kinds, and no others:

```quarry
table posts:
  authorId: principal
  parentId: posts ?
  body: text <=500
  at: time default now
  likeCount: count likes
  immutable authorId, parentId, at
  public 'Public posts'
  insert <- .authorId = viewer
  update <- .authorId = viewer

table comments:
  issue: issues
  author: principal
  body: text
  read <- through .issue                       -- readable exactly when its issue is
  insert <- .author = viewer and through .issue

table messages:
  conversationId: conversations
  senderId: principal
  body: text <=2000
  at: time default now
  seen: bool per viewer default false          -- one value per (row, viewer), engine-kept
  read <- through .conversationId
  insert <- .senderId = viewer and through .conversationId

view following: activity where .actor = viewer or exists follows[viewer, .actor]

query home(c: cursor ?):
  return following last 20 by .at after c activityCard

mutation createPost(postId: id, body: text <=500, parentId: posts ?):
  return insert posts { id: postId, authorId: viewer, parentId, body } if absent

job daily(periodStart: time, periodEnd: time): …
schedule dailyDigest every 1d at 08:00: daily
```

`table`, `view`, `shape`, `query`, `mutation`, `job`/`schedule`. Columns,
constraints (`unique`, `immutable`, `at most N by`, `expire at`), rules
(`public`, `read`, `insert`, `update`, `delete`), and the read forms LLP
3000.013 already paved (`where`, `first`/`last N by`, `after c`, `matching`,
a shape). That is the whole language card.

### 3.2 What leaves

| Removed | Why it existed | Who carries it now |
| --- | --- | --- |
| `sync`, `sync to`, `sync public`, `sync last N by`, horizons | To state the device's partition (LLP 3000.007 §6.6 already proposed dropping `to`) | The declared queries, §4.1 |
| `retain delivered-history` | To keep removed members' history on the device | Pages already held stay held; a revoked row is deleted, a still-readable one is not. Default, not a declaration |
| `cap N by` as a residency bound; `first 10001`; `size`; `cap 60000` | To bound device and server work | The meter and the planner. `at most N by` remains as a product constraint |
| Index names, `by byAuthorTime` | To choose a scan | Gone in LLP 3000.013; stays gone |
| `maintain` strategies, `timeline`, merge lanes | To choose materialization | `view`, engine-chosen, from LLP 3000.013 |
| The 16 `N_*` note codes in the default compile | To make residency and completeness honest at compile time | `complete` and `pending` at run time; `check --scale` on demand, §6 |
| `createClient` vs `createApp`, `webDevice()`, `processDevice()`, the online tier as an author choice | To choose a residency tier | One `createApp`; the device is chosen by platform; there is no online-only tier to pick |

Nothing in this table is a capability the application loses. Each row is a
decision the engine makes instead of the author.

### 3.3 The two additions

**`through .ref`** — a read rule term meaning "readable when the row `.ref`
names is readable by this viewer now." It is LLP 3000.014's narrower design
as both blind reviews proposed it: the whole read audience, plus conjuncts
that only narrow; the parent's substituted rule inputs and its incarnation
stamped into hidden immutable columns inside the writing transaction; the
child's audience derived from the copy, so sync, prediction and completeness
see a local rule. A table with a reference column must still state its rule;
`through` is never inferred, because authorization never guesses.

**`per viewer`** — a column modifier: `seen: bool per viewer default false`.
Reads see the viewer's own value; a mutation sets the viewer's own value; the
engine keeps one hidden row per (row, viewer) and treats it as part of the
row's audience. It replaces the receipt table, the helper rules and the
mutation that kept them honest, which calibration #19 charged directly. An
aggregate over a `per viewer` column (`count messages where not .seen by
.conversationId`) is a view like any other, computed for the viewer.

Both are additive to the language and subtractive to every application that
has a parent or a receipt, which is most of them. Both go to blind design
review before they are built (§9).

## 4. The bridge, derived

### 4.1 Residency from queries

Every read an application can make is a declared `query` with typed
arguments. The compiler therefore knows the complete set of pages a device
may ever hold: (query, arguments, cursor). Residency follows:

- **A page is held when the app has asked for it.** `useQuery(api.home)`
  subscribes the device to `home` with the viewer's arguments; the server
  answers the page and the device stores its rows, tagged with the page
  that brought them. Rows are stored once; a row in three pages has three
  tags.
- **The warm set** is derived, not declared: every query whose arguments
  are absent or viewer-only, first page, is fetched at sign-in and kept.
  For Clique that is `home`, `global`, `trending`, `insights`. An app's
  first screen is on the device before it renders.
- **A held page stays current.** The server delivers changes that affect a
  held page (§4.4) until the app releases it; released pages are kept for
  reads but not maintained, and evicted by age under a device budget the
  engine sets.
- **Reads answer from held rows** by running the query's plan over the
  device's store with the viewer's rules, exactly as Snapback 4's device
  does today. This is what makes a predicted write appear in every held
  page whose predicate it matches, without the device knowing the page's
  provenance.

There is no partition to declare and no horizon to choose. The device holds
what the product has shown, plus its first screen.

### 4.2 Completeness as a runtime fact

A read's `complete` is true when the device holds the server's page for
that (query, arguments, cursor) and every change the server has delivered
for it is applied. It is false when the page has never been fetched, when
the device is offline and the page was released, or when a local write is
pending on a row the page orders by. The engine computes it; the app renders
it. A query that Snapback 4 would have classed `N_NEVER_COMPLETE` is not an
error in Snapback 5: it is a page that reads `complete: false` until its
server answer arrives, and then `true`. The class was a compile-time
prediction of a runtime fact; the fact is now reported directly.

### 4.3 Prediction by proof

A mutation is applied locally, before the server answers, when the compiler
can prove its outcome from held rows and the rules alone:

- the write's rule depends only on `viewer` and rows the device holds;
- its id is client-minted or its key is a held row;
- its constraints (`unique`, `at most N by`) can be checked over held rows,
  or the engine carries the occupancy count (Lane P's design);
- it writes no `view` input the device cannot recompute.

Otherwise the write queues as `pending` with no local image and settles on
the server. The author never declares eligibility and never sees
`N_NOT_PREDICTABLE`. `snapback5 why createPost` explains the decision on
demand, as `why` does today. The default is conservative on purpose: a
pending write that later settles is the same client contract as a predicted
one, one boolean later.

### 4.4 Delivery to held pages

This is the engineering bet. Snapback 4 delivers by partition: a change is
appended to the partition log of every audience it belongs to, cheaply,
because the audience is the read rule (LLP 3000 §7). Snapback 5 must deliver
to pages: a change is relevant to a device when it enters, leaves or reorders
a page the device holds.

Design: every held page is a declared query with pinned arguments, so the
server keeps a **page registry** keyed by (query, arguments) with the set of
devices holding it, and the planner's predicate for the page. A committed
write is matched against the registry by the same predicates the planner
uses to answer the query. For Clique's shapes (a viewer's pages, a
conversation's pages, public pages ordered by time) the match is an index
probe, not a scan. The audience rule still gates delivery: a device never
receives a row its viewer cannot read, because the partition inversion of
LLP 2000.000 §7.1 remains the outer check. Following, the one per-reader
materialization, is unchanged from LLP 3000.013.

The measured question is whether registry matching costs more than partition
append at 1,002 conversations and 167,243 actions (calibration #19's replay).
§9 fixes the bar.

## 5. The client contract

```ts
const app = createApp({ url, schema });       // the device is chosen by platform
const { rows, complete } = useQuery(app.home); // rows may carry `pending: true`
await app.createPost({ postId: mintId(), body });
```

Three facts an app can observe, and no others:

- `complete` on a read;
- `pending` on a row;
- the auth state (`signed-out`, `signed-in`), from Lane E's model.

There is no residency tier, no `sync` status to inspect, no eligibility. An
app that wants to show "offline, showing what you had" reads `complete`. An
app that wants to grey out an unsettled post reads `pending`. Everything
else is a query or a mutation.

## 6. Scale evidence on demand

Snapback 4's certificates, cost spans, edge windows and the compact check
notes of Lane H are kept in full and moved to `snapback5 check --scale`. The
default `check` prints errors only. A builder who has a scale requirement
runs the report and gets the same evidence Snapback 4 gives today; a builder
who does not never sees it. The calibration brief's scale milestone is
expected to run it, and the guide's scale card says so in its first line.
This keeps the `scale_and_limits` evidence path intact while removing it
from `data_modeling`'s.

## 7. The concept budget

The wasm byte ratchet (LLP 3000 §7, the diet) is the model. Snapback 5 adds
two tested numbers:

- **The concept count:** distinct declaration kinds, column modifiers,
  constraint forms, rule terms, read forms and diagnostic codes an author
  meets in the Clique target program and the errors it can draw. Measured
  by a test over the language card and the target program. The initial
  budget is the count at commission; it only ratchets down, and an addition
  must remove at least as much as it adds or carry a journaled ruling.
- **The first account:** the length of the README's orientation before the
  first reference card, already budgeted under W14b at 300 lines. Kept.

`through` and `per viewer` enter the budget and pay for it by deleting the
receipt table, its helper rules, the integrity probe and the `immutable`
lines from every child, which the Clique program can demonstrate line by
line.

## 8. Relationship to Snapback 4

- **Engine reuse, not a rewrite.** `snapback5/` depends on `snapback4-core`,
  `snapback4-device` and the planner as crates. The new work is a front-end
  (the language card minus §3.2 plus §3.3), a device replication policy
  (§4.1, §4.4), the runtime facts (§4.2, §4.3), the client (§5) and the
  `check` split (§6). If the engine has to change, the change lands in
  Snapback 4 first and Snapback 5 takes it, until the two diverge on a
  recorded decision.
- **Sibling, not successor.** Snapback 4 continues as the control, with its
  own calibrations. Snapback 5 is a number that never ships if the bet
  fails (LLP 3000 §1, decision 2, applied again).
- **Fence and numbering.** `snapback5/` behind its own `AGENTS.md`; LLPs
  4000 and up; none of Snapback 4's ratchets apply inside the fence except
  the wasm budget, which Snapback 5 inherits at 4's current value because it
  ships the same device.
- **What it cannot borrow.** Snapback 4's `sync`-derived partition log is
  the mechanism Snapback 5 replaces; the simulator's invariants (LLP 3000
  §6) apply, with "the device's held pages" substituted for "the viewer's
  partition."

## 9. Evaluation, pre-registered

Before any code:

1. Blind design reviews of this RFC from two families (Astra max, Grok
   xhigh), as LLP 3000.013 and 3000.014 had. Revision until READY.
2. The concept count of the Clique target program on Snapback 4 today and
   on the Snapback 5 surface, recorded here before implementation.

The first slice: the Clique brief's messaging half (conversations, members,
messages with `per viewer` seen state, history, search) on derived
residency, with prediction, offline restart and the simulator's invariants
green. Then the social half on `through` and `view`.

**The reference clock comes first.** No incumbent has been run on the
current brief (§1). Before Snapback 5's first calibration, run the Convex
and Supabase lanes of the 2026-09-05 harness on the current brief with the
same builder (Astra medium), on the same host in the same week, and record
time to first green, time to last green, and the independent grade. That is
one afternoon of machine time and it is the number the whole bet is judged
against. Snapback 4 gets the same lane in the same week so the three clocks
share a host and a load.

The bar, on the same Clique brief, builder and grader as calibration #19,
three runs, series-fit not adjacent-compared, in this order of precedence:

| Criterion | Bar (mean of three) | Reference |
| --- | --- | --- |
| Time to first green, M1–M8 | Below both incumbents' clocks on the same brief | Snapback 4 0.4.0: 54 min; incumbents unmeasured on this brief |
| Correctness | Independent grade pass count ≥ the best of the three; coverage `honest`; zero blockers | 2026-09-05: Supabase 92/101 |
| Holistic score | ≥ 89 | 88 (#19); plateau 88–92 |
| Every category | ≥ Snapback 4's series median | LLP 3000.012 §2.1 |
| `data_modeling` | reported; 94 is the hope, not the bar | 90 (#19); series median 85 |

The author's ruling (2026-09-24) sets the order: a score near 89–90 is
acceptable if the clock beats both incumbents and the results are very
correct. The clock and the grade are the bet's primary instruments because
they measure the learning tax directly and with less noise than a scorer's
category: a builder who has less to learn finishes sooner and gets more
checks right. The score is a floor so that speed is never bought with a
worse product.

Two fairness rules. The incumbents cannot do the offline milestones (M6, M8;
`offline_sync` 44 and 43 in the 2026-09-05 record), so time to first green
is compared on the milestones all three attempt, and reported separately
for the whole brief. Wall clock is compared only under the same-host,
same-week rule of `benchmarks/protocol.md`; across hosts, tokens are the
cross-run metric.

And the mechanism criterion, which decides more than any number: the
grader's `data_modeling` note carries no LC charge in any of the three
runs. If the clock moves and the note still says "learning cost", the bet
has not been tested; something else got faster.

If `scale_and_limits` falls below Snapback 4's median in two of three runs,
§4.4's registry is the cause until shown otherwise, and the answer is not to
add residency vocabulary back; it is to fix delivery or stop.

## 10. Risks, and what falsifies the bet

- **Delivery cost (§4.4).** The honest risk. Partition append is O(1) per
  audience; registry matching is O(held pages that could contain the row).
  Mitigation is that pages are declared queries with planner predicates and
  are indexable. Falsified by the scale bar.
- **Offline coverage.** A page model holds what was shown. A user who
  opens a conversation for the first time offline sees `complete: false`
  and nothing, where Snapback 4's partition would have had the history.
  The warm set covers first screens, not depth. This is a real product
  difference and the calibration's offline milestone will find it if it
  matters. If it does, the recovery is an engine-derived depth policy, not
  an authored one.
- **Conservative prediction.** More writes read `pending` than in Snapback
  4. The client contract absorbs this, but a builder who expects instant
  feedback on a rule the prover cannot follow will notice. `why` must be
  excellent. Falsified by `writes_and_transactions` or `offline_sync`
  falling below their medians.
- **The grader.** A single LLM run with a standard deviation near three
  points. The bar is a mean of three and a mechanism criterion for that
  reason. A 95 in one run is noise; three notes with no learning charge are
  not.
- **Self-attribution.** Every program in this corpus has reported its own
  wave as a success. The series fit and the pre-registered note criterion
  are the defense, and the author reads the grader's notes before the lead
  does (LLP 3000.007 §20.22.7's discipline).

## 11. Questions for the author

1. Commission this as a sibling under a fence, with Snapback 4 continuing as
   the control, on the terms of §8 and §9?
2. `through` and `per viewer`: both in the first slice, or `per viewer`
   first (it removes the directly charged cost) and `through` after LLP
   3000.014's revision 2 lands in Snapback 4?
3. The offline-depth position in §10: accept "what was shown plus first
   screens" as the product, or require an engine-derived depth policy in
   the first slice?
4. Does the concept budget of §7 become a blocking gate at commission, or
   a reported number until the first calibration?
5. Run the incumbents' reference lanes now, on the current brief, before
   any Snapback 5 code exists? They cost machine time only, and they also
   tell us where Snapback 4 already stands on the clock the author cares
   about.

## Non-claims

This RFC does not claim the surface of §3 is sufficient for every
application; it claims it is sufficient for the calibration brief and the
Workroom shape (LLP 3000.009 §10.1) and that anything further must pay into
the budget. It does not claim that derived residency is cheaper than a
declared partition; §4.4 says it may not be, and §9 measures it. It does
not propose changing the grader, the brief or the protocol. And it does not
claim a score: 94 is a bar the bet is held to, not a prediction.
