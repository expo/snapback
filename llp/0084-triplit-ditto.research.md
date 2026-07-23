# LLP 0084: Triplit and Ditto — the two fates of sync

**Type:** Research
**Status:** Draft
**Systems:** Sync, Realtime, Auth, Storage, Competitive analysis
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-23
**Revised:** 2026-07-23 (LLP 0086 CC-3 design read: added §Design read —
server-driven eviction vs LLP 0053, from the frozen repo's sync sources at
commit `d3029ee`; answers the first open question)
**Related:** LLP 0000, LLP 0001, LLP 0008, LLP 0011, LLP 0013, LLP 0022, LLP 0033, LLP 0039, LLP 0053, LLP 0086, https://github.com/aspen-cloud/triplit, https://docs.ditto.live/home/about-ditto

## Summary

[LLP 0001](./0001-prior-art.research.md) named Triplit and Ditto as
secondary data points for the query-result-vs-event-log question. The pass
turned up something sharper: the two systems are now the cleanest natural
experiment in the space, because they took adjacent bets and met opposite
fates.

- **Triplit is effectively dead.** The 3-person, essentially unfunded YC W21
  company shipped an impressive full-stack syncing database (server-side
  incremental view maintenance, queries as the sync unit, attribute-level
  LWW, a Snapback-like permission language) through a 1.0 in March 2025 —
  then went silent. Last main-branch commit 2025-09-11; YC lists the company
  **Inactive**; the `triplit.dev` domain lapsed and was re-registered by a
  third party on 2026-05-11. No shutdown notice was ever published. The
  AGPL corpus survives with no steward.
- **Ditto is the most heavily funded company in local-first** — $82M
  Series B (2025-03) at a $462M valuation, 250% ARR growth, customers
  including Japan Airlines, Alaska Airlines, Lufthansa, Chick-fil-A, and
  the U.S. Air Force. It is also **the strongest living counter-example to
  "nobody ships CRDT sync in production"** — with precise scope: Ditto
  ships CRDTs *where the mesh is the product*, in offline-critical physical
  operations where no server may be reachable, and even Ditto tells its
  customers to resolve business conflicts at read time in app logic, not in
  the merge layer.
- Both systems, despite opposite architectures, converge on the same sync
  shape the rest of the cohort chose: **materialized state deltas scoped by
  subscribed queries** — not client-visible event logs. With
  [LLP 0022](./0022-electric-powersync-turso.research.md)'s three peers,
  the count is now five systems on the query-result/state side, zero on
  event-log sync to clients.

## How to read this — provenance and confidence

Claims verified against primary sources fetched **2026-07-23**: the Triplit
GitHub repo and its in-repo docs, npm registry timestamps, RDAP domain
records, Wayback Machine captures of the dead triplit.dev, the YC company
index, Ditto's live docs and pricing, and dated funding press. Tags as in
[LLP 0022](./0022-electric-powersync-turso.research.md): **[confirmed]**
(dated primary source), **[observed]** (secondary/unverified),
**[inferred]** (analysis). Triplit's facts are now frozen by its death;
Ditto's move fast.

## Findings

### Triplit — a good design that ran out of company

**What it was.** "A full-stack, syncing database that runs on both server
and client": a TypeScript database engine on both ends (they evaluated and
explicitly rejected SQLite-in-browser for synchronous-query and FFI-overhead
reasons), connected by a WebSocket sync engine; pluggable storage
(IndexedDB, SQLite, Durable Objects); React/Vue/Svelte/Angular/Solid
bindings; a fluent typed query builder with relations as named subqueries;
schema in TypeScript shared by both ends. Pre-1.0 the store was literally
EAV triples with Lamport-timestamped LWW registers; the 1.0 rewrite
(2025-03, "10-100X the performance") kept attribute-level merge but
replaced the storage format and sync protocol wholesale, breaking
compatibility. [confirmed — repo README, v1-migration.mdx, archived 1.0
post, archived coming-soon post 2025-01-13, npm @triplit/db 0.5.x]

**What it got right — three designs worth keeping on file:**

- **Server-side IVM with granular diffs.** "With Triplit, queries are
  'live'… Under the hood, Triplit implements incremental view maintenance…
  On the server, this system calculates granular diffs to send to the
  client, rather than repeatedly sending the entire result set when one
  entity changes." Queries are the sync unit; clients partially replicate
  only subscribed, permitted results and receive only attribute-level
  changes they haven't seen. [confirmed — archived 1.0 post,
  offline-mode.mdx]
- **Server-driven cache eviction on permission change.** "Triplit's custom
  sync protocol allows the server to automatically evict data from a client
  cache when required, e.g. when data permissions change. This also works
  when a client goes offline and reconnects with a stale cache."
  [confirmed — archived 1.0 post] **[inferred]** This is a shipped answer to
  the revocation-eviction problem
  [LLP 0053](./0053-authorization-invalidation.rfc.md) owns for Snapback —
  and notably one InstantDB ([LLP 0082](./0082-instantdb.research.md))
  still leaves unstated.
- **A permission language convergent with LLP 0011.** Roles matched from
  JWT claims (with wildcard binding), then per-collection, per-operation
  permissions expressed as query filters (e.g.
  `insert: {filter: [['authorId','=','$token.sub']]}`), evaluated
  exclusively server-side, with invalid writes rejected at the server and
  rolled back on the client. Schema pushes classify changes as
  backwards-compatible or not, with an enforcement flag and clients
  refusing to connect on incompatible schemas. [confirmed —
  permissions.mdx, schemas/updating.mdx] **[inferred]** Independent
  convergence on "declarative filter permissions feed what syncs" — the
  same shape as [LLP 0011](./0011-auth-and-permissions.rfc.md).

**Conflict model.** Attribute-level LWW registers marketed as "CRDT," but
hub-and-spoke: clients sync only with the server, which is also the
authorization authority and can reject writes. No semantic merge. [confirmed
— archived 1.0 post, offline-mode.mdx, permissions.mdx] **[inferred]** One
more member of the no-semantic-merge convergence
([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)'s pinned model).

**The death, precisely dated.** Last main commit 2025-09-11; npm releases
stopped 2025-07-31; last blog post 2025-06-06; the only 2026 activity is
two unmerged agent-generated experiment branches (latest 2026-01-19); YC
status **Inactive**; domain re-registered by a squatter 2026-05-11.
AGPL-3.0 from day one — no license switch ever happened. No funding beyond
YC found ("unfunded" per Tracxn). [confirmed — GitHub API, npm registry,
RDAP, Wayback blog index, ycombinator.com/companies/triplit; observed —
Tracxn]

**[inferred] What the death teaches.** (1) The
fragile-suppliers theme (LLP 0001 §synthesis 8) has its terminal case: a
three-person team shipping a full-stack sync database plus cloud could not
sustain it, and died *silently* — no shutdown post, no handoff, no archive
notice. Anyone who bet an app on Triplit found out from the domain parking
page. (2) For [LLP 0033](./0033-license-posture.decision.md): AGPL did not
save it, and "open but dead" is a distinct failure mode from PowerSync's
"alive but FSL" — openness without a steward is only a slightly better
grave. Snapback's institutional-durability story is as load-bearing as its
license. (3) The technical corpus (IVM diffs, eviction protocol, permission
language) remains readable in the repo and is worth mining precisely
because it is frozen.

#### Design read: server-driven eviction vs LLP 0053 (2026-07-23, LLP 0086 CC-3)

A design-level read of the eviction protocol behind the 1.0 claim above,
from the frozen repo at main commit `d3029ee` (last substantive main commit
2025-09-11), against
[LLP 0053](./0053-authorization-invalidation.rfc.md)'s accepted contract.
**Design comparison only** — the code is AGPL, so this section describes the
protocol in its own words at the level of messages, obligations, and state
machines, and copies nothing. Sources are cited as repo paths under
*github.com/aspen-cloud/triplit/blob/main/* plus, for the session/token
behavior, the frozen in-repo docs. All **[confirmed]** against the named
files unless tagged otherwise.

**The protocol, as shipped.** Five mechanisms compose it:

1. **Authorization is compiled into the subscribed query.** On
   `CONNECT_QUERY`, the server prepares the client's query with the schema's
   `read` permission filters folded in (admin tokens skip this), and
   registers it with the server-side IVM
   (`packages/server-core/src/sync-connection.ts`). There is no separate
   authorization channel: a permission-relevant *data* change (a membership
   row deleted, a document re-parented) is just a write to a table some
   permission subquery reads, and shows up as an ordinary result change.
2. **Live evictions are diffs that model absence as deletion.** After
   commits, the server recomputes subscribed results, converts them to a
   changes-set, and diffs against the previous union of this connection's
   per-query result entities; an entity absent from the new union is emitted
   as a wire-level **delete** — the diff helper's own contract is to model
   missing entries as deletes (`packages/db/src/ivm/utils.ts`). An entity
   that left one query's results but is still readable arrives as an update
   instead, and the client's own view maintenance drops it from the view;
   only unreadable-or-actually-deleted entities become deletes. Deltas
   accumulate in a per-connection in-memory buffer flushed every ~10ms as an
   `ENTITY_DATA` message carrying the changes, a server timestamp, and the
   affected query ids (`packages/server-core/src/triplit-server.ts`,
   `sync-connection.ts`).
3. **Clients apply deletions destructively and immediately.** The client
   applies `ENTITY_DATA` to its local store with rule checks skipped —
   server data is trusted — so a delete destroys the local copy outright,
   then local views recompute (`packages/client/src/sync-engine.ts`). There
   is no quarantine, read-block, or suspended state anywhere in the
   protocol, and the wire does not distinguish "this row was deleted" from
   "you may no longer see this row."
4. **Resume repairs by client-presented holdings, not server memory.** On
   reconnect (query states reset, exponential backoff), the client re-runs
   each query against its *local* cache without permission filters and sends
   `CONNECT_QUERY` with a checkpoint: the last server timestamp it applied
   plus the entity-id set it currently holds for that query
   (`packages/client/src/sync-engine.ts`). The server's first response diffs
   that checkpoint against a fresh, permission-filtered evaluation: held ids
   still in the results are suppressed if unchanged since the timestamp
   (bandwidth only); held ids *no longer in the results* are re-fetched
   through a permission-filtered point lookup, and any id that lookup cannot
   return — deleted **or no longer readable** — is sent as a delete
   (`sync-connection.ts`; `packages/db/src/db.ts` applies `read` permissions
   in that lookup unless rules are skipped). This is the mechanism behind
   the 1.0 blog's "also works when a client goes offline and reconnects
   with a stale cache."
5. **Authority is pinned per connection; changes tear the session down.**
   The token is bound to the connection at open; expiry is checked lazily on
   each inbound and outbound message, closing with a terminal
   `TOKEN_EXPIRED`; a mid-session token refresh must carry role-equivalent
   claims or the server closes with `ROLES_MISMATCH`
   (`packages/server/src/hono.ts`). Ending a session does **not** clear the
   local database — the app is responsible for calling clear on sign-out
   (`packages/docs/src/pages/auth/sessions.mdx`).

**Converges with LLP 0053 — independent validation:**

- **No authorization taxonomy; recomputation decides.** Authorization lives
  inside the subscribed query, and the server's re-evaluation of that query
  is what determines visibility loss — mechanism 1+2 is LLP 0053's central
  reframe ("live correctness does not need an authorization taxonomy"; the
  matcher wakes, the re-query re-applies authorization — LLP 0053 §Summary,
  §Three mechanisms) arrived at independently. [inferred]
- **Resume never trusts a staleness token for authorization.** The
  checkpoint timestamp only suppresses redundant *positive* data; result
  membership is always re-derived from a fresh permission-filtered
  evaluation on every resubscribe. That is LLP 0053's mandatory
  resnapshot-on-reconnect ("stop asking the epoch a question it cannot
  answer" — §Three mechanisms, §Why reconnect must not trust the epoch)
  in a different costume. [inferred]
- **Identity transitions are fenced outside the invalidation protocol.**
  Roles pinned per session, `ROLES_MISMATCH`/`TOKEN_EXPIRED` as terminal
  closes, new authority = new session — the same separation LLP 0053 draws
  when it excludes session revocation from the authorization-event universe
  and hands authority transitions to LLP 0039 (§The authorization-event
  universe, "Not on this list"). [inferred]
- **Only honest clients are bounded.** Triplit's repair trusts the client to
  report its holdings; LLP 0053 states outright that the lease bounds an
  honest client and a hostile one not at all (§The one constraint, §The
  lease). Neither design pretends the server can reach into a hostile
  cache. [inferred]

**Diverges — and what LLP 0053 covers that Triplit did not:**

- **Obligation direction is inverted.** LLP 0053 makes every negative
  delivery a server-retained, level-triggered obligation discharged only by
  an acknowledged superseding snapshot (§Negative deltas are obligations,
  §Invalidation is an obligation, not a message). Triplit keeps **no**
  per-client delivery state: `ENTITY_DATA` is fire-and-forget from an
  in-memory buffer cleared at flush, with no client acknowledgement of
  server data, and correctness is restored only because the client
  re-presents its holdings on the next resume (mechanism 4). Elegant — the
  server needs zero durable invalidation bookkeeping across reconnects, a
  cost LLP 0053 does pay in tombstones and obligations — but the server
  never learns whether an eviction landed, and nothing distinguishes
  "delivered" from "lost until some future reconnect."
- **One destructive verb, no quarantine.** Triplit's only negative
  disposition is delete, indistinguishable on the wire from data deletion
  and applied destructively. LLP 0053's retain/quarantine/delete matrix
  (§Dispositions) exists precisely to avoid destroying retained caches on
  events that are usually false positives and to block reads *between*
  cause and repair; in Triplit a revoked-but-connected client keeps
  rendering stale rows until the repair message happens to arrive, and a
  disconnected one renders them until it reconnects.
- **Nothing bounds the unreachable client.** No lease, no expiry on
  retained bytes, no revalidation requirement before rendering a cold
  cache; token expiry bites only at the socket, and sign-out cache clearing
  is delegated to app code. A device that never reconnects holds revoked
  data forever. LLP 0053's `AuthorizedLease` (24-hour default and hard
  maximum, clamp rules, delete-on-expiry — §The lease) is exactly the
  mechanism Triplit lacked. [confirmed for the absence in the OSS server;
  sessions.mdx confirms the delegation]
- **Policy activation does not invalidate live subscriptions.** Permission
  definitions live in the schema, and a schema push updates the
  compatibility list — but the code that would disconnect live clients on
  an incompatible change is present and **commented out** in the frozen
  server (`packages/server-core/src/triplit-server.ts`), and nothing
  re-prepares already-subscribed queries. A connected client therefore
  keeps syncing under the permission filters compiled at subscribe time
  until it happens to reconnect. LLP 0053 enumerates activation as
  authorization event 2 — stage, validate, atomically activate *and* fire —
  because a policy reload is an authorization change with no data write.
  Triplit's frozen code confirms the gap is real in shipped systems, not
  hypothetical. [confirmed — commented-out block]
- **Eviction scope is the connection's query union, not a query instance.**
  An entity is deleted from the client's whole local store when it leaves
  the union of that connection's subscribed results; LLP 0053 scopes
  obligations, fences, and tombstones per query instance so a stale
  callback cannot repopulate one query's destroyed rows from another's
  delivery (§Client fences).

**What the frozen repo does not expose.** No out-of-band "revoke this user
now" verb against live connections exists in the OSS server — revocation
reduces to short token expiry plus the data-driven path above; whether
Triplit's hosted cloud added anything beyond the OSS server is unknowable
from the corpus, and the 1.0 blog's "evict … when data permissions change"
is substantiated by the frozen code only for permission-*relevant data*
changes, not for changes to the permission definitions themselves
(the commented-out activation path above). [inferred from absence — stated
as such, not as fact]

**What it is.** "Resilient Edge Device Connectivity. Servers & Cloud
Optional." An embedded database (Small Peer) with built-in P2P mesh
networking — Bluetooth, peer-to-peer Wi-Fi, LAN — plus an optional
Big Peer: a partitioned, replicated cloud cluster that joins the mesh,
adds identity, monitoring, Kafka CDC, HTTP ingress, and a MongoDB
connector. Founded 2018; proprietary end to end (the open GitHub org is
demos, tools, and infrastructure forks; the sync engine and SDKs are
closed). Pricing: free tier → Pro → Enterprise with SLAs. [confirmed —
docs.ditto.live/home/about-ditto, /cloud/backend-architecture, ditto.com,
ditto.com/pricing, github.com/orgs/getditto]

**The business.** $9M seed (2021) → $45M Series A (2023) → **$82M Series B
(2025-03-12) at $462M post-money**; ARR up 250% YoY; 30+ customers;
aviation (JAL, Alaska, Lufthansa, ANA; Delta per press), QSR
(Chick-fil-A), and defense (USAF — reported $950M contract-vehicle
ceiling). [confirmed — TechCrunch 2025-03-12, ditto.com customer quotes;
observed — Delta, USAF ceiling]

**The tech, briefly.** DQL (SQL-like, now the sole query API after the
May 2026 SDK v5 rearchitecture retired 62+ legacy APIs across 7 languages);
subscriptions are the sync unit, with version-vector comparison computing
"minimal state transfer" at field granularity; CRDT semantics are
LWW registers per scalar, add-wins maps, whole-value-LWW arrays; causal
consistency guaranteed. [confirmed — docs.ditto.live/dql/dql,
/key-concepts/syncing-data, /best-practices/conflict-resolution-patterns,
ditto.com/blog/ditto-sdk-v5]

**Three findings that matter for Snapback:**

- **Even Ditto pushes semantic conflict resolution out of the merge
  layer.** Their own best-practices guidance is to "accept every write
  using add-wins maps, then derive the correct business state at read
  time" in application logic. The CRDT layer guarantees *convergence*, not
  *correctness*. [confirmed — conflict-resolution-patterns] **[inferred]**
  This is LLP 0022 §1 ("automatic semantic conflict resolution is the
  wall") stated from *inside* the CRDT camp, by its most successful
  practitioner.
- **Offline P2P authorization collapses to certificate-carried predicates
  over immutable identity.** Permissions are query-scoped grants embedded
  in issued credentials, and "can only be specified on the immutable `_id`
  field of a document" — because any peer must be able to evaluate them
  with no server reachable, and a mutable field could smuggle a document
  into a read set. [confirmed —
  /key-concepts/authentication-and-authorization] **[inferred]** The
  sharpest available demonstration that a *rich* permission language
  ([LLP 0011](./0011-auth-and-permissions.rfc.md)) is something
  server-authoritative architectures get to have and peerwise-offline
  architectures structurally cannot.
- **"Presence" in Ditto is mesh topology, not app state.** The presence
  graph is peer-connectivity metadata (capped at 128KB/peer), not
  cursors/typing state — adjacent to, but not an implementation of,
  [LLP 0013](./0013-ephemeral-realtime-state.rfc.md)'s subsystem.
  [confirmed — /sdk/latest/sync/using-mesh-presence]

**[inferred] The precise characterization.** Ditto falsifies any
unqualified "nobody ships CRDT sync in production" — and simultaneously
confirms the qualified version. Every marquee customer is an
offline-critical physical-operations vertical (aircraft cabins, restaurant
floors, contested networks) where devices *must* sync with no server
reachable; there, CRDT convergence is not a DX preference but the only
correct tool, and enterprises pay for it. Ditto does not market a general
app backend: no server functions, no rich permission-filtered queries, no
real web story. It is a different market from Snapback's. If anything it
*strengthens* the no-CRDT bet: the one vendor succeeding with CRDTs needed
mesh requirements to justify them, tells users to resolve conflicts at
read time anyway, and pays a steep authorization-expressiveness price.

## Synthesis — cross-cutting

1. **Five-to-zero: the query is the sync unit; the delta is state.**
   [inferred] Triplit (IVM diffs of subscribed queries) and Ditto
   (subscription queries + version-vector minimal state transfer) both sync
   materialized state deltas, not event logs — joining Electric, PowerSync,
   and Turso (LLP 0022). The corpus-wide question in
   [LLP 0001](./0001-prior-art.research.md) ("query-result vs event-log
   sync") now has a lopsided empirical answer for the client-facing wire;
   event logs survive as *internal* representations (PowerSync buckets,
   Ditto version vectors), which matches
   [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)'s
   changesets-inside, query-results-outside shape.
2. **Hub-authoritative except where the mesh forces otherwise.** [inferred]
   Triplit was pure hub-and-spoke with server-rejected writes; Ditto is P2P
   only because its market requires serverless operation and pays for it in
   permission expressiveness. Server authority is what buys a rich
   authorization model — Snapback's position, demonstrated from both
   directions.
3. **The market fate asymmetry is evidence about demand, not just
   execution.** [inferred] The open, general-purpose, "replace your
   backend" sync startup died in under three years of public life; the
   proprietary, vertical, resilience-focused vendor is at $462M and
   growing. What sustains offline-sync *commercially* so far is
   operational resilience in physical venues. Snapback's local-first story
   should be framed as DX and correctness (instant reads, offline
   tolerance, one mental model) — not as the product's economic engine.

## What to learn — actionable, mapped to owning LLPs

**Adopt / strongly consider:**

- **Mine Triplit's frozen corpus** for the server-driven cache-eviction
  protocol (a shipped revocation-eviction design → compare against
  [LLP 0053](./0053-authorization-invalidation.rfc.md)) and its
  backwards-compatibility-classified schema pushes (client refuses connect
  on incompatible schema → compare against
  [LLP 0037](./0037-schema-source-of-truth.decision.md)'s evolution story).
- **Cite the convergent permission language** (claims-matched roles +
  per-operation query filters, server-evaluated) as independent validation
  in [LLP 0011](./0011-auth-and-permissions.rfc.md).
- **Use Ditto's read-time-derivation guidance** as the citable
  from-inside-the-camp source for keeping semantic merge out of the sync
  core. → [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md).

**Treat as a deliberate decision, not a default:**

- **How Snapback talks about offline.** Ditto's market shows "works with
  no server, ever" is a real, paying segment Snapback deliberately does not
  serve; the boundary should be named (like the SpacetimeDB and
  Nakama/Colyseus non-goal markers in LLP 0001) rather than blurred with
  "local-first" marketing. → [LLP 0000](./0000-snapback.explainer.md).

**Avoid / they hit this wall:**

- **Full-stack sync platform on a three-person, unfunded company's
  surface area.** Triplit's silent death is the terminal case of LLP
  0001's fragile-supplier theme — for Snapback this is an argument to keep
  the institutional-durability story (funding, fleet, corpus, acceptance
  suites) visible to adopters, since it is now a rational selection
  criterion in this category.
- **Authorization schemes that must evaluate without the server** — the
  `_id`-only constraint is what that costs. →
  [LLP 0011](./0011-auth-and-permissions.rfc.md).

## How this updates the corpus

- Closes the Triplit/Ditto entry in
  [LLP 0001](./0001-prior-art.research.md)'s coverage-gap list (which now
  points here), and settles that document's query-result-vs-event-log open
  question on the client-wire side (five systems to zero).
- Adds the terminal data point to LLP 0001's fragile-suppliers synthesis
  theme, and a licensing lesson ("open but dead") to the context around
  [LLP 0033](./0033-license-posture.decision.md).
- Corroborates: LLP 0008's no-semantic-merge core (now including the CRDT
  camp's own guidance), LLP 0011's server-evaluated permission direction,
  and LLP 0053's revocation-eviction contract (with Triplit as the one
  shipped comparable).
- Changes no ratified decision.

## Open questions

- ~~Is Triplit's eviction protocol worth a code-level read (the repo is
  frozen and AGPL — read for design, not for reuse) before
  [LLP 0053](./0053-authorization-invalidation.rfc.md)'s implementation
  hardens?~~ **Answered 2026-07-23** (LLP 0086 CC-3): yes, and done — see
  §Design read: server-driven eviction vs LLP 0053. Net: independent
  validation of the reframe, the mandatory resnapshot, and the fenced
  authority transitions; LLP 0053 additionally covers the unreachable
  client (lease), the quarantine disposition, ACK-backed negative
  delivery, and policy-activation invalidation, all absent or unfinished
  in the frozen code.
- Does Snapback's public positioning need an explicit "we are not a mesh
  database" boundary marker once competitive pages exist, to keep the
  Ditto-shaped segment from becoming a support burden?
- Watch item: does anyone fork/adopt the Triplit corpus, and does Ditto
  ever move down-market toward general app backends (SDK v5's web/Node
  support is the thing to watch)?

## Primary sources

Best entry points (fetched/verified 2026-07-23):

- **Triplit:** repo + frozen docs: *github.com/aspen-cloud/triplit*
  (README; `packages/docs/src/pages/` — permissions.mdx, offline-mode.mdx,
  schemas/updating.mdx, v1-migration.mdx, auth/sessions.mdx); for the
  §Design read (all at main commit `d3029ee`):
  `packages/server-core/src/sync-connection.ts`,
  `packages/server-core/src/triplit-server.ts`,
  `packages/db/src/ivm/utils.ts`, `packages/db/src/db.ts`,
  `packages/client/src/sync-engine.ts`, `packages/server/src/hono.ts`
  (each under *github.com/aspen-cloud/triplit/blob/main/<path>*); the 1.0 architecture manifesto
  via Wayback: *web.archive.org/web/20250518233126/https://www.triplit.dev/blog/triplit-1.0*;
  blog index (last post 2025-06-06):
  *web.archive.org/web/20251218140545/https://www.triplit.dev/blog*;
  status: *ycombinator.com/companies/triplit* (Inactive); domain fate:
  Google Registry RDAP for triplit.dev (re-registered 2026-05-11); npm
  registry timestamps (last publishes 2025-07-31).
- **Ditto:** *docs.ditto.live/home/about-ditto* (Small/Big Peer);
  */key-concepts/syncing-data* (subscriptions, version vectors);
  */best-practices/conflict-resolution-patterns* (CRDT semantics +
  read-time derivation); */key-concepts/authentication-and-authorization*
  (the `_id`-only constraint); */cloud/backend-architecture* (Big Peer
  internals); *ditto.com/blog/ditto-sdk-v5* (May 2026 rearchitecture);
  *techcrunch.com/2025/03/12/ditto-lands-82m-...* (funding/customers);
  *ditto.com/pricing*.

## Status

Draft. Written 2026-07-23 to close LLP 0001's named coverage gap. Triplit's
half is final (the subject is frozen); Ditto's half should be revised if
Ditto moves toward general app backends, changes its authorization model,
or publishes numbers that bear on Snapback's fan-out or offline designs.
