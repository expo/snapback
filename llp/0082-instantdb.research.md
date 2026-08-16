# LLP 0082: InstantDB — the closest competitor surface

**Type:** Research
**Status:** Draft
**Systems:** Storage, Sync, Realtime, Auth, Ephemeral state, Assets, Effects,
Developer experience, Authoring, Agent experience, Testing, Competitive
analysis
**Author:** Charlie Cheever / Claude / Codex / Grok
**Date:** 2026-07-23
**Revised:** 2026-08-13 (second same-day pass: re-fetched Instant docs and
incorporated missing product surfaces — `$files` storage-as-graph, webhooks
and Stripe recipes, infinite queries, permission rate limits and field-level
rules, production VPS/AWS self-hosting, backups, Admin HTTP API, and Streams
as queryable `$streams` with a Vercel AI SDK resume path — plus diary facts
the field-study section had compressed away). 2026-08-13 (added the LLP 0102
five-application field study of why coding agents favored InstantDB's
authoring model, including timings, repeated qualitative findings,
causal-confidence limits, disliked surfaces, and Snapback implications).
2026-07-23 (same day: the revocation-eviction open question is answered by
the LLP 0086 CC-3.3 preregistered probe — data-dependent revocation evicts
live (~32 ms), rule revocation does not reach connected clients until
reconnect; §Permissions carries the probe results and a dated correction to
the differentiator inference; receipts in
`tests/probes/instant-eviction-20260723/`)
**Related:** LLP 0000, LLP 0001, LLP 0004, LLP 0007, LLP 0008, LLP 0010,
LLP 0011, LLP 0013, LLP 0018, LLP 0022, LLP 0024, LLP 0033, LLP 0037,
LLP 0053, LLP 0074, LLP 0076, LLP 0086, LLP 0102, LLP 0126, LLP 0218, LLP 0230,
LLP 0254, Diaries 0027–0031, https://www.instantdb.com/essays/architecture,
https://github.com/instantdb/instant

## Summary

InstantDB (instantdb.com, YC S22, Apache-2.0) is the system whose *surface*
overlaps Snapback's most completely: live relational queries by default,
optimistic transactions with server-authoritative last-write-wins, a permission
language evaluated on the live path, first-class ephemeral presence/topics
rooms, files and streams as graph entities, signed webhooks, built-in auth,
and an aggressively agent-first DX (remote MCP, skills, llms.txt,
programmatic app creation). It shipped "Instant 1.0" in April 2026 under the
banner "the best backend for AI-coded apps." Until the July 2026 pass it had
**zero coverage** in the corpus — [LLP 0001](./0001-prior-art.research.md)
never listed it — despite being, with Convex
([LLP 0074](./0074-convex-competitive-strategy.rfc.md)), one of the two
closest living competitors.

The headline findings for Snapback:

- **The later five-app bakeoff validates the agent-authoring thesis in
  practice, within explicit causal limits.** InstantDB had the smallest
  mechanical total of retained active builder time and repeatedly earned
  praise for one graph vocabulary spanning schema, live queries, optimistic
  transactions, offline custody, permissions, rooms, identities, and tests.
  The deeper finding is semantic compression: agents state a small number of
  product facts and the provider owns many temporal consequences. Its
  authoring ratings decline when complex trusted workflows and missing
  platform capabilities replace the collaborative data plane.
- **Instant independently validates Snapback's core bets.** Attribute-level
  LWW with server-authoritative acceptance and *no CRDTs in the core*
  (corroborating [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) and
  [LLP 0022](./0022-electric-powersync-turso.research.md)'s convergence);
  permissions enforced inside the live invalidation pipeline; ephemeral
  presence as a separate non-persisted lane
  ([LLP 0013](./0013-ephemeral-realtime-state.rfc.md)); and agent-first DX as
  the wedge, argued from multi-tenant economics.
- **The architectures diverge underneath an almost identical surface.**
  Instant is a **triple store (EAV) on one shared Aurora Postgres** with a
  Clojure sync server and a client-side Datalog engine; per-app isolation is a
  logical `app_id`, and "creating a database is a few rows." Snapback's answer
  to the same scale-to-zero-per-app requirement is physical isolation
  (DO-SQLite per app). Instant has already paid real EAV-at-scale costs
  (query-planner statistics collapse at a few hundred million tuples,
  compensated with Count-Min Sketch machinery).
- **The gaps run in both directions, and they are specific.** Instant still
  has no hosted server functions (founder-acknowledged April 2026; still
  absent in the 2026-08-13 docs), no declared partial sync independent of
  mounted queries, no SQLite/portability story, no ordinary full-text or
  vector search, and no first-party scheduler or secrets plane. It has
  closed more of the "complete backend" gap than the July pass recorded:
  `$files` storage-as-graph, signed webhooks, Stripe recipes, permission
  rate limits, nightly backups, and documented VPS/AWS self-hosting. The
  revocation question is no longer a silence — the LLP 0086 probe observed
  live eviction on data-dependent rule matches and reconnect-only eviction
  on rule change; related-entity authority changes can still leave a live
  view stale (Diary 0030, ~12 s). Snapback lacks Instant's client-side
  Datalog engine, guest auth, durable resumable Streams, `$files` as
  first-class graph entities, one-command temporary apps, and its
  model-benchmark content engine.

## How to read this — provenance and confidence

Factual claims were gathered and cross-checked against primary sources —
vendor docs, dated vendor essays, the GitHub repo, and founder statements in
dated Hacker News threads — fetched **2026-07-23**, then re-fetched
**2026-08-13** against the current docs index (`/llms.txt`) and the pages
listed under Primary sources. Bakeoff behavioral claims are pinned to Instant
**1.0.52** (Diaries 0027–0031, 2026-07-28/29). Tags follow
[LLP 0022](./0022-electric-powersync-turso.research.md):

- **[confirmed]** — verified against a dated primary source (URL inline or in
  the source list). Default for factual claims here.
- **[observed]** — vendor- or secondary-source-stated but not independently
  verified (funding databases, team size, unverified feature status); also
  used for bakeoff-diary behavior that was not re-probed in this pass.
- **[inferred]** — this document's analysis of what a finding means for
  Snapback. Argument, not fact.

Instant iterates quickly (storage, streams, webhooks, Stripe, infinite
queries, and production self-host guides all thickened between the July and
August fetches). Re-verify before any claim here hardens into a Snapback
decision.

## Why InstantDB, measured against what

Instant is the first surveyed system that competes on **Snapback's whole
surface at once** rather than one axis, so nearly every owning LLP has a
stake: live queries and partial sync
([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)), permissions on the
live path ([LLP 0011](./0011-auth-and-permissions.rfc.md),
[LLP 0053](./0053-authorization-invalidation.rfc.md)), ephemeral realtime
state ([LLP 0013](./0013-ephemeral-realtime-state.rfc.md)), app-instance
boundaries and multi-tenant economics
([LLP 0018](./0018-app-instance-boundaries.rfc.md)), storage substrate and
portability ([LLP 0007](./0007-storage-portability.spec.md)), assets and
after-commit effects, agent DX
([LLP 0010](./0010-agent-dx-and-acceptance.spec.md),
[LLP 0024](./0024-agent-operating-surface.spec.md)), the tiny ordinary data
surface ([LLP 0254](./tombstones/0254-tiny-ordinary-data-surface.rfc.md),
withdrawn), and the
competitive strategy frame
([LLP 0074](./0074-convex-competitive-strategy.rfc.md)).

## Findings

### Identity and trajectory

Founded by Joe Averbukh and Stepan "Stopa" Parunashvili (ex-Facebook/Airbnb);
the design lineage is public and essay-driven: "Database in the Browser, a
Spec" (2021) → "A Graph-Based Firebase" (2022) → YC S22 → open-source Show HN
2024-08-22 (1,145 points) → BaaS-complete January 2025 → agent repositioning
through 2025 → **Instant 1.0, ~April 2026**, HN-launched with a full
architecture essay. Current self-description: "the best backend for AI-coded
apps. You get auth, permissions, storage, presence, and streams." [confirmed —
instantdb.com/about, /essays/db_browser, /essays/next_firebase, HN 41322281,
HN 47707632, github.com/instantdb/instant]

The "pivot" is positioning, not architecture: asked directly whether Instant
abandoned local-first for AI, the founders answered that most of their users
are coding with AI and they optimized for that audience; the sync-engine core
is unchanged. [confirmed — HN 47711024, HN 47707632]

### Architecture — a triple store on one big Postgres

- **Data model:** triples (`[entity, attribute, value]`, EAV) in a single
  Postgres table, all apps multi-tenant on **one Aurora instance**
  (db.r6g.16xlarge; sub-terabyte, ~1.8M tuples/s read, ~500 tuples/s write at
  the December-2024 measurement). "Creating a new database is effectively
  free. Just... a few rows in the database." [confirmed — /essays/architecture,
  /essays/pg_upgrade]
- **Server:** Clojure sync servers tail the Postgres WAL (logical
  replication); queries register **topics** describing the index regions they
  depend on; the invalidator matches WAL entries against topics, re-runs
  affected queries, runs `view` permissions on the results, and pushes novelty
  over WebSocket. Lineage explicitly credited to Asana's and Figma's internal
  reactive-query systems. Invalidation matching was originally O(N²) and was
  optimized with pruned tree structures; multi-tenant fairness comes from a
  "Grouped Queue" (serial per app, parallel across apps). [confirmed —
  /essays/architecture]
- **Client:** a client-side triple store plus a **Datalog engine** (InstaQL
  compiles to Datalog), persisted to IndexedDB / AsyncStorage; offline reads
  resolve locally against the cache of previously-subscribed query results.
  [confirmed — /essays/architecture, repo README]
- **Dual execution path:** the same InstaQL query is Datalog on the client
  and SQL on the server — "one query language, two execution paths: datalog
  locally for speed, SQL on the server for truth." Writes follow the same
  split: InstaML becomes triple steps locally and SQL against Postgres on
  the server. [confirmed — /about, fetched 2026-08-13]
- **EAV at scale hurts, and they say so:** "after we reached a few hundred
  million tuples... Postgres started having troubles" — the query planner
  loses frequency statistics on a single giant EAV table; Instant built
  Count-Min-Sketch-based column statistics to compensate. [confirmed —
  /essays/architecture, /essays/count_min_sketch]
- **Hosted scale (2026-08-13):** Instant Cloud's published capacity in the
  AWS self-host guide is 3× `m6a.16xlarge` application servers and Aurora
  `db.r8gd.16xlarge`, claimed at 10,000+ concurrent connections, 10,000+
  queries/s, and 1,000+ transactions/s. That supersedes the December-2024
  `db.r6g.16xlarge` / ~500 tuples/s write snapshot for *current* hosted
  scale; keep the earlier numbers as the planner-pathology measurement.
  [confirmed — /docs/self-hosting/aws]
- **Self-hosting is now a documented production path, not a Compose
  caveat.** The 2026-08-13 docs split three guides: VPS from ~$30/mo for
  side projects; AWS from ~$600/mo ("same general architecture Instant Cloud
  uses" — Aurora PostgreSQL 17 with logical replication and `pg_hint_plan`,
  private S3, two or more backends clustered over Hazelcast/gRPC for
  presence and topics); and Cloud→self-host restore of a backup zip. The AWS
  guide is Instant's BYO-Postgres landing: you bring *Aurora 17 with
  logical replication*, not arbitrary Postgres. Agents are told to ask
  side-project vs startup before fetching the matching `.md` guide.
  [confirmed — /docs/self-hosting, /docs/self-hosting/vps,
  /docs/self-hosting/aws, /docs/self-hosting/migrate]
- **Schema-as-code** (`instant.schema.ts`) is the shared graph vocabulary:
  entities, typed attributes (`string`/`number`/`boolean`/`date`/`json`/
  `any`), required vs `.optional()` vs `.clientRequired()`, `.unique()`,
  `.indexed()`, bidirectional links with cardinality and `onDelete:
  cascade`, plus `rooms`. System namespaces `$users`, `$files`, and
  `$streams` live in the same file. Client `transact` will still create
  missing attrs until `attrs` create-rules lock the schema. [confirmed —
  /docs/modeling-data]
- **No hosted server functions.** The founder, April 2026: "We don't support
  [functions] just yet"; the 2026-08-13 docs still point at the Admin SDK /
  Admin HTTP API called from your own Next.js/Workers/server, plus webhooks
  for committed-write side effects. [confirmed — HN 47707632, /docs/backend,
  /docs/http-api, /docs/webhooks]

**[inferred]** The shared-Aurora triple store and Snapback's DO-SQLite-per-app
are two answers to the *same* requirement — an idle app must cost ~nothing and
creation must be instant. Instant achieves it logically (rows in a shared
table) and pays with EAV planner pathology, per-app fairness queues, and a
shared blast radius the HN commentary keeps probing; Snapback achieves it
physically and pays with per-app cold starts and fleet-migration fan-out
([LLP 0018](./0018-app-instance-boundaries.rfc.md),
[LLP 0022](./0022-electric-powersync-turso.research.md) §db-per-tenant).

### InstaQL — live queries by default

- Queries are JS objects ("GraphQL-like without the build step") compiled to
  Datalog; nested namespaces express relations in both directions. Every
  `useQuery` is a live subscription; `queryOnce` is the opt-out and throws
  offline. [confirmed — /docs/instaql]
- Expressiveness limits are concrete: comparison and `$like`/`$ilike`
  require **indexed, type-checked fields**; ordering only on indexed fields
  and never on nested attributes (`owner.name`); pagination (`limit` /
  cursors) **only on top-level namespaces**; **no aggregation** (no
  count/sum/avg) in the query language. Nested-*namespace* `order` (order
  the todos under each goal) is now documented; that is not the same as
  ordering by a nested attribute. [confirmed — /docs/instaql, 2026-08-13]
- **Infinite queries** (`useInfiniteQuery` / `subscribeInfiniteQuery`) keep
  the same InstaQL shape and add `canLoadNextPage` / `loadNextPage`. New
  items at the start of the order appear automatically; a query-shape
  change resets to one page. This is Instant's answer to "long feeds"
  without lifting the top-level-pagination restriction. [confirmed —
  /docs/infinite-queries]
- Field selection exists but is explicitly *not* a security boundary — the
  docs warn that a client can just issue another query for the full entity;
  permissions (including field-level `fields` rules) are the only gate.
  [confirmed — /docs/instaql, /docs/permissions]
- **Partial-sync semantics are query-scoped caching, Firebase-style:** the
  client holds the union of results of queries it has mounted. There is no
  declared synced subset independent of mounted queries — no PowerSync-style
  sync rules, no Electric-style shapes. [confirmed-absence — docs pass]

**[inferred]** This is the same "one primary mechanism: subscribe to a query"
convergence [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) bets on,
with a weaker contract than Snapback's (no declared read-set, no durable
client cursor story surfaced in docs). The indexed-fields-only and
top-level-pagination restrictions are Instant's version of the "expressive
queries are the next wall" finding from LLP 0022 §5 — every peer ships a
constrained subset first.

### Write path — optimistic queue, attribute-level LWW, server-final

- API: `db.transact(db.tx.ns[id].update(...))` with `create`/`update`
  (upsert-default)/`merge` (deep-merge, arrays overwrite)/`delete`
  (cascades)/`link`/`unlink`; client-generated UUIDs; `lookup()` for
  unique-attribute addressing; per-call atomic commit. [confirmed —
  /docs/instaml]
- Optimistic changes go into a **separate pending queue**, not the committed
  local store; the local view is committed-store + queue replay, so
  server rejection (e.g. a permission failure) = drop the queue entry and
  "undo works out of the box." [confirmed — /essays/architecture]
- Conflict model: **"LWW on the attribute level which greatly reduces
  conflicts"** (founder, April 2026); the founding essay argues triples make
  concurrent edits to different attributes a non-conflict and calls LWW "a
  great 80/20," with CRDTs explicitly deferred. Offline writes queue and sync
  on reconnect; the precise rebase ordering of the pending queue against
  remote novelty is demonstrated interactively but never spec'd. [confirmed —
  HN 47707632, /essays/next_firebase; observed — /product/sync demo]

**[inferred]** A fourth independent data point for
[LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)'s pinned model —
server-authoritative, LWW-per-field, no CRDT core — from the peer whose
*surface* most resembles Snapback's. The pending-queue-plus-immutable-store
client design also matches LLP 0008's separate-optimistic-layer direction
(and Electric/TanStack DB's, per LLP 0022).

### Permissions — CEL on the live path, default-allow

- Rules are Google **CEL** expressions per namespace with
  `view`/`create`/`update`/`delete`; chosen for speed and sandboxability.
  `view` runs **post-query, on every object, including during live
  invalidation** — the session pipeline is WAL → topic match → re-run query →
  run `view` → push novelty. Relational checks via `data.ref`/`auth.ref`;
  `ruleParams` pass request-scoped context; an `attrs` meta-namespace can
  forbid dynamic attribute creation ("schema lockdown" against rogue agents).
  [confirmed — /docs/permissions, /essays/architecture]
- **Default-allow is data-only.** Absent rules mean `true`; `"$default":
  "false"` opts into default-deny per namespace or globally. `$files` and
  `$streams` default closed — Instant splits onboarding-speed (ordinary
  rows) from fail-closed (bytes and durable streams). [confirmed —
  /docs/permissions, /docs/storage, /docs/streams]
- **Field-level `fields` rules** can hide attributes (the docs' example:
  `$users` viewable, `email` only when `auth.id == data.id`). Combined with
  the InstaQL warning that `fields:` is not a security boundary, this is
  Instant's actual column gate. [LLP 0230](./0230-data-layer-authorization-prior-art.research.md)
  records why projection-time field masking is not itself a boundary;
  Instant's rule still runs post-query per object. [confirmed —
  /docs/permissions]
- **Request context in CEL** now includes `request.time`, `request.origin`,
  `request.ip`, and `request.modifiedFields` (the list of fields a create/
  update is setting — used to allow "anyone may increment `likes`, only
  the owner may edit `title`"). Bakeoff arms needed `request.modifiedFields`
  to authorize link-only reverse-field writes. [confirmed —
  /docs/permissions; observed — Diaries 0028, 0030]
- **`$rateLimits`** are token-bucket objects in the same perms file;
  `rateLimit.name.limit(key)` is callable from any allow rule. View rules
  consume one token *per returned entity*, not per request — a 50-row query
  burns 50 tokens. Keys are typically `auth.id` or `request.ip`. Exceeding
  the bucket returns `type: "rate-limited"` with `retry-after`. [confirmed
  — /docs/rate-limits]
- **Guest-auth coupling:** setting `$users.create` to `false` also blocks
  native guest sign-in. Safe at runtime, not prominent in the guest-auth
  docs. [observed — Diary 0027]
- Post-query filtering cost is acknowledged; converting CEL to `where`-clause
  pushdown was planned in 2024, shipped-status still unverified on the
  2026-08-13 docs pass. [confirmed — HN 41322281; observed — pushdown
  status]
- **Undocumented: revocation eviction.** Nothing in the fetched docs states
  whether a permission change proactively invalidates live queries and evicts
  previously-synced rows from the client cache, or only filters future
  results. [confirmed-absence]
- **Probe-observed (2026-07-23): the behavior is split by revocation shape.**
  The LLP 0086 CC-3.3 preregistered probe (receipts and runnable protocol in
  `tests/probes/instant-eviction-20260723/`) observed, on a live
  `@instantdb/core` client with a delivered row: **data-dependent revocation
  evicts live** — flipping the row attribute a `data.visibleTo == auth.email`
  view rule matches produced a server-pushed delta removing the row **~32 ms**
  after the admin-transact ack; **rule revocation does not** — pushing the
  view rule itself from permissive to `false` produced zero traffic to the
  connected client across the full 120 s window, with the row filtered only
  on fresh reconnect. So Instant re-evaluates data-dependent permissions on
  data change but does not re-evaluate live subscriptions on rule change.
  Provenance caveat: run on a self-provisioned ephemeral probe app (the
  supplied app's admin token mismatched); platform behavior assumed
  app-independent. [observed]

**[inferred]** Two Snapback differentiators fall out. First, default-allow
on ordinary rows is the opposite of
[LLP 0011](./0011-auth-and-permissions.rfc.md)'s fail-closed posture —
defensible for onboarding, alarming for agent-generated apps, and worth
naming in competitive material — but Instant already fail-closes `$files`
and `$streams`, so the contrast is no longer a single global default.
Second, Snapback has a *ratified answer* to authorization invalidation
([LLP 0053](./0053-authorization-invalidation.rfc.md): server-directed
fail-closed reauthorization, fresh snapshots) where Instant is publicly
silent; the honest comparison is "we specified the revocation path; they
demo the happy path."

**[correction, 2026-07-23]** The probe above narrows the second inference:
Instant's *implementation* does evict live on data-dependent revocation, so
"publicly silent" may not be read as "does not evict." What survives is the
narrower, still-real differentiator: Snapback's path is specified,
acceptance-tested, ACK-backed, and lease-bounded (LLP 0053, local target per
its coverage note), and covers rule-change invalidation — the shape Instant
was observed *not* to deliver to live clients — while Instant's behavior in
both shapes remains undocumented. The LLP 0074 claim text was narrowed
accordingly (LLP 0086 CC-3.4).

**[observed — Diary 0030]** A third revocation shape is related-entity
authority change. After Alice flipped an event's `guestListVisible` flag,
Bob's already-connected invitation query stayed populated for ~12 s while
a fresh query returned zero. Instant invalidates on the subscribed
namespace's own triples; a permission that traverses a *related* entity
does not reliably close the live view. The Partiful arm denormalized
visibility onto every invitation to make the subscribed namespace itself
change.

### Ephemeral state — rooms, presence, topics, and now Streams

- `db.room(type, id)` scopes ephemeral context; **presence** is
  per-connection latest-state shared with peers, auto-cleaned on disconnect;
  **topics** are fire-and-forget broadcast. The docs' decision framework is
  verbatim-close to [LLP 0013](./0013-ephemeral-realtime-state.rfc.md)'s
  model: `transact` to persist to the DB, `presence` for room-persistent but
  not-DB state, `topics` for broadcast-without-persistence. Drop-in `Cursors`
  and typing-indicator components; typed room schemas. No published limits or
  fan-out numbers. [confirmed — /docs/presence-and-topics; observed — scaling]
- **Streams** (LLM-era): durable, resumable channels implementing the Web
  Streams API — "because streams are backed by storage, they never expire.
  A reader can pick up from any point... and resume." One writer per
  `clientId`; rules default closed. `$streams` is a first-class queryable
  namespace (`id`, `clientId`, `done`, `size`, `abortReason`, plus custom
  columns) and can be linked like any other entity. [confirmed —
  /docs/streams]
- **AI-chat path:** `@instantdb/resumable-stream` is a drop-in for Vercel's
  `resumable-stream` (no Redis, streams never expire). A custom
  `DefaultChatTransport` can resume an interrupted completion *from the
  browser* by querying `$streams` and calling `createReadStream`, without
  hitting the app's backend again. `create-instant-app --base ai-chat`
  scaffolds the pattern. Serverless writers take `waitUntil` so the
  isolate is not torn down before flush. [confirmed — /docs/streams]

**[inferred]** Rooms/presence/topics independently corroborate LLP 0013's
"ephemeral state is not faster durable data" split. Streams is the
interesting novelty: a *persisted realtime* primitive between LLP 0013's
ephemeral lane and durable rows — exactly the seam
[LLP 0076](./0076-bounded-streamed-actions.rfc.md) is designing for
bounded streamed actions. Instant's framing (storage-backed, resume-from-any-
offset, single-writer) is a concrete external design to compare against.

### Auth

Magic-code email OTP, **guest auth** ("try before sign-up," a genuinely good
onboarding idea), OAuth (Google/Apple/GitHub/LinkedIn), Clerk and Firebase
Auth integrations, custom auth via Admin SDK, and a `$users` system namespace
that ties identities into the permission language. [confirmed — /docs/auth]
The Admin HTTP API exposes the same impersonation surface without JavaScript
(`As-Email`, `As-Token`, `As-Guest`) plus user CRUD, sign-out, custom magic
codes, and backend SSE subscriptions. There is also a Python admin SDK.
[confirmed — /docs/http-api, /docs/backend, /docs/start-python]
**[inferred]** Guest auth with later account claiming is worth evaluating for
[LLP 0011](./0011-auth-and-permissions.rfc.md)'s paved path; it converts the
demo-app funnel directly.

### Storage — files as graph entities

The July 23 pass recorded Instant's marketing line ("auth, permissions,
storage, presence, and streams") but did not inventory Storage. The current
docs make `$files` a first-class namespace in the same graph:

- Schema declares `$files` with `path` (unique, indexed) and `url`; extra
  columns and links to profiles/users are ordinary Instant links. Upload is
  `db.storage.uploadFile(path, file, opts?)`; overwrite is path-collision;
  delete and path rename go through `db.transact` on `$files`. The live
  `$files` query updates when an upload completes. [confirmed —
  /docs/storage]
- Permissions default **closed** until `view`/`create`/`update`/`delete` are
  set. The only documented file metadata in rules is `data.path`, so the
  blessed ACL is a path prefix (`data.path.startsWith(auth.id + '/')`).
  Linking a file requires `view` on `$files` plus `update` on the forward
  entity. [confirmed — /docs/storage]
- React Native has an Expo File / Blob path; the Admin SDK uploads buffers
  or streams (streams require `fileSize`). The Admin HTTP API has matching
  upload/delete endpoints. [confirmed — /docs/storage, /docs/http-api]

**[observed — Diaries 0030, 0031]** Storage shares the rule language and
worked for ordinary upload / outsider-denial / metadata-delete. Two sharp
edges: Admin `asUser` still bypassed Storage policy, so the real boundary
required independent Core clients; and an already-issued signed URL (and
even a newly issued delivery path) remained usable during the observation
window — complete asset-capability revocation is a GAP. File linking also
creates a view-permission bootstrap problem before the reverse link exists.

**[inferred]** Instant's move is the same compression as the data plane:
files are not a second product. `$files` is queryable, linkable, permissioned,
and live. Snapback's asset surface should match that graph locality while
beating Instant on capability revocation of issued URLs — the place Instant
is weak and [LLP 0053](./0053-authorization-invalidation.rfc.md)-style
contracts are strong.

### Webhooks, Stripe, and effects without functions

Instant's answer to "no server functions" is no longer just "call the Admin
SDK from Next.js." Three complementary surfaces now cover the trusted
side-effect plane:

- **Webhooks** subscribe to namespace × `{create, update, delete}`. A
  committed write queues a signed POST (`Instant-Signature`, Ed25519,
  published JWKS). The body is a short-lived URL + JWT; the receiver
  exchanges them for `before`/`after` records (attributes only, no links)
  plus stable per-record and per-batch `idempotencyKey`s. 15 s timeout,
  backoff retries, auto-disable after repeated failure, ~60 days of
  inspectable delivery history, and `resendEvent`. The Admin SDK's
  `processRequest` / typed handlers is the paved receiver; the protocol is
  documented for Python/Go/Ruby/Java. An app may have 100 active webhooks;
  URLs must be public HTTPS. [confirmed — /docs/webhooks]
- **Stripe recipes** (one-off purchase, subscription, credits) all share
  one pattern: Stripe handles payment; a webhook writes Instant via the
  Admin SDK; live queries update the client; permissions (`ruleParams`
  tokens or `$users.subscriptionStatus`) gate the paid bytes. Credits
  deduct on a *server* route in one transaction. [confirmed —
  /docs/stripe-payments]
- **Nightly backups** (7 days on Pro, 30 on Enterprise) are zip archives of
  schema, rules, email template, NDJSON entities (including links as ids),
  and raw `$files` blobs. CLI `backup list` / `backup download`; restore is
  into a self-hosted instance via a superuser intern page. OAuth client
  secrets do not survive restore. [confirmed — /docs/backups, /pricing]

**[observed — Diary 0030]** Native webhooks exposed useful delivery history
and stable idempotency keys, but the arm's deterministic receiver URLs were
rejected at provision time, so known-success dedupe, timeout ambiguity, and
post-cancellation delivery were not proved. The pinned Instant 1.0.52
surface also had no first-party scheduler or hosted function-secret
boundary.

**[inferred]** This is Instant filling the complete-backend hole *around*
the missing functions runtime rather than crossing it. Webhooks are
after-commit notifications, not transactional trusted logic; Stripe credit
deduction still needs the author's server. Snapback's functions + effects +
schedules + secrets remain the architectural moat — but Instant now has a
credible "your Next.js route plus our webhook" story that agents can
scaffold, and a Stripe content engine aimed at the same agents. Compare
directly while designing bounded streamed actions
([LLP 0076](./0076-bounded-streamed-actions.rfc.md)) and effect settlement
([LLP 0218](./0218-outbox-settlement-contract.rfc.md)).

### Agent-first DX — the current high-water mark

Instant ships: a hosted **remote MCP server with OAuth**
(mcp.instantdb.com — tools `learn`, `get-schema`, `get-perms`, `push-schema`,
`push-perms`; they operate schema and permissions, not data), a local stdio
MCP, `npx skills add instantdb/skills`, per-agent rules files scaffolded by
`create-instant-app`, `llms.txt`/`llms-full.txt`, every docs URL serving raw
markdown with a `.md` suffix, a **Platform API** for programmatic app
creation, a **Supabase-migration prompt**, and `create-instant-app --base
ai-chat`. The strategic argument ("How and where will agents ship software?",
with Nikita Prokopov on staff): agents need built-in abstractions,
multi-tenant hosting ("Hosting 20,000 single-user apps via traditional VMs
would cost approximately $95,000/month versus $800/month"), and exposed data;
"sync engines are a tight abstraction, so agents can... write more concise
code with fewer tokens and fewer mistakes." A recurring "Counter-Strike
benchmark" essay series pits frontier models against each other building a
multiplayer game on Instant. Self-host docs are themselves agent-addressed:
ask side-project vs startup, then fetch the matching `.md` guide. [confirmed
— /docs/using-llms, /docs/cli, /docs/self-hosting, /essays/agents,
/essays/architecture, essay index]

**[inferred]** This clears PowerSync's bar from LLP 0022 §9 and raises it:
the remote-MCP-with-OAuth + programmatic-platform combination means an agent
can go from nothing to a provisioned, schema'd, permissioned app without a
human dashboard session. [LLP 0010](./0010-agent-dx-and-acceptance.spec.md)
and [LLP 0024](./0024-agent-operating-surface.spec.md) should treat that,
plus benchmark-as-content marketing, as the competitive reference. Their
"scale to millions of apps, not just millions of users" line is Snapback's
own DO-per-app thesis, stated by a competitor as the reason *their*
multi-tenancy exists.

### Business, licensing, maturity

- **Apache-2.0, fully open** — "we have no private repos"; no
  source-available restriction; nothing stops hosting it for others. By
  [LLP 0033](./0033-license-posture.decision.md)'s standard Instant is in the
  truly-open camp with Snapback (MIT), unlike PowerSync's FSL. [confirmed —
  repo LICENSE, HN 41322281, HN 47707632]
- $3.4M seed (2024-10-02): YC, SV Angel, Paul Graham, Greg Brockman, Jeff
  Dean, and Firebase's original CEO James Tamplin. A ~$11.2M Series A
  (2025-03) appears only in secondary funding databases — no vendor
  announcement. [confirmed — /essays/seed; observed — Tracxn]
- Small team; 10.4k GitHub stars; hiring for "100k+ connections" backend
  scale. Named production users are modest (Mirando, HeroUI) — no big-logo
  list. [confirmed — repo, /hiring, essay index; observed — team size]
- Pricing: free tier with 1GB and "free projects are never paused"; Pro
  $30/mo (10GB, 10 team members, daily backups for last 7 days); Startup
  $600/mo (250GB, unlimited team members and Pro apps); Enterprise custom
  (30-day backups, uptime SLAs). Storage counts toward database space.
  [confirmed — /pricing]
- Client coverage beyond React: React Native, Vanilla JS, Solid, Svelte 5,
  Vue 3, TanStack Start, Python admin, experimental Next.js SSR, and an
  embeddable Explorer component. [confirmed — /llms.txt, 2026-08-13]

**[inferred]** The investor set (Firebase's founder, PG, Brockman, Dean) and
the benchmark-content engine buy outsized mindshare relative to revenue
evidence. Per LLP 0001's fragile-suppliers theme, Instant is better
capitalized than the survey-batch systems but is still a small team carrying
a very large surface — the same comprehensiveness risk Snapback carries,
minus Snapback's optionality on self-hosting economics.

## 2026-08-13 field study — why coding agents favored the authoring model

The original 2026-07-23 pass above established that InstantDB deliberately
targets agents and inferred why its surface should work well for them. LLP
0102 subsequently supplied a stronger kind of evidence: fresh-context coding
agents built five different applications on InstantDB under a frozen protocol,
using the provider's idiomatic path rather than a lowest-common-denominator
adapter. The agents retained timings, failed attempts, acceptance evidence,
and immutable diary entries. This section asks the narrower question:

> What, specifically, did builder agents repeatedly like about authoring on
> InstantDB, and what properties of the surface plausibly caused that result?

### Evidence boundary and confidence

The five applications were an offline shared Todo, realtime group chat, a
Linear-shaped issue tracker, a Partiful-shaped event application, and a
collaborative AI research room. All five Instant arms used Instant **1.0.52**
(Todo self-hosted from official images; Chat/Linear/Partiful/Research Room
on hosted temporary apps). Their InstantDB arms reported:

| Application | Active elapsed | Product result | Independent authoring rating |
| --- | ---: | ---: | ---: |
| Todo | 31.68 min | 14 PASS / 0 GAP / 0 FAIL | 5 / 5 |
| Chat | 30.55 min | 13 PASS / 2 GAP / 0 FAIL | 4 / 5 |
| Linear | 16.25 min | 12 PASS / 2 GAP / 0 FAIL | 4 / 5 |
| Partiful | 36.35 min | 9 PASS / 6 GAP / 0 FAIL | 3 / 5 |
| Research Room | 17.64 min | 11 PASS / 4 GAP / 0 FAIL | 3 / 5 |

The raw timing source is each
`demos/backend-bakeoff/arms/<app>/instantdb/run-capsule.v1.json`; product and
rating summaries are in the LLP 0102 final report and
`demos/backend-bakeoff/reports/independent-ratings.v1.json`. A mechanical sum
is 132.46 active minutes, the smallest five-arm total in the retained record.
That total is descriptive, not a normalized productivity benchmark. Machine,
target, cache, assistance, instrumentation, and provider completeness differed;
missing product capabilities can shorten an arm by turning work into GAPs.
LLP 0102 expressly forbids collapsing the raw authoring record into fake
precision.

Confidence is therefore split:

- **High confidence [observed]:** the same favorable themes recur across five
  independently executed app diaries and are visible in the retained source.
- **Moderate confidence [inferred]:** semantic compression, locality, and
  provider-owned temporal behavior explain why those themes help coding
  agents. The study did not isolate one API property at a time.
- **Low confidence:** the exact size of InstantDB's speed advantage or whether
  it generalizes across model families, machines, and production workloads.
  The bakeoff controlled the prompt and assistance policy but was not a
  randomized causal experiment of authoring-surface design.

The independent reviewer picked InstantDB for Todo despite its fifth-place
overall composite, specifically because the complete offline path was
exceptionally compact. That distinction matters: the evidence supports an
excellent *collaborative data-plane authoring model*, not the claim that
InstantDB was the most complete backend.

### Finding 1 — the application remained locally legible

**[observed]** In the Todo arm, the central rendered graph was declared next
to the component that consumed it:

```ts
const query = db.useQuery({
  workspaces: {
    memberships: { user: {} },
    lists: { tasks: {} },
  },
});
```

Creating a task was one atomic transaction over the same vocabulary:

```ts
db.transact([
  db.tx.tasks[taskId].update(fields).link({ list: selected.id }),
  db.tx.lists[selected.id].update({ taskOrder: order }),
]);
```

The implementation is retained at
`demos/backend-bakeoff/arms/todo/instantdb/work/src/App.tsx`. The Chat arm was
equally direct: `db.useQuery`, `db.room`, `useSyncPresence`, `usePresence`,
`useTypingIndicator`, and `db.transact` sit together in the React component.

**[inferred]** This is unusually compatible with an agent's bounded context.
The desired UI state, read declaration, transient collaboration state, and
write intent are inspectable in one local region. The agent does not need to
reconstruct behavior across an endpoint, resolver, ORM, DTO, cache key,
subscription router, optimistic callback, and component. Locality reduces
retrieval work and makes a code review more likely to catch a mismatch.

This is not merely low source-line count. It is low **semantic distance**
between the product sentence and the authored expression. “Show the
workspace's lists and tasks” resembles the query object; “create this task,
link it to this list, and update the order atomically” resembles the
transaction.

### Finding 2 — one graph vocabulary crossed every authoring surface

**[observed]** TypeScript schema-as-code placed entities, field types,
uniqueness, indexes, link cardinality, reverse-link labels, requiredness,
cascade behavior, and room declarations in one readable artifact. The same
entity and link names then appeared in:

- nested InstaQL queries;
- client transactions and link operations;
- CEL permission traversals;
- React result types;
- Core and Admin SDK operations; and
- seed, acceptance, and cleanup tooling.

The Linear builder praised typed schema, indexes, links, direct transactions,
live subscriptions, optimistic materialization, and IndexedDB/outbox behavior
as one compact combination. The Partiful builder noted that the same model
drove React, Core, and Admin clients. The Research Room builder used unique
and indexed keys, atomic linked writes, and `asUser` without constructing a
parallel server model.

**[inferred]** Agents are especially vulnerable to representation drift:
`workspace_id` in SQL becomes `workspaceId` in a DTO, `workspace` in an ORM,
`workspace-members` in a subscription topic, and a hand-authored cache key in
the client. InstantDB makes the graph its shared language. Once an agent learns
`task.list.workspace.memberships.user`, it can reuse that path to query,
write, authorize, and test rather than repeatedly translating it.

The schema also narrows the search space. A typed, indexed, linked declaration
answers many questions before the agent improvises: which relations exist,
their direction and cardinality, which fields may be queried efficiently, and
which identifiers are stable. This is a stronger aid than autocomplete alone;
it removes independent decisions.

### Finding 3 — reads were desired-state subscriptions, not fetch choreography

**[observed]** `useQuery` and `subscribeQuery` delivered an initial result and
then tracked authoritative transitions. Ordinary collaborative data required
no separately authored initial fetch, WebSocket registration, event reducer,
cache invalidation, local-echo deduplication, or fetch/subscription readiness
barrier. Cursor pagination also stayed within the query model: the returned
opaque `endCursor` fed directly into `after`, and the Chat arm proved two
disjoint pages under a concurrent insert.

The Research Room builder's formulation is the clearest: “A subscription
declares desired state, delivers an initial snapshot, and tracks authoritative
transitions.” The Chat builder called client-first realtime “extremely
compact.” The Linear arm needed no channel or publication setup.

**[inferred]** Desired-state subscriptions transfer temporal ownership to the
backend. The application declares *what should be true now* rather than
assembling *how to get there over time*. For agents, this removes a class of
ordering problems whose code may look plausible in isolation but fail only
under reconnect, concurrent writes, or a missed event.

The result is also easier to verify. A second principal can subscribe, an
operation can run, and the harness can wait for the desired state. That is a
shorter evidentiary loop than proving a custom event pipeline and client cache
converge.

### Finding 4 — the normal transaction API owned optimism, queueing, and undo

**[observed]** The Todo and Linear arms used the same `db.transact(...)` call
online and offline. InstantDB projected writes optimistically, retained pending
work separately from committed local state, queued it while disconnected, and
reconciled after reconnect. Server rejection removed the pending projection
rather than requiring application-authored rollback logic.

The Todo arm proved the difficult version, not merely a warm-cache demo:

1. a browser profile loaded 100 protected rows online;
2. the exact server went down and the connection closed;
3. the browser process closed;
4. a new process reopened the profile while the server remained down;
5. IndexedDB restored all 100 rows;
6. offline create and update appeared optimistically and queued; and
7. reconnect produced the authorized update and exactly one create.

The diary's summary was that typed graph schema, direct React queries,
optimistic transactions, native live updates, durable IndexedDB, the offline
transaction queue, guest auth, and permissions fit together “without
application-side repositories or synchronization plumbing.” The app was
recognizably the product, not a custom sync engine.

**[inferred]** This is the strongest authoring result because it makes a hard
distributed-systems property a consequence of the ordinary path. The agent
did not have to choose a local database, define a mutation journal, serialize
intent, assign idempotency keys, merge remote novelty, rebuild cache state, or
write reconnect settlement. Those omitted decisions are precisely where a
nominally simple API can hide a large day-two system.

The key lesson is not that every detail should be implicit. It is that one
authored operation should own one truthful lifecycle. Snapback can expose more
explicit settlement states than InstantDB while still ensuring that optimism,
durable custody, replay, and reconciliation are consequences of the same
operation rather than four application subsystems.

### Finding 5 — durable and ephemeral collaboration were distinct but adjacent

**[observed]** The Chat arm persisted messages and unread markers through the
ordinary database path while typing and presence used native rooms. Presence
was connection-scoped and removed on disconnect. Typing did not become a row,
TTL field, sweep job, or cleanup mutation. Both lanes were reached from the
same initialized `db` object and used React-shaped APIs.

**[inferred]** This is a productive kind of conceptual separation. InstantDB
did not pretend ephemeral state was merely faster durable data, but it also did
not make the author integrate a second vendor, transport, identity system, or
lifecycle. The distinction teaches one semantic fact—whether state should
persist—without multiplying operational machinery.

Agents benefit because the prompt's nouns map cleanly: messages are durable;
typing and presence are room state. The implementation does not require the
agent to invent expiry behavior and then remember to test it. This directly
corroborates LLP 0013 and sets an authoring benchmark for Snapback's existing
ephemeral model.

### Finding 6 — native principals made auth and adversarial testing ordinary

**[observed]** Guest auth made browser personas cheap: each isolated profile
received a real Instant user without an inbox or application-level identity
shim. Across the arms, Alice, Bob, and Mallory were distinct principals used
for authorized reads, outsider denial, live delivery, logout, membership
revocation, and cleanup-token invalidation. `db.auth.signInAsGuest()` handled
the client doorway. The Admin SDK's `asUser` and native refresh-token clients
made it practical to exercise operations as particular actors.

The builder agents repeatedly praised this because it compressed both product
and proof code. A permission claim could be tested by switching identity and
observing the real provider path instead of minting bespoke test headers or
calling an admin API and assuming equivalence.

**[inferred]** First-class actors improve agent performance in two ways. They
eliminate identity plumbing from the application, and they turn security from
a static-code inference into an executable experiment. An agent can ask “what
does Mallory see?” and obtain a concrete answer. That shortens debugging and
reduces the temptation to declare authorization complete because a rule file
looks reasonable.

### Finding 7 — relationship permissions matched domain sentences

**[observed]** A Todo task's membership gate could be expressed as:

```text
auth.id in data.ref('list.workspace.memberships.user.id')
```

The Research Room arm demonstrated a stronger linked-policy outcome: after a
question became cancelled, a late progress-row creation was rejected because
the rule traversed to the linked question status. Partiful's
`debugTransact` output exposed evaluated bindings and modified fields, helping
the agent understand why reverse links affected authorization.

**[inferred]** Relationship traversal keeps policy in the same graph language
as reads and writes. The rule is close to the business statement and can be
reviewed without reconstructing a handler's control flow. For an agent, that
is another reduction in representation translation.

This praise has a strict boundary. Link mutations authorize both sides;
`data.ref`/`newData.ref` semantics were sharp; deploy accepted some
unevaluable expressions; diagnostics were often only “Permission denied”; and
Partiful found a 12-second stale protected live view when authority changed
through a related entity. The model was attractive, but its validation and
invalidation closure were not consistently safe or explainable. Snapback
should match the relational policy vocabulary while beating those semantics,
not copy them wholesale.

### Finding 8 — one-command temporary targets gave agents disposable authority

**[observed]** The hosted Chat, Linear, Partiful, and Research Room arms used
`instant-cli init-without-files --temp` to create isolated apps without shared
account state, billing setup, or a dashboard session. One command yielded an
app-scoped credential and documented expiry. Schema and permission pushes then
made diffs visible. This was repeatedly called “exceptional dogfood
ergonomics,” “unusually agent-friendly,” and close to an ideal disposable
target path.

**[inferred]** A disposable target is more than deployment convenience. It
gives an agent a safe experimental authority boundary: failures, migrations,
permission changes, adversarial identities, and cleanup can occur without
reasoning about unrelated user state. That encourages direct testing rather
than cautious simulation.

Target creation also closes a common autonomy gap. The agent need not stop for
a human to create a project, click through OAuth, copy identifiers, or approve
billing. Provisioning, application code, and acceptance can remain one
continuous loop.

The control plane was not uniformly agent-safe. Temporary-app output mixed
JSON and prose, the command printed an admin token, some supposedly
noninteractive paths waited for login or confirmation, schema pushes were
noisy, and the creating credential could not immediately delete the empty app
shell. These failures show the importance of the underlying primitive while
also defining the better Snapback target: strict structured output, secret-safe
carriers, explicit completion, exact identity, immediate scoped deletion, and
a cleanup receipt.

### Finding 9 — the product offered several closed feedback loops

**[observed]** The agents could obtain direct evidence at useful boundaries:

- schema and permission diffs before push;
- TypeScript feedback over schema-derived queries and transactions;
- `debugTransact` evaluation for permission failures;
- live observations from a second native principal;
- Admin SDK authoritative snapshots and counts;
- connection state, optimistic state, and reconnect behavior in clients; and
- exact data/user cleanup checks.

The official common-mistakes page was specifically useful during Research
Room permission debugging. Source and docs described the same compact
vocabulary, and LLP 0082's earlier source pass records InstantDB's broader
agent context: raw Markdown documentation, `llms.txt`, skills, per-agent rule
files, local and remote MCP, and a programmatic Platform API.

**[inferred]** Agent friendliness is not only API smallness. It is the ability
to alternate generation with decisive observation. Each closed loop reduces
the amount of state the model must hold speculatively. Types reject malformed
shapes; a second actor proves delivery; an authority snapshot proves
settlement; a cleanup count proves retirement.

InstantDB's gaps reinforce the rule. Permission errors that omitted the rule,
field, link direction, and binding caused repeated safe-but-slow iterations.
CLI success that still waited at a confirmation UI was easy to misread. Where
the loop was closed, agents moved quickly; where the tool returned ambiguous
or low-information state, they wandered.

### Finding 10 — the surface minimized independent decisions, not just symbols

Across the favorable evidence, InstantDB's most important property is
**semantic compression**. For ordinary collaborative data, a small set of
authored declarations produced many consequences:

| Authored fact | Provider-owned consequences |
| --- | --- |
| Typed entity and link schema | query/write types, relation vocabulary, indexes, cardinality |
| `useQuery` desired-state graph | initial read, live subscription, local materialization, React updates |
| `db.transact` intent | atomic send, optimistic projection, offline queueing, rejection undo, reconnect settlement |
| Relationship permission | fresh reads, writes, and live-result filtering on the native path |
| Room declaration and hook | connection-scoped presence/typing, broadcast, disconnect cleanup |
| Native guest principal | client auth identity, permission subject, repeatable test persona |

**[inferred]** This is why “one `db` object” alone would be a shallow copy. A
large API can be namespaced under one object while leaving the author to make
and synchronize all the same decisions. InstantDB was good because each
declaration carried coherent consequences across time and layers.

The agent-facing benefits follow:

1. fewer concepts must be retrieved before first success;
2. fewer artifacts can drift independently;
3. fewer names require translation;
4. fewer temporal seams require custom coordination;
5. more product facts are visible near the consuming component;
6. hard offline/realtime behavior appears on the ordinary path; and
7. acceptance can exercise native identities and transports directly.

This finding was the direct research antecedent for LLP 0254's now-withdrawn
“tiny ordinary data surface” hypothesis. Familiar naming helps an agent guess;
consequence ownership removes much of what it would otherwise have to guess.

### What agents did not like — necessary counterevidence

The positive result should not erase repeated friction:

- self-host documentation and Compose profiles disagreed, and the local stack
  required several large services;
- CLI modes sometimes became interactive, printed secrets, mixed prose with
  JSON, emitted excessive progress output, or could not delete what they
  created;
- permission deployment did not validate every executable rule, and runtime
  diagnostics often lacked rule/binding/link-direction detail;
- relationship writes could modify reverse fields and require surprising
  permissions on both entities;
- browser-oriented Core clients needed harness work under Node;
- temporary credentials lacked mature logs, rollback, export/restore, and
  exact lifecycle control;
- whole-record LWW and linked uniqueness did not provide semantic CAS or an
  unambiguous loser for complex capacity invariants;
- full-text/vector search, scheduler, hosted functions, secrets, effects, and
  complete asset-revocation semantics were incomplete or absent;
- related-entity authorization changes could leave an established protected
  view stale (Diary 0030: Bob's live invitation query stayed populated for
  ~12 s after Alice flipped the related event's `guestListVisible` flag;
  a fresh query was already empty);
- Admin `asUser` bypassed Storage policy, so the real file boundary needed
  independent Core clients; issued signed URLs remained usable after
  metadata delete (Diary 0030);
- `serverCreatedAt` could order and page rows but was not exposed on the
  entity returned by an admin query, so a required server-owned order field
  could not be shown (Diary 0028);
- denying `$users.create` also disabled native guest sign-in (Diary 0027);
  and
- the Node Core client assumes a browser (skips reactor init without
  browser globals; multiple simulated clients shared `BroadcastChannel`).

These problems explain the authoring-rating decline from 5/5 on Todo to 3/5
on Partiful and Research Room. The authoring model remained pleasant where the
application was a collaborative graph. As trusted workflows and operational
capabilities dominated, omitted backend semantics shifted into application
state machines, denormalization, external infrastructure, or honest GAPs.

### Comparative interpretation

The diaries' cross-provider contrasts make the InstantDB preference more
specific:

- **Against Firebase:** comparable Todo completeness with a smaller, more
  direct application surface; Firebase required explicit cache bootstrap,
  snapshot-metadata aggregation, document/rule plumbing, and a separate Admin
  SDK, while offering much greater maturity and platform breadth.
- **Against Supabase:** far less SQL, RLS, Realtime, and offline machinery for
  the collaborative path; Supabase remained more independently inspectable and
  much stronger for relational authority, search, storage, and escape hatches.
- **Against Convex:** InstantDB won the durable cold-cache and queued-offline
  result; Convex remained more coherent for server functions, local project
  setup, documentation, and trusted online logic.
- **Against Appwrite:** much smaller application and operational surface;
  Appwrite offered a broader complete backend but carried a 28–29-container
  local topology and heavier control-plane ceremony.
- **Against Snapback:** InstantDB made local-first behavior and native rooms
  nearly invisible in ordinary React code; Snapback retained stronger explicit
  authority, conflict, revocation, bounded workflow, effect-settlement, and
  target-identity semantics.

The conclusion is not “client-first always wins.” It is that an ordinary
collaborative data path should be client-near, typed, live, local, and
consequence-complete until a requirement genuinely needs trusted custom logic.
Crossing that boundary should be explicit and progressive rather than required
for the first useful screen.

### Research conclusions for Snapback

The field study strengthens these actions:

1. **Match the semantic compression, not the syntax.** One table/access/query/
   transact model should own types, live materialization, optimism, custody,
   replay, and settlement for ordinary analyzable data. Tombstoned LLP 0254
   preserves the withdrawn experiment; Explicit and Familiar remain the live
   authoring profiles.
2. **Keep desired state primary.** A query should yield an initial bounded
   materialization and authoritative transitions without separate fetch,
   subscribe, cache, and invalidation APIs.
3. **Make local-first the ordinary path.** Durable offline custody and replay
   should not require a repository layer or a second sync product; retain
   Snapback's more explicit settlement truth.
4. **Put durable and ephemeral state beside each other without conflating
   them.** Preserve the LLP 0013 semantic split while making rooms as direct as
   InstantDB's React hooks.
5. **Make principals a first-class testing dimension.** A harness should run
   Alice, Bob, and Mallory against native transports and switch authority
   without bespoke token plumbing.
6. **Offer exact disposable targets.** One noninteractive command should
   create a target and scoped authority; the same authority should support
   inspect, diff, logs, export, stop, and exact deletion with structured,
   secret-safe receipts.
7. **Make errors close the loop.** Permission and transaction diagnostics
   should name the rule, entity, field, relationship direction, evaluated
   bindings, authority source, and safe next action without exposing protected
   values.
8. **Preserve Snapback's stronger semantics.** Do not trade away fail-closed
   policy, active dependency-complete revocation, bounded queries, explicit
   conflicts, exact settlement, assets, schedules, effects, secrets, or
   target identity merely to imitate InstantDB's apparent smallness.
9. **Keep a progressive trusted escape.** Ordinary data should remain tiny;
   custom invariants and workflows should graduate into Snapback functions and
   capabilities without rewriting the client contract or losing offline/live
   behavior.
10. **Measure independent choices.** Future agent studies should count
    authored facts, cross-file seams, retries, ambiguous tool outcomes, and
    proof steps—not only tokens, source lines, or elapsed time.

The durable competitive lesson is precise: agents liked InstantDB when the
provider let them state the product graph once and then owned the repetitive,
temporal consequences. Snapback can exceed that result if it achieves the same
ordinary-path compression while retaining its stronger authority,
settlement, boundedness, portability, and complete-backend model.

## Synthesis — cross-cutting

1. **Surface convergence, substrate divergence.** [inferred] Instant and
   Snapback agree on the product thesis to a startling degree — live queries
   by default, optimistic LWW transactions, permissions in the sync path,
   ephemeral rooms, files and streams in the same graph, agent-first, truly
   open. The load-bearing differences are all below the waterline:
   EAV-on-shared-Postgres vs relational-SQLite-per-app, logical vs physical
   isolation, webhooks-plus-your-server vs functions-as-the-API,
   query-scoped cache vs declared sync contract.
2. **The no-CRDT convergence now includes the closest competitor.** [inferred]
   With Electric, PowerSync, Turso (LLP 0022), and now Instant, every close
   peer lands on server-authoritative LWW. LLP 0008's pinned model is as
   externally corroborated as a design choice gets.
3. **Server functions are still the moat Instant hasn't crossed; the
   workaround has gotten better.** [inferred] Instant's missing functions
   runtime is founder-acknowledged and architecturally non-trivial for them
   (their server is a Clojure sync engine, not a code host). Webhooks,
   Stripe recipes, the Admin HTTP API, and "call Admin SDK from Next.js"
   now cover a lot of the *after-commit* trusted plane, but they are not
   transactional trusted logic and they are not a scheduler/secrets/jobs
   surface. Snapback's schema + functions + acceptance testing + guide
   surface is still the part Instant tells users to build themselves on
   another platform. Competitive material
   ([LLP 0074](./0074-convex-competitive-strategy.rfc.md)) should treat
   "Convex-grade functions, Instant-grade sync surface, open like both,
   isolated like neither" as the positioning triangle — and should not
   pretend Instant has no effects story.
4. **Isolation is a safety argument, not just an ops argument.** [inferred]
   One shared Aurora with `app_id` scoping means every app shares a blast
   radius and a query planner; Instant's own essays document the planner
   pathology. DO-SQLite-per-app turns "your data is a physically separate
   database" into a differentiator that agent-generated app platforms
   (both companies' explicit target) will care about. Self-hosting no
   longer distinguishes the two products the way it did in July: Instant
   now documents VPS and AWS production topologies. What remains is
   *physical per-app isolation* versus *logical rows on one Aurora*.
5. **The complete-backend race is no longer "Instant has sync, Snapback
   has everything else."** [inferred] `$files` as graph entities, Streams
   as queryable `$streams`, webhooks, Stripe, rate limits, backups, and
   production self-host guides close surfaces the July pass treated as
   Snapback-only. The remaining Instant holes that still matter for
   bakeoff-class apps are hosted functions, secrets, schedules, ordinary
   search, declared sync contracts, rule-change / related-entity
   invalidation, and issued-URL revocation.

## What to learn — actionable, mapped to owning LLPs

**Adopt / strongly consider:**

- **Guest auth with account claiming** as a paved-path onboarding feature. →
  [LLP 0011](./0011-auth-and-permissions.rfc.md).
- **A durable resumable stream primitive** (storage-backed, offset-resumable,
  single-writer, queryable as an entity, resumable from the client) for LLM
  token UX — compare directly while designing bounded streamed actions,
  including Instant's `@instantdb/resumable-stream` / `ai-chat` template.
  → [LLP 0076](./0076-bounded-streamed-actions.rfc.md),
  [LLP 0013](./0013-ephemeral-realtime-state.rfc.md).
- **Files as graph entities** (`$files`: live query, links, path-prefix
  permissions, same transact/delete path) rather than a second storage
  product. Beat Instant on issued-URL revocation. → owning asset LLPs.
- **Signed, idempotent webhooks with inspectable delivery history** as the
  after-commit effects door, even when functions exist — Instant shows the
  agent-usable shape (typed handlers, JWKS, resend, 60-day log). →
  [LLP 0218](./0218-outbox-settlement-contract.rfc.md).
- **Rate limits in the permission language** (token bucket, per-principal
  or per-IP, `retry-after`) so agents do not invent a second limiter. Watch
  Instant's "view burns one token per row" footgun. →
  [LLP 0011](./0011-auth-and-permissions.rfc.md).
- **Infinite queries that stay inside the live-query model** (`loadNextPage`
  without a second subscription API). →
  [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md),
  [LLP 0254](./tombstones/0254-tiny-ordinary-data-surface.rfc.md) (withdrawn).
- **`request.modifiedFields`-style write-shape authorization** so "anyone
  may increment likes / only the owner edits title" and link-only reverse
  writes are expressible without a function. →
  [LLP 0011](./0011-auth-and-permissions.rfc.md).
- **Remote MCP with OAuth + programmatic platform API** so agents can
  provision apps end-to-end; docs as `.md`-suffixed URLs; a skills package.
  → [LLP 0010](./0010-agent-dx-and-acceptance.spec.md),
  [LLP 0024](./0024-agent-operating-surface.spec.md).
- **Schema lockdown against rogue agents** (Instant's `attrs` create-rules) as
  a named safety feature of the schema surface. →
  [LLP 0037](./0037-schema-source-of-truth.decision.md),
  [LLP 0024](./0024-agent-operating-surface.spec.md).
- **Benchmark-as-content** (agents building the same app on Snapback across
  models) as low-cost, self-refreshing competitive marketing. →
  [LLP 0074](./0074-convex-competitive-strategy.rfc.md).

**Treat as a deliberate decision, not a default:**

- **Default-deny vs default-allow permissions.** Instant chose default-allow
  for ordinary rows and default-deny for `$files` and `$streams`. Snapback's
  fail-closed stance should stay, but the onboarding cost is real — the
  paved path must make writing the first rule trivial, and Instant's split
  is evidence that a second default for bytes is sellable. →
  [LLP 0011](./0011-auth-and-permissions.rfc.md).
- **Query-scoped cache vs declared sync contract.** Instant shows the
  Firebase-style model still sells; Snapback's stronger contract must not
  cost more ceremony than it buys. →
  [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md).
- **Field-level permission rules.** Instant now has them; [LLP 0230](./0230-data-layer-authorization-prior-art.research.md)
  says projection-time masking is not a boundary. Copy the authoring
  convenience, not the security claim.

**Avoid / they hit this wall:**

- **A single shared EAV table as the multi-tenant substrate** — planner
  statistics collapse at hundreds of millions of tuples; Instant needed
  custom sketch-based statistics. Snapback's per-app relational SQLite
  sidesteps the entire class. → [LLP 0007](./0007-storage-portability.spec.md),
  [LLP 0018](./0018-app-instance-boundaries.rfc.md).
- **Shipping permission filtering only post-query** without a pushdown plan —
  Instant flagged CEL→where pushdown as needed in 2024; status still
  unverified in 2026. Snapback's permission language should be designed for
  pushdown from day one. → [LLP 0011](./0011-auth-and-permissions.rfc.md).
- **Leaving revocation semantics unspecified.** The gap between Instant's
  silence and LLP 0053's ratified contract is a differentiator only if
  Snapback keeps the contract implemented and tested — including
  *rule-change* and *related-entity* invalidation (the shapes Instant was
  observed not to deliver promptly) and *issued asset URL* revocation
  (Diary 0030). →
  [LLP 0053](./0053-authorization-invalidation.rfc.md).

## How this updates the corpus

- Closes the InstantDB blind spot in
  [LLP 0001](./0001-prior-art.research.md) (which now points here) and adds
  the second full competitor profile beside
  [LLP 0074](./0074-convex-competitive-strategy.rfc.md)'s Convex analysis.
- Corroborates, from the closest-surface peer: LLP 0008's conflict model,
  LLP 0013's ephemeral split, LLP 0018's per-app economics thesis (stated by
  Instant as their own multi-tenancy rationale), and LLP 0000's truly-open
  posture (Instant is Apache-2.0 — openness alone is not a moat against
  *this* competitor; isolation, functions, and portability are).
- Changes no ratified decision; surfaces guest-auth, streams, MCP-platform,
  schema-lockdown, storage-as-graph, webhook-shaped effects, permission
  rate limits, and infinite queries into the owning LLPs above. The 2026-08-13
  docs pass also updates LLP 0086's "BYO-Postgres / self-host production"
  watch items: Instant now documents Aurora-17 AWS and VPS topologies.

## Open questions

- ~~Does Instant evict already-synced rows on permission revocation, and on
  what timeline?~~ **Answered 2026-07-23** by the LLP 0086 CC-3.3 probe: yes
  for data-dependent revocation (~32 ms, live push); no for rule revocation
  (reconnect-only). See §Permissions and
  `tests/probes/instant-eviction-20260723/`. Related-entity authority
  changes are a third shape: Diary 0030 observed a ~12 s stale protected
  live view; not yet probed as a preregistered protocol.
- Did CEL→where-clause permission pushdown ship? If it did, the post-query
  cost critique weakens. Still unverified on the 2026-08-13 docs pass.
- What are presence/topic fan-out limits in practice? (No published numbers;
  relevant to [LLP 0013](./0013-ephemeral-realtime-state.rfc.md) sizing.
  Multi-server self-host now requires Hazelcast clustering, which is a
  hint that presence is in-memory and cluster-wide.)
- ~~Does "Bring Your Own Postgres" land, and does it come with a real
  self-hosted production story?~~ **Partially answered 2026-08-13.** Instant
  documents VPS (~$30/mo) and AWS (~$600/mo) production topologies. AWS
  self-host is BYO *Aurora PostgreSQL 17 with logical replication*, not
  arbitrary Postgres. Hosted-lock-in is weaker; the shared-substrate
  critique is stronger. Remaining: is non-Aurora Postgres actually
  supported, and how painful is Cloud→self-host restore in practice?
- Do hosted server functions ship? Still absent as of 2026-08-13; the
  workaround (webhooks + Admin SDK + author's server) is now the product.
- Can Instant revoke an already-issued `$files` URL? Diary 0030 observed
  it could not, within the observation window; docs do not specify a
  capability-revocation contract.
- Is the ~$11M Series A real? (Secondary sources only.)

## Primary sources

Best entry points (fetched/verified 2026-07-23; docs re-fetched 2026-08-13):

- Architecture (the single best source): *instantdb.com/essays/architecture*;
  EAV planner pain: */essays/count_min_sketch*; ops: */essays/pg_upgrade*.
  Dual execution and current product narrative: */about*.
- Founding design rationale (triples, LWW): */essays/next_firebase*; problem
  statement: */essays/db_browser*; agents thesis: */essays/agents*.
- Docs (core): */docs/modeling-data*, */docs/instaql*, */docs/instaml*,
  */docs/infinite-queries*, */docs/permissions*, */docs/rate-limits*,
  */docs/presence-and-topics*, */docs/streams*, */docs/auth*,
  */docs/storage*, */docs/webhooks*, */docs/stripe-payments*,
  */docs/backups*, */docs/backend*, */docs/http-api*, */docs/cli*,
  */docs/using-llms*; index: */llms.txt*.
- Self-hosting: */docs/self-hosting*, */docs/self-hosting/vps*,
  */docs/self-hosting/aws*, */docs/self-hosting/migrate*.
- Repo (Apache-2.0, Clojure/TypeScript): *github.com/instantdb/instant*.
- Dated founder statements: Show HN 2024-08-22 (*news.ycombinator.com/item?id=41322281*);
  Instant 1.0 launch ~2026-04 (*news.ycombinator.com/item?id=47707632*);
  local-first-vs-AI subthread (*news.ycombinator.com/item?id=47711024*).
- Business: */essays/seed*, */pricing*, */about*, */hiring*.
- Bakeoff field evidence: Diaries 0027–0031; Instant 1.0.52 capsules under
  `demos/backend-bakeoff/arms/<app>/instantdb/`.

## Status

Draft. Written 2026-07-23 from a same-day primary-source pass, then extended
2026-08-13 with the retained LLP 0102 five-application field evidence on agent
authoring and a same-day docs re-fetch that filled product surfaces the July
pass had omitted (storage, webhooks, Stripe, infinite queries, rate limits,
field-level rules, production self-hosting, backups, Admin HTTP API, Streams
as `$streams`). It informs the sync, auth, ephemeral, assets, effects,
boundaries, DX, and tiny-data surface LLPs without changing their decisions.
Revise when the remaining pushdown or related-entity-invalidation probes run,
when Instant ships server functions or non-Aurora BYO-Postgres, when its
funding/positioning shifts materially, or when a controlled authoring
experiment can isolate the causal effect of surface size and consequence
ownership.
