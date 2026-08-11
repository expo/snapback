# LLP 0225: Core modularization — the consolidated ownership map, commit boundaries, and enforcement arm

**Type:** Decision
**Status:** Accepted
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
**Revised:** 2026-08-10 (l — merge-wave reconciliation of the §5 enforcement
landing; see Revision history)
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
burn-down), `issues/closed/20260810-ownership-gate-analyzer-gaps.md`
(analyzer/enforcement completion)

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

Accepted 2026-08-10: this Decision becomes the **single amendment point** for the
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
edges, and `issues/20260809-0199-ownership-ratchet-worklist.md` is the
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
`src/local.rs → src/connected_clients.rs` freeze predates this rule and is
reclassified as such a waiver — its formal record is worklist item 8 in
`issues/20260809-0199-ownership-ratchet-worklist.md`, naming the edge, the
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

**Honest boundary disposition.** The first slice was *behavior* extraction,
not yet a direction-clean boundary: the coordinator itself carries two frozen
forbidden edges — `→ src/auth/admission.rs` (it imports the
`ModeCommitFailure` commit-verdict type from a sync-engine module; inversion:
the verdict type belongs in the contract leaf) and `→ src/local.rs` (it holds
the god-file handle directly; inversion: a coordinator-owned narrow port
implemented above the service). The verdict-type edge inverts at the
contract-leaf completion slice; the port edge inverts at the `local.rs`
drainage slices. Both are pre-existing-pattern edges frozen in the baseline;
neither is a
license for new sideways coupling.

**Known raw-dev cut exceptions (recorded, with obligations).** Two
code-verified gaps against this section's contract are tracked in
`issues/20260810-raw-dev-activation-split-cut-and-reopen-inertness.md`:
(1) raw-dev's stream-transcript catalog activation currently commits in a
*separate* transaction after `commit_function_generation` — the required fix
is folding it into the kernel commit as the complete-pair lane already does,
and until then it is a recorded §3 exception carrying recovery and
injected-failure test obligations, not part of the atomic-set claim; (2) the
persisted generation record is the recovery *authority*, but production
reopen today constructs inert function state and does not consume the
record. The two candidate contracts — automatic verified artifact reload on
open, or an explicit inert-until-reload contract in which the record
validates and fences the next explicit reload — produce different
externally observable recovery behavior, and the record stores digests and
a high-water, not artifact bytes, so automatic reload also needs an
authoritative artifact source. This is a product choice, raised as
**OQ-C** below rather than delegated silently. The characterization-envelope claims below are scoped to
what the landed tests prove (kernel-level reopen against `LocalDatabase`),
not to a full-process recovery claim.

**Characterization-test envelope** (the slice's acceptance, held in the local
proof's activation/storage tests and binding on any future change to this
boundary):

- *Failed-activation-then-retry:* after an injected commit failure, the
  kernel-level rollback tests hold that pins, enrollments, and the
  generation record agree exactly with what physically committed; the
  full-`LocalSnapback` retry-convergence witness is part of the
  reopen-contract obligation recorded in
  `issues/20260810-raw-dev-activation-split-cut-and-reopen-inertness.md`,
  not yet a landed claim.
- *Crash/reopen:* the persisted generation record is the sole recovery
  authority — never the process fence or an in-memory schema; the landed
  tests prove kernel-level reopen against it (complete-pair and raw-dev
  record paths), with the full-process reopen contract owed per the recorded
  exception above; raw-dev content digests and the monotonic durable
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
restructuring branch), carries its characterization envelope, and
re-baselines the ownership graph under §2's monotonic rule — removed
exceptions and relocation re-keys are routine; any newly-frozen edge
requires its named worklist record in the same landing.

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
  predecessor fingerprint and retains its owner pair. An inherited-red
  ticket names **at least** the
  outstanding fingerprints (a superset containing since-fixed entries
  still admits). A Boolean pass/fail or last-green
  comparison cannot distinguish inherited from introduced reds and is not
  compliant. (ii) inherited members (`V(P) ∩ V(B)` non-empty) are admitted
  only while **the pushed revision itself contains** an open ticket naming
  the exact outstanding fingerprints and their observation revision — if
  the tree being pushed carries untracked reds, the push blocks until the
  same push commits or refreshes that ticket. The hook never creates
  uncommitted state. After the revision-(l) merge-wave reconciliation the
  committed baseline records the complete 1,704-edge graph over 232 modules
  and admits 386 frozen forbidden fingerprints; the rehearsal pair is
  admitted under the fleet's item-9 time-bounded waivers, and the two
  unadmitted jobs-wave fingerprints remain auditable through
  `issues/20260810-main-module-ownership-red-jobs-edges.md` rather than
  being laundered into the baseline.
- **Analyzer coverage.** The extractor resolves `crate::`, `super::`, and
  `self::` roots relative to the lexical/file module (including `#[path]`
  modules), grouped use-trees, aliases, `pub use` forms, and transitively
  chained explicit/glob re-exports. Adversarial fixtures for every form live
  under `tests/fixtures/module-ownership/` and execute via
  `scripts/check-module-ownership.test.mjs`. The re-derivation exposed 38
  pre-existing forbidden fingerprints — including
  `src/auth/provider.rs`'s `super::lifecycle` / `super::mailbox` sideways
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
- **Bypass is exceptional and loud** (`SNAPBACK_DRIFT_GATES_BYPASS=1`, per
  CLAUDE.md); a gate red on main is fixed forward at the next landing, as
  the four recorded occurrences were (one deliberate bypass; three selection
  gaps predating the always-run promotion, which that promotion closed).

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
  reopen/reload/retry tests are the slice's acceptance. The recorded
  exception ends when those tests land
  (`issues/20260810-raw-dev-activation-split-cut-and-reopen-inertness.md`).

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
  (`issues/20260810-raw-dev-activation-split-cut-and-reopen-inertness.md`)
  and the crash/reopen envelope claim is narrowed to what the landed tests
  prove; the analyzer-gap disclosure is corrected to `super::`/`self::`
  roots and chained re-exports (grouped/alias/`pub use crate::` forms are
  parsed today).
- **2026-08-10 (f).** §2 waiver-record references: worklist items 9, 10, and
  11 in `issues/20260809-0199-ownership-ratchet-worklist.md` (slice-C
  rehearsal pair, lane-J wire_version pair, logical-transfer pair), each
  naming the edge, the inversion owner, and the bound, recorded at the
  slice-1 re-application landing that froze them.
- **2026-08-10 (e — UNREVIEWED).** Post-round-3 closing fixes, applied
  after the review budget closed and not seen by any reviewer: the
  connected-clients waiver gains its formal worklist record (item 8,
  `issues/20260809-0199-ownership-ratchet-worklist.md`) with owner and
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
  edges (`src/manifest.rs → src/storage/jobs.rs`,
  `src/storage.rs → src/jobs.rs`) are the current unadmitted pair, tracked
  by `issues/20260810-main-module-ownership-red-jobs-edges.md`. Waiver
  deadlines are escalation metadata: an expired deadline blocks only NEW
  admissions and never wedges parsing of committed snapshots.
