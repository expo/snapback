# LLP 0014: Cloudflare strategy

**Type:** RFC
**Status:** Draft
**Systems:** Deployment, Runtime, Storage, Sync, Realtime, Security, Assets, Cron, Developer experience
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-26
**Revised:** 2026-07-07 (latest: §Resolution ratified by Charlie and
strengthened — everything on Durable Objects: the control plane moves from D1
to a registry object with gateway caching, and D1 leaves the architecture,
preserved only as named fallbacks in the data-plane (LLP 0040) and
control-plane (§Resolution) revisit triggers); 2026-07-07 (earlier same day: Phase 0 gains its engine half —
LLP 0048, the DK-5 twin re-decided in LLP 0009, proves the V8 handler harness
locally before the deploy half consumes it. Same day, full-plan sketch before
the narrow proof starts:
§Platform Facts rechecked and refreshed against current docs; §Resolution
dissolves the Profile A/B store question by layer — per-app data plane on
Durable Object SQLite, platform control plane on D1 — proposed, pending
Charlie's ratification, with LLP 0040 revised in step; §The Full Plan adds
the end state, phase ladder, and one-way doors; open questions annotated with
their answers); 2026-07-02 (LLP 0032 X1: DK-2 commit-version answer recorded — per-app stream, one version authority per app, Durable Object counter; Profile C intra-app sharding named as the constraint that reopens LLP 0007's note)
**Related:** LLP 0000, LLP 0001, LLP 0002, LLP 0003, LLP 0004, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0017, LLP 0018, LLP 0023, LLP 0028, LLP 0032, LLP 0036, LLP 0039, LLP 0040, LLP 0041, LLP 0043, LLP 0044, LLP 0045, LLP 0046, LLP 0047, LLP 0048, https://developers.cloudflare.com/workers/platform/storage-options/, https://developers.cloudflare.com/durable-objects/, https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/, https://developers.cloudflare.com/durable-objects/api/alarms/, https://developers.cloudflare.com/durable-objects/reference/data-location/, https://developers.cloudflare.com/durable-objects/platform/pricing/, https://developers.cloudflare.com/durable-objects/best-practices/websockets/, https://developers.cloudflare.com/d1/platform/limits/, https://developers.cloudflare.com/r2/, https://developers.cloudflare.com/queues/, https://developers.cloudflare.com/workers/configuration/cron-triggers/, https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/

## Summary

Cloudflare is Snapback's intended second standard target after the canonical
local Ibex + SQLite server. It should not be treated as a port of the local
process. Cloudflare's model is event-driven, V8-based, isolate-oriented, and
built around products such as Workers, Durable Objects, D1, R2, Queues, and
Cron Triggers. Snapback should use those seams deliberately instead of trying to
smuggle a long-running local server into an environment that is designed to sleep
when idle.

This RFC sets the strategy before the local core hardens around unportable
assumptions. The first Cloudflare proof should preserve the app-facing Snapback
contract from LLP 0004 and the capability-reporting contract from LLP 0012, but
it may adapt the implementation of connection ownership, change notification,
durable state, scheduling, realtime delivery, runtime isolation, secrets, asset
storage, and storage-engine choice.

Revised 2026-07-07, before the narrow proof begins: §Platform Facts is
rechecked, §Resolution settles where rows live (by layer, not by profile), and
§The Full Plan sketches the end state, the phase ladder, and the one-way
doors — so the first slice ([LLP 0040](./0040-cloudflare-narrow-proof.rfc.md))
executes against the whole visible route instead of discovering it
mid-flight.

## Scope

This RFC owns the Cloudflare target strategy:

- target profiles and what each profile is allowed to claim;
- connection and session ownership;
- durable state placement;
- realtime and change-notification mechanics;
- storage-engine choice and the portability boundary;
- runtime isolation and secrets on Workers;
- asset, cron, and background-work mapping;
- local/CI validation expectations before Cloudflare is called supported.

It does not implement Cloudflare support, select final pricing tiers, or replace
the canonical local target from LLP 0002. It also does not approve hosted
multi-tenant Snapback by itself; LLP 0009 still gates untrusted code on an
enforceable runtime/resource boundary.

## Product Goals

Cloudflare support should earn these claims:

- **Scale-to-zero behavior:** an idle deployed app should stop doing steady
  compute work. WebSocket and realtime designs should take advantage of
  hibernation or event wakeups when possible.
- **Same app-facing model:** schemas, handlers, generated clients,
  diagnostics, and capability reports should look like Snapback, not like a
  one-off Cloudflare SDK.
- **Explicit capability gaps:** if a Cloudflare profile lacks offline replay,
  Postgres graduation, a query form, a resource limit, or a realtime guarantee,
  the capability manifest says so.
- **No polling assumption:** the local tailer's fixed interval is a local
  placeholder. Cloudflare profiles should wake from writes, messages, alarms, or
  platform events.
- **Benchmark before claims:** the first profile must measure write latency,
  subscription fan-out, hibernation behavior, storage contention, queue depth,
  and reconnect behavior before it is used as evidence for scale.

## Platform Facts To Design Around

These facts were rechecked against official Cloudflare documentation on
2026-07-07 (superseding the 2026-06-26 check) and should be rechecked again
before implementation because Cloudflare's platform changes quickly:

- Durable Objects combine compute with storage, are globally unique by object
  id, and shut down when idle. **SQLite-backed object storage is GA**: 10 GB
  per object, unlimited objects and unlimited account storage on paid plans, a
  synchronous `sql.exec` API with `transactionSync`, FTS5/JSON extensions, and
  30-day point-in-time recovery via lexically ordered bookmarks. The dashboard
  Data Studio can inspect and write object SQLite data, and SQLite-backed
  objects are available on the free plan. Storage bills by rows: reads
  $0.001/million (25 B/month included), writes $1.00/million (50 M/month
  included), storage $0.20/GB-month.
- WebSocket Hibernation is the idle-economics mechanism: duration (GB-s)
  charges stop while hibernated, server-held sockets survive object eviction,
  ping/pong is auto-answered without waking the object, and incoming messages
  bill as requests at a 20:1 ratio. Per-socket `serializeAttachment` state is
  capped at 16 KB, and `setTimeout`/`setInterval` prevent hibernation — the
  alarm is the only idle-compatible timer.
- Each object schedules **exactly one alarm** at a time (at-least-once,
  exponential-backoff retries up to 6, wakes an evicted object). Every
  per-app timer consumer — cron ([LLP 0028](./0028-cron-scheduled-execution.rfc.md)),
  outbox sweep ([LLP 0045](./0045-notifications-outbox.rfc.md)), asset GC
  ([LLP 0044](./0044-asset-storage-pipeline.rfc.md)), journal pruning
  ([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)) — must share one
  dispatcher.
- Objects are created near the first `get()` and **do not relocate** (dynamic
  relocation is "planned", not shipped); `locationHint` is honored only at
  creation, and jurisdictions (`eu`/`us`/`fedramp`) are separate id
  namespaces chosen at creation. Placement is effectively permanent per app.
- The deployed Workers runtime **forbids dynamic code evaluation** (`eval`,
  `new Function`, buffer-based WebAssembly compilation). An app bundle cannot
  be loaded from storage and evaluated at runtime the way the local target
  does it; code is either compiled into the deployed Worker or uploaded as a
  separate **user Worker via Workers for Platforms** dispatch namespaces —
  Cloudflare's product for running untrusted tenant code, with per-worker
  CPU/subrequest limits and an outbound Worker mediating the tenant's
  `fetch`.
- Size caps that shape the wire: 2 MB per SQL row/BLOB/string (object storage
  and D1 alike), 100 KB per SQL statement, 100 bound parameters, 32 MiB per
  received WebSocket message, 30 s (configurable to 5 min) of CPU per object
  request.
- D1 is Cloudflare's serverless SQL database (also SQLite): 10 GB per
  database, 50,000 databases per account, batch-atomic statements with **no
  interactive transactions**, 30 s query cap, storage $0.75/GB-month, read
  replication at no extra row cost.
- R2 is the asset-byte store (S3-shaped, presigned URLs, no egress fees).
- Queues provide Worker-integrated at-least-once asynchronous delivery for
  durable background work, notification fan-out, and outbox-style retries.
- Cron Triggers are deploy-time static schedules per Worker script.
  [LLP 0028](./0028-cron-scheduled-execution.rfc.md)'s Cloudflare mapping
  already assigns the layers: Cron Trigger plus runner demand check for
  minute-compatible static jobs, object alarms for sub-minute, dynamically
  armed, or zero-idle-wakeup jobs.

## Target Profiles

The strategy should define at least three Cloudflare profiles before any one is
called supported.

### Profile A: D1 Store + Durable Object Realtime Coordinator

The app's durable SQL data lives in D1. Durable Objects own connected clients,
subscriptions, room/session state, and realtime delivery. Workers route HTTP and
WebSocket traffic to the right object.

This profile is closest to "SQLite-shaped storage plus event-driven realtime,"
but it has hard questions:

- how the D1 write path allocates one commit version per mutation;
- whether D1 triggers/change tables are sufficient for Snapback changesets;
- how a Durable Object learns about writes without polling D1;
- how many subscriptions a coordinator can match before fan-out bends;
- whether D1 overload behavior produces recoverable Snapback diagnostics.

### Profile B: Durable Object As App Shard

A Durable Object owns a project, app shard, room, or tenant partition and keeps
the serial write boundary, live subscriptions, connection state, and local
durable storage together. Workers route all reads, writes, and sockets through
that object or object family.

This profile is closest to Snapback's local "one owner process" mental model and
may fit small apps well. It may also bottleneck early if one object owns too much.
It must define shard boundaries, cross-shard queries, export/import, and what
"SQLite to Postgres graduation" means from a Cloudflare object-backed profile.

### Profile C: Hybrid Edge Router + Sharded Durable Objects + D1/R2/Queues

Workers own routing and auth/session ingress. Durable Objects own per-room,
per-subscription, or per-shard coordination. D1 stores app rows where SQL is the
right tool. R2 stores assets. Queues handle background jobs and outbox work.

This is likely the long-term production profile, but it should not be the first
prototype unless Profiles A and B make the seams clear. The danger is designing
a distributed system before Snapback has measured its local matcher, changeset,
and conformance costs.

### Resolution: everything on Durable Objects (ratified by Charlie, 2026-07-07)

Profile A versus Profile B stayed hard to answer because it was posed as one
choice for one layer. Re-examined against the rechecked platform facts above
and the write contract, the layers separate cleanly — and, as ratified, both
land on Durable Object SQLite. (The same-day draft assigned the control plane
to D1; Charlie ratified the stronger form: one storage technology everywhere,
D1 out of the architecture, preserved only as the named fallbacks in the
revisit triggers below.)

- **Per-app data plane: the write-owning Durable Object's SQLite storage.**
  App tables, system tables, the change journal, outbox and cron state, and
  the DK-2 version counter live together in the object's embedded database.
  One `transactionSync` commits version, rows, and journal, so LLP 0007's
  gap-free visibility property holds by construction — the same single-writer
  SQLite semantics as the canonical local target, embedded and synchronous
  rather than a network hop away. This completes what
  [LLP 0007](./0007-storage-portability.spec.md)'s DK-2 note already says:
  "the write-owning Durable Object allocating a per-app counter from its own
  storage — single-threaded execution reproduces the local SQLite semantics
  exactly." Putting the rows next to that counter finishes the sentence;
  putting them in D1 splits one commit across two stores (or moves the
  counter into D1 batches and inherits ambiguous-failure recovery).
- **Platform control plane: a registry Durable Object, not D1.** Accounts,
  the app registry (logical app id → object id, jurisdiction, location hint,
  bundle/schema hashes, custom domains), quotas, and billing facts live in a
  singleton registry object's SQLite — the same storage technology, PITR
  story, and Data Studio inspectability as the data plane; one storage
  system to operate instead of two. The cross-app queries the data plane
  must never serve ([LLP 0018](./0018-app-instance-boundaries.rfc.md)'s
  isolation contract) are served by the registry object's own API. The
  routing hot path does not hit the registry per request: gateway Workers
  cache `appId` → object-id resolutions (in-isolate cache first, Workers KV
  as a global read-through layer if measurement demands it), with the
  registry object as the single source of truth. Registry rows are tiny, so
  the 10 GB object cap is tens of millions of apps away; if a ceiling ever
  binds, the registry shards by account prefix — a control-plane-private
  choice invisible to apps. (Per-app D1 was never the alternative here
  anyway: the 50,000-databases-per-account ceiling and 3.75× storage price
  make it the wrong multi-tenancy unit, while objects are unlimited and are
  the hibernation/blast-radius/PITR unit the product thesis wants.)
- **Profile C is the end state reached by phases, not a third alternative:**
  the gateway Worker, per-app objects, the registry object, R2, and Queues
  decompose exactly as Profile C sketches, entered one phase at a time
  (§The Full Plan).

Why D1 loses even the control plane, checked against current facts: its
traditional advantages are matched — the dashboard console by Data Studio
over object SQLite, Time Travel by the same 30-day bookmark recovery,
`wrangler d1 export` by LLP 0007's logical portable bundle (the real export
contract on every target; an engine-level dump was never the graduation
path) — and its one real remainder, read replicas for hot routing lookups,
is replaced by gateway caching in front of the registry object. Running one
storage technology instead of two is worth more than replicas the control
plane may never need. **Control-plane revisit trigger:** if Phase 2
measurement shows registry-object routing with caching cannot serve the
gateway hot path, D1-as-registry reopens — a control-plane-private swap
behind its own seam, invisible to apps.

Scale consequence, stated honestly: with the data plane inside the object,
every read enters the single-threaded owner, so per-app read throughput has a
designed ceiling — the same per-app single-authority trade DK-2 already
accepts for writes on every target. The escape hatches remain graduation
([LLP 0046](./0046-postgres-graduation-path.rfc.md)) and the Profile C
intra-app sharding that reopens LLP 0007's note. A cache- or replica-backed
read-offload path (the journal materialized outward from the commit path)
stays possible later without changing the app contract; nothing here
forecloses it.

**Revisit trigger:** the mirror of [LLP 0040](./0040-cloudflare-narrow-proof.rfc.md)'s —
if the narrow proof's measurements show object SQLite cannot satisfy the
write contract or its limits bind in practice, Profile A's D1-store shape
reopens before any second Cloudflare investment.

## Architecture Seams

### Connection Ownership

Cloudflare WebSocket sessions should be owned by Durable Objects, not by ordinary
Workers pretending to be long-lived servers. The first design question is the
object key:

- one object per app;
- one object per app shard;
- one object per authenticated user/session;
- one object per subscription room;
- a two-level model, such as app object plus room objects.

The key must be visible in diagnostics. Reconnect behavior must tell the client
whether it resumed the same object, moved to a replacement object, or needs a
fresh snapshot.

### Change Notification

Cloudflare support must not depend on fixed-interval polling. Local polling is a
bring-up mechanism in LLP 0003; Cloudflare should use one of:

- mutation commit path directly notifying the relevant Durable Object;
- Durable Object-local writes emitting deltas before the object sleeps;
- queue/outbox messages from the write owner to realtime owners;
- alarms only for bounded maintenance, not for normal live delivery.

Every mechanism must preserve the LLP 0007 changeset rule: one logical mutation
commits one version and subscribers observe one atomic changeset.

### Durable State

The storage choice must be made against Snapback's portable storage contract:

- Can the profile implement opaque string ids, system fields, exact timestamps,
  commit versions, tombstones/deletes, and query semantics?
- Can it export a logical portable bundle for SQLite/Postgres graduation?
- Can it provide deterministic reset/seed for the acceptance suite?
- Can it report non-portable behavior as capability gaps?

D1 is the obvious SQL candidate, but not automatically the only Cloudflare
store. Durable Object storage may be better for object-local state; R2 is the
asset-byte store; Queues are not a database. (Where rows live is now settled
by §Resolution, ratified 2026-07-07: object SQLite everywhere — each app's
rows in its own object, the platform registry in a control-plane object; D1
is not part of the architecture.)

**Commit-version answer (DK-2, 2026-07-02).** The graduation design note in
[LLP 0007](./0007-storage-portability.spec.md) §Commit-version graduation
settles the version-spine question this section inherits: the stream is
per logical app, gap-free in commit-visibility order, and **one app stream
requires one version authority**. On Cloudflare that authority is the
write-owning Durable Object allocating a per-app counter from its own
storage — single-threaded execution reproduces the local SQLite semantics
exactly. The named constraint for Profile C: sharding one app's data across
multiple objects requires either a coordinator-allocated stream or a
multi-stream client cursor model, neither of which is designed — so the
first prototype must keep one app's writes owned by one object, and any
intra-app sharding proposal reopens LLP 0007's note.

### Runtime Isolation

Cloudflare uses V8 isolates, so it is the natural second runtime profile for
Snapback's app code. That does not by itself approve untrusted multi-tenant code.
The Cloudflare profile must still report:

- invocation timeout and whether it is enforced;
- CPU and memory limits as enforced by the target;
- per-invocation global-state isolation policy;
- whether handler code can access network, secrets, environment bindings, or
  storage except through explicit Snapback capabilities;
- how bundle hashes, schema hashes, and capability manifests are validated.

The first Cloudflare prototype should run trusted app code until LLP 0009's
hosted/untrusted requirements are satisfied for the chosen profile.

### Secrets

Cloudflare bindings and secrets are deployment-owned inputs. Snapback handlers
should still see secret handles through the same explicit capability model as
other targets. Query and mutation handlers should not receive ambient access to
Worker bindings, environment variables, or unrestricted network APIs.

Diagnostics must show which secret capability is present without exposing the
secret value or a stable hash of it.

### Assets

Cloudflare assets should map to R2 for bytes and Snapback tables for metadata,
ownership, permissions, references, and processing state. The asset subsystem is
not in the first local slice, so the Cloudflare profile should initially report
asset upload and processing as missing capabilities unless the asset LLP exists.

### Cron and Background Work

Cron Triggers are appropriate for deployment-wide schedules. Durable Object
alarms are appropriate for object-local wakeups. Queues are appropriate for
durable async work and retries. Snapback cron needs a profile-specific split:

- global schedules route through Worker `scheduled` handlers;
- app- or shard-local scheduled work routes to the owning Durable Object;
- long-running or retryable work goes through Queues;
- every scheduled invocation records structured diagnostics and capability
  gaps.

## The Full Plan

The strategy above names seams; this section (added 2026-07-07, with the
narrow proof about to start) sketches the whole route so the first slice
cannot wander into a dead end. Each phase names its owning LLPs and the
evidence gate that opens the next. Phases are cumulative, and nothing in an
earlier phase may violate a later phase's pinned constraint.

### End state

One Worker gateway routes HTTP/WebSocket traffic. A control-plane **registry
Durable Object** maps logical app ids
([LLP 0012](./0012-headless-integration-contract.spec.md)'s ratified `appId`)
to object ids, jurisdictions, location hints, bundle/schema hashes, custom
domains, and quotas; gateway Workers cache its resolutions on the hot path. Each logical app is one SQLite-backed
Durable Object holding rows, change journal, outbox, cron state, and the
version counter, owning the app's sockets through hibernation and all its
timers through one multiplexed alarm. Handler code executes on V8 — inside
the object while code is trusted, as per-app Workers-for-Platforms user
Workers once it is not ([LLP 0047](./0047-hosted-execution-limits.rfc.md)'s
enforced-limits gate). R2 holds asset bytes
([LLP 0044](./0044-asset-storage-pipeline.rfc.md)), bundle archives, and
scheduled logical-export backups; Queues take over outbox delivery when alarm
sweeps stop scaling ([LLP 0045](./0045-notifications-outbox.rfc.md)); Cron
Triggers run platform-wide jobs only
([LLP 0028](./0028-cron-scheduled-execution.rfc.md)); Workers static assets
serve generated client surfaces.

### Phase ladder

- **Phase 0 — narrow proof ([LLP 0040](./0040-cloudflare-narrow-proof.rfc.md)).**
  One app, object-SQLite store, bundle compiled in at deploy time, trusted
  in-object V8 handlers, hibernating sockets, capability manifest
  `cloudflare-do-sqlite-v8`, measurement report landing as a Research LLP.
  Phase 0 has an engine half and a deploy half: the V8 handler harness is
  built and conformance-proven locally first
  ([LLP 0048](./0048-v8-conformance-twin.rfc.md) — the DK-5 twin, executing
  LLP 0009's re-decision), and the deploy consumes that same artifact.
  **Gate:** the write contract proven (gap-free versions, atomic changesets)
  and idle economics proven on billing counters, both idle windows. A
  non-hibernating result is negative evidence: it lands as a measurement
  report but does not open this gate (LLP 0040 §Hibernation and subscription
  state).
- **Phase 1 — app-complete single tenant.** `snapback deploy cloudflare` as
  new scoped work extending [LLP 0041](./0041-packaged-dev-loop.rfc.md)'s CLI
  (0041 itself excludes hosted deploys); the auth vertical
  ([LLP 0039](./0039-auth-vertical-slice.rfc.md)); server-side journal
  retention and resume ([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) /
  [LLP 0043](./0043-offline-replay-retention.rfc.md)); app cron on the alarm
  multiplexer per 0028's Cloudflare mapping; assets on R2
  ([LLP 0044](./0044-asset-storage-pipeline.rfc.md)); the notification outbox
  sweep ([LLP 0045](./0045-notifications-outbox.rfc.md)); app config/secrets
  through [LLP 0036](./0036-app-secrets-and-config.rfc.md)'s model mapped
  onto Worker secrets; deterministic reset/seed in CI. **Gate:** one real
  demo app fully hosted with the same generated client; acceptance green on
  Miniflare plus a real-Cloudflare measurement run.
- **Phase 2 — multi-app control plane.** The registry object and gateway
  routing with the resolution cache;
  per-app object addressing with creation-time location hints and
  jurisdiction choice; [LLP 0018](./0018-app-instance-boundaries.rfc.md)'s
  isolation acceptance across at least two apps; hosted admin surfaces
  scoped per app ([LLP 0017](./0017-admin-console-inspection-surface.rfc.md) /
  [LLP 0023](./0023-admin-console-dev-serve-loop.rfc.md)). Still trusted
  code only — the operator's own apps. **Gate:** 0018's multi-app validation
  list green.
- **Phase 3 — untrusted multi-tenant.** A Workers-for-Platforms dispatch
  namespace; per-app user Workers as the handler runtime; an outbound Worker
  denying ambient `fetch`; per-worker CPU/subrequest limits;
  [LLP 0047](./0047-hosted-execution-limits.rfc.md)'s limits reporting
  `Enforced` so `hosted_untrusted_code` graduates; custom domains. **Gate:**
  0047's acceptance passing on the real platform.
- **Phase 4 — scale and graduation interop.** Scheduled logical-bundle
  export to R2 (backup as rehearsed graduation); Cloudflare→Postgres
  graduation exercised end to end
  ([LLP 0046](./0046-postgres-graduation-path.rfc.md)); Queues for outbox
  volume; read-offload or intra-app sharding **only** on measured need —
  either one reopens LLP 0007's DK-2 note by design.

### One-way doors

Decisions that are cheap now and expensive later, pinned before Phase 0
(ratified with §Resolution, 2026-07-07):

1. **Rows live with the version authority** (§Resolution). The commit is one
   local transaction; no design may split one app's commit across two
   stores.
2. **Bundle loading is deploy-time, never runtime `eval`.** Phases 0–2
   compile the app bundle into the deployed Worker; Phase 3 uploads user
   Workers via the dispatch API; an interpreter-in-WASM path is rejected (it
   abandons the V8-conformance evidence the DK-5 twin exists to buy, and
   adds an engine). Consequence the dev loop must report honestly: code
   hot-load into a running Cloudflare target is a missing capability — an
   app-code change is a deploy.
3. **The handler↔host seam stays async and RPC-shaped.** Phase 0 executes
   handlers inside the object, but the `ctx` surface must not grow
   synchronous same-isolate assumptions, so Phase 3 can move execution into
   user Workers without changing the app-facing contract. 0047's isolation
   requires out-of-object execution eventually: a busy loop inside the
   coordinator kills the app's sockets with it, and fresh-per-invocation
   isolation is impossible inside a long-lived object. The seam's first V8
   consumer is [LLP 0048](./0048-v8-conformance-twin.rfc.md)'s local workerd
   runner, which proves it before any deploy.
4. **Subscription state is storage-backed from day one.** Socket attachments
   carry only connection identity and auth epoch (≤16 KB); the subscription
   registry (query identity, args, cursor) lives in SQLite rows keyed by
   connection id and rehydrates lazily on wake. In-memory registries die at
   eviction while their sockets live on.
5. **One alarm, one dispatcher.** The app object runs a single schedule
   table over every timer consumer (cron, outbox sweep, retention pruning,
   asset GC). No subsystem may assume its own timer, and
   `setTimeout`/`setInterval` are forbidden in the object — they break
   hibernation.
6. **App identity is registry-owned; never `idFromName(app name)`.** The
   control plane maps `appId` → object id, jurisdiction, and location hint;
   names change, jurisdictions namespace object ids, and re-homing an app is
   a logical export/import into a new object (the LLP 0046 path), not an id
   pun. This answers LLP 0018's object-key question and gives LLP 0007's
   project/database-handle question its Cloudflare shape: the portable
   handle is the logical `appId`; the object id is target-private routing
   state.
7. **Placement is chosen at creation, explicitly.** Objects do not move, so
   app creation always passes a `locationHint` derived from the owner's
   declared home region — not the incidental location of the first
   request — and records it in the registry.
8. **The wire must tolerate chunking.** The 2 MB row/BLOB cap (a declared
   capability divergence from the local target) and message-size limits mean
   large snapshots stream or chunk; LLP 0007's materialized-vs-streaming
   open question is load-bearing here and should settle toward
   streaming-capable before generated clients harden.
9. **Benchmark methodology respects frozen time.** `Date.now()` does not
   advance during synchronous execution in the Workers runtime, so Phase 0's
   measurements are taken at clients or across I/O boundaries, per
   LLP 0040's method note.

## First Prototype

(This section is executed by [LLP 0040](./0040-cloudflare-narrow-proof.rfc.md) —
Phase 0 of §The Full Plan — which sharpens it; it is kept for the original
ten-point framing.)

The first Cloudflare prototype should be narrower than "Snapback on
Cloudflare." It should prove:

1. one generated Snapback app bundle deployed to Workers;
2. one schema/function manifest loaded with a stable bundle hash;
3. one mutation executed in V8 through the same app-facing handler API;
4. one durable SQL or object-backed commit with a Snapback commit version;
5. one live subscription through a Durable Object-owned WebSocket;
6. an authoritative initial snapshot plus online deltas;
7. a capability manifest that marks unsupported local-first features honestly;
8. deterministic reset/seed or a documented CI surrogate;
9. idle behavior showing no steady polling or needless billable work;
10. a todo acceptance fixture shared with the local target where possible.

It should not claim offline replay, assets, notifications, production auth,
Postgres graduation, hosted multi-tenant isolation, or high-frequency whiteboard
fan-out until those capabilities have their own validation.

## Validation Requirements

Before a Cloudflare profile moves beyond Draft, the acceptance suite should
prove:

- the same generated schema/function artifacts are accepted locally and on
  Cloudflare, or the capability report explains every divergence;
- an async handler runs to completion under V8 and does not expose ambient
  Worker powers;
- one mutation produces one commit version and one changeset;
- a cold-start subscription returns the current authorized result before deltas;
- reconnect either resumes from a retained version or forces a structured
  resnapshot;
- no realtime path depends on fixed-interval polling;
- WebSocket hibernation or the chosen idle behavior is measured;
- Durable Object storage contention and overload cases produce recoverable
  diagnostics;
- reset/seed works in CI or the profile declares the exact unsupported gap;
- cost and usage counters are visible enough to support the scale-to-zero claim.

## Open Questions

Several of the original questions were answered in place on 2026-07-07; they
are kept with their answers so the history stays legible:

- Which target profile should be prototyped first? — **Answered** by
  §Resolution and [LLP 0040](./0040-cloudflare-narrow-proof.rfc.md): the
  per-app object with SQLite storage; the control plane is also
  object-backed (D1 dropped from the architecture per §Resolution).
- What is the Cloudflare project/app/shard identity model? — **Answered** by
  §One-way doors 6–7: the control-plane registry owns `appId` → object id,
  jurisdiction, and location hint; object ids are never derived from names.
- Can D1 implement the exact changeset/version/tombstone contract Snapback
  needs without polling or non-portable SQL behavior? — **Mooted** by
  §Resolution (ratified: D1 is not in the architecture); the question
  returns only if a revisit trigger reopens it — LLP 0040's for the data
  plane, §Resolution's for the control plane.
- How should Durable Object hibernation interact with subscription
  membership, pending mutation acknowledgements, and reconnect cursors? —
  **Answered** by §One-way doors 4: a storage-backed subscription registry;
  socket attachments carry only connection identity and auth epoch.
- What is the maximum useful fan-out for one Durable Object room before
  sharding is required? — **Open**; a Phase 0/1 measurement.
- Does Cloudflare's local development tooling provide enough deterministic
  state setup for the same acceptance suite, or does Snapback need a separate
  Cloudflare CI surrogate? — **Open**; LLP 0040 OQ1 carries the sharpened
  form (Miniflare acceptance versus real-Cloudflare measurement runs).
- Which Cloudflare resource limits are enforceable versus advisory from
  Snapback's point of view? — **Partially answered** by the rechecked
  platform facts; the computed limit fields land with Phase 0 (DK-5,
  LLP 0040 / [LLP 0047](./0047-hosted-execution-limits.rfc.md)).
- What is the migration story from local SQLite to the first Cloudflare
  profile, and from that profile to Postgres or another larger-scale
  deployment? — **Answered in shape** by §The Full Plan Phase 4: the logical
  portable bundle in both directions, with scheduled export to R2 as the
  standing rehearsal ([LLP 0046](./0046-postgres-graduation-path.rfc.md));
  0046 owns the mechanics.

## Status

Draft. This is a strategy document to prevent local-core assumptions from
hardening around an always-on process, a polling tailer, or SQLite-only storage
mechanics. Revised 2026-07-07 with the rechecked platform facts, the store
resolution (ratified: everything on Durable Objects), and the full phase
plan, so the narrow proof starts with the whole route visible. It should be revised again
after [LLP 0040](./0040-cloudflare-narrow-proof.rfc.md)'s measurement report
lands.
