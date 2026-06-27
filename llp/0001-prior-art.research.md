# LLP 0001: Prior art and influences

**Type:** Research
**Status:** Draft
**Systems:** Storage, Sync, Realtime, Runtime, Auth, Developer experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-06-25
**Revised:** 2026-06-27
**Related:** LLP 0000, LLP 0002, LLP 0003, LLP 0004, LLP 0006, LLP 0007, LLP 0008, LLP 0010, LLP 0011, LLP 0012, LLP 0022, https://github.com/expo/valet

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

### Systems not yet surveyed (coverage gap)

This survey omits several systems that sit *closer* to Snapback's exact bet than
some it covers. **The primary-source pass for the first three below — ElectricSQL,
PowerSync, and Turso/libSQL — is now
[LLP 0022](./0022-electric-powersync-turso.research.md); the entries here remain as
the structural reason each was prioritized.** The rest (Cloudflare D1 + Durable
Objects, Triplit/Ditto) still await a pass before this document leaves `Draft`;
named here so the gap is explicit, with only the **structural** reason each is
on-point (the stable part — specifics move fast, so verify):

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
   declares out of scope. The comparison validates the boundary.

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
- **Which closer peers deserve the first primary-source pass?** Answered for
  ElectricSQL, PowerSync, and Turso/libSQL in
  [LLP 0022](./0022-electric-powersync-turso.research.md). Still open: Cloudflare
  D1 + Durable Objects (the privileged second target's primitives, partly covered
  by [LLP 0014](./0014-cloudflare-strategy.rfc.md)) and Triplit/Ditto — see
  [Systems not yet surveyed](#systems-not-yet-surveyed-coverage-gap).

## Next steps

- **Keep LLP 0006 current** as new Valet traces, issues, benchmark notes, or
  first-hand corrections surface; promote new design-bounding findings into the
  owning subsystem LLPs.
- **Verify the [observed] characterizations** against current primary sources
  before any of this hardens into a decision; this landscape moves quickly.
  [LLP 0022](./0022-electric-powersync-turso.research.md) does this for the three
  closest peers — the same treatment is still owed to the other non-Valet systems
  here.
- **Feed findings into** the storage, local-first sync, realtime, migrations,
  auth, and DX follow-on LLPs as they evolve. LLP 0003 through LLP 0012 now
  consume the first Valet recovery pass; revisit them when production-scale
  prototype benchmarks or public-source verification change a premise.
- Given its foundational influence, run this through **`llp-review`** before
  promoting beyond `Draft`.
