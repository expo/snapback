# LLP 0269: Storage graduation through Postgres and transactional cells

**Type:** Plan
**Status:** Accepted
**Systems:** Storage, Assets, Performance, Schema, Sync, Realtime, Deployment, Testing
**Author:** Codex gpt-5.6-sol xhigh, orchestrated by Claude Fable 5 (commissioned in the author's 2026-08-16 orchestration session under Charlie Cheever's 2026-08-15 performance-direction ruling)
**Date:** 2026-08-16
**Revised:** 2026-08-24 (video admission's proposed normative contract moves
to Review LLP 0305; this Accepted Plan retains only backend/cell portability
and graduation obligations); 2026-08-18 (LLP 0276 crate-path relocation);
2026-08-16 (v0.3 — Status Draft → Accepted, author ruling 2026-08-16)
**Related:** LLP 0007, LLP 0012, LLP 0037, LLP 0044, LLP 0046, LLP 0080, LLP 0113, LLP 0128, LLP 0163, LLP 0189, LLP 0198, LLP 0209, LLP 0225, LLP 0265, LLP 0276, LLP 0277, LLP 0305, `issues/20260815-storage-graduation-plan-commission.md`, `issues/20260817-upload-intent-codec-duration-admission-facts.md`

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

## Dated portability addition: declared video admission facts (2026-08-24)

**Addition status.** Design-only portability obligations for Review LLP 0305;
not implementation, not acceptance of that Spec, and not a capability claim.
LLP 0044 remains the asset-pipeline authority, and
[LLP 0305](./0305-declared-video-admission.spec.md) is the dedicated proposed
normative contract for the `accept.video` grammar, trusted ISO BMFF facts,
refusals, bounds, parser-semantics version, and implementation acceptance.
This Plan no longer owns or restates those parser rules.

This addition routes LLP 0277 F8 and
`issues/20260817-upload-intent-codec-duration-admission-facts.md` through the
existing storage-graduation seam only. It does not fire §0's Postgres demand
gate: byte inspection is asset-domain preparation, not a new authority-store
engine.

### Portability and graduation obligations

If LLP 0305's Review design is accepted and implemented, its
`asset_video_admission_facts_v1` capability must graduate without changing
application or admission semantics:

1. The generated intent, Rust-owned policy carrier, parser-semantics version,
   and required-capability derivation are identical on every target. A backend
   adapter cannot add, remove, or reinterpret a video-policy field.
2. Canonical byte inspection and policy comparison remain in the asset-domain
   service above the authority-store port. SQLite, Postgres, and later cells do
   not independently re-detect container, declared codec configuration, sample
   layout, or duration.
3. The opaque prepared carrier binds the canonical digest, exact normalized
   facts, frozen intent/implementation generation, and parser-semantics
   version. The final publication commit revalidates those bindings with the
   current attempt, generation, witness, quota, and lifecycle state before
   persisting facts or readiness.
4. Every authority persists the same normalized safe facts, lifecycle
   transition, stable refusal code/details, and receipt. Publication of the
   admitted facts and readiness remains one transaction in the asset's owning
   cell with the existing blob/rendition/journal atomicity.
5. Store or cell migration copies the canonical digest, normalized facts,
   parser version, and policy/generation identity as opaque historical
   evidence. It never re-probes an old blob with a newer parser and silently
   rewrites its admission outcome.
6. Phase 1's shared SQLite/Postgres behavior corpus gains LLP 0305's positive,
   adversarial, refusal, deterministic-bound, and retained-version vectors. A
   Postgres profile cannot claim `asset_video_admission_facts_v1` until
   identical canonical bytes plus frozen artifacts yield the same normalized
   facts or stable refusal as SQLite.
7. Phase 2 placement keeps preparation outside the commit fence and publishes
   the resulting carrier in the asset's one owning cell. Cross-cell storage or
   a sibling target's capability cannot substitute for the owning cell's exact
   claim and evidence.

Supporting a new brand, declared codec configuration, elementary-stream proof,
fragmented timeline, duration interpretation, or resource-accounting schedule
is a new parser-semantics/capability version under LLP 0305. Graduation may
carry old versioned facts; it may not widen v1 or reinterpret retained
attempts.

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

- **v0.5 (2026-08-24).** Moves the proposed normative video-admission design
  into Review LLP 0305 under LLP 0044's asset authority after convergent
  hostile review. This Accepted Plan now retains only the SQLite → Postgres →
  transactional-cell portability and graduation obligations; implementation
  and capability claims remain open.
- **v0.4 (2026-08-24, superseded in document home by v0.5).** Initially added
  the review-ready video-admission design here. LLP 0305 now owns that proposed
  grammar/parser/refusal/acceptance contract.
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
