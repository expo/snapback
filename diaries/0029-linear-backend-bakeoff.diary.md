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
