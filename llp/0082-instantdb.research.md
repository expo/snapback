# LLP 0082: InstantDB — the closest competitor surface

**Type:** Research
**Status:** Draft
**Systems:** Storage, Sync, Realtime, Auth, Ephemeral state, Developer experience, Competitive analysis
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-23
**Revised:** 2026-07-23 (same day: the revocation-eviction open question is answered by the LLP 0086 CC-3.3 preregistered probe — data-dependent revocation evicts live (~32 ms), rule revocation does not reach connected clients until reconnect; §Permissions carries the probe results and a dated correction to the differentiator inference; receipts in `tests/probes/instant-eviction-20260723/`)
**Related:** LLP 0000, LLP 0001, LLP 0007, LLP 0008, LLP 0010, LLP 0011, LLP 0013, LLP 0018, LLP 0022, LLP 0024, LLP 0033, LLP 0037, LLP 0053, LLP 0074, LLP 0076, LLP 0086, https://www.instantdb.com/essays/architecture, https://github.com/instantdb/instant

## Summary

InstantDB (instantdb.com, YC S22, Apache-2.0) is the system whose *surface*
overlaps Snapback's most completely: live relational queries by default,
optimistic transactions with server-authoritative last-write-wins, a permission
language evaluated on the live path, first-class ephemeral presence/topics
rooms, built-in auth, and an aggressively agent-first DX (remote MCP, skills,
llms.txt, programmatic app creation). It shipped "Instant 1.0" in April 2026
under the banner "the best backend for AI-coded apps." Until this pass it had
**zero coverage** in the corpus — [LLP 0001](./0001-prior-art.research.md)
never listed it — despite being, with Convex
([LLP 0074](./0074-convex-competitive-strategy.rfc.md)), one of the two
closest living competitors.

The headline findings for Snapback:

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
- **The gaps run in both directions, and they are specific.** Instant has no
  server functions (founder-acknowledged, April 2026), no declared partial
  sync independent of mounted queries, no SQLite/portability story, and no
  documented answer to permission-revocation eviction of already-synced rows —
  the question [LLP 0053](./0053-authorization-invalidation.rfc.md) answers
  with a ratified contract. Snapback lacks Instant's client-side offline query
  engine, guest auth, durable resumable Streams, and its model-benchmark
  content engine.

## How to read this — provenance and confidence

Factual claims were gathered and cross-checked against primary sources —
vendor docs, dated vendor essays, the GitHub repo, and founder statements in
dated Hacker News threads — fetched **2026-07-23**. Tags follow
[LLP 0022](./0022-electric-powersync-turso.research.md):

- **[confirmed]** — verified against a dated primary source (URL inline or in
  the source list). Default for factual claims here.
- **[observed]** — vendor- or secondary-source-stated but not independently
  verified (funding databases, team size, unverified feature status).
- **[inferred]** — this document's analysis of what a finding means for
  Snapback. Argument, not fact.

Instant iterates quickly (three feature areas below did not exist a year
ago). Re-verify before any claim here hardens into a Snapback decision.

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
portability ([LLP 0007](./0007-storage-portability.spec.md)), agent DX
([LLP 0010](./0010-agent-dx-and-acceptance.spec.md),
[LLP 0024](./0024-agent-operating-surface.spec.md)), and the competitive
strategy frame ([LLP 0074](./0074-convex-competitive-strategy.rfc.md)).

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
- **EAV at scale hurts, and they say so:** "after we reached a few hundred
  million tuples... Postgres started having troubles" — the query planner
  loses frequency statistics on a single giant EAV table; Instant built
  Count-Min-Sketch-based column statistics to compensate. [confirmed —
  /essays/architecture, /essays/count_min_sketch]
- **Self-hosting** is Docker Compose (Clojure server + Postgres + MinIO +
  dashboard) with an explicit "not production-ready; you own backups,
  observability, monitoring" caveat. "Bring Your Own Postgres" is planned.
  [confirmed — /docs/self-hosting; HN 47707632]
- **No server functions.** The founder, April 2026: "We don't support
  [functions] just yet"; the blessed pattern is the Admin SDK called from your
  own Next.js/Workers/server. [confirmed — HN 47707632, /docs]

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
- Expressiveness limits are concrete: comparison and `like` operators require
  **indexed, type-checked fields**; ordering only on indexed fields and never
  on nested attributes; pagination (`limit`/cursors) **only on top-level
  namespaces**; **no aggregation** (no count/sum/avg) in the query language.
  [confirmed — /docs/instaql]
- Field selection exists but is explicitly *not* a security boundary — the
  docs warn that a client can just issue another query for the full entity;
  permissions are the only gate. [confirmed — /docs/instaql, /docs/patterns]
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
- **Default-allow:** absent rules mean `true`; `"$default": "false"` opts into
  default-deny per namespace (Streams, by contrast, default closed).
  [confirmed — /docs/permissions, /docs/streams]
- Post-query filtering cost is acknowledged; converting CEL to `where`-clause
  pushdown was planned in 2024, shipped-status unverified. [confirmed — HN
  41322281; observed — pushdown status]
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

**[inferred]** Two Snapback differentiators fall out. First, default-allow is
the opposite of [LLP 0011](./0011-auth-and-permissions.rfc.md)'s fail-closed
posture — defensible for onboarding, alarming for agent-generated apps, and
worth naming in competitive material. Second, Snapback has a *ratified answer*
to authorization invalidation
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

### Ephemeral state — rooms, presence, topics, and now Streams

- `db.room(type, id)` scopes ephemeral context; **presence** is
  per-connection latest-state shared with peers, auto-cleaned on disconnect;
  **topics** are fire-and-forget broadcast. The docs' decision framework is
  verbatim-close to [LLP 0013](./0013-ephemeral-realtime-state.rfc.md)'s
  model: `transact` to persist to the DB, `presence` for room-persistent but
  not-DB state, `topics` for broadcast-without-persistence. Drop-in `Cursors`
  and typing-indicator components; typed room schemas. No published limits or
  fan-out numbers. [confirmed — /docs/presence-and-topics; observed — scaling]
- **Streams** (new, LLM-era): durable, resumable channels implementing the
  Web Streams API — "because streams are backed by storage, they never
  expire. A reader can pick up from any point... and resume." One writer per
  clientId; rules default closed; aimed at AI-chat token streaming.
  [confirmed — /docs/streams]

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
**[inferred]** Guest auth with later account claiming is worth evaluating for
[LLP 0011](./0011-auth-and-permissions.rfc.md)'s paved path; it converts the
demo-app funnel directly.

### Agent-first DX — the current high-water mark

Instant ships: a hosted **remote MCP server with OAuth**
(mcp.instantdb.com — tools create apps and push schema/permissions, not data),
a local stdio MCP, `npx skills add instantdb/skills`, per-agent rules files
scaffolded by `create-instant-app`, `llms.txt`/`llms-full.txt`, every docs URL
serving raw markdown with a `.md` suffix, and a **Platform API** for
programmatic app creation. The strategic argument ("How and where will agents
ship software?", with Nikita Prokopov on staff): agents need built-in
abstractions, multi-tenant hosting ("Hosting 20,000 single-user apps via
traditional VMs would cost approximately $95,000/month versus $800/month"),
and exposed data; "sync engines are a tight abstraction, so agents can...
write more concise code with fewer tokens and fewer mistakes." A recurring
"Counter-Strike benchmark" essay series pits frontier models against each
other building a multiplayer game on Instant. [confirmed — /docs/using-llms,
/essays/agents, /essays/architecture, essay index]

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
  $30/mo; Startup $600/mo. [confirmed — /pricing]

**[inferred]** The investor set (Firebase's founder, PG, Brockman, Dean) and
the benchmark-content engine buy outsized mindshare relative to revenue
evidence. Per LLP 0001's fragile-suppliers theme, Instant is better
capitalized than the survey-batch systems but is still a small team carrying
a very large surface — the same comprehensiveness risk Snapback carries,
minus Snapback's optionality on self-hosting economics.

## Synthesis — cross-cutting

1. **Surface convergence, substrate divergence.** [inferred] Instant and
   Snapback agree on the product thesis to a startling degree — live queries
   by default, optimistic LWW transactions, permissions in the sync path,
   ephemeral rooms, agent-first, truly open. The load-bearing differences are
   all below the waterline: EAV-on-shared-Postgres vs relational-SQLite-per-
   app, logical vs physical isolation, no-server-functions vs
   functions-as-the-API, query-scoped cache vs declared sync contract.
2. **The no-CRDT convergence now includes the closest competitor.** [inferred]
   With Electric, PowerSync, Turso (LLP 0022), and now Instant, every close
   peer lands on server-authoritative LWW. LLP 0008's pinned model is as
   externally corroborated as a design choice gets.
3. **Server functions are the moat Instant hasn't crossed.** [inferred]
   Instant's missing functions runtime is founder-acknowledged and
   architecturally non-trivial for them (their server is a Clojure sync
   engine, not a code host). Snapback's schema + functions + acceptance
   testing + guide surface is exactly the part Instant tells users to build
   themselves on another platform. Competitive material
   ([LLP 0074](./0074-convex-competitive-strategy.rfc.md)) should treat
   "Convex-grade functions, Instant-grade sync surface, open like both,
   isolated like neither" as the positioning triangle.
4. **Isolation is a safety argument, not just an ops argument.** [inferred]
   One shared Aurora with `app_id` scoping means every app shares a blast
   radius and a query planner; Instant's own essays document the planner
   pathology. DO-SQLite-per-app turns "your data is a physically separate
   database" into a differentiator that agent-generated app platforms
   (both companies' explicit target) will care about.

## What to learn — actionable, mapped to owning LLPs

**Adopt / strongly consider:**

- **Guest auth with account claiming** as a paved-path onboarding feature. →
  [LLP 0011](./0011-auth-and-permissions.rfc.md).
- **A durable resumable stream primitive** (storage-backed, offset-resumable,
  single-writer) for LLM token UX — compare directly while designing bounded
  streamed actions. → [LLP 0076](./0076-bounded-streamed-actions.rfc.md),
  [LLP 0013](./0013-ephemeral-realtime-state.rfc.md).
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
  for onboarding speed; Snapback's fail-closed stance should stay, but the
  onboarding cost is real — the paved path must make writing the first rule
  trivial. → [LLP 0011](./0011-auth-and-permissions.rfc.md).
- **Query-scoped cache vs declared sync contract.** Instant shows the
  Firebase-style model still sells; Snapback's stronger contract must not
  cost more ceremony than it buys. →
  [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md).

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
  Snapback keeps the contract implemented and tested. →
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
  and schema-lockdown options into the owning LLPs above.

## Open questions

- ~~Does Instant evict already-synced rows on permission revocation, and on
  what timeline?~~ **Answered 2026-07-23** by the LLP 0086 CC-3.3 probe: yes
  for data-dependent revocation (~32 ms, live push); no for rule revocation
  (reconnect-only). See §Permissions and
  `tests/probes/instant-eviction-20260723/`.
- Did CEL→where-clause permission pushdown ship? If it did, the post-query
  cost critique weakens.
- What are presence/topic fan-out limits in practice? (No published numbers;
  relevant to [LLP 0013](./0013-ephemeral-realtime-state.rfc.md) sizing.)
- Does "Bring Your Own Postgres" land, and does it come with a real
  self-hosted production story? That would erode the hosted-lock-in contrast
  while strengthening the shared-substrate critique.
- Is the ~$11M Series A real? (Secondary sources only.)

## Primary sources

Best entry points (fetched/verified 2026-07-23):

- Architecture (the single best source): *instantdb.com/essays/architecture*;
  EAV planner pain: */essays/count_min_sketch*; ops: */essays/pg_upgrade*.
- Founding design rationale (triples, LWW): */essays/next_firebase*; problem
  statement: */essays/db_browser*; agents thesis: */essays/agents*.
- Docs: */docs/instaql*, */docs/instaml*, */docs/permissions*,
  */docs/presence-and-topics*, */docs/streams*, */docs/auth*,
  */docs/self-hosting*, */docs/using-llms*; index: */llms.txt*.
- Repo (Apache-2.0, Clojure/TypeScript): *github.com/instantdb/instant*.
- Dated founder statements: Show HN 2024-08-22 (*news.ycombinator.com/item?id=41322281*);
  Instant 1.0 launch ~2026-04 (*news.ycombinator.com/item?id=47707632*);
  local-first-vs-AI subthread (*news.ycombinator.com/item?id=47711024*).
- Business: */essays/seed*, */pricing*, */about*, */hiring*.

## Status

Draft. Written 2026-07-23 from a same-day primary-source pass, to inform the
sync, auth, ephemeral, boundaries, and DX LLPs and the competitive strategy
RFC without changing any of them. Revise when the revocation-eviction and
pushdown probes are run, when Instant ships server functions or BYO-Postgres,
or when its funding/positioning shifts materially.
