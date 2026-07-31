# LLP 0128: Popular-app storage scale

**Type:** Research
**Status:** Active
**Systems:** Storage, Runtime, Sync, Realtime, Query planning, Deployment, Performance, Client integration, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-30
**Revised:** 2026-07-30 (v0.3 accepted — dual-family READY; author advanced Review → Active and adjudicated the challenge provenance as a confirmed paraphrase)
**Related:** LLP 0000, LLP 0003, LLP 0004, LLP 0007, LLP 0008, LLP 0012, LLP 0014, LLP 0018, LLP 0035, LLP 0046, LLP 0050, LLP 0051, LLP 0080, LLP 0083, LLP 0090, LLP 0103, LLP 0104, LLP 0115, LLP 0120, LLP 0125, LLP 0126, LLP 0127, https://www.sqlite.org/whentouse.html, https://www.postgresql.org/docs/current/logicaldecoding-explanation.html, https://www.postgresql.org/docs/current/logical-replication-architecture.html, https://apple.github.io/foundationdb/architecture.html, https://apple.github.io/foundationdb/features.html, https://www.cockroachlabs.com/docs/stable/architecture/overview/, https://www.cockroachlabs.com/docs/stable/architecture/transaction-layer/, https://developers.cloudflare.com/durable-objects/platform/limits/, https://developers.cloudflare.com/workers/platform/storage-options/, https://developers.cloudflare.com/d1/best-practices/read-replication/, https://apple.github.io/foundationdb/known-limitations.html, https://www.postgresql.org/docs/current/mvcc-intro.html

## Summary

The challenge behind “why build Snapback around SQL if SQL does not scale?”
(external feedback to the author from Philippe; the author confirms the
substance of this paraphrase, with the verbatim wording, date, and channel
deliberately left unrecorded — adjudicated 2026-07-30) is real, but the
premise combines three independent choices:

1. the **application model** authors use — Snapback's typed
   document/relational contract and bounded query language;
2. the **execution language** an adapter may compile to — SQL today, but not
   necessarily SQL on every future target;
3. the **physical authority topology** — one SQLite file, one Durable Object,
   one Postgres primary, partitioned transactional cells, or a distributed
   substrate.

SQL is not itself the present popular-app ceiling. Snapback's ceiling is the
stronger and more specific decision that one logical app stream has one
gap-free commit-version authority. The canonical SQLite target, the current
Durable Object hosted design, and LLP 0007's first Postgres graduation path all
preserve that authority in different physical forms. Replacing SQL with a
document, key-value, or log API while keeping one authority would leave the
same write ceiling. Conversely, a SQL system can scale across ranges and
machines, at the cost of distributed coordination, retries, latency, and
operational complexity.

The leading research hypothesis is therefore:

> Keep Snapback's typed, bounded relational contract as the author-facing
> model, but do not define Snapback's identity by SQLite, SQL text, one
> physical database, or one permanent app-wide stream.

The credible scale-up families are:

- make the current single-authority cell larger and add read replicas/caches;
- graduate the authority to Postgres and derive the change stream from its
  commit log;
- partition an app into transactional cells with explicit locality and
  multiple streams;
- adopt distributed SQL;
- build Snapback's relational and sync layers over a distributed
  transactional ordered key-value store;
- make an ordered log the durable write core and maintain queryable
  projections.

Those are the authority families (A–F below); a companion family (G)
scales reads, search, and fanout beside any of them, and one family —
multi-master/merge acceptance — is recorded below as considered and
excluded.

No option is an unqualified winner. This document recommends measurement and
contract preparation, not a substrate choice. It is not a gate on LLP 0115's
execution or sequencing, nor on the substrate-neutral work in LLP 0127; the
named semantic decisions listed under §Relationship take this document's
evidence as an input before they are pinned. It is a parallel guardrail before
Snapback commits to app-global sequence/aggregate semantics, accepts the
local-first successor Plan, promises popular-app throughput, or treats
Postgres as the final rather than first graduation step.

## Question and scope

This Research owns one question:

> If a single Snapback app becomes too write-heavy, too large, too
> geographically distributed, or too read-heavy for one current authority,
> which physical architecture should carry Snapback's existing product
> contract?

“Scale” is decomposed because the answers differ:

- **write throughput:** independent writes per second and hot-key contention;
- **read throughput:** query and subscription fanout;
- **data size:** working set, retained journal, indexes, and snapshots;
- **geographic latency:** distance to the write authority and readers;
- **availability:** failure domains, recovery time, and tolerated partitions;
- **tenant isolation:** one popular app versus many ordinary apps;
- **operability and cost:** minimum cluster, backups, rebalancing, debugging,
  and local parity.

This document does not select a database, revise the portable application API,
design an intra-app shard protocol, or authorize a hosted scale claim. It also
does not reopen SQLite as the canonical local target. Those are later
decisions, informed by the evidence program below.

## Method and provenance

The Snapback claims were checked against the governing LLP corpus on
2026-07-30. External facts were checked against current first-party
documentation from SQLite, PostgreSQL, FoundationDB, CockroachDB, and
Cloudflare on the same date.

Tags distinguish provenance:

- **[confirmed]** — stated by a cited primary source or governing Snapback
  document;
- **[observed]** — true of the current Snapback design or implementation, but
  not a general result;
- **[inferred]** — this document's architectural interpretation or proposal.

The external systems are reference points, not a complete bakeoff. Product
economics, licensing, managed-service quality, failure behavior, and
Snapback-specific performance remain unmeasured.

## Findings

### 1. SQL, SQLite, and a single writer are different decisions

SQLite explicitly supports many simultaneous readers but one writer at a time
per database file. Its own guidance recommends a client/server database when
many writers cannot queue, while also noting that short transactions let
SQLite handle more concurrency than the slogan suggests. [confirmed —
SQLite, “Appropriate Uses For SQLite”]

That is a property of SQLite's authority and concurrency model, not a theorem
about SQL. PostgreSQL permits concurrent writers. Distributed SQL systems
partition the underlying ordered keyspace into ranges and coordinate
transactions spanning those ranges. An ordered key-value store such as
FoundationDB can also provide serializable multi-key transactions and expose a
relational model through a layer. [confirmed — PostgreSQL MVCC documentation,
CockroachDB and FoundationDB architecture documentation]

**Influence:** Snapback should ask “what is the write authority and
transactional domain?” before asking “is it SQL?” A storage design that merely
translates the same single-authority state machine from SQL to key-value has
not solved popular-app write scale. [inferred]

### 2. Snapback deliberately has one app-stream authority today

LLP 0007 assigns one gap-free monotonic commit-version stream to a logical app.
SQLite takes an `IMMEDIATE` writer reservation; the proposed Postgres adapter
uses a short commit fence; a Durable Object allocates from its single-threaded
authority. LLP 0007 already names the fork if one app shards across Durable
Objects: funnel allocation through one coordinator, or create distinct streams
and make clients carry multiple cursors. Nothing yet designs the second path.
[confirmed — LLP 0007]

LLP 0103 chooses one environment coordinator that owns rows, the version
counter, journal, subscriptions, outbox, cron state, and related durable
facts. LLP 0104 makes
the resulting single-coordinator `transactionSync` write-rate ceiling part of
the commercial limit rather than implying infinite scale. Cloudflare's current
published model matches that boundary: Durable Objects scale horizontally
across objects, while each individual object is single-threaded and has a soft
request-rate limit. [confirmed — LLP 0103, LLP 0104, Cloudflare Durable
Objects limits]

**Influence:** Philippe's concern correctly identifies an unresolved
popular-app ceiling. It is not evidence that the existing choice is wrong for
ordinary apps; it is evidence that tenant-level horizontal scale is still an
unowned design problem. [inferred]

### 3. The typed relational contract is valuable independently of SQL

Snapback authors do not submit arbitrary SQL. LLP 0004 and LLP 0007 define
typed schemas, engine-independent ids and values, declared indexes, bounded
queries, deterministic ordering, transaction behavior, and portable
diagnostics. LLP 0080 extends that contract with bounded relational profiles
rather than general joins. Adapters are responsible for implementing those
semantics. [confirmed — LLP 0004, LLP 0007, LLP 0080]

FoundationDB calls the same separation a “layer”: a richer data model maps to
an ordered transactional key-value core. CockroachDB presents SQL above a
distributed range-based key-value and transaction layer. These systems differ
greatly, but both demonstrate that a relational authoring model does not force
one-file storage. [confirmed — FoundationDB and CockroachDB architecture
documentation]

**Influence:** abandoning the relational contract would discard schema,
indexing, authorization, query-planning, and agent-legibility benefits without
automatically gaining scale. A future non-SQL adapter should compile the same
closed operations to its native primitives unless evidence shows the
application model itself is the limit. [inferred]

### 4. Postgres is a useful graduation, not a complete scale-out answer

LLP 0046 intentionally proves a single-app Postgres target and explicitly
lists horizontal write scaling as a non-goal. Its commit-fencing design moves
handler work into a concurrent server but serializes the short tail that
allocates a gap-free app version. This can be a large practical improvement
over SQLite while retaining a measurable ceiling. [confirmed — LLP 0007,
LLP 0046]

PostgreSQL logical decoding extracts committed changes from WAL into a
replayable stream, and built-in logical replication applies changes in
transactional order. It does not by itself partition a single primary's
writes, and consumers must tolerate re-delivery after slot position rollback
on crash. [confirmed — PostgreSQL logical-decoding and logical-replication
documentation] That machinery makes a commit-log-derived Snapback stream a
credible feasibility hypothesis as an alternative to a framework-maintained
version row — credible, not established: before it could replace the fence, a
spike must show the feed satisfies Snapback's mutation-level versioning,
gap-free visibility, no-op mutations, schema transitions, snapshot cut,
retention, failover, and synchronous receipt obligations (open question 3).
[inferred]

Read replicas attack a different dimension. Cloudflare D1, for example,
routes writes to a primary and uses bookmarks to give sessions sequentially
consistent reads from replicas. This can improve read latency and throughput
without increasing primary write throughput. [confirmed — Cloudflare D1 read
replication]

**Influence:** implement and measure Postgres because it is a valuable,
portable second target, with LLP 0007 DK-2's commit fence as the decided
graduation default. Do not treat “SQLite → Postgres” as the settled answer
to popular-app horizontal scale, and do not harden the framework counter into
a permanent contract if the database commit log — 0007's recorded but
deliberately undesigned escape hatch — can eventually provide the required
ordering. [inferred]

### 5. Every scale-out family moves complexity into a different contract

Horizontal scale is not free in any candidate:

- partitioned cells require a partition key, routing, rebalance semantics,
  multi-stream cursors, and an answer for cross-cell operations;
- distributed SQL coordinates transactions across replicated ranges and may
  require transaction retries under serializable isolation;
- a transactional key-value substrate requires Snapback to build and operate
  relational indexes, migrations, query planning, change extraction, and
  inspection as a layer;
- a log-first core makes append and replay natural but requires maintained
  projections, snapshot consistency, uniqueness enforcement, compaction, and
  a plan for synchronous reads after writes;
- caches and replicas improve reads but require freshness, invalidation, and
  resume rules while leaving the write authority intact.

CockroachDB's documented transaction layer is representative: cross-range
transactions are possible because the system performs distributed atomic
commit over replicated intents, and serializable conflicts can require
retries. FoundationDB makes a different trade: a minimal ordered
transactional core supports layers, while applications take responsibility
for the higher model and inherit the core's documented limits — roughly a
10 MB hard ceiling on a transaction's affected data (with under 1 MB
recommended), a five-second transaction duration limit, and a database that
is not itself a user-level security boundary. Those limits fall directly on
Snapback's handler-duration, large-mutation, bulk-operation, and
authorization contracts. [confirmed — CockroachDB transaction-layer
documentation; FoundationDB architecture and known-limitations
documentation]

**Influence:** the useful question is which complexity Snapback can hide once,
test deeply, and expose honestly through capability facts—not which database
category has the strongest scale slogan. [inferred]

### 6. Snapback already has two important escape hatches

First, LLP 0012 requires clients to treat `(stream identity, version)` as an
opaque resume token. They must not compare versions across streams or assume
that one stream survives intra-app sharding. This avoids a wire-format dead
end, provided new clients keep honoring it. [confirmed — LLP 0012]

Second, the bounded-profile program makes data access more legible than
arbitrary SQL or arbitrary application code. Today's profiles declare keys,
budgets, and relational shapes; maintained aggregates are not yet among them —
LLP 0080 excludes aggregation, and LLP 0127 Move 6 proposes the aggregate
extension that LLP 0115 CV-8 must still decide. Declared shapes — and
aggregates if that proposal lands — can become placement facts: the platform
can know which operations are single-cell, which fan out, and which cannot be
retained or executed locally. [confirmed — LLP 0080, LLP 0115, LLP 0127;
placement use is inferred]

**Influence:** 0115 and most of 0127 should proceed. Their declarative work is
part of the solution. The guardrail is to avoid converting “one authority
today” into app-visible promises of one permanent stream, one global sequence,
or cheap global atomicity. [inferred]

## Candidate architecture families

### A. Larger single-authority cells

Keep one transactional authority per app or environment, make it faster, and
scale reads separately. Examples include optimized SQLite/DO execution,
vertical resources, batched writes, caching, snapshots, and read replicas.

**Strengths:** simplest correctness model; lowest local/hosted semantic gap;
natural transactions, live-query invalidation, backup, and debugging; strong
fit for the majority of tenant-isolated apps.

**Costs:** one app retains a hard write and storage ceiling; a hot app cannot
consume arbitrary horizontal capacity; geographic writes still travel to one
authority.

**Use if:** measurements show the ceiling is comfortably above the product's
target workload or only a very small exceptional tier exceeds it.

### B. Postgres authority plus commit-order changefeed

Use Postgres for concurrent transaction execution, indexes, operational
tooling, and larger storage; derive Snapback's journal/resume position from
logical decoding or an equivalent commit-order feed rather than funneling all
commits through a framework counter forever.

**Strengths:** conventional operations and ecosystem; much higher practical
ceiling than the local target; preserves the relational mapping; read replicas
and CDC are mature concepts; a straightforward graduation story.

**Costs:** one primary remains the normal write authority; logical slots,
retention, duplicate delivery, schema changes, failover, and snapshot/feed
cutover need design; the mapping between database positions and Snapback's
opaque stream tokens must be pinned.

**Use if:** Postgres clears the measured popular-app bar without requiring
intra-app horizontal writes, or is the best intermediate target while a later
partitioning contract remains open.

### C. Partitioned transactional cells

Divide one app by a declared placement key—such as workspace, room, project,
organization, or another membership-addressed root. Each cell owns its data,
transactions, version stream, journal, live-query invalidation, and possibly
co-located compute. A routing/control layer maps logical roots to cells. The
family admits two implementation lanes: Snapback-routed cells (for example
one Durable Object per cell) or database-owned sharding behind a declared
distribution key (Citus/Vitess-style). The second lane is a feasibility
hypothesis, not an established equivalent: both lanes must satisfy the same
observable cell contract — per-cell transactions, a per-cell version stream
and journal, per-cell live-query invalidation, and declared routing — and
the lanes differ in who owns routing, cross-shard transactions, resharding,
and journal topology. Where the hypothesis holds, the database-owned lane
trades Snapback-owned machinery for more of family B's ecosystem.

**Strengths:** matches Cloudflare's horizontal unit and Snapback's tenant/local
operation patterns; independent partitions scale writes and failure domains;
local transactions stay simple and fast; a hot app can use many cells.

**Costs:** cross-cell transactions and queries become distributed, asynchronous,
or unsupported; repartitioning is a protocol; global uniqueness, sequences,
aggregates, auth invalidation, backup cuts, and subscriptions need explicit
scope; skewed hot roots remain hot.

**Use if:** real workloads have stable locality keys and most operations can be
proved single-cell from bounded profiles.

### D. Distributed SQL

Run the portable relational model on a database that automatically partitions
and replicates ranges while supporting SQL and distributed transactions.
CockroachDB represents the family; this Research does not select it.

**Strengths:** preserves SQL tooling and relational semantics; horizontal
storage and independent-key write scale; cross-range transactions remain
available; replication and rebalancing belong to the database.

**Costs:** higher latency and operational minimums than embedded SQLite;
contention and retry semantics must match Snapback's evidence model;
changefeed/resume integration, locality configuration, cost, licensing, and
local development all require qualification; distributed transactions do not
make a single hot key scalable.

**Use if:** cross-partition transactions are product-essential and delegating
coordination to a mature database is cheaper and safer than designing cells at
the Snapback layer.

### E. Transactional ordered key-value foundation

Map schemas, rows, secondary indexes, journals, auth witnesses, and projections
into ordered key ranges on a distributed ACID key-value store such as
FoundationDB.

**Strengths:** the logical key layout and key-range boundaries are under
Snapback's control (FoundationDB's data distributor owns physical placement
and repartitions ranges automatically); multi-key serializable transactions
and ordered ranges are strong primitives for indexes and journals; one
substrate can support several logical models.

**Costs:** Snapback becomes a database layer author and operator: tuple
encoding, indexes, uniqueness, query planning, migrations, hot-key avoidance,
changefeeds, observability, and compatibility all become its responsibility
(backup/restore machinery is substrate-provided but becomes Snapback's to
integrate and operate); FoundationDB-specific transaction and operational
constraints — the affected-data and five-second duration limits above, and
the absence of a user-level security boundary — would enter the product.

**Use if:** Snapback's product requires custom logical clustering and model
control that SQL databases cannot supply economically, and the team is
willing to own a substantial distributed storage layer.

### F. Log-first core with maintained projections

Make a partitioned ordered log the durable mutation authority. Each accepted
operation appends once; deterministic projectors maintain queryable state,
indexes, search structures, subscription deltas, and snapshots.

**Strengths:** replay, audit, change delivery, branching inputs, and asynchronous
consumers become native; partitioned append throughput can scale; projections
can be specialized by workload.

**Costs:** atomic uniqueness and read-modify-write constraints across
partitions are difficult; synchronous query-after-write semantics require
careful coordination; projection lag, rebuilds, poison events, schema evolution,
and log retention become central operational concerns. The design risks
rebuilding a transactional database around the log.

**Use if:** the product's dominant contract becomes event/replay-centric and
can accept explicitly scoped transactions plus projection freshness. Current
Snapback semantics do not yet establish that premise.

### G. Hybrid cells with specialized read services

Keep an authoritative transactional cell for ordinary state and publish
committed changes into dedicated services for global search, analytics,
vectors, fanout, cache, and large assets.

**Strengths:** lets each subsystem scale on its natural axis; preserves simple
transactional writes; likely needed alongside any authority choice.

**Costs:** non-authoritative projections need freshness and authorization
contracts; global results may lag; operational surface grows; it does not solve
the cell's own write ceiling.

**Use if:** measurements show read/search/fanout pressure binds before
transactional writes, or as the companion architecture to A–E.

### Considered and excluded: multi-master / merge acceptance

Accepting writes at several authorities and merging afterward — leaderless
replication, hybrid-logical-clock ordering, or CRDT merge — is the one family
that directly attacks geographic write latency, and it is excluded
deliberately rather than overlooked. LLP 0007 rejected HLC-style ordering for
the v1 contract because it cannot give gap-free “changes since N” semantics
without additional stability-watermark machinery, and recorded the revisit
trigger: a design that requires multi-master writes within one app stream
(nothing planned does). LLP 0127 likewise records CRDT core and raw replica
as rejected for the local-first program. [confirmed — LLP 0007, LLP 0127]
Every family above therefore leaves a distant write traveling to one
authority per app, cell, range, or partition; geographic write latency is
answered by placement (family C's cell locality, family D's range locality),
not by write multi-homing, unless the author reopens the ordering contract
itself. [inferred]

## Comparative frame

The ratings below are hypotheses for directing experiments, not benchmark
results.

| Family | Independent-key writes | Hot-key writes | Cross-partition atomicity | Local parity | Snapback-owned machinery |
| --- | --- | --- | --- | --- | --- |
| A. Larger cell | Low–medium | Low | Native inside one cell | Excellent | Low |
| B. Postgres + feed | Medium–high | Low–medium | Native inside one primary | Good | Medium |
| C. Partitioned cells | High | Low per hot cell | Explicit/limited | Good per cell | High (Snapback-routed lane; lower with database-owned sharding) |
| D. Distributed SQL | High | Low per hot range | Database-provided, coordinated | Weak–medium | Medium |
| E. Transactional KV | High | Low per hot key/range | Substrate-provided within limits | Weak | Very high |
| F. Log-first | High by partition | Low per partition | Difficult across partitions | Medium | Very high |
| G. Specialized reads | Does not change authority | Does not change authority | Authority-dependent | Medium | Medium–high |

The first table rates the axes that discriminate authority topology. “Local
parity” means how faithfully local development reproduces the hosted target;
distributed SQL rates weak–medium because embedded or single-node harnesses
(LLP 0046's option) only partially reproduce distributed behavior. Every
family preserves per-app logical isolation, but logical isolation is not
resource, security, or failure isolation, so the companion table carries a
tenant-isolation column: dedicated cells, shared primaries, shared
distributed clusters, and shared projections contain noisy neighbors and
failures differently, and the cost of isolating one exceptional app from
ordinary apps differs by family. Operability and cost are Phase-1
measurands, not a-priori ratings. The remaining decomposed scale axes
differ by family too:

| Family | Read scaling | Data-size ceiling | Geographic latency | Availability model | Tenant/resource isolation |
| --- | --- | --- | --- | --- | --- |
| A. Larger cell | Medium via replicas/caches | One cell's storage | Writes and uncached reads travel to one site | One failure domain; cell restore/failover | Strong — a dedicated cell per app |
| B. Postgres + feed | High via mature replicas | One primary's storage (large) | Writes to one primary; replica reads regional | Mature primary failover; feed cutover must be designed | Depends on packing — per-app primaries isolate; shared primaries contend |
| C. Partitioned cells | High across cells | Sum of cells | Cells placeable near users; cross-cell work pays distance | Per-cell failure domains; shared control plane | Strong per cell; the control plane is the shared blast radius |
| D. Distributed SQL | High (incl. follower reads) | Horizontal across ranges | Configurable locality; quorum writes pay replica RTT | Replicated ranges survive node/zone loss | Shared-cluster contention unless dedicated; dedication raises the operational minimum |
| E. Transactional KV | High | Horizontal | Cluster-topology-dependent; quorum writes | Replicated core; operations Snapback-owned | Shared cluster; the substrate is not a user-level security boundary |
| F. Log-first | High via projections | Horizontal by partition | Partition placement; projection lag separates readers | Replicated log plus projection rebuild | Shared log and projectors; consumer lag contends across apps |
| G. Specialized reads | High for offloaded reads | Offloads derived data | Read services placeable near readers | More services; authority unchanged | Per-service — derived stores isolable per app at cost |

Families combine rather than exclude one another — A+G, B+G, C implemented on
Postgres cells, or D beneath G are all coherent compositions.

No row turns one contended counter into horizontal throughput. The sequence
primitive proposed by LLP 0120 and LLP 0127 Move 6 (riding LLP 0115's CV-8
tranche), for example, may remove an avoidable scan but still creates a
serialization point at its declared scope. The scope is therefore part of
the API, not an implementation footnote.

## Contract guardrails before choosing a substrate

These rules preserve the option space while 0115/0127 proceed. Guardrail 1
restates decided contract (LLP 0007, LLP 0012); guardrails 2–7 are proposals,
to be enforced through the owning LLP 0115 items, LLP 0127 moves, or the
Phase 3 RFC rather than by this Research.

1. **Opaque cursors stay opaque.** Preserve `(stream identity, version)` and
   never expose arithmetic or cross-stream comparison.
2. **Every sequence names its scope.** A counter is table-, root-, cell-, or
   explicitly app-scoped; “global” is never an accidental default.
3. **Atomicity names its domain.** Documentation and generated capabilities
   distinguish single-cell atomicity from any cross-cell workflow.
4. **Placement is declared, not guessed from code.** If cells become viable,
   schema and bounded-operation manifests must identify the routing root and
   every operation's touched roots.
5. **Global views admit freshness.** Search, analytics, cache, and aggregate
   projections say whether they are transactional, read-your-writes, bounded
   stale, or eventually consistent.
6. **Adapters own physical execution, not semantics.** SQL generation,
   key-value encoding, log projection, and changefeed mechanics must all pass
   the same observable conformance contract where a target claims parity.
7. **Cross-partition escape hatches are visible.** Fanout, sagas, asynchronous
   jobs, and distributed transactions carry budgets, receipts, and stable
   failure modes rather than pretending to be ordinary local operations.

## Evidence program

### Phase 0 — define the popular-app workload

Before choosing technology, freeze workload envelopes rather than one synthetic
throughput number:

- small independent transactions across many roots;
- one hot membership-addressed root;
- one global sequence or aggregate;
- multi-row single-root transactions;
- cross-root reads and writes;
- subscription fanout with reconnect and retained replay;
- large snapshots and sustained journal retention;
- region-local reads and geographically distant writes;
- one exceptional popular app colocated with many ordinary apps;
- backup, restore, failover, and reshard recovery.

Each profile states offered arrival rate and burst shape, required sustained
successful commits/second and admitted requests/second, measurement duration,
row/index sizes, transaction read/write sets, concurrency, subscription
count, retained history, durability class, and acceptable staleness. Diary workloads should supply realistic shapes; a synthetic
high-throughput counter is included only as a diagnosed worst case.

### Phase 1 — measure current ceilings

Run the same normalized profiles against:

- local SQLite;
- hosted Durable Object SQLite;
- the LLP 0046 Postgres conformance target once it exists.

Record:

- sustained commits/second and admitted requests/second;
- p50/p95/p99 admission, execution, commit, publication, and replay latency;
- reservation/fence wait, conflict/retry rate, and hot-key attribution;
- live-query wake amplification and subscriber delivery lag;
- snapshot duration, journal growth, and restore time;
- CPU, storage operations, bytes, and hosted cost per successful commit.

This absorbs LLP 0125's unanswered normalized-burst question. A result must
attribute the tail to reservation acquisition, execution, index work, version
allocation, commit durability, publication, or retry jitter instead of
reporting one opaque latency.

Before Phase 1 runs, the program pins numeric downselection thresholds —
required offered and admitted load, sustained successful commits/second,
burst shape, measurement duration, acceptable p99 admission latency,
conflict rate, feed lag, recovery time, reshard interruption, operational
minimum, and cost per committed mutation — so Phase 2's selection is
falsifiable rather than impressionistic. Measuring throughput is not enough
without a pinned throughput bar: "clears the envelope" is defined by these
numbers, not impressionistically.

### Phase 2 — downselect every family, then prototype the leaders

Use Phase 1 to select at most two full spikes — but through an explicit
downselection gate that names admitting or eliminating evidence for every
family, so no family is excluded silently:

- **A** is eliminated as the sole answer only if a Phase-0 envelope exceeds
  its measured ceiling; otherwise it remains the default.
- **B** is admitted if a single concurrent primary clears the envelope that
  SQLite/DO misses; eliminated if the envelope exceeds any single primary.
- **C** is admitted if the Phase-0 workload shows stable placement roots with
  a high single-root operation share; eliminated if cross-root transactions
  and subscriptions dominate.
- **D** is admitted if cross-partition atomicity or multi-region
  survivability is envelope-required and cell designs cannot meet it, or if
  its feasibility check shows that delegating rebalancing, failure
  containment, and operational ownership to a mature database beats owning
  cell machinery against the pinned thresholds; the lightweight feasibility
  check (changefeed-resume compatibility, local parity story, operational
  minimum, licensing and cost, failure isolation, automated rebalancing)
  suffices to rule it in or out before any full spike.
- **E** is admitted if measured needs demand custom logical clustering or
  model control no SQL substrate provides economically, or if the same
  feasibility comparison favors its substrate-provided distribution over
  both SQL lanes; the same lightweight feasibility check applies.
- **F** is admitted only if the author first narrows synchronous
  transactional semantics; otherwise it is eliminated on premise, and that
  elimination is recorded as such.
- **G** is admitted independently whenever Phase 1 shows read, search, or
  fanout pressure binding before transactional writes; it composes with any
  authority choice.

The default full-spike pair, absent contrary measurements, remains:

1. Postgres with a commit-log-derived Snapback resume stream; and
2. two or more transactional cells using an existing bounded profile's root as
   placement key and multiple opaque stream cursors.

Each full spike carries a correctness-and-failure acceptance matrix, not just
throughput numbers. The Postgres spike must demonstrate snapshot/feed
cutover, transaction grouping, duplicate-delivery handling, consumer crash
recovery, slot rollback and slot loss, primary failover, retention
exhaustion, schema transitions, and mutation-response publication latency.
The cell spike must demonstrate multi-cursor resume, cross-cell snapshot
consistency, routing changes, live reshard or capability-coded resnapshot,
app-wide auth invalidation, backup cuts, hot-root skew, and partial-cell
failure. Conformance and fault-injection results, attributed the same way as
Phase 1, are required before either family reaches the decision docket.

### Phase 3 — decision docket

The later RFC must decide:

- the target popular-app envelope and economic bar;
- the transaction and placement domain;
- stream/cursor topology and snapshot cut;
- global sequence, aggregate, auth-invalidation, and job semantics;
- changefeed delivery and duplicate handling;
- reshard/migration and rollback protocol;
- local conformance strategy;
- capability facts and refusal modes for unsupported cross-partition work.

“Unlimited,” “web scale,” and “horizontally scalable” are not acceptance
criteria. The decision pins dated numeric envelopes and named degradation
behavior.

## Relationship to LLP 0115 and LLP 0127

This Research runs in parallel and does not reorder LLP 0115. Its
checkpoints bind the named semantic decisions below — several of which live
inside 0115 items — not 0115's execution or sequencing.

Work that should proceed without waiting:

- external install/runtime qualification and structured contracts;
- helper composition and closed handler graphs;
- transactional scheduling within the declared current authority;
- live search and sealed-artifact work;
- bounded query/profile vocabulary;
- the first local-first client lane, provided it consumes opaque stream tokens.

Work that reaches a decision checkpoint here:

- the sequence-primitive and maintained-aggregate scope decision riding
  LLP 0115 CV-8 (the primitive itself proposed by LLP 0120 and LLP 0127
  Move 6);
- acceptance of the local-first successor Plan's stream/snapshot assumptions;
- a promise of transactional enqueue across future placement domains;
- ratification of Postgres as more than the first graduation target;
- any popular-app storage, write-rate, or geographic-scale claim.

This is a checkpoint, not an implementation freeze. Current-target
implementations may ship with explicit single-authority scope and capability
facts. What must not ship accidentally is a public contract that makes later
multi-stream or partitioned execution impossible.

## Findings and confidence

High confidence:

- SQLite has a one-writer-per-file concurrency boundary;
- current Snapback documents one app-stream authority and a single-coordinator
  hosted ceiling;
- Postgres logical decoding supplies a replayable committed-change stream;
- distributed SQL and transactional ordered key-value systems demonstrate that
  a relational model does not require one-file storage;
- LLP 0012's opaque cursor already leaves multi-stream evolution open.

Medium confidence:

- Postgres plus a commit-order feed is the most economical next measurement
  after the existing target;
- stable membership-addressed roots will make transactional cells viable for a
  meaningful class of popular apps;
- LLP 0127's bounded profiles can carry enough placement evidence without
  becoming a general query planner.

Low confidence:

- which resource binds first for a real popular Snapback app;
- the numeric improvement from Postgres or partitioned cells;
- whether cross-root atomic transactions are frequent enough to justify
  distributed SQL;
- whether operating a transactional KV layer could ever be cheaper than
  adopting a database;
- whether a log-first core fits Snapback's current synchronous product
  contract.

The low-confidence items are deliberately empirical. No current diary or
benchmark measures popular-app scale.

## Open questions

1. What numeric workload defines “popular app” for Snapback: commits,
   connected clients, live subscriptions, data size, geography, or a combined
   envelope?
2. Does the first normalized burst study show that Snapback's own reservation
   and version machinery binds before SQLite/DO storage?
3. Can a Postgres WAL/LSN-derived token satisfy LLP 0007's gap-free visibility,
   retention, failover, and resnapshot rules without a framework commit fence?
   (LLP 0007 already asserts the feed “also satisfies properties 1–4” — a
   standing, unproven assertion that is exactly what a Phase-2 spike would
   test.)
4. Which declared root—app, environment, organization, workspace, room,
   document, or a schema-authored key—is the smallest useful transaction and
   placement domain?
5. What percentage of measured operations touch exactly one such root? What
   percentage of transactions and subscriptions cross roots?
6. Are app-wide auth invalidation, uniqueness, jobs, counters, and aggregates
   truly synchronous requirements, or can some become scoped or projection
   semantics?
7. Does the local-first successor Plan need one composite cursor over several
   streams, a set of independent cursors, or snapshot manifests that bind a
   consistent multi-stream cut?
8. Can resharding preserve stream identity, or must it force a capability-coded
   resnapshot?
9. How much operational complexity and minimum cost can the hosted product
   absorb for the exceptional popular-app tier without burdening ordinary apps
   and local development?
10. Should the later decision choose one universal hosted substrate or a
    capability-tiered path: single cell by default, Postgres for larger
    authorities, and partitioned/distributed execution only for measured
    exceptions?

## Status

Active Research. It records the option space and evidence program but
makes no substrate decision. The next action is the Phase-0 workload envelope plus LLP
0125's normalized burst measurement, in parallel with LLP 0115 execution.
