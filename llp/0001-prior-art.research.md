# LLP 0001: Prior art and influences

**Type:** Research
**Status:** Draft
**Systems:** Storage, Sync, Realtime, Runtime, Auth, Developer experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-06-25
**Revised:** 2026-07-23 (survey batch: six primary-source-verified sections added — TanStack DB, PocketBase, Encore, DBOS, Evolu, Nakama/Colyseus — plus a new fragile-suppliers synthesis theme; the "systems not yet surveyed" gap is closed by the new deep passes LLP 0082 (InstantDB), LLP 0083 (Cloudflare D1/Durable Objects + Rivet), LLP 0084 (Triplit/Ditto), and LLP 0085 (Jazz)). 2026-07-01 (LLP 0032 R1 batch: promotion to Active was ratified, then reverted at apply time — `ref-check` enforces that Active documents carry no `[inferred]` claims, and this research keeps its inference-tagged analysis, so Draft is its honest state; content stable since 2026-06-27)
**Related:** LLP 0000, LLP 0002, LLP 0003, LLP 0004, LLP 0006, LLP 0007, LLP 0008, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0022, LLP 0028, LLP 0070, LLP 0082, LLP 0083, LLP 0084, LLP 0085, https://github.com/expo/valet

## Summary

What to learn from the systems that came before Snapback, and how each should
influence its design. Snapback's shape — a comprehensive backend on SQLite (then
Postgres), local-first with partial sync, realtime, agent-first, scale-to-zero,
and truly open — is a recombination of ideas that several existing systems each
do part of. This document mines them for the parts worth keeping and the
mistakes worth avoiding.

It covers Valet (our own first cut), the sync engines (Zero/Replicache,
LiveStore), the backend platforms (Supabase, Convex, Firebase, SpacetimeDB), the
serverless databases (PlanetScale, Neon), the run-your-code platforms (Val.town),
and the framework that defines "comprehensive and coherent" (Ruby on Rails).
A 2026-07-23 survey batch adds six systems at survey depth — the unbundled
client live-query layer (TanStack DB), the single-binary small end (PocketBase),
infra-from-typed-code (Encore), database-owned durable execution (DBOS), the
E2EE corner (Evolu), and the game-server lineage of room state
(Nakama/Colyseus). The systems that earned full primary-source passes have their
own documents: [LLP 0022](./0022-electric-powersync-turso.research.md)
(ElectricSQL, PowerSync, Turso/libSQL), [LLP 0082](./0082-instantdb.research.md)
(InstantDB), [LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md)
(Cloudflare D1/Durable Objects + Rivet),
[LLP 0084](./0084-triplit-ditto.research.md) (Triplit/Ditto), and
[LLP 0085](./0085-jazz.research.md) (Jazz).

## How to read this — provenance and confidence

This is generated research, kept `Draft`, and tagged so the reader knows what is
load-bearing. It is a map of hypotheses and influences, not a citation-quality
survey.

- **[observed]** — generated observation from public/product knowledge and the
  existing Snapback corpus. It is **not** freshly verified against current docs,
  and this space moves fast (free tiers, products, and APIs change). Treat it as
  a strong starting point, not a citation; verify against primary sources before
  any of it becomes a decision.
- **[inferred]** — the author's analysis of how a lesson should influence
  Snapback. Argument, not fact.
- **[confirmed]** — carries a named human/date or a recoverable artifact/date.
  Valet now has a dedicated recovery document,
  [LLP 0006](./0006-valet-retrospective.research.md), which tags diary and
  Valet-LLP findings this way. This broader prior-art survey still treats
  non-Valet product characterizations as unverified starting points until
  checked against current primary sources.

Confidence is noted per system. Valet used to be the lowest-confidence,
highest-value section; the first recovery pass now lives in LLP 0006. The
remaining low-confidence material in this document is the fast-moving external
prior art. A later revision should add primary-source links or citations for the
non-Valet systems before this document moves beyond `Draft`.

The six sections in the 2026-07-23 survey batch (TanStack DB through
Nakama/Colyseus) were verified against primary sources — GitHub repos/releases,
official docs, and dated vendor blog posts fetched 2026-07-23 — so their
`[confirmed]` tags carry that date; press coverage and other secondary sources
in those sections stay `[observed]`. The pre-batch sections keep their original,
weaker provenance until similarly re-verified.

## Findings

### Valet — our own first cut

*Model [observed, from LLP 0000 / README]:* a small Rust service running
alongside SQLite, executing your code and using SQLite for storage, with Ibex or
V8 as the code engine.

- The **architecture is directionally correct** — small Rust service + SQLite +
  pluggable JS engine is the shape Snapback inherits. [observed]
- **Empirical testing ran into real problems that made Valet hard, and the
  first recovery pass is complete enough to constrain Snapback v1.** LLP 0006
  recovers diary and Valet-LLP evidence for silent schema/codegen drops,
  handler-source-only replay, engine non-interchangeability, unenforced
  watchdogs, per-row version triggers, cold-start subscription gaps,
  local/server auth divergence, burst backpressure loss, typecheck/packaging
  theater, and multi-row optimistic atomicity bugs. [confirmed via LLP 0006]
- *Influence:* the owning LLPs should keep treating those findings as design
  constraints, not anecdotes. The still-open Valet questions are production
  scale and operations questions: single-writer breaking point, fan-out ceiling,
  retention/matcher cost, hosted isolation, and target-specific idle cost.
  [inferred]

*Confidence:* architecture **medium-high** (corpus-sourced and validated by
Valet); recovered correctness/DX failures **high** for demo-scale behavior
(LLP 0006); production-scale limits **low** until benchmarked.

### Zero / Replicache (Rocicorp) — query-driven sync

*Model [observed]:* Replicache is a client cache with optimistic **mutators**
and push/pull sync, resolving conflicts by rebasing client mutations on
server-authoritative state. Zero is its successor: you subscribe to **queries**
(ZQL) and it syncs their results to a local store, reads served instantly from
the client, with read/write **permissions** in the sync layer.

- **Query-result partial sync** — "sync the rows these live queries need" — is a
  clean answer to Snapback's "partial sync of the data a client needs." [observed]
- **Optimistic mutations + server rebase** is a proven recipe for offline edits
  with conflict handling. [observed]
- **Permissions belong in the sync layer**, not bolted on — Zero learned this and
  added them. Directly relevant to the card-game reference app (authorization-
  aware partial sync). [observed]
- *Influence:* the local-first sync LLP should seriously evaluate query-
  subscription-driven sync with authorization-aware results and optimistic
  mutators as its baseline model. [inferred]

*Confidence:* **medium-high.**

### LiveStore — SQLite on the client, event-sourced sync

*Model [observed]:* a local-first data layer that runs **SQLite in the client**
(e.g. Wasm SQLite) with reactive queries, where state is derived from a synced
**event log** (event sourcing) as the source of truth.

- **SQLite on both ends** collapses the client/server impedance mismatch — highly
  relevant since Snapback is SQLite-native. [observed]
- **Event-log / changeset sync** is an alternative to query-result sync worth
  weighing against Zero's model. [observed]
- **Reactive local queries** drive realtime UI for free off the local store.
  [observed]
- *Influence:* a candidate sync architecture, and evidence that "SQLite as the
  local store" is viable; the sync LLP should compare event-log vs. query-result
  sync explicitly. [inferred]

*Confidence:* **medium** — promising but newer / less battle-tested than the
hosted platforms.

### Supabase — Postgres with everything next to it, open

*Model [observed]:* open-source Firebase alternative on Postgres — auth, object
storage, realtime (via Postgres logical replication → websockets), edge
functions, auto-generated REST/realtime APIs, and **Row-Level Security (RLS)** as
the authorization model. Self-hostable.

- **Auth and data in the same database** — exactly Snapback's "auth next to your
  data" principle, validated at scale. [observed]
- **RLS as authorization** is a strong, declarative model for who-can-see-what;
  also a cautionary tale about RLS complexity at scale. [observed]
- **Open-source and self-hostable** is the closest peer to Snapback's "truly
  open / run anywhere," including the operational realities of self-hosting.
  [observed]
- *Influence:* validates auth-with-data; RLS is a reference (and a warning) for
  authorization-aware queries/sync; their logical-replication realtime is one
  concrete option for the realtime subsystem. [inferred]

*Confidence:* **high.**

### Convex — reactive functions, end-to-end types

*Model [observed]:* a reactive backend where you write TypeScript **queries,
mutations, and actions**; queries are **reactive subscriptions by default**
(clients auto-update), mutations are transactional, and types flow end-to-end.
Determinism of query functions is what makes reactivity and caching tractable.
Proprietary / hosted.

- **Reactive-by-default queries** are the best-in-class realtime DX: write a
  query, it stays live. This is the bar for Snapback's realtime + DX. [observed]
- **Functions as the API, transactional mutations** is a clean, agent-friendly
  programming model with strong feedback (types + transactions). [observed]
- *Caution:* proprietary and a custom datastore — the lock-in Snapback's open +
  relational thesis rejects. [observed]
- *Influence:* aim for Convex-grade reactive queries and transactional mutation
  functions, but **on SQLite/Postgres and MIT-licensed**. The determinism→
  reactivity insight should shape how Snapback defines queries. This is arguably
  the strongest single DX reference for the agent-first goal. [inferred]

*Confidence:* **high.**

### SpacetimeDB — logic inside the database, for games

*Model [observed]:* a database that runs your application logic (**reducers**, as
Wasm modules) inside the DB; clients connect directly and subscribe to realtime
state. In-memory with persistence; designed for MMO games.

- The extreme of **code-next-to-data**: logic literally in the DB engine — a
  useful end of the spectrum to reason about, even if Snapback stops short of it.
  [observed]
- **Realtime state subscriptions** to many clients is its core competency.
  [observed]
- *Boundary marker:* it targets the **MMO / realtime-game** workload Snapback
  explicitly declares a non-goal — so it's the comparison point that justifies
  that boundary, not a model to chase there. [observed/inferred]
- *Influence:* informs the code-execution-next-to-data lineage and realtime
  subscriptions; confirms where Snapback's non-goal line sits. [inferred]

*Confidence:* **medium.**

### Firebase — the realtime + offline + scale-to-zero original

*Model [observed]:* Google's BaaS — Firestore / Realtime Database (realtime NoSQL
with **offline persistence**), auth, cloud functions, hosting, and a generous
free tier that scales toward zero when idle.

- **Realtime + offline + instant prototyping** is the combination that won a
  generation of apps; the offline listeners and onboarding "magic" are the DX bar.
  [observed]
- **Scale-to-zero free tier** drove adoption — direct evidence for Snapback's
  prototype-for-free thesis. [observed]
- *Caution:* the **NoSQL data model** (no joins, query limits) and **vendor
  lock-in** are precisely the pains Snapback's relational + portable + open
  approach is the antidote to; costs can surprise at scale. [observed]
- *Influence:* learn the onboarding/offline/realtime DX; reject the data-model and
  lock-in. Snapback's pitch is "Firebase's magic without the lock-in or the NoSQL
  ceiling." [inferred]

*Confidence:* **high.**

### PlanetScale — branching and safe schema change

*Model [observed]:* serverless MySQL on Vitess — horizontal sharding for scale,
and a standout **database-branching + non-blocking online schema-change**
workflow (schema changes as reviewable "deploy requests"). (Note: free tier was
discontinued; Postgres support added more recently.)

- **Branching + safe, reversible schema migrations** is a premier DX and maps
  directly onto Snapback's schema-migration follow-on and agent validation
  (an agent can branch, migrate, verify, merge). [observed]
- **Vitess sharding** is one model for the scale-up end. [observed]
- *Caution:* the **free-tier removal** is a cautionary economics tale for any
  scale-to-zero promise; historical lack of foreign keys shows sharding's
  trade-offs. [observed]
- *Influence:* branching + online migrations should inform the migrations and
  portability LLPs; the economics lesson reinforces being honest about idle cost
  per target (LLP 0000). [inferred]

*Confidence:* **medium-high** (product details have changed; verify).

### Neon — serverless Postgres that suspends to zero

*Model [observed]:* serverless Postgres with **storage/compute separation**, so
compute **auto-suspends when idle (scale-to-zero)** and resumes on demand, plus
copy-on-write **branching** and "bottomless" storage.

- The reference implementation for **scale-to-zero on the Postgres (scale-up)
  end** — the missing piece in LLP 0000's note that always-on VMs don't bill to
  zero. Neon shows Postgres itself *can*. [observed]
- **Branching** for dev/preview/agent workflows, like PlanetScale. [observed]
- *Influence:* a leading candidate Postgres target, and the model for how
  Snapback's large-scale tier can still scale to zero; feeds the deployment and
  storage LLPs directly. [inferred]

*Confidence:* **high.**

### Val.town — run tiny code instantly, idle-free

*Model [observed]:* run JavaScript/TypeScript in the cloud instantly — functions
exposed as HTTP endpoints, plus cron and email, with near-zero setup and a
social/forkable surface. Great for small scripts and glue.

- **Instant deploy + idle-free + cron + HTTP endpoints** is the DX north-star for
  the prototype end of Snapback's lifecycle. [observed]
- **Code-as-endpoints with no ceremony** is exactly the agent-friendly loop:
  write code, it runs, it has a URL. [observed]
- *Caution:* deliberately small-scale; the data story isn't an app backend.
  [observed]
- *Influence:* informs the prototype-for-free experience, cron-as-builtin, and
  the code-execution DX; the scale-up story is where Snapback must exceed it.
  [inferred]

*Confidence:* **medium.**

### Ruby on Rails — comprehensive, coherent, paved-path

*Model [observed]:* the convention-over-configuration web framework — generators,
ActiveRecord + **migrations**, batteries included, sharp opinions, "everything
under one roof, designed together."

- The **philosophical north-star** for "comprehensive and coherent" and "paved
  path" — LLP 0000's Rails comparison is deliberate. [observed]
- **ActiveRecord migrations + generators** are a model for schema evolution and
  for agent scaffolding DX. [observed]
- *Caution:* not local-first, realtime-native, or scale-to-zero; its opinions can
  fight you; monolith scaling has known limits. [observed]
- *Influence:* adopt convention-over-configuration as the agent-first paved path
  and migrations/generators as DX; then add what Rails lacks — local-first,
  partial sync, realtime, scale-to-zero. [inferred]

*Confidence:* **high.**

### TanStack DB — the unbundled client live-query layer

*Model [confirmed — tanstack.com/db, 2026-07-23]:* a reactive client-side store
built on differential dataflow: collections backed by any source
(REST/GraphQL/tRPC/sync engines), with **incrementally maintained live queries**
over them — only the changed parts of joins/filters/aggregates recompute,
sub-millisecond over 100k+ rows in memory. Layers on TanStack Query; developed
in close collaboration with ElectricSQL, whose sync engine is a first-class
collection source. The 0.5 release (2025-11-12) added "query-driven sync": the
component's query *is* the API call, with eager/on-demand/progressive modes.

- **Client-side incremental view maintenance is proven tractable** — live
  relational queries do not require an integrated backend; the sync layer can be
  a commodity behind a collection interface. [confirmed — 0.5 release post]
- It is the **unbundled half of what Snapback integrates**, and the client API
  its arms will be compared against — with the gravity of the TanStack Query
  ecosystem behind it. [inferred]
- Still **pre-1.0 beta** (~0.6.x as of 2026-07; the December-2025 1.0 target
  slipped), MIT, very active. [confirmed — GitHub releases 2026-07-22]
- *Influence:* Snapback's integrated live queries must win on what the
  unbundled layer cannot own — server-authoritative correctness, permissions
  evaluated inside the query, one impedance surface instead of N backend
  adapters — and its client arm ([LLP 0005](./0005-contract-exact-react-integration.explainer.md),
  DK-9's store-agnostic client store) should track TanStack DB's collection/
  live-query API shapes as the emerging convention. [inferred]

*Confidence:* **high** for current state (primary-sourced 2026-07-23);
API details move fast pre-1.0.

### PocketBase — one binary, one SQLite file

*Model [confirmed — pocketbase.io/docs, GitHub, 2026-07-23]:* "open source
realtime backend in 1 file" — a single Go binary embedding SQLite: REST API,
realtime record subscriptions over SSE, email/OAuth2 auth, file storage, admin
dashboard, and an expression-based per-collection rules language; extensible as
a Go library or via embedded JS hooks. MIT, 60k+ GitHub stars.

- The **existence proof for Snapback's small end**: one binary + one SQLite file
  + declarative access rules covers a huge fraction of real apps, and the star
  count says demand for exactly this shape is enormous. [confirmed]
- Its ceilings mark Snapback's differentiation: subscriptions are **record-level
  change feeds, not maintained live queries**; no real server-function runtime;
  vertical-scale-only. [confirmed — docs]
- **Perpetual pre-1.0 with a bus factor of one** — a single maintainer who calls
  it a hobby project and declines 1.0 ETAs (v0.39.9, 2026-07-22, with a parallel
  0.22.x maintenance line). [confirmed — GitHub discussions/releases]
- *Influence:* validates the "so light an idle app costs nothing" end of
  [LLP 0000](./0000-snapback.explainer.md); Snapback's pitch at this end is
  PocketBase ergonomics plus live queries, real server functions, and a scale-up
  path — and PocketBase's fragility is the credibility gap it fills. [inferred]

*Confidence:* **high** (primary-sourced 2026-07-23).

### Encore — infra from typed code, then agents

*Model [confirmed — encore.dev, GitHub, 2026-07-23]:* open-source backend
framework (Go and TypeScript, MPL-2.0) where infrastructure is declared in
application code — Pub/Sub, databases, cron, secrets as typed objects; the
toolchain statically parses the app, provisions local infra, generates typed
API clients, and provides a local dev dashboard with tracing and architecture
diagrams. In May 2025 the team launched **Leap**, an AI agent that generates and
deploys Encore.ts apps to the user's own AWS/GCP; the repo now self-describes
as "infrastructure platform for the intelligence era."

- The strongest prior art for **"the app's source is the manifest"**: static
  analysis of typed code yields provisioning, clients, and observability for
  free — directly analogous to Snapback's schema/functions manifests driving
  codegen and capability manifests. [confirmed]
- The **agent pivot is the strategic lesson**: Encore concluded its declarative,
  verifiable surface mattered most as a substrate for AI codegen — independent
  validation of Snapback's agent-first bet from a team that arrived there by
  product evolution rather than thesis. [confirmed — Leap launch post; inference
  on significance]
- Thinly capitalized (~$4M pre-seed) for the scope of the bet. [observed —
  press]
- *Influence:* feeds [LLP 0010](./0010-agent-dx-and-acceptance.spec.md) and
  [LLP 0024](./0024-agent-operating-surface.spec.md) — a constrained,
  introspectable, typed backend surface is what makes agent codegen safe; the
  generated-client and dev-dashboard bar is concrete and current. [inferred]

*Confidence:* **high** for framework mechanics and the Leap pivot;
**medium** for business state.

### DBOS — durable execution owned by the database

*Model [confirmed — dbos.dev, GitHub, 2026-07-23]:* durable execution as a
library: DBOS Transact (TypeScript, Python, now Java/Go; MIT) checkpoints
workflow steps into your existing Postgres, giving crash-recoverable workflows,
queues, scheduled jobs, and exactly-once-style semantics with **no external
orchestrator cluster** — the explicit contrast is Temporal's dedicated server.
Founded by Stonebraker and Zaharia on the "the database is the OS" thesis;
$8.5M seed (2024); v4.24 released 2026-07-21.

- **Direct kin to [LLP 0070](./0070-durable-background-work.rfc.md):** it
  validates enqueueing work in the same transaction as application data and
  letting the database own claim/lease/retry state — the fenced-lease,
  at-least-once, idempotency-key design, arrived at independently. [confirmed +
  inferred]
- The difference is granularity: DBOS checkpoints **arbitrary code
  step-by-step** (durable *execution*), where LLP 0070 deliberately stops at
  durable *jobs* invoking version-pinned actions. DBOS is the argument the
  library-on-your-database shape wins on ops simplicity. [confirmed — docs]
- **Postgres-only coupling** is the gap Snapback's SQLite/DO-SQLite profile
  fills at the small end. [confirmed]
- *Influence:* [LLP 0070](./0070-durable-background-work.rfc.md) should cite
  DBOS as external corroboration and mine its retry/queue semantics; the
  step-checkpointing granularity question is a named non-goal to revisit if
  long actions demand it (with [LLP 0028](./0028-cron-scheduled-execution.rfc.md)
  cron as the schedule owner). [inferred]

*Confidence:* **high** (primary-sourced 2026-07-23).

### Evolu — E2EE local-first, the server goes blind

*Model [confirmed — evolu.dev docs, GitHub, 2026-07-23]:* TypeScript local-first
framework: client-side SQLite (WASM in browser; React/React Native) with a
typed schema and query interface, all data **end-to-end encrypted** and synced
as opaque CRDT messages through a relay the user can self-host — the server
stores ciphertext and the real database is derived locally from the CRDT log.
MIT; essentially one developer; stable line quiet since 2025-11 with a v3
prerelease in 2026-05.

- The **boundary statement**: E2EE buys data sovereignty by making the server
  blind — which structurally forfeits server-side live queries, server
  functions, permission evaluation, and any server-mediated authority.
  Everything must be client-computed and CRDT-merged. [confirmed — how-it-works
  docs + inferred]
- E2EE-relational-CRDT and server-evaluated live queries are close to **mutually
  exclusive design corners**; Evolu is what you build when the server *can't*
  be trusted, Snapback is what you build when server logic *is* the product.
  [inferred]
- *Influence:* sharpens [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)'s
  server-authoritative rationale by naming the corner Snapback deliberately does
  not occupy; if a hosted-privacy story is ever wanted, it is a different
  architecture, not a feature flag. [inferred]

*Confidence:* **medium-high** (primary-sourced but small project; moves
slowly).

### Nakama / Colyseus — the game-server lineage of room state

*Model [confirmed — heroiclabs.com, docs.colyseus.io, 2026-07-23]:* Nakama
(Apache-2.0, Go, Postgres-backed; v3.40.0 2026-07-13) is a game backend with
matchmaking, chat, leaderboards, storage, and **authoritative realtime
matches** — a server-side match loop at a fixed tick rate mutating in-memory
state and broadcasting deltas to present members. Colyseus (MIT, Node/TS;
0.17 line 2026) centers on **Rooms**: server-authoritative room state with
schema-based binary delta sync, lifecycle hooks, and matchmaking. Both monetize
via managed cloud hosting.

- Game servers solved ephemeral room state a decade before "sync engines": an
  authoritative in-memory object per room, mutated only by server logic,
  diffed to present members, **discarded when the room empties** unless
  explicitly persisted — precisely the shape of
  [LLP 0013](./0013-ephemeral-realtime-state.rfc.md) and the card-game demo.
  [confirmed + inferred]
- Their lifecycle primitives (join/leave/presence/expiry as first-class,
  separate from durable schema) corroborate LLP 0013's "ephemeral state is not
  faster durable data" rule. [inferred]
- **Tick-rate authoritative simulation loops** are a distinct workload
  Snapback's event-driven ephemeral API does not cover — worth naming as an
  explicit non-goal boundary, the same role SpacetimeDB plays above. [inferred]
- *Influence:* prior art and vocabulary for
  [LLP 0013](./0013-ephemeral-realtime-state.rfc.md); the tick-loop non-goal
  belongs next to LLP 0000's realtime-game boundary. [inferred]

*Confidence:* **high** for mechanics and licensing (primary-sourced
2026-07-23).

### Systems not yet surveyed (coverage gap)

This survey once omitted several systems that sit *closer* to Snapback's exact
bet than some it covers. **As of 2026-07-23 every named gap has a
primary-source pass:** ElectricSQL, PowerSync, and Turso/libSQL in
[LLP 0022](./0022-electric-powersync-turso.research.md); Cloudflare D1 +
Durable Objects (with Rivet as the open-source counterpart) in
[LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md); and Triplit/Ditto in
[LLP 0084](./0084-triplit-ditto.research.md). Two systems this document never
listed also earned deep passes on closer inspection:
[LLP 0082](./0082-instantdb.research.md) (InstantDB — the closest living
competitor to the live-query + ephemeral-state + permissions surface) and
[LLP 0085](./0085-jazz.research.md) (Jazz — the sharpest counterpoint to
server-authoritative auth). The entries below remain as the structural reason
each was prioritized (the stable part — specifics move fast, so read the owning
pass for current facts):

- **ElectricSQL** — Postgres↔SQLite sync with partial replication ("shapes") into
  a local SQLite store. Almost exactly Snapback's "SQLite local, Postgres at
  scale, sync the slice a client needs" thesis, and the closest living peer to the
  portability **and** partial-sync combination at once. [observed]
- **PowerSync** — local-first SQLite synced against Postgres/MongoDB via
  declarative, auth-scoped "sync rules" (bucketed partial sync). A direct data
  point for authorization-aware partial sync and the read-set/membership matcher
  ([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)). [observed]
- **Turso / libSQL** — a SQLite fork with embedded/edge replicas and
  scale-to-zero databases. The missing reference for the *SQLite* end of "scale to
  zero, then up" — what Neon is for the Postgres end — and a candidate substrate
  to compare against Ibex + SQLite. [observed/inferred]
- **Cloudflare D1 + Durable Objects** — SQLite-on-Workers (D1) and
  single-threaded stateful objects with alarm-driven wakeups (DOs). These are the
  *actual primitives* of LLP 0000's privileged second target, so they belong in
  prior art, not only in the deferred Cloudflare strategy: the no-poll
  change-notification seam
  ([LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md),
  [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)) is shaped by exactly
  this model. [observed]
- **Triplit / Ditto** — local-first sync engines with relational/collection
  queries and offline conflict handling; secondary, but useful additional data
  points for the query-result-vs-event-log question. [observed]

*Influence:* ElectricSQL, PowerSync, and Turso were the highest-priority
primary-source reads — each ships a part of Snapback's hardest combination (local
SQLite, server Postgres, authorized partial sync, scale-to-zero) in production
today — and that pass is now done in
[LLP 0022](./0022-electric-powersync-turso.research.md). Its headline: none of the
three validates generic bidirectional writes plus automatic semantic conflict
resolution as the core abstraction, corroborating LLP 0008's server-authoritative
model. [inferred]

## Synthesis — cross-cutting themes

1. **Reactive, query-driven sync is the convergent model.** [inferred] Convex,
   Zero/Replicache, LiveStore, and Supabase all converge on "subscribe to a
   query / dataset, get live + offline results." Snapback's local-first +
   realtime should likely be one query/subscription mechanism, not two bolted-
   together features.
2. **Authorization belongs in the query/sync layer.** [inferred] Supabase (RLS)
   and Zero (permissions) both learned this; the card-game reference app demands
   it. Partial sync must enforce who-can-see-what at the layer that decides what
   syncs.
3. **Code-next-to-data is a spectrum** (Rails → Supabase/Convex functions →
   SpacetimeDB reducers → Valet). [inferred] Snapback should pick its point
   deliberately — functions over the DB, almost certainly not logic inside the DB
   engine.
4. **Scale-to-zero is both a technical property and an economics promise.**
   [inferred] compute-suspend and machine-auto-stop models make it real on some
   scale-up targets; Firebase/Val.town-style free tiers made it adoption magic;
   but free tiers can change. Be honest per target (LLP 0000), and evaluate
   Neon-style compute suspend for the Postgres path.
5. **Branching + safe schema migration is a major DX win.** [inferred]
   PlanetScale, Neon, and Rails migrations all point at reversible, validatable
   schema evolution — central to the migrations and SQLite↔Postgres portability
   work, and a natural fit for agent validation loops.
6. **Open + relational + portable is the deliberate anti-lock-in stance.**
   [inferred] Learn Firebase's and Convex's DX magic; reject their lock-in and
   data-model ceilings. Supabase is the closest open peer to study, including its
   self-host operational realities.
7. **The non-goal line is real and has an owner.** [inferred] SpacetimeDB shows
   what a true realtime-game database looks like; that's the workload LLP 0000
   declares out of scope. The comparison validates the boundary — and the
   2026-07 batch adds a second marker on the same line: Nakama/Colyseus
   tick-rate authoritative simulation loops.
8. **The demand is proven; the suppliers are fragile.** [inferred, from the
   2026-07-23 batch] Across the six surveyed systems the recurring pattern is
   perpetual pre-1.0 status or single-maintainer risk (PocketBase, TanStack DB,
   Evolu, Colyseus) and thin capitalization for the size of the bet (Encore,
   DBOS) — while adoption signals (stars, ecosystems, acquirers) stay strong.
   The space Snapback enters has validated demand served by fragile suppliers;
   comprehensiveness plus institutional durability is itself a differentiator,
   and MIT/Apache licensing is table stakes everywhere.

## Open questions

- **Sync model:** query-result sync (Zero/Convex) vs. event-log sync (LiveStore)
  vs. table/replication-based (Supabase)? Which fits SQLite↔Postgres portability
  best?
- **Convex-grade reactivity on a standard relational store:** how close can
  Snapback get to reactive-by-default queries on SQLite/Postgres without a custom
  database?
- **Scale-to-zero on Postgres:** depend on Neon-style suspend, or define
  Snapback's own behavior across targets?
- **Authorization:** in-DB (RLS-style) vs. application/sync-layer rules — or both?
- **Where does the Valet-shaped architecture bend at production scale?** The
  highest-value remaining unknowns are the SQLite single-writer breaking point,
  realtime fan-out ceiling, retention/matcher cost, and hosted isolation model.
- **Which closer peers deserve the first primary-source pass?** Answered.
  ElectricSQL, PowerSync, and Turso/libSQL in
  [LLP 0022](./0022-electric-powersync-turso.research.md); Cloudflare D1 +
  Durable Objects (+ Rivet) in
  [LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md); Triplit/Ditto in
  [LLP 0084](./0084-triplit-ditto.research.md); InstantDB in
  [LLP 0082](./0082-instantdb.research.md); Jazz in
  [LLP 0085](./0085-jazz.research.md) — see
  [Systems not yet surveyed](#systems-not-yet-surveyed-coverage-gap).

## Next steps

- **Keep LLP 0006 current** as new Valet traces, issues, benchmark notes, or
  first-hand corrections surface; promote new design-bounding findings into the
  owning subsystem LLPs.
- **Verify the [observed] characterizations** against current primary sources
  before any of this hardens into a decision; this landscape moves quickly.
  [LLP 0022](./0022-electric-powersync-turso.research.md) and the 2026-07-23
  passes (LLP 0082–0085) do this for the closest peers, and the survey-batch
  sections above carry dated verification — the same treatment is still owed to
  the original pre-batch sections (Zero/Replicache, LiveStore, Supabase, Convex,
  SpacetimeDB, Firebase, PlanetScale, Neon, Val.town).
- **Feed findings into** the storage, local-first sync, realtime, migrations,
  auth, and DX follow-on LLPs as they evolve. LLP 0003 through LLP 0012 now
  consume the first Valet recovery pass; revisit them when production-scale
  prototype benchmarks or public-source verification change a premise.
- Given its foundational influence, run this through **`llp-review`** before
  promoting beyond `Draft`.
