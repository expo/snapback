# Diary 0050: PocketBase × Snapback public-npm bakeoff

**Demo:** `demos/pocketbase-snapback-bakeoff/`  
**Date:** 2026-08-01  
**Systems:** Competitive evaluation, React, Auth, Realtime, Ephemeral state, Assets, Search, Actions, Cron, Developer experience  
**Author:** Codex  
**Related:** LLP 0000, LLP 0016, LLP 0102, LLP 0137, issue `20260801-0137-a1-packaged-asset-client-cannot-authenticate-sessions.md`

## Contract and evidence posture

I built two separate React incident-room apps with the same product facts but
provider-native backends. Both exercise authenticated actors, two authorized
members plus an outsider, related rooms/incidents/messages/activity, indexed
search, realtime cross-client message delivery, server-derived authorship, a
transactional acknowledgement plus activity append, file upload/delivery,
presence, and scheduled cleanup/maintenance.

Snapback was consumed only through public npm packages pinned exactly to
0.1.8, including `@expo/snapback-vite`; no workspace import or checkout binary
is used. PocketBase uses the official 0.39.9 macOS ARM64 binary and public npm
SDK 0.27.0. Both npm audits are clean. The measurements are local acceptance
timings, not hosted latency or throughput claims.

## 2026-08-01 — PocketBase, PASS (6/6)

### Environment and milestones

- Vite scaffold: 7.67 s.
- npm install: 8.78 s for the starter plus 0.96 s for PocketBase/EventSource;
  79-package resolved tree, 93.9 MiB, zero audit findings.
- Official server binary: 0.39.9, 30 MiB on disk.
- Successful migration after the failed attempts: 0.31 s.
- Final React build: 2.50 s; final acceptance: 0.38 s.
- Approximate provider-specific active interval: 8 minutes.
- Final bundle: 231.6 kB JS (71.2 kB gzip).

### What felt good

The happy path is unusually compact. Auth/password login, relation fields,
record CRUD, API filtering, protected file upload, SSE subscriptions, custom
routes, transactions, cron registration, and a useful admin dashboard all come
from one portable binary. The SDK is direct and unsurprising: collection,
filter, subscribe, upload a `File`, and call a custom route. Cross-client SSE
delivery took 5–6 ms locally; the transactional route updated the incident and
inserted activity in 3–4 ms; protected upload and token-backed download took
4 ms in the final run.

API rules being both authorization and read filters is a good small-backend
idea. Mallory simply receives no incident rows while Ada and Grace see the
same room. Hooks made it easy to overwrite spoofed `author` and `kind` fields
with server-derived values. The file field handled multipart upload, storage,
record attachment, token issuance, download, and record-coupled deletion with
almost no application glue.

### What felt bad or surprising

The versioned migration was by far the widest source file and the least
statically safe part of the arm. Four product-facing mistakes made it to
runtime:

1. Current 0.39.9 pre-creates `users`, while the official migration example's
   natural shape is to create an auth collection. The first migration failed
   on the duplicate name.
2. `new Collection({...})` did not install `created`/`updated` fields despite
   the current docs saying missing default fields are merged. Sorting on
   `created` then produced a generic server error. I had to declare both
   autodate fields explicitly on every base collection.
3. Indexes over the expected automatic `created` field failed at migration
   validation time.
4. Fixed record IDs require exactly 15 lowercase alphanumeric characters; the
   diagnostic said only `id: Invalid value format` and did not identify which
   seeded record was wrong.

The migration rollback behavior was excellent, but interactive migration-down
confirmation caused two automation stumbles, and the down migration initially
left seeded users behind because `users` is a pre-existing collection rather
than app-owned schema.

PocketBase has no true ephemeral room primitive. Presence is a durable table,
every heartbeat is a database write/realtime record, and a cron job must delete
expired rows. That is workable but semantically and operationally wasteful.
The UI also needed hand-authored row types; collection rules and hooks do not
generate an application type contract. Finally, PocketBase's own docs still
warn that pre-1.0 is not recommended for production-critical applications
without accepting manual migration work.

## 2026-08-01 — Snapback 0.1.8 npm closure, PASS with one explicit asset GAP

### Environment and milestones

- Public scaffold: 7.51 s.
- npm install: 6.76 s; 137-package resolved tree, 195.0 MiB including the
  packaged native runtime, zero audit findings.
- First starter generation: 0.79 s; starter live proof: 2.48 s.
- Final generation: 0.72–0.80 s, 6 tables, 10 operations, 4 live queries, one
  ephemeral collection, one asset intent, one action, and one cron job; zero
  warnings.
- Final typecheck: 2.08 s; React build: 1.90 s; live acceptance: 1.58 s.
- Approximate provider-specific active interval: 12 minutes.
- Final bundle: 456.2 kB JS (132.8 kB gzip); generated top-level artifacts:
  234.1 kB.

### What felt good

The public npm story is real. One command scaffolded a React app, the full
platform runtime arrived as an ordinary dependency, managed dev produced a
ready descriptor and admin console, and generation made the backend visible as
exact operation references. There were no repository-relative imports.

The strongest experience was correctness pressure. Generated branded IDs made
my initial stringly UI fail typecheck at every incident-operation boundary.
After using generated `Id<'incidents'>` and data-model types, the entire UI
compiled without result casts. Schema, search index, upload policy, cron, and
ephemeral budgets all fail closed during generation.

The runtime features are unusually coherent. A JS mutation checked access,
patched the incident, and appended activity in one commit. Owner-partitioned
portable search returned Ada's result and none for Mallory. Durable stream
delivery reached the other client in 54 ms once explicitly configured.
Connection-keyed presence arrived in 39–43 ms and did not advance durable
storage at all—materially better semantics than PocketBase's presence table.
The action could call a mutation, and the cron definition was generated and
loaded with the same artifact identity.

Structured diagnostics were much better than PocketBase's generic API errors.
Even the asset defect was a named `SNAPBACK_AUTH_REQUIRED`, and managed server
lifecycle output carried exact runtime package, binary stamp, URL, and token
paths.

### What felt bad or surprising

The first generated starter itself warned that `createTodo` had a degraded
result contract. A brand-new paved-road app should begin warning-free.

The React auth story was the biggest ergonomic miss. The first-party provider
does not accept a dev `userId`, while raw operations do. To make the external
React app exercise two identities, I dropped from first-party hooks to a raw
`SnapbackClient` with `userId` on every operation. PocketBase's login/auth-store
flow was much easier to turn into an ordinary app. Real sessions-mode email
code auth would be more principled, but it would further widen this small local
bakeoff and the shipped provider still has no production mail adapter.

Access composition was also expensive. I wrote an `incidentAccess` table and
manual JS checks. The protected multi-table JS live query did not push in the
initial probe, so the working message feed uses a declarative indexed live
query. That restores push but does not inherit the incident-access rule; a
production version must adopt Snapback's full membership declaration and
semi-join surface. Owner-partitioned search likewise cannot express shared
membership visibility in v1. The secure path exists for ordinary queries, but
it is much more ceremony than PocketBase's relation rules and does not compose
across every feature.

Raw `liveQuery` defaults to polling unless `transport: 'stream'` is explicit.
`fallbackToPoll: false` did not imply stream; the first two runs waited for a
push that could never arrive. This is precise once learned but a poor default
for an API named live query.

The packaged asset client remains broken. Importing `createAssetClient` from
the package root passed the published type surface but failed at runtime
because only the `@expo/snapback-client/assets` subpath exports it. After using
that public subpath, an `authenticated` upload intent plus the documented dev
`userId` header still failed before transferring bytes with
`SNAPBACK_AUTH_REQUIRED`. The app retains this as an expected GAP and does not
claim upload success. This extends the already-open sessions-custody ticket
with a 0.1.8 dev-mode reproduction.

One mutation-handler subtlety also cost a probe: patching an incident and then
`ctx.db.get`-ing it returned the pre-patch row, so the mutation result was
stale even though the committed query was correct. The final acceptance checks
the post-commit query. Read-your-writes should be a normal handler invariant,
not a surface-specific caveat.

## Cost comparison

Exact model token telemetry is not exposed in this environment, so I cannot
honestly report “Snapback used N model tokens.” Two measurable proxies point in
different directions:

| Measure | PocketBase | Snapback |
| --- | ---: | ---: |
| Authored source | 571 lines / 3,532 words / 50.2 kB | 559 lines / 2,499 words / 25.2 kB |
| Approx. active time | 8 min | 12 min |
| Failed/corrective iterations | more migration/runtime-shape failures | fewer iterations, but more remaining product/API problems |

PocketBase required about 41% more authored words because collection schemas,
rules, indexes, fields, seed rows, and rollback all live in a verbose migration.
Snapback required more active time and substantially more reasoning/context:
the guide surface is larger, auth/visibility decisions interact with search and
live query forms, and the asset/client/provider boundaries needed narrowing.
If “tokens” means source-like output, PocketBase cost more; if it means likely
agent reasoning tokens, Snapback almost certainly cost more, but that second
statement is an inference rather than measured telemetry.

## Verdict

For this ordinary small team app, **PocketBase was easiest and fastest to work
with overall**. Its loose, direct model got from auth to realtime CRUD, files,
cron, and a dashboard quickly, and every requested feature eventually worked.
I would choose it for a self-hosted prototype or modest internal tool where a
single-node SQLite backend is an acceptable product boundary.

Snapback was better at the hard semantic parts: exact generated client types,
atomic handler writes, owner-partitioned portable search, structured
diagnostics, build identity, and true non-durable presence. I would prefer its
model for an app where authorization invalidation, offline truth, ephemeral
state, deterministic testing, and multi-client correctness matter enough to
pay for a younger and more explicit surface. In this 0.1.8 arm, however, the
asset failure and auth/React friction prevent it from being the easier choice.

## What I would change in Snapback

1. Make the first-party React provider own the complete identity flow in dev
   and sessions mode; no per-operation `userId`, no raw-client escape hatch.
2. Make stream the ordinary live-query default, or rename the polling default
   so “live” cannot accidentally produce a non-push test.
3. Fix the public asset client end to end and add a public-package conformance
   test for dev identity, session bearer, upload, typed attach, shared read,
   revocation, and delete.
4. Make membership visibility composable with search, files, and relational
   live queries. Authorization should be declared once and inherited.
5. Provide read-your-writes inside JS mutation handlers.
6. Ship a warning-free starter whose mutation has an exact result contract.
7. Reduce the client/runtime install and browser bundle footprint, and keep
   root runtime exports exactly aligned with the published type surface.

## Reproduction

- PocketBase: `cd demos/pocketbase-snapback-bakeoff/pocketbase-incident-room && npm run build && npm run test:acceptance`
- Snapback: `cd demos/pocketbase-snapback-bakeoff/snapback-incident-room && npm run generate && npm run typecheck && npm run build && npm test && npm run test:live`

The PocketBase binary and both apps' runtime databases are ignored. The
committed evidence is source plus deterministic acceptance output; no hosted
target or production-readiness claim is made.
