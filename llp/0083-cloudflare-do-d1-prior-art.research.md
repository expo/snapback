# LLP 0083: Cloudflare Durable Objects and D1 as prior art — with Rivet and celld, the open counterparts

**Type:** Research
**Status:** Draft
**Systems:** Deployment, Storage, Realtime, Runtime, Sync, Competitive analysis
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-23
**Revised:** 2026-08-06 (celld addendum: Deno's self-hosted Workers/DO
implementation added beside Rivet as a second open counterpart — stronger on
the API-compatibility axis; its LTX replication lane is extracted into
LLP 0188 as a concrete proposal)
**Related:** LLP 0000, LLP 0001, LLP 0003, LLP 0007, LLP 0008, LLP 0013, LLP 0014, LLP 0018, LLP 0022, LLP 0028, LLP 0070, LLP 0188, https://blog.cloudflare.com/sqlite-in-durable-objects/, https://github.com/rivet-dev/rivet, https://github.com/denoland/celld

## Summary

Snapback already *runs* on Durable Objects with SQLite storage — the
Cloudflare strategy is ratified in
[LLP 0014](./0014-cloudflare-strategy.rfc.md) and proven live. This document
is different: it treats **D1 and Durable Objects as prior art** — what the
platform's own designers learned building a replicated SQLite substrate, what
its published limits and economics teach Snapback's own contracts, and what
**Rivet**, the Apache-2.0 actor runtime that markets itself as the
no-lock-in Durable Objects, does differently.
[LLP 0001](./0001-prior-art.research.md) named this pass as a blocker for
leaving Draft; this closes it.

Three findings matter most:

- **Two of LLP 0014's recorded platform facts are now stale.** Cloudflare
  shipped **Dynamic Workers / Worker Loader** (open beta for paid accounts,
  2026-03-24) and **Durable Object Facets** (beta, April 2026): a supervisor
  DO can load tenant-supplied code at runtime and run it as a child facet
  with its own isolated SQLite database — the per-tenant
  "generated code next to its own database" shape Snapback implements by
  hand. LLP 0014's "the deployed runtime forbids dynamic code evaluation"
  fact is no longer true as stated. Separately, DO SQLite **storage billing
  went live ~2026-01-07** after its free GA period. Both need revision
  entries in LLP 0014.
- **The substrate's own design lessons corroborate Snapback's.** SRS (the
  storage engine under both DO SQLite and D1) pairs synchronous SQL with
  **output gates** — responses are held until writes are replicated
  3-of-5 — and gets 30-day point-in-time recovery "for free" from its
  log-plus-snapshot design. Cloudflare's own storage guidance recommends
  exactly Snapback's pattern (per-tenant SQL state in DOs, logic next to
  data) and reserves D1 for the conventional app-server shape.
- **The platform is climbing toward Snapback's layer, and Rivet is the open
  counterweight.** The Agents SDK now ships per-agent SQLite, state sync,
  scheduling, and MCP — but its sync model is a single client-writable JSON
  blob broadcast last-write-wins with no permission story, which marks
  precisely where Snapback's schema'd, server-authoritative, live-query
  layer differentiates. Rivet (YC W23, Apache-2.0, very active) reimplements
  the actor primitive openly — per-actor SQLite, hibernation, and live
  migration DOs lack — but it is an actor runtime, not a reactive backend;
  the gap between the two is Snapback's product.

## How to read this — provenance and confidence

Claims were verified against primary sources — Cloudflare developer docs
(with their own last-updated dates), dated Cloudflare blog posts, GitHub
repos, and Rivet's dated changelog — fetched **2026-07-23**. Tags as in
[LLP 0022](./0022-electric-powersync-turso.research.md): **[confirmed]**
(dated primary source, the default here), **[observed]** (secondary or
unfetched source), **[inferred]** (this document's analysis). Cloudflare
ships platform changes monthly; treat every number as a snapshot, and prefer
the limits/pricing pages over this document once they diverge.

## Findings

### The storage engine's design lessons (SRS)

The 2024-09-26 "Zero-latency SQLite storage in every Durable Object" post is
the best single design document on the substrate Snapback runs on.
[confirmed — blog.cloudflare.com/sqlite-in-durable-objects/]

- **Write path:** SQLite commits locally, SRS streams the WAL change log to
  five followers and confirms after three acknowledge; logs batch to object
  storage "up to 10 seconds, or up to 16 MB"; snapshots upload when logs
  since the last snapshot exceed the database's size.
- **Output gates make the sync API safe:** "any new outgoing network
  messages will be held back until the write has completed" — synchronous
  SQL returns instantly, but no external observer can see an unconfirmed
  write. Cloudflare argues the synchronous API is a *feature*: in-memory
  reads are faster synchronous, and synchronous code "help[s] you avoid
  subtle bugs" from event interleaving.
- **PITR fell out of the design:** 30-day point-in-time recovery via
  lexically comparable bookmarks "was an accidental feature" of
  log-plus-snapshot storage.
- **Consistency machinery:** single-threaded execution plus input gates (no
  events delivered mid-storage-operation) yields per-object
  serializability; implicit per-method transactions; `transactionSync`
  rollback. [confirmed — storage-api docs, durable-objects-easy-fast-correct
  post]

**[inferred]** For [LLP 0007](./0007-storage-portability.spec.md) and
[LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md): the
output-gate pattern is a clean articulation Snapback should steal for its
own contract language — "synchronous inside, gated at the boundary" names
the tiered-durability story (local commit vs replicated confirm) that
Snapback's per-target durability claims need to state explicitly. The PITR
design is also the strongest argument that Snapback's changeset/version
machinery ([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)) should
keep bookmarkable versions on the wire.

### Limits and economics — the numbers Snapback's contracts inherit

From the limits page (updated 2026-06-01) and pricing page. [confirmed —
developers.cloudflare.com/durable-objects/platform/limits/, /pricing/]

- **Per-object:** 10 GB SQLite (1 GB Free); 2 MB max row/blob; 100 KB max
  statement; ~**1,000 requests/second soft ceiling per object**;
  30 s default (5 min max) CPU per request. Account-level SQLite storage is
  unlimited on paid.
- **Pricing shape:** duration billed at a flat **128 MB per active
  object**; rows written cost **1000× rows read** ($1.00/M vs $0.001/M);
  storage $0.20/GB-month; incoming WebSocket messages billed 20:1; outgoing
  free. Storage billing enforced since ~2026-01-07. [confirmed — pricing
  page + billing changelog]
- **Idle behavior:** hibernateable objects hibernate after **~10 seconds**
  of quiet (WebSockets stay connected; pings answered without waking; no
  duration billing); non-hibernateable objects evict after **70–140
  seconds**. `setTimeout`/`setInterval` silently defeat hibernation — the
  **single per-object alarm** is the only idle-compatible timer, with
  at-least-once execution, exponential backoff, and **silent drop after six
  failed retries**. [confirmed — lifecycle, websockets, alarms pages]

**[inferred]** Three consequences. (1) The 1,000 req/s single-threaded
ceiling per object is the hosted version of LLP 0000's single-writer
question — fan-out beyond one app's object must shard or ride a cacheable
read path (LLP 0022 §3), and Cloudflare's own `partysub` exists precisely
because one DO is not enough. (2) The write/read price asymmetry rewards
Snapback's op-log batching and punishes chatty row-at-a-time writes —
worth a note in [LLP 0014](./0014-cloudflare-strategy.rfc.md)'s cost model
now that storage billing is real. (3) The alarm's silent-drop-after-six
behavior means [LLP 0028](./0028-cron-scheduled-execution.rfc.md)-style
schedulers must treat the platform alarm as lossy and keep their own
durable schedule table — which LLP 0028's design already implies, and this
confirms from the platform side.

### Dynamic Workers and DO Facets — the platform absorbs the per-tenant pattern

As of 2026, a Worker can load code at runtime via **Worker Loader** (open
beta to all paid accounts 2026-03-24), and a supervisor DO can host
**facets**: child DO classes loaded dynamically, each with **its own
isolated SQLite database**, running inside the parent's envelope. Cloudflare
extended the same pattern to **Dynamic Workflows** (2026-05-01): "The
workflow is different for every tenant, every agent, every request. There is
no single class to bind." [confirmed —
developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/
(updated 2026-04-21), blog.cloudflare.com/dynamic-workflows/; observed —
open-beta dating via press]

**[inferred]** This is the largest strategic update in this pass, cutting
both ways. Opportunity: Snapback's per-app hosting
([LLP 0018](./0018-app-instance-boundaries.rfc.md),
[LLP 0014](./0014-cloudflare-strategy.rfc.md)) may get simpler — facets are
the exact "tenant code next to tenant data" shape currently built by hand,
and Dynamic Workflows is a platform-native candidate substrate for
[LLP 0070](./0070-durable-background-work.rfc.md) on the hosted target.
Threat: the platform is productizing the pattern that made Snapback's
Cloudflare port non-obvious, lowering the moat for anyone building a
Snapback-shaped thing on Workers. Either way, **LLP 0014's platform-facts
section is stale on this point and needs a revision entry** — its "code is
either compiled into the deployed Worker or uploaded via Workers for
Platforms" claim predates Worker Loader.

### D1 — the managed sibling, and its one original idea

D1 is "built on SQLite-in-DO": same 10 GB ceiling, same single-threaded
per-database processing, batch-only transactions, 50,000 databases per paid
account. Cloudflare's storage-options guidance splits the roles explicitly:
D1 for the familiar app-server-talks-to-a-database shape (with managed
tooling: HTTP API, import/export, insights), DO SQLite for "compute with
storage" and "per-user or per-customer SQL state." [confirmed — d1 limits
page (updated 2026-04-21), workers storage-options page (updated
2026-04-23), sqlite-in-durable-objects post]

D1's one capability the raw DO layer lacks: **read replication with the
Sessions API** (public beta 2025-04-10, still not declared GA) —
asynchronous read replicas in every region, writes forwarded to the
primary, and **sequential consistency via bookmarks** attached to each query
in a session (monotonic reads/writes, read-your-writes), with bookmarks
portable across requests. [confirmed — d1 read-replication docs; observed —
beta status]

**[inferred]** Cloudflare's own positioning independently validates LLP
0014's ratified everything-on-DOs choice for Snapback's per-app data plane.
The Sessions/bookmark design is the useful import: it is a shipped,
documented wire contract for exactly the read-consistency-across-replicas
problem [LLP 0007](./0007-storage-portability.spec.md)'s commit-version
graduation and [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)'s
client cursors will face if Snapback ever adds regional read scale — prior
art to copy, not infrastructure to adopt.

### The realtime layer Cloudflare ships — PartyKit and the Agents SDK

- Cloudflare acquired PartyKit (2024-04-05); the active successor is the
  **partyserver** monorepo (ISC, active through 2026-06): PartyServer
  (DO-based WebSocket rooms), PartySocket, **Y-PartyServer** (Yjs CRDT on
  DOs), **partysub** (pub/sub sharded across multiple DOs — the published
  answer to the per-DO fan-out ceiling), partywhen (scheduling). [confirmed
  — github.com/cloudflare/partykit]
- The **Agents SDK** (MIT, 5.3k stars, releases through 2026-07-22) gives
  each agent "a durable identity, local SQL storage," scheduling, MCP
  client/server support, and **state sync**: `setState()` saves a JSON state
  blob to the agent's SQLite, broadcasts to all connected clients, and —
  notably — **clients can push `setState` back**, distinguished only by a
  `source` parameter; consistency is described as read-your-writes,
  last-write-wins. Larger data goes in `this.sql`, unbroadcast. [confirmed —
  developers.cloudflare.com/agents/api-reference/store-and-sync-state/,
  github.com/cloudflare/agents]
- Cloudflare's own Queues product was rebuilt **on Durable Objects** for a
  10× speedup, and Workflows (durable execution, GA 2025-04-07) runs on the
  same substrate. [observed — how-we-built-cloudflare-queues,
  workflows-ga posts]

**[inferred]** For [LLP 0013](./0013-ephemeral-realtime-state.rfc.md):
partyserver is the closest platform-native implementation of the rooms
contract, and its hibernation constraints (16 KB serialized attachment per
connection; state reset on wake) are concrete bounds Snapback's ephemeral
adapters on this target already navigate. For differentiation: the Agents
SDK's whole-blob, client-writable, permissionless state sync is the
platform's current ceiling — schema'd tables, per-query subscriptions, and
server-authoritative permission-checked writes are exactly what it lacks,
and the `source: client` write path would be an anti-pattern under
[LLP 0011](./0011-auth-and-permissions.rfc.md). Queues-on-DOs is a strong
production existence proof for [LLP 0070](./0070-durable-background-work.rfc.md)'s
queue-on-DO-SQLite shape.

### Sharp edges — the operational fine print

All from Cloudflare's own known-issues, migrations, and data-location pages.
[confirmed]

- **Global uniqueness is event-scoped, not continuous:** an object that
  isn't touching storage "may no longer be current" — a replaced instance
  can briefly run concurrently during partitions or platform updates.
  Storage access re-asserts uniqueness.
- **Code-update skew:** a new Worker version can call a DO still running
  the previous version "for a short period" — the Worker↔DO seam must be
  forward/backward compatible across deploys.
- **Class lifecycle is declarative and sharp:** the `exports` field
  reconciles create/rename/delete/transfer; deleting a class destroys its
  data permanently, "gradual deployments are not supported with exports,"
  and a namespace's storage backend is immutable (KV→SQLite migration still
  only "promised").
- **Placement is forever:** objects instantiate near their first request,
  `locationHint` is best-effort, and "Durable Objects do not currently
  change locations after they are created" (relocation "planned" — still
  unshipped as of the 2026-06-26 page).
- **Lock-in surface, precisely:** `workerd` (Apache-2.0, weekly releases)
  implements the API shape including local DO emulation — but SRS
  replication, PITR, placement, hibernation infrastructure, and billing are
  proprietary. You can port the API; you cannot port the durability.
  Facets/Worker Loader deepen the proprietary surface.

**[inferred]** The uniqueness and update-skew caveats are exactly the class
of assumption [LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md)'s
single-writer reasoning must not silently import: "one object, one thread"
is true per storage epoch, not absolutely. The placement-permanence trap
belongs in [LLP 0014](./0014-cloudflare-strategy.rfc.md)'s operational
notes: an app created by a traveling founder is pinned to that region until
Cloudflare ships relocation.

### Rivet — the open-source actor counterpart

Rivet (rivet.dev, formerly rivet.gg; YC W23; ~5 people; Apache-2.0; v2.3.7
released 2026-07-22, very active) positions Rivet Actors as "the primitive
for stateful workloads... for AI agents, collaborative apps, and durable
execution." Architecture: RivetKit (TypeScript) over a Rust engine
(Pegboard orchestration, Gasoline durable execution, Guard routing, Epoxy
multi-region KV); self-hosts as a single binary/container on Postgres,
filesystem, or FoundationDB; runs on your infra or Rivet Cloud. Capability
timeline: WebSocket hibernation and **live actor migration** (2025-11 — a
thing DOs cannot do), **per-actor SQLite databases** and actor
queues/workflows (2026-02), durable cron (2026-07), and **agentOS**
(2026-04) — a WASM virtual OS for agent sandboxing that Vercel's Eve
adopted (2026-07-22). Their published DO critique: lock-in, JS-only,
observability gaps, no migration/relocation. [confirmed —
github.com/rivet-dev/rivet, rivet.dev/changelog; observed — comparison-page
wording, YC listing]

**[inferred]** Three roles for Snapback. (1) *De-risking narrative:* the
actor-with-SQLite primitive now exists as Apache-2.0 software that runs on
commodity infra — Snapback's hosted architecture has a credible non-
Cloudflare landing zone, which strengthens
[LLP 0033](./0033-license-posture.decision.md)'s truly-open story. (2)
*Candidate second hosted target*, to be evaluated only when a concrete need
arises — it is young and its durability story (Postgres/FDB-backed) is not
SRS. (3) *Boundary marker:* Rivet, like the Agents SDK, stops at "actor
with a database." No schema'd live queries, no permission-checked sync, no
acceptance surface — the distance from actor runtime to reactive backend
is Snapback's product layer, stated twice over by the two closest
platforms.

### celld — Deno's self-hosted implementation of the actual DO API *(added 2026-08-06)*

celld (github.com/denoland/celld; Apache-2.0; ~1.6k stars at fetch;
announced by Ryan Dahl) is "self-hosted, distributed Durable Objects": a
Rust + Tokio daemon embedding V8 that runs **the actual Cloudflare
Workers/DO JavaScript APIs and wrangler config** — not a DO-*like* actor
model. Each object ("cell") is its own SQLite database replicated
continuously to an operator-owned S3-compatible bucket as LTX segments
(Litestream's v0.5 replica format); nodes coordinate through the bucket
alone — ownership is a lease claimed by one atomic compare-and-swap write,
with no control plane and no consensus. Writes are acknowledged only after
the bucket holds them (RPO=0, ~90 ms durable-write cost); failover is
another node winning the lease and restoring from LTX (~20 s); a live cell
costs ~4 MB of memory and a hibernated one only its S3 storage. Supported
surface: module Workers, DO SQLite storage, alarms, hibernatable inbound
WebSockets, service bindings, JS RPC, `vars`, static assets, WASM.
Missing: `scheduled` (cron), KV, R2, Queues, Cache API, HTMLRewriter, TCP
sockets; `routes`/`triggers` config keys are deploy errors. Deploys are
content-addressed in the bucket (manifest + sha256 asset blobs + a
`deploy/current.json` fleet pointer carrying a rollout percentage). The
README calls the runtime and compatibility surface "still evolving"; the
limitations page concedes no multi-tenancy, no managed ingress, no global
placement, manual updates, and WebSockets that do not survive cell
migration. [confirmed — github.com/denoland/celld README + docs
(cloudflare-compat.md, limitations.md), celld.dev, fetched **2026-08-06**]

**[inferred]** Four roles for Snapback. (1) *The stronger lock-in
counterweight:* where Rivet clones the primitive with its own API, celld
implements the API Snapback's Cloudflare port is written against —
`cloudflare/src` (gateway + coordinator DO + handler Worker, wrangler.jsonc
in hand) needs exactly the surface celld supports, with cron the main gap.
A cheap spike could run the notes bundle under celld against MinIO, and the
LLP 0048 conformance twin could test celld as a third leg; this materially
strengthens the LLP 0086 §CC-2a lock-in accounting for the LLP 0014 door-2
re-ratification, beyond what Rivet's optionality offered. (2) *A liftable
replication lane:* celld's `crates/ltx` is a conformance-tested Rust port
of Litestream v0.5 — extracted into **LLP 0188** as the proposed
implementation of continuous SQLite replication and LLP 0099's streaming
pre-apply checkpoint. (3) *A minimalist coordination benchmark:*
bucket-as-coordinator (CAS leases, no control plane) is the simplicity bar
against which LLP 0072's control-plane machinery should periodically be
justified. (4) *Boundary marker, again:* like Rivet and the Agents SDK,
celld stops at "object with a database" — no schema'd live queries, no
permission-checked sync, no acceptance surface. Same discipline as Facets
(LLP 0087): prior art, spike, and code-lift material today, not a
rearchitecture trigger.

**Spike executed 2026-08-09** (`cloudflare/spike-celld/RESULTS-20260809.md`,
celld v0.1.0): **clean negative for faithful execution** — celld's runtime
depends on configurable post-evaluation globals that the LLP 0048 handler
harness's ambient-authority strip deliberately removes, and DO
`stub.fetch()` POST bodies fail in celld's request construction — with
positive substrate evidence (per-cell SQLite, WebSocket hibernation with
eviction/rehydration, DO alarms) under explicitly unsafe diagnostic
adaptations only. Role (1)'s "cheap spike" is answered: no
`celld-do-sqlite-v8` manifest is admissible and the conformance twin must
not add celld as a leg until upstream fixes both faithfulness blockers;
role (2)'s code-lift proceeded independently (LLP 0188, vendored
`vendor/celld-ltx`). [confirmed — spike artifact]

## Synthesis — cross-cutting

1. **The ratified DO bet is validated from three directions.** [inferred]
   Cloudflare's storage guidance recommends per-tenant DO SQLite;
   Cloudflare builds its own Queues and Workflows on DOs; and the
   competitive ecosystem (Rivet) clones the primitive rather than refuting
   it. LLP 0014's decision stands on firmer ground than when it was made.
2. **The platform is commoditizing Snapback's *mechanism* while leaving its
   *semantics* open.** [inferred] Facets, Dynamic Workflows, and the Agents
   SDK absorb per-tenant code loading, durable execution, and state
   broadcast — the plumbing. None of them offer schema'd live queries,
   server-authoritative permission-checked writes, or an acceptance-tested
   authoring surface. Snapback should ride the commoditization (adopt
   facets/Dynamic Workflows where they simplify) and differentiate on
   semantics.
3. **Every scale answer on this platform is "shard or cache," never "bigger
   object."** [inferred] The 1,000 req/s ceiling, partysub, and D1 read
   replicas all say the same thing LLP 0022 §3 said: fan-out beyond one
   writer rides replicas and cacheable read paths. Snapback's fan-out
   design should assume the single-object ceiling is permanent.
4. **Idle economics are a design input, not an ops detail.** [inferred]
   Hibernation-in-10-seconds, alarm multiplexing, the 20:1 message billing,
   and the 1000× write/read price ratio collectively shape what a
   well-behaved Snapback app *is* on this target — and now cost real money
   (billing live since 2026-01).

## What to learn — actionable, mapped to owning LLPs

**Do now:**

- **Revise [LLP 0014](./0014-cloudflare-strategy.rfc.md)'s platform facts:**
  the no-dynamic-code fact is superseded by Worker Loader/DO Facets (beta,
  2026-03/04), and SQLite storage billing has been live since ~2026-01-07 —
  the cost model should absorb the write/read price asymmetry. (Flagged
  here; the revision belongs to LLP 0014's owner given concurrent fleet
  work on that document.)

**Adopt / strongly consider:**

- **Evaluate DO Facets and Dynamic Workflows** as the hosted per-app
  substrate and the [LLP 0070](./0070-durable-background-work.rfc.md)
  hosted profile respectively, versus the hand-built equivalents. →
  [LLP 0014](./0014-cloudflare-strategy.rfc.md),
  [LLP 0018](./0018-app-instance-boundaries.rfc.md), LLP 0070.
- **Adopt the output-gate vocabulary** ("synchronous inside, gated at the
  boundary") for per-target durability claims, and keep bookmarkable
  versions on the wire — D1's Sessions API is the copyable prior art for
  future regional reads. → [LLP 0007](./0007-storage-portability.spec.md),
  [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md).
- **Treat platform alarms as lossy** (single alarm, six retries, silent
  drop) — the durable schedule table stays authoritative. →
  [LLP 0028](./0028-cron-scheduled-execution.rfc.md),
  [LLP 0070](./0070-durable-background-work.rfc.md).

**Treat as a deliberate decision, not a default:**

- **Where to sit relative to partyserver** for hosted ephemeral rooms —
  wrap it, parallel it, or ignore it; its hibernation bounds (16 KB
  attachments, state reset on wake) constrain any choice. →
  [LLP 0013](./0013-ephemeral-realtime-state.rfc.md).
- **Rivet or celld as an eventual second hosted target** — real
  optionality, young substrates; decide against a concrete need, not
  preemptively. celld leads on API compatibility (runs the Workers/DO
  surface `cloudflare/src` already targets); Rivet leads on placement
  maturity (live migration, multi-region). →
  [LLP 0014](./0014-cloudflare-strategy.rfc.md),
  [LLP 0033](./0033-license-posture.decision.md), LLP 0188.

**Avoid / the platform hit this wall:**

- **Assuming continuous global uniqueness or same-version Worker↔DO
  calls** — design the seam for epoch-scoped uniqueness and version skew. →
  [LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md).
- **Chatty row-at-a-time writes** on a substrate that prices writes at
  1000× reads. → [LLP 0014](./0014-cloudflare-strategy.rfc.md) cost model.
- **Client-writable broadcast state without permissions** (the Agents SDK
  model) — named anti-pattern under
  [LLP 0011](./0011-auth-and-permissions.rfc.md).

## How this updates the corpus

- Closes [LLP 0001](./0001-prior-art.research.md)'s named
  Cloudflare-D1/Durable-Objects coverage gap (LLP 0001 §Systems not yet
  surveyed now points here), and adds Rivet, the Agents SDK, and
  partyserver to the prior-art record.
- Flags two stale platform facts in
  [LLP 0014](./0014-cloudflare-strategy.rfc.md) (dynamic code loading;
  storage billing) for revision by that document's owner.
- Corroborates: the everything-on-DOs ratification (from Cloudflare's own
  positioning and its dogfooding), LLP 0022 §3's shard-or-cache fan-out
  conclusion, and LLP 0070's queue-on-DO shape (Cloudflare Queues is one).
- Changes no ratified decision.

## Open questions

- Do **DO Facets** meet Snapback's isolation requirements
  ([LLP 0009](./0009-code-execution-security.rfc.md) boundary review needed
  before any adoption), and does their beta pricing/limits story hold at
  fleet scale?
- Does Snapback's hosted cost model change materially now that storage
  billing and the 1000× write/read asymmetry are real? (Measure with the
  All Aboard deployment's actual meters.)
- When Cloudflare ships **DO relocation**, does per-app placement become a
  Snapback-managed property?
- Is there a concrete trigger (customer, outage, pricing) that would
  justify prototyping Snapback-on-Rivet, and what would the acceptance
  suite need beyond a storage adapter?

## Primary sources

Best entry points (fetched/verified 2026-07-23):

- **Design:** *blog.cloudflare.com/sqlite-in-durable-objects/* (SRS, output
  gates, D1-vs-DO); *blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/*
  (input/output gates).
- **Numbers:** *developers.cloudflare.com/durable-objects/platform/limits/*
  (updated 2026-06-01) and */platform/pricing/*; lifecycle timings:
  */concepts/durable-object-lifecycle/*; alarms: */api/alarms/*.
- **2026 dynamic-code story:**
  *developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/*
  (updated 2026-04-21); *blog.cloudflare.com/dynamic-workflows/*.
- **D1:** */d1/platform/limits/*; read replication + Sessions API:
  */d1/best-practices/read-replication/*.
- **Realtime/agents:** *github.com/cloudflare/partykit* (partyserver,
  partysub); *developers.cloudflare.com/agents/api-reference/store-and-sync-state/*;
  *github.com/cloudflare/agents*.
- **Sharp edges:** */durable-objects/platform/known-issues/*;
  */reference/durable-objects-migrations/*; */reference/data-location/*
  (updated 2026-06-26).
- **Rivet:** *github.com/rivet-dev/rivet* (Apache-2.0, v2.3.7 2026-07-22);
  *rivet.dev/changelog/* (dated capability timeline); YC listing.

## Status

Draft. Written 2026-07-23 to close LLP 0001's named coverage gap and to
surface the 2026 platform changes (Facets, Dynamic Workflows, storage
billing) to the owning LLPs — especially the flagged LLP 0014 revisions —
without changing any ratified decision. Revise when LLP 0014 absorbs the
flagged facts, when Facets/Dynamic Workflows leave beta, or when DO
relocation ships.
