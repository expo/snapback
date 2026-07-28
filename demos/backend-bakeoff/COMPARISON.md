# Signal Desk: Snapback vs Convex vs Supabase

**Date:** 2026-07-27  
**Scope:** one shared React incident-response app, three native backends  
**Baseline verdict:** Convex first, Supabase second, Snapback third before the
improvement program below

## Post-improvement React receipt

The original narrative below is retained as the bakeoff baseline. Its claims
that Snapback has no first-party React presence/optimistic surface and needs
application-owned subscription/heartbeat/rollback glue are superseded.
Signal Desk now uses one prepared `@snapback/react` provider, one typed
four-query group, generated result contracts, provider-owned managed presence,
and result-validated optimistic mutation rebase/rollback.

The targeted rerun is retained at
`acceptance/results/react-presence.v1.json`: all ten required checks passed
with zero skips, including two independent native WebSocket clients, TTL
expiry, disconnect deletion before half the TTL, no durable-version advance,
rollback over newer authority, both matcher orderings, SSR zero demand, hosted
no-work refusal, and exact provider/client/server cleanup. Package tests,
TypeScript, and the production build pass. This improves Snapback's React and
presence position materially; it does not erase the baseline's hosted-product
and first-hour dev-loop disadvantages. The full three-backend rerun later in
this program owns the final revised ranking.

## Executive result

Convex produced the best end-to-end application-authoring loop. Its generated
function references, transaction-by-default mutations, search index, and
reactive client form one compact mental model. The main mismatch was presence:
without a separate ephemeral primitive in this implementation, presence became
a durable table plus heartbeat, expiry, and cleanup logic.

Supabase was the strongest database and operations product. Postgres constraints,
foreign keys, GIN full-text search, SQL functions, Realtime Presence, and a
managed endpoint were all capable. It also demanded the most cross-surface
coordination: migration SQL, RLS, grants, security-definer RPCs, publication
membership, Postgres Changes subscriptions, and client-side refetch/coalescing.

Snapback had the best presence semantics and strongest locally inspectable
evidence. A TTL-bounded ephemeral collection did exactly what presence needs
without touching durable storage, while generated artifacts described the app
and its limits. The product loop was the least competitive: repository-relative
authoring helpers, a separate declaration/handler split, a large committed
generated tree, no first-party React hook surface used by this app, and a local
runtime rebuild failure that the doctor reported as healthy.

This ranking is qualitative and demo-specific. It is not a latency, scale, cost,
security, or formal timed benchmark. Existing familiarity with Snapback and an
already configured hosted Supabase project also make raw setup time unfair, so
the evidence emphasizes observable steps and code shape.

## What was held constant

Every backend supports the same product contract:

1. list, create, search, and change status for incidents;
2. add and optimistically complete tasks;
3. add field notes and stream cross-client updates;
4. commit the primary change and an activity record atomically;
5. produce a server-derived handoff brief from incidents, tasks, and comments;
6. show live viewers;
7. start from equivalent deterministic sample data.

The shared React component knows only `BackendAdapter`. Backend-specific client
code lives in `src/backends/`. Demo personas intentionally replace auth, so auth
is not scored.

## Native implementation comparison

| Area | Snapback | Convex | Supabase |
|---|---|---|---|
| Schema | JS declaration, indexes, ephemeral declaration | TypeScript schema, indexes, search index | SQL DDL, constraints, FKs, generated `tsvector`, GIN |
| Server logic | operation declarations plus separate JS handlers | colocated TypeScript query/mutation handlers | SQL/PLpgSQL functions and grants |
| Transactions | mutation handler is atomic across declared tables | mutation is atomic by default | one RPC function owns the transaction |
| Durable realtime | generated live queries over native WebSocket | reactive query subscriptions | Postgres Changes events followed by refetch |
| Presence | purpose-built TTL ephemeral collection | durable presence table, heartbeat, stale-row cleanup | Realtime Presence channel |
| Search | JS scan and filter in this app | declared search index | native Postgres full-text search |
| Derived read | JS query handler | TypeScript query | SQL function |
| Client typing | generated API exists, but arbitrary JS results degrade | strongest end-to-end inferred types | generated DB types were not added; RPC strings and normalization are manual |
| Local setup | bootstrap/codegen/server/provision | anonymous local deployment and one dev process | Docker-based local stack unavailable here; used configured hosted project |
| Evidence | most explicit manifest and six-check native suite | native-client integration suite | native-client integration suite |

Authored backend and adapter line counts are descriptive, not a quality score:

| Backend | Backend definition | React adapter | Generated files committed |
|---|---:|---:|---:|
| Snapback | 367 lines + 97-line seed | 158 | 58 files / 162 KB |
| Convex | 444 lines | 152 | 5 files / 12 KB |
| Supabase | 328 lines SQL | 203 | none in this demo |

Snapback's definition count excludes generated output but includes the separate
function declarations and handlers. Supabase's SQL is dense and carries
database/security concerns that the other runtimes supply as platform defaults.
Convex's count includes seed data and durable-presence machinery.

## Rankings by dimension

| Dimension | 1st | 2nd | 3rd | Why |
|---|---|---|---|---|
| First working reactive app | Convex | Supabase | Snapback | Convex has the shortest coherent dev loop; Snapback needed bootstrap, codegen, provision, and custom React glue |
| Data modeling and query power | Supabase | Convex | Snapback | Postgres constraints, joins, indexes, and FTS are unmatched; Snapback search fell back to a scan |
| Durable realtime authoring | Convex | Snapback | Supabase | Convex subscriptions are direct; Snapback live queries are solid; Supabase events require refetch and race handling |
| Ephemeral presence | Snapback | Supabase | Convex | Snapback gives TTL/disconnect semantics without durable writes; Supabase has a native presence service |
| Transaction ergonomics | Convex | Snapback | Supabase | Convex and Snapback make application mutations atomic; Supabase required RPC boundaries and privilege work |
| Type continuity | Convex | Snapback | Supabase | Convex preserves handler/client inference; Snapback argument types are strong but arbitrary handler results degrade |
| Inspectability and claim honesty | Snapback | Supabase | Convex | Snapback emits capability/artifact manifests and explicit acceptance claims |
| Operational maturity | Supabase | Convex | Snapback | Supabase and Convex already provide supported hosted workflows; Snapback remains local-first in this comparison |
| Open deployment/data posture | Supabase | Snapback | Convex | Postgres/Supabase has the broadest ecosystem; Snapback is locally inspectable; Convex's product is more vertically integrated |

## Backend-specific diary synthesis

### Snapback

What worked well:

- The ephemeral collection was the cleanest implementation in the bake-off.
  Presence publish, TTL, fan-out, and disconnect cleanup stayed outside SQLite;
  acceptance proved a publish did not advance the durable storage version.
- Multi-table JS mutations read naturally and committed task/activity changes
  together. Declared read/write sets make the authority footprint inspectable.
- JS operations now colocate one direct, self-contained handler with their
  arguments, precise result contract, and authority ceilings. Signal Desk no
  longer carries a parallel `handlers.mjs` registry or repeats source/export
  wiring.
- Generated references preserve precise query-record and mutation/action
  result shapes through the headless client, Contract, grouped queries, and
  React hooks; the adapter does not need casts or caller-supplied result
  generics.
- The generated capability, schema, function, provider, operation, and Contract
  artifacts make the build unusually reviewable.
- Native live delivery and failure behavior were easy to assert with the shared
  acceptance harness.

What hurt:

- Local development still uses `file:` dependencies as the monorepo fixture
  install mechanism, but authoring, browser, Vite, tests, and comparator now
  consume only the installed `@snapback/*` package surface and `snapback` bin.
- Codegen emitted 58 files for a 14-operation app. The extra artifacts are
  useful to downstream systems, but they dominate Git review and make it hard
  to see what a React author actually needs.
- There is no indexed text-search authoring primitive comparable to Convex's
  search index or Postgres FTS; this implementation scans incidents in JS.
- The browser setup still required hand-authored subscription aggregation and
  cleanup. A first-party `SnapbackProvider`, `useQuery`, and `useMutation`
  starter should own this lifecycle.
- The bootstrap-validated binary was runnable, but a later dirty-checkout build
  failed to link three Snapback compatibility symbols. `scripts/ibex-doctor`
  reported healthy. The acceptance suite passed only by explicitly selecting
  the older validated binary and honestly reporting a stamp mismatch.

### Convex

What worked well:

- Schema, query, and mutation authoring stayed in TypeScript with generated
  references consumed directly by the browser.
- Reactive queries required no separate invalidation protocol. A second client
  saw the inserted comment through the native subscription.
- Multi-table mutations were naturally atomic, and indexed search was concise.
- The local backend started without Docker. Once configured, edits were
  regenerated and deployed automatically.

What hurt:

- `convex dev --configure new --once` still entered an interactive login path.
  The agent-safe path was the less discoverable
  `CONVEX_AGENT_MODE=anonymous convex dev --once`.
- Local startup downloaded both the backend and dashboard, adding an opaque
  first-run step.
- Presence was not naturally ephemeral in this implementation. It required a
  table, connection IDs, heartbeats, time filtering, explicit leave, and stale
  row deletion. That adds writes and cleanup work for non-durable state.
- The backend is exceptionally cohesive because more deployment and runtime
  choices are coupled to the Convex platform; that is both its DX advantage
  and its portability tradeoff.

### Supabase

What worked well:

- Postgres was excellent for relational integrity and search: check constraints,
  foreign keys, cascades, generated search documents, and a GIN index were
  explicit and familiar.
- SQL functions gave atomic mutation-plus-activity behavior.
- Realtime Presence was a good fit and needed no durable presence rows.
- The hosted project exposed a public client immediately, and native
  Postgres Changes delivery passed.

What hurt:

- The local CLI path depends on a Docker-compatible runtime, which was absent
  on this machine, so the comparison used an existing hosted project.
- Safe public writes required coordinating RLS, table grants,
  `SECURITY DEFINER`, function grants, helper-function revocation, validation,
  and Realtime publication membership. Missing one item can produce either a
  confusing denial or an authority bug.
- Postgres Changes communicates row events, not the complete application query.
  The adapter debounces and reloads all four tables after any event. Production
  code would need tighter filters, pagination, missed-event recovery, and
  careful initial-snapshot/subscription ordering.
- RPC and database result types were manual in this demo. Supabase type
  generation would help tables, but the application still needs a designed
  RPC/client boundary.

## Concrete ways to improve Snapback

### P0 — make the successful path boring

1. Ship a `create-snapback-app` React template that installs published packages,
   starts one local process, provisions on file change, seeds once, and renders
   a generated query without repository-relative imports.
2. Add one `snapback dev` supervisor for bootstrap diagnostics, codegen watch,
   runtime start, app registration, stable port discovery, logs, and Vite env
   injection. The normal app author should not coordinate five layers.
3. Make the doctor execute a tiny runtime/link smoke test against the exact
   binary Cargo will use. It must detect missing Hermes compatibility symbols
   instead of declaring the toolchain healthy.
4. Treat binary identity mismatch as a first-class dev message: name the
   runnable binary, expected checkout, why rebuild was skipped/failed, and the
   exact safe recovery or explicit override.

### P1 — close the React and typing gap

5. Publish and document `SnapbackProvider`, `useSnapbackQuery`,
   `useSnapbackMutation`, `useSnapbackPresence`, connection state, and optimistic
   rollback. Hooks should own Strict Mode-safe async subscription cleanup.
6. Generate precise result types for JS handlers. Let authors declare a result
   validator or infer from a typed handler; never make ordinary query consumers
   cast the generated API to `Record<string, unknown>`.
7. Colocate declaration and implementation:

   ```ts
   export const addTask = mutation({
     args: { incidentId: v.id("incidents"), body: v.string() },
     reads: ["incidents", "tasks"],
     writes: ["incidents", "tasks", "activity"],
     handler: async (ctx, args) => { /* ... */ },
   });
   ```

   Preserve explicit read/write authority while removing `source`,
   `exportName`, duplicate exports, and global handler registration.
8. Generate a typed aggregate subscription or normalized cache so four related
   live queries do not require hand-built snapshot assembly in every React app.

### P1 — improve everyday data capability

9. Add an indexed text-search primitive with a generated capability declaration,
   deterministic local implementation, pagination, ranking, and a clear hosted
   portability contract.
10. Add relation-aware helpers for common parent/child reads and atomic
    write-plus-activity patterns without hiding transaction boundaries.
11. Make seed evolution idempotent and explicit (`seedVersion` or migration
    identity) so browser setup never ambiguously resets or silently preserves
    old data.

### P2 — keep evidence, reduce its tax

12. Keep the rich artifact graph, but generate it into one reviewable manifest
    plus an ignored cache by default. Commit only artifacts required by external
    consumers or CI policy.
13. Summarize codegen in author terms: “4 tables, 14 operations, 4 live, 1
    ephemeral; 3 result types degraded,” with direct links and remediation.
14. Provide a comparator-grade acceptance helper for native cross-client live
    delivery, atomicity, rejected-mutation rollback, TTL/disconnect presence,
    and durable-version separation. Snapback's evidence discipline is a real
    differentiator; make it one command for ordinary apps.

### P2 — turn local strengths into a deployable product

15. Deliver a supported hosted path with one URL, identity, logs, inspection,
    migrations, backup/restore, rollback, and cost visibility. Artifact honesty
    cannot compensate for a missing ordinary deployment loop.
16. Preserve the local/open runtime and ephemeral semantics across hosted
    adapters. Those are the clearest reasons to choose Snapback over the more
    mature alternatives.

## Evidence from this run

- Snapback acceptance: 6/6, including atomic multi-table mutation, native
  cross-client live delivery, backend search/brief, ephemeral/durable
  separation, and rejection without state change.
- Convex integration: seed, transaction, native live update, search, and brief
  passed against a local deployment.
- Supabase integration: transaction RPC, native Realtime update, search, and
  brief passed against the configured hosted project.
- Shared contract inventory, TypeScript checking, and Vite production build
  passed.
- Production build: 182 modules, 508 KB output. Chunk sizes are recorded only
  as build evidence; shared dependency splitting makes them an invalid backend
  size ranking.
- The in-app browser controller failed during its own module initialization
  before a browser session could be created. No visual or browser-interaction
  pass is claimed; native-client tests and HTTP/build checks are the executable
  evidence for this run.

## Current vendor documentation checked

- Convex documents local deployments as a beta, account-optional workflow in
  which `convex dev` owns the local backend process and generated types:
  <https://docs.convex.dev/cli/local-deployments> and
  <https://docs.convex.dev/understanding/workflow>.
- Convex documents a self-hostable backend under the FSL Apache 2.0 license:
  <https://docs.convex.dev/self-hosting>.
- Supabase documents that its full local stack runs in Docker-compatible
  containers and that migrations/config/seed belong in the repository:
  <https://supabase.com/docs/guides/local-development/cli/getting-started> and
  <https://supabase.com/docs/guides/local-development/cli-workflows>.
- Supabase's native surfaces used here are Postgres Changes and Realtime
  Presence: <https://supabase.com/docs/guides/realtime/postgres-changes> and
  <https://supabase.com/docs/guides/realtime/presence>.
