# LLP 0225: Core modularization — the consolidated ownership map, commit boundaries, and enforcement arm

**Type:** Decision
**Status:** Review
**Systems:** Rust core, Server, Storage, Migration, Live/realtime, Assets,
Jobs, Auth, Transport, Embedding, Proof/gates, LLP governance
**Author:** Claude (Fable 5), commissioned by Charlie Cheever (author ruling
2026-08-10 in `issues/20260808-core-modularization-decision.md`)
**Date:** 2026-08-10
**Revised:** 2026-08-10 (a — initial draft discharging the commission;
consolidates LLP 0199 with the shipped ownership manifest, the promoted
pre-push gate, and the landed first slice)
**Revised:** 2026-08-10 (b — Draft → Review at llp-super-refine loop start,
the one authorized transition; independent-loop topology)
**Related:** LLP 0199 (accepted incremental core-modularization Decision this
consolidates), LLP 0000 (root explainer — load-bearing invariants), LLP 0038
(July whole-system review; first `local.rs` god-object finding), LLP 0059
(single-writer locking and linearization), LLP 0080 (projection
materialization oracle), LLP 0081 (migration execution journaling and crash
recovery), LLP 0141 (embeddable Rust library / `snapback::embed` façade),
LLP 0189 (verification cadence and claim gating), LLP 0175 (local-proof
selection), `issues/20260808-core-modularization-decision.md` (commission),
`issues/closed/20260809-ownership-gate-prepush-tier.md` (enforcement-arm
ruling), `issues/20260809-0199-ownership-ratchet-worklist.md` (frozen-edge
burn-down)

## Context and relationship to LLP 0199

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
  assignment of every `src/**/*.rs` module (62+ modules at seeding, grown
  since);
- the **structural check** (`scripts/check-module-ownership.mjs`) is a
  registered drift-prone gate and, per the 2026-08-10 ruling closing
  `issues/20260809-ownership-gate-prepush-tier.md`, a member of the validated
  `driftAlwaysRunGates` tier — it runs on **every push with commits**,
  unconditionally, and is listed in `driftFailClosedCoreGates`;
- the **first slice — generation activation — is extracted and landed**
  (`src/generation_activation.rs`, with the OQ3 composite-commit follow-up of
  2026-08-09 recorded in 0199's revision history).

While this document is Draft, LLP 0199 remains the governing record. On
acceptance, this Decision becomes the **single amendment point** for the
ownership map and dependency direction (§6), and the author disposes of 0199
— the recommended disposition is Superseded-with-pointer, keeping 0199 as the
acceptance/provenance record (its OQ rulings and super-refine history remain
true statements about how the decision was made). That disposition is OQ-A,
not decided here.

## Decision

**Snapback modularizes by incremental owner extraction inside the existing
system, under the seven-owner map below, with dependency direction and commit
authority as stated, enforced by the unconditional pre-push module-ownership
gate. There is no rewrite, no second implementation, and no flag-day.**

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
| 2 | Storage and migration kernel | `storage-migration-kernel` | kernel (1) | Owns SQLite transactions (the only commit primitive), schema lineage, rollback artifacts persisted at admission, cleanup, durability. Callers receive typed operations, not a wide `LocalDatabase` surface. |
| 3 | Durable sync and realtime engine | `sync-realtime-engine` | domain-service (2) | Subscriptions, version streams, outbox settlement, invalidation, fan-out — independent of HTTP handlers. |
| 4 | Background/application services | `background-services` | domain-service (2) | Assets, jobs, push, forks, telemetry, replication. CPU/network preparation happens **outside** the global writer; results enter the kernel through narrow typed commit operations. |
| 5 | Transport adapters | `transport-adapters` | adapter (3) | Local Axum, CLI, admin, hosted edge, bin harnesses. Compose the domain owners; never re-implement serving gates or wire shapes. Cloudflare is a target-local implementation sharing the *contract*, not code. |
| 6 | Supported embedding façade | `embed-facade` | adapter (3) | `snapback::embed` + `src/lib.rs` (LLP 0141). Preserves the embed contract while internals become genuinely private, not merely `#[doc(hidden)]`, where the source-compatibility policy permits. |
| — | — | `unassigned` | bookkeeping (—) | Not an owner. Holds the god-file residue (`src/local.rs` and its acceptance/test companions) until slices place it. May not be named as an allowed dependency, and unassigned modules may not add new edges into an unassigned god-file. |

Two manifest refinements are part of this map, not workarounds of it:

- **`mixedModuleScopes`** — a file the analyzer must treat as one owner can
  declare its true multi-owner interior. `src/local.rs` declares its
  generation-activation scope (owner 1, extracted) against its unassigned
  remainder; `src/manifest.rs` declares its contract-leaf types (assigned)
  against its subsystem-coupled residue (identity, vector, push, assets,
  auth) pending extraction to the owning services.
- **`uncertainAssignments`** — provisional placements carry a substantive
  note (e.g. `src/auth/lifecycle.rs` sits with background services but its
  activation ordering may migrate to owner 1; `src/runtime.rs` sits with
  transport but a dedicated execution owner could claim it). These are
  invitations to re-decide at the owning slice, not licenses to ignore the
  gate.

The declared `godFiles` are `src/local.rs`, `src/server.rs`, `src/storage.rs`
— the modules whose *drainage* is the program's purpose. New code must not
grow them; §5's per-domain rule applies.

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
  **not on each other**. Cross-service composition happens above them (in an
  adapter) or below them (as a typed kernel operation or a leaf shape), never
  sideways.
- **The kernel** (2) may depend only on the leaf. The kernel never calls up
  into a domain service; where today's code does (the `with_auth_*`
  escape-hatch shape), callers pass typed inputs down instead.
- **The leaf** (0) depends on nothing in the crate.
- **`unassigned`** confers no dependency rights and cannot be depended upon
  by name.

Pre-existing violations are **frozen, not blessed**: `ownership.baseline.json`
ratchets the graph at each landing, the gate blocks only *new* forbidden
edges, and `issues/20260809-0199-ownership-ratchet-worklist.md` is the
standing burn-down of the grandfathered upward edges (kernel→background job
helpers, kernel→sync auth call-ups, leaf residues, and their recorded
growth). Inversions ride the owner slices that touch the same code.

## 3. Transaction and commit boundaries — who may commit what

This section states the commit authority the extraction exists to create; it
incorporates 0199's OQ3 ruling and the implemented 2026-08-09 follow-up.

1. **Only the storage/migration kernel owns SQLite transactions.** There is
   one durable writer (LLP 0059) and one commit primitive; every other owner
   commits by *composing* typed kernel operations
   (`CommitFunctionGeneration`, the classified mode-deployment commits, the
   `*_in_tx` families as they relocate into `src/storage/`), never by opening
   its own transaction against the store.
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
   complete-pair authorization acknowledgement) are the recorded
   transaction-domain exceptions and occur only after commit; each future
   exception must be recorded per slice, with the digest-clearing kernel
   helper retained solely as the explicit escape hatch for a path that
   *proves* it cannot share the owning transaction (none does today).
4. **The kernel owns migration durable state.** Rollback artifacts are
   persisted at admission (predecessor bytes), not reconstructed from live
   `self.schema`; lineage, journaling, and crash recovery follow LLP 0081.
5. **The sync/realtime engine commits nothing generation-coupled on its
   own.** Outbox settlement, invalidation cursors, and version-stream state
   go through typed kernel operations; the engine owns ordering and fan-out,
   not durability primitives.
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
`src/generation_activation.rs` is a ~260-line coordinator owned by
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
- The callers in `src/local.rs` shrank to composition calls; the remainder of
  `local.rs` stays `unassigned` with its activation scope recorded in
  `mixedModuleScopes` until later slices drain it.

**Characterization-test envelope** (the slice's acceptance, held in the local
proof's activation/storage tests and binding on any future change to this
boundary):

- *Failed-activation-then-retry:* after an injected commit failure, the live
  manifest, projection pins/digests, and sequence state agree exactly with
  what physically committed, and a retry converges to the successor.
- *Crash/reopen:* recovery reads only the persisted generation record — for
  both complete-pair and raw-dev paths — never the process fence or an
  in-memory schema; raw-dev content digests and the monotonic durable
  high-water stay boot-safe across a process-counter reset.
- *Atomicity:* no path commits a projection digest pin, sequence install, or
  auth publication outside the owning generation transaction.
- *Surface freeze:* no public wire or embedding API change; the legacy
  observable diagnostic ordering is preserved exactly.

Per the 2026-08-10 commission ruling, the structural check landed **with**
this slice's program (the manifest/gate seeding and the unconditional
pre-push promotion both predate this document), not after it.

### Continuing sequence (order of intent, not a schedule)

1. **Kernel typed-operation slices** (co-sequenced with owner 1 per 0199
   OQ2): continue converting the wide `LocalDatabase`/closure surface into
   typed kernel operations, inverting the frozen kernel→sync/background
   edges as each slice touches them (worklist items 1–3).
2. **Contract leaf completion:** move the shared wire/query/stream shapes
   down (worklist items 2, 4–7); split `src/manifest.rs`'s types from its
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
restructuring branch), carries its characterization envelope, re-baselines
the ownership graph, and records any newly-frozen edges in the worklist
ticket.

## 5. Enforcement — the structural check is the arm of this Decision

`scripts/check-module-ownership.mjs`, reading `ownership.manifest.json` and
`ownership.baseline.json`, is the enforcement arm of this Decision (so ruled
2026-08-10 in `issues/closed/20260809-ownership-gate-prepush-tier.md`):

- It runs **unconditionally at pre-push** — a registered drift-prone gate in
  the validated `driftAlwaysRunGates` tier
  (`scripts/local-proof-selection-policy.v1.json`), unioned into every
  pre-push selection regardless of path selection, and a member of
  `driftFailClosedCoreGates`. It also runs in the local-proof selection
  (LLP 0175 D2.3) and the drift backstop.
- It blocks exactly two failure shapes: a new Rust module with no manifest
  assignment, and a new dependency edge that violates §2 (including new
  edges into an unassigned god-file).

Normative rules bound to this Decision:

- **Dependency direction may only be changed by amending this Decision.**
  The owner set, ranks/layers, and `allowedDependencies` in
  `ownership.manifest.json` are the machine-readable projection of §§1–2; an
  edit that adds an owner, changes a rank, or widens `allowedDependencies`
  requires a `Revised` entry here first (while this document is Draft, an
  amendment to LLP 0199). Module *assignments*, `mixedModuleScopes`,
  `uncertainAssignments`, and baseline re-freezes are operational and do not
  require amendment — but every baseline growth event is recorded in the
  ratchet worklist, as is current practice.
- **New modules are assigned at landing.** The gate makes an unassigned
  module a hard red on push; `unassigned` is reserved for the pre-existing
  god-file residue, which only shrinks.
- **Bypass is exceptional and loud** (`SNAPBACK_DRIFT_GATES_BYPASS=1`, per
  CLAUDE.md); a bypassed red is fixed forward at the next landing, as the
  four recorded occurrences were.

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
  (`scripts/guide-lib.mjs` reads `src/server.rs`;
  `scripts/capability-maturity.mjs` reads `src/manifest.rs`), file-path
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
  `src/runtime.rs`.

## Open questions for the author

- **OQ-A.** On acceptance, dispose of LLP 0199: Superseded-with-pointer
  (recommended — this document becomes the single governing and amendment
  record; 0199 remains the acceptance/provenance history), or keep 0199
  Accepted with this document as a consolidation companion (weaker: two
  amendment points).
- **OQ-B.** Confirm §5's amendment rule as stated — direction-changing
  manifest edits require a prose amendment *first* — or relax to
  same-landing co-amendment.

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
