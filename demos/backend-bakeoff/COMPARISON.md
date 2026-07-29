# Signal Desk: Snapback vs Convex vs Supabase

**Date:** 2026-07-28
**Scope:** one shared React incident-response app, three native backends
**Baseline ranking:** Convex first, Supabase second, Snapback third
**Final application-authoring ranking:** Convex first, Snapback second,
Supabase third

## Final result

Snapback moved from third to second for this application-authoring exercise.
The improvement program removed the largest product-loop defects in the
baseline: indexed text search, precise result types, colocated direct handlers,
versioned seeds, first-party React bindings, generated query groups, managed
presence, optimistic settlement, one-command comparator evidence, a
package-owned React/Vite starter, one `snapback dev` supervisor, exact runtime
doctoring, and a review-manifest-plus-cache generated-artifact model.

Convex remains first for reaching a working reactive application. Its schema,
functions, generated references, transactions, search, local deployment, and
React subscriptions still form the smallest coherent mental model.

Supabase remains first for database and operational maturity. Postgres
constraints, foreign keys, SQL, full-text search, migrations, backup tooling,
and an ordinary hosted endpoint are capabilities neither competitor matches as
a complete product. That strength comes with the most cross-surface
coordination in this app: DDL, RLS, grants, security-definer functions,
publication membership, Realtime channels, and client normalization.

There is deliberately no context-free production ranking:

- For building this scoped React app, the final order is Convex, Snapback,
  Supabase.
- For operating a hosted production backend today, the order is Supabase,
  Convex, Snapback.

Snapback's hosted lifecycle and hosted ephemeral state remain explicit GAPs.
All seventeen packaged lifecycle operations currently refuse before provider
or credential work with `SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE`.

## Evidence and review chain

The final aggregate receipt is
[`backend-bakeoff-run.43d6c570f7f3f752f61ca545a1d81ef1a1a6b3b4d34fbe0066a6becc95d3d989.v2.json`](./acceptance/results/backend-bakeoff-run.43d6c570f7f3f752f61ca545a1d81ef1a1a6b3b4d34fbe0066a6becc95d3d989.v2.json).
It binds one clean source revision, `f789a143`, and records eight of eight
required commands passing with zero timeouts and all child evidence valid:

1. shared Contract inventory;
2. Snapback comparator;
3. Snapback app-specific extras;
4. React presence and generated-query-group receipts;
5. Convex integration;
6. Supabase integration;
7. TypeScript;
8. production build.

The Convex log proves a nonce-bearing comment traveled from an actor client to
a distinct observer client after the observer's initial subscription snapshot.
Cleanup is bounded and both transports close even if deletion fails.

The Supabase log is useful product evidence rather than hidden flakiness. Its
first native Realtime delivery attempt timed out; the one permitted retry used
a fresh client, socket, channel, and witness and passed. Both attempts and
their phase timestamps are retained. The check uses an exact client-side
incident-and-nonce predicate rather than a server-side Realtime filter.

The first official aggregate is also retained:
[`backend-bakeoff-run.87f231220e684164ec23a3d48a8b646cc141483205dc52d23597f2fd33f5d557.v2.json`](./acceptance/results/backend-bakeoff-run.87f231220e684164ec23a3d48a8b646cc141483205dc52d23597f2fd33f5d557.v2.json).
It honestly failed seven of eight because a shared eight-second Supabase timer
expired. Fable 5 reviews of the failed and green checkpoints are retained under
[`acceptance/reviews/`](./acceptance/reviews/). Those reviews found the
Supabase timer defect, a vacuous stale-witness hole in the original Convex
check, and the need to narrate the final comparison from the retained matrix.
An integrated adversarial review additionally caught the single-client Convex
claim mismatch before the final receipt.

This matrix is functional evidence, not a throughput, latency, cost, scale,
security, or visual-quality benchmark. It does not claim hosted Snapback
parity or public-package/browser qualification. Package qualification has a
separate staged clean-install and real-Chromium evidence gate.

## What was held constant

Every backend supports the same product contract:

1. list, create, search, and change status for incidents;
2. add and optimistically complete tasks;
3. add field notes and deliver cross-client updates;
4. commit the primary change and an activity record atomically;
5. derive a handoff brief from incidents, tasks, and comments;
6. show live viewers;
7. start from equivalent deterministic sample data.

The shared React component knows only `BackendAdapter`; backend-specific code
lives in `src/backends/`. Demo personas intentionally replace product auth, so
auth is not ranked.

## Native implementation comparison

| Area | Snapback | Convex | Supabase |
|---|---|---|---|
| Schema | JavaScript declarations, indexes, search, protected relation state, ephemeral collection | TypeScript schema, indexes, search index | SQL DDL, constraints, foreign keys, generated `tsvector`, GIN |
| Server logic | Declarative plans plus colocated bounded JS handlers | Colocated TypeScript query/mutation handlers | SQL/PLpgSQL functions and grants |
| Transactions | Mutation plan or handler commits one validated read/write set | Mutation is atomic by default | One RPC function owns the transaction |
| Durable realtime | Generated live queries and registered query-group boot over native WebSocket | Reactive query subscriptions | Postgres Changes event followed by application refetch |
| Presence | TTL/disconnect ephemeral collection outside durable storage | Durable table, heartbeat, leave, expiry filtering, cleanup | Realtime Presence channel |
| Search | Indexed `full_text_search_v1`, typed page, ranking/highlights/cursor | Declared search index | Native Postgres full-text search |
| React | First-party provider, typed query/group hooks, presence, optimistic settlement | First-party reactive hooks | First-party client primitives; app owns aggregate reload and normalization |
| Client typing | Generated args and precise result contracts across headless, React, and Contract | Strong end-to-end inferred types | Table generation available; RPC and normalization remained manual here |
| Seed evolution | Content-addressed versioned preview/install/reset/clear | Idempotent application seed mutation | SQL migration plus `on conflict` seed |
| Local loop | `snapback dev`, runtime identity recovery, codegen/load/seed supervision, React/Vite starter | Anonymous local deployment and one watched dev process | Full local stack requires Docker-compatible infrastructure; this run used hosted |
| Evidence | Closed comparator, React receipts, manifests, redacted aggregate logs | Native cross-client integration log | Native hosted integration log |

Authored line counts are descriptive, not a score:

| Backend | Backend definition and seed | React adapter |
|---|---:|---:|
| Snapback | 657 lines + 122-line seed | 266 |
| Convex | 475 lines | 152 |
| Supabase | 328 lines SQL | 203 |

Snapback now commits one generated review manifest for this app. The other 77
generated files are a regenerable ignored cache. Its summary reports four
tables, twenty operations, ten live queries, one ephemeral collection, ten
seed rows, zero degraded result types, and two warnings.

The larger Snapback source is partly the price of exercising the new
experimental relation/activity profiles alongside the ordinary product path.
Those profiles have positive contributor-source evidence but remain withheld
from public-package capability publication.

## Rankings by dimension

| Dimension | 1st | 2nd | 3rd | Why |
|---|---|---|---|---|
| First working reactive app | Convex | Snapback | Supabase | Convex remains the tightest loop; Snapback now has one supervisor and starter; Supabase spans SQL, policy, publication, and client surfaces |
| Data modeling and query power | Supabase | Convex | Snapback | Postgres remains unmatched; Snapback search is now strong, but general relational helpers are experimental |
| Durable realtime authoring | Convex | Snapback | Supabase | Convex subscriptions are direct; Snapback query groups now own one-cut boot and cleanup; Supabase events require refetch/recovery design |
| Ephemeral presence | Snapback | Supabase | Convex | Snapback gives TTL/disconnect semantics without durable writes; Supabase has native Presence |
| Transaction ergonomics | Convex | Snapback | Supabase | Convex and Snapback make application transactions ordinary; Supabase required explicit RPC/privilege boundaries |
| Type continuity | Convex | Snapback | Supabase | Snapback closed its arbitrary-result gap; Supabase RPC boundaries stayed manual here |
| React lifecycle | Convex | Snapback | Supabase | Snapback now owns Strict Mode, query-group adoption, optimistic rebase, presence, and zero-resource teardown |
| Inspectability and claim honesty | Snapback | Supabase | Convex | Snapback binds target facts, artifacts, package bytes, runtime identity, nonclaims, and receipts |
| Local agent loop | Convex | Snapback | Supabase | Convex local remains simplest; Snapback's supervisor/doctor recovery is now coherent; Supabase local was unavailable here |
| Operational maturity | Supabase | Convex | Snapback | Snapback still has no supported ordinary hosted lifecycle |
| Open deployment/data posture | Supabase | Snapback | Convex | Postgres has the broadest ecosystem; Snapback keeps an inspectable local runtime; Convex is more vertically integrated |

## Backend-specific synthesis

### Snapback

What improved:

- Indexed text search replaced the JavaScript scan and preserves a generated,
  nominal search page through the client.
- Direct JS operations colocate handlers, args, result contracts, and
  read/write ceilings. Generated result degradation is zero.
- The first-party React provider owns typed grouped queries, native live
  delivery, optimistic rebase/rollback, managed ephemeral presence, auth
  barriers, Strict Mode/HMR replacement, SSR zero demand, and exact teardown.
- The versioned seed flow separates preview, non-destructive matching,
  reset-install, and clear.
- `snapback dev` now handles sessions startup artifacts and reports exact
  binary/artifact identity mismatch with recovery guidance.
- Bootstrap and doctor use a real link-and-launch smoke test against the
  selected runtime instead of stopping at a healthy-looking checkout.
- One review manifest and an author-facing summary preserve inspectability
  without committing the full generated cache.
- The package-owned comparator turns cross-client live delivery, atomicity,
  rollback, presence expiry/disconnect, and durable-version separation into
  one command.

What remains weaker:

- Convex still reaches the first reactive screen with fewer concepts and less
  generated/evidence ceremony.
- Supabase/Postgres still has much broader relational and operational depth.
- `bounded_children_v1` and `write_activity_v1` remain experimental and are
  intentionally withheld from public-package capability claims.
- Hosted deployment, migrations, backup/restore, rollback, logs, cost, and
  hosted ephemeral state remain GAPs.
- The staged browser proof can bound proof-owned transformations after host
  returns, but cannot bound Chromium-internal buffers, already materialized CDP
  events, or nine exact browser collection results before their host calls
  return. The receipt binds those nonclaims.

### Convex

What worked:

- Schema, functions, generated references, transactions, search, and reactive
  queries stayed in one TypeScript-centered model.
- The final test proves a new nonce-bound comment crossed from one client to a
  distinct observer client after subscription readiness.
- The local backend watched and deployed edits without Docker.

What remained awkward:

- The discoverable CLI path still preferred interactive configuration; the
  agent-safe path used `CONVEX_AGENT_MODE=anonymous`.
- First startup downloaded backend/dashboard components.
- Presence required durable rows, heartbeats, leave handling, expiry filters,
  and stale-row cleanup.
- The cohesive DX comes with a more vertically integrated deployment/data
  posture.

### Supabase

What worked:

- Postgres constraints, foreign keys, cascades, generated search documents,
  GIN indexing, and SQL transactions were explicit and familiar.
- Realtime Presence fits non-durable viewers well.
- The configured hosted project gave the app a reachable public client.

What remained awkward:

- Safe public writes required coordinated RLS, grants, security-definer
  functions, helper revocation, and publication membership.
- Postgres Changes communicates events, not the complete application query;
  the adapter coalesces events and reloads all four tables.
- The final native delivery needed its one permitted fresh-transport retry.
  That is honest evidence for the need to design reconnect and missed-event
  recovery rather than assume every event arrives on the first channel.
- RPC and normalized application types were manual in this demo.

## Improvement-program disposition

| # | Improvement | Final disposition |
|---:|---|---|
| 1 | Installable React starter | Implemented locally; package publication is separately qualified |
| 2 | One `snapback dev` supervisor | Implemented |
| 3 | Exact doctor link/runtime smoke | Implemented |
| 4 | First-class runtime/artifact mismatch | Implemented |
| 5 | First-party React/provider/presence/optimistic surface | Implemented with 10/10 receipt |
| 6 | Precise handler result types | Implemented; zero degraded results |
| 7 | Colocated declaration/implementation | Implemented for bounded direct JS handlers |
| 8 | Typed aggregate query subscription/cache | Implemented as generated query groups and registered boot |
| 9 | Indexed text search | Implemented for the local SQLite target |
| 10 | Relation/activity helpers | Contributor-source implementation complete; public-package and cross-target evidence remain open |
| 11 | Versioned seed evolution | Implemented |
| 12 | Review manifest plus ignored cache | Implemented |
| 13 | Author-facing codegen summary | Implemented |
| 14 | Comparator-grade acceptance helper | Implemented and retained |
| 15 | Supported hosted product loop | Open; lifecycle carrier/custody and remote qualification remain |
| 16 | Hosted ephemeral semantic parity | Open; capability remains false |

## Final evidence snapshot

- Aggregate matrix: 8/8 commands, zero timeouts, all required child evidence
  valid.
- Snapback comparator: 6/6 mandatory properties.
- Snapback React presence: 10/10 with zero skips.
- Generated query group: 3/3 plus retained receipt verification.
- Convex: nonce-bound cross-client native delivery, transaction, search,
  derived brief, and complete acceptance-incident cleanup.
- Supabase: transaction RPC, native delivery after one recorded
  fresh-transport retry, search, derived brief, and cascade cleanup.
- TypeScript and the production build passed.
- Production build: 193 modules; chunk sizes are retained only as build
  evidence and are not a backend-size ranking.
