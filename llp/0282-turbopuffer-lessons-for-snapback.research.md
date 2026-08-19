# LLP 0282: Turbopuffer lessons for Snapback

**Type:** Research
**Status:** Draft
**Systems:** Storage, Search, Vector search, Query planning, Deployment, Performance, Branching, Testing, Competitive analysis
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-19
**Revised:** 2026-08-19 (initial primary-source research draft)
**Related:** LLP 0000, LLP 0007, LLP 0073, LLP 0097, LLP 0128, LLP 0132, LLP 0158, LLP 0161, LLP 0185, LLP 0188, LLP 0269, https://turbopuffer.com/docs/architecture, https://turbopuffer.com/docs/guarantees, https://turbopuffer.com/docs/tradeoffs

## Summary

Turbopuffer is a proprietary search database whose canonical state lives in
object storage. Query nodes combine compute with disposable memory and NVMe
caches; separate indexing nodes compact a per-namespace object-store write-ahead
log into object-store-native indexes. A query can combine the indexed state with
the committed, not-yet-indexed tail, so index construction remains asynchronous
without normally hiding accepted writes. The design is optimized around object
storage's unusual ratio: high request latency, high streaming throughput, cheap
capacity, and managed durability.

Enough of the architecture is public to understand its important mechanisms and
tradeoffs. The company publishes an architecture document, behavioral
guarantees, limits, workload guidance, detailed index articles, and technical
talks. It does not publish the production engine. Exact file formats, commit and
compaction protocols, cache admission/eviction, branch reference reclamation,
and failure proofs therefore remain unknown.

The strongest lesson for Snapback is **not** to replace SQLite, Postgres, or
transactional cells with an object-store LSM. Turbopuffer explicitly optimizes
for search rather than OLTP: writes take hundreds of milliseconds, general
read/write transactions are absent, occasional cold reads are expected, and
the useful scale comes from batchable writes plus naturally isolated
namespaces. Those tradeoffs conflict with Snapback's ordinary interactive
mutation, transactional, live-query, authorization, and offline-settlement
contracts.

The transferable architecture is narrower and valuable:

1. keep each Snapback transactional cell authoritative;
2. publish committed changes into object-storage-native search/vector
   projections;
3. bind every projection generation to an exact source-stream watermark;
4. answer strong projection reads from the indexed generation plus its
   authoritative unindexed tail;
5. make memory/NVMe residency disposable and expose cold, warming, warm, and
   pinned states honestly;
6. align projection namespaces with Snapback's declared transactional cells;
7. use object-store compare-and-set for low-rate metadata and background-work
   coordination where its latency and contention envelope fit; and
8. if Snapback opens the approximate-vector door, add continuous production
   recall measurement beside the preregistered offline corpus.

This corroborates rather than reopens the accepted storage sequence in
[LLP 0269](./0269-storage-graduation.plan.md): SQLite until measured demand,
then Postgres, then declared transactional cells, with specialized read
services allowed alongside every phase. The first justified experiment is a
bounded object-store search-projection spike over the existing Snapback journal,
not a new authority store and not a Turbopuffer clone.

## Question and scope

This Research asks four questions:

1. How much of Turbopuffer's production architecture is publicly known?
2. Which public claims are architectural facts, which are product guarantees,
   and which remain vendor performance reports?
3. Which mechanisms transfer to Snapback without weakening its existing
   semantics?
4. What is the smallest experiment that could test those mechanisms against
   Snapback's real workloads?

It does not evaluate Turbopuffer as a vendor, recommend adopting its hosted
service, benchmark it independently, or decide a Snapback roadmap item. It does
not reopen LLP 0269's demand gate or LLP 0132's undecided approximate-vector
door. It treats Turbopuffer primarily as storage and query-engine prior art.

## Method and provenance

The external snapshot was checked on 2026-08-19 against first-party material:

- [Architecture](https://turbopuffer.com/docs/architecture) for the query,
  cache, WAL, indexing, sharding, and consistency overview;
- [Guarantees](https://turbopuffer.com/docs/guarantees) and
  [Tradeoffs](https://turbopuffer.com/docs/tradeoffs) for the behavioral
  boundary, transaction limitations, write/cold-read costs, and stated
  consistency qualifications;
- [Concepts](https://turbopuffer.com/docs/concepts) for the object-storage LSM,
  group commit, compaction, and query/indexing-node roles;
- [Limits](https://turbopuffer.com/docs/limits) and
  [Sharding](https://turbopuffer.com/docs/sharding) for current product
  ceilings and restrictions;
- [Namespace Branching](https://turbopuffer.com/docs/branching) for the
  copy-on-write contract;
- [How to build a distributed queue in a single JSON file on object storage](https://turbopuffer.com/blog/object-storage-queue)
  for the production indexing-queue design and its compare-and-set/group-commit
  derivation;
- [turbopuffer: fast search on object storage](https://turbopuffer.com/blog/turbopuffer)
  for the object-storage-first design argument and operational posture;
- [ANN v3](https://turbopuffer.com/blog/ann-v3),
  [Designing inverted indexes in a KV-store on object storage](https://turbopuffer.com/blog/fts-v2-postings),
  and [Continuous recall measurement](https://turbopuffer.com/blog/continuous-recall)
  for the vector, text-index, and production-quality practices;
- [the CMU technical talk transcript](https://turbopuffer.com/blog/video-andy-pavlo-cmu)
  for the company's clearest public explanation of its no-separate-consensus,
  no-east-west-coordination posture; and
- the [official GitHub organization](https://github.com/turbopuffer) and
  [OpenAPI repository](https://github.com/turbopuffer/turbopuffer-openapi) for
  the boundary of the published implementation surface.

Tags have narrow meanings:

- **[confirmed-public]** — present in first-party documentation or a first-party
  technical explanation as of the snapshot date. This confirms publication,
  not independent operational truth.
- **[vendor-measured]** — a first-party performance or scale result that this
  Research did not reproduce.
- **[observed-snapback]** — present in Snapback's current LLP corpus or source
  tree.
- **[inferred]** — this document's analysis or recommendation, not a ratified
  Snapback decision.
- **[unknown]** — a production mechanism for which the public record does not
  establish an implementation contract.

## Public architecture

### 1. Object storage is canonical, not a backup tier

Each namespace owns a prefix in object storage. The company describes its
storage engine as an object-storage-native LSM: accepted writes are durably
committed there; immutable runs and indexes are written there; memory and local
NVMe exist to hide latency rather than to hold the only current copy.
[confirmed-public]

This differs from a disk database with object-store backup or cold tiering. A
query node may die without a storage failover protocol: another query node can
serve the namespace by paying a cold-read penalty and repopulating its cache.
Sticky routing is an optimization for locality, not an authority assignment.
[confirmed-public]

The company says object storage is the only stateful dependency in the critical
path and that the production architecture avoids a separate consensus or
metadata service. Public talks describe metadata as object-store files updated
with compare-and-set. [confirmed-public] The exact namespace-head/manifest
representation and its complete crash protocol are not public. [unknown]

### 2. Write path: group-committed WAL plus a compare-and-set commit point

Writes arrive at query nodes and accumulate in an in-memory group-commit
buffer. Every committed batch creates another file in the namespace's WAL
prefix. The public architecture diagram distinguishes files that are written,
committed, and indexed, and shows a compare-and-set commit point. Success means
the accepted data is durable in object storage. [confirmed-public]

The current architecture page reports:

- one WAL entry per second per namespace;
- concurrent writes coalesced into the same entry;
- a new batch begun inside that interval may take up to one second to commit;
- about 10,000 or more vectors per second of namespace throughput; and
- p50 around 165 ms for a 500 kB write.

These are vendor-published snapshot figures, not portable architectural
constants. [vendor-measured] Their shape is more important than the values:
group commit decouples accepted-operation throughput from slow object-store PUT
latency, but cannot eliminate per-operation acknowledgement latency.

### 3. Indexing is asynchronous; recent committed data remains queryable

After a WAL commit, indexing nodes eventually build or update ANN, full-text,
and exact filtering structures. Queries examine the indexed generation and the
committed, unindexed WAL tail. Recent records can be searched exhaustively until
the index catches up. [confirmed-public]

This is an important separation:

- **durable acceptance** advances the WAL/commit point;
- **query completeness** combines a stable index with the newer tail; and
- **index maintenance** remains asynchronous compute.

The indexing queue is not the durability source for writes. Turbopuffer's
published queue article calls it a notification and scheduling mechanism;
at-least-once processing is sufficient because index work is reconstructible
from canonical object-store state. [confirmed-public]

### 4. Query path: sticky routing through a disposable cache hierarchy

The load balancer prefers the query node that already holds a namespace, while
any node remains eligible. Reads walk memory, NVMe, and finally ranged object
storage. The storage format and query planner are co-designed to minimize
sequential object-store roundtrips. [confirmed-public]

The current architecture page reports p50 around 874 ms for the first query on
one million documents and p50 around 14 ms once cached. The introduction reports
a p90 cold query around 1.2 seconds on that fixture. These figures are
vendor-measured and fixture-dependent. [vendor-measured]

The durable lesson is that **cold latency is a public operating state**, not an
outlier silently hidden behind a warm benchmark. Turbopuffer exposes warming and
pinning so applications can exchange money or advance knowledge for latency.
[confirmed-public]

### 5. Index structures are shaped around roundtrips and rewrite amplification

The published vector architecture uses a centroid-based ANN family related to
SPFresh. A cold query first fetches compact routing information, locates nearby
centroids, then retrieves cluster ranges in large reads. The company contrasts
this with graph structures whose random traversal and update shape fit object
storage poorly. [confirmed-public]

The full-text engine maps postings into an LSM keyspace. Its second-generation
format moved from posting partitions aligned with existing vector clusters to
independently split and merged fixed-size posting blocks, reducing rewrite
amplification and improving compression. The company reports up to 10x smaller
indexes and up to 20x faster selected queries; this Research did not reproduce
those results. [confirmed-public; vendor-measured]

The transferable rule is not a particular ANN or postings algorithm. It is that
the planner and physical format must share a roundtrip budget. A format copied
from local disk while the planner remains unaware of object-store latency is not
object-storage-native merely because its files reside in S3. [inferred]

### 6. Query compute and indexing compute scale separately

Query nodes handle API queries, writes to the canonical WAL, and write-through
cache updates. Indexing nodes perform expensive maintenance and compaction. Both
roles can autoscale independently, and the object-store state lets any indexing
node take eligible work. Turbopuffer calls this compute-compute separation.
[confirmed-public]

This prevents index construction from consuming the latency budget of the
interactive query fleet. It does not make the control plane free: queue
contention, duplicate jobs, compaction conflicts, generation publication, and
resource admission still require protocols. Only the queue's public design is
known in useful detail. [confirmed-public; unknown]

### 7. Namespace is the main isolation and locality unit

The product recommends a namespace per naturally isolated document space.
Caching, WAL order, schema, indexing, branching, and most limits are expressed
at namespace scope. A large namespace may be divided across internal indexes;
the current sharding profile assigns documents by `hash(id) % num_shards`, fans
writes and queries out, and merges results. The shards share one namespace WAL.
[confirmed-public]

Current restrictions are load-bearing context: shard count is fixed at
creation, in-place resharding is not available, some aggregate/query shapes are
unsupported, and namespace branching does not yet compose with sharding.
[confirmed-public]

### 8. Branching reuses immutable ancestry

`branch_from` creates a constant-time copy-on-write namespace whose reads and
writes are independent after creation. Branches may themselves be branched;
deleting either logical namespace does not invalidate the other. The docs show
the child namespace referring to source data while adding its own objects.
[confirmed-public]

The public behavior establishes immutable ancestry and independent logical
heads. It does not establish the complete reference-counting, garbage
collection, encryption-key, corruption, or crash-cut protocol behind those
claims. [unknown]

### 9. Low-rate coordination also stays on object storage

The current indexing job queue is a single logical JSON object coordinated by a
stateless broker. Producers and workers use compare-and-set; the broker reduces
the number of contending writers and group-commits many logical requests. Jobs
are at least once, stale claims are recoverable, and any broker can reconstruct
state from the object. The company reports lower tail latency than its former
node-sharded queue. [confirmed-public; vendor-measured]

The useful boundary is explicit: this works because the queue's total state is
small, requests are batchable, object replacement latency is acceptable, and a
single broker can serialize physical updates without owning durable state.
Object-store CAS is not evidence that every high-contention transaction or
general distributed lock belongs in one object. [inferred]

## Consistency and transaction boundary

Turbopuffer describes queries as strongly consistent by default: a later query
checks object storage for newer writes and searches the unindexed tail. That
check imposes a documented warm-read floor around 10 ms; an eventually
consistent option removes the check and may be stale for substantially longer.
[confirmed-public]

The guarantee is narrower than a general-purpose serializable database:

- general read/write transactions are not supported;
- conditional writes atomically evaluate their condition with the write;
- patch/delete by filter use a two-phase, rechecking behavior characterized as
  read committed;
- the guarantee page records rare roughly 100 ms staleness during scaling or
  failover; and
- after more than 128 MiB of outstanding writes, further writes can remain
  invisible until indexing and cache loading complete, which may take tens of
  seconds to tens of minutes depending on namespace size.

[confirmed-public]

The architecture page's short phrase "strong consistency by default" must be
read with those qualifications. For Snapback, this is a documentation lesson:
name the exact source watermark, tail bound, failover behavior, and degradation
mode instead of importing an overloaded consistency adjective. [inferred]

## What is known and what remains proprietary

### Known well enough to reason about

- object storage is canonical and local disks are caches;
- namespace-scoped WAL objects and compare-and-set publication;
- group commit and its latency/throughput trade;
- indexed-generation plus unindexed-tail query composition;
- separate query and indexing fleets;
- memory/NVMe/object-store cache hierarchy and sticky routing;
- object-storage-aware ANN, full-text, and exact filter indexes;
- namespace sharding and current public restrictions;
- the external copy-on-write branching contract;
- the indexing queue's compare-and-set/group-commit design; and
- the product's current limits, guarantees, and workload posture.

### Not known well enough to reproduce or prove

- canonical WAL, segment, index, and metadata file formats;
- the exact namespace commit-point CAS object and lost-response reconciliation;
- concurrent compaction conflict resolution and generation publication;
- cache keys, admission, eviction, replication, and stale-entry fencing;
- complete routing and failover protocol during fleet changes;
- indexer leases, duplicate-work suppression, poison-job disposition, and
  compaction resource governance beyond the public queue overview;
- branching ancestry representation, reclamation, long-chain flattening, and
  deletion crash cuts;
- encryption metadata and key-rotation interaction with shared branch objects;
- backup/restore internals and cross-region consistency cuts; and
- the test, simulation, fault-injection, and formal evidence behind production
  safety claims.

The official organization publishes generated clients, an OpenAPI description,
and benchmarking tools. Its own tradeoffs page says there is no open-source
version. Treat third-party educational clones as interpretations of the public
architecture, not evidence of production internals. [confirmed-public]

## Findings for Snapback

### F1. Separate durability from residency

Snapback's scale-to-zero direction benefits from the same conceptual split:
durable state need not remain attached to an active machine merely to make that
machine disposable. Turbopuffer demonstrates that an interactive query service
can restore useful warm performance from object storage when the file format,
planner, cache, and product contract are designed together. [inferred]

This does not imply that every Snapback state class belongs in object storage.
It says a specialized projection can scale to zero independently of the
transactional cell that authored it. The cell remains responsible for
transactions, authorization facts, settlement, live invalidation, and the
source journal. [inferred]

### F2. Indexed generation plus authoritative tail is the key reusable mechanism

LLP 0128 family G already recommends transactional cells plus specialized read
services. Turbopuffer supplies a concrete query shape for that family:

```text
source cell stream through W
        -> immutable projection generation G(W)

strong projection query at head H
        = query G(W)
        + evaluate committed source changes (W, H]
        + merge under one declared semantic rule
```

The generation identity must bind source stream, source watermark, schema,
authorization profile, index format, and build plan. If the source journal no
longer retains `(W, H]`, the query must refuse, use an independently proved
snapshot/catch-up path, or serve a declared stale class. It may not silently
claim read-your-writes. [inferred]

This is compatible with LLP 0128's opaque-cursor and explicit-freshness
guardrails. It is also compatible with LLP 0132's generation/frontier
discipline; it does not itself choose exact or approximate vector retrieval.
[observed-snapback]

### F3. Projection namespaces should inherit Snapback's declared cell topology

LLP 0269 defines a transactional cell as one transaction, stream identity,
gap-free local commit order, journal, replay floor, and live-invalidation
domain. It requires schema-declared locality roots rather than inferred
placement. A natural object-store projection prefix is therefore scoped by the
same app, cell, and projection identity. [observed-snapback; inferred]

Benefits include independent warming, bounded tail replay, failure isolation,
branching, deletion, migration, and cost attribution. It also avoids an
unrelated search partition key becoming accidental application authority.
[inferred]

One hot cell can still require multiple internal search shards, just as one
Turbopuffer namespace can. Those shards must remain a physical projection
detail under one source stream unless a future Snapback contract explicitly
widens the transaction and cursor topology. [inferred]

### F4. Cold, warming, warm, and pinned are capability states

Turbopuffer makes cache warming and pinning public because the application's
knowledge of imminent use can improve latency more cheaply than permanent
residency. Snapback should preserve this honesty if it builds a similar read
service. [inferred]

At minimum, inspection and measurement should distinguish:

- `cold-available`: object-store state exists and no local residency is known;
- `warming`: a bounded warm request is active;
- `warm-best-effort`: recent local residency, evictable without notice;
- `pinned`: a declared replica/residency commitment with quota and cost; and
- `degraded`: serving from object storage or a stale generation because a warm
  replica is unavailable.

Names are illustrative, not proposed API. User-facing claims should report cold
and warm distributions separately, not summarize them into one percentile that
depends on an unstated hit ratio. [inferred]

### F5. The physical format must be designed in roundtrips

For an object-store projection, CPU and bytes are not sufficient query-cost
terms. The plan must also bound dependent roundtrips. Small random reads that
look efficient in a local benchmark can be catastrophic when each fetch costs a
network RTT. Conversely, downloading a larger contiguous block can be cheaper
than another dependent request. [inferred]

Snapback's bounded query and query-cost vocabulary should therefore add, for
any future object-store projection target, at least:

- metadata and manifest reads;
- dependent and parallel ranged reads;
- bytes requested versus bytes consumed;
- cache hit tier;
- tail bytes/entries scanned;
- shard fanout and merge work; and
- generation-discovery/freshness checks.

This is target-specific physical evidence under portable semantics, consistent
with LLP 0128's rule that adapters own execution rather than semantics.
[inferred]

### F6. Object-store branching strengthens the large-fork option

Snapback already values cheap forks for agent rehearsal and testing through LLP
0097, LLP 0158, LLP 0161, and LLP 0185. Turbopuffer shows how immutable
object-store generations can make the data-copy portion constant-time even for
large search state. [observed-snapback; confirmed-public]

The data-copy win is only one part of a Snapback fork. It does not answer app
identity, authority, credential custody, assets, effects, operation identities,
resource limits, promotion, or garbage collection. A future projection branch
should inherit the existing Snapback fork's source cut and custody disposition;
it must not become a second independently minted notion of application ancestry.
[inferred]

### F7. Object-store CAS can simplify reconstructible control state

The indexing queue suggests candidate Snapback uses: projection-generation
notifications, rebuild work, backup manifests, low-rate release metadata, and
possibly branch-reclamation work. These are reconstructible or idempotent lanes
whose throughput can come from batching rather than many physical CAS writes.
[inferred]

It is a poor default for interactive mutation settlement, high-contention
leases, or anything whose required acknowledgement latency is materially below
an object-store request. Any adoption needs a frozen maximum state size,
physical write rate, contention envelope, broker failover rule, at-least-once
identity, and lost-response reconciliation. [inferred]

### F8. Continuous recall is the strongest ANN-specific lesson

Turbopuffer reports that it samples one percent of ANN queries and compares
approximate results against exact search to monitor recall continuously.
[confirmed-public] This complements rather than replaces offline benchmarks:
production queries reveal filter shapes, tenant distributions, drift, and index
states a static corpus may miss.

LLP 0132 deliberately keeps `vector_search_v1` exact and leaves the approximate
door undecided. If that door is ever accepted, its proposed recall-at-k evidence
should gain a production shadow-control option with:

- bounded sampling and exact-control cost;
- per-index-format and per-generation attribution;
- filter and authorization-shape classification;
- no release of unauthorized candidates to telemetry;
- confidence intervals and minimum sample counts;
- alert and automatic-degradation thresholds; and
- explicit distinction between recall of the physical ANN candidate set and
  correctness of authorization, ranking, tie-breaking, and release.

[inferred]

### F9. Consistency adjectives need executable qualifications

Turbopuffer's architecture page, guarantee page, and eventual-consistency
option collectively describe a useful product, but a reader who stops at
"strong consistency" misses documented failover and large-tail qualifications.
[confirmed-public]

Snapback's projection contract should instead publish an executable tuple:
source stream, indexed watermark, observed tail head, tail-completeness status,
freshness class, and any resnapshot/refusal reason. The response and capability
evidence should make it possible to tell whether a query included all committed
source writes required by its class. [inferred]

### F10. Turbopuffer's fit is sparse, search-heavy tenancy—not general OLTP

The design is especially strong when many isolated namespaces exist, only a
subset are active, writes batch well, query results are small relative to the
corpus, and occasional cold latency is tolerable or predictable enough to
prewarm. Codebases, tenant knowledge bases, retrieval corpora, and large search
projections fit that shape. [confirmed-public; inferred]

It is weak as a model for a chatty transactional authority with sub-50-ms write
expectations, general multi-row invariants, cross-entity transactions, coherent
reactive queries over arbitrary app state, and offline mutation settlement.
Turbopuffer's own tradeoff explanations say its write latency is unsuitable for
OLTP-style paths. [confirmed-public]

## Comparative mapping

| Turbopuffer mechanism | Snapback analogue | Influence | Do not infer |
|---|---|---|---|
| Namespace prefix | Declared transactional cell / projection identity | Reuse the cell root for projection locality | Namespace is not automatically a Snapback transaction domain |
| Object-store WAL | Cell journal plus projection publication stream | Test index-generation + retained-tail reads | Move ordinary mutation authority to S3 |
| Indexed state + unindexed tail | Generation watermark + retained source changes | Preserve strong projection reads during async build | Index lag is free or unbounded |
| Memory/NVMe cache | Scale-to-zero read replica | Expose warm/pinned/cold states and costs | Warm benchmark represents cold behavior |
| Query/indexer split | Interactive read fleet / projection builder | Isolate expensive maintenance | Background work needs no admission or settlement |
| Object-store-aware ANN/FTS | Future specialized search target | Co-design plan and format around RTTs | Adopt a physical algorithm without Snapback evidence |
| Namespace sharding | Physical projection shards under one cell stream | Fan out only after one-index limits bind | Shards create cross-cell transactions or global order |
| Copy-on-write branch | Instance/projection fork | Reuse immutable projection generations | Data ancestry solves identity, effects, custody, or promotion |
| CAS queue | Reconstructible background coordination | Spike for low-rate batched lanes | Replace general coordination or transaction protocols |
| Continuous recall | LLP 0132 approximate-door evidence | Add bounded online exact controls if ANN is accepted | Approximate ANN may silently replace exact `vector_search_v1` |

## Recommended experiment

### Object-store search-projection spike

If commissioned, build one disposable spike over MinIO or another qualified
S3-compatible store. Use an existing Snapback exact full-text or vector fixture;
do not introduce a new public capability and do not route ordinary application
writes through object storage.

The spike should:

1. capture one source cell at `(stream, W)`;
2. write a content-addressed immutable projection generation and canonical
   manifest to object storage;
3. publish the generation through one compare-and-set head;
4. serve queries through a three-tier memory/local-disk/object-store cache;
5. for a strong class, read the source journal from `W + 1` through captured
   head `H`, evaluate that tail exactly, and merge it with the generation;
6. for a declared stale class, omit the tail and return `W` visibly;
7. refuse safely when the source stream rotates, the journal floor passes `W`,
   the manifest or segment digest fails, or the tail exceeds its budget;
8. rebuild the same logical projection from scratch and prove semantic equality;
9. restart every process with empty caches and no local durable metadata; and
10. retain raw measurements rather than only a benchmark summary.

The preregistered measurement grid should vary:

- namespace/cell count and active fraction;
- corpus size and row/document width;
- warm, cold, prewarmed, and pinned state;
- source-tail entries and bytes;
- exact filter selectivity and authorization partition;
- object-store RTT and injected request errors;
- concurrent queries, builds, and generation publication;
- one index versus physical shard fanout; and
- branch depth and shared-generation reuse if the core path qualifies first.

Required outputs should include:

- p50/p95/p99 query latency split by residency state;
- dependent/parallel roundtrip count and returned bytes;
- cache fill, hit, eviction, and restart behavior;
- tail scan/merge work and maximum admitted lag;
- build and publish duration, retry count, and orphan bytes;
- exact result equality against the current local oracle;
- authorization noninterference and no pre-release candidate leakage;
- corruption, lost-response, concurrent-publisher, and journal-floor outcomes;
- object-store operation and byte cost; and
- cost across many idle namespaces versus a permanently resident control.

Success would justify a proposal for an optional object-store projection target.
It would not justify changing Snapback's authority store, claiming general
object-store-native storage, accepting ANN, or advancing LLP 0269's phase gates.

## Non-recommendations

This Research specifically recommends against treating the following as
Turbopuffer lessons:

1. **Do not replace the accepted authority graduation.** LLP 0269 remains the
   owner: SQLite, measured Postgres graduation, then declared cells if demand
   persists.
2. **Do not build a bespoke physical engine before evidence.** The public
   architecture omits the hardest production protocols, and Snapback has no
   measured need to own them.
3. **Do not call object-store placement object-storage-native.** The planner,
   manifest, file layout, cache, tail, compaction, and failure model all have to
   be designed for the substrate.
4. **Do not weaken exact vector search silently.** LLP 0132's exact capability
   remains exact; any approximate successor needs its own name and evidence.
5. **Do not duplicate cell placement.** Projection partitioning follows the
   schema-declared root or remains a physical implementation detail.
6. **Do not hide cold latency.** Qualification must measure empty-cache
   restarts and object-store reads directly.
7. **Do not equate search freshness with transactional isolation.** Projection
   completeness, source-cell transactions, and cross-cell atomicity are
   different contracts.
8. **Do not inherit proprietary dependence into the core.** Turbopuffer may be
   evaluated as an optional external service later; its closed engine cannot be
   the only implementation of a core MIT Snapback capability.

## Confidence

**High** on the documented architecture shape, product guarantees, current
limits, external branching behavior, and absence of an open-source product:
these are direct first-party statements checked on 2026-08-19.

**Medium** on the stability of quantitative limits and latency figures. They are
current vendor measurements, vary by cloud/region/fixture, and have changed as
the product evolved. This document uses them to identify tradeoff shape, not to
make a comparative performance claim.

**Medium-low** on details inferred from diagrams or talks but not specified as a
public protocol, including the exact namespace head, compaction conflict
handling, and branch ancestry reclamation. Those are explicitly classified as
unknown and must not become implementation premises.

**High** on the compatibility analysis against the current Snapback corpus:
LLP 0128 already names specialized read services, LLP 0269 explicitly permits
them alongside the accepted authority sequence, LLP 0132 keeps exact and
approximate vector claims separate, and the forking corpus treats data copying
as only one part of a safe fork.

## Open questions

1. Which existing exact profile is the best first spike: full-text search, vector
   search, or a simpler exact filter/order projection?
2. Can the existing source journal evaluate the complete `(W, H]` tail for that
   profile without rebuilding an engine-specific secondary structure in memory?
3. What tail byte/entry ceiling preserves cold-query usefulness before refusal
   or synchronous catch-up becomes preferable?
4. Should a future projection generation be scoped one per transactional cell,
   or can a bounded multi-cell global projection earn a separately declared
   freshness vector?
5. Which authorization profiles can be pushed into the object-store index
   without leaking candidate membership through timing, counters, cache keys, or
   shadow-control telemetry?
6. Does Snapback need explicit prewarming, pinning, or both, and which component
   owns their quotas and billing facts?
7. Would LTX/object-store replication from LLP 0188 supply any reusable segment
   or manifest protocol, or should database replication and search projection
   remain intentionally separate formats?
8. Can object-store CAS meet a useful Snapback background-queue envelope under
   S3, R2, GCS, and MinIO semantics without introducing provider-specific
   correctness?
9. If approximate ANN is ever accepted, what online exact-control sampling rate
   is affordable, and how is sensitive query material excluded or minimized?
10. What garbage-collection proof is required before shared immutable projection
    generations may participate in instance forks?

## Status

Draft Research. It records public prior art and a bounded experiment shape. It
makes no architecture decision, commissions no implementation, changes no
capability fact, and does not advance LLP 0269 or LLP 0132.
