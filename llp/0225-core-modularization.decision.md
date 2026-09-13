# LLP 0225: Core modularization — the consolidated ownership map, commit boundaries, and enforcement arm

**Type:** Decision
**Status:** Active
**Systems:** Rust core, Server, Storage, Migration, Live/realtime, Assets,
Jobs, Auth, Transport, Embedding, Proof/gates, LLP governance
**Author:** Claude (Fable 5), commissioned by Charlie Cheever (author ruling
2026-08-10 in `issues/20260808-core-modularization-decision.md`)
**Date:** 2026-08-10
**Revised:** 2026-08-25 (Active: linked into `llp/foundation/` as part of the
LLP v2 larger kernel)
**Revised:** 2026-08-10 (a — initial draft discharging the commission;
consolidates LLP 0199 with the shipped ownership manifest, the promoted
pre-push gate, and the landed first slice)
**Revised:** 2026-08-10 (b — Draft → Review at llp-super-refine loop start,
the one authorized transition; independent-loop topology)
**Revised:** 2026-08-10 (c — round-1 revision; see Revision history)
**Revised:** 2026-08-10 (d — round-2 revision; see Revision history)
**Revised:** 2026-08-10 (e — post-round-3 closing fixes; **unreviewed** — see
Revision history)
**Revised:** 2026-08-10 (f — round-3 revision under the author's extended
budget; see Revision history)
**Revised:** 2026-08-10 (g — round-4 revision; see Revision history)
**Revised:** 2026-08-10 (h — round-5 revision; see Revision history)
**Revised:** 2026-08-10 (i — closing revision, loop terminal; see Revision
history)
**Revised:** 2026-08-10 (j — Accepted: OQ-A superseded-with-pointer, OQ-B
confirmed, OQ-C inert-until-reload (author rulings); same-landing handoff
applied)
**Revised:** 2026-08-10 (k — §4 migration sequence records the item-3 first
cut: kernel auth authority shapes to the leaf, six frozen kernel→sync edges
inverted)
**Revised:** 2026-08-10 (l — §4 records the items-4/5 first cut: `ServerProfile`
to the contract leaf, twelve frozen edges removed and none added)
**Revised:** 2026-08-11 (m — §4 records the item-3 second cut: `session_projection`
value shapes to the leaf; the remaining item-3 edges raised as an ownership question)
**Revised:** 2026-08-11 (r — §4 records item-3 stage A3: the sender-proof
direction inverted through typed kernel operations, the first worked example of
the §2 inversion the ruling asks for)
**Revised:** 2026-08-11 (s — §4 records item-3 stage A2: the provider session
lifecycle inverted to typed kernel operations; item 3 closed)
**Revised:** 2026-08-11 (q — §4 records item-3 stage A1: the provider plan and
deployment-profile shapes down, two kernel→sync edges inverted)
**Revised:** 2026-08-11 (p — §4 records the OQ-C inert-until-reload recovery
slice and its full-`LocalSnapback` acceptance; the recorded reopen exception
is discharged)
**Revised:** 2026-08-10 (l — merge-wave reconciliation of the §5 enforcement
landing; see Revision history)
**Revised:** 2026-08-11 (o — §4 records the rqs contract-leaf repoint: sixteen
frozen edges removed by naming the leaf a re-export already resolved to)
**Revised:** 2026-08-11 (n — §4 rules the item-3 remainder: the split runs
through `crates/snapback/src/auth/provider.rs`, not `crates/snapback/src/storage/auth_catalog_ops.rs`; see
Revision history)
**Revised:** 2026-08-13 (t — LLP 0232 optimistic-landing alignment: the
ownership gate remains unconditionally selected and runs in strict mode and
the scheduled backstop; ordinary pre-push execution is deferred)
**Revised:** 2026-08-15 (u — raw-dev stream-transcript activation joins the
function-generation transaction; the recorded split-cut exception is
discharged; see Revision history)
**Revised:** 2026-08-16 (v — §5 enforcement mechanics add joint
tracking-ticket coverage and operational hardening; the rejected
owner-reassignment re-key mechanic remains in needs-design)
**Revised:** 2026-08-19 (w — LLP 0276 Phase 3 amendment pointer: §2's
dependency direction and §3 commit boundaries remain authoritative; §5's
module analyzer, manifest/baseline projection, ratchet, and projection
amendment point are superseded by the crate workspace graph and LLP 0276)
**Revised:** 2026-08-19 (x — LLP 0283 F-5 schema-export ownership move:
schema registrations now live beside their carrier owners and rank-7
`snapback-tools` performs the downward-only registry assembly and generation)
**Revised:** 2026-08-19 (y — LLP 0283 F-5 telemetry-proof ownership move:
rank-7 `snapback-tools` owns the cross-rank proof composition while storage
and HTTP details remain behind their lower-owner observation ports)
**Revised:** 2026-08-19 (z — LLP 0283 F-5 fork-promotion recorder move:
rank-7 `snapback-tools` owns the benchmark and preserves the facade's exact
compile-time source-identity contract)
**Revised:** 2026-08-20 (aa — LLP 0285 step 8 / LLP 0290 room-authority
ownership move: the kernel owns database-bound authorization settlement and
finite permits; sync retains queues, subscriber policy, resync materialization,
and transport handoff)
**Revised:** 2026-08-22 (ab — §3 records the bounded commit capsule's
database-bound final-cut authority and exact-row witness)
**Revised:** 2026-08-22 (ac — §3 hardens the capsule's complete AppState
destination, restricted Local capability, typed intent identity, and one-shot
final cut; the inherited authority/publication seam remains open)
**Revised:** 2026-08-22 (ad — §3 narrows the capsule claims to the literal
same-AppState substitution and one-shot ordering actually enforced; independent
construction origin, open pending adapters, captured commit authority, and
same-ID intent replay are recorded as latent fix-forward residuals)
**Revised:** 2026-08-23 (ae — §3 records the capsule's independent
construction-origin seal; open pending adapters, captured commit authority,
same-ID intent replay, and PreparedAuthority publication substitution remain)
**Revised:** 2026-08-25 (af — §3 records authority-derived exact-row intent
instances; same-ID semantic replay through reconciliation is closed while the
other capsule residuals remain)
**Revised:** 2026-08-25 (ag — §3 corrects F220 from caller-intent verification
to an authority-minted, move-consumed producer/expectation correlation)
**Revised:** 2026-08-25 (ah — §3 removes the prototype reconciler's detached
raw-intent consumer; its query subject now comes from the intended-row carrier)
**Related:** LLP 0199 (accepted incremental core-modularization Decision this
consolidates), LLP 0000 (root explainer — load-bearing invariants), LLP 0038
(July whole-system review; first `local.rs` god-object finding), LLP 0059
(single-writer locking and linearization), LLP 0080 (projection
materialization oracle), LLP 0081 (migration execution journaling and crash
recovery), LLP 0141 (embeddable Rust library / `snapback::embed` façade),
LLP 0189 (verification cadence and claim gating), LLP 0175 (local-proof
selection), `issues/20260808-core-modularization-decision.md` (commission),
`issues/closed/20260809-ownership-gate-prepush-tier.md` (enforcement-arm
ruling), `issues/closed/20260809-0199-ownership-ratchet-worklist.md` (frozen-edge
burn-down), `issues/closed/20260810-ownership-gate-analyzer-gaps.md`
(analyzer/enforcement completion), LLP 0285 (kernel authorization closure),
LLP 0290 (accepted database-bound authorization commit participant and sync
outbox split)

## Context and relationship to LLP 0199

**LLP 0276 Phase 3 amendment.** The historical module-level enforcement arm
described below retired after the checked flip predicate passed. The live
machine projection of §2 is now `crates/allowed-dependencies.v1.json`, enforced
by `scripts/check-workspace-graph.mjs`; future owner/rank/edge amendments route
through LLP 0276. This Decision remains authoritative for the dependency
direction and §3 commit semantics. Historical analyzer mechanics below are
retained as provenance, not live protocol.

The 2026-08-08 full-repository review commissioned an architecture Decision
choosing incremental boundary extraction over a rewrite
(`issues/20260808-core-modularization-decision.md`); the author approved the
commission in full on 2026-08-10, with one addition: the structural check
lands **with** the first slice, not after. LLP 0199 — drafted the same day the
commission opened, super-refined to dual-family READY, and **Accepted**
2026-08-08 with OQ1–OQ5 ruled — is that Decision's first record, and nothing
here overturns it.

What has changed since 0199's acceptance is that its abstractions became
concrete repository objects, and the Decision's normative content now lives
partly in prose (0199), partly in machine state (`ownership.manifest.json`,
`ownership.baseline.json`), and partly in issue rulings (the pre-push tier).
This document consolidates all three into one governing record:

- the **ownership manifest** exists, with seven owner ids and a full
  assignment of every `crates/snapback/src/**/*.rs` module (62+ modules at seeding, grown
  since);
- the **structural check** (`scripts/check-module-ownership.mjs`) is a
  registered drift-prone gate and, per the 2026-08-10 ruling closing
  `issues/20260809-ownership-gate-prepush-tier.md`, a member of the validated
  `driftAlwaysRunGates` tier — it is **selected on every push with commits**,
  runs synchronously under explicit strict mode and under the scheduled
  backstop, and is listed in `driftFailClosedCoreGates`;
- the **first slice — generation activation — is extracted and landed**
  (`crates/snapback/src/generation_activation.rs`, with the OQ3 composite-commit follow-up of
  2026-08-09 recorded in 0199's revision history).

Accepted 2026-08-10: this Decision becomes the **single amendment point** for the
ownership map and dependency direction (§6), and the author disposes of 0199
— the recommended disposition is Superseded-with-pointer, keeping 0199 as the
acceptance/provenance record (its OQ rulings and super-refine history remain
true statements about how the decision was made). That disposition is OQ-A,
not decided here.

## Decision

**Snapback modularizes by incremental owner extraction inside the existing
system, under the seven-owner map below, with dependency direction and commit
authority as stated, enforced by the always-selected module-ownership gate in
explicit strict pushes and the scheduled drift backstop. There is no rewrite,
no second implementation, and no flag-day.**

All extraction preserves the root LLP's load-bearing invariants: server
authority; SQLite single-writer correctness (LLP 0059); bounded handler
execution; language-neutral wire contracts held by the conformance corpus;
explicit per-target capability honesty. Behavior across each slice is held by
the existing proof (LLP 0189 cadence) plus a characterization-test envelope
written per slice.

## 1. Ownership map

The commission names six owners; the shipped manifest carries **seven**,
because commission owner #1 ("manifest / generation-activation coordinator")
splits along a real seam that 0199's Sequencing already identified: the
language-neutral *types* go to a dependency-free contract leaf, and the
activation *behavior* is the coordinator. The manifest's owner ids are the
canonical vocabulary; prose and `@ref`s should use them.

| # | Commission owner | Manifest owner id | Layer (rank) | Charter |
| --- | --- | --- | --- | --- |
| 0 | (implied by #1) | `shared-contract-types-leaf` | contract-leaf (0) | Language-neutral schema, wire, id/value, and generation types. Dependency-free; the single canonical source. Rust owners consume it as code; Cloudflare and other target-local implementations bind the generated artifacts (schemas, wire fixtures) produced from it, never the Rust modules. |
| 1 | Manifest / generation-activation coordinator | `generation-activation-coordinator` | domain-service (2) | Composes a complete successor generation (manifest + projections + sequences + auth/capability side effects) and installs it as one atomic transition via kernel commits. Owns composition and the atomicity guarantee, not the commit primitive. |
| 2 | Storage and migration kernel | `storage-migration-kernel` | kernel (1) | Owns SQLite transactions (the only commit primitive), schema lineage, rollback artifacts persisted at admission, cleanup, durability, and the database-bound room-authority registry: authorization reservations, transaction binding, known-commit settlement, finite room/publication permits, and level-triggered reauthorization obligations. Callers receive typed operations, not a wide `LocalDatabase` surface. |
| 3 | Durable sync and realtime engine | `sync-realtime-engine` | domain-service (2) | Subscriptions, version streams, sync-private outbox queues and leases, subscriber policy, reauthorization materialization, transport handoff, invalidation, and fan-out — independent of HTTP handlers. It does not own authorization-commit settlement. |
| 4 | Background/application services | `background-services` | domain-service (2) | Assets, jobs, push, forks, telemetry, replication. CPU/network preparation happens **outside** the global writer; results enter the kernel through narrow typed commit operations. |
| 5 | Transport adapters | `transport-adapters` | adapter (3) | Local Axum, CLI, admin, hosted edge, bin harnesses. Compose the domain owners; never re-implement serving gates or wire shapes. Cloudflare is a target-local implementation sharing the *contract*, not code. |
| 6 | Supported embedding façade | `embed-facade` | adapter (3) | `snapback::embed` + `crates/snapback/src/lib.rs` (LLP 0141). Preserves the embed contract while internals become genuinely private, not merely `#[doc(hidden)]`, where the source-compatibility policy permits. |
| — | — | `unassigned` | bookkeeping (—) | Not an owner. Holds the god-file residue (`crates/snapback/src/local.rs` and its acceptance/test companions) until slices place it. May not be named as an allowed dependency, and unassigned modules may not add new edges into an unassigned god-file. |

Two manifest refinements are part of this map, not workarounds of it:

- **`mixedModuleScopes`** — a file the analyzer must treat as one owner can
  declare its true multi-owner interior. `crates/snapback/src/local.rs` declares its
  generation-activation scope (owner 1, extracted) against its unassigned
  remainder; `crates/snapback/src/manifest.rs` declares its contract-leaf types (assigned)
  against its subsystem-coupled residue (identity, vector, push, assets,
  auth) pending extraction to the owning services.
- **`uncertainAssignments`** — provisional placements carry a substantive
  note (e.g. `crates/snapback/src/auth/lifecycle.rs` sits with background services but its
  activation ordering may migrate to owner 1; `crates/snapback/src/runtime.rs` sits with
  transport but a dedicated execution owner could claim it). These are
  invitations to re-decide at the owning slice, not licenses to ignore the
  gate.

**LLP 0285 step-8 split (2026-08-20).** `snapback-kernel` owns the
database-bound `AuthorizationCommitParticipant`, exact pending/bound/ready
database handshake, protected-room registry core, reservation bind, rollback
and ambiguity custody, known-commit finalization, committed-outcome evidence,
and room/durable publication permits. `snapback-sync` retains `SharedOutbox`,
`OutboundQueue`, drain leases, connection-effect matching, subscriber
resolution, resync frame construction, notifier wakeups, and final transport
handoff. This is an ownership move within the existing rank-1/rank-2 edge; it
adds no upward kernel dependency and does not change the workspace rank map.

The declared `godFiles` are `crates/snapback/src/local.rs`, `crates/snapback/src/server.rs`, `crates/snapback/src/storage.rs`
— the modules whose *drainage* is the program's purpose. The no-growth rule,
operationally: once a domain has an extracted owner module (a "chosen"
domain — generation activation today; each §4 slice adds more), new feature
logic for that domain lands behind its owner, not in a god file; what may
still land in a god file is composition/adapter glue that invokes the owner,
mechanical relocations, and edits to code not yet claimed by any slice. The
gate cannot measure "growth" — review does, recorded the way baseline growth
already is: a landing that adds substantive domain logic to a god file for a
chosen domain names that choice in the ratchet worklist, where it is visible
for burn-down rather than silently accreted.

## 2. Dependency direction

Direction points **downward** and is total across layers:

```
adapters (rank 3):        transport-adapters, embed-facade
domain services (rank 2): generation-activation-coordinator,
                          sync-realtime-engine, background-services
kernel (rank 1):          storage-migration-kernel
contract leaf (rank 0):   shared-contract-types-leaf
```

Normative rules, exactly as encoded in `ownership.manifest.json`
(`allowedDependencies`, validated so every allowed edge strictly decreases
rank):

- **Adapters** (5, 6) may depend on any domain service, the kernel, and the
  leaf.
- **Domain services** (1, 3, 4) may depend only on the kernel and the leaf —
  **not on each other**. Cross-service *orchestration* happens above them: an
  adapter (or a future explicitly-declared higher-layer coordinator) invokes
  each service. What sits below them is inert: the leaf may hold shared
  input/event *shapes*, and a kernel operation may atomically persist
  already-composed typed intent — but neither the leaf nor the kernel owns
  domain policy or invokes service behavior. A service that needs another
  service's behavior goes up, never sideways or down.
- **The kernel** (2) may depend only on the leaf. The kernel never calls up
  into a domain service; where today's code does (the `with_auth_*`
  escape-hatch shape), callers pass typed inputs down instead.
- **The leaf** (0) depends on nothing in the crate.
- **`unassigned`** confers no dependency rights and cannot be depended upon
  by name.

Pre-existing violations are **frozen, not blessed**: `ownership.baseline.json`
ratchets the graph at each landing, the gate blocks only *new* forbidden
edges, and `issues/closed/20260809-0199-ownership-ratchet-worklist.md` is the
standing burn-down of the grandfathered upward edges (kernel→background job
helpers, kernel→sync auth call-ups, leaf residues, and their recorded
growth). Inversions ride the owner slices that touch the same code.

**Baseline updates are monotonic, and provenance decides what may be
frozen.** A baseline re-freeze may *remove* forbidden-edge exceptions, and
may re-key or newly record a **proven pre-existing** edge — one that existed
before the landing and became visible through analyzer improvement or module
relocation — with provenance stated. **Genuinely new forbidden coupling is
never freezable by note**: it is fixed before the re-baseline, or it carries
an explicit **time-bounded waiver** — a worklist entry naming the edge, the
inversion owner, and a deadline, referenced from this Decision's amendment
record — matching LLP 0199 OQ5's accepted blocking rule. (The 2026-08-10
`crates/snapback/src/local.rs → crates/snapback/src/connected_clients.rs` freeze predates this rule and is
reclassified as such a waiver — its formal record is worklist item 8 in
`issues/closed/20260809-0199-ownership-ratchet-worklist.md`, naming the edge, the
inversion owner, and the bound; the parenthetical you are reading is a
pointer, not the waiver.) The gate is required to
enforce the comparison against the predecessor baseline at the push's
merge-base and refuse silent growth
(`issues/closed/20260810-ownership-gate-analyzer-gaps.md` records the shipped
implementation). An unrecorded baseline growth is a violation of this
Decision and is refused by both normal checks and `--update-baseline`.

## 3. Transaction and commit boundaries — who may commit what

This section states the commit authority the extraction exists to create; it
incorporates 0199's OQ3 ruling and the implemented 2026-08-09 follow-up.

1. **Only the storage/migration kernel owns SQLite transactions in the
   canonical application/auth/schema store.** The rule's scope is the
   store behind the global writer (LLP 0059); independently governed
   owner-local sidecar stores — today telemetry's sibling database (LLP
   0154), which deliberately opens its own connection and transactions —
   remain their owner's, and may never join or imply application
   atomicity claims. Within the canonical store there is one durable
   writer and one commit primitive; every other owner
   commits by *composing* typed kernel operations
   (`CommitFunctionGeneration`, the classified mode-deployment commits, the
   `*_in_tx` families as they relocate into `crates/snapback/src/storage/`), never by opening
   its own transaction against the store.
   A cross-crate bounded commit capsule may carry a typed pending transaction.
   Its production watch adapter compares an opaque authority with the pending
   transaction's database before COMMIT, and its closure parameter no longer
   exposes unrestricted `LocalSnapback`. Those are useful checks, not a sealed
   capability boundary: `PendingCommit` is an open `pub(crate)` trait with no
   database or operation identity, composition APIs expose cloneable commit
   authority, and Rust closures may capture that authority and reach the public
   watch staging/commit pair without `FinalCommitCut`. The exact-row witness is
   kernel-minted and retains an opaque database-producer plus canonical
   intended-row fingerprint. It exposes no combinator that can preserve that
   carrier while replacing its contents. The final cut derives the matching
   intent instance from its already-bound database authority instead of
   accepting a raw intent at witness consumption. Caller-constructible
   operation identifiers remain idempotency lookup keys, not reconciliation
   correlation. Every final-cut exit also records a one-shot disposition.

   The AppState construction root now closes that destination-origin splice.
   Its one-shot engine claim carries an opaque identity minted by the exact
   `LocalSnapback`; the inner constructor compares it while holding the
   supplied SharedSnapback, before minting one private runtime binding that
   retains the exact database graph, admission controller, graph identity, and
   commit authority. `CommitCapsuleDestination::bind` consumes that binding,
   and watch staging derives its prepared-authority view from the capsule's
   reservation instead of a separately cloned authority. The adversarial test
   has complementary copied-database and in-memory cases: one gives distinct
   process graphs A and B identical durable incarnation text, while the other
   gives them the same absent database-path identity. Both supply preclaimed A
   with SharedSnapback B and observe refusal before B is claimed; neutralizing
   only the opaque identity comparison makes the test accept
   `{state B, admission A, authority A}` and fail.

   This seals only construction of the capsule destination: no production
   AppState constructor can assemble admission graph A with database/commit
   graph B. It does not freeze the `LocalSnapback` inside the shared mutex
   afterwards, so replacing that referent still re-aliases the pairing; the
   kernel's commit-authority check is what refuses the result today. That
   post-construction path is tracked as a residual.
   It does not seal the open `PendingCommit` adapter, prevent closure capture
   of cloneable commit authority, or close `PreparedAuthority` publication
   substitution. Those remain in
   `issues/shelved/20260822-capsule-structural-residuals.md` and
   `issues/shelved/20260822-authority-publication-binding-design.md`.
2. **The generation-activation coordinator owns the atomic transition, not
   the transaction.** The minimum atomic set — the manifest/generation
   record, projection digest pins, sequence installs/enrollment, and auth
   publication — becomes authoritative only in the kernel transaction that
   also persists the owning generation fact (complete-pair mode transaction,
   or raw-dev's `function_generation` record with sequence enrollment). No
   projection digest, sequence install, or auth publication may commit
   independently of that install. Later slices may *add* state to the atomic
   set by amending this Decision; they may not weaken it.
3. **The single crash-recovery authority is the persisted generation
   record.** Never an in-memory handle, never the process-local fence — the
   P0's lesson. The coordinator installs the process generation marker only
   after a classified committed verdict; recovery on reopen reads only what
   the durable cut committed. Post-commit effects (process fence, ephemeral
   publication, successor composition, route validation, cache effects, the
   same-incarnation issuer expectation projection and direct kernel
   room-authority finalization) are the recorded
   transaction-domain exceptions and occur only after commit; each future
   exception must be recorded per slice, with the digest-clearing kernel
   helper retained solely as the explicit escape hatch for a path that
   *proves* it cannot share the owning transaction (none does today).
4. **The kernel owns migration durable state.** Rollback artifacts are
   persisted at admission (predecessor bytes), not reconstructed from live
   `self.schema`; lineage, journaling, and crash recovery follow LLP 0081.
5. **The sync/realtime engine commits nothing generation-coupled on its
   own.** Authorization-commit settlement and its durable/projected authority
   facts are kernel-owned. Sync owns queue leasing, subscriber resolution,
   resync materialization, transport handoff, ordering, and fan-out; durable
   invalidation cursors and version-stream state go through typed kernel
   operations.
6. **Background services never hold the global writer across CPU or network
   work.** Asset transcode/hashing, job execution, push fan-out, and fork
   preparation happen outside the writer; only their narrow commit operations
   enter the kernel.
7. **Transport adapters and the embed façade never commit directly.** They
   invoke domain owners. They also never independently re-create serving
   gates or wire shapes: the local adapter and CLI compose the Rust owners;
   Cloudflare binds the generated language-neutral artifacts produced from
   the contract leaf (this is the structural answer to the `alarm()` /
   `webSocketMessage` gate-bypass class of defect).

## 4. Migration sequence

### First slice — generation activation (executed)

The first slice is **generation activation**, as ruled, and it has landed:
`crates/snapback/src/generation_activation.rs` is a ~260-line coordinator owned by
`generation-activation-coordinator`, deliberately *not* a second storage
implementation. The extraction boundary, concretely:

- `GenerationActivation::activate_functions` owns the
  materialize → composite-kernel-commit → post-install ordering for a
  function generation: projection publications are materialized as pending
  physical rows, then their pins join the generation record in one
  `commit_function_generation` kernel transaction, then sequences, ephemeral
  publication, successor composition, the process fence, and post-install
  validation follow in the preserved legacy observable order.
- `GenerationActivation::activate_same_mode_network_generation` owns the
  complete-pair cut via the kernel's classified
  `apply_same_mode_network_deployment_with_functions_classified`
  (`Committed` / `RolledBack` / `Uncertain`), materializing before the
  commit only when the current physical schema is already the successor
  input, and otherwise letting the kernel materialize after DDL/seed inside
  the same composite transaction.
- The process generation marker installs only from a committed verdict; the
  P1-era clear-digest compensation has **no activation callers**.
- The callers in `crates/snapback/src/local.rs` shrank to composition calls; the remainder of
  `local.rs` stays `unassigned` with its activation scope recorded in
  `mixedModuleScopes` until later slices drain it.

**Honest boundary disposition.** The first slice was *behavior* extraction,
not yet a direction-clean boundary: the coordinator itself carries two frozen
forbidden edges — `→ crates/snapback/src/auth/admission.rs` (it imports the
`ModeCommitFailure` commit-verdict type from a sync-engine module; inversion:
the verdict type belongs in the contract leaf) and `→ crates/snapback/src/local.rs` (it holds
the god-file handle directly; inversion: a coordinator-owned narrow port
implemented above the service). The verdict-type edge inverts at the
contract-leaf completion slice; the port edge inverts at the `local.rs`
drainage slices. Both are pre-existing-pattern edges frozen in the baseline;
neither is a
license for new sideways coupling.

**Raw-dev cut exceptions — discharged 2026-08-15.** The two code-verified
gaps formerly tracked in
`issues/closed/20260810-raw-dev-activation-split-cut-and-reopen-inertness.md`
are both closed. Revision (p) discharged reopen inertness through the ruled
inert-until-reload state machine. Revision (u) folds stream-transcript catalog
activation into `commit_function_generation`'s immediate transaction, using
the schema-plus-function union when D5 ask is active. An injected malformed
catalog now rolls back transcript DDL, projection pins, sequence enrollment,
and the generation record together; after repair, retry commits generation
high-water 1. Exact reopen rehydration first checks that the catalog matches
the durable manifest. A legacy split state therefore takes the composite
successor path rather than silently resolving the fence, while a failure
leaves the persisted predecessor as the recovery authority. There is no
remaining raw-dev §3 exception.

**Characterization-test envelope** (the slice's acceptance, held in the local
proof's activation/storage tests and binding on any future change to this
boundary):

- *Failed-activation-then-retry:* after an injected commit failure, the
  rollback tests hold that transcript activation, pins, enrollments, and the
  generation record agree exactly with what physically committed; the
  repaired retry converges at the first generation high-water.
- *Crash/reopen:* the persisted generation record is the sole recovery
  authority — never the process fence or an in-memory schema; the landed
  tests prove kernel-level reopen against it (complete-pair and raw-dev
  record paths) and revision (p)'s full-process inert-until-reload contract;
  raw-dev content digests and the monotonic durable high-water stay boot-safe
  across a process-counter reset.
- *Atomicity:* no path commits a projection digest pin, sequence install,
  stream-transcript catalog activation, or auth publication outside the
  owning generation transaction.
- *Surface freeze:* no public wire or embedding API change; the legacy
  observable diagnostic ordering is preserved exactly.

Per the 2026-08-10 commission ruling, the structural check landed **with**
this slice's program (the manifest/gate seeding and the unconditional
pre-push promotion both predate this document), not after it.

### Second slice — the generation-commit kernel primitive (executed)

The first §4-item-1 kernel typed-operation slice landed 2026-08-10: the
composite generation-commit family moved out of `crates/snapback/src/storage.rs` into the
dedicated kernel module `crates/snapback/src/storage/generation_commit.rs`
(`CommitFunctionGeneration`, `FunctionGenerationRecord`,
`commit_function_generation`, `function_generation_record`,
`install_committed_sequence_declarations`, and the sequence-predecessor
helper — the two commit-path methods narrowed to `pub(super)`), and the
activation coordinator's database access narrowed from the wide
`&mut LocalDatabase` accessor (`generation_database_mut`, deleted) to the
typed `GenerationCommitOps` view exposing exactly the six operations owner
#1 composes: the composite commit, the classified same-mode deployment
commit, the committed-sequence install, stream-transcript manifest
activation, stale-projection materialization, and the schema read. Behavior,
diagnostic ordering, and the public surface are unchanged; the §3
commit-boundary contract is unaffected (this is surface narrowing, not a
transaction-domain change).

Baseline disposition, per §2's monotonic rule: one relocation re-key with
provenance — `crates/snapback/src/local.rs → crates/snapback/src/storage/generation_commit.rs`
(unassigned→kernel), the commit-primitive portion of the frozen
`crates/snapback/src/local.rs → crates/snapback/src/storage.rs` coupling following the moved code — recorded
in the ratchet worklist; the slice's other new edges are allowed downward
edges. The same landing carried the unmanifested-module catch-up for the
2026-08-10 auth-floor landing (`crates/snapback/src/auth/identity_core.rs` → contract leaf,
`crates/snapback/src/storage/auth_identity.rs` → kernel; allowed edges only).

### Owner-#5 seam slice — the server writer gate (executed)

Landed 2026-08-10, same day as the second slice: the global-writer
acquisition family moved out of the `crates/snapback/src/server.rs` god file into the
dedicated transport-owned module `crates/snapback/src/server/writer_gate.rs` —
`with_snapback`, `with_snapback_then`, `lock_managed_snapback`,
`with_snapback_authorization_write`,
`with_snapback_staged_authorization_write`,
`with_snapback_stream_reset_admission_effect`, and the lock-free
`with_read_lane`, with their private turn/reservation types. Call sites are
unchanged (re-exported); implementation bytes are unchanged; no
locking-order or behavior change. The seam's contract is now stated in one
place: every serving path that can reach Hermes eval or rusqlite acquires
the writer through this gate (or the read lane), and CPU/network
preparation belongs outside the guard (§3.6) — the prerequisite for the
deferred asset render/canonicalize-outside-the-writer move recorded in
`issues/shelved/20260808-assets-finalize-memory-and-cpu-under-global-lock.md`.

Baseline disposition: one **time-bounded waiver** (§2) —
`crates/snapback/src/server/writer_gate.rs → crates/snapback/src/local.rs` (transport→unassigned), the
pre-existing `LocalSnapback` coupling following the moved code while the
predecessor `crates/snapback/src/server.rs → crates/snapback/src/local.rs` edge is retained by remaining
references. This is an edge-key *split*, which the arm's strict `relocation`
disposition cannot express
(`issues/closed/20260810-owngate-split-relocation-disposition-gap.md` routes the
vocabulary gap to the enforcement lane); the waiver record with inversion
owner `transport-adapters` and deadline 2026-09-15 lives in the ratchet
worklist, and the coupling drains with the `local.rs` remainder. The
would-be second split (`auth/coordinator → writer_gate` via the re-export
chain) was avoided structurally: `with_snapback` remains a delegating
`server.rs` item so the frozen item-4 edge keeps its key until that
inversion lands. The module's other new edges are allowed downward edges.

### Item-3 first cut — kernel auth authority shapes to the leaf (executed)

Landed 2026-08-10: the first cut of ratchet worklist item 3
(`kernel→sync/auth-core ×~24`) under continuing-sequence item 1, scoped by
`issues/20260810-owner2-kernel-auth-authority-shapes-slice.md`. Item 3's edges
are not one shape — some kernel files import auth **value shapes** from
sync-owned modules, others genuinely **call up** into sync behavior
(`lookup_presented_session`, `planned_family_alarm_transaction`,
`presented_token_has_sender_family_binding` — the `with_auth_*` escape-hatch
shape). Only the first family is in this cut; the call-ups need typed kernel
operations and ride a later slice.

The move follows the pattern worklist item 7 established for
`auth/descriptor.rs` — **the shape goes down, the behavior that consumes
non-leaf state stays up**, as a same-crate inherent `impl` block on the
relocated type:

- the step-up proof shapes (`StepUpProof`, `StepUpConsumption`,
  `step_up_required_error`) moved to the leaf-owned `crates/snapback/src/auth/crypto.rs`,
  whose module already defines every field type they carry, while
  `impl StepUpProof { reconcile_consumed_on, reconcile_unconsumed_on,
  consume_on }` stayed in `crates/snapback/src/auth/provider.rs` — those take a `&Connection`
  and are behavior, not shape;
- the service-authority fence value shapes (`ServiceAuthorityDisposition`,
  `ServiceAuthorityWitness`, `ServiceAuthorityActResolution`,
  `ServiceAuthorityDeadlineTerminal`) moved to the new leaf module
  `crates/snapback/src/auth/service_authority_contract.rs`, while the fence traits,
  publication, permits, terminal gate, and registry stayed in
  `crates/snapback/src/auth/service_fence.rs`.

Six frozen kernel→sync edges inverted:
`storage/auth_agent_credentials → auth/service_fence`,
`storage/auth_agents → auth/{provider,service_fence}`,
`storage/auth_grants → auth/{provider,service_fence}`, and
`storage/pending_effects → auth/provider`. `storage/auth.rs →
auth/service_fence` deliberately **stays** — it imports the two retained fence
traits, and inverts when prepared-terminal custody becomes a typed kernel
operation.

One structural decision earned the clean result:
`ServiceAuthorityWitness::from_resolved` became
`ResolvedScopedToken::service_authority_witness` in
`crates/snapback/src/storage/auth_agent_credentials.rs`, where `ResolvedScopedToken` is
defined. The kernel owning the conversion from its own token type into a leaf
shape is kernel→leaf; more importantly, callers now project the witness *by
method* rather than naming the leaf module, which keeps `crates/snapback/src/local/tests.rs`
off the new module entirely and avoids a second edge-key split.

Baseline disposition: 7 frozen forbidden edges removed, 1 added — 388 → 382.
The addition is `crates/snapback/src/local.rs → crates/snapback/src/auth/service_authority_contract.rs`, a
**downward re-key** of the `crates/snapback/src/local.rs → crates/snapback/src/auth/service_fence.rs` edge the
same landing removes (local.rs genuinely matches on the resolution and
disposition enums). It is recorded as a time-bounded waiver with inversion
owner `transport-adapters` and deadline 2026-09-15 because the re-key changes
both target module and target owner, while `relocation` requires the
predecessor owner pair. The vocabulary gap
remains open in
`issues/closed/20260810-owngate-split-relocation-disposition-gap.md`, with the
sound-evidence design follow-up at
`issues/closed/20260816-split-relocation-disposition-needs-sound-evidence.md`. The
prose here
carries the true disposition; the coupling drains with `local.rs`.

Characterization envelope: pure relocation, so the claim is behavioral
identity rather than new tests — the `auth`, `storage`, and `server` lib-test
subsets returned failure sets **byte-identical** to the merge-base at
`3d1553975` (56, 50, and 24 pre-existing named failures respectively), with
`cargo build --all-targets` and `./ref-check --verbose` green.

Two lint gates are red on main independently of this slice, both filed rather
than absorbed: the clippy gate fails in the untouched auth identity floor
(`issues/20260810-main-red-clippy-auth-identity-floor.md`), and `cargo fmt
--all` is **not** idempotent on main under rustfmt 1.9.0 — running it rewrites
~400 lines across a dozen modules this slice never touches
(`issues/20260810-main-rustfmt-drift-under-1-9-0.md`). This landing therefore
deliberately does not carry a repo-wide reformat; its own edits are kept in
the surrounding style by hand. A relocation slice that reformats every file it
passes through would make exactly the kind of review-opaque diff §6 warns
about.

### Items-4/5 first cut — `ServerProfile` to the contract leaf (executed)

Landed 2026-08-10, immediately after the item-3 first cut and reusing its
shape-down/behavior-up pattern; scoped by
`issues/20260810-worklist-items-4-5-server-profile-leaf.md`.

Ratchet items 4 (`sync→transport ×4`) and 5 (`kernel→transport ×8`) read as two
families, but **six of those twelve edges crossed on one type**:
`crate::admin::ServerProfile`, a four-variant deployment-posture enum
(`Dev`/`Demo`/`Test`/`Prod`) with no serde derive and no generated-artifact
exposure. Transport owning the environment vocabulary that the kernel and the
sync engine must both consult is precisely the inversion those items describe.

The enum and its two pure methods (`as_str`, `allows_provisioning`) moved to
`crates/snapback/src/contract_types.rs`; `for_bind_ip` stayed in `crates/snapback/src/admin.rs` as an inherent
impl block because it resolves `SNAPBACK_PROFILE` against the bind address —
transport behavior, not shape. `admin.rs` keeps a `pub use` so the public
`snapback::admin::ServerProfile` path (`pub mod admin` in `lib.rs`) is
unchanged; internal callers were repointed at the leaf so the edges genuinely
re-key instead of resolving through the re-export.

**12 frozen forbidden edges removed, none added — 382 → 370.** The cut reached
twice its scoped six because `ServerProfile` was the *sole* admin import of six
further modules: `crates/snapback/src/auth/rehearsal.rs` and `crates/snapback/src/data_patch.rs`
(**leaf→transport**, the direction §2 forbids most emphatically — the leaf is
supposed to depend on nothing), `crates/snapback/src/local.rs`, `crates/snapback/src/local/tests.rs`, and
`crates/snapback/src/local/authorization_acceptance.rs` (unassigned→transport), and
`crates/snapback/src/push.rs` (background→transport). It also retires the kernel→transport half
of ratchet waiver item 9 one day before that waiver's 2026-08-11 deadline.

Baseline growth: **none**, and no disposition was needed. `contract_types.rs`
was chosen on charter grounds — a language-neutral posture vocabulary is what
the leaf is for — and only then checked against the graph, where it happened to
be the one leaf module every consumer (including all four unassigned residues)
already depended on. Had the charter pointed elsewhere, the waiver would have
been the honest answer rather than a destination chosen to dodge the record.

Characterization envelope: pure relocation, so behavioral identity is the
claim — the `admin`, `auth`, `storage`, and `server` lib-test subsets returned
failure **name sets** byte-identical to the merge-base `ca86e671c` (2, 56, 50,
and 24 pre-existing failures), with `cargo build --all-targets` and
`./ref-check --verbose` green, and no repo-wide reformat (see the item-3 entry
for why `cargo fmt --all` is not safe on main today).

Still open in items 4-5: `proof_checkpoint → admin` and `store_state → admin`
(both import other admin items), the `store_state → auth/{lifecycle,runtime}`
composition edges, and `storage/hosted_admission → auth/hosted_edge`.

### Item-3 second cut — `session_projection` value shapes (executed)

Landed 2026-08-11, the third slice on this recipe. Five symbols moved from the
sync-owned `crates/snapback/src/auth/session_projection.rs` to `crates/snapback/src/contract_types.rs` —
`SESSION_TERMINAL_CAUSE_META_PREFIX`, `RevocationReason`,
`PersistedSessionTerminalReason`, `SessionTerminalCauseRecord`, and
`AuthorizationStreamIncarnation` — with **every `impl` block left behind**,
because each reaches something not leaf-safe (a `TerminalAuthorityDisposition`
return, conversion/validation logic, or the private
`validate_canonical_uuid_v7` / `stream_corrupt` helpers). The private serde
enum was required collateral: it is `SessionTerminalCauseRecord.reason`'s field
type, and a leaf struct may not hold a field owned by a sync module.

**4 frozen forbidden edges removed, none added — 370 → 366**
(`storage/auth_mode`, `storage/push_registry`, `storage/auth`,
`storage/auth_catalog_ops`). Destination reasoning matched the previous cut:
`crates/snapback/src/local.rs` consumes `AuthorizationStreamIncarnation`, so the leaf had to be
one it already depends on; `crates/snapback/src/ids.rs` was rejected on charter (it is the
*prefixed*-identifier registry and this is a bare UUIDv7).

`SessionProjection` deliberately stayed — 36 methods, and it is the behavior
this boundary exists to keep in the sync engine. That is why
`storage/auth_stream`, `storage/tests`, and `storage/schema_seed` retain their
edges; the survey initially predicted schema_seed would clear, which was wrong
(it uses `SessionProjection` through a function-local `use`).

The remaining item-3 edges are **not** shape moves and should not be attempted
as such: `storage/auth_catalog_ops.rs` calls 24 functions in
`crates/snapback/src/auth/provider.rs`, and `storage/auth_sender.rs` imports six more from
`sender_proof`. That was raised as an open ownership question and is now
**ruled** — see the next section, which also corrects the premise this
paragraph was written on.

Characterization envelope: pure relocation — `auth`/`storage`/`server` lib-test
failure name sets byte-identical to the merge-base (630/58, 385/50, 265/24
pre-existing), `cargo build --all-targets` and `./ref-check --verbose` green,
and the persisted serde encoding carried verbatim.

### Item-3 remainder — the provider split, ruled (sequenced)

Ruled 2026-08-11 under §5 (module assignments are operational) and §6 (a split
that changes an assignment's meaning is a semantic slice and follows §4). The
ruling **rejects the framing the question was filed under**, because reading
the function *bodies* rather than the import list inverts the picture.

**The corrected finding.** `crates/snapback/src/storage/auth_catalog_ops.rs` is not "the SQL
half of the provider's session lifecycle." It is the *transaction-scoping*
half, and it is correctly kernel-owned: its operations open the connection or
immediate transaction — §3.1's commit primitive — and hand the borrowed
`&Transaction` to a function in `crates/snapback/src/auth/provider.rs`. The SQL bodies are in
the **sync-owned** module. `planned_revocation_transaction`,
`plan_exchange_read`, `plan_session_issuance_read`,
`lookup_presented_session`, `reconcile_planned_revocation` and their siblings
all have the same shape: `&Connection`/`&Transaction` plus an
already-composed typed plan, then `UPDATE`/`SELECT` against `_auth_sessions`,
`_auth_identities`, `_auth_session_tokens`, and a call *down* into
`crate::storage::auth::*_in` helpers. The `plan_*` names describe what the
returned value is for, not what the function does.

**So both candidate resolutions in the question were wrong**, and their
"opposite failure modes" were an artifact of the wrong premise. Reassigning
`auth_catalog_ops.rs` to sync (a) would move the transaction primitive *out*
of the kernel while leaving canonical-store SQL in a domain service —
strictly worse on §3.1. Rewriting its wrappers into "typed kernel operations"
(b) is the right *direction* stated at the wrong *module*: the wrappers are
already typed kernel operations.

**The ruling.** The split runs through `crates/snapback/src/auth/provider.rs`, in three
directions at once:

1. **Behavior down.** A function whose body is SQL against the canonical
   auth store is a kernel commit primitive by §3.1 and moves into
   `crates/snapback/src/storage/`, co-located with the wrapper that scopes its transaction.
   The kernel then never calls up for it.
2. **Shapes down.** The plan/outcome value types that cross the boundary
   (`ProviderRevocationPlan`, `PlannedRevocationCommit`, `SessionCandidate`,
   `PlannedIdentityState`, `AuthProviderProfile`, and their ~15 siblings) go
   to the contract leaf, or the relocated body still returns a sync-owned
   type and the edge survives the move.
3. **Policy stays.** Composing a plan, choosing which attempt to make, and
   classifying a refusal remain in `provider.rs`. §2 is explicit that neither
   the leaf nor the kernel owns domain policy, and this is the clause the
   slice must not spend.

**Where the line is genuinely hard, and how to cut it.** Two of the reads
(`plan_exchange_read`, `plan_session_issuance_read`) both fetch durable rows
*and* classify them — attempt exhaustion, expiry, consumed/superseded state,
`Create` versus `Existing` identity. That classification is policy. The cut is
therefore not "move the function": the kernel operation returns the durable
facts it read, and `provider.rs` classifies them into the plan. That is what
makes this a semantic slice with a characterization envelope rather than a
relocation, and it is why it is sequenced rather than folded into a shape cut.

`crates/snapback/src/storage/auth_sender.rs` → `crates/snapback/src/auth/sender_proof.rs` (six functions) is
the same class and takes the same ruling.

**Sequence.** A1 shapes down (proven recipe; clears
`store_state → provider` and `auth_rehearsal → provider`), A2 the provider
bodies, A3 the sender-proof bodies. A2 is the substantial one: ~24 functions
across a 7,466-line module, and it carries the classification split above.
The implementation worklist is
`issues/closed/20260811-llp0225-item-3-provider-split-implementation.md`; the
question that produced this ruling is closed at
`issues/closed/20260810-item-3-remainder-auth-catalog-ops-owner-question.md`.

This ruling changes no owner, rank, or `allowedDependencies` entry, so §5's
amendment-only rule for dependency direction is not engaged; it records what
the eventual module *assignments* will mean, which §5 makes operational.

### Contract-leaf completion — the rqs re-export repoint (executed)

Landed 2026-08-11 against continuing-sequence item 2 (contract leaf
completion) and LLP 0199 worklist item 2's residue. **16 frozen forbidden
edges removed, none added — 365 → 349, with no waiver and no manifest edit.**

The lever is a property of the analyzer worth naming, because it generalizes:
**for a re-exported symbol the extractor records BOTH edges** — the written
module path and the resolved re-export target (§5, "transitively chained
explicit/glob re-exports"). `crates/snapback/src/rqs.rs` had carried
`pub use crate::rqs_contract::{MintRefusal, jcs, sha256_identity};` since
worklist item 2, so every consumer writing `crate::rqs::jcs` held a forbidden
`→ crates/snapback/src/rqs.rs` edge *and* an already-allowed `→ crates/snapback/src/rqs_contract.rs` edge.
Eleven of the sixteen therefore cleared by **repointing the written path
alone, with no code motion at all** — and cost nothing, because the leaf edge
was already in the baseline for every consumer, including the unassigned
`crates/snapback/src/local.rs` / `crates/snapback/src/local/tests.rs` that normally force a waiver on a leaf
move.

This is not laundering. The dependency genuinely is on the leaf; the
sync-engine spelling was an indirection that named an owner the caller does
not use, which is precisely what `rqs_contract.rs`'s own module doc already
claimed ("kernel and contract callers depend directly on this leaf").

The remaining five cleared by finishing the leaf: the `ContentDigest*` family
with `ResumableSha256` and the `CONTENT_DIGEST_*` domains, `row_hash`, `leaf`,
`row_wire_id`, `MsetState`, `seq1_digest`, `DigestKind`, `args_hash`,
`query_artifact_hash`, `projection_row_digest`, their `sha256_tagged`/`hex`
helpers and tag constants, and `RESUME_KEYRING_FILE_NAME`. All are pure
functions over `serde_json::Value` and `sha2`/`serde`/`base64` — RFC 8785
canonicalization and content-digest framing are byte-exact language-neutral
wire contracts shared with the JS arm, which is the leaf charter verbatim.
`crates/snapback/src/rqs_contract.rs` now holds **zero `crate::` references**.

What stayed in `crates/snapback/src/rqs.rs` is the resumable-query *engine*: token envelope,
MAC transcript, keyring custody, and the cursor mint/verify families, each of
which needs `crate::auth::crypto`. `crates/snapback/src/local.rs`, `crates/snapback/src/local/tests.rs`,
`crates/snapback/src/instance_fork.rs`, `crates/snapback/src/schema_export.rs`, and `crates/snapback/src/storage/tests.rs`
keep their edges because they consume that engine; those clear when its
consumers drain, not by a shape move.

Characterization envelope: `auth`/`storage`/`server` lib-test failure name
sets byte-identical to the merge-base with identical pass counts (438/0,
689/2, 286/3), and the cross-language digest parity suites — which pin the
exact moved bytes on both arms — green at 5/0 (Rust) and 6/0 (JS).
### OQ-C recovery slice — inert until verified reload (executed)

The raw-dev reopen exception recorded by the first generation-activation slice
is discharged. `LocalSnapback::from_database` now derives one process recovery
state from the kernel-owned `FunctionGenerationRecord`: no record preserves
the ordinary fresh-store behavior, while a record starts `AwaitingReload` and
the shared by-name invocation resolver refuses every serving lane with
`SNAPBACK_FUNCTION_GENERATION_AWAITING_RELOAD`. The durable record remains the
sole recovery authority; this process state neither replaces it nor gains
transaction authority.

The first artifact load after reopen is classified in the generation-activation
coordinator using canonical function-manifest and sequence-declaration digests.
An exact two-digest match with no pending projection publication and a
matching persisted transcript catalog (revision (u): the catalog commits
atomically with the generation, so its absence marks a pre-fold legacy split)
is rehydration:
the process successor installs without calling `commit_function_generation`,
so the durable generation high-water is unchanged. An automatic mismatch is an
intentional successor deployment through the existing kernel commit. The
explicit `rehydrate_committed_generation` entry point instead refuses a
mismatch with `SNAPBACK_FUNCTION_GENERATION_REHYDRATION_MISMATCH`, leaves the
high-water unchanged, and preserves the fence for a correct retry. Any pending
projection publication still forces a real generation commit, preserving §3.2.

The acceptance is seven file-backed, full-`LocalSnapback` witnesses in
`crates/snapback/src/local/tests.rs`: no-record reopen compatibility; committed-record serving
fence; matching reload with the high-water asserted unchanged; different
automatic reload advancing exactly once; explicit mismatch refusal with an
unchanged high-water and retained fence; correct retry after refusal; and
rehydration followed by one successor advancing exactly once. Revision (p)
ended OQ-C/finding 2 in
`issues/closed/20260810-raw-dev-activation-split-cut-and-reopen-inertness.md`;
revision (u) subsequently ended the separate stream-transcript split cut
(finding 1).

### Item-3 stage A1 — the provider shapes down (executed)

Landed 2026-08-11, the first stage of the ruled `provider.rs` split.
**2 frozen forbidden edges removed, none added — 349 → 347**, no waiver and no
manifest edit. Both were kernel→sync:
`crates/snapback/src/store_state.rs → crates/snapback/src/auth/provider.rs` and
`crates/snapback/src/storage/auth_rehearsal.rs → crates/snapback/src/auth/provider.rs`. The third,
`crates/snapback/src/storage/auth_catalog_ops.rs`, is A2's and deliberately remains.

Two pure enums went to the contract leaf `crates/snapback/src/contract_types.rs`:
`AuthProviderProfile` (deployment posture — the same shape and the same
argument as the landed `ServerProfile` cut) with its pure `permits_capture`,
and `PlannedIdentityState` (a cross-owner plan value with no policy or storage
behavior). `impl From<AuthProviderProfile> for AuthBudgetDeploymentProfile`
**stayed in `provider.rs`**, because it names kernel-owned
`crates/snapback/src/auth/throttle.rs` and a leaf may not: the familiar shape-down/behavior-up
line, drawn by the dependency rather than by taste.

The refusal pair is the part worth recording. `code_invalid()` and
`code_locked()` were the other thing `auth_rehearsal.rs` reached up for, and
they could not both go to the leaf: `code_invalid` is a plain `SnapbackError`,
but `code_locked` names `AuthBudgetRefusal`/`AuthBudgetName`, which are
kernel-owned. Splitting the pair by dependency would have scattered one
compatibility refusal across two owners, so both moved to
`crates/snapback/src/auth/throttle.rs` instead — beside the `auth.guessing` budget rules that
give the locked refusal its structured details. Every edge that creates is
allowed: kernel→kernel from `auth_rehearsal`, sync→kernel from `provider`,
transport→kernel from `server.rs`. `provider.rs` keeps `code_invalid()` /
`code_locked()` as thin `ProviderError` wrappers, so its own callers and the
transport surface are untouched.

`ProviderError` and `SessionRevocation` deliberately did not move; `ProviderError`
carries an `Option<SessionRevocation>`, and dragging that chain to the leaf
would buy nothing A1 needs. `server.rs` still calls
`crate::auth::provider::code_invalid()` because it wants the `ProviderError`,
and transport→sync is an allowed edge.

Characterization envelope: `storage`/`auth`/`server` lib-test failure name sets
byte-identical to the merge-base with identical pass counts (449/0, 696/2,
287/2), `cargo build` clean, `./ref-check --verbose` clean.

### Item-3 stage A3 — the sender-proof inversion (executed)

Landed 2026-08-11. **1 frozen forbidden edge removed, none added — 347 → 346**,
no waiver and no manifest edit:
`crates/snapback/src/storage/auth_sender.rs → crates/snapback/src/auth/sender_proof.rs`.

**This stage is the worked example of the inversion §2 actually asks for, and
the worklist's premise for it was wrong.** A3 was filed as "same class, same
ruling, same method" — a body move of six functions. Measurement said
otherwise: `crates/snapback/src/auth/sender_proof.rs` is 3,711 lines with 25
connection-taking functions and 76 SQL statements, with SQL and policy
interleaved, and only four of the six imports (`sender_replay_epoch`,
`rotate_sender_replay_epoch_for_stream_reset`,
`apply_sender_replay_epoch_floor`,
`initialize_sender_proof_replay_after_hosted_preflight`) are mechanical
durable authority. The other two,
`admit_sender_constrained_request` and `admit_sender_constrained_bound_request`,
carry LLP 0077 decision-4 token-spelling policy, the anti-oracle
cover-challenge posture, and bounded revoked-family tombstones. Under the
ruling's own read-versus-decide test those are **not** kernel commit
primitives, and §2 forbids the kernel owning them.

So the cut was not "move the bodies down" but **invert the direction through
typed kernel operations**. The kernel now owns ten mechanical durable
operations — replay-authority initialization, epoch read/floor/rotation, nonce
issue and read, atomic proof consumption with nonce rotation, proof-id-only
consumption, presented-token constraint lookup, and revoked-family tombstone
lookup — each taking explicit bounds (grace, retention, TTL, capacity) and
returning typed facts from the contract leaf. Sync keeps every decision: the
spelling policy, supersession-grace eligibility, the keyed-cover versus
installed-family challenge behavior, proof parsing and verification, replay
expiry, rejection classification, tombstone retention, bound-grant
issuance-epoch equality, and the durable-error-to-outcome mapping.
`fresh_challenge` therefore stays sync policy; only its durable nonce issue is
delegated downward.

The constraint that shaped the seam is the module's own invariant — "the server
layer never receives a raw SQLite connection." It is preserved: the production
`Connection` stays private inside `crates/snapback/src/storage/auth_sender.rs`, and transport
obtains a narrow `SenderProofAuthority` handle and passes *that* into the sync
policy. Kernel→sync became sync→kernel without ever handing a connection
upward, which is the pattern A2 will need at larger scale.

Characterization envelope: `storage`/`auth`/`server` failure name sets
byte-identical to the merge-base with identical pass counts (449/0, 696/2,
287/2); `--lib sender_proof` 22/0 and the cross-language sender-proof target
1/0. The `route_policy_v1` integration target's four failures
(`durable_watch_rows_pin_the_session_only_policy_tuples`,
`operation_registry_is_exhaustive_and_bound_to_registered_carriers`,
`registry_and_router_have_black_box_path_method_parity`,
`sessions_runtime_rejects_body_auth_on_every_http_ingress`) were measured at
the merge-base and are identical there — 28 passed / 4 failed both sides — so
they are pre-existing main reds, not this slice's.

### Item-3 stage A2 — the provider session lifecycle inverted (executed)

Landed 2026-08-11. The last kernel→provider edge is gone and the direction is
now sync→kernel:
`crates/snapback/src/storage/auth_catalog_ops.rs → crates/snapback/src/auth/provider.rs`. **With A1, A3 and A2
landed, ratchet worklist item 3 is closed.**

Measured on `crates/snapback/src/auth/provider.rs`, before → after:

| | before | after |
| --- | ---: | ---: |
| lines | 9,606 | 7,191 |
| connection/transaction-taking functions | 45 | **0** |
| SQL operation sites | 51 | **0** |

`crates/snapback/src/storage/auth_catalog_ops.rs` no longer names `crate::auth::provider`.

A2 applies A3's typed-operation pattern at ~4× the scale. The kernel owns the
durable operations for presented-session current/tombstone lookup; planned
revocation, family alarm and rotation; revocation and rotation reconciliation;
authenticated-use row lookup and the exact expiry-extension CAS; exchange
challenge and issuance fact reads; rejected exchange and its reconciliation;
session issuance and issuance reconciliation; and step-up proof consumption and
reconciliation. Each receives already-decided bounds and exact
predecessor/successor views; no raw `Connection` or `Transaction` crosses
upward.

The three mixed read-and-classify functions were split explicitly, which is the
part §2 forces and the part that makes this a semantic slice:

- `plan_exchange_read` → kernel `exchange_challenge_fact` + sync
  `classify_exchange_challenge`
- `plan_session_issuance_read` → kernel `session_issuance_facts` + sync
  `classify_session_issuance`
- `record_authenticated_use_transaction` → kernel row read and exact update +
  sync liveness, coalescing and sliding-expiry decisions

Every decision stayed sync-owned: current-versus-retained-predecessor
acceptance and supersession grace; logout/refresh/family-alarm actionability;
challenge consumed/superseded/expired/exhausted classification; identity
`Create` versus `Existing`; live-session-cap eviction choice; sliding expiry and
authenticated-use coalescing; candidate-collision retry; and durable-error and
commit-uncertainty interpretation.

**The regression this slice caught is worth recording, because it is the
characteristic hazard of the whole program.** The first verified run turned
`auth` from 709/2 into 708/3 with one new failure —
`guest_claim_and_recovery_consume_use_shared_issuance_finalization`, panicking
`guest claim must commit, got PredecessorChanged`. Cause: the relocated kernel
lookup had changed a guest-aware `LEFT JOIN` into an inner `_auth_identities`
join. Guest sessions have no identity row, so the kernel's re-read returned
"absent" and reconciliation classified an exact predecessor as changed. Moving
SQL across an owner boundary can silently change the *shape* of a read even
when the surrounding logic is faithfully preserved; the fix restored the
guest-aware projection (`COALESCE`, guest provider fallback, `LEFT JOIN`) across
the relocated lookup family. This is why the envelope is a byte-identical
failing **name set** rather than a pass count.

Characterization envelope: `storage`/`auth`/`server` failure name sets
byte-identical to the merge-base with identical pass counts (451/0, 709/2,
287/2).

**Baseline note — the count is 346 → 346, not 345, and that is provenance, not
growth.** The regeneration removed A2's target fingerprint and in the same pass
recorded a *previously unrecorded* pre-existing edge,
`crates/snapback/src/storage/auth_identity.rs → crates/snapback/src/auth/sender_proof.rs`. That edge was
introduced by `ef936353f`, which added the call without regenerating the
baseline; A2 does not touch that call site. It is recorded and routed to its
landing author in
`issues/closed/20260811-main-unrecorded-kernel-sync-auth-identity-sender-proof-edge.md`
per §2's requirement that every baseline growth event carry stated provenance.

### LLP 0283 F-5 — named membership-exception burn-down (executed)

The `schema-export-facade-integration` membership exception is closed. The
former façade module mixed carriers owned by every architectural rank, so
moving it whole to activation would have required activation to depend upward
on engine and transport. The semantic cut follows §2's shape-down rule instead:
each crate now registers the schemas and committed artifact instances for the
carriers it owns, using the contract leaf's common `SchemaArtifact` helpers.
The rank-7 `snapback-tools` crate concatenates those registries through its
already-authorized downward dependencies, owns `snapback-schemagen`, and is the
only production writer of the committed corpus.

This is an ownership move, not an allowed-edge amendment: no lower-rank crate
depends on tools or on a higher rank, and the committed dependency matrix is
unchanged. Running the moved generator produced a byte-empty `schemas/` diff.
The old façade module and binary paths are gone, so their two membership
assignments were removed from both confinement artifacts.

The `telemetry-proof-private-composition` exception is also closed. Its
rank-7 orchestrator and binary moved together to `snapback-tools`; engine
application calls, services-owned storage observations, types-owned request
carriers, and server HTTP routing are composed only through downward
dependencies. The server keeps Axum request/response primitives behind a
feature-gated observation port, and the committed baseline remains addressed
by the same repository-relative path. `snapback-tools/build.rs` ports the
facade's runtime-input-scoped commit/dirty stamping once for all tools-owned
evidence binaries.

Finally, `snapback-fork-promotion-bench` moved to `snapback-tools` and consumes
that same stamp. Its DB operations still enter through
`snapback-engine::bench_support`; the artifact schema, provenance validation,
and accepted-baseline binding are unchanged. Neither move adds a workspace
edge: rank-7 tools already has downward permission to every consumed owner.

### Continuing sequence (order of intent, not a schedule)

1. **Kernel typed-operation slices** (co-sequenced with owner 1 per 0199
   OQ2): continue converting the wide `LocalDatabase`/closure surface into
   typed kernel operations, inverting the frozen kernel→sync/background
   edges as each slice touches them (worklist items 1–3).
2. **Contract leaf completion:** move the shared wire/query/stream shapes
   down (worklist items 2, 4–7); split `crates/snapback/src/manifest.rs`'s types from its
   subsystem residue and reassign the residue to its owning services.
3. **Sync/realtime engine consolidation:** outbox settlement (LLP 0218's
   contract), invalidation, and live fan-out behind owner 3, out of
   `server.rs` handlers.
4. **Background services:** drain asset/job/push/fork work from the god
   files; enforce §3.6 as code moves.
5. **Transport gate binding:** adapters bind shared serving-gate and
   wire-shape contracts; Cloudflare consumes generated artifacts from the
   leaf.
6. **Embed privacy:** tighten `pub` → `pub(crate)` behind `snapback::embed`
   as drained modules stop needing crate-wide visibility.

Each slice lands incrementally on a fast-moving `main` (no long-lived
restructuring branch), carries its characterization envelope, and
re-baselines the ownership graph under §2's monotonic rule — removed
exceptions and relocation re-keys are routine; any newly-frozen edge
requires its named worklist record in the same landing.

## 5. Enforcement — the structural check is the arm of this Decision

`scripts/check-module-ownership.mjs`, reading `ownership.manifest.json` and
`ownership.baseline.json`, is the enforcement arm of this Decision (so ruled
2026-08-10 in `issues/closed/20260809-ownership-gate-prepush-tier.md`):

- It is **unconditionally selected at pre-push** — a registered drift-prone gate in
  the validated `driftAlwaysRunGates` tier
  (`scripts/local-proof-selection-policy.v1.json`), unioned into every
  pre-push selection regardless of path selection, and a member of
  `driftFailClosedCoreGates`. Under LLP 0232's 2026-08-13 optimistic-landing
  amendment, ordinary pushes report and defer it; explicit strict pushes run
  the full protocol below. It also runs in the local-proof selection
  (LLP 0175 D2.3) and the drift backstop.
- It blocks three failure shapes: a new Rust module with no manifest
  assignment; a new dependency edge that violates §2 (including new edges
  into an unassigned god-file); and manifest/baseline self-consistency
  defects (entries naming absent modules, unsorted buckets, ordinal drift,
  invalid baselines) — which is what makes a naive god-file rename a gate
  red (§6).
- **Honest state of the arm.** As of revision (k), the arm enforces the full
  protocol in this section. The extractor and pushed/predecessor snapshot
  comparison live in `scripts/check-module-ownership.mjs`; the pre-push
  runner supplies every merge-base and treats any ownership-protocol failure
  as blocking rather than routing it through the generic Boolean
  pre-existing-staleness fallback. In particular, (i) staleness attribution
  for this gate is **set-based, not
  pass/fail-based**. Definitions: for a revision R, the *outstanding set*
  `V(R)` is the canonical edge fingerprints of §2-forbidden edges present
  at R **and not admitted by R's committed baseline or waivers**, computed
  by one analyzer semantics applied identically to both snapshots.
  The gate blocks `V(P) − V(B)` (pushed minus merge-base), **and in the
  same run enforces §2's monotonic-baseline comparison against the
  merge-base baseline** — the two checks are one protocol, because `V(P)`
  excludes edges the push's own baseline admits, so the set-difference
  alone would pass a new edge laundered by a same-push baseline freeze;
  §2's growth check is what blocks it. Provenance re-keys for relocation
  and analyzer-upgrade discoveries are baseline entries with attribution
  (§2), never waivers; relocation attribution names the exact removed
  predecessor fingerprint and retains its owner pair. One or more inherited-red
  tickets jointly
  name **at least** the outstanding fingerprints (a superset containing
  since-fixed entries still admits). A Boolean pass/fail or last-green
  comparison cannot distinguish inherited from introduced reds and is not
  compliant. (ii) inherited members (`V(P) ∩ V(B)` non-empty) are admitted
  only while **the pushed revision itself contains** open tickets jointly
  naming the exact outstanding fingerprints, each with an explicit backticked
  observation revision — if
  the tree being pushed carries untracked reds, the push blocks until the
  same push commits or refreshes those tickets. The hook never creates
  uncommitted state. After the revision-(l) merge-wave reconciliation the
  committed baseline records the complete 1,704-edge graph over 232 modules
  and admits 386 frozen forbidden fingerprints; the rehearsal pair is
  admitted under the fleet's item-9 time-bounded waivers, and the two
  unadmitted jobs-wave fingerprints remain auditable through
  `issues/closed/20260810-main-module-ownership-red-jobs-edges.md` rather than
  being laundered into the baseline.
- **Analyzer coverage.** The extractor resolves `crate::`, `super::`, and
  `self::` roots relative to the lexical/file module (including `#[path]`
  modules), grouped use-trees, aliases, `pub use` forms, and transitively
  chained explicit/glob re-exports. Adversarial fixtures for every form live
  under `tests/fixtures/module-ownership/` and execute via
  `scripts/check-module-ownership.test.mjs`. The re-derivation exposed 38
  pre-existing forbidden fingerprints — including
  `crates/snapback/src/auth/provider.rs`'s `super::lifecycle` / `super::mailbox` sideways
  edges — frozen with analyzer-upgrade attribution in worklist item 12
  (renumbered from 9 at the merge-wave reconciliation), with twelve further
  merge-wave discoveries recorded under item 13. The completed gap record is
  `issues/closed/20260810-ownership-gate-analyzer-gaps.md`.

Normative rules bound to this Decision:

- **Dependency direction may only be changed by amending this Decision.**
  The owner set, ranks/layers, and `allowedDependencies` in
  `ownership.manifest.json` are the machine-readable projection of §§1–2; an
  edit that adds an owner, changes a rank, or widens `allowedDependencies`
  requires a `Revised` entry here first (until this document is Accepted, an
  amendment to LLP 0199). Module *assignments*, `mixedModuleScopes`,
  `uncertainAssignments`, and baseline re-freezes are operational and do not
  require amendment — but they are bound by §2's monotonic-baseline rule,
  and every baseline growth event is recorded in the ratchet worklist, as is
  current practice.
- **New modules are assigned at landing.** The gate reds an unlisted module
  and compares the pushed manifest with the predecessor: the legacy
  `unassigned` set (its four revision-(k) entries) is frozen shrink-only, so
  every new module must take one of the seven real owners. The adversarial
  probe and shipped enforcement are recorded in
  `issues/closed/20260810-ownership-gate-analyzer-gaps.md` item 4.
- **Strict execution is explicit and bypass remains compatible.**
  `SNAPBACK_DRIFT_GATES_STRICT=1` runs this set-based protocol synchronously;
  `SNAPBACK_DRIFT_GATES_BYPASS=1` remains accepted and loud for existing
  callers but is redundant in ordinary deferred mode. A gate red on main is
  fixed forward, as the four recorded occurrences were (one deliberate bypass;
  three selection gaps predating the always-run selection, which that
  promotion closed).

## 6. Semantic extraction versus cosmetic splitting

These are different activities and this Decision keeps them distinct:

- **Semantic extraction** moves *ownership*: a behavior gains one owner, a
  commit boundary, typed operations, and a characterization envelope. It is
  what §§1–4 govern. Splitting `local.rs` into `local/*.rs` files changes
  none of that by itself.
- **Cosmetic splitting** (directory splits of the god files, hoisting inline
  `#[cfg(test)]` modules) relieves merge-conflict and review pressure and is
  approved as background work **only** under 0199's OQ4 condition: each
  split co-migrates, in the same change, its file-path-keyed proof
  selectors, frozen-record drift gates, source-reading generators
  (`scripts/guide-lib.mjs` reads `crates/snapback/src/server.rs`;
  `scripts/capability-maturity.mjs` reads `crates/snapback/src/manifest.rs`), file-path
  `@ref`s, **and its `ownership.manifest.json` entries** — the manifest is
  file-path-keyed, so a naive rename is itself a gate red. A cosmetic split
  never changes an owner assignment's meaning; if a split would, it is a
  semantic slice and follows §4.

## 7. Explicit non-decisions

- **No rewrite.** Rust, SQLite, Hermes/Ibex, and the server-authoritative
  model stay. The conformance corpus, route registry, target profiles, and
  proof system are the accumulated value; a rewrite discards their semantics
  and re-creates the cross-target drift this program reduces.
- **No second implementation, no flag-day.** Extraction is strangler-style
  behind the current public surface; there is never a parallel core to cut
  over to.
- **No big-bang N-crate decomposition.** Crates are admitted per slice only
  where they buy real build/isolation wins and carry their gates with them.
- **Not settled here:** the final owner map for the auth residue flagged in
  `uncertainAssignments`; which `manifest.rs` residues land in which
  services (per-slice decisions); any future dedicated execution owner for
  `crates/snapback/src/runtime.rs`.

## Open questions for the author

- **OQ-A — RULED 2026-08-10 (Charlie Cheever): Superseded-with-pointer.**
  This document is the single governing and amendment record; LLP 0199 is
  Superseded, retained as the acceptance/provenance history.
- **OQ-B — RULED 2026-08-10 (Charlie Cheever): confirmed as stated.**
  Direction-changing manifest edits require the prose amendment *first*.

- **OQ-C — RULED 2026-08-10 (Charlie Cheever): inert-until-reload.** The
  owning slice pins the state machine as specified here: the first artifact
  load after reopen verifies against the persisted record's digests and
  refuses on mismatch with a named diagnostic; recovery reload is
  distinguished from intentional successor deployment by that digest match;
  rehydration never advances the durable high-water; serving stays fenced
  until a verified reload or committed successor; full-`LocalSnapback`
  reopen/reload/retry tests are the slice's acceptance. **Discharged by
  revision (o):** the seven landed file-backed `LocalSnapback` tests assert
  every clause, including the unchanged high-water on rehydration, exact
  single advance for successors, retained fence after explicit mismatch, and
  successful retry. The OQ-C reopen exception is therefore ended; revision
  (u) subsequently discharged the sibling stream-transcript split cut.

With OQ-A/OQ-B ruled, acceptance carries this same-landing
handoff: `ownership.manifest.json`'s `governedBy` gains this document, the
stale `mixedModuleScopes` prose (e.g. `local.rs`'s activation scope still
described as "targeted" though extracted) is refreshed, LLP 0199 `@ref`s
that name superseded sections are repointed, and the analyzer-gaps
ticket's fix directions are aligned to §5's current protocol. Revision (k)
completes and closes that handoff.

## Confidence

High that this record matches the shipped state (manifest, gate tier, and
first slice verified in-repo at write time) and 0199's rulings. Medium on the
continuing-sequence ordering (§4), which deliberately remains order-of-intent
so slices can follow product priorities.

## Revision history

- **2026-08-10 (a).** Initial draft discharging
  `issues/20260808-core-modularization-decision.md` (author ruling
  2026-08-10): consolidates LLP 0199's accepted map and OQ1–OQ5 rulings with
  the shipped `ownership.manifest.json` vocabulary, the unconditional
  pre-push gate ruling, and the landed generation-activation first slice;
  adds the amendment-only rule for dependency direction and the OQ-A/OQ-B
  disposition questions.
- **2026-08-10 (b).** Draft → Review at llp-super-refine loop start.
- **2026-08-10 (c).** Round-1 revision from dual-family review: monotonic
  baseline policy (§2, §4, §5) and the analyzer-gap disclosure + extractor
  requirement (§5), both tracked in
  `issues/closed/20260810-ownership-gate-analyzer-gaps.md`; cross-service
  composition clarified to orchestration-above / inert-below (§2); god-file
  no-growth rule made operational (§1); gate failure shapes corrected to
  three (§5); bypass-history wording corrected (one bypass, three selection
  gaps); "while Draft" → "until Accepted"; acceptance handoff note added to
  the OQ section.
- **2026-08-10 (d).** Round-2 revision: the monotonic-baseline rule now
  distinguishes proven pre-existing edges (freezable with provenance) from
  genuinely new coupling (fix, or explicit time-bounded waiver with named
  inversion owner — never a bare note), reclassifying the 2026-08-10
  connected-clients freeze as such a waiver; the first slice's own two
  frozen forbidden edges are named with their inversion dispositions; the
  raw-dev transcript split-cut and reopen-inertness code findings are
  recorded as tracked exceptions
  (`issues/closed/20260810-raw-dev-activation-split-cut-and-reopen-inertness.md`)
  and the crash/reopen envelope claim is narrowed to what the landed tests
  prove; the analyzer-gap disclosure is corrected to `super::`/`self::`
  roots and chained re-exports (grouped/alias/`pub use crate::` forms are
  parsed today).
- **2026-08-10 (f).** §2 waiver-record references: worklist items 9, 10, and
  11 in `issues/closed/20260809-0199-ownership-ratchet-worklist.md` (slice-C
  rehearsal pair, lane-J wire_version pair, logical-transfer pair), each
  naming the edge, the inversion owner, and the bound, recorded at the
  slice-1 re-application landing that froze them.
- **2026-08-10 (e — UNREVIEWED).** Post-round-3 closing fixes, applied
  after the review budget closed and not seen by any reviewer: the
  connected-clients waiver gains its formal worklist record (item 8,
  `issues/closed/20260809-0199-ownership-ratchet-worklist.md`) with owner and
  bound, and the §2 parenthetical becomes a pointer to it (both round-3
  reviews found the prior parenthetical violated the waiver rule it
  instantiates); the analyzer-gap ticket's wording is corrected to match
  §5's accurate disclosure; the two first-slice inversion dispositions name
  their owning slices; revision history reordered. Remaining round-3
  MATERIAL concerns are dispositioned in the loop's final report, not here.
- **2026-08-10 (f).** Round-3 revision under the author's extended budget:
  the "honest state of the arm" paragraph (§5) records that the gate was red
  at the revision-(d) commit and binds two enforcement requirements —
  last-green-baseline staleness attribution (closing the masking path) and
  mandatory stale-edge ticketing on allowed pushes; the
  failed-activation envelope clause is narrowed to the kernel-level tests
  that exist, with the full-process retry witness recorded as an obligation.
- **2026-08-10 (g).** Round-4 revision: §5's attribution requirement made a
  complete set-based protocol (canonical edge fingerprints, V(P)−V(B)
  blocking, waiver coverage, committed-ticket-named inherited sets); the
  unassigned-bucket claim made honest (probe-verified gap; frozen
  shrink-only legacy set required, analyzer ticket item 4); §3.1's
  transaction rule scoped to the canonical store with the sidecar-store
  exemption (telemetry, LLP 0154) that may never imply app atomicity; the
  reopen contract raised as OQ-C (recommendation: inert-until-reload)
  instead of silent delegation; waiver item 8 gains its accountable
  manifest owner.
- **2026-08-10 (i — closing revision, loop terminal).** The convergent
  round-6 fixes only: §5(i) explicitly couples the set-difference to §2's
  monotonic-baseline check as one protocol (both families identified the
  laundering seam between them) with the at-least-fingerprints ticket
  semantics; the reopen exception ends when the ruled contract's tests
  land, not at the ruling; the acceptance handoff gains the ticket-wording
  alignment. The live-tree §5(ii) obligation was discharged by
  `issues/20260810-main-module-ownership-red-rehearsal-edges.md`. The loop
  ends here: six rounds, direction endorsed by both families throughout;
  remaining gpt-5 round-6 concerns are gate-implementation protocol
  refinements whose venue is the analyzer/gate-fix slice, enumerated in
  the loop's final report. This revision is final-unreviewed.
- **2026-08-10 (h).** Round-5 revision: §5's set-based protocol gains its
  definitions (outstanding set = forbidden edges not admitted by the
  revision's committed baseline or waivers; one analyzer semantics on both
  snapshots; relocation/upgrade re-keys are attributed baseline entries,
  never waivers) and the committed-ticket rule is made self-consistent —
  the pushed revision itself must contain the ticket naming untracked reds
  or the push blocks; OQ-C keeps the choice with the author but pins the
  inert-until-reload state machine an acceptance ruling must adopt, with
  the recorded-exception status ending at acceptance; revision history
  sorted chronologically.
- **2026-08-10 (k).** The ownership enforcement arm now implements the
  accepted §5 contract: module-relative and transitive re-export extraction;
  v2 complete-graph baselines with attributed frozen fingerprints;
  predecessor-monotonic baseline and shrink-only `unassigned` comparisons;
  `V(P) − V(B)` blocking under one analyzer; and pushed-tree inherited-red
  ticket coverage. The baseline was re-derived at 227 modules / 1,648 edges,
  with 38 analyzer-upgrade discoveries frozen through ratchet-worklist item 9
  and the two pre-existing rehearsal reds left unadmitted and ticketed.
- **2026-08-10 (l).** Merge-wave reconciliation over the same-day fleet
  landings (LLP 0214 catalog v3, LLP 0218 P2, ratchet slice 1,
  logical-transfer wave): the baseline stands at 232 modules / 1,704 edges /
  386 frozen fingerprints. The rehearsal pair entered the fleet's item-9
  time-bounded waivers (so revision (k)'s "unadmitted" state ended there);
  the analyzer-discovery block was renumbered to worklist item 12, twelve
  merge-wave discoveries were recorded under item 13, and the jobs-wave
  edges (`crates/snapback/src/manifest.rs → crates/snapback/src/storage/jobs.rs`,
  `crates/snapback/src/storage.rs → crates/snapback/src/jobs.rs`) are the current unadmitted pair, tracked
  by `issues/closed/20260810-main-module-ownership-red-jobs-edges.md`. Waiver
  deadlines are escalation metadata: an expired deadline blocks only NEW
  admissions and never wedges parsing of committed snapshots.
- **2026-08-11 (n).** §4 rules the item-3 remainder that revision (m) left
  open, and corrects the premise the question was filed under: reading the
  function bodies (not the import list) shows `crates/snapback/src/storage/auth_catalog_ops.rs`
  is the *transaction-scoping* half — correctly kernel-owned under §3.1 — while
  the canonical-store SQL lives in the sync-owned `crates/snapback/src/auth/provider.rs`. Both
  resolutions the question offered were therefore wrong, and their "opposite
  failure modes" were an artifact of the inverted premise. The ruling splits
  `provider.rs` three ways — SQL bodies down to the kernel, plan/outcome value
  shapes down to the leaf, plan composition and refusal classification staying
  in sync — with the read-and-classify functions cut so the kernel returns
  durable facts and sync classifies them. Sequenced A1/A2/A3 in
  `issues/closed/20260811-llp0225-item-3-provider-split-implementation.md`; no owner,
  rank, or `allowedDependencies` entry changes, so §5's amendment-only rule for
  dependency direction is not engaged.
- **2026-08-11 (o).** §4 records the contract-leaf repoint of the rqs
  re-export surface: 16 frozen forbidden edges removed, none added, 365 → 349,
  with no waiver and no manifest edit. Eleven cleared with **no code motion** —
  the analyzer records both the written module path and the resolved
  re-export target for a re-exported symbol, so consumers spelling
  `crate::rqs::jcs` held a forbidden sync edge alongside the allowed leaf edge
  they already had; naming the leaf directly drops the former and keeps the
  latter. The remaining five cleared by moving the pure
  digest/canonicalization primitives (`ContentDigest*`, `seq1_digest`,
  `projection_row_digest`, `row_hash`, `DigestKind`,
  `RESUME_KEYRING_FILE_NAME`, and their helpers) down beside them;
  `crates/snapback/src/rqs_contract.rs` now carries zero `crate::` references. The
  resumable-query engine — token envelope, MAC transcript, keyring custody,
  cursor mint/verify — stays with the sync owner because it needs
  `crate::auth::crypto`.
- **2026-08-11 (p).** The OQ-C inert-until-reload slice consumes the durable
  raw-dev generation record at `LocalSnapback` reopen, fences invocation until
  a verified reload or committed successor, distinguishes exact rehydration
  from deployment without advancing the rehydration high-water, and adds the
  explicit mismatch refusal. Seven file-backed full-`LocalSnapback`
  reopen/reload/retry tests discharge the recorded reopen exception; the
  stream-transcript split cut remains separate and open.
- **2026-08-11 (q).** §4 records item-3 stage A1, the first stage of the ruled
  `provider.rs` split: `AuthProviderProfile` and `PlannedIdentityState` down to
  `crates/snapback/src/contract_types.rs`, and the `code_invalid()` / `code_locked()`
  compatibility refusal pair to kernel-owned `crates/snapback/src/auth/throttle.rs` beside the
  budget rules that give the locked refusal its details — because
  `code_locked` names kernel-owned budget vocabulary and could not follow its
  partner to a leaf, and splitting one compatibility pair across two owners
  would have been worse than moving both. `impl From<AuthProviderProfile> for
  AuthBudgetDeploymentProfile` stayed with the provider for the same
  dependency reason. 2 frozen forbidden edges removed, none added, 349 → 347,
  no waiver; `crates/snapback/src/storage/auth_catalog_ops.rs → crates/snapback/src/auth/provider.rs` remains
  and is A2's.
- **2026-08-11 (r).** §4 records item-3 stage A3, and corrects the worklist's
  premise for it: A3 was filed as a six-function body move, but
  `crates/snapback/src/auth/sender_proof.rs` measured 3,711 lines with 25 connection-taking
  functions and 76 SQL statements, and the two `admit_sender_constrained_*`
  entry points carry LLP 0077 spelling policy, the anti-oracle
  cover-challenge posture, and revoked-family tombstones — policy the kernel
  may not own under §2. The slice therefore inverted the direction through ten
  typed kernel operations that the sync policy composes downward, rather than
  moving bodies. The module's "the server layer never receives a raw SQLite
  connection" invariant is preserved: the `Connection` stays private in the
  kernel and transport passes a narrow authority handle into sync. 1 frozen
  forbidden edge removed, none added, 347 → 346, no waiver. This is the worked
  example of the inversion A2 needs at larger scale.
- **2026-08-11 (s).** §4 records item-3 stage A2, closing ratchet worklist
  item 3. The last kernel→provider edge is inverted to sync→kernel:
  `crates/snapback/src/auth/provider.rs` goes 9,606 → 7,191 lines with its 45
  connection/transaction-taking functions and 51 SQL sites both reduced to
  **zero**, and `crates/snapback/src/storage/auth_catalog_ops.rs` no longer names the provider.
  The three mixed read-and-classify functions were split so the kernel returns
  durable facts and sync classifies them. A verified regression is recorded
  with the slice because it is the program's characteristic hazard: relocating
  a lookup turned a guest-aware `LEFT JOIN` into an inner join, so guest
  sessions read as absent and an exact predecessor was classified as changed —
  caught only by the byte-identical failing-name-set envelope, not by pass
  counts. The frozen count is 346 → 346 rather than 345 because the
  regeneration also recorded a previously unrecorded pre-existing edge
  (`storage/auth_identity → auth/sender_proof`, introduced by `ef936353f`
  without a baseline regeneration and not touched by A2), ticketed with
  provenance and routed to its landing author per §2.
- **2026-08-15 (u).** The last raw-dev §3 exception is discharged:
  stream-transcript catalog activation moved from its post-commit transaction
  into `commit_function_generation`'s immediate transaction, including the
  schema `ask_manifest()` union. The obsolete post-commit
  `AwaitingReload` compensation and read-manifest refresh seam are removed;
  failure cannot leave a newly committed generation to fence. Exact reopen
  rehydration validates the catalog before resolving its existing fence, so a
  legacy split state is repaired only through the composite commit. An
  injected malformed-catalog witness proves whole-cut rollback and repaired
  retry convergence.
- **2026-08-16 (v).** Independent inherited-red tickets may jointly cover the
  outstanding set, and each must carry an explicit backticked observation
  revision, including the canonical colon forms. The dead baseline-only
  violation computation and the expired waiver singular-plural defect are
  removed. No new disposition or waiver semantics are introduced. The
  attempted exact-endpoint owner-reassignment re-key was removed after review
  found it could launder a predecessor waiver's deadline and inversion owner;
  owner re-keys and retained-predecessor edge-key splits remain fail-closed or
  time-bounded waivers pending the open sound-evidence design follow-up.
- **2026-08-19 (x).** LLP 0283 F-5's schema-export exception is closed by
  placing each registration beside its carrier owner and assembling the
  complete registry in rank-7 `snapback-tools`. The generator moved with the
  assembly, no allowed edge widened, and regeneration left `schemas/`
  byte-identical.
- **2026-08-19 (y).** F-5's telemetry proof module and binary moved together
  into rank-7 `snapback-tools`. Storage and HTTP internals remain behind
  lower-owner ports, the committed baseline path is unchanged, and the tools
  build script ports the facade's exact commit/dirty stamp for proof identity.
- **2026-08-19 (z).** F-5's fork-promotion recorder moved to
  `snapback-tools`, retaining its engine benchmark-support seam and complete
  report schema while consuming the shared tools build-identity stamp. The
  last reviewed membership assignment is removed without a matrix widening.
- **2026-08-20 (aa).** LLP 0285 §6 step 8, governed by accepted LLP 0290,
  moves the database-bound room-authority registry, authorization dependency
  preparation/binding, kernel-derived commit settlement, rollback/ambiguity
  custody, committed outcomes, and finite publication/room permits into
  `snapback-kernel`. Sync retains its foreign queue/lease types, subscriber
  policy, resync materialization, notifier work, and transport handoff. The
  dependency remains the allowed rank-2 → rank-1 edge; no rank or allowed-edge
  amendment was needed. This records only the mechanism move and makes no F-1
  or LLP 0285 defect-closure claim.
- **2026-08-22 (ab).** The bounded commit capsule now takes prepared caller
  authority at its bind step, compares that authority's admission lease with
  the admission controller in one AppState-carried Local/database grouping,
  and thereafter uses the stored grouping. Its successful attempt variant is
  private; the production watch pending transaction compares the authority
  supplied by the final cut with its database; and exact
  reconciliation returns a kernel-minted witness carrying database identity
  and a typed operation identifier. This hardens the ordinary production path
  without sealing construction origin, adapter implementations, authority
  custody, or semantic intent identity.
- **2026-08-22 (ac).** The capsule destination now uses one immutable AppState
  bundle for managed Local, admission, and database authority; transaction
  closures receive a restricted capability rather than `LocalSnapback`;
  exact-row witnesses retain an intent-owned typed identity through mapping;
  and every final-cut exit consumes the cut. The bundle closes only literal
  same-AppState substitution through the separately visible `snapback` field;
  it does not prove the independently supplied construction inputs share an
  origin. The restricted parameter removes direct `LocalSnapback` access from
  that parameter but does not constrain closure captures. The typed identity
  survives `map` but does not prevent same-ID semantic replay. The one-shot
  final-cut consumption remains a structural guarantee. The other residuals,
  including the open `PendingCommit` adapter and `PreparedAuthority`
  publication substitution, remain fix-forward work linked from §3.
- **2026-08-23 (ae).** The independent early slice seals AppState construction
  by comparing a one-shot engine claim's opaque graph identity with the exact
  supplied `LocalSnapback`, then retaining SharedSnapback, admission, graph
  identity, and commit authority in one private capsule runtime binding. The
  actual same-copied-incarnation preclaimed-A/SharedSnapback-B test fails when
  only that comparison is neutralized and passes when restored. This closes
  the construction-origin Critical only; the open pending adapter,
  captured-authority, same-ID replay, and PreparedAuthority
  publication-substitution residuals remain.
- **2026-08-25 (af).** Exact-row witnesses now retain an opaque intent instance
  minted from the database-bound commit-capsule authority and a sealed,
  kernel-defined canonical intended-row fingerprint. `FinalCommitCut` derives
  and retains that instance when it receives its bound authority and intent;
  witness consumption no longer accepts a raw caller intent. Equal operation
  IDs with different intended rows and witnesses from another database are
  refused, while same-semantic retries after database reopen remain valid. The
  public `ExactCommitRows::map` content-replacement combinator is removed, so a
  retained correlation cannot be attached to caller-replaced contents.
- **2026-08-25 (ag).** F220's first implementation still let a dependent hand
  caller-selected intent to public `derive_intent_instance`; the authority only
  wrapped and verified that subject. The corrected flow calls the authority
  with no intent argument. It mints a private allocation and returns a
  move-only producer/expectation pair; `FinalCommitCut` retains the expectation
  and can hand the producer to staging exactly once. Staging consumes that
  producer while attaching the operation's exact semantic fingerprint, and
  reconciliation accepts only a witness carrying the paired allocation,
  database binding, and fingerprint. `CommitCapsuleIntentInstance` is no longer
  `Clone`. Request-derived operation identity, watch ID, target, resume-job ID,
  renewal TTL, and replacement-grant ID describe the staged effect but do not
  select or mint its correlation identity.
- **2026-08-25 (ah).** A fresh consumer review found the test-support prototype
  reconciler still accepted raw intent B beside intended-row carrier A, queried
  B, and attached A's bound correlation to the returned value. The intended-row
  carrier now privately retains the exact staged prototype subject, and
  reconciliation accepts only that carrier. The carrier remains `Clone` because
  uncertainty retention needs owned custody, but cloning preserves both the
  query subject and its bound correlation; callers can no longer replace either
  half independently.
