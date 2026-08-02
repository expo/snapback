# Diary 0042: Triage Graph — Snapback/Zero bakeoff

**Application:** A1 Triage Graph, paired Snapback and Zero arms  
**Date:** 2026-08-01  
**Code:** `demos/zero-bakeoff/apps/triage-graph`  
**Plan:** LLP 0138  
**Systems:** Relational queries, partial sync, live queries, auth, React, acceptance testing

## What was built

Both arms implement the same deterministic 10,000-issue inbox: five
organizations, fifty teams, 250 projects, users and memberships, labels,
many-to-many issue labels, comments, and activity. The shared fixture contains
facts only. Snapback uses its schema/functions/codegen/live-query surfaces;
Zero uses a Zero schema, ZQL query definitions and relations, custom mutators,
PostgreSQL 17, and `zero-cache-dev`. The React files are intentionally small
projections of each provider's native query state.

## Chronology and immutable first attempt

1. I froze the A1 acceptance IDs before either arm: membership, relationship
   composition, filter composition, keyset pagination, matching and
   nonmatching live changes, filter switching, completeness, and outsider
   denial.
2. The Snapback implementation passed all nine checks on its first complete
   full-fixture run.
3. The first Zero run exposed two harness defects, not provider defects: the
   mutation writer was an actor without access to the nonmatching half of a
   batch, and a synchronously-completing listener called a removal closure
   before its `const` initialization. I retained those facts here, fixed the
   actor and listener wiring, and reran the unchanged acceptance contract.
4. An interrupted early Zero run also left a per-run database/process behind.
   The runtime cleanup was strengthened to terminate exact-database sessions,
   drop the replication slot and database, and kill its owned process group.
   The retained final receipt proves cleanup green.

No API key or hosted service was needed. There was no human assistance beyond
the program brief and no cross-provider backend abstraction.

## Evidence

Both retained receipts execute 9/9 checks with **9 PASS, 0 GAP, 0 FAIL** and
green cleanup.

- Snapback: 50-row bounded inbox; composed relationship/detail checks passed;
  matching stream update 97.7 ms; ten sequential filter switches 961.2 ms;
  outsider received zero rows. Target was a dirty debug Ibex/SQLite source
  binary, recorded in the receipt.
- Zero 1.8.0: the same facts passed; matching update 54.6 ms; ten filter
  switches 470.2 ms; completeness visibly transitioned through `unknown` to
  `complete`; outsider received zero rows. Storage was local PostgreSQL 17 plus
  `zero-cache-dev` with a memory client store.

These are local acceptance timings, not production benchmarks or browser paint
measurements. They are still directionally useful because the fixture,
process, machine, and checks were held constant.

## Authoring and source cost

For the product-facing implementation (excluding fixture, acceptance, generated
artifacts, and README), Snapback is 162 lines across schema, functions, and
React. Zero is 143 lines across schema, ZQL queries, mutators, and React, plus
178 lines of local PostgreSQL/endpoint/`zero-cache` runtime ownership. The
acceptance carriers are 131 Snapback lines and 136 Zero lines. These counts are
context, not a quality score: Zero's runtime would normally be shared across
apps, while Snapback's server helper already exists in the repository kit.

## What felt good

### Snapback

- One server and one generated bundle were enough. Schema install, function
  install, reset, mutation, query, and stream subscription all used the same
  client and the kit provided strong provenance and cleanup diagnostics.
- The initial live result is an authoritative current snapshot; it avoided an
  application-level unknown/complete state machine for this route.
- Generated references and result validators made the handler boundary
  explicit, and access checks lived next to the server query.

### Zero

- Relations are the standout. `related(...)`, `whereExists(...)`, and ZQL
  predicates express project, assignee, labels, comments, and activity as one
  composable query rather than an application-written join loop.
- Optional filters and keyset predicates compose naturally and remain readable.
  Zero was roughly twice as fast in the local ten-filter sequence.
- Completeness is a first-class observable state. The acceptance could record
  `unknown → complete` rather than infer it.
- The native client inspector makes row custody testable instead of anecdotal.

## What felt bad or surprising

### Snapback

- The relation-heavy handler is manual. It collects issues, then performs
  project, assignee, join-table, label, and count lookups itself. The resulting
  N+1 shape is longer, easier to get subtly wrong, and leaves optimization to
  application code even though this is exactly the domain Zero's query language
  treats as ordinary.
- Filters over the manually composed label relation cannot be pushed into one
  native relation plan. The guide accurately documents the current two-source
  composition limitation, so this was product friction, not a missing-guide
  discovery.
- Completeness is simpler for a fresh authoritative snapshot but less explicit
  as an independent axis than Zero's result state.
- Codegen completed, but nested labels/comments/activity and generic seed rows
  deliberately use JSON validators, so it emitted five degraded-type warnings.
  A fully typed relation result should not force authors to choose between
  verbose hand-written nested validators and `unknown` generated consumers.

### Zero

- Local operation is substantially wider: PostgreSQL logical replication,
  publication/slot state, query and mutate HTTP endpoints, `zero-cache`, client
  identities, and exact cleanup all have to agree. The provider query was
  elegant; the self-contained test runtime was the largest source file.
- Query listeners can complete synchronously from local state. That is useful,
  but it makes listener lifecycle code surprisingly easy to write incorrectly.
- The headless carrier uses memory rather than browser IndexedDB, so this arm
  does not make browser persistence or offline-restart claims.

## Initial verdict

For a relation-rich issue inbox, **Zero is better at the central job**. Its
query language maps directly onto the mental model, composes filters without
manual orchestration, exposes completeness and custody, and was faster in this
local run. Snapback is better operationally: fewer moving parts, clearer
single-runtime provenance, and a strong server-managed authorization boundary.

The highest-value Snapback improvement is a first-class typed relation query
plan that can push filters, bounded nested collections, counts, and keyset
pagination into one live operation. It should preserve Snapback's generated
contracts and authorization model while adding explicit completeness and
inspectable client custody. Merely adding a helper around the existing N+1
handler would not close the gap.

## Receipts

- `demos/zero-bakeoff/apps/triage-graph/evidence/snapback.v1.json`
- `demos/zero-bakeoff/apps/triage-graph/evidence/zero.v1.json`
