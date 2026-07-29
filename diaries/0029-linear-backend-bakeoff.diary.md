# Diary 0029: Linear backend bakeoff

**Type:** Diary
**Status:** Active
**Systems:** Backend bakeoff, Issue tracking, Search, Realtime, Schema evolution
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Related:** LLP 0102

## 2026-07-28 — Stage 0, protocol freeze

No provider arm has started. The frozen Linear-shaped workload emphasizes
relational composition, indexed filtered lists, cursor stability, concurrent
board movement, search, offline behavior, and a production-shaped schema
change. Unsupported provider-native search or offline behavior must remain an
explicit GAP rather than being quietly replaced by a shared service.

## 2026-07-28 — Snapback, deep round, complete with four gaps

### Environment

- Frozen repaired product/source commit:
  `5f31cb6174daaefa04a1e05242acbbc22c725040`
- Fresh isolated local SQLite + Ibex sessions target in
  `/private/tmp/llp0102-linear-snapback-coord`
- Frozen aggregate:
  `ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a`
- Result: 10 PASS, 4 GAP, 0 FAIL; exact runtime and persona carriers cleaned

### Milestones

The generated schema and functions built on the first codegen pass. The first
complete acceptance attempt hit Snapback's 1,024 buffered-write ceiling while
trying to seed the whole production-shaped fixture atomically. Five explicit
100-issue seed batches resolved that product constraint. A later clean attempt
proved 500 seeded issues, 1,000 seeded comments, 20 labels, three teams, four
projects, a concurrent cursor insert, and the subsequent test mutations.

The final clean attempt completed in about 36 seconds, including a rendered
React board, two warmups and seven recorded samples for each supported
performance path, and exact cleanup.

### What felt good

Sessions, generated function references, schema indexes, server-owned ids and
versions, and native live queries fit the tracker naturally. The same protected
queries served Alice and Bob, while Mallory received the exact structured
permission diagnostic for both reads and writes. No app-level identity field or
authorization shim was needed.

The stale-read-set conflict test was particularly crisp: two callers used the
same issue version, exactly one multi-field board edit committed, and the loser
received `SNAPBACK_MUTATION_CONFLICT`. The resulting evidence was easier to
interpret than a provider-specific last-write-wins convention.

### What felt bad or frustrating

The 1,024-write mutation ceiling was absent from the mutation guide. The runtime
diagnostic was excellent once the limit was crossed, but discovering the
ceiling only after a large authenticated seed had run was wasteful. The remedy
also exposed how much application ceremony production-shaped bulk creation
requires: the app now owns aligned seed batches even though batching is not an
issue-tracker concept.

Relational issue detail required separate bounded queries for the project,
labels, comments, and activity. This was correct and inspectable, but more
manual than a provider whose ordinary query language returns the composed
object graph directly. Label filtering similarly required an application-level
semi-join after an indexed link-table query.

### Modeling and correctness

Organization membership is a first-class declared membership table; all issue,
comment, activity, team, project, and label handlers demand the organization
role. Indexed issue paths cover organization/sequence, status, assignee, and
project. Label membership uses both issue-label and label-issue indexes.

Stable pagination uses an immutable integer sequence cursor plus row id as the
tie-break concept. A new sequence-500 issue inserted after page one appeared
exactly once in the later page union, without changing the first page.

### Realtime, offline, and auth

Bob received Alice's new comment and its activity row through two native
Snapback streams with polling fallback disabled. Owner/member/outsider
authority was entirely session-derived.

Membership-gated cold retention and a queued offline edit remain a GAP on the
frozen React Online surface. The arm did not substitute an in-memory cache and
call it offline behavior.

### Deployment and operations

The local packaged target was easy to bind to an exact generated app identity,
database path, and pre-cleanup database hash. Exact cleanup was straightforward.

Snapback still lacks an honestly complete hosted profile for deployment
identity, hosted logs/configuration, rollback, and export. LINEAR-12 is
therefore an explicit GAP, not a local-build proxy.

### Documentation and diagnostics

The agent-first guide gave good guidance for sessions, protected live queries,
conflicts, generated references, and target claim boundaries. The structured
buffer-limit and permission diagnostics were actionable.

The mutation guide should state the exact 1,024 buffered-write limit and suggest
bounded bulk-work patterns. A `guide-gap` filesystem ticket records that miss.

### Glue and workaround inventory

- `src/provider.ts`: thin React-to-generated-client adapter.
- `scripts/run-arm.mjs`: acceptance/evidence harness.
- `seedIssuesBatch`: five application-owned batches solely to stay below the
  runtime write ceiling.
- Separate detail queries and a label semi-join because the arm cannot express
  the full issue graph as one ordinary generated query.
- Explicit GAP records for search, protected offline behavior, migrations, and
  hosted deployment.

### Outcome

The arm is complete with 10 passes, 4 gaps, and no Stop-class defect. Search,
offline retained editing, reviewed indexed-field migration, and hosted
deployment remain product gaps. Full evidence is in
`demos/backend-bakeoff/arms/linear/snapback/`.

### Would I choose it?

For a local-first issue tracker today, no: search, hosted operations, and
protected offline editing are too central. For a local, session-protected,
realtime tracker where deterministic conflicts matter more than those
capabilities, Snapback is coherent and pleasant.

### Lessons for Snapback

Keep the session-derived authority, generated references, exact conflict
diagnostics, and honest capability boundaries. Improve the result by adding a
product-owned bulk-write path, generated relational composition, indexed
full-text search, protected retention/queued mutation support, the reviewed
migration workflow, and a complete hosted operational profile. These are
incremental product-surface additions; this arm found no evidence that
Snapback's core approach must be replaced.

## 2026-07-28 — Firebase, deep round, complete

### Environment

Firebase JS SDK 12.16.0, CLI 15.24.0, Admin SDK 13.5.0, and Functions
SDK 6.4.0 ran against an isolated Local Emulator Suite project providing Auth,
Firestore, Functions, and Storage. Hosted credentials were unavailable, so the
arm makes no hosted claim.

### Milestones

- First local read: 6.333 seconds
- First authoritative mutation: 6.485 seconds
- First realtime transition: 10.011 seconds
- Local acceptance complete: 16.244 seconds
- Active implementation window: 28 minutes 14 seconds

### What felt good

Firebase handled the realtime and offline portions unusually well.
`onSnapshot`, latency compensation, pending-write metadata, IndexedDB
persistence, and the offline mutation queue fit the workload directly.

The cold-browser test was particularly convincing: a newly opened page rendered
50 retained issues with transport disabled, accepted an optimistic edit while
the authoritative database remained unchanged, and reconciled correctly after
reconnect.

The emulator suite also made Auth, Security Rules, Functions, and Firestore
testable together without weakening production-shaped authorization paths.

### What felt bad or frustrating

Firestore Security Rules couple authorization to query shape. Comments and
activities protected by `orgId` could not safely be queried only by `issueId`;
every protected query needed an explicit `orgId` equality constraint and a
matching compound index. This is correct behavior, but it adds duplicated
modeling and indexing work.

Issue detail required application-authored fan-out because Firestore has no
joins. A Linear-shaped workload quickly accumulates composite indexes,
denormalized organization identifiers, and manual composition code.

There is no native full-text search. Firebase's official guidance requires a
separate search provider, so LINEAR-09 is an honest GAP.

The root dependency audit reported 24 findings—8 moderate and 16 high—and the
Functions tree reported 9 moderate findings. These are ecosystem/dependency
observations, not demonstrated Firebase runtime defects, but they add
maintenance noise.

### Modeling and correctness

Firestore's document model worked cleanly for issue lists, cursor pagination,
label arrays, and bounded indexed queries. It was less natural for relational
issue detail and organization-scoped authorization.

A callable Function wrapping a Firestore transaction provided a strong
revision-CAS conflict path: two authenticated clients raced, exactly one
committed, the loser received a typed `aborted` error, and both clients
converged.

The migration required an Admin SDK `BulkWriter` backfill across all 500 issues
plus a committed composite index. Counts were preserved, but the schema change
was operational code rather than a first-class migration workflow.

### Realtime, offline, and auth

- Native email/password Auth represented Alice, Bob, and Mallory.
- Security Rules directly proved member access and outsider read/write denial.
- `onSnapshot` supplied true second-client push with server metadata.
- Optimistic state exposed pending-write settlement clearly.
- Persistent local cache and queued writes supported a real cold
  offline/reconnect test.

### Deployment and operations

The local emulator workflow was cohesive and exportable. Target identity,
service inventory, process ownership, export hashes, and cleanup could all be
retained.

Emulator readiness was slightly racy: the hub became reachable before every
service appeared in its inventory, requiring an explicit completeness wait.
Firebase also opened WebSocket, Eventarc, and Tasks auxiliary ports beyond the
assigned set. Cleanup had to discover those ports from the recorded emulator
identity and verify them separately.

Hosted deployment was not exercised because credentials were unavailable. This
is an environment limitation, not a Firebase product failure.

### Documentation and diagnostics

Firebase documentation was generally strong for ordinary paths. The
full-text-search documentation was commendably explicit that Firestore itself
does not provide the capability.

Runtime diagnostics were useful but verbose. Security Rules failures identify
the rule line, while understanding why a protected query shape cannot be proven
still requires familiarity with Firestore's rules/query contract.

### Glue and workaround inventory

- Full-text search: explicit product GAP.
- Relational issue detail: application-authored bounded fan-out.
- Migration: `BulkWriter` backfill plus manually declared index.
- Authorization: denormalized `orgId` and repeated query constraints.
- Conflict handling: callable Function and application-level revision field.
- Index management: eight committed compound indexes.
- Cleanup: provider-issued auxiliary-port discovery.

### Outcome

All locally executable frozen scenarios passed: 12 PASS, one product GAP, and
one hosted credential-unavailable result. The coordinator independently
verified the capsule, every evidence path, direct 16/16 evidence confidence,
the frozen source/freeze identities, and all ten assigned/provider-issued closed
ports.

### Would I choose it?

Conditionally yes. Firebase is strong when offline behavior, realtime
synchronization, and client-native Auth are central and the team accepts
Firestore's document/query model.

It would not be my automatic choice for a Linear-shaped product with rich
relational views, extensive ad-hoc filtering, native search expectations, or
migration-heavy backend evolution. Those requirements make denormalization,
indexes, fan-out, and auxiliary services increasingly expensive.

### Lessons for Snapback

- Match Firebase's observable offline result: retained cold-client data, queued
  optimistic writes, explicit pending state, and deterministic reconciliation.
- Make realtime transport and authoritative settlement as inspectable as
  Firestore snapshot metadata.
- Preserve strong local testing across auth, authorization, functions,
  realtime, and offline behavior.
- Beat Firebase on relational composition so protected detail views do not
  require manual fan-out and duplicated tenant keys.
- Provide native search suitable for ordinary application workloads.
- Make authorization constraints compositional without forcing every query to
  repeat security-relevant predicates.
- Treat schema evolution, backfills, index changes, and rollback evidence as
  one coherent migration workflow.
- Automatically inventory and clean provider/runtime auxiliary resources
  rather than requiring harness-specific discovery.

## 2026-07-28 — Supabase, deep round, complete with two gaps

### Environment

The arm used Supabase's official local CLI stack with native Postgres tables,
foreign keys, RLS, Auth users, PostgREST/RPC, Realtime Postgres Changes,
PostgreSQL full-text search, and SQL migrations. Source and evidence stayed in
the isolated worktree; Colima required an exact runtime-only mirror under
`/Users` because it could not bind the assigned `/private/tmp` path.

### Milestones

Once the target was running, the exact 500-issue/1,000-comment seed completed in
about 1.1 seconds. Two complete reproducibility attempts were retained because
the first cold Realtime subscription missed the first immediate post-ready
write; the corrected attempt required an exact-ID second write and retained the
first failure rather than hiding it.

### What felt good

The relational fit was excellent. Organizations, memberships, teams, projects,
assignees, labels, issue-label joins, comments, and activity remained legible
in ordinary SQL, and direct index definitions made filter/search evidence
unusually crisp. A generated weighted `tsvector` plus GIN index gave real
server-side search without a separate service.

The best part was making an issue edit and its activity receipt one row-locked
database operation. Concurrent Alice/Bob board moves both committed, revision
advanced twice, the highest activity identity defined the last writer, and both
clients converged after a fresh read. The separate `ALTER TABLE` evolution
added a non-null indexed estimate field while all before/after counts stayed
identical.

### What felt bad or frustrating

The authority model was powerful but verbose. The arm needed helper functions
to avoid recursive RLS, policies across eleven public tables, explicit grants
because the current CLI no longer auto-exposes new tables, RPC privilege
revocation, Realtime publication setup, and careful invoker-versus-definer
choices. Supabase made the primitives available; it did not make the whole
authorization design coherent for the builder.

Realtime was the biggest surprise. A channel could report `SUBSCRIBED` and
still miss the first comment inserted immediately afterward on a cold stack.
The exact second attempt delivered both the comment and its trigger-created
activity, and all seven warm issue-update samples delivered, but local delivery
clustered around 525 ms. A ready state that does not fence the first post-ready
write forces application and harness logic to distrust the lifecycle signal.

### Modeling and correctness

Native SQL covered the composed detail graph, indexed filters, tuple-cursor
pagination, full-text search, and schema evolution without denormalizing the
whole domain. PostgreSQL constraints and transaction boundaries made the
authority and conflict outcomes independently inspectable.

The policy surface was the corresponding cost: its flexibility creates many
places for an agent to make a subtle security, recursion, grant, or definer
mistake.

### Realtime, offline, and auth

Supabase Auth and PostgreSQL RLS directly represented Alice, Bob, and Mallory.
Realtime Postgres Changes worked after the cold readiness seam described above.

Offline was an honest product gap. A fresh `supabase-js` client with transport
disabled had no retained query rows; a blocked edit returned a fetch error and
was not queued; authority stayed unchanged. Adding IndexedDB or SQLite plus an
outbox would be application architecture, so the arm did not credit it.

### Deployment and operations

The frozen client/CLI installation occupied about 245 MB and the target ran
eight containers plus a volume and network. The CLI's normal start output
includes local generated keys, so automation must deliberately suppress or
redact it even though the target is ephemeral.

Studio, status, logs, and schema export were useful once running, and exact
project cleanup was reliable. Hosted evidence remained unavailable, so the arm
says nothing about managed deployment quality, region, billing, or rollback.

### Documentation and diagnostics

Supabase's underlying PostgreSQL makes query plans, policy definitions, schema
diffs, and migration invariants inspectable using familiar tools. The burden is
orchestration: the builder still has to assemble those proofs and connect them
to the client/realtime surface.

The cold Realtime missed-write evidence is an important diagnostic gap. A
transport-ready state should be a real barrier or explain which additional
condition establishes one.

### Glue and workaround inventory

- Eleven-table SQL/RLS policy surface with helper functions and explicit
  grants.
- Row-locked RPC for atomic board edits plus activity records.
- Generated `tsvector` and GIN index for native search.
- Separate additive SQL migration for the estimate field.
- Cold Realtime exact-ID retry after the first post-`SUBSCRIBED` write was
  missed.
- Runtime-only `/Users` mirror for Colima bind compatibility.
- Explicit offline and hosted GAP records.

### Outcome

The arm completed 12 PASS and 2 GAP with no failure or Stop-class defect.
Coordinator verification confirmed the capsule, every referenced evidence
path, frozen identities, zero exact-project containers/volumes/networks, and
closed Vite plus `56431–56440` target ports.

### Would I choose it?

Supabase is a strong go-to for a relational web issue tracker when SQL control,
RLS, full-text search, and migrations matter more than offline-first behavior
or minimal local operations. Its strongest advantage is not magical
abstraction; it is giving ordinary PostgreSQL a coherent
hosted/client/realtime envelope.

Its weakest points in this build were cold Realtime readiness, no native
offline data/outbox, policy verbosity, and local stack weight.

### Lessons for Snapback

Match Supabase's end result for relational composition, indexed server-side
filters, first-class full-text search, atomic database-side workflows,
independently inspectable authority, and additive migration receipts. Make the
equivalent authorization path much smaller and harder to get subtly wrong,
ideally through generated analyzable policy plus an exact access explainer.

A Realtime ready barrier should genuinely fence the first post-ready write,
with lower local delivery latency and first-class transport diagnostics.
Built-in retained reads and an outbox would be a major advantage over bare
Supabase. Preserve Snapback's lightweight single-target ambition: this arm's
eight-container/245 MB footprint and runtime-mirror workaround are real
agent-DX costs. Finally, make index/query-plan inspection and before/after
migration invariants one command.

## 2026-07-28 — Convex, deep round, complete with two gaps

### Environment

The arm used Convex 1.42.3 with the official anonymous local backend, React
client, generated functions/types, reactive queries, native indexes and search
indexes. A worktree-local custom-JWT issuer represented the three frozen
actors because the anonymous local deployment did not provide a reusable
hosted identity configuration.

### Milestones

The clean acceptance run completed in about 19 seconds. Seed plus first read
took about 201 ms, the first authoritative mutation about 320 ms, and the first
realtime transition about 470 ms. Two earlier attempts are part of the diary:
one harness invocation failed before writing application rows because it
shadowed Node's `performance` API, and the first complete run used a
`ConvexClient` whose subscription cache made read timings unrealistically
small. The coordinator caught that measurement error and reran the entire arm
against a fresh target with `ConvexHttpClient` for list/detail timing.

### What felt good

Convex's function model was compact and cohesive. A single transactional query
composed the issue detail graph, indexed queries covered the deterministic
filters, and the native text-search index found the expected issue without a
side service. Mutations combined the issue edit, activity record, authorization
check, and revision compare-and-set in one serializable operation.

Realtime was especially pleasant. A second authenticated client subscribed to
the ordinary issue-detail query and received the new comment and activity over
the native reactive WebSocket path. The measured local delivery median was
about 46 ms, with no polling or separate publication configuration.

### What felt bad or frustrating

The ordinary browser client has no persistent cold query cache or offline
mutation outbox, so the required offline/reconnect scenario is a product GAP.
The anonymous local workflow also required custom JWT/JWKS glue, and its local
configuration contained generated administrative secrets. Cleanup therefore
had to remove the whole exact deployment directory rather than merely delete
application rows.

Schema evolution was workable but application-authored: make the field
optional, deploy it, run a transactional backfill, then deploy/read the new
index. This proved the end result over all 501 rows, but it was not a
first-class reviewed migration plan with built-in rollback evidence.

The dependency installation occupied roughly 148 MB and `npm audit` reported
one high-severity finding. The generated surface was small, but the distinction
between reactive-client cache performance and authoritative backend read
performance was easy to miss.

### Modeling and correctness

Convex documents and indexes fit the list/board side of the workload well.
Relational detail composition remained application code, but running it inside
one query transaction provided a coherent snapshot. Stable sequence cursors
covered all 501 rows exactly once under concurrent insert.

Two actors raced with the same expected revision. Convex's serializable
mutation execution plus the explicit revision check admitted exactly one
writer, rejected the other with `REVISION_CONFLICT`, and left an independently
readable authoritative winner.

### Realtime, offline, and auth

- Custom JWTs supplied distinct owner, member, and outsider identities.
- Function-level membership checks rejected both outsider reads and writes.
- Reactive queries provided direct second-client push.
- Application-authored optimistic state reconciled after mutation settlement.
- Persistent cold reads and queued offline mutation are unsupported by the
  ordinary client and were not simulated.

### Deployment and operations

The official anonymous local backend was fast to start and easy to drive, but
no isolated hosted credential was available, so hosted URL, region, usage,
rollback, and export remain unavailable rather than inferred.

Cleanup deleted every exact-namespace row, stopped the assigned ports, and
removed `.convex`, `.arm-runtime`, `.env.local`, the private signing key, and
public persona carriers. The coordinator independently verified those negative
probes and the final local database hash before removal.

### Glue and workaround inventory

- Custom local JWT issuer and JWKS for three real authority paths.
- Application-level revision field for typed conflict refusal.
- Application-authored optimistic object before mutation settlement.
- Optional-field rollout and explicit backfill for migration.
- Explicit removal of secret-bearing local deployment state.
- Honest persistent-offline and hosted-deployment gaps.

### Outcome

The arm completed 12 PASS, one product GAP, and one hosted
credential-unavailable result. The capsule and every evidence path verify.
Evidence confidence is 14/16 because the offline dimension is intentionally
absent; all other dimensions have direct evidence.

### Would I choose it?

Yes, often. Convex is a strong default for a realtime collaborative web
application when compact server functions, transactional correctness, native
reactivity, and low orchestration matter more than SQL access or built-in
offline-first behavior.

I would hesitate when persistent offline work, externally governed relational
data, mature migration operations, or self-hosted credential hygiene dominate
the requirements.

### Lessons for Snapback

Match Convex's end result for a small authoring surface: schema, indexed query,
mutation, authorization, and reactive client should feel like one coherent
system. One server query should naturally compose a bounded detail graph, and
one mutation should naturally own authorization, conflict policy, data change,
and activity receipt.

Snapback can differentiate by preserving retained cold reads and an outbox,
making principal setup simpler than custom local JWT glue, and offering a
reviewed migration/rollback workflow. It should also make authoritative versus
client-cache performance explicit in its tooling, keep local credentials
scoped and automatically disposable, and add native indexed search without
expanding the operational footprint.

## 2026-07-28 — SpacetimeDB 2.7.0, deep round

The arm ran on an isolated standalone target on the Minisforum Linux worker.
It passed seed, authority, indexed filters, stable cursor pagination under an
intervening insert, composed issue detail, optimistic reconciliation,
two-actor conflict settlement, native realtime comments/activity, an in-place
indexed-field migration, and every supported performance path. Full-text
search and persistent offline/queue behavior are honest product GAPs. Hosted
Maincloud evidence was unavailable because no authorized SpacetimeDB
credential existed.

### What felt good

The reducer and subscription model is unusually coherent. Writes serialize on
the server, actor identity is available inside the reducer, and committed rows
flow back through generated bindings. Expected-revision conflict handling was
easy to reason about and produced exactly one winner.

Generated TypeScript bindings were excellent. Reducer/view names, row types,
bigint revisions, and timestamps arrived in both client and harness without a
hand-maintained API layer. Native WebSocket callbacks also made the
second-client comment/activity proof direct and attributable.

The additive migration was a high point. The CLI printed a concrete plan,
added a defaulted indexed column in place, retained all 500 issues, and made
the client-disconnect consequence explicit. Warm module builds were
consistently around half a second.

### What felt bad or surprising

Parameterized views are unavailable. Stable filtered pagination required an
identity-scoped durable `page_result` table and a reducer that materializes
each page. That works, but turns a routine query into application state with
its own lifecycle and cleanup.

Caller-dependent views made authority legible, but the straightforward
implementation scans memberships and issue collections in JavaScript. It is
easy to write a secure but expensive view without a query planner explaining
the cost.

There is no ordinary native full-text path in 2.7.0. Offline behavior is also
well behind an offline-first backend: a disconnected object retains warm
in-memory rows, a cold object has none, and the first disconnected reducer call
remained pending. No persistent cache or mutation queue was claimed.

Development identity required persona-registration glue and careful token
custody. CLI papercuts included version selection, global-versus-command flag
placement, unstable SQL syntax, a codegen stale-file prompt, a migration
default still required by generated insert types, and an npm `prepare`
lifecycle collision.

### Correctness, migration, and operations

Private tables, caller-dependent views, reducer authorization, and generated
subscriptions gave Alice and Bob protected access while Mallory saw no rows
and could not subscribe directly. The two-client barrier produced exactly one
CAS commit and one refusal, followed by authoritative convergence.

V2 added `customerImpact` with a default and B-tree index. Publishing with
data deletion disabled retained and defaulted all 500 issues, then accepted an
authoritative post-migration update.

Exact database deletion, validated arm-process shutdown, closed ports, and
removal of worktree-local data/CLI/log/credential roots succeeded. The
coordinator found that the worker's final `describe` negative probe used
invalid CLI argument ordering and therefore proved only a usage error, not a
database-not-found response. The raw receipt is preserved; cleanup remains
PASS but cleanup-isolation confidence is reduced to indirect.

### Glue and failed attempts

- Durable identity-scoped page materialization for parameterized pagination.
- Persona registration for deterministic development identities.
- Application-owned optimistic projection.
- Explicit revision CAS for conflict settlement.
- A disconnected reducer attempt that never settled within the bounded probe.
- Several retained module-build, codegen, CLI SQL, migration-type, and npm
  lifecycle corrections.

### Outcome

The arm completed 11 PASS, two product GAPs, and one hosted dependency
unavailable result, with no Stop-class defect. Coordinator-adjusted evidence
confidence is 14/16 after the cleanup-probe downgrade.

### Would I choose it?

SpacetimeDB is compelling when authoritative realtime state, typed reducers,
and server serialization dominate. Missing full-text/offline paths,
parameterized-query glue, auth scaffolding, and incomplete hosted evidence
keep it from being my default general backend for this workload.

### Lessons for Snapback

Match the schema/functions-to-generated-types-to-live-reconciliation loop and
make conflict settlement equally observable. Beat the durable-page workaround
with a first-class parameterized query and stable cursor API. Add an
inspectable migration preflight that names fields, indexes, data preservation,
and client impact. Treat full-text search, deterministic development
principals, target identity, logs, export/rollback, and exact cleanup as normal
product surfaces. Snapback can surpass this result within its current
architecture if those workflows become native; this arm does not suggest a
fundamental architectural reset.

## 2026-07-28 — Appwrite 1.9.6, deep round

The arm used a fresh official self-host stack with Web SDK 26.2.0, Node SDK
27.1.0, and CLI 23.2.0. The production-shaped seed contained two
organizations, three teams, four projects, twenty labels, 500 issues, 1,000
issue-label rows, 1,000 comments, and 500 activity rows. Alice was owner, Bob
member, and Mallory outsider.

### What felt good

Appwrite's strongest result was native transaction conflict handling. Two
independent actor sessions staged updates to one issue in Appwrite
transactions. Exactly one committed and the loser received typed HTTP 409
`transaction_conflict`; no application revision emulation was needed.

Native full-text search was straightforward once the attribute and index were
ready. `Query.search` found the deterministic fixture through a committed
full-text index. Realtime also worked well: Bob's independent browser received
the new comment and activity through Appwrite's WebSocket transport, governed
by the same Team permissions as ordinary reads.

Auth and Teams gave a coherent owner/member/outsider model, cursor pagination
stayed stable under a newer insertion, and schema/index operations were
directly inspectable through the SDK.

### What felt bad or surprising

The local footprint is enormous for this application: 29 containers, 12 named
volumes, two networks, and about 2.9 GiB of Docker memory. An embedding
container used roughly 856 MiB even though the arm did not need embeddings.

The web installer's server-sent event stream ended with a socket error after
the generated stack was already healthy. Health and Compose-label probes
proved the target succeeded, but automation had to distinguish installer
transport failure from target failure.

Appwrite cannot index array attributes. The first label-index attempt failed
with `index_invalid`, so label filtering required an `issue_labels` junction
table and compound indexes. Issue detail similarly required several
application-authored point/indexed reads rather than an ergonomic bounded
composition.

Permissions are capable but verbose because row permission arrays and Team-role
strings must be repeated throughout provisioning. Attribute and index changes
are asynchronous and polled; the successful `customer_impact` backfill and
compound index were not one atomic migration.

Browser use required an exact Web platform hostname. The useful `Invalid
Origin` diagnostic appeared in server logs rather than at the application
boundary. CLI login/project state also required a worktree-local `HOME`
override, and the retained dependency tree reported 16 audit findings: three
low, six moderate, and seven high.

### Offline, hosted, and performance

Offline is an explicit product GAP. The Web SDK retained Auth, but not a
TablesDB cache or mutation queue. A warm mounted view kept 50 React-memory
rows; a cold offline reload had zero; an offline write was rejected; reconnect
refetched 50 unique authoritative rows.

No arm-owned Appwrite Cloud credential existed, so hosted deployment is
unavailable rather than inferred from self-hosting.

Two warmups plus seven local samples produced medians of 7.220 ms for indexed
list, 12.831 ms for composed detail, 6.436 ms for write, 18.975 ms for
realtime, 16.093 ms for reconnect/refetch, and 763.979 ms for production
build.

### Failed attempts and cleanup

Retained failures cover the installer stream, array-index limitation,
TypeScript view shape, missing Web platform, browser disconnected-navigation
handling, an optimistic-route harness error, and restored-session UI state.
The first two plus origin configuration are provider-relevant; the rest are
application/harness mistakes.

Cleanup removed only the exact Compose stack, installer, Vite process, and
worktree-local CLI/browser/runtime state. The coordinator verified the empty
baseline, target hash, closed ports `4324/8091/8491/20081`, and absence of all
exact-project containers, volumes, networks, and runtime paths.

### Outcome

The arm completed 12 PASS, one offline product GAP, and one hosted dependency
unavailable result, with direct 16/16 evidence confidence and no Stop defect.

### Would I choose it?

Appwrite is credible for a connected, conventional, self-hosted application
that values Auth, permissions, realtime, search, and transactions. It would
not be my default for a local-first Linear-style product: the offline gap and
operational weight outweigh its strong server-side feature set.

### Lessons for Snapback

Match native typed conflict results, full-text indexing, one role model across
reads/writes/realtime, explicit schema/index lifecycle, and inspectable push
settlement. Preserve Snapback's structural advantages: a lightweight local
runtime, retained reads and queued writes, worktree-local state by default,
indexed multi-value relationships without manual junction machinery, bounded
detail composition, and guided migrations. Surface origin/configuration errors
at the application boundary. This arm exposes meaningful authority and
production-tooling gaps, but not a need to replace Snapback's architecture.

## 2026-07-28 — InstantDB 1.0.52, deep round

The arm used `instant-cli init-without-files --temp` to create a real hosted,
disposable app without account setup. It built the full frozen tracker:
two organizations, three teams, four projects, 20 labels, 500 issues, 1,000
seed comments, activity, three native guest identities, indexed
filters/cursors, composed detail, optimistic edits, concurrent moves, live
comment/activity, browser offline retention and queueing, and indexed schema
evolution.

### What felt good

The disposable hosted-target flow was exceptional dogfood ergonomics: one
command produced an app-scoped admin credential and a documented expiry.
Schema-as-code and links kept the graph compact. Native guest auth, direct
client transactions, live InstaQL subscriptions, optimistic materialization,
and browser IndexedDB/offline queueing fit together with little application
glue.

The cold-browser result was particularly strong. A newly launched Chrome
process served 50 retained issues while three provider requests and one
WebSocket were blocked, accepted an optimistic queued edit, and settled it
after reconnect. Native realtime required no channel or publication setup.
Compared with Supabase, this took far less SQL/RLS/realtime/offline machinery.

### What felt bad or frustrating

Link permissions were the sharpest edge. A link mutation also changes reverse
link fields on the related entity, so assignee changes and comment/activity
creation required permissions on `$users.assignedIssues` and
`issues.comments/activities`. The diagnostic was only `Permission denied: not
perms-pass?` plus an entity, not the failing rule, direction, field, or binding.
Three safe over-restrictive iterations were retained.

There is no ordinary native full-text path in the pinned surface. Concurrent
whole-record writes converged cleanly under last-write-wins, but there is no
semantic revision/CAS policy; the application identifies the winner and
accepts service serialization.

The app-scoped temporary credential cannot inspect deployment logs, roll back,
or immediately delete the app. Cleanup zeroed all data and users, but schema
and permissions remain until the provider's documented automatic expiry after
more than 24 hours. CLI output and target credentials also required explicit
redaction wrappers.

The first offline harness closed the browser after queueing; that did not flush
the queued edit across a brand-new process. Keeping the cold-started client
alive through reconnect worked, which is an important boundary rather than a
reason to overclaim cross-process queue durability.

### Performance and evidence correction

With two warmups and seven retained samples, local-client/hosted medians were
107.9 ms list, 110.6 ms detail, 114.2 ms write, 168.5 ms realtime, 462.0 ms
reconnect, and 1,513.2 ms build.

The coordinator found that the delivered capsule used a non-frozen
`offline-reconnect` transport label and omitted required command intervals.
The generator now uses `local-optimistic` and clearly labeled coarse intervals
bounded by retained milestones. Raw browser, configuration, performance, and
cleanup receipts remain authoritative; no scenario or score changed.

### Outcome

The arm completed 12 PASS and two GAPs: no ordinary native full-text search,
and incomplete hosted operations for logs/rollback/immediate deletion. The
fresh target's data and users are all zero, Bob's token is invalid, local raw
credentials are removed, and provider-managed expiry remains disclosed.
Evidence confidence is 16/16 after the capsule-format correction.

### Would I choose it?

InstantDB sets a high bar for collaborative client ergonomics and is a strong
choice when live relational queries, optimism, and real offline behavior are
central. I would hesitate when semantic conflict policy, full-text search,
explainable permissions, and mature deployment operations dominate.

### Lessons for Snapback

Match the zero-account disposable hosted target, compact typed links/indexes
and schema diffs, and the unified live-query/optimistic/cache/outbox result.
Beat InstantDB with permission diagnostics that name the rule, link direction,
modified fields, and evaluated bindings; first-class revision/CAS and
board-rank primitives; ordinary full-text search; and one operational surface
for identity, config diff, logs, export/restore, rollback, and immediate
deletion.

## 2026-07-29 — Snapback final installed-package confirmation

The frozen Linear result stayed **10 PASS, 4 GAP, 0 FAIL** when rebuilt from
the immutable `0.1.1-llp0102.1` Darwin package closure in a clean external
project. Installed codegen, the packaged native runtime, session authority,
conflict behavior, native push, the React board, performance samples, and
exact cleanup all worked without repository imports or a source-binary
fallback.

The best part was that the runtime result did not change at the package
boundary. The worst new finding was concrete: `@snapback/client/online` is a
published export without TypeScript declarations, so the external React build
needed an ambient declaration. Installed `snapback start/stop` also required
an arm-local lifecycle wrapper for readiness, credentials, and cleanup.

The original 1,024-write ceiling, relational composition work, and the four
search/offline/migration/hosted gaps remain unchanged. This pass improves
confidence in distribution; it does not improve the arm's product score.

## 2026-07-29 — Firebase current-major refresh

The sealed arm and every original receipt remain unchanged. A fresh additive
project upgraded `firebase-admin` from 13.5.0 to 14.2.0 and
`firebase-functions` from 6.4.0 to 7.3.2. After the provider-order gate opened,
the isolated emulator target completed the frozen Linear suite with **12 PASS,
one explicit GAP, one unavailable remote dependency, zero FAIL, and no
Stop-class defect**.

The original arm already used Firebase's recommended modular entry points,
including v2 callable functions, so its business-function source needed no
migration. The client, UI, rules, indexes, and frozen assertions copied without
semantic changes. Both callables loaded under the declared Node.js 22 runtime,
and authority, conflict, push, offline queueing, migration, performance, and
cleanup all reproduced.

The upgrade still moved the Functions runtime declaration from Node 20 to 22,
pulled a substantial transitive lockfile change, and retained thirteen
`npm audit` findings, including seven high-severity paths whose advertised
fixes include incompatible downgrades. Those are operational evidence rather
than a reason to silently auto-fix.

Isolation exposed another hidden edge. The Functions emulator opened Eventarc
and Tasks listeners on default ports `9299` and `9499` even though they were
not in the requested service set. Exact cleanup proved ownership and no
collision, but I invalidated that run for the protocol and repeated the full
suite with Eventarc `61121` and Tasks `62121` explicitly assigned. The final
ten-port cleanup is exact.

Native full-text search remains a GAP, and hosted deploy remains unavailable
because hosted credentials were absent. The local major-version refresh is
strongly confirmed; it does not manufacture either missing product fact.
