# LLP 0126: Local-first and local sync

**Type:** Research
**Status:** Review
**Systems:** Competitive evaluation, Sync, Realtime, Storage, Runtime, Client integration, Wire Protocol, Auth, Developer experience
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:**
**Related:** LLP 0003, LLP 0034, LLP 0059, LLP 0073, LLP 0074, LLP 0081, LLP 0082, LLP 0083, LLP 0084, LLP 0085, LLP 0093, LLP 0112, LLP 0114, LLP 0115, LLP 0116, LLP 0117, LLP 0118, LLP 0119, LLP 0120, LLP 0123, LLP 0125, Diary 0027, Diary 0028, Diary 0029, Diary 0039

A companion to the Convex-parity research series (LLP 0116; 0117–0125):
same method — diary evidence separated from general background, Snapback
claims code-verified, a multi-path option space, no final call — applied
to a front the 2026-07-30 rerun deliberately did not measure. Author
directive (2026-07-30): treat every plausible approach in depth rather
than plan one, because the answer may affect the parity program's
direction.

## Summary

Local-first is the one front where the bakeoff diaries recorded GAPs
against nearly every backend — including both Snapback and Convex — and
where the rerun then measured nothing: Diary 0039 bounds itself to
"local development, authoring, generated contracts, transactions,
realtime, ephemeral state, search, and scheduled work." The 55/45 score
contains no local-first signal. This front is therefore an opportunity
claim, not a loss claim: a trustworthy local-first story competes
against recorded absence, not against a Convex strength.

Three facts shape the analysis. First, the field has converged away
from its founding bet: two funded teams retreated first-party from
CRDT-core architectures (ElectricSQL 2024, Jazz 2026), the most
successful CRDT vendor tells customers to resolve business conflicts at
read time, and five surveyed peers sync query-scoped state deltas while
zero sync client-visible event logs (LLP 0022, 0084, 0085). Snapback's
pinned server-authoritative-rebase posture (LLP 0008) is the
destination the field retreated *to*. Second, Snapback already owns a
designed and partially shipped local-first stack — LLP 0008's sync
contract, LLP 0043's shipped Contract-side retention/replay slice,
LLP 0090's persisted resume, LLP 0051's local-execution design — that
the bakeoffs' scored path (the browser JS client driving protected
opaque queries) does not reach. Third, Snapback has one structural
possibility no surveyed peer can pin: handlers are closed,
content-addressed, and deterministic-tier-enforced; the runtime is an
embeddable Rust+Hermes binary with sealed per-platform packages; the
store is SQLite. That composes into running the *same* content-
addressed mutations locally and settling by server re-execution —
"same code both sides" without a second implementation of business
logic. This document treats that approach in depth alongside eight
others, and decides nothing.

## Method and provenance

Four labels, used throughout:

- **(a) Diary-evidenced** — the 2026-07-28 bakeoffs (Diaries 0027–0031)
  and the 2026-07-30 rerun (Diaries 0032–0039), quoted directly.
- **(b) In-repo prior-art research** — dated primary-source passes:
  LLP 0022 (Electric, PowerSync, Turso; fetched 2026-06), LLP 0082–0085
  (InstantDB, Cloudflare, Triplit/Ditto, Jazz; fetched 2026-07-23), and
  the Valet production record absorbed into LLP 0008.
- **(c) Dated general background** — knowledge-cutoff material with no
  in-repo verification (Replicache/Zero, Linear, cr-sqlite, Couch/
  Pouch, OT history, Figma, Ink & Switch). Labeled, contour-level only,
  flagged where the contour is uncertain; never treated as evidence.
- **(d) Code-verified** — checked against the working tree 2026-07-30,
  cited by path (line numbers as of that date).

## The frame: the seven ideals, as background

**(c, 2019.)** Ink & Switch's "Local-first software" essay defined the
ideals the field measures itself against: (1) no spinners; (2) work not
trapped on one device; (3) the network is optional; (4) seamless
collaboration; (5) longevity; (6) security and privacy by default;
(7) ultimate user ownership. Its proposed mechanism was CRDTs.

The in-repo record splits the list from the mechanism. What adopters of
the CRDT platforms actually valued — "instant local reads, sync for
free, permissions shaping what syncs, deep history" (Jazz's founder,
LLP 0085) — is ideals 1–3, which every approach below can serve; the
strong cryptographic form of 6–7 is what Jazz retreated from, and
LLP 0084's market finding is that demand for radical serverless
operation concentrates in mesh verticals Snapback deliberately refuses
(LLP 0074's "not a mesh database" boundary). This document evaluates
approaches against ideals 1–4 plus Snapback's evidence bar.

## The field's approaches

### 1. CRDT-based merge

**Mechanism.** Replicas apply writes locally and immediately; data
types carry metadata (element ids, counters, version vectors) so any
two replicas merge to the same state without coordination. **(c)** The
Automerge lineage (JSON documents, full history) and Yjs lineage
(sequence CRDTs for collaborative text) are the mature references.

**Exemplars (b).** Classic Jazz was the purest platform form: CoValues
owned by cryptographic Groups, every mutation a signed transaction,
state derived by CRDT replay, permissions enforced by signatures and
encryption with no trusted server (LLP 0085). Ditto is the commercial
proof where the *mesh* is the product: LWW registers, add-wins maps,
causal consistency, $82M Series B, aviation/QSR/defense customers
(LLP 0084).

**What it buys.** Ideals 1–4 by construction: instant local writes,
offline symmetry, peer sync, no merge code in the common case.

**Costs, with receipts.**

- *Tombstone and metadata growth.* Merge correctness retains identity
  for deleted elements; GC needs causal stability that offline peers
  delay indefinitely. **(b)** Classic Jazz: deletion is tombstones, and
  the docs are silent on history GC in both generations (LLP 0085).
  **(c)** Automerge retains full history by design; Yjs GCs deleted
  content but keeps structural metadata.
- *Semantic invariants violated under merge.* Merge converges; it
  cannot refuse. The canonical case is the capacity check: two offline
  replicas each admit the last seat, and the merged state violates the
  invariant with no actor at fault. Ditto's own guidance concedes it:
  "accept every write using add-wins maps, then derive the correct
  business state at read time" — convergence, not correctness
  (LLP 0084). Contrast the server-authoritative bakeoff result:
  "Capacity enforcement fit naturally in one authoritative mutation"
  (Diary 0030, quoted in LLP 0125).
- *Authorization during merge.* Without a server, any peer must
  evaluate permissions: Ditto restricts permission predicates to the
  immutable `_id` field; classic Jazz's crypto enforcement made
  revocation forward-only ("existing data they already had access to
  remains readable"), invites unrevocable, and member lists transparent
  (LLP 0084, 0085). Jazz's retreat names it: "Permissions moved away
  from cryptographic enforcement around the whole system toward a
  trusted server applying richer policies at sync time."

**Snapback fit.** Poorest of the nine as a core: it replaces the commit
boundary, read-set validation, server-side authorization, and receipts
in one move, against the field's own record (LLP 0022 §1: "automatic
semantic conflict resolution is the wall"). As a sidecar for specific
data types it stays live — option D.

### 2. Operational transforms

**(c, dated.)** The Google-Docs lineage: concurrent operations are
transformed against each other to converge (GROVE 1989; Jupiter 1995;
Wave; Docs). Correctness needs transformation properties (TP1/TP2)
that are notoriously hard to verify per operation pair, so practical
systems collapse to a central server imposing a total order.

**Why the field moved away, except for text.** The transform matrix
grows with the operation vocabulary, so OT is tractable exactly where
the type is one hand-verified sequence (text). General app state went
two ways: CRDTs where decentralization was the point, and server-
authoritative rebase where a server exists anyway — which needs no
transform functions because the server re-executes intent against
current state. **(c)** Figma's public account says it rejected OT and
ships server-authoritative per-property LWW with client prediction.

**Snapback fit.** Not a candidate for row sync. If collaborative text
ships (LLP 0008's rich-text reference app), the choices are a text CRDT
sidecar or an OT server for that one type — option D's territory.

### 3. Server-authoritative mutation-rebase engines

**Mechanism.** The client holds a local view, applies *named mutations*
speculatively, and queues them. The server executes each queued
mutation against current authoritative state (not the client's
snapshot), assigns the order, and streams state back; the client
rewinds speculative results and replays pending mutations on each
authoritative update. Conflicts mostly vanish into "your intent ran
later against newer state"; the rest surface as app semantics.

**Exemplars.** **(c)** Replicache is the cleanest published form:
client-side JS mutators run speculatively, a push endpoint applies the
same-named mutations authoritatively, pull-driven rebase reconciles —
server reconciliation in the rollback-netcode tradition; Zero is the
successor generation with query-driven partial sync. Linear's engine,
per public talks: an IndexedDB-persisted local object graph
bootstrapped then maintained by deltas from a server-ordered log, local
writes enqueued as transactions. Contours only; unverified here.
**(b)** InstantDB is a verified adjacent form: a pending-mutation queue
over an immutable committed store, server-final, attribute-level LWW,
rejection = drop the queue entry so "undo works out of the box"
(LLP 0082).

**What it buys.** Ideals 1–3 without surrendering server authority:
rich permissions, meaningful revocation, invariants enforced in one
place, no merge metadata in the data model.

**Costs.** Business logic must exist on both sides — Replicache
mutators are same-by-convention, nothing pins the halves; speculative
results are provisional and UX must tolerate rewind; the store, queue,
and rebase discipline have sharp edges (LLP 0008's Valet-derived rules
— doc-id suppression, sequence-not-wall-clock ordering, full-resync-
before-replay — are that machinery's scar tissue, in-repo).

**Snapback fit.** This is Snapback's own model: replay as function +
args + captured environment (wire: `{generatedIds, now}`), server-
authoritative, LWW-per-field with delete-wins and typed conflict
payloads (LLP 0008); retention and queue in LLP 0043; read-set
validation and reservations (LLP 0003, 0059) as the commit semantics a
rebased mutation lands on. The distinctive extension available is
approach 9: make "same logic both sides" checkable by content address.

### 4. SQLite replication lanes

Replicate *the database* rather than query results — attractive because
Snapback's durable store is already SQLite (LLP 0003). The
sub-approaches differ in what crosses the wire and who owns writes.

- **cr-sqlite — CRDTs inside SQLite.** **(c)** A loadable extension
  making tables conflict-free replicated relations with column-level
  LWW; peers exchange changesets. Activity level uncertain at this
  writing. Inherits approach 1's invariant and authorization problems
  wholesale — the merge just lives in SQL.
- **ElectricSQL Shapes — read-path partial replicas.** **(b)** A Shape
  is a table plus a WHERE clause streamed out of Postgres over HTTP
  with immutable log offsets, so reads are CDN-cacheable (verified to
  ~1M concurrent clients); writes are explicitly out of core ("a sync
  engine, not a local-first software platform"), handled by your API
  with optimistic state in a separate rebased layer; auth is a
  gatekeeper-minted shape-scoped JWT, client filters can only narrow
  (LLP 0022).
- **PowerSync — authorization-scoped bucket sync, in production.**
  **(b)** Buckets are server-maintained operation logs derived from
  trusted JWT claims; checkpoints apply atomically, and the client
  never advances its checkpoint while local writes are pending, so it
  never resolves conflicts locally. Writes queue in a client FIFO
  uploaded to *your* backend; conflict model LWW per field,
  delete-wins, backend-authoritative — "identical in spirit" to
  LLP 0008's pin (LLP 0022). Its restrictive first-generation sync
  rules had to be replaced wholesale by Sync Streams; 0022's recorded
  lesson: design for the expressive shape early.
- **Turso embedded replicas.** **(b)** Whole-database read-local/
  write-remote replicas, plus explicit push/pull Sync with
  last-push-wins and rollback-and-replay. Its "partial sync" is page
  hydration, not authorization-aware row sync — 0022's inference: local
  SQLite sync alone does not solve the card-game secret-hands case; the
  auth-aware result-set layer remains the hard part.

**Which sub-approach composes with Snapback.** The discriminator is the
replication unit. Whole-table or page replication bypasses the
authorized-result unit — LLP 0008 rejected table replication for
exactly the authorization case — and a raw local SQL read path bypasses
result-contract egress validation (LLP 0117) and read-set capture. The
sub-approach that composes is the Electric/PowerSync shape: a declared,
server-filtered partial replica with membership derived from trusted
claims — structurally Snapback's own syncable-live subset (LLP 0008)
arriving from the other direction. The genuinely novel separable piece
is Electric's cacheable HTTP read lane over immutable offsets;
LLP 0008 DK-3 already preserves that option by keeping client-
comparable versions on the wire, with D1's bookmark Sessions API as
copyable prior art (LLP 0083).

### 5. Oplog / event-sourcing replication with deterministic replay

**Mechanism.** Ship the ordered change (or intent) log itself; replicas
reach state by deterministic replay; resume is a log cursor. **(c)**
Lineage: replicated state machines, game lockstep/rollback netcode,
event-sourced app architectures.

**The field's verdict (b).** LLP 0084's count: five surveyed systems
sync materialized query-scoped state deltas, zero sync client-visible
event logs — logs survive *inside* engines (PowerSync buckets, Ditto
version vectors, D1's log-plus-snapshot bookmarks) but not as the
client contract. LLP 0008 considered and rejected event-log sync as the
primary model: ordinary apps should not author events and projections.

**Snapback fit.** Already the internal shape: `_snapback_changes` is a
row-level journal with a monotonic global version, tombstones, a
pruning floor, and `resume_requires_resnapshot` (LLP 0003/0008 L3;
code-verified). Not a rival product model but the substrate every
resume story consumes; the missing consumer is the version-based
delta-resume client named as future work in LLP 0008.

### 6. Reactive cache + optimistic writes with server settlement

**Mechanism.** No replica of record: the client caches subscribed query
results in memory, overlays optimistic writes, and the server settles —
Convex, InstantDB, and Snapback's current clients. Offline capability
is whatever a warm session's cache gives; a cold boot has nothing.

**Diary evidence — the best-measured approach in the corpus.** Convex's
warm-session story was praised: "The default mutation retry contract is
unusually valuable: the warm offline create and update settled without
application queue infrastructure and exactly one marker committed"
(Diary 0027). Its limit was measured in the same arm: a reopened
browser with the backend down "yielded no authenticated application
shell and zero retained query rows. Durable offline boot is therefore a
GAP" — "a strong result for intermittent transport within one running
app session, but it is not local-first durability across a
process/browser restart" (Diary 0027; Diary 0028 confirms the cache is
online-only JavaScript memory). SpacetimeDB recorded three offline GAPs
(Diary 0027); Supabase and Appwrite recorded the cold-boot GAP; the one
strong browser result was Firebase — "Firestore's browser persistence
was the strongest offline result so far," with the sting that
"Revocation did not erase bytes already stored in Firestore's browser
cache… Firebase leaves sensitive-cache retirement to the application"
(Diary 0028).

**What it buys / costs.** The cheapest path to ideals 1 (warm) and 4;
no replica, no merge, no migration-skew surface. It is not local-first
under any honest definition — the network is not optional across a
process boundary — and every diary scored exactly that line.

**Snapback fit.** This is what the JS client ships today, at or past
the Convex bar in places (code-verified below). Hardening it —
persistence plus the queue — is option A.

### 7. Couch/Pouch-style document replication

**(c, dated; the historical baseline.)** CouchDB replication with
PouchDB in the browser was the first mainstream database-that-syncs:
per-document revision trees, master-master, offline by default. Why the
conflict model disappointed: concurrent edits produce sibling
revisions, and Couch deterministically picks an *arbitrary* winner that
reads as normal data — losers sit behind a `_conflicts` flag apps
almost never scan, so writes silently vanish unless the app builds its
own merge UI. Why the sync granularity disappointed: replication is
per-database; filtered replication ran a JS filter over the whole
changes feed, and read access control was effectively per-database,
pushing real systems into db-per-user topologies. The lasting lessons —
deterministic-but-arbitrary winners are worse than either honest LWW or
explicit conflicts; partial replication under authorization is the real
problem — are what the later systems are built around.

### 8. Local-only with explicit sync/export

**Mechanism.** The honest minimal lane: fully local, fully
authoritative on one machine; multi-device is explicit export/backup/
transfer. **(c)** File-based tools (Obsidian-style vaults) are the
familiar shape.

**Snapback fit.** Uniquely cheap: the Snapback server is *itself* a
local single binary (code-verified below), so a locally run app already
is local-only-with-full-authority — every feature, zero sync machinery.
Missing pieces are product-shaped: a paved backup/export story
(server-side backup machinery to Tigris exists on the hosted profile,
LLP 0111) and capability language that says single-authority. Serves
single-user tools and agent workspaces; never to be marketed as sync.

### 9. The embedded-runtime approach

Snapback's distinctive possibility, treated at full depth.

**Mechanism.** Run the *same* mutations the server runs, locally,
against a local SQLite replica of the client's authorized subset;
journal local commits as speculative; settle by shipping the mutation
stream (function reference + args + captured environment) to the
server, which re-executes authoritatively — approach 3's rebase — and
the client reconciles from receipts. What no approach-3 exemplar has is
the pin between the two sides:

- **Handlers are closed and content-addressed (d).** Inline v1 admits
  one self-contained expression per operation — no imports, no free
  identifiers, a closed 31-global allowlist — and the implementation
  identity hash (`snapback.function-implementation.v1`,
  `packages/snapback-codegen/index.mjs`) covers the canonical AST,
  args/result contract hashes, reads/writes, and auth (LLP 0118). A
  replica can know, by hash, that it executed byte-identical logic to
  what the server will settle.
- **The deterministic tier is enforced, not requested (d).** Queries
  and mutations run in a no-eval VM that denies ambient nondeterminism
  at runtime (`ambient_restriction_source`, `src/runtime.rs`; the
  action tier deliberately retains ambient access — LLP 0118).
  `ctx.runtime.now()` is per-invocation frozen; LLP 0051 D1's
  ctx-answer ledger is the designed record/replay channel for the
  remaining host answers; LLP 0008's replay environment
  (`{generatedIds, now}` on the wire) is the settlement-side half,
  grounded in Valet production behavior.
- **The runtime is an embeddable artifact (d).** The server is one
  binary (`src/main.rs` is four lines into `snapback::cli`;
  `Cargo.toml` `default-run = "snapback"`), and sealed per-platform
  runtime packages exist — `packages/snapback-runtime-darwin-arm64`
  pairs `bin/snapback` with `hermesvm.framework`,
  `packages/snapback-runtime-linux-x64` adds a binary+Hermes digest
  attestation, and `HERMES_LINK_STATIC=1` exists unused (LLP 0123). The
  store is SQLite on both sides (LLP 0003; DK-9's reference client
  store is SQLite).

Convex cannot offer this: its functions execute only in its runtime,
and clients hold caches, not logic. Replicache-class systems run client
mutators but pin nothing — the halves are same-by-convention. Jazz v2
keeps an embedded replica with offline writes but has no
server-function story at all (LLP 0085). A content-addressed,
deterministic, both-sides handler tier is a lane only Snapback is
positioned to claim; LLP 0051 §D6 already names the composed result
"Parity by construction."

**What breaks, honestly.**

- *Server-derived authority offline.* The rerun praised "server-derived
  local owners, trusted runtime time/IDs" (Diary 0039) — precisely the
  facts a local run cannot mint. LLP 0008 already pins that the server
  accepts the captured environment on replay (divergence would corrupt
  data), so replayed mutations carry client-attested time. Claims that
  depend on *trusted* time or server-minted identity must degrade to a
  settle-time policy (accept / clamp / flag) or be excluded from the
  locally executable set. Nothing owns that policy today.
- *Reads the replica cannot serve.* A handler's reads must be provably
  satisfiable from the retained subset or local execution silently
  computes on partial state. JS-tier read declarations are
  table-granular (LLP 0120) — too coarse to prove satisfiability. The
  artifacts that can prove it are the declared, index-served, bounded
  shapes: host-plan queries, `relational_query_v1`, and LLP 0110's
  bounded profiles with examined-entry ceilings. The natural unit of
  partial replication is therefore the declared bounded read shape —
  the same analyzable subset that already gates syncable-live
  (LLP 0008) and delta eligibility (LLP 0034 OQ1). LLP 0043 already
  ships the degenerate form: `Parity` only where the complete mutation
  set is locally IR-derivable.
- *Authorization and revocation offline.* Local execution of protected
  reads needs the policy locally (Jazz v2's compiled client policy
  bundle and Triplit's compiled read filters are the field's answers —
  LLP 0085, 0084), and revocation while offline is unsolvable in
  general: Firebase retained revoked cache bytes (Diary 0028); Instant
  evicts on data-change but not rule-change (probe-observed, LLP 0082).
  Snapback's shipped answer is the strictest surveyed: retained
  protected reads bind to a server-MACed `AuthorizedLease` with a
  24-hour hard maximum, equality-is-expiry, deletion-before-render on
  any mismatch, renewal only by fresh full revalidation (LLP 0043 M1).
  Fail-closed disconnected *means* data disappears at lease expiry; the
  embedded-runtime lane inherits that contract.
- *Migration skew.* LLP 0081 owns the seam: an incompatible client gets
  a stable upgrade-required refusal "with its client-custodied offline
  mutations quarantined for the resync-before-replay path rather than
  silently replayed or dropped." Local execution adds an untreated
  instance: a mutation executed locally against schema S1 and settled
  after the server migrated to S2 — schema-at-capture versus
  schema-at-settle. The content address makes the mismatch detectable
  (the hash names its schema era); the policy is unowned. Jazz v2's
  lens migrations are the field's more ambitious answer (LLP 0085).
- *The evidence story.* A local commit's receipt is self-attested; it
  must be marked speculative and never presented as settlement. The
  server-signed-fact template exists — the AuthorizedLease is exactly a
  server-signed fact in client custody (LLP 0043/0053) — and settlement
  receipts already carry `snapshotVersion` (`src/live_wire.rs`,
  `Receipt::Mutation`). The composed contract: speculative receipts
  carry content address plus captured environment; settlement receipts
  bind them to the authoritative commit version; capability claims
  follow LLP 0012's rule ("no local execution means no local-first/
  parity claim," quoted by LLP 0043) — which this lane finally
  satisfies rather than works around.
- *What stays impossible.* Authoritative settlement offline; revocation
  delivery offline; global uniqueness (a unique-index check against a
  partial replica is speculative — the settle can still lose to
  `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`); actions and external effects
  (the action tier is deliberately nondeterministic and never
  auto-replayed — LLP 0125); cross-client convergence while
  partitioned; trusted timestamps.

**The browser, separately and honestly.** Browsers do not run the
Rust+Hermes runtime. The realistic ladder: (i) the LLP 0051 D2
mutation-IR evaluator — host-plan mutations are data, evaluable by a
small JS interpreter; the only rung with an in-repo design, and what
LLP 0043's derived optimistic overlays already assume; (ii) WASM
handler artifacts (0051 D3) for logic past the IR; (iii) compiling the
full runtime to WASM — feasibility, size, and performance unassessed
here, no in-repo evidence either way. The store side is proven
(wa-sqlite carried Valet's browser replica, LLP 0008). So the full
embedded-runtime form is native-first — desktop now (the runtime
packages exist for macOS/Linux hosts), mobile plausibly (Hermes is
React Native's engine; the Rust host on iOS/Android is unproven) —
while the browser gets the IR/WASM tiers. A design that pretends one
lane covers both platforms is wrong on day one.

## What Snapback has today (code-verified 2026-07-30)

**The server core has the substrate.** One serialized write boundary
over SQLite; every commit advances a monotonic global version stamped
onto affected rows; `_snapback_changes` journals row changes with
tombstones, a pruning floor, and `resume_requires_resnapshot`
(LLP 0003, 0008 L3). Two OCC channels validate inside the commit
transaction: client-declared `readSet` baselines (deliberate CAS,
LLP 0003 E3) via `validate_read_set` (`src/storage.rs:10402`) and
handler-captured dependencies via `validate_captured_read_set`
(`src/storage.rs:10468`), rejecting as `SNAPBACK_MUTATION_CONFLICT`
with the failing dependency, the captured read set, and
`retryPolicy: "reject"` (`src/storage.rs:10609-10620`). The server-side
exactly-once ledger for client mutation ids lives in
`_snapback_client_mutations` (`src/storage.rs:1966-2050`).

**The wire is online-shaped.** Reconnect is always a fresh
`subscribe_live` — the server drops durable subscriptions at socket
close, and `resume_live` is a same-connection operation no first-party
client calls across a loss (LLP 0093 D3; policy comment at
`packages/snapback-client/index.mjs:125-131`). LLP 0090 widened resume
to relaunch-from-disk for `rqsEligible` queries via server-minted
tokens, with the outbox rule (a non-empty outbox never resumes: full
resync, then replay) preserving LLP 0008's pending-mutation hazard.

**The JS client is a strong approach-6 cache, memory-first.**
Code-verified in `packages/snapback-client/index.mjs`:

- Mutation retry is exactly the closed effect-free refusal: only a 409
  `SNAPBACK_AUTH_RESERVATION_STALE` with `retryable`/`short-jitter`/
  `effectCommitted:false` re-enters (gate at line 4977; predicate at
  3498–3513), default 40 attempts, 20–80 ms jitter (309–311),
  authority-generation-pinned, observable via a diagnostics ring.
  Nothing else retries; an indeterminate mutation is explicitly
  non-retryable outside application idempotency.
- `clientMutationId` is a caller-supplied durable identity (LLP 0043
  M2; lines 4902–4906) with `acknowledgeMutations` for GC; the client
  mints no ids and holds no outbox — the only outbox concept is an
  injected `outboxEmpty` predicate defaulting to empty
  (`rqs-store.mjs:271`).
- Across a reconnect, cached rows are retained and *marked*, never
  cleared: handles hold `'polling'` or `'stale'` with last-known rows
  (7978–7993); `LiveStreamManager` reconnects with 250 ms → 10 s
  exponential backoff (9053–9066). Receipts carry the server-minted
  `snapshotVersion`; the client rings them and does not gate query
  freshness on them.
- Persistence exists as an opt-in shipped seam: an injected `rqsStore`
  persists `{rows, meta, token}` per eligible subscription, with
  IndexedDB (`rqs-store.mjs`) and file (`rqs-store-file.mjs`) backends;
  relaunch renders retained rows first, fail-closed on verification
  mismatch (6452–6508). Without a store, the cache is memory-only.
- Optimistic writes live in the framework-neutral external store
  (`packages/snapback-client/external-store.mjs`): per-mutation layers
  over authoritative rows; rejection splices out exactly the failed
  layer and recomputes from the newest authoritative base (382–390);
  retirement waits for authoritative delivery. LLP 0114 projects this
  with `freshness: "unknown"|"retained"|"current"` and pins the honesty
  rule: "Retained rows, optimistic presentation, RQS boot, or preserved
  stale rows do not prove local execution, durable offline queueing,
  replay, or `Parity`."

**The Contract arm has the shipped offline slice.** The guide's
capability index rows `sync.offline` ("Retained queries, outbox,
replay, optimistic overlays") and `auth.authorized-leases` are
`shipped` on the local target (`guide/capabilities.md`), backed by
`guide/sync/offline-and-retention.md`: the Contract adapter retains the
last authoritative snapshot under a lease, renders derived optimistic
changes offline, replays a durable outbox in order after reconnect, and
"reports this as `Parity` only when every required proof is present" —
a durable client store, complete retained identity, every mutation
locally IR-derivable (LLP 0043's claim rule). The local capability
manifest claims `offline_retention: true, optimistic_replay: true`
(`src/manifest.rs:6100-6101`); the Cloudflare profile sets both false
and lists `offline_mutation_replay` in its capability gaps.

**And the diaries scored the arm that has none of this.** The bakeoff
apps drove the browser JS client against protected opaque JS live
queries, which are not retainable (`localRunnable: false, retainable:
false` — Diary 0028), so Snapback recorded the same GAP family as
everyone else: "no cold retained protected rows, no restart-safe
offline mutation queue, and therefore no reconnect settlement for
queued work. Those remain the largest reason Snapback is not yet the
default for this Todo" (Diary 0027); "the revocation failure and
protected offline GAP sit on its central promises, not at the edge"
(Diary 0028; the revocation half was fixed in the remediation rerun);
"For a local-first issue tracker today, no" (Diary 0029). The rerun
then measured none of this (Diary 0039's scope note). This is LLP
0116's cross-cutting finding 2 on a new front — execution lag and arm
coverage, not design absence — with one designed exception: protected
*opaque* queries are non-retainable by design (LLP 0053's shrinkage
obligation), not by lag.

## Cross-cutting axes

**Authority and trust offline.** Every approach answers "who can be
believed while disconnected." Crypto answers buy serverless operation
and pay in revocation semantics and permission expressiveness — the
in-repo record is unusually strong (Ditto's `_id`-only predicates;
Jazz's forward-only revocation; both first-party). Server-authoritative
answers must instead decide what a disconnected client may *show*:
Snapback is alone among the surveyed systems in having a signed,
expiring, fail-closed retention authority (the lease) rather than an
unbounded cache. The embedded-runtime lane adds a third question — what
a locally *executed* result is worth — answered only by
speculative-versus-settled receipt discipline.

**Conflict semantics: merge, rebase, refusal.** Merge converges and
cannot refuse (the capacity problem). Rebase re-executes intent and can
refuse. Refusal-first is where Snapback's CAS lane sits, and agents
praised exactly that ("easier to interpret than a provider-specific
last-write-wins convention" — Diary 0029, quoted in LLP 0125). The
pinned composition — LWW-per-field replay defaults, typed conflict
payloads, semantic conflicts always visible (LLP 0008/0043) — matches
the field's mainstream (PowerSync and Instant ship the same default)
while keeping the evidence. Where each violates app invariants: merge
silently; rebase preserves them but can strand queued intent
(drop-and-mark-failed is the honest terminal); refusal preserves them
at the cost of user-visible conflict work.

**Partial replication under authorization and revocation.** The axis
the field keeps rediscovering as the hard part (Couch's db-per-user;
Turso's page-hydration non-answer; PowerSync's two rule generations;
Jazz v2's "permissions must determine what is allowed to be present
locally"). Snapback's position is coherent: the unit of sync is the
authorized query result (LLP 0008), membership is server-derived, and
revocation has a specified, ACK-backed, lease-bounded path (LLP 0053)
covering the rule-change shape Instant was observed not to deliver
(LLP 0082). The open cost is expressiveness: the retainable subset is
the declared/analyzable one; protected opaque JS queries sit outside it
by design.

**Schema migration with offline clients.** LLP 0081 owns the shipped
seam (posture-aware handshake; offline outboxes quarantined for
resync-before-replay; no replay through a raised floor) — stronger than
any surveyed peer except PowerSync's schemaless-views trick (client
schema as views over JSON, so schema changes need no client migration;
LLP 0022) and Triplit's compatibility-classified refusals (LLP 0084),
both worth mining. Local execution raises the unowned
schema-at-capture question named in approach 9.

**Live queries and search against local replicas.** Live semantics
transfer to a replica only for the analyzable subset whose membership
the matcher can compute (LLP 0034's `live_delta` lane); opaque queries
would need local re-execution — the embedded-runtime lane again. Search
is stricter: LLP 0073 pins offline search as an explicit nonclaim; the
portable term/position index is itself SQLite tables maintained in the
source mutation's transaction, so a replicated or locally rebuilt index
is conceivable under a future capability id, but live and offline
search are both outside every current claim (LLP 0115 CV-11 owns the
live half; nobody owns the offline half).

**Wire-protocol implications (LLP 0093).** Today's protocol is
connection-scoped: fresh-subscribe reconnect, no client-called resume
across loss, leased server-side outbox drains. A local-first lane needs
at minimum the version-based delta-resume consumer (designed in 0008,
unbuilt), the LLP 0090 token path (shipped, JS arm), the LLP 0043
queue-drain choreography (shipped, Contract arm), and — for approach
9 — a speculative-settlement submission carrying content address plus
captured environment. LLP 0008's standing rules constrain all of it:
wire evolution is additive; app code never owns connection lifecycle.

**The ephemeral/durable lane split.** Snapback's ephemeral lane should
not sync offline, and that is a feature: presence is definitionally
connection-scoped — a disconnected client *has no* presence — and the
lane is already pinned that way ("Presence is never serialized,
hydrated, persisted, restored, or treated as a durable mutation input"
— LLP 0107; hosted nonclaims for retained/durable presence —
LLP 0111). The field muddles this boundary: classic Jazz persisted
cursor twitches into permanent encrypted CRDT history (LLP 0085's
reductio); Convex models presence as durable heartbeat rows
(diary-recorded). The one decisive rerun win (Cursor Garden,
Diary 0039) rides the split. Every option below applies to the durable
lane only.

**Storage and runtime footprint per platform.** Native targets can
carry the full embedded runtime (the darwin-arm64 package's server
binary is ~48 MB plus the Hermes framework — fine for desktop, heavy
but plausible for mobile); browsers cannot, and get the IR/WASM ladder
plus wa-sqlite/IndexedDB stores (proven by Valet and the shipped
`rqs-store.mjs`). Web storage hazards are already codified: quota
degradation to memory, Web-Lock serialized same-origin custody,
fail-closed unparseable durable state (LLP 0008 DK-9). No footprint or
scale numbers exist for any Snapback client store — a measurement gap,
not a design fact.

**Hosted topology.** Server-authoritative lanes compose cleanly with
the hosted shape — one routed machine, one durability owner (LLP 0111,
0099): replicas multiply, authority does not. A CRDT core would demand
multi-master and collide with the entire hosted design. What
local-first adds is read fan-out and resume storms, where Electric's
CDN-cacheable read lane (LLP 0022) and D1-style bookmarks (LLP 0083)
are the copyable prior art, already reserved by 0008 DK-3.

## Option space for Snapback

Options compose; none is chosen. Each carries its evidence-model
consequence per LLP 0115's governing constraint 1.

**Option A — Incremental cache hardening (finish approach 6; absorb
the shipped lanes into the JS/React arm).** Persist the external
store's rows via the existing `rqsStore` seam by default; wire LLP 0043
M1 leases and the M2 outbox into `@snapback/client` and the LLP 0114
hooks; mint `clientMutationId` client-side against the existing
settlement ledger. *Benefit:* closes the diaries' exact GAP rows (cold
retained boot, restart-safe queue, reconnect settlement) on the arm
agents actually score, and beats Convex's measured cold-boot GAP with
machinery that already exists. *Cost:* protected opaque queries stay
non-retainable (LLP 0053); no local execution, so optimistic overlays
stay caller-supplied or IR-derived. *Risk:* low — every piece has an
owner and most have code. *Evidence:* strengthens it (leases, receipts,
capability facts are the design). *Lean:* highest confidence-per-cost
on the board.

**Option B — SQLite replication adoption.** A cr-sqlite/Electric/
PowerSync-class lane: replicate rows into client SQLite and let the app
read it. *Benefit:* arbitrary local reads (eventually search) and
ecosystem familiarity. *Cost:* in raw form it bypasses the
authorized-result unit, egress contract validation, and read-set
capture — the three load-bearing evidence boundaries — and must
reinvent revocation eviction; scoped to declared shapes it converges
back into Snapback's own syncable-live subset, i.e. into option A/C
territory with extra moving parts. *Risk:* the highest
evidence-regression risk here. *Lean:* unattractive as a lane; its one
distinctly valuable piece — the cacheable immutable-offset read lane —
is separable and already a preserved 0008 option.

**Option C — Embedded-runtime rebase (approach 9, staged).** Stage 1:
the LLP 0051 D2 IR evaluator as the local execution tier — browser-
safe, already designed, and it earns honest `Parity` for IR-complete
surfaces under the rule 0043 already enforces. Stage 2: WASM handler
artifacts (D3). Stage 3: the full embedded Rust+Hermes replica on
native targets with speculative journaling and settle-by-re-execution.
*Benefit:* the only lane with a durable structural moat — same-code-
both-sides pinned by content address — plus eventual local search and
true native local-first. *Cost:* the largest program on the board; the
unowned designs in approach 9 (settle-time trust policy,
read-satisfiability artifact, schema-at-capture, speculative receipts)
must each land in an owning document first. *Risk:* scope — this is
exactly the "having to own a lot of stuff" Electric cited when it
retreated; the mitigation is that Snapback's owners already cover most
of that surface. *Evidence:* the strongest extension available —
content-addressed speculative receipts settled by authoritative
re-execution would out-evidence every surveyed peer, in the pattern of
LLP 0116 finding 4. *Lean:* the differentiating long-term bet,
contingent on staging discipline; stage 1 is cheap and independently
valuable.

**Option D — CRDT sidecar for specific data types.** Admit a
merge-typed field or lane (text first) under its own capability id,
keeping the row core rebase-authoritative — the composition the retreat
survivors converged on. *Benefit:* unlocks collaborative text
(LLP 0008's reference app) without re-litigating the core. *Cost:* a
second wire discipline, a GC/compaction story, authorization semantics
for partial text state. *Risk:* moderate; text CRDTs are mature.
*Evidence:* neutral if the lane carries its own claims. *Lean:*
demand-gated — no diary asked for it yet.

**Option E — Explicit-sync minimal lane.** Package what is already
true: a local Snapback is a full-authority local app; add paved
backup/export/restore and say "single-authority" honestly. *Benefit:*
near-zero cost; serves single-user and agent-workspace cases; makes
the local binary's story legible. *Cost:* not sync; must never be
marketed as local-first collaboration. *Evidence:* positive (receipted
backups exist on the hosted profile to copy). *Lean:* do regardless.

**Option F — Do nothing, with honest nonclaims.** Keep `Online` as the
JS-arm truth, keep the nonclaims the diaries praised, and record a
dated decision that local-first is deferred. *Benefit:* zero cost, and
LLP 0084's market finding (offline demand concentrates in mesh
verticals Snapback refuses) gives it a defensible economic reading.
*Cost:* concedes the front on which three diaries said "would not
choose it," contradicts LLP 0074's named differentiator ("retained
local-first execution… claimed only as a graduation path" — which this
option cancels), and wastes the shipped Contract slice. *Risk:*
strategic, not technical. *Lean:* honest but expensive in strategy
terms; if chosen it must be a dated 0074 decision, not a silent lapse.

## Findings

1. **The rerun measured no local-first behavior; the bakeoffs scored it
   as decisive.** Diary 0039's scope excludes it; Diaries 0027/0028/
   0029 recorded offline GAPs as a primary reason not to choose
   Snapback — and recorded the same cold-boot GAP for Convex ("not
   local-first durability across a process/browser restart"). The
   front is open against recorded absence.
2. **The field retreated to Snapback's model.** Two dated first-party
   retreats (Electric 2024, Jazz 2026), Ditto's read-time-derivation
   guidance from inside the CRDT camp, and a five-to-zero count for
   query-scoped state deltas over client-visible event logs (LLP 0022,
   0084, 0085). LLP 0008's pin — server-authoritative rebase,
   LWW-per-field defaults, typed conflicts — is corroborated, not
   contrarian.
3. **Snapback's gap is arm coverage, not design absence — with one
   designed exception.** Retention/replay is shipped on the Contract
   arm (guide `sync.offline`; `Parity` under LLP 0043's proof rule;
   local manifest claims `offline_retention`/`optimistic_replay`)
   while the scored browser arm has none of it; protected *opaque* JS
   queries are non-retainable by design (LLP 0053), which bounds every
   option's reach until that design moves.
4. **The JS client is closer to the Convex warm-session bar than the
   diaries recorded** (code-verified): retained-and-marked rows across
   reconnect, per-layer optimistic rollback from the newest
   authoritative base, effect-free closed-refusal retry, opt-in
   persisted render-first resume. Missing: default persistence, a
   client-held outbox, client-minted mutation identity, any local
   execution.
5. **The embedded-runtime lane is real and unique to Snapback.**
   Closed content-addressed handlers (LLP 0118), an enforced
   deterministic tier, an embeddable binary with sealed per-platform
   packages (LLP 0123), SQLite both sides, and a designed local
   execution tier (LLP 0051) compose into rebase with pinned
   same-code-both-sides — a property Convex, Replicache-class systems,
   and Jazz v2 each lack a piece of. It is native-first; the browser
   gets the IR/WASM ladder.
6. **Authority is the sorting axis.** Rich permissions, meaningful
   revocation, and trusted facts all price out serverless enforcement
   (Ditto's `_id`-only predicates; Jazz's forward-only revocation).
   The lease is the only surveyed retention authority that is signed,
   expiring, and fail-closed; disconnected fail-closed means retained
   data expires to deletion.
7. **Partial replication under authorization is the hard part, and the
   analyzable subset is the natural unit.** Turso proves local SQLite
   alone does not solve it; PowerSync needed a second rule generation;
   Snapback's declared bounded read shapes are simultaneously the
   matcher's, the OCC validator's, and the retainability rule's
   vocabulary — one artifact, three consumers (LLP 0003's build-once
   intent).
8. **The ephemeral lane must not sync, and that is a differentiator.**
   Presence is connection-scoped by definition; Snapback pins it
   (LLP 0107/0111) where classic Jazz persisted cursor history and
   Convex heartbeats durable rows. The one decisive rerun win rides
   this split; local-first machinery applies to the durable lane only.
9. **Migration × offline is owned at the seam, unowned at capture.**
   LLP 0081's quarantine/resync-before-replay covers queued intent;
   schema-at-capture versus schema-at-settle for locally *executed*
   mutations has no owner. PowerSync's schemaless views and Triplit's
   compatibility-classified refusals are minable prior art.
10. **Local-first can extend the evidence model rather than erode
    it.** Speculative-versus-settled receipts, server-signed leases,
    and content-addressed code identity are additive evidence; the
    options that erase boundaries to erase costs (raw replication,
    unbounded caches) reproduce the failure shape LLP 0116 finding 5
    names across the series.
11. **Nothing is measured.** No client-store footprint, resume-storm,
    replica-hydration, or local-execution latency numbers exist in the
    corpus; LLP 0125's burst-path lesson applies verbatim — profile
    before designing performance claims.

## Confidence

High: every diary quotation was read from the cited diary during this
research; the code claims in "What Snapback has today" and the
approach-9 ingredient list were verified against the working tree on
2026-07-30 (`packages/snapback-client/index.mjs`, `external-store.mjs`,
`rqs-store.mjs`, `rqs-store-file.mjs`, `src/storage.rs`,
`src/runtime.rs`, `src/live_wire.rs`, `src/manifest.rs`, `src/main.rs`,
`guide/capabilities.md`, `guide/sync/offline-and-retention.md`); the
owning-document claims (0003, 0008, 0034, 0043, 0051, 0053, 0059,
0073, 0081, 0090, 0093, 0107, 0111, 0112, 0114) were read from the
documents this session.

Medium: the in-repo prior-art claims (LLP 0022, 0082–0085) — verified
primary-source passes, but dated 2026-06/2026-07; this space moves
fast, and 0022's re-verify rule applies before any claim hardens into a
decision.

Low-to-medium: all category-(c) general background. Replicache/Zero,
Linear, cr-sqlite, Couch/Pouch, Figma, and OT history are stated at
contour level from knowledge-cutoff material, unverified against
primary sources here; where a specific number, date, or mechanism
detail would be load-bearing, it is deliberately omitted rather than
risked. Hermes-to-WASM feasibility and mobile embedding of the Rust
host are explicitly unassessed. The option-space leans are structural
arguments, not measurements (finding 11).

## Open questions

1. Which client arm carries the first hardened offline story — extend
   the shipped Contract slice, or land option A on the React/JS arm
   the diaries score and LLP 0074 names as the graduation path?
2. Can protected opaque JS queries ever earn retainability, or is
   retention permanently scoped to declared/analyzable shapes plus
   leases? (LLP 0053's non-shrinkage obligation is the blocker — the
   same diagnosis question as LLP 0119's quarantine sub-question.)
3. What is the settle-time trust policy for client-captured `now` and
   ids under local execution — accept (0008's current replay pin),
   clamp, or flag in the receipt — and which document owns it?
4. What artifact proves a handler's reads are satisfiable from a
   partial replica? Table-granular declarations cannot; are the
   bounded profiles (0080/0110) the admission vocabulary, and does
   that add demand for promoting them beyond experimental (LLP 0120's
   ownership question)?
5. Is the LLP 0051 IR evaluator the permanent browser answer, or does
   a WASM-runtime assessment (size, performance, feasibility) deserve
   a dated spike before the browser story is pinned?
6. Does offline search ride a replicated portable index, a local
   rebuild from replicated rows, or stay a nonclaim — and under what
   capability id, given LLP 0073's explicit offline-search nonclaim?
7. Where does the embedded-runtime design land if pursued — an
   LLP 0051 revival, an LLP 0008/0043 amendment family, or a new owned
   Spec — and does LLP 0115 absorb any of this front (its board has no
   offline item and its frame excluded it), or does it proceed under
   its own sequencing authority?
8. Should "ephemeral state does not sync offline" be pinned as a named
   contract line (an LLP 0013 amendment) rather than an emergent
   property of the current implementations?
9. What triggers option D — is the collaborative rich-text reference
   app still the forcing function LLP 0008 assumed, and who decides
   when it is scheduled?

## Relationship to LLP 0115, the series, and owning documents

LLP 0115 sequences the Convex-parity program; this front sits outside
its frame — the status board (CV-1 through CV-15) contains no offline
or local-first item, the rerun-derived scope excluded the territory,
and the watch items do not name it. If any option graduates to work, it
enters through an author decision with a named owner, as LLP 0125's
remainder did via 0115's open questions — or it proceeds under its own
sequencing authority as a strategic bet (LLP 0074's territory), which
is itself a decision this document does not make.

Owning documents, confirmed this session: **LLP 0008** (Draft) owns the
sync/realtime product model, the replay contract, conflict defaults,
and DK-9's client store; **LLP 0043** (Draft, first slice implemented)
owns retention, the mutation queue, leases-in-custody, and the `Parity`
claim rule; **LLP 0090** (Accepted) owns persisted resume; **LLP 0051**
(Draft) owns local execution (IR, ctx ledger, WASM); **LLP 0053**
(Accepted) owns authorization invalidation and the lease; **LLP 0059**
(Accepted) owns reservations and the authority barrier; **LLP 0003**
(Draft, v0 ratified) owns the storage core and read-set validation;
**LLP 0081** (Implemented, local profile) owns migration × offline
seams; **LLP 0073** owns search claims; **LLP 0034/0093/0094/0095** own
the wire; **LLP 0112/0114/0107** own the React surface and its honesty
rules; **LLP 0013** owns the ephemeral lane; **LLP 0064** owns client
capability classes; **LLP 0074** owns the strategic frame and the
graduation-path claim this document tests. Substantive design for any
option lands in those documents or a new owned Spec, not here.

This document is a companion to the Convex-parity research series:

| LLP | Topic |
| --- | --- |
| 0116 | convex-parity-research-series (overview) |
| 0117 | typescript-type-flow-parity |
| 0118 | handler-composition-and-helper-reuse |
| 0119 | reactive-by-default-and-live-search |
| 0120 | relational-composition-and-aggregation |
| 0121 | transactional-one-off-scheduling |
| 0122 | installed-product-coherence-and-packaging |
| 0123 | runtime-readiness-and-operational-edges |
| 0124 | product-breadth-storage-and-vector-search |
| 0125 | concurrency-and-conflict-ergonomics |
| 0126 | local-first-and-local-sync (this document; series companion) |
