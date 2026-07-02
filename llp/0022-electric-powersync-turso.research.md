# LLP 0022: ElectricSQL, PowerSync, and Turso/libSQL — the closest peers

**Type:** Research
**Status:** Draft
**Systems:** Storage, Sync, Realtime, Runtime, Auth, Deployment, Developer experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-06-27
**Revised:** 2026-07-01 (LLP 0032 R5: license-posture decision drafted as LLP 0033 and cross-referenced)
**Related:** LLP 0000, LLP 0001, LLP 0002, LLP 0007, LLP 0008, LLP 0011, LLP 0014, LLP 0018, https://electric.ax, https://www.powersync.com, https://turso.tech

## Summary

This is the primary-source pass [LLP 0001](./0001-prior-art.research.md) deferred on
the three living systems that each ship *a piece of Snapback's exact bet* — local
SQLite, server Postgres, authorization-aware partial sync, scale-to-zero-then-up,
truly open. [LLP 0001](./0001-prior-art.research.md) named them in its
[coverage gap](./0001-prior-art.research.md) and flagged them as higher-priority
reads than re-verifying the platforms it already surveyed. This document closes
that gap.

The single most important finding for Snapback's direction: **none of these three
peers validates generic bidirectional writes with automatic semantic conflict
resolution as the core abstraction.** ElectricSQL, branded "from the inventors of
CRDTs," shipped a full active-active Postgres↔SQLite CRDT engine and then *threw it
away* in 2024 and rebuilt as a read-path-first sync engine. PowerSync deliberately
externalizes writes to the app backend. Turso's newer Sync does own offline
push/pull, but chooses simple **last-push-wins** plus rollback-and-replay, not CRDT
or semantic merge. This is strong external corroboration of the choice
[LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) already made —
server-authoritative replay with last-write-wins, **not** CRDT merge — and it
sharpens several decisions Snapback has not yet pinned.

One-line headline per system:

- **ElectricSQL** — read-path partial sync over **cacheable HTTP**; the team that
  tried generic local-first writes + CRDTs and pared back to "a sync engine, not a
  local-first platform."
- **PowerSync** — authorization-scoped partial sync over local SQLite **in
  production today**, on its *second-generation* sync-rule model; the closest
  living implementation of Snapback's sync thesis, but always-on and
  source-available.
- **Turso / libSQL** — the SQLite *substrate* and the SQLite end of "scale to zero,
  then up"; embedded replicas, newer Turso Sync with lazy page-level partial sync
  and last-push-wins offline writes, database-per-tenant, and a from-scratch Rust
  SQLite rewrite still in beta.

## How to read this — provenance and confidence

This is the verification [LLP 0001](./0001-prior-art.research.md) asked for, so it
is held to a higher bar than that document's still-unverified non-Valet sections.
Factual claims rest on primary sources (vendor docs, vendor blog posts with dates,
GitHub repos, license files) gathered and cross-checked in **June 2026**. Tags:

- **[confirmed]** — verified against a dated primary source (URL given inline or in
  the per-system source list). This is the default for factual claims here.
- **[observed]** — stated by the vendor or a secondary source but *not*
  independently verified, or explicitly flagged uncertain by the research pass
  (betas, exact version numbers, unposted internals).
- **[inferred]** — this document's analysis of what the finding means for Snapback.
  Argument, not fact.

**This space moves faster than almost any other in the corpus.** Pricing, free
tiers, beta/GA status, and even licenses changed materially during the systems'
own histories (Turso's free-tier DB count, ElectricSQL's entire architecture,
PowerSync's sync model). Treat every dated fact as a snapshot and re-verify before
it hardens into a Snapback decision. Where the research could not confirm a claim
from a primary source, it is tagged **[observed]** and called out, not smoothed
over.

## Why these three, measured against what

Each peer is the closest living implementation of a different axis of Snapback's
bet, so each is measured against the Snapback LLP that owns that axis:

- **Authorization-aware partial sync** — owned by
  [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) (sync/realtime) and
  [LLP 0011](./0011-auth-and-permissions.rfc.md) (permission language).
  PowerSync and ElectricSQL are the references.
- **SQLite↔Postgres portability and the storage substrate** — owned by
  [LLP 0007](./0007-storage-portability.spec.md). Turso/libSQL is the reference,
  and a cautionary counter-example (it bets the opposite way).
- **Scale-to-zero-then-up and the deployment matrix** — owned by
  [LLP 0000](./0000-snapback.explainer.md) and
  [LLP 0014](./0014-cloudflare-strategy.rfc.md). Turso's reversal and Electric's
  CDN model are the references.
- **Truly-open licensing and agent-first DX** — owned by
  [LLP 0000](./0000-snapback.explainer.md). All three are data points; they
  diverge sharply on licensing.

## Findings

### ElectricSQL — the team that tried the hard thing and retreated

**What it is now.** Electric is "a Postgres sync engine" that syncs data out of
Postgres into clients over HTTP using a primitive called a **Shape** (a partial
replica defined by a table + optional `WHERE` clause). It runs as a separate Elixir
service between your API and Postgres, consumes the logical-replication stream, and
fans Shapes out over a low-level HTTP API. The client is **store-agnostic** —
Shapes materialize into plain JavaScript objects, a client store like TanStack DB,
or PGlite (Postgres-in-WASM); local SQLite is **not** required. 1.0 GA was
2025-03-17. [confirmed — electric.ax/docs/intro, /product/electric, 1.0 release post]

**The pivot — the most important thing in this document.** Through ~2024 Electric
was "bi-directional active-active replication with transactional causal+
consistency between Postgres in the cloud and SQLite on the local device,"
marketed "from the inventors of CRDTs," using Rich-CRDTs for conflict resolution, a
WebSocket "Satellite" protocol, a generated type-safe client, a DDLX permissions
system, and an explicit principle of **"finality of local writes… writes are final,
not tentative."** In July 2024 they rebuilt from scratch. In their own words
(2024-07-17, *electric.ax/blog/2024/07/17/electric-next*, verified verbatim):
[confirmed]

- "Electric Next is a **sync engine, not a local-first software platform**."
- The old no-rollback stance reversed: "In contrast, Electric Next **embraces
  tentativity**."
- Writes left the core on a staged plan: "1. start with read-path only 2. then add
  support for optimistic write patterns with tentativity 3. then add support for
  through-the-DB writes."
- They invoked **Gall's Law** and **"Worse is Better"**, blamed instability on
  having to own "a lot of stuff" (migrations, codegen, client reactivity,
  connection management, DB adapters), and — tellingly for a CRDT-branded team —
  **the pivot post never once uses the word "CRDT."** [confirmed]

The founder's candid version (James Arthur, localfirst.fm #18, verified verbatim):
"we just found that we were having **to solve too many problems** and there was too
much complexity making a kind of optimal one-size-fits-all sort of magic
active-active replication system"; building a generic write path "is **very, very
hard**, whereas building it on an application by application basis on the write path
is actually often fairly straightforward." [confirmed — localfirst.fm/18/transcript]

**Partial sync (Shapes).** Single-table only; **joins are not supported** (cross-
table filtering via subqueries is a preview behind a feature flag). The `WHERE`
clause is Postgres expression syntax (comparisons, `LIKE`/`ILIKE`, `IN`, arrays);
JSONB, full-text, and geometric operators are unsupported. Crucially, the read path
is **CDN-cacheable**: each response is addressed by an immutable log offset, so GETs
carry `etag`/`cache-control` and live mode rides CDN **request collapsing** — "this
is how Electric can support millions of concurrent clients with minimal load on the
sync service and no load on the source Postgres." Benchmarked 100k→1M concurrent
clients with flat memory/latency; Trigger.dev runs it at ~20k changes/sec.
[confirmed — /docs/guides/shapes, /docs/api/http, cloud beta post]. **Caveat:**
non-optimized `WHERE` forms (e.g. `ILIKE`, arithmetic) degrade *inversely with shape
count* (~1,400/s at 10 shapes → ~140/s at 100); only a fixed set of optimized
predicate forms holds ~5,000/s regardless of shape count. [confirmed — shapes guide]

**Authorization (gatekeeper pattern).** Client authenticates to a gatekeeper
endpoint, which mints a **shape-scoped JWT** carrying the shape definition as a
claim; a proxy validates the token and 403s if the requested shape doesn't match.
Design rules worth stealing: the **table is set server-side** ("letting clients
specify the table allows access to any table"), client subset filters are
**AND-combined so they can only narrow, never widen**, and **auth runs once at
token mint, off the per-request hot path.** [confirmed — /docs/guides/auth]

**Write path.** Explicitly *not* in the core: "Electric does read-path sync… It
doesn't provide (or prescribe) a built-in solution for getting data back into
Postgres." You write through your own API; the change re-syncs out via the Shape.
Four escalating patterns (online → component-scoped optimistic → durable optimistic
→ through-the-DB via PGlite). Optimistic state is kept in a **separate layer and
rebased** onto synced truth once the write round-trips back through sync, not
naively cleared. No CRDT/LWW in core; conflicts are "the app's job" and asserted to
be "extremely rare." The blessed modern stack is **Electric (read) + TanStack DB
(write/optimistic)**. [confirmed — /docs/guides/writes]

**Openness.** Sync engine **Apache-2.0**; PGlite dual Apache-2.0 / PostgreSQL
License — genuinely open, open-core cloud. [confirmed — github.com/electric-sql]

*Confidence:* **high** for current architecture, the pivot narrative, licensing,
and the CDN scale model (all primary-sourced and dated). **[observed]** for exact
PGlite patch version and a flagged, unverified 2026 blog filename hinting Electric
may reintroduce CRDTs *only* for collaborative-AI-agent (Yjs) scenarios — worth a
follow-up, since it bears on Snapback's agent-first angle.

### PowerSync — authorization-scoped partial sync, in production

**What it is.** Client SDKs that embed SQLite + a server-side **PowerSync Service**
that sits beside your source DB (Postgres GA; MongoDB GA; MySQL/SQL Server beta;
Convex experimental), consumes CDC/logical replication, and streams partial data to
clients over WebSocket (default) or HTTP. The app reads/writes local SQLite
directly. The Service is **not stateless** — it persists bucket state in its own
MongoDB/Postgres storage. The wire is **schemaless**; the client applies the dev's
schema as **SQLite views over JSON**, so schema changes need no client migration. A
shared **Rust SQLite extension** (`powersync-sqlite-core`, Apache-2.0) runs the
protocol "~5× faster than the JavaScript implementation." [confirmed —
docs.powersync.com/architecture/*]

**Partial sync, and its *evolution* (the highest-value lesson).** PowerSync's
original **Sync Rules** model (YAML `bucket_definitions`) split partial sync into a
**parameter query** (which *buckets/slices* a user gets, from trusted token claims)
and a **data query** (which *rows* fill each bucket). It was restrictive: no JOINs,
and "each data query must use every bucket parameter." That was limiting enough that
PowerSync built an entire **second system, Sync Streams (GA 2026-06-09)**, adding
JOINs, subqueries, CTEs, and **on-demand `subscribe()` with a TTL "warm cache."**
Sync Rules are now officially "legacy." [confirmed — /usage/sync-rules,
/sync/streams/*, changelog]. **[inferred]** The evolution is the lesson, not just
the mechanism: design for the *expressive* (Sync Streams) shape from day one rather
than shipping the constrained single-table-only model and being forced to bolt joins
on later.

**Authorization boundary.** Bucket/stream membership is derived server-side from
the **signed JWT** (`auth.user_id()`, trusted claims), and **client-supplied
parameters are untrusted** — using them for access control requires an explicit
`accept_potentially_dangerous_queries` opt-in and emits a loud warning. [confirmed
— /usage/sync-rules/advanced-topics/client-parameters]

**Consistency and the moving-data problem.** Buckets are **operation logs**
(`PUT`/`REMOVE`/`MOVE`/`CLEAR`), not row snapshots — which is what enables
incremental download, **cross-user dedup**, and compaction. A row reassigned
between buckets gets a `REMOVE` in the old and a `PUT` in the new, and is deleted
from a client only "when removed from **all** buckets synced to the client." Cross-
bucket **checkpoints** are applied atomically with per-bucket checksums, giving
"causal+ consistency." The elegant trick: **the client never advances its checkpoint
while local writes are pending, so it never resolves conflicts locally.** [confirmed
— /architecture/consistency, /powersync-protocol]

**Write path.** PowerSync deliberately **does not own writes.** Local SQL mutations
queue in a client `ps_crud` blocking FIFO; you supply a **backend connector**
(`uploadData()`) that pushes ops to *your own API*, which writes the source DB. The
default conflict model is **last-write-wins per field, delete-wins, backend-
authoritative, no CRDTs** — identical in spirit to
[LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)'s pinned v1 default. The
queue protocol is subtle and load-bearing: return **5xx only for transient errors**
(SDK retries), **never 4xx for validation/conflict** (it stalls the queue), **2xx
even on validation failure** with the error surfaced out-of-band via a separate
synced table; ops must be idempotent. [confirmed — /handling-writes/*,
/installation/app-backend-setup/writing-client-changes]

**Scale and licensing — where it diverges from Snapback.** It is **always-on and
does not scale to zero**: single replication writer, N stateless API containers, and
a continuously-running 3-node MongoDB replica set for self-hosting. Hard limit
~1,000 buckets/user; deploying a sync-rule change **re-creates all buckets from
scratch**. The Service is **Functional Source License 1.1** (source-available;
converts to Apache-2.0 two years after each release; restricts "Competing Use"),
while client SDKs and the Rust core are Apache-2.0. [confirmed — deployment-
architecture, performance-and-limits, LICENSE file]. **[inferred]** PowerSync's FSL
is a *deliberate* choice to block AWS-style resale — exactly the free-riding
Snapback's pure-MIT, "host it for other people" stance invites. Snapback's openness
is a real differentiator here, but the tradeoff PowerSync priced in should be a
conscious, named decision, not an accident. (Now drafted as
[LLP 0033](./0033-license-posture.decision.md), 2026-07-01.)

**Agent-first DX (a concrete bar).** Docs **MCP server**, an official **agent-skills
repo** (Claude Code / Cursor), `llms.txt`/`llms-full.txt`, and a browser **sync-rule
simulator**. [confirmed — /tools/ai-tools]

*Confidence:* **high** — almost everything is primary-sourced from current docs and
dated releases (service v1.23.0, 2026-06-25). **[observed]** only for a few exact
defaults (upload retry interval) the research could not pin.

### Turso / libSQL — the SQLite end of "scale to zero, then up"

**libSQL.** An **MIT-licensed, open-*contribution* fork of SQLite** (SQLite itself
is public-domain and famously closed to outside patches). It adds an `ALTER TABLE`
extension, native vector search (DiskANN), a **virtual WAL interface**, a server
mode, embedded replicas, and encryption at rest. It is production-grade but now
officially **feature-frozen** in favor of the Rust rewrite: "if you're starting a
new project, you probably want to look into Turso." [confirmed —
github.com/tursodatabase/libsql, sqlite.org/copyright.html]

**Embedded replicas and Turso Sync answer different problems.** Embedded replicas
are **whole-database, read-local / write-remote** replicas: reads are served from a
complete local SQLite file, writes route to the remote primary by default, sync
pulls 4 kB page-frames, and the consistency model is read-your-writes + monotonic +
eventual. Turso now recommends newer **Turso Sync** for sync-heavy projects: reads
and writes happen locally, applications explicitly `push()` and `pull()`, pushes
send logical statements, conflicts are **last-push-wins**, and pulls with unpushed
local changes atomically roll back to the last synced state, apply remote changes,
and replay local changes. [confirmed — /features/embedded-replicas, /sync/usage,
/sync/conflict-resolution]

**Turso's "partial sync" is page/working-set hydration, not authorization-aware row
sync.** The newer partial-sync docs describe opening a database without downloading
the whole file: a prefix bootstrap downloads the first N bytes, a query bootstrap
downloads pages touched by a server-side SQL query, and later reads lazily fetch
missing database pages on demand. That can hydrate a narrow working set, but the
docs do **not** describe signed per-user row filters, row-level authorization, or
permission-change removal semantics. Turso's scoping answer therefore remains
database-per-tenant plus optional query-bootstrap working sets, not PowerSync- or
Electric-style authorization-aware partial row/subscription sync. [confirmed —
/sync/partial, database-per-tenant posts]. **[inferred]** This is direct evidence
that the problem Snapback is taking on (the card-game "secret hands" case in
[LLP 0000](./0000-snapback.explainer.md)) is not solved merely by local SQLite
sync; the auth-aware result-set layer remains Snapback's hard part.

**Scale-to-zero — learn from the reversal.** Turso **built** an explicit VM-suspend
scale-to-zero, hit the wall that "once a request arrives, there is no guarantee
there will be enough capacity to bring the VM back," and **abandoned it** for a
"diskless" architecture: stateless compute over data-as-files in object storage
(S3 + S3 Express), 128 kB segments pulled on demand. Current framing: "**No process,
no scale-to-zero. There is nothing to scale to zero.** An idle database is simply a
set of files in object storage." [confirmed — what-is-turso, turso-cloud-goes-
diskless, year-into-rewriting]. **[inferred]** This maps directly onto
[LLP 0000](./0000-snapback.explainer.md)'s "idle cost is target-dependent" and
[LLP 0014](./0014-cloudflare-strategy.rfc.md): genuine scale-to-zero is achievable
when the DB is a file in object storage and compute is separable (the Cloudflare
Durable-Object + R2 shape), and is *not* achievable on an always-on Hetzner/VM box.
Turso paid to learn this; Snapback can cite it.

**Database-per-tenant.** Proven to millions of DBs with native isolation and no RLS;
a flagship customer runs **2 million databases**, one per AI-agent-generated app
version, with file-copy branching for rollback. Documented sharp edges: cross-tenant
analytics needs separate ETL; schema migration across millions of DBs is hard enough
that Turso **deprecated** push-based "Multi-DB Schemas" for a pull registry; and
isolation on shared compute is "good but not perfect." [confirmed — database-per-
tenant posts, adaptive-ai, analytics post]. **[inferred]** Relevant to Snapback's
multi-app/tenant hosting ([LLP 0018](./0018-app-instance-boundaries.rfc.md)): db-
per-app is a viable, agent-era model, but the migration-fan-out and cross-tenant-
query problems must be designed for early.

**Turso Database (the Rust rewrite, ex-"Limbo").** A from-scratch reimplementation
of SQLite in Rust (not a fork of the C code), file-format and SQL compatible, with
**async `io_uring` I/O, MVCC concurrent writes (`BEGIN CONCURRENT`), built-in
Deterministic Simulation Testing, CDC, and vector search**. MIT. **Still pre-1.0
beta** as of 2026-06-27 (latest a prerelease, `v0.7.0-pre.13`), and the strongest
signal of its maturity: **Turso's own cloud still runs on libSQL, not the rewrite.**
[confirmed — github.com/tursodatabase/turso, docs.turso.tech/libsql]. **[inferred]**
This is the closest external match to Snapback's Rust + SQLite substrate, and its
async-I/O and MVCC-concurrent-writes work bear directly on
[LLP 0007](./0007-storage-portability.spec.md)'s "async store interface from the
start" and on [LLP 0000](./0000-snapback.explainer.md)'s key unknown — the SQLite
single-writer breaking point. **Track it; don't build on it yet.** For production
today, libSQL (MIT) and rusqlite remain the grown-up options, and Snapback's
single-writer + WAL model is the proven path.

**Strategic divergence — the framing that matters most.** Turso is **SQLite-only;
there is no Postgres graduation.** Its answer to "scale up" is **horizontal** (many
small DBs + object storage), where Snapback's
([LLP 0007](./0007-storage-portability.spec.md)) is **vertical graduation** (one
abstraction over SQLite *and* Postgres, no rewrite). **[inferred]** These are
genuinely different bets. Turso can validate only the SQLite *end* of Snapback's
stack — never the graduation — and Snapback's portable SQLite→Postgres move is a
differentiator Turso doesn't attempt.

*Confidence:* **high** for licensing, embedded-replica and Turso Sync mechanics,
the scale-to-zero reversal, and db-per-tenant tradeoffs. **[observed]** and
explicitly time-sensitive for the Rust-rewrite status (changes weekly), pricing,
and any cold-start latency number (none is published).

## Synthesis — cross-cutting themes

1. **Automatic semantic conflict resolution is the wall.** [inferred] Electric
   (CRDT inventors) built it and retreated; PowerSync externalizes writes to the
   app backend; Turso owns offline push/pull but resolves conflicts with
   last-push-wins and atomic rollback-and-replay. The convergence is narrower but
   still load-bearing: none of the three puts generic CRDT/semantic merge in the
   core. This is exactly
   [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)'s pinned v1
   (server-authoritative replay, last-write-wins per field with delete-wins, CRDTs
   deferred), and it is a warning against quietly promoting CRDT merge into the
   ordinary row-sync core.

2. **Read-path / write-path separation is still the convergent architecture.**
   [inferred] Electric syncs reads and tells you to write through your API;
   PowerSync streams reads and hands you the `uploadData()` connector; Turso's
   older embedded replicas read-local/write-remote, while newer Turso Sync makes
   offline writes explicit through `push()` / `pull()`. Snapback already implies
   this seam (server-authoritative mutations + query-result sync); it should make
   the *separation* explicit, because it is also what makes authorization tractable.

3. **A CDN-cacheable HTTP read path is the scale-up lever Snapback hasn't
   committed to.** [inferred] Electric's biggest win is addressing each sync
   response by an immutable log offset so reads are `etag`-cacheable and live fan-out
   rides CDN request-collapsing — 100k→1M clients with flat load and "no load on the
   source Postgres."
   [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) currently treats
   transport as "WebSocket locally, something else later" and keeps change-
   notification as a swappable seam, but it does not yet embrace a cacheable HTTP
   read path. This is the most actionable single idea in this document for
   [LLP 0000](./0000-snapback.explainer.md)'s fan-out-ceiling open question and for
   the Cloudflare target ([LLP 0014](./0014-cloudflare-strategy.rfc.md)).

4. **Authorization is signed-token-scoped, narrow-not-widen, off the hot path.**
   [inferred] Electric's gatekeeper (server sets the table; client filters only
   narrow; auth at token mint) and PowerSync's trusted-JWT-vs-untrusted-client-
   parameter boundary are the same pattern from two angles. They give
   [LLP 0011](./0011-auth-and-permissions.rfc.md) and
   [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)'s "permission result
   feeds sync" a concrete, copyable shape — including the safety UX of a *loud
   opt-in* when a query's authorization rests on untrusted input.

5. **The single-table v1 subset is validated — and joins are the next wall for
   everyone.** [inferred] Electric Shapes are single-table (joins behind a flag);
   PowerSync's legacy buckets had no joins and that drove the Sync Streams rebuild;
   [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)'s syncable-live subset is
   "one primary table." Snapback's restriction is the right *v1* floor — but both
   peers are racing to add joins/subqueries/CTEs, so Snapback should design the path
   to expressive, authorization-bearing queries deliberately, not discover it later.

6. **Scale-to-zero wants DB-as-file-in-object-storage, not a VM.** [inferred] Turso
   tried VM-suspend and reversed; PowerSync and Electric are always-on services
   (Electric holds a replication slot; PowerSync needs a 3-node Mongo replica set).
   *None of the three actually scales to zero in an always-on self-hosted form.*
   This confirms [LLP 0000](./0000-snapback.explainer.md)'s per-target honesty: the
   only credible scale-to-zero substrate is serverless/object-storage-backed — the
   Cloudflare model — which raises the stakes on
   [LLP 0014](./0014-cloudflare-strategy.rfc.md) being done as a rearchitecture, not
   a port.

7. **The substrate question has a "now" and a "later" answer.** [inferred] *Now:*
   libSQL (MIT) + rusqlite, the proven path. *Later:* Turso Database's Rust + async
   `io_uring` + MVCC-concurrent-writes is the most relevant external substrate to
   watch for the single-writer breaking point and for
   [LLP 0007](./0007-storage-portability.spec.md)'s async-from-the-start interface —
   but it is pre-1.0 and Turso doesn't yet run it themselves.

8. **Openness is a real, uneven differentiator.** [inferred] Snapback's MIT lines up
   with libSQL/Turso Database (MIT engines, proprietary cloud) and ElectricSQL
   (Apache-2.0). It diverges from PowerSync's **FSL** service tier — which is
   precisely engineered to prevent the resale Snapback's "host it for other people"
   stance allows. Snapback's openness is genuine and differentiating; the
   free-riding exposure it accepts should be a named decision in
   [LLP 0000](./0000-snapback.explainer.md), not a blind spot.

9. **Agent-first DX is now table stakes, and PowerSync sets the bar.** [inferred]
   PowerSync ships a docs MCP server, an official agent-skills plugin, `llms.txt`,
   and a sync-rule simulator; Turso explicitly targets agents (db-per-app +
   instant branching for rollback of agent mistakes); Electric may be adding Yjs
   CRDT peering for collaborative agents. Snapback's agent-first thesis is being
   independently validated by its closest peers — and
   [LLP 0010](./0010-agent-dx-and-acceptance.spec.md) now has a concrete external
   bar to clear: an MCP/skills surface and a *permission/sync simulator* an agent
   can use to confirm what a given client would and would not sync.

## What to learn — actionable, mapped to owning LLPs

**Adopt / strongly consider:**

- **A cacheable, offset-addressed HTTP read path** as the scale-up and fan-out
  story, evaluated alongside the local WebSocket lane. → [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md),
  [LLP 0014](./0014-cloudflare-strategy.rfc.md), [LLP 0000](./0000-snapback.explainer.md)
  fan-out question.
- **The gatekeeper / signed-shape-token auth pattern** — server sets the table,
  client filters only narrow, auth at token mint off the hot path, loud opt-in when
  authorization rests on untrusted input. → [LLP 0011](./0011-auth-and-permissions.rfc.md),
  [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md).
- **Operation-log change records with cross-subscription dedup** and the "remove
  only when gone from all synced scopes" rule; **atomic cross-scope checkpoints**
  with checksums; "**client doesn't advance its checkpoint while writes are
  pending**, so it never resolves conflicts locally." → [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md),
  [LLP 0007](./0007-storage-portability.spec.md) (changeset/version contract).
- **On-demand subscribe with a TTL warm cache** as a refinement of query-
  subscription sync. → [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md).
- **Optimistic state as a separate layer, rebased on synced truth** (Electric /
  TanStack DB), which matches Valet's doc-id suppression intent in
  [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) and is worth comparing
  against it explicitly.
- **Turso's explicit push/pull plus atomic rollback-and-replay** as a concrete
  comparison point for Snapback's offline replay UX, even if Snapback keeps writes
  server-authoritative. → [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md).
- **An agent-facing sync/permission simulator + MCP/skills surface**, matching
  PowerSync's bar. → [LLP 0010](./0010-agent-dx-and-acceptance.spec.md).

**Treat as a deliberate decision, not a default:**

- **Mandated local SQLite vs store-agnostic client.** Electric found mandating
  embedded SQLite a *liability* (build-tool/migration/adapter bugs) and went store-
  agnostic; [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) currently
  inherits "SQLite on every platform" from Valet for query-parity reasons. Both are
  defensible; the Contract/Exact-first context may justify Snapback's choice — but it
  should be argued against Electric's experience, not assumed.
- **Designing for expressive (join-bearing) authorized queries from day one**, given
  both peers had to add joins after shipping the constrained model. →
  [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md),
  [LLP 0007](./0007-storage-portability.spec.md).

**Avoid / they hit this wall:**

- **Generic bidirectional writes with built-in conflict resolution / CRDTs in the
  core**, and **"finality of local writes" as the ordinary row-sync guarantee.**
  Electric's reversal is the evidence; Turso's last-push-wins sync is the simpler
  counterpoint. Keep [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)'s
  server-authoritative tentative-write model.
- **VM-suspend as the scale-to-zero mechanism** (Turso's abandoned approach). →
  [LLP 0014](./0014-cloudflare-strategy.rfc.md).
- **An expressive-predicate sync path with no fast-path design** — Electric's
  shape-count × predicate-cost cliff is the warning. → [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md).
- **Push-based schema migration across many per-tenant DBs**, if Snapback leans on
  db-per-app (Turso deprecated exactly this). → [LLP 0018](./0018-app-instance-boundaries.rfc.md).

## How this updates the corpus

- **Closes [LLP 0001](./0001-prior-art.research.md)'s coverage gap** for ElectricSQL,
  PowerSync, and Turso/libSQL, and answers its open question "which closer peers
  deserve the first primary-source pass." LLP 0001's "systems not yet surveyed"
  section and open questions should point here.
- **Promotes design-bounding findings into the owning LLPs** as they are revised:
  the cacheable-read-path option and gatekeeper auth pattern into
  [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) /
  [LLP 0011](./0011-auth-and-permissions.rfc.md); the object-storage scale-to-zero
  shape into [LLP 0014](./0014-cloudflare-strategy.rfc.md); the async/MVCC substrate
  watch into [LLP 0007](./0007-storage-portability.spec.md); db-per-tenant tradeoffs
  into [LLP 0018](./0018-app-instance-boundaries.rfc.md).
- **Does not change any ratified decision.** It corroborates
  [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)'s conflict model and
  [LLP 0000](./0000-snapback.explainer.md)'s openness and per-target idle-cost
  stances; the new material is option-surfacing, kept Draft.

## Open questions

- **Should Snapback adopt a cacheable, offset-addressed HTTP read path as a
  first-class lane** beside the local WebSocket one — and does the Contract/Exact
  client model make that natural or awkward?
- **Where exactly is the single-writer ceiling**, and does MVCC-concurrent-write work
  (Turso Database, or Postgres on graduation) move it enough to matter for the
  Partiful-scale north star? This stays the key empirical unknown from
  [LLP 0000](./0000-snapback.explainer.md).
- **Op-log vs whole-document deltas:** PowerSync's PUT/REMOVE/MOVE/CLEAR op log
  enables dedup and compaction;
  [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) currently sends whole
  documents for idempotency. Which wins for Snapback's wire and retention budget?
- **Is store-agnostic sync worth supporting** for the React/Expo secondary
  consumers even if Contract/Exact stays SQLite-backed?
- **Is Turso-style lazy page/working-set hydration useful** for desktop or large
  local stores, separate from authorization-aware row/subscription sync?
- **Does Snapback accept the free-riding exposure of pure MIT**, having seen
  PowerSync choose FSL specifically to prevent it?
- **What does an agent-facing sync/permission simulator look like** — can an agent
  ask "what would client X sync, and why is row Y excluded?" and get a checkable
  answer? (Feeds [LLP 0010](./0010-agent-dx-and-acceptance.spec.md).)

## Primary sources

Best entry points per system (gathered/verified June 2026; re-verify time-sensitive
facts):

- **ElectricSQL** — the pivot: *electric.ax/blog/2024/07/17/electric-next*; founder
  interview: *localfirst.fm/18/transcript*; writes: *electric.ax/docs/guides/writes*;
  HTTP/CDN: *electric.ax/docs/api/http*; shapes: *electric.ax/docs/guides/shapes*;
  auth: *electric.ax/docs/guides/auth*; license: *github.com/electric-sql/electric*.
- **PowerSync** — sync rules: *docs.powersync.com/usage/sync-rules*; Sync Streams:
  *docs.powersync.com/sync/streams/overview*; client-parameter trust boundary:
  *docs.powersync.com/usage/sync-rules/advanced-topics/client-parameters*;
  consistency: *docs.powersync.com/architecture/consistency*; writes:
  *docs.powersync.com/handling-writes/custom-conflict-resolution*; deployment:
  *docs.powersync.com/maintenance-ops/self-hosting/deployment-architecture*; license:
  *github.com/powersync-ja/powersync-service/blob/main/LICENSE* (FSL-1.1); agent DX:
  *docs.powersync.com/tools/ai-tools*.
- **Turso / libSQL** — libSQL: *github.com/tursodatabase/libsql*; embedded replicas:
  *docs.turso.tech/features/embedded-replicas/introduction*; consistency:
  *docs.turso.tech/reference/data-consistency*; offline sync: *docs.turso.tech/sync/usage*;
  partial sync: *docs.turso.tech/sync/partial*; conflict resolution:
  *docs.turso.tech/sync/conflict-resolution*;
  scale-to-zero reversal: *turso.tech/what-is-turso* and *turso.tech/blog/turso-cloud-goes-diskless*;
  db-per-tenant: *turso.tech/blog/database-per-tenant-architectures-get-production-friendly-improvements*;
  Rust rewrite: *github.com/tursodatabase/turso* and *turso.tech/blog/introducing-limbo-a-complete-rewrite-of-sqlite-in-rust*;
  maturity matrix: *docs.turso.tech/libsql*.

## Status

Draft. This is the primary-source pass [LLP 0001](./0001-prior-art.research.md)
deferred, written to inform the sync, storage, auth, deployment, and DX LLPs without
yet changing any of them. Revise when Snapback's first prototype measures its own
fan-out and single-writer behavior against these peers' published numbers, when the
Turso Database rewrite reaches GA, or when any of these fast-moving systems shifts
again.
