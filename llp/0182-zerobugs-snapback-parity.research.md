# LLP 0182: Zerobugs as a Snapback quality benchmark

**Type:** Research
**Status:** Active
**Systems:** Competitive evaluation, Demo applications, Developer experience, Application data API, Relational queries, React, Local sync, Offline sync, Optimistic updates, Auth, Search, Assets, Notifications, Deployment, Performance, Testing
**Author:** Codex (gpt-5.6-sol) / Charlie Cheever
**Date:** 2026-08-05
**Revised:** 2026-08-05 (LLP 0183 Stage 0 step 1 pin verification, Codex
gpt-5.6-sol xhigh / Claude Fable 5: every [source] claim re-verified against
the pinned checkout — see
`demos/zerobugs/stage0/0182-claim-verification.v1.md`; corrects project-table
visibility attribution, the synthetic generator's determinism and replayed
default counts (2,527,886 comments, 2,000,370 issue-label rows, ~5.53M total),
and the scope of server `Date.now()` timestamp replacement; marks two
comparative statements [interpretation]; status Draft → Active)
2026-08-05 (authorial review, Codex gpt-5.6-sol: corrects the
client-value comparison so Zero prediction is not mislabeled as authority;
separates public base facts from per-principal overlays in the staged-custody
finding; tightens source citations and removes one duplicate citation)
2026-08-05 (design-partner revision, Claude Fable 5: finding 3
records the pinned workload's authority-class ordering — public partition,
per-principal state, same-principal projection widths, shared protected
visibility — grounding LLP 0183 D3's admission staging) 2026-08-05 (initial
draft)
**Related:** LLP 0000, LLP 0008, LLP 0016, LLP 0031, LLP 0043, LLP 0045, LLP 0046, LLP 0053, LLP 0057, LLP 0060, LLP 0070, LLP 0073, LLP 0080, LLP 0107, LLP 0110, LLP 0114, LLP 0128, LLP 0129, LLP 0135, LLP 0138, LLP 0153, LLP 0155, LLP 0166, LLP 0170, LLP 0172, LLP 0173, LLP 0183, https://bugs.rocicorp.dev/p/zero/issue/3385.md, https://github.com/rocicorp/mono/tree/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs, https://zero.rocicorp.dev/docs

## Summary

Zerobugs is a stronger product benchmark for Snapback than a small CRUD demo.
Its visible product is an issue tracker, but the implementation continuously
exercises a relational application graph, query-driven client materialization,
completeness, bidirectional virtual windows, optimistic multi-table mutations,
authorization, uploads, notifications, custom HTTP representations, and a
production PostgreSQL deployment.

A useful Zerobugs-like application can be built with Snapback today. Tables,
ordinary queries and mutations, realtime delivery, React integration, assets,
sessions, scoped roles, retained reads, an ordered outbox, and server actions
already cover much of the visible application. The implementation would,
however, rely on denormalized read models, several independently maintained
query results, application-owned virtualization, handwritten optimistic
reducers outside Snapback's first generated mutation-IR ceiling, and an
external HTTP/auth/deployment tier.

That would reproduce much of the product, but not the main quality that
Zerobugs demonstrates about Zero: one relational query shape drives server
hydration, client-local reads, reactive updates, completeness, and partial
replication over a normalized local row store. Current Snapback stores
authorized query-result fragments and can transform one established result;
it does not locally execute arbitrary registered relational plans over
normalized source rows. Its stable relational profile is also far narrower
than the issue-list and issue-detail graphs Zerobugs uses.

The main gaps are therefore not CRUD or basic realtime. They are:

1. a composable, bounded relational graph expressive enough for the real
   issue-list and issue-detail screens;
2. projection-aware local facts and local graph execution with honest
   completeness, instead of only independent result fragments;
3. a first-party windowed-query controller for virtualized lists, permalink
   windows, and scroll restoration;
4. broader one-authored-operation optimistic execution for deletes, upserts,
   branches, and multi-table effects;
5. generated derived-data escape valves for JSON paths, search documents, and
   relation summaries;
6. production identity, application HTTP routes, notifications, hosting, and
   scale qualification; and
7. an inspector that makes query custody, hydration, completeness, and pending
   local work as ordinary to understand as the data itself.

Snapback should pursue product- and authoring-quality parity, not architecture
identity. Several Zero properties conflict with accepted Snapback decisions:
unrestricted whole-row local reuse, arbitrary client-supplied query semantics,
arbitrary same-by-convention client/server TypeScript, PostgreSQL logical
replication as a mandatory substrate, and Zerobugs' common client-chosen row-id
semantics versus Snapback's re-derived local-execution values. Those should
remain explicit non-parities. LLP 0183
turns the findings into a proposed quality bar and implementation program.

## Question and scope

This Research asks:

> What prevents a Snapback-backed implementation of Zerobugs from being as
> good as or better than the current Zero-backed application, and which gaps
> are implementation work versus deliberate structural non-parity?

"As good as or better" is decomposed rather than treated as one score:

- **product behavior:** screens, filters, navigation, collaboration, assets,
  notifications, and accessibility behave at least as well;
- **local-data behavior:** hydrated reads and ordinary interactions are local,
  reactive, complete when claimed, and useful through disconnection;
- **authoring quality:** an author expresses application intent without
  manually joining collections, maintaining parallel UI stores, or duplicating
  ordinary mutation semantics;
- **correctness and security:** authorization, revocation, mutation settlement,
  pagination, and incomplete data fail closed;
- **performance and custody:** large fixtures remain responsive without
  silently replicating unrelated protected data;
- **operations:** the application has a supported production path with auth,
  backup, restore, diagnostics, and delivery of external effects; and
- **architecture identity:** whether the implementation uses PostgreSQL,
  `zero-cache`, whole rows, ZQL, or the same client/server execution mechanism.

The first six are legitimate quality targets. Architecture identity is useful
for explaining differences, but is not itself a product-quality requirement.

This document does not design the successor query algebra, admit cross-query
normalization, change browser-write authority, select a hosted database, or
authorize a scale claim. Those are RFC decisions and executable evidence.

## Method and provenance

The Zerobugs source inspection is pinned to Rocicorp mono commit
`25c2c7308d3eb674d2d895022c9da11ef0c742fb`, inspected on 2026-08-05. At that
revision the workspace Zero package reports version `1.10.0` and Zerobugs uses
`@rocicorp/zero-virtual` `0.6.3`. The application README describes the live
site as continuously deployed from trunk to AWS and as Zero's dogfood.
[source — pinned
`README.md`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/README.md),
[`package.json`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/package.json), and
[`packages/zero/package.json`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/packages/zero/package.json)]

The external Zero behavior was checked against current first-party Zero
documentation for queries, ZQL, mutators, connection behavior, auth,
PostgreSQL support, and the inspector. The linked Zerobugs issue was read
through its machine-readable Markdown representation:
[`/p/zero/issue/3385.md`](https://bugs.rocicorp.dev/p/zero/issue/3385.md).
The specific documentation pages are [queries](https://zero.rocicorp.dev/docs/queries),
[ZQL](https://zero.rocicorp.dev/docs/zql),
[mutators](https://zero.rocicorp.dev/docs/mutators),
[connection behavior](https://zero.rocicorp.dev/docs/connection),
[auth](https://zero.rocicorp.dev/docs/auth),
[PostgreSQL support](https://zero.rocicorp.dev/docs/postgres-support), and the
[inspector](https://zero.rocicorp.dev/docs/debug/inspector).

The Snapback baseline was checked against the guide capability index and the
governing LLP corpus on 2026-08-05. In particular:

- [LLP 0138](./0138-zero-replicache-bakeoff.plan.md) and its retained report
  provide the provider-native Zero/Replicache comparison;
- [LLP 0155](./0155-local-sync-product-direction.rfc.md) owns the accepted
  product direction and the six-move safety envelope;
- [LLP 0129](./0129-local-first-program.plan.md) owns browser-write admission
  and records the 2026-08-04 generated-IR and optimistic-create exits;
- [LLP 0166](./0166-local-persistent-store.spec.md) owns the current local
  fragment store and `result-transform.v1` boundary;
- [LLP 0080](./0080-portable-relational-queries-and-projections.rfc.md),
  [LLP 0110](./0110-bounded-children-and-activity-patterns.spec.md), and
  [LLP 0135](./0135-sequence-allocation-and-snapshot-batch.spec.md) own the
  current relational/composition profiles; and
- [LLP 0046](./0046-postgres-graduation-path.rfc.md) and
  [LLP 0128](./0128-popular-app-storage-scale.research.md) establish that
  Postgres and popular-app scale remain plans or research, not current claims.

The following labels distinguish claims:

- **[source]** — directly observed in the pinned Zerobugs source;
- **[documented]** — stated in first-party product documentation or a
  governing Snapback LLP;
- **[observed]** — true of the current repository implementation/capability
  surface; and
- **[interpretation]** — this document's conclusion from those facts.

No comparative performance run was made for this Research. Performance claims
remain requirements for the RFC's comparator, not findings here.

## The pinned Zerobugs workload

### Data model

The pinned schema has ten tables:

| Table | Role in the product |
| --- | --- |
| `user` | GitHub identity and user presentation |
| `project` | issue namespace and search capability |
| `issue` | title, description, status, creator, assignee, visibility, ordering |
| `viewState` | per-user viewed timestamp |
| `comment` | issue discussion |
| `label` | project label vocabulary |
| `issueLabel` | many-to-many issue/label membership |
| `emoji` | issue/comment reactions with creator relation |
| `userPref` | per-user application preferences |
| `issueNotifications` | per-user issue subscription state |

The relationship graph includes to-one, to-many, many-to-many, optional, and
per-user relations. [interpretation] The table count is not difficult for
Snapback. The graph operations performed on those tables are the meaningful
workload.
[source — pinned
`shared/schema.ts`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/shared/schema.ts)]

### Reads

The issue-list query is the central stressor. It:

- restricts issues to one project through a relationship existence test;
- applies role-based visibility;
- relates the current user's `viewState` and the issue's labels;
- filters by open/closed state;
- filters by creator and assignee through related users;
- requires every selected label through nested `issueLabel → label → project`
  existence tests;
- searches title, description, or any related comment body with case-
  insensitive matching;
- orders by a selectable field plus id as a stable tie-breaker;
- supports forward and backward keyset windows; and
- returns a typed relation-bearing result consumed directly by React.

The preload query expands the graph further: labels, current-user view state,
creator, assignee, emoji and emoji creators, and the ten newest comments with
their creators and emoji. The issue-detail query includes project, creator,
assignee, labels, notifications, view state, emoji, and fifty comments. A
separate comments page query drives a bidirectional window for long threads.

[interpretation] This is not an exotic analytics workload. It is the ordinary
shape of one polished collaborative application screen.
[source — pinned
`shared/queries.ts`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/shared/queries.ts)]

### React and completeness

The issue list uses `useZeroVirtualizer`; the comment thread uses
`useZeroWindowVirtualizer`. Together they own:

- page-size selection from the viewport;
- forward and backward fetching;
- spacer calculation;
- a window around a permalink target;
- a single-row lookup for the target;
- missing-permalink handling;
- scroll-state persistence across navigation; and
- complete-versus-still-hydrating presentation.

The application also uses query result `complete` state to avoid treating a
temporarily absent local row as a canonical not-found result. [source — pinned
[`list-page.tsx`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/src/pages/list/list-page.tsx),
[`comments.tsx`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/src/pages/issue/comments.tsx), and
[`issue-page.tsx`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/src/pages/issue/issue-page.tsx)]

The lesson is that pagination primitives alone do not reproduce the product.
The query and viewport lifecycles are one higher-level component.

### Writes

The shared mutation surface includes:

- issue create, update, delete, label add, and label remove;
- notification subscription changes;
- emoji insert and delete;
- comment add, edit, and delete;
- label create and create-plus-attach;
- view-state upsert; and
- user-preference upsert.

These operations perform authorization reads, branches, inserts, patches,
deletes, upserts, and multi-table writes. The client uses generated ids and
timestamps for immediate local execution. Server implementations recheck
authority, may replace client-derived values, and trigger email or Discord
work after commit. [source — pinned
[`shared/mutators.ts`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/shared/mutators.ts) and
[`server/server-mutators.ts`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/server/server-mutators.ts)]

Current Zero applies the client mutation to its local store, executes the
server form transactionally, and rebases or rolls back as authoritative
changes return. Zero currently does not provide durable disconnected writes;
Zerobugs disables write controls when offline. [documented — Zero mutator and
connection documentation; source — pinned
[`use-is-offline.ts`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/src/hooks/use-is-offline.ts)
and its consumers]

### Application services

The production application also includes:

- GitHub OAuth, JWT minting, and user upsert;
- the Zero query and mutation endpoints;
- S3 presigned image upload;
- an unsubscribe endpoint;
- server-rendered machine-readable Markdown issue routes; and
- email and Discord notifications.

Those are not Zero query-language features, but they are part of the quality
of the actual product named by the benchmark. A backend comparison that omits
them measures a data widget rather than Zerobugs.
[source — pinned
[`api/index.ts`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/api/index.ts),
[`server/machine-routes.ts`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/server/machine-routes.ts), and
[`src/server/upload.ts`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/src/server/upload.ts)]

### Scale posture

The source includes a seeded synthetic-data generator whose default count
logic at seed 42 produces 1,000,000 issues, 2,527,886 comments, and 2,000,370
issue-label rows (replayed counts; see
`demos/zerobugs/stage0/0182-claim-verification.v1.md`). It is not fully
deterministic across run dates because generated timestamp ranges are anchored
to the generation date. The UI describes Zero as syncing millions of rows
to IndexedDB. These facts establish a deliberate large-data demonstration and
fixture, not a verified claim that every production browser holds every source
row or that every profile meets one latency target. [source —
[`SYNTHETIC_DATA.md`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/SYNTHETIC_DATA.md) and
[`src/root.tsx`](https://github.com/rocicorp/mono/blob/25c2c7308d3eb674d2d895022c9da11ef0c742fb/apps/zbugs/src/root.tsx)]

The relevant Snapback comparison is therefore not "can SQLite store roughly
5.53 million generated rows?" It is whether a supported target can serve the workload, whether the
client can keep the useful working set local, and whether the product remains
responsive and honest about completeness under that fixture.

## Current Snapback implementation sketch

A Snapback implementation using only current admitted surfaces would likely
have this shape:

1. Keep the ten authoritative tables or a close equivalent.
2. Maintain an `issueListRow` projection carrying issue, project, creator,
   assignee, visibility, and stable sort fields.
3. Maintain separate label-membership and search-document structures.
4. Serve the issue list, labels, view state, issue detail, and comments as
   separate queries or query-group children.
5. Use a snapshot bundle for the initial screen where its admitted node classes
   permit it, then accept independent replacement/live lifecycles.
6. Implement keyset comment pages and an application-owned virtual-window
   controller.
7. Use generated mutation IR for admitted create/update paths and handwritten
   optimistic reducers or server-only prediction for unsupported delete,
   upsert, branch, and multi-table programs.
8. Use Snapback assets for uploads and actions/jobs for external effects.
9. Put GitHub OAuth, custom Markdown/unsubscribe routes, and production routing
   in a sidecar or gateway.

This can be a good application. It is also substantially more application
architecture than the Zero-backed source needs for its core relational/local
data behavior.

## Findings

### 1. The principal gap is the relational screen graph

Snapback's stable relational plan is a bounded two-source equi-join with a
provably unique joined side. Its bounded-child profile covers one visible
parent and one bounded child page. Snapshot batches combine two to eight
bounded-child nodes at one snapshot, but do not accept relational, search,
aggregate, imperative, or data-dependent nodes.

The Zerobugs list requires nested relationship existence, many-to-many
membership, multiple to-one relations, per-user child state, text over child
rows, dynamic filters, stable ordering, and two-direction pagination in one
logical result. Current Snapback cannot express that graph as one generated
plan. An opaque JavaScript query can compute more shapes, but loses the
declarative plan, indexed completeness proof, local execution, and ordinary
retention class that make the comparison meaningful.

**Interpretation:** adding isolated join features one at a time is unlikely to
close the gap. Snapback needs a composable graph algebra whose work,
authorization, result contract, and completeness remain statically visible.

### 2. Query-result retention is not a normalized local database

LLP 0166 deliberately defines retained fragments as post-projection results.
`result-transform.v1` can filter, order, and limit one established result. It
does not retain unprojected joined rows, share canonical rows across addresses,
or re-run the server's source-row plan locally.

Zero's query-driven sync instead hydrates rows into a client-local relational
store. Queries run locally first, and the server fills missing data. Different
queries can reuse already-synced rows and relationships. This is why changing
a filter, opening a related view, or applying a local mutation can feel like
ordinary database work rather than cache orchestration.

**Interpretation:** Snapback can match the visible behavior only after it gains
some normalized local facts and relationship/completeness proofs, or after it
builds a sufficiently large per-route materialized graph that behaves like a
local database inside that route. Independent opaque results cannot provide
the same authoring or navigation quality.

### 3. Projection-aware authority is the hard part of local reuse

The obvious implementation — store one whole row by `(table, id)` and let all
queries reuse it — conflicts with Snapback's protected-data posture. Two
queries may authorize different fields or projections of the same source row,
sit at different versions, or lose authorization independently. Whole-row
reuse can create existence and field-value oracles even when each server result
was safe by itself.

LLP 0155 correctly gates cross-query canonical-row normalization behind a
projection-aware authority design. Zerobugs supplies stronger product evidence
for opening that design problem; it does not make the security problem go
away.

The pinned workload also orders the problem by risk. Its dominant base data is
public-project issue, label, comment, and user data — the live product answers
unauthenticated requests for public issues, including the machine-readable
route observed on 2026-08-05. That authority-independent base must stay
separate from the current user's `viewState`, `userPref`, and
`issueNotifications` overlays. The pervasive public-data reuse case is
projection width — list and detail project the same issue narrowly and widely.
Per-principal exact-projection reuse adds retirement and user-switch custody;
projection subsumption or shared protected visibility for restricted projects
requires the full field/existence-oracle adversarial program. [interpretation]

**Interpretation:** the promising unit is an authority-scoped projected fact,
not an unrestricted whole row. Compatible queries may share facts only when
authority partition, field/projection identity, version rules, and membership
reasons permit it. Absence and relationship completeness need proof just as
positive fields do. The authority classes above admit a staged design;
[LLP 0183](./0183-zerobugs-quality-surface.rfc.md) D3 records the ordering.

### 4. Virtualized query windows are a first-party data primitive

Snapback has bounded keyset pages, grouped queries, boot bundles, and React
stores. It does not have a first-party controller equivalent to Zerobugs'
windowed list behavior. Reimplementing it in each app means authors must
coordinate page cursors, row identities, spacers, overlapping requests,
permalink lookup, completeness, predecessor retirement, and scroll restoration
themselves.

**Interpretation:** a headless `WindowedQuery` controller with a React wrapper
belongs beside query hooks, not in the demo. Its state must be backed by the
same local materialization and custody inspector as ordinary queries.

### 5. The mutation gap has narrowed materially

The original LLP 0138 bakeoff found handwritten Snapback optimistic reducers
and a provisional-create sidecar where Zero used one shared mutator. That is no
longer the whole current picture. LLP 0129 records accepted 2026-08-04 exits
for a browser-safe `Insert/Get/Guard/Patch` IR and typed provisional creation,
including rebase, settlement, id mapping, contention, and process-termination
evidence.

Zerobugs still exceeds that ceiling. Its common surface includes `Delete`,
`Upsert`, branches, relation reads, and multi-table atomic programs. Server
JavaScript can implement every operation, but unsupported local programs need
handwritten optimism or a server-only pending state.

**Interpretation:** the next work should widen generated IR only against the
pinned Zerobugs operation corpus. Arbitrary app-authored browser transactions
remain unnecessary until the closed IR demonstrably cannot express a required
quality fact under LLP 0129's admission protocol.

### 6. Issue 3385 demonstrates the escape-valve problem

The linked issue remains open and asks Zero to allow JSON values in `where`
clauses. A permission use case is named. PostgreSQL views do not solve the
problem because they are not synced. The documented workaround is a trigger
that extracts JSON into a separate column plus a custom mutator whose client
updates the extracted column while its server form updates the JSON source.

Snapback can store validated JSON, but its portable query and projection
profiles do not expose arbitrary nested JSON-path expressions. An opaque
handler can parse JSON, but that does not supply an indexed portable query or a
locally executable plan.

**Interpretation:** copying today's ZQL grammar would not solve the general
problem. A closed portable system needs generated derived fields, maintained
search documents, and a versioned expression-extension process. Raw SQL is
not the useful escape hatch when two evaluators and multiple targets must
agree.

### 7. Search is a mixed comparison

Snapback's first-class portable text search is stronger than Zero's current
committed first-class search surface. It supports terms, phrases, prefixes,
exclusions, deterministic ranking, highlights, visibility profiles, and
keyset pagination. It is not live, offline, hosted, or composable as a node in
the current relational graph.

Zerobugs implements title/description/comment substring matching in its query
graph and can disable search per project. That is convenient for the current
application but is not a complete large-scale search product.

**Interpretation:** Snapback should preserve its typed search semantics and add
graph composition, live result establishment, and generated multi-source
search documents rather than replacing it with unbounded string predicates.

### 8. Production application surfaces are independent blockers

Snapback ships strong local assets, actions with controlled egress, cron,
experimental one-off jobs, local sessions, scoped roles, and an Expo push
seam. It does not currently advertise first-class notifications, production
external identity adoption, general application-owned HTTP representations,
or a complete hosted target lifecycle.

Zerobugs needs all four. A sidecar can supply them, but then a "Snapback-backed
Zerobugs" claim must distinguish its database/realtime core from the external
application backend it still requires.

**Interpretation:** product parity requires a supported composition story even
if Snapback does not own every provider. Identity exchange, safe custom HTTP
routes, durable effect delivery, secrets, and deploy/backup/restore must be one
paved application surface.

### 9. Scale parity is unproved, not disproved

Snapback's canonical local target is Ibex plus SQLite. The root goal of carrying
a Partiful-scale application is explicitly not yet a benchmark claim. The
Postgres graduation RFC says Postgres is a design promise and first requires a
storage seam. Fleet client hydration remains a structured local-store GAP, and
no hosted capability is advertised.

Nothing in the current evidence proves that Snapback cannot serve the
Zerobugs synthetic fixture. Nothing proves that it can meet the user-visible,
client-custody, write, fanout, restart, and deployment envelope either.

**Interpretation:** the useful target is not "sync millions because Zero does."
It is equal or better viewport and navigation quality with less client custody,
plus an honest supported authority target for the full fixture. The benchmark
must measure both.

### 10. Snapback already has meaningful ways to be better

The provider-native bakeoff found Snapback stronger at:

- explicit server authority and stable conflict boundaries;
- separate local paint, settlement, and observer-convergence facts;
- a durable ordered outbox and restart-preserved intent;
- protected-result retirement, revocation, and user switching;
- bounded query/work declarations and fail-closed incomplete prefixes; and
- a smaller local operating surface without mandatory PostgreSQL,
  `zero-cache`, replication slots, and a second application API tier.

Zerobugs disables writes while offline because current Zero does not provide
durable disconnected mutation custody. A Snapback implementation that retains
the issue graph, renders queued intent after restart, and later settles it
safely would exceed the current product on a real user-visible axis.

**Interpretation:** the goal is not to erase these differences. Snapback should
make Zero-quality relational/local authoring sit on top of its stronger
authority and intent model.

## Feasibility and parity classification

| Capability | Current Snapback | Current workaround | Quality disposition |
| --- | --- | --- | --- |
| Ten-table authoritative model | Shipped local | None | Feasible now |
| Issue CRUD and comments | Shipped server functions; partial generated local IR | Server-only or handwritten optimism for unsupported verbs | Feasible; authoring gap |
| Realtime list/detail updates | Shipped local | Multiple live queries and replacements | Feasible; composition gap |
| Full issue-list relational graph | Not expressible as one admitted plan | Maintained projections plus several queries | Main read-path blocker |
| Local filter/navigation over hydrated graph | One-result transform only | Network queries or app cache | Architectural parity blocker |
| Bidirectional virtual windows/permalinks | Pagination primitives only | App-owned controller | Product/DX gap |
| Search across issue and comments | Strong server search, not graph/live/offline | Maintained search document | Feasible with modeling work |
| GitHub OAuth | Dev/test external broker only | Sidecar identity gateway | Production gap |
| Images | Strong local asset pipeline | S3 sidecar remains optional | Feasible; hosted gap |
| Email/Discord notifications | Actions/jobs substrate; no first-class notification capability | App ledger and provider action | Feasible; product/ops gap |
| Markdown and unsubscribe routes | No general paved app HTTP representation | Sidecar/gateway | Product surface gap |
| Durable disconnected intent | Stronger substrate than current Zero; browser end-to-end proof still partial | App draft for unsupported local program | Potential Snapback advantage |
| Multi-million-row hosted fixture | No qualified claim | Unsupported custom deployment | Production parity blocker |

## Structural non-parities

The following differences are impossible to match *while retaining the named
accepted Snapback decisions*. They are not claims about theoretical software
possibility: Snapback could reverse its decisions and copy Zero. The point is
that doing so would no longer be the proposed Snapback architecture.

### S1. Unrestricted whole-row local reuse

Zero returns and stores whole matched rows so other local queries can reuse
them. Snapback's custody unit is an authorized query/projection and its
negative-authorization obligations can delete or quarantine one membership
independently.

Snapback cannot offer unrestricted whole-row reuse across differently
authorized projections while also claiming least-projection custody and no
cross-query field oracle. It can offer authority-scoped projected-fact reuse
and make compatible public data feel equally local. Some arbitrary query that
would succeed from Zero's broader row custody must instead hydrate or refuse.

### S2. Arbitrary or moving query-language parity

Zero can grow ZQL alongside its PostgreSQL mapping. Snapback requires closed,
bounded, target-portable plans with matching server/client semantics and
explicit capability publication.

Snapback cannot promise to match every current or future ZQL/SQL expression,
arbitrary SQL, or a client-supplied query AST without giving up bounded
admission and target portability. It can promise the complete pinned Zerobugs
workload and a governed extension process.

### S3. Arbitrary same-by-convention client/server TypeScript

Zero's custom mutator model permits application TypeScript to execute locally
and a server form to execute against authority, with application discipline
maintaining their relationship. Snapback's preferred path is a generated,
content-addressed IR with a restricted browser evaluator; secrets, network,
filesystem, trusted time, and arbitrary host powers remain server-only.

Snapback cannot make arbitrary server handler code locally executable while
retaining that capability boundary. It can make the common database program
one-authored and degrade unsupported operations honestly to server-only
prediction.

### S4. Client-chosen application values on the shared-mutation path

Zerobugs commonly chooses row ids in the client mutator and preserves those ids
in the server form. Server overrides replace client timestamps with
`Date.now()` for issue create/update, emoji add, and comment add, while
view-state and notification timestamps remain client-supplied. Zero still treats the local result as speculative; this is a
value-continuity difference, not evidence that Zero confuses prediction with
authority.

Snapback's locally executed lane re-derives `ctx.runtime.id()` and
`ctx.runtime.now()` by default and reconciles provisional ids through the
settlement map. Its queued-intent lane and explicitly validated application
arguments have different policies under LLP 0133. Snapback therefore cannot
promise Zerobugs-style client-chosen id continuity as the default meaning of a
locally executed runtime mint without an owner amendment or explicit argument
contract. Typed provisional rows and stable mappings can match the UI quality,
but the value and settlement model remains deliberately different.

### S5. Drop-in PostgreSQL logical-replication topology

Zero is a sync layer over an application-owned PostgreSQL database and derives
canonical changes through logical replication and `zero-cache`. Snapback owns a
portable application schema/function contract and intends multiple physical
targets behind it, with a small embedded local default.

Snapback cannot simultaneously be a drop-in sync layer for arbitrary existing
PostgreSQL schemas, triggers, extensions, views, and ORM behavior and guarantee
its portable cross-target contract. A future Postgres target can run Snapback
applications without becoming Zero's bring-your-own-database product.

## Lessons for Snapback

1. **Adopt applications as capability definitions.** "Supports relations" is
   not a useful milestone. "Expresses the pinned Zerobugs issue list without
   manual collection joins" is.
2. **Treat completeness as data.** Absence, partial hydration, stable prefix,
   currentness, and authorization are separate facts and must reach React and
   inspection directly.
3. **Make a local materialization more than a cache.** Hydrated facts should be
   reusable by compatible registered queries and optimistic programs without
   widening custody.
4. **Productize viewport/data coordination.** Windowing, paging, permalink
   lookup, and scroll restoration are one reusable client primitive.
5. **Prefer generated escape valves.** Derived columns, maintained search
   documents, and versioned expressions are safer and more portable than raw
   SQL or opaque collection code.
6. **Use the new write substrate before expanding authority.** The 2026-08-04
   IR and typed-create exits retire historical gaps. Zerobugs should size the
   next verbs, not justify arbitrary client transactions by analogy.
7. **Measure less custody as an advantage.** Equal responsiveness with a
   smaller authorized local working set is better than copying a millions-row
   demonstration mechanically.
8. **Include the boring production edges.** Auth callbacks, machine-readable
   routes, unsubscribe, notifications, backup, restore, and deploy are part of
   the application benchmark.
9. **Keep architecture non-parity explicit.** Users can judge tradeoffs only
   when a refusal or network hydration is explained as policy rather than
   hidden as an implementation accident.

## Suggested follow-on

[LLP 0183](./0183-zerobugs-quality-surface.rfc.md) should own the product
decision and staged acceptance program. Existing owners remain authoritative:

- LLP 0080/0110/0135-family successors own graph-node semantics;
- LLP 0008/0053/0155/0166 own projected local facts and custody;
- LLP 0129 owns write-language widening and app-authored-client-mutator
  admission;
- LLP 0031 owns application HTTP route classes;
- LLP 0045/0070 own notification/effect delivery;
- LLP 0057/0060/0153/0172 own production identity and explicit function auth;
- LLP 0046/0072/0128 own hosted storage, deployment, and scale claims; and
- LLP 0016 requires a diary and corpus reconciliation when the benchmark app
  is built.

## Confidence

High for the source inventory, current Snapback capability boundaries, and the
finding that relational graph plus local fact reuse are the dominant parity
gaps. They follow from pinned source and explicit governing contracts.

Moderate for the projected-fact direction. It follows the accepted custody
model and appears capable of supporting the workload, but it has not yet faced
the adversarial projection, revocation, version-skew, bundle-size, and browser
storage evidence required for admission.

Low for comparative performance, hosted cost, and maximum supported scale.
Those need the RFC's frozen comparator and executable evidence; source claims
and local microbenchmarks cannot answer them.

## Status

Active Research. Accepted as the LLP 0183 program's research record after the
Stage 0 pin re-verification recorded in
`demos/zerobugs/stage0/0182-claim-verification.v1.md` (four factual
corrections applied; external Zero-documentation, live-site, and issue-3385
claims remain outside that artifact's verification scope). It records no
capability promotion and authorizes no implementation or structural decision.
Its follow-on is LLP 0183.
