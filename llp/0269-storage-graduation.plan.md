# LLP 0269: Storage graduation through Postgres and transactional cells

**Type:** Plan
**Status:** Accepted
**Systems:** Storage, Assets, Performance, Schema, Sync, Realtime, Deployment, Testing
**Author:** Codex gpt-5.6-sol xhigh, orchestrated by Claude Fable 5 (commissioned in the author's 2026-08-16 orchestration session under Charlie Cheever's 2026-08-15 performance-direction ruling)
**Date:** 2026-08-16
**Revised:** 2026-08-24 (review-ready design addition for trusted video
container/codec/duration admission; implementation and capability claims remain
open); 2026-08-18 (LLP 0276 crate-path relocation); 2026-08-16 (v0.3 — Status Draft → Accepted, author ruling 2026-08-16)
**Related:** LLP 0007, LLP 0012, LLP 0037, LLP 0044, LLP 0046, LLP 0080, LLP 0113, LLP 0128, LLP 0163, LLP 0189, LLP 0198, LLP 0209, LLP 0225, LLP 0265, LLP 0276, LLP 0277, `issues/20260815-storage-graduation-plan-commission.md`, `issues/20260817-upload-intent-codec-duration-admission-facts.md`

## 0. Charter and position

`issues/20260815-storage-graduation-plan-commission.md` records the author's
2026-08-15 performance-direction ruling and its conditional demand gate. The
author's separate request in the 2026-08-16 orchestration session commissioned
this Plan's authoring ahead of that trigger so the storage direction is not
re-litigated session by session. **Execution remains demand-gated.** Phase 1
begins only when either:

1. a hot application measurably outgrows one current authority; or
2. the LLP 0265 championship exposes the current authority ceiling on a
   correctness-qualified workload cell.

Until one trigger fires, SQLite plus one authority remains the preferred small
cell: low operational minimum, excellent local parity, coherent transactions,
and almost no idle cost. A Plan on disk is not an instruction to introduce a
distributed system before demand.

The strategic target is the conjunction fixed by the 2026-08-15 author ruling:

- cheapest at idle;
- Instant-like immediate and offline client experience;
- Convex-like coherent reactive queries; and
- an explicit graduation path to Postgres and then transactional cells.

Snapback is not trying to beat a raw Postgres application at raw Postgres.
Snapback earns the extra layer by preserving typed authoring, bounded access,
offline settlement, reactive coherence, and portable diagnostics while the
authority substrate changes. LLP 0198 §II.4 makes the analogous product rule:
the semantic advantages are the product and should not be traded away merely
to make the first minutes or one benchmark look cheaper.

This Plan sequences LLP 0128's recommendation. It chooses the economical path
through its architecture families: first a larger concurrent single-authority
cell (family A), then declared transactional cells (family C), then explicit
cross-cell operations. The Postgres commit-log-derived feed spike tests family
B; the initial framework-journal target does not claim family B merely because
it uses Postgres. Specialized read services (family G) may accompany any phase,
but they do not advance the write-authority sequence. Distributed SQL, a
transactional key-value layer, and a log-first core remain later downselection
candidates under LLP 0128 §Evidence program; this Plan does not silently choose
them.

### 0.1 The implementation seam that exists today

There is no backend-neutral authority-store trait in the current Rust code.
`crates/snapback/src/storage.rs` defines a concrete `LocalDatabase` over
`rusqlite::Connection`; `MutationWritesKernel`, `QueryReadsKernel`, and
`VersionsKernel` in `crates/snapback/src/storage/{mutation_writes,query_reads,versions}.rs` are
narrow typed views that still delegate to that database. This is the
post-LLP-0225 module boundary, not yet a cross-engine adapter boundary. LLP
0046 §Prerequisite accurately predicted that the store interface still had to
be extracted.

The ordinary commit implementation in `crates/snapback/src/storage.rs` opens an immediate
SQLite transaction, reads and advances the head, validates read dependencies,
writes rows and `_snapback_changes`, and commits through the authorization
interlock. On identity-bearing covered ordinary lanes it additionally records
settlement/envelope state in that transaction; the identityless ordinary seam
passes `identity: None`, and both commit implementations guard that record with
`if let Some(identity)`. `crates/snapback/src/storage/versions.rs` exposes the head, journal,
replay floor, and resnapshot decision;
`crates/snapback/src/storage/auth_invalidation.rs::data_version_stream` owns the durable stream
identity rotated by reset/import/restore.

LLP 0163 §Contract summary additionally requires covered data changes, journal
rows, commit envelope, suppression record, and initial receipt state to share
one transaction. LLP 0225 §3 assigns the transaction primitive to the
storage/migration kernel and keeps sync/realtime responsible for ordering and
fanout rather than direct commits. A Postgres implementation must preserve
those ownership and observable contracts; copying the present SQLite SQL into
a second god object is not graduation.

### 0.2 Terms and invariants

- An **authority store** is one physical implementation of the typed storage kernel contract.
- A **transactional cell** (shortened to **cell** in this Plan) is one transaction, stream identity, gap-free local commit order, journal, replay floor, and live-invalidation domain. It is distinct from LLP 0189 D-8's coverage-axis “cell.”
- A **locality root** is the schema-declared record whose id selects a cell; workspace, project, and room are examples, not runtime guesses.
- A **cross-cell operation** is an explicitly different execution class, never an accidental widening of an ordinary operation.

Across all phases:

1. transactions and version streams remain cell-local;
2. `(stream identity, version)` stays opaque and cross-stream versions are never compared (LLP 0128 §6; LLP 0046 §Migration and graduation);
3. schema and bounded-operation manifests declare placement; runtime code does not infer it from arbitrary handlers (LLP 0128 §Contract guardrail 4);
4. claims name only evidenced transactional cells and execution classes. This Plan extends LLP 0189 D-8's refuse-by-name and cell-explicit evidence discipline to transactional-cell id/count/root shape; D-8 itself currently defines coverage-axis cells over auth mode, live-query family, scope construction, client arm, and transport, not storage partitions; and
5. LLP 0209 §§2–3's live-graph bounds, authorization classification, plan identity, and per-node dependency capture remain target obligations.

## 1. Phase 1 — Postgres as an alternative authority store

**Objective.** Add Postgres as a supported, concurrent-writer, larger-storage
authority behind the same app-facing schema, generated functions and clients,
commit result, version-stream, snapshot, replay, and diagnostic contract. It
remains one authority and one stream for the app; it is not horizontal write
scaling (LLP 0128 §Findings 4; LLP 0046 §Non-goals).

**Entry dependency.** One §0 demand trigger has fired, and its workload has a
frozen correctness oracle plus an author-ratified graduation envelope. The
trigger must identify the binding resource — pre-execution queue wait under
concurrent writers, data size, journal retention, restore time, or another
named term — rather than treating “Postgres” as the remedy for an unattributed
latency number.

### 1.1 Extract the authority-store port without changing SQLite

1. Freeze the port from the typed `crates/snapback/src/storage/` kernels: snapshot reads; mutation prepare/commit; read-set validation; schema/migrations; seed/reset/import; stream/head; cursor replay and resnapshot; settlement; and typed system commits sharing app atomicity.
2. Make it async and transaction/lease-aware per LLP 0007 §Export and Engine Graduation and LLP 0046 §Prerequisite. Transaction handles do not escape to domain services; backend-native types do not enter the contract leaf.
3. Move `LocalDatabase` behind the port in owner-sized slices, preserving LLP 0225's kernel → domain service → adapter direction.
4. Parameterize the SQLite behavior corpus before adding Postgres. SQLite-only tests must name a physical property such as WAL or authorizer behavior.
5. Remove the process-wide writer gate from the concurrent Postgres mutation
   path, or narrow it so it cannot serialize work that Postgres is meant to run
   concurrently. Today `crates/snapback/src/server.rs` defines `SharedSnapback =
   Arc<Mutex<LocalSnapback>>`; `crates/snapback/src/server/writer_gate.rs::with_snapback` moves
   that owned global guard into each write-lane blocking task and says paths
   that can reach Hermes or rusqlite use it or the read lane; and
   `crates/snapback-tools/src/bench.rs::Benchmarks::single_writer_mutations_per_sec` records that
   every mutation serializes on it. Refactor the instance into concurrency-safe
   services and resource-specific guards. SQLite may retain its physical
   single-writer serialization, and runtime resources may keep their proven
   scoped ownership, but Postgres handler/plan execution and independent
   storage preparation must overlap; only the per-cell commit fence may
   serialize the commit tail.

This step creates a new trait/port at the existing typed kernel module
boundary. It does **not** claim that `MutationWritesKernel` or
`VersionsKernel` is already implementable by Postgres: today each holds a
`LocalDatabase` reference. Their kernel method signatures use domain types,
not rusqlite types. A concrete kernel-surface backend-native leak is instead
`DbRead::Pinned { conn: &rusqlite::Connection, ... }` in `crates/snapback/src/storage.rs`,
which `QueryReadsKernel::with_pinned_read_view` exposes to read callbacks.

### 1.2 Implement the first Postgres authority

1. Translate the same normalized schema and closed plans. Unsupported fields, indexes, plans, migrations, or capabilities refuse at load time; no fallback changes ordering, null, timestamp, id, or pagination semantics (LLP 0007 §§Data Model, Query Semantics, Validation Requirements).
2. Use LLP 0007 DK-2's short commit fence: run independent work concurrently, then acquire a per-cell lock/version row only to revalidate, allocate the next gap-free version, persist writes/journal, and commit. The exact mechanism is author-gated; bare sequences and fillable gaps do not qualify.
3. Give every Postgres authority a distinct stream. SQLite export/import may carry app-visible row versions, but creates a new stream and forces `resync_required` plus a fresh authorized snapshot (LLP 0046 §Migration and graduation).
4. Keep the framework-maintained journal as the support baseline. In parallel,
   run LLP 0128's Postgres commit-log-derived feed spike against snapshot/feed
   cutover, transaction grouping, duplicate delivery, no-op mutations, schema
   transitions, slot rollback/loss, retention exhaustion, primary failover,
   synchronous receipts, and resnapshot. Adopt WAL/LSN-derived tokens only if
   they satisfy the same contract and materially remove the fence/journal
   bottleneck. An inconclusive spike does not block the fenced target.
5. Implement atomic-or-rejected import with an enumerated bundle contract; verify schema, rows, indexes, system-state dispositions, and stream rotation before routing traffic.

### 1.3 Qualify support and measure the graduation claim

Measurement instrumentation is Phase-1 work, not an assumed prerequisite:

1. Extend the committed Zerobugs scripts `run-oq4-arm.sh`,
   `diag-hot-stream.mts`, `analyze-oq4.mts`, and `run-p1-ab.sh` under
   `demos/zerobugs/control/scripts/`, described by LLP 0265 §1.1, into a
   target-neutral SQLite/Postgres graduation runner. For each claimed complete
   configuration
   it must freeze a dataset/loader manifest, open-loop offered-load grid,
   authorization shape, observer population, health ceilings, durability
   posture, correctness oracle, and resource/cost calculus; orchestrate N≥3
   independent fixture-restored repetitions; and emit schema-valid immutable
   run records with p50/p95/p99 and outcome/health data. This explicitly builds
   the graduation-relevant subset missing in LLP 0265 §1.2 and follows its §9
   growth path; it is not a championship until LLP 0265's MVS and comparator
   requirements also hold.
2. Add two Phase-1-specific same-process diagnostic intervals, both retained as
   raw events in each run record. **Authority-start wait** is
   `Tauthority-start - Tauthority-ready`: `Tauthority-ready` is stamped after
   transport decoding, authentication, function/input validation, and capacity
   checks succeed, immediately before waiting on any process-wide gate required
   to begin authoritative handler/plan or storage execution;
   `Tauthority-start` is stamped at the first such instruction after that gate,
   or immediately after `Tauthority-ready` in the same task when no such gate
   exists. **Commit-fence wait** is `Tfence-acquired - Tfence-request`:
   `Tfence-request` is stamped immediately before requesting the per-cell fence
   after independently executable handler/plan and storage preparation;
   `Tfence-acquired` is stamped immediately after acquisition and before
   revalidation or version allocation. These intervals are new vocabulary
   defined by this Plan and new instrument work. They are diagnostic
   decompositions, not LLP 0265 latency families, and may never substitute for
   commit acknowledgement or settlement.

The semantic A/B uses identical normalized artifacts and fixtures on SQLite
and Postgres. At minimum, the shared corpus covers the LLP 0007/0046 rows:
multi-row one-version commits, conflicting concurrent mutations, exact read-set
validation, ids and portable values, null ordering and keyset pagination,
schema evolution, atomic import/refusal, snapshot-bound query results,
journal replay and floor expiry, stream rotation, live resnapshot, and stable
unsupported-feature diagnostics. Covered operation lanes also run the LLP 0163
atomic envelope/settlement corpus on Postgres; support does not narrow those
guarantees to obtain concurrency.

The performance A/B uses the same frozen configuration on both targets. It
reports every applicable one of LLP 0265 §§2.1–2.2's four latency families:
optimistic paint, commit acknowledgement, settlement, and observer
convergence. Load/health and cost follow LLP 0265 §§4 and 7, and the two new
diagnostic intervals above attribute pre-execution and commit-tail
serialization. The gate is not “Postgres wins every cell.” It is that Postgres
clears the frozen graduation envelope which SQLite missed, while preserving
correctness and naming any complete configurations in which SQLite remains
cheaper or faster.

**Phase 1 exit criteria.** Postgres becomes a supported target only when all
of the following hold:

- SQLite passes its affected suite unchanged behind the port;
- the shared conformance/failure corpus passes on SQLite and Postgres, including restart/failover ambiguity and atomic import;
- one generated app runs unchanged on both targets through every claimed public client arm;
- a concurrency proof holds one Postgres mutation before its commit fence and
  demonstrates that another mutation progresses through handler/plan execution
  and independent storage preparation before the first releases; traces show
  any serialization at the per-cell commit fence rather than the process-wide
  `SharedSnapback` mutex, while both outcomes preserve read-set, version, and
  journal invariants; this test must fail against the current process-wide
  mutation serialization;
- the graduation runner emits complete records and the A/B has N≥3 correct
  repetitions per complete configuration; comparative wording separately
  meets LLP 0265 §8.3's N≥8 and ordering-statistic rules;
- a dated WAL-feed disposition records adopt, defer, or reject with evidence;
- the capability manifest names a distinct Postgres profile and leaves every unproved feature/cell absent or refused; and
- LLP 0189 D-6 scoped evidence and eligible-battery gates pass. Adapter presence
  is not runtime support: this Plan applies the support-honesty precedent in
  LLP 0113 §Summary and §Status, where static maturity or an accepted design
  does not make support true ahead of the exact verified claim family, while
  the Postgres profile's own support gate remains the manifest and scoped
  evidence above.

Phase 2 depends on this exit's backend-neutral port and stream/cursor proof. It
does not depend on Postgres outperforming SQLite at idle, and a cell may later
use either qualified authority substrate.

## 2. Phase 2 — Declared locality roots and cell partitioning

**Objective.** Divide one hot app into independently writable transactional
cells by a placement key the schema declares. Each ordinary operation proves
that it touches exactly one root and routes to exactly one cell. Partitioning
raises independent-root throughput; it does not make one hot root scalable or
make global transactions free (LLP 0128 §Candidate architecture family C).

**Entry dependencies.** Phase 1's authority port and opaque stream behavior are
qualified. A separate demand record shows that every qualified Phase-1
single-authority profile acceptable for the app — including Postgres when it is
qualified — still misses a frozen workload, availability, or economic envelope
on a pressure that independent roots can address. If a qualified single
authority clears the envelope, Phase 2 does not enter. The workload evidence
also shows a stable candidate root and a high fraction of single-root
transactions and subscriptions. The author has ruled Open Question 1 before
the schema surface freezes.

### 2.1 Reconcile the governing one-stream contract

Before Phase-2 implementation or surface freeze, amend LLP 0007
§Commit-version graduation's current rule that the version stream is per
logical app. The dated, author-ratified amendment must explicitly admit the
partitioned topology, define one stream per transactional cell and the
app-to-cell/stream relationship, preserve opaque within-stream comparison,
define the client cursor-set and resnapshot contract, and assign migration,
retention, backup/restore, and app-global facts. This is the revisit LLP 0007
already requires before intra-app sharding may ship; this Plan does not itself
silently supersede that governing portability contract.

### 2.2 Add the placement declaration and proof

The current `SchemaManifest` in `crates/snapback/src/manifest.rs` has no locality/placement
field. Phase 2 adds a new **closed app-level schema descriptor** that names:

- the locality-root table and its id as the placement key;
- for every cell-owned table, a non-null direct key or bounded declared
  relationship path to that root;
- tables that are explicitly app-global/control-plane rather than cell-owned;
- indexes required to resolve and validate each placement path; and
- the declaration version and migration compatibility identity.

The exact codegen helper spelling is a Phase-2 design artifact, not an existing
surface asserted by this Plan. The generated `SchemaManifest` descriptor is
the authority. Handlers, request routers, naming conventions, and sampled data
may not invent or override placement.

Codegen compiles every admitted function/plan into a placement class:
single-root with a host-recomputed root binding; explicitly app-global; or
cross-cell and therefore refused until Phase 3. Bounded plan arguments,
relationship paths, and dependency nodes supply proof. An opaque handler whose
complete touched root cannot be proved is unsupported on a partitioned target;
an author annotation without runtime validation is not proof. LLP 0209 §2's
graph identity and every captured dependency become cell/root-qualified while
retaining the graph's existing bounds and authorization classification.

### 2.3 Make the cell the complete authority domain

1. Introduce a routing/control map from `(app, locality-root id)` to
   `(cell id, placement epoch)`. The map routes; it is not an app-data commit
   coordinator and does not manufacture a global version.
2. A cell owns all root-addressed rows, indexes, one transaction primitive,
   one version-stream identity, its gap-free commit versions, journal and
   retention floor, operation settlement, and live-query invalidation.
3. Ordinary mutations reject a plan whose validated read/write set crosses a
   cell. Ordinary live subscriptions bind one cell stream. A client observing
   several roots retains independent opaque cursors; neither client nor server
   compares their versions or implies a total order.
4. Root-scoped sequences, uniqueness, aggregates, jobs, and authorization
   effects commit in that root's cell. App-global forms remain unsupported or
   explicitly control-plane/projection facts until Phase 3 defines them.
5. Routing caches bind the placement epoch. A stale epoch refuses and
   refreshes; it never writes to both predecessor and successor cells hoping
   that reconciliation will repair authority.

### 2.4 Graduate an existing one-cell app

The first migration is deliberately quiesced and reversible before cutover:

1. install and validate the placement descriptor while the app still routes
   to one cell; scan every retained row, index, relation, and system fact for
   exactly one placement or an explicitly declared global disposition;
2. freeze writes at a durable source cut and record the source stream, head,
   schema/generation identities, routing predecessor, and root inventory;
3. produce content-addressed per-root bundles and import each destination cell
   atomically, creating a fresh stream identity per destination;
4. verify row/index counts and digests, authorization facts, operation-state
   disposition, journal/resnapshot posture, and backup/restore readiness for
   every destination; then CAS the routing map from the recorded predecessor
   to the new placement epoch;
5. require connected clients to resnapshot into the new stream set; and
6. retain the source cut for bounded rollback until the route CAS and public
   observations succeed. After any destination accepts a new write, returning
   to the predecessor is a new controlled migration, not an automatic merge.

The same protocol moves one locality root between cells. The first version may
pause that root. Online capture/catch-up and near-zero-downtime movement are a
later optimization with their own duplicate, cutover, and rollback proof.

**Phase 2 exit criteria.** Cell partitioning becomes supported only when:

- LLP 0007 carries the author-ratified §2.1 amendment and every implemented
  stream/cursor/migration behavior conforms to it;
- the closed schema descriptor accepts every placed table and rejects missing,
  ambiguous, nullable, cyclic, unindexed, or cross-root paths;
- a corpus proves single-root query/mutation/live behavior is byte/semantic
  equivalent to the one-cell oracle on every claimed authority substrate;
- two or more cells demonstrate independent concurrent progress, stream-local
  replay, restart, partial-cell outage containment, hot-root skew diagnostics,
  route-cache staleness, and no global-version assumption;
- the one-cell-to-many migration passes every crash cut before/after bundle
  creation, import, route CAS, resnapshot, and rollback, with no lost,
  duplicated, or double-authoritative row;
- app-wide authorization invalidation, backups, and restore cuts have an
  explicit proved disposition rather than an accidental single-cell carryover;
- a championship A/B shows that partitioning clears the triggering
  independent-root envelope and records the hot-single-root non-win; and
- capability and publication evidence names the transactional-cell ids/count,
  root shape, and execution class added by this Plan as well as every exercised
  coverage-axis cell already governed by LLP 0189 D-8. This is an explicit
  extension of D-8's evidence discipline, not a claim that D-8 already defines
  storage partitions. Ordinary cross-cell attempts refuse by stable name until
  Phase 3 exits.

## 3. Phase 3 — Explicit cross-cell semantics

**Objective.** Add only the cross-cell operations real applications need,
with their consistency, freshness, budgets, receipts, and failure modes visible
in schema/function manifests and generated clients. Cross-cell work never
masquerades as an ordinary cell-local transaction.

**Entry dependencies.** Phase 2 routing, placement epochs, per-cell cursors,
migration, and outage corpus are supported. Measured workloads identify a
specific cross-root need; Phase 3 does not pre-build a generic distributed
query and transaction system.

### 3.1 Initial operation classes

1. **Bounded fanout read.** A manifest names a finite root set or a bounded
   root-selector, fanout ceiling, per-cell query plan, deterministic merge, and
   response-byte/time budgets. Each cell evaluates one local snapshot and the
   result carries the vector of cell stream positions. V1 fails the whole read
   if a required cell is unavailable. It promises no globally atomic snapshot,
   no cross-cell read-your-writes barrier, and no total order between cells.
2. **Multi-cell live view.** An explicit fan-in subscription retains one opaque
   cursor per cell and publishes a vector watermark plus deterministic merged
   replacement/delta state. It promises cell-local ordering and eventual
   convergence after every participating stream is observed. It does not
   promise that two cells' commits become visible atomically or in one global
   order. Membership/routing changes force a manifest-qualified resnapshot.
3. **Durable workflow.** A coordinator records a finite ordered/parallel graph
   of idempotent cell-local mutations. Each step has its own operation identity,
   transaction, stream version, retry policy, and receipt. The workflow
   promises durable progress, exact replay of known step outcomes, bounded
   retries, and a terminal aggregate receipt. It does **not** promise
   all-or-nothing atomicity, global serializability, or automatic rollback.
   Compensation is an explicit authored step with ordinary failure semantics.
4. **Global derived projection.** Search, analytics, fanout, and declared
   aggregates may consume committed cell events into a non-authoritative
   projection. The manifest declares eventual or bounded-stale freshness,
   authorization filtering, rebuild behavior, and source watermarks. The
   projection cannot satisfy an authoritative uniqueness check or silently
   stand in for a cell-local transactional read.

Distributed transactions are not in the initial set. If evidence requires
them, they return to an author decision with a database/substrate comparison;
they are not grown incrementally out of the workflow API.

### 3.2 Mark the semantics in the authoring surface

Phase 3 adds distinct closed execution classes to the function manifest for
fanout read/live, durable workflow, and global projection. Exact helper names
are designed and generated in this phase; ordinary `query`/`mutation` spellings
remain single-cell. Each declaration includes:

- root-selection proof and maximum cells;
- transaction domain and whether any returned data is authoritative;
- snapshot/freshness model and cursor-vector shape;
- ordering/merge rule;
- time, row, byte, retry, and compensation budgets;
- partial-failure policy and terminal receipt contract; and
- required target capabilities.

Codegen and activation reject a cross-root ordinary function and reject a
cross-cell class whose target lacks a qualified implementation. Generated
clients expose the vector/freshness/workflow receipt; they do not flatten it
into a single commit version or a conventional mutation result.

**Phase 3 exit criteria.** A cross-cell class is supported independently only
when:

- its closed manifest/schema and generated client contract exist, and all
  missing capability combinations refuse by stable diagnostic;
- every class covers its applicable stale-placement, permanent-cell-outage,
  authorization-change, budget-exhaustion, and partial-failure behavior, plus
  its own mechanics: bounded fanout reads cover cell response reordering,
  unavailable/timeout cuts, deterministic merge, and absence of a global
  snapshot; multi-cell live views cover duplicate and out-of-order delivery,
  cursor expiry, membership/routing change, resnapshot, and convergence;
  durable workflows cover coordinator restart, every step crash cut, exact
  replay of known outcomes, retry exhaustion, and compensation failure; global
  projections cover duplicate and out-of-order source events, watermark and
  freshness enforcement, authorization filtering, rebuild, and source-retention
  loss. Read, live, and projection classes do not require workflow coordinator,
  step, retry, or compensation tests they do not possess;
- local per-cell transaction and stream invariants remain green under the same
  workload — cross-cell machinery cannot weaken the cell fast path;
- the class's A/B demonstrates the measured application need within its frozen
  budgets and publishes partial/failure outcomes, not only successes; and
- its LLP 0189 scoped evidence and eligible battery pass. Publication names the
  exact class, target, cell count, root shape, freshness, and non-promises.

Phase 3 exits class by class. “Cross-cell support” without that qualifier is
not a capability or a publishable claim.

## Dated design addition: trusted video admission facts (2026-08-24)

**Addition status.** Review-ready design, not implementation and not a
capability claim. This section routes LLP 0277 F8 and
`issues/20260817-upload-intent-codec-duration-admission-facts.md` through the
storage graduation plan because the same upload intent, trusted facts, refusal,
and durable outcome must survive SQLite → Postgres → transactional-cell
graduation. LLP 0044 remains the asset-pipeline authority; this addition fixes
the portable declaration and graduation obligations for that pipeline. It does
not fire §0's Postgres demand gate.

### Video admission declaration and composition

The upload intent's existing `accept` object gains one optional, closed
`video` member. The Coterie M2 intent's intended spelling is:

```ts
export const postVideoUpload = defineAssetUpload({
  args: {},
  auth: "authenticated",
  accept: {
    mediaTypes: ["video/mp4"],
    maxBytes: 50_000_000,
    video: {
      containers: ["mp4"],
      videoCodecs: ["h264"],
      audioCodecs: ["aac"],
      maxDurationMs: 60_000,
    },
  },
  delivery: { kind: "public-immutable" },
  access: { read: "via-references" },
  video: { location: "strip" },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
})
```

The two `video` spellings have deliberately different jobs. `accept.video` is
admission policy over trusted byte-derived facts. The existing top-level
`video.location` is canonicalization/privacy policy and remains unchanged per
LLP 0044's 2026-08-03 sibling-block decision. Moving `location` beneath
`accept`, or putting admission fields beside `location`, would blur that split
and needlessly disturb the frozen authoring/hash surface.

`accept.video` is all-or-nothing in v1: `containers`, `videoCodecs`, and
`audioCodecs` are non-empty duplicate-free allowlists, and `maxDurationMs` is a
positive JavaScript-safe integer. Declaration order is not semantic; codegen
canonicalizes each set in the policy identity. The initial closed vocabulary
is:

- containers: `mp4`, `quicktime`;
- video codecs: `h264`; and
- audio codecs: `aac`.

The declaration means that the normalized container must be allowed, at least
one video track must exist, every video track/sample description must normalize
to an allowed video codec, every audio track/sample description that exists
must normalize to an allowed audio codec, and the trusted presentation duration
must be less than or equal to `maxDurationMs`. An audio track is not required;
`audioCodecs: ["aac"]` means “AAC if audio exists.” All sample descriptions are
checked, including an unused alternate, so an unexamined codec cannot become
active through later sample-table selection. Non-audio/video handler tracks do
not satisfy the required video-track rule and are outside these codec
allowlists.

`mediaTypes` and `maxBytes` retain their current meanings and precedence:
attempt creation reserves against the declared byte length, trusted
finalization rechecks received and canonical length, and magic-byte content
type must match `mediaTypes`. `accept.video` is then an additional conjunction
only for bytes detected as `video/mp4` or `video/quicktime`. Codegen refuses an
`accept.video` block whose `mediaTypes` has no intersection with the supported
video types. A mixed image/video intent applies the block only to its detected
video branch.

The optional member is presence-only in the canonical artifact. When absent,
the emitted manifest and `snapback.asset-intent-policy.v1` preimage remain
byte-identical to their current forms; existing intents keep their hashes,
generations, behavior, and required capabilities. When present, the normalized
block participates in `intentPolicyHash`, implementation identity, retained
generation artifacts, AssetRef semantic identity, and required-capability
derivation. Adding or changing it therefore bumps the ordinary intent policy
generation. Existing in-flight attempts still follow LLP 0044's frozen-policy
rule: an ordinary non-revoking deploy does not retroactively apply the new
facts, while an explicitly revoked old generation cannot finalize.

The Rust-owned `AssetAcceptPolicy` carrier is the source of truth under LLP
0037; codegen constructs it and committed JSON Schemas/SDK consumers follow it.
No attempt-create/finalize request gains caller-supplied `container`, `codec`,
or `duration` fields. A client may perform an advisory preview check, but those
values never become admission evidence and cannot widen or satisfy the intent.

### Trusted detection and authority boundary

The authority is LLP 0044's existing trusted finalization prepare boundary:
after restricted staging is complete and exact length, transport integrity,
and magic-byte content type pass, but before any blob/rendition can be planned
or published. The implementation extends the bounded in-process ISO BMFF
walker in `crates/snapback-services/src/assets_video.rs`; it does not trust the
filename, extension, HTTP `Content-Type`, client media APIs, or client-provided
metadata, and it does not shell out to an ambient, version-variable `ffprobe`.

One bounded walk over the complete staged object produces a closed
`VideoAdmissionFactsV1` tied to the prepared canonical object's digest:

- `container`: normalize the validated `ftyp` major/compatible-brand family to
  `mp4` or `quicktime`; unknown or contradictory brand/box structures do not
  become `mp4` by fallback;
- `videoCodecs` and `audioCodecs`: classify tracks by the `hdlr` handler and
  walk `moov/trak/mdia/minf/stbl/stsd`; `avc1`/`avc3` plus a structurally valid
  `avcC` normalize to `h264`, while `mp4a` plus a structurally valid `esds` /
  AudioSpecificConfig in the closed AAC family normalizes to `aac`. A FourCC
  alone is not proof. The resulting sets are sorted and de-duplicated, while
  policy comparison still examines every track and sample description; and
- `durationMs`: compute the maximum presentation span of the admitted audio
  and video tracks from checked-timescale `tkhd`/`mdhd` durations and supported
  `elst` edit lists, with `mvhd` as a conservative consistency bound rather
  than the sole authority. Comparison uses checked rational arithmetic before
  rounding; the persisted millisecond fact rounds upward, so a duration just
  over the ceiling cannot truncate into admission.

Malformed sizes, missing required configuration boxes, zero/overflowing
timescales, contradictory duration tables, and an ISO BMFF form whose codec or
presentation duration the v1 walker cannot prove all fail closed. Fragmented
media whose complete presentation span requires `moof`/`traf` sample-timeline
evaluation is not silently evaluated from its initialization segment; v1
refuses it as facts-unavailable until that bounded timeline is implemented and
qualified.

The current strip rewrite blanks location boxes in place without changing
`ftyp`, track/sample descriptions, timelines, or offsets. The same walk may
therefore produce admission facts while preparing the strip output, but the
opaque prepared carrier binds those facts to the resulting canonical digest.
The retain path performs the same walk without rewriting. Both policies enforce
the same codec/container/duration rules.

This is the authority split LLP 0276 requires: `snapback-services` owns the
repeatable byte read, bounded parsing, canonicalization, and policy comparison
outside the global writer; the storage kernel receives only an opaque prepared
admission carrier and performs generation/witness revalidation plus durable
publication commits. No public constructor, backend adapter, or manifest value
can assert that byte-derived admission occurred. Eventual implementation sites
should cite this section and the next one rather than duplicating the rules in
SQLite, Postgres, transport, or client code.

### Stable refusal contract

The first deterministic failure wins after successful trusted MIME detection,
in this order: facts unavailable, container, video codec, audio codec, then
duration. The new stable `SNAPBACK_ASSET_*` refusals are all content-policy
HTTP 422 outcomes when served over HTTP:

| Code | Condition | Bounded safe details |
| --- | --- | --- |
| `SNAPBACK_ASSET_VIDEO_FACTS_UNAVAILABLE` | A structurally supported video cannot yield every fact required by the declaration (including unsupported fragmentation/timeline or unprovable codec configuration). Malformed input retains `SNAPBACK_ASSET_VIDEO_PARSE_FAILED`; resource ceilings retain `SNAPBACK_ASSET_VIDEO_BOUNDS_EXCEEDED`. | `fact`, `reasonClass`, detected MIME; never byte samples or raw metadata |
| `SNAPBACK_ASSET_VIDEO_CONTAINER_UNSUPPORTED` | The normalized container is outside `containers`. | `allowedContainers`, `detectedContainer`, bounded major/compatible brands |
| `SNAPBACK_ASSET_VIDEO_CODEC_UNSUPPORTED` | A video or audio track/sample description is outside its corresponding allowlist, or no video track exists. | `trackKind`, `allowedCodecs`, `detectedCodec` or `unknown`, bounded sample-entry FourCC, track ordinal |
| `SNAPBACK_ASSET_VIDEO_DURATION_EXCEEDED` | Exact rational presentation duration is greater than the inclusive ceiling. | `maxDurationMs`, upward-rounded `detectedDurationMs` |

These codes identify admission causes; they do not expose filenames, payload
bytes, location metadata, or unbounded track lists. A refusal makes the current
attempt `failed`, records the ordinary safe diagnostic/receipt, publishes no
blob or rendition, and leaves the stable asset `pending` and eligible for a
successor attempt with different bytes. Retry of identical bytes deterministically
returns the same policy refusal. The existing parse, bounds, location-strip,
type, integrity, and canonical-size codes keep their meanings.

### Capability and storage-graduation posture

A declaration carrying `accept.video` mechanically requires a new target fact,
`asset_video_admission_facts_v1`, in addition to whatever lifecycle,
delivery, and `asset_video_finalization_v1` facts its other fields already
require. Its manifest facts name the supported closed container/video-codec/
audio-codec vocabulary, duration extraction as `Enforced`, parser byte/box/
track/sample-description/edit-list ceilings, and whether fragmented timelines
are supported. A target missing the fact refuses the intent at generation or
activation before staging; it cannot ignore the block, treat client metadata as
proof, or borrow a sibling target's claim.

This feature can implement on the current SQLite authority without waiting for
§1's demand trigger: byte inspection is an asset-domain service operation, not
a new authority-store engine. Graduation nevertheless binds it as follows:

1. The generated intent and Rust-owned schema are identical on every target.
2. Parsing and policy comparison remain above the backend port. SQLite,
   Postgres, and later cells persist the same normalized safe facts, lifecycle
   transition, refusal code/details, and receipt; no backend re-detects codec or
   duration independently.
3. Publication of admitted facts and asset readiness stays in the asset's
   owning transactional cell with the existing generation, witness, quota,
   blob, rendition, and journal atomicity. Detection may run concurrently
   outside its commit fence, but the opaque carrier must be revalidated at the
   final commit exactly like current prepared asset facts.
4. The Phase-1 shared behavior corpus gains video-admission positive and
   negative vectors. A Postgres profile cannot claim
   `asset_video_admission_facts_v1` until identical bytes and frozen intent
   artifacts produce the same admitted facts or stable refusal as SQLite.
   Phase-2 migration carries the normalized facts and policy/generation
   identity with the asset component; it does not re-probe old blobs and risk a
   parser-version-dependent policy rewrite.

Supporting new containers/codecs or changing normalization is a versioned
capability/artifact change. It cannot silently widen `v1`, reinterpret retained
facts, or change the outcome of an attempt frozen under an older intent/parser
generation.

### Implementation acceptance

The follow-up implementation is complete only when all of these hold:

- authoring/codegen accepts the exact Coterie spelling above; rejects unknown,
  empty, duplicate, dead-with-respect-to-`mediaTypes`, or invalid-bound forms;
  emits the normalized Rust-owned carrier; and proves that intents without
  `accept.video` retain byte-identical manifests and policy hashes;
- policy-identity metamorphic fixtures show that each container, codec, or
  duration change bumps only the changed intent's policy generation and that
  frozen-generation finalization/revocation retains LLP 0044 semantics;
- trusted fixtures cover `mp4` and `quicktime`, `avc1` and `avc3` H.264, AAC,
  silent video, multiple audio/video tracks and sample descriptions, exact
  60,000 ms admission, 60,001 ms refusal, rational sub-millisecond overflow,
  unknown/malformed codec configuration, understated `mvhd`, edit lists,
  fragmented input, parse/resource ceilings, and filename/MIME/client-fact
  spoofing;
- every mismatch returns the exact code and bounded details above, publishes no
  blob/rendition, leaves a retryable pending asset, and is identical on strip
  and retain paths; successful finalization records container, codec sets, and
  upward-rounded duration against the canonical digest;
- target capability tests prove missing-fact refusal before staging, local
  capability activation only after the affected parser/finalizer corpus passes,
  and SQLite/Postgres parity before any future Postgres claim;
- the affected schema, diagnostic registry, guide/capability manifest, public
  authoring types, SDK artifact validation, and `@ref` anchors are regenerated
  and drift-checked under LLP 0037/0012; and
- Coterie M2's `postVideoUpload` declares MP4 + H.264 + AAC + inclusive 60 s
  (alongside its existing 50 MB and location-strip rules), then a real-server
  rerun uses a fixture whose bytes independently prove those facts, exercises
  at least one codec and duration refusal, and updates Diary 0086 to retire the
  honesty caveat with the run evidence. Editing the declaration or diary
  without that rerun does not satisfy this row.

### Non-goals and open questions

Non-goals for this slice are transcoding/remuxing nonconforming uploads,
poster/HLS/bitrate ladders, arbitrary codec strings, WebM/Matroska/AVI support,
resolution/frame-rate/bitrate policy, requiring an audio track, content
moderation/virus scanning, client-authoritative admission, and triggering the
Postgres or cell-partition program. Delivery ranges and location rewriting keep
their existing contracts.

Open questions, none of which blocks the MP4/H.264/AAC/60 s slice:

1. Should a later grammar express required/forbidden audio, exact track-count
   ceilings, or allowed container+codec tuples rather than independent sets?
2. Which real application first justifies bounded fragmented-MP4 timeline
   support rather than the initial facts-unavailable refusal?
3. Should future codec vocabulary distinguish H.264 profiles/levels and AAC
   object types, or should those become separately named admission facts?
4. When a second parser implementation is needed on another target, what
   frozen cross-parser corpus and parser-version fact are sufficient to claim
   semantic equivalence rather than merely accepting the same happy fixture?

## 4. Open questions

Every item below is author-gated before the phase that freezes its surface.
The recommendation is a default for decision, not a silent ruling.

1. **OQ1 — Which declared root is the smallest useful transaction and
   placement domain?** LLP 0128 §Open questions 4 carries app, environment,
   organization, workspace, room, document, and a schema-authored key.
   **Recommended default:** one membership-addressed workspace/project record,
   with app as the degenerate one-cell root. Keep rooms/documents below that
   root unless workload evidence shows they are independently operated and
   cross-room transactions are rare. Allow each app to choose one declared
   root; do not bake “workspace” into the runtime protocol.
2. **OQ2 — Which Postgres commit fence ships first, and may WAL replace the
   framework journal?** **Recommended default:** a guarded version-row
   `UPDATE … RETURNING` fence for the first supported target because it is
   explicit and easy to exercise in the same transaction; run the WAL spike
   concurrently and adopt it only after the complete §1.2 failure matrix.
3. **OQ3 — What is the first Postgres tenancy unit?** **Recommended default:**
   one logical schema per app on a managed primary, with a dedicated
   database/cluster profile for isolation or exceptional load. Do not place an
   app-id predicate into every portable table in the first adapter.
4. **OQ4 — Does v1 offer cross-cell atomic transactions?** **Recommended
   default:** no. Offer durable explicit workflows with cell-local idempotent
   steps and receipts. Reopen distributed atomicity only when a measured
   invariant cannot be modeled by locality, a scoped coordinator, or a
   projection.
5. **OQ5 — Is the first one-cell-to-many migration online?** **Recommended
   default:** no. Ship a quiesced, content-addressed, rollback-bounded migration
   first. Add change capture and online cutover only after the authority and
   stream-rotation proof is routine.
6. **OQ6 — Where do app-global auth invalidation, uniqueness, jobs, sequences,
   and aggregates live?** **Recommended default:** scope them to the locality
   root whenever product semantics permit; keep identity/routing control facts
   in an explicit control plane with versioned cell witnesses; use asynchronous
   projections for global reads. Any truly synchronous app-global invariant
   returns as its own author decision rather than silently centralizing every
   commit.
7. **OQ7 — What exact schema/codegen spelling carries placement?**
   **Recommended default:** one app-level closed placement descriptor compiled
   into `SchemaManifest`, plus generated table-to-root bindings and
   function-level placement classes. Avoid free-form handler annotations and
   avoid duplicating the root declaration independently on every function.

## 5. Revision history

- **v0.4 (2026-08-24).** Adds the review-ready trusted-video-admission design:
  an additive `accept.video` policy for container/codec sets and duration,
  byte-authoritative bounded ISO BMFF inspection, stable refusal codes, an
  explicit target capability, cross-engine/cell obligations, and the Coterie
  M2 rerun gate. This is design only; implementation and capability claims
  remain open pending dual review and the follow-up lane.
- **v0.3 (2026-08-16).** Status Draft → Accepted by author ruling (Charlie Cheever, 2026-08-16 session), on the converged dual-family review record in the run journal.
- **v0.2 (2026-08-16).** Applies review round 1: corrects implementation and
  LLP citations; scopes envelopes to identity-bearing lanes; adds the
  process-wide writer-gate removal and concurrency proof; makes Phase 2
  demand-gated and contingent on an LLP 0007 multi-stream amendment; builds
  the missing Phase-1 A/B instrument with exact Plan-local queue/fence
  vocabulary; disambiguates transactional cells from LLP 0189 D-8 coverage
  cells; and makes Phase-3 failure corpora class-appropriate.
- **v0.1 (2026-08-16).** Initial commissioned Draft. Records the demand-gated
  execution posture and sequences Postgres authority support, declared
  locality-root cells, and explicit cross-cell semantics from LLP 0128 and the
  2026-08-15 author performance-direction ruling.
