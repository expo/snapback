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
