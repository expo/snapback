# LLP 0199: Incremental core modularization — extract owners, do not rewrite

**Type:** Decision
**Status:** Superseded (by LLP 0225, 2026-08-10 — the consolidated governing and amendment record; this document remains the acceptance/provenance history of the decision)
**Systems:** Rust core, Server, Storage, Migration, Live/realtime, Assets, Jobs, Auth, Embedding, LLP governance
**Author:** Claude (Fable 5)
**Date:** 2026-08-08
**Revised:** 2026-08-09 (owner #1/#2 OQ3 follow-up implemented: projection
materialization/publication split plus composite complete-pair and raw-dev
generation commits); 2026-08-08 (super-refine dual-family READY at round 3;
**Accepted** by the author with OQ1–OQ5 ruled; see Author rulings and Revision
history)
**Related:** LLP 0000 (root explainer / load-bearing invariants), LLP 0038
(earlier `local.rs` split recommendation), LLP 0059 (single-writer locking and
linearization), LLP 0141 (embeddable Rust library / `snapback::embed` façade),
LLP 0080 (projection materialization oracle), LLP 0081 (migration execution
journaling and crash recovery), LLP 0189 (verification cadence and claim
gating)

## Context

Two independent comprehensive code reviews on 2026-08-08 (a Claude fan-out and a
Codex pass) reached the same structural conclusion, and it is worth recording as
a governing decision because the next several months of work will either respect
it or erode it commit by commit.

The Rust core has four oversized core modules (three god-object hubs plus the
`manifest.rs` types module):

| module | total lines | production lines (before the in-file test module) | commits touching it since 2026-07-01 |
| --- | ---: | ---: | ---: |
| `crates/snapback/src/local.rs` | 59,297 | ~31,345 | 366 |
| `crates/snapback/src/server.rs` | 50,573 | ~26,565 | 459 |
| `crates/snapback/src/storage.rs` | 36,359 | tests interspersed | 244 |
| `crates/snapback/src/manifest.rs` | 16,633 | tests interspersed | 226 |

The coupling is not cosmetic. Since 2026-07-01, **192** commits changed both
`local.rs` and `server.rs`, **122** changed both `local.rs` and `storage.rs`,
and **104** changed both `server.rs` and `storage.rs`. On a `main` that many
concurrent agent sessions push to around the clock, these files are merge-conflict
attractors and exceed a practical review/context window. (All counts in this
section are measured at the commissioning commit `22674b8`; `main` has since
grown past them. The per-file totals are a with-merges patch census; the pairwise
coupling figures are non-merge — each true under a reasonable method, and the
coupling thesis holds either way.)

More importantly, the highest-severity defects both reviews found share one
*failure mode* even though they sit at **different** boundaries: each is a
**prepare/commit boundary that no single module owns**. The projection-digest P1
(a projection rebuild commits its per-plan digest in a different transaction than
the generation install that justifies it) is a **function-generation activation**
defect — owner #1 below. The P0 (crash/reopen migration rollback republishes the
successor manifest because admission never persisted the predecessor bytes and
rollback trusts the live `self.schema`) is a **storage/migration kernel** defect
— owner #2 below, and already assigned there by LLP 0081 §§2/4/6. They are two
instances of the same discipline gap at two owners, not one defect with two
candidate owners. Lifecycle, transaction, authority, persistence, and transport
responsibilities all cross the same giant modules with no owner of the
generation-activation transaction or the migration durable-state boundary. The
asset findings (CPU/IO and whole-object buffering inside the global writer) and
the cross-target serving-gate drift (the Cloudflare `alarm()`/`webSocketMessage`
bypass) are the same shape at other seams: work that should sit behind a narrow
owner instead lives inline in a hub module.

## Decision

**Adopt incremental boundary extraction inside the existing system. Do not
rewrite Snapback, and do not build a second implementation for a flag-day
migration.**

The stack — Rust, SQLite, Hermes/Ibex, server-authoritative data, the language-
neutral wire contract, and the conformance/proof corpus — is the accumulated
value of this project. A rewrite would discard those semantics and re-create the
exact cross-target drift this work exists to reduce. The problem is ownership and
dependency direction, not the foundational architecture.

### Target ownership map

Extract these owners over time, with dependency direction pointing **downward**
(transport → domain services → kernel). Owners **1, 3, 4** are domain services;
**2** is the kernel; **5, 6** are transport/adapters. Extraction uses a
strangler-style sequence of internal modules (and, where it buys real
build/isolation wins, crates) behind the current public surface:

1. **Generation activation coordinator** (domain service). Composes a complete
   successor generation (manifest + projections + sequences + auth/capability
   side effects) and installs it as **one atomic transition** — no projection
   digest, sequence install, or auth publication may commit independently of that
   install. Those named transitions are the **minimum** atomic set — OQ3 may add
   boundaries or refine which further state joins it, and chooses the mechanism,
   but may not weaken this minimum. It owns the *composition* and the atomicity
   guarantee, not the commit primitive (owner #2); the *mechanism* of that
   atomicity — one composite kernel commit vs a journaled/compensating protocol —
   is deliberately deferred to OQ3, not decided here. This
   is the fix-shaped home for the **projection-digest P1**. `manifest.rs`
   (16.6k lines) is not a clean leaf today: it mixes language-neutral
   schema/generation *types* with direct dependencies on higher-level subsystems
   (identity, vector, push, assets, auth, and more). The extraction should split
   its schema/generation types into the shared **contract/types leaf** (see
   Sequencing) that this coordinator and the kernel consume, and reassign the
   residue to the owners that own that behavior; which parts go where is a
   per-slice decision, not settled here.

   **OQ3 follow-up resolved (2026-08-09).** Projection rebuild now produces
   repeatable physical rows and a pending publication separately. The digest
   pin, projection generation, and rebuild receipt become authoritative only
   in the SQLite transaction that also persists their owning generation: the
   existing complete-pair mode transaction, or raw-dev's
   `function_generation` record together with sequence enrollment. Raw-dev's
   content digests plus monotonic durable high-water remain boot-safe when its
   process counter resets. Process Arc/fence installation, ephemeral
   publication, successor composition, route validation, cache effects, and
   the complete-pair authorization acknowledgement remain recorded
   transaction-domain exceptions and occur only after a committed verdict.
   No activation path retains the P1 clear-digest compensation; the kernel
   helper remains only as the explicit escape hatch should a future path prove
   it cannot share an owning transaction. When a first complete pair creates
   or seeds projection sources inside its mode transaction, the kernel performs
   that projection materialization after DDL/seed in the same transaction;
   otherwise activation keeps the shorter materialize-first/pin-in-composite
   path. Both forms preserve the same owning durable fact.
2. **Storage / migration kernel.** Owns SQLite transactions (the commit
   primitive owner #1 composes), schema lineage, rollback **artifacts persisted
   at admission** (not reconstructed from live `self.schema`), cleanup, and
   durability. This is the fix-shaped home for the **P0** — the persisted
   predecessor-manifest bytes and the crash-recovery controlling fact live here
   (LLP 0081). Callers receive typed operations, not a wide `LocalDatabase`
   surface.
3. **Durable sync / realtime engine** (domain service). Owns subscriptions,
   version streams, outbox settlement, invalidation, and fan-out independently of
   HTTP handlers.
4. **Background / application services** (domain services). Assets, jobs, push,
   forks, and telemetry do CPU/network preparation **outside** the global SQLite
   writer and enter the kernel through narrow commit operations. (This is the
   structural home for the asset-under-global-lock findings.)
5. **Transport adapters.** Local Axum and the CLI are in-process adapters over
   the Rust domain services; **Cloudflare is a separate target-local
   implementation** (JS worker/DO) that does not consume the Rust modules — what
   it shares is the *language-neutral contract* (schemas, wire fixtures,
   conformance corpus), not code. The decision that matters here is: transport
   adapters must not independently re-implement serving gates or wire shapes;
   they bind the shared contract. (This is the structural home for the Cloudflare
   fail-closed-gate-bypass and the hand-written-wire-frame conformance gap.)
6. **Supported embedding façade.** The in-process Rust embedding (`snapback::embed`,
   LLP 0141). Preserve the `embed` contract while internal modules become
   genuinely private rather than merely `#[doc(hidden)]` where the
   source-compatibility policy permits. (Owner 6 is the Rust façade; owner 5 is
   the network transport adapters — they are distinct surfaces, not overlapping.)

### Load-bearing invariants that extraction must preserve

Server authority; SQLite single-writer correctness (LLP 0059); bounded handler
execution; language-neutral wire contracts held by the conformance corpus;
explicit per-target capability honesty. Behavior is held by the existing proof
(LLP 0189 cadence) plus focused characterization tests written per slice.

### First slice

**Generation activation** is the recommended first extraction. It has a bounded
blast radius, and this review found a concrete atomicity failure there
(the projection-digest P1), so the characterization-test envelope is easy to
state: a failed-activation-then-retry test that asserts the live manifest and the
materialization agree with what physically committed. The **projection-digest P1**
fix (tracked separately, landed fix-forward) should be **absorbed** by this owner
rather than re-implemented; the **P0** fix belongs to owner #2 (the migration
kernel already owns the persisted rollback artifact) and is not part of this slice.

The load-bearing design question this slice must answer — and which this Decision
deliberately does **not** pre-decide — is the **activation atomicity/crash-recovery
contract**: a generation touches separate SQLite commits, durable auth/deployment
state, in-memory manifests, telemetry, routes, and cron/config. The slice must
settle (a) exactly which state transitions must be atomic together, (b) which
single durable fact controls crash recovery (as the P0 taught: the durable fact,
not the in-memory handle), and (c) whether the coordinator installs via one
composite kernel commit or a journaled/compensating protocol. Its acceptance is
that answer made explicit and enforced by the characterization tests.

## Non-goals

- No replacement of Rust, SQLite, Hermes/Ibex, or the server-authoritative
  model.
- No second implementation or flag-day cutover.
- No big-bang N-crate decomposition. The receipt/gate machinery binds to concrete
  paths (`runtime-build-inputs.txt`, digest-bound readiness receipts,
  `cargo clean -p snapback` pinned by a proof-gate regex, drift gates keyed to
  files), and the LLP corpus cites `crates/snapback/src/` paths in hundreds of `@ref`s guarded by
  `./ref-check`; a long-lived restructuring branch would starve against `main`'s
  velocity (the exact hazard CLAUDE.md warns about). Extractions land in small
  steps that carry their file-path-keyed gates and citations with them (see
  Sequencing).

## Sequencing guidance (not a schedule)

Cosmetic relief and semantic extraction are different and should not be
conflated:

- **Cosmetic (low *design* risk, but not gate-free):** split the three god-object
  hubs (`local.rs`, `server.rs`, `storage.rs`) into module *directories* and hoist
  their inline `#[cfg(test)]` modules into sibling files (`manifest.rs` is handled
  by the shared contract/types-leaf item below, not a plain directory split). This
  preserves the Rust *module* paths (`snapback::server::…`) and symbol/module
  `@ref`s, so the API and module-path citations are stable — but it changes
  **file** paths, and non-trivial machinery keys on file paths: the local-proof
  selection policy names `crates/snapback/src/local.rs` / `crates/snapback/src/storage.rs` / `crates/snapback/src/manifest.rs`
  explicitly, frozen drift gates are file-keyed, and source-reading generators read
  exact files (`scripts/guide-lib.mjs` reads `crates/snapback/src/server.rs`;
  `scripts/capability-maturity.mjs` reads `crates/snapback/src/manifest.rs`). A cosmetic split is
  therefore only safe if it
  **co-migrates those selectors, frozen-record gates, source-reading generators,
  and any file-path `@ref`s in the same change** (LLP 0189 D-4: a gate must stay
  attached to its governed code). Done that way it relieves merge-conflict and
  review pressure at low risk; done naively it silently detaches gates from their
  code. `crates/snapback/src/local/` and `crates/snapback/src/push/` already exist as precedents; LLP 0141 proved
  the public surface can be re-shaped behind a façade.
- **Semantic (do deliberately, behind characterization tests):** the ownership
  map above. Start with generation activation.
- **Shared contract/types leaf:** extract the language-neutral schema, wire, and
  generation *types* (the portion of `manifest.rs` plus the wire/id/value types)
  into a dependency-free leaf as the single canonical source. The Rust owners
  (#1, #2) and the in-process adapters consume this leaf as *code*; **Cloudflare
  and other target-local implementations do not link Rust — they bind the
  generated language-neutral artifacts (schemas, wire fixtures) produced from this
  same canonical leaf.** This makes the "single source of truth" an explicit
  downward dependency (code for Rust owners, generated-artifact for other targets)
  rather than a convention, and gives `manifest.rs`'s residue (its subsystem-
  coupled logic) a home in the owning services. This is what owner #1 refers to;
  it can precede or follow the first semantic slice.

## Acceptance

- An accepted Decision records the ownership map, dependency direction,
  transaction boundaries, and a migration sequence, and distinguishes semantic
  extraction from cosmetic file splitting.
- At least one first slice (generation activation) is extracted without changing
  the public wire or embedding API, with the affected proof green.
- New features in a chosen domain land behind its owner rather than adding new
  cross-module calls into `local.rs` / `server.rs` / `storage.rs`.
- A structural check (a dependency-direction lint or a module-ownership manifest
  gate) prevents the direction from silently collapsing again. To satisfy this
  "prevent collapse" criterion the check must be **blocking** for the domain it
  covers; an advisory-only check does not meet it (see OQ5).

## Author rulings (Accepted 2026-08-08, Charlie Cheever)

The author accepted this Decision and directed execution of its entirety. Rulings
on the open questions:

- **OQ1 — ratified.** Incremental boundary extraction, no rewrite, no flag-day
  cutover is a standing decision.
- **OQ2 — generation activation is the first semantic slice, co-sequenced with
  the storage/migration kernel** (they own distinct defects — the projection-digest
  P1 and the P0's persisted rollback artifact respectively — and the coordinator
  composes the kernel's transaction primitive, so the kernel's commit/rollback
  surface is extracted alongside as owner #1 needs it).
- **OQ3 — settled in the first slice's design, under this constraint:** the named
  minimum atomic set (manifest + projection digests + sequence installs + auth
  publication) must commit or roll back together; the single durable fact that
  controls crash recovery is the persisted generation record (never an in-memory
  handle — the P0's lesson); the initial mechanism is one composite kernel commit
  where the state shares the SQLite transaction domain, with a journaled/
  compensating step only for state that provably cannot (recorded per slice).
- **OQ4 — approved on condition:** cosmetic splits proceed as they land, each
  co-migrating its file-path-keyed selectors, frozen-record gates, source-reading
  generators, and `@ref`s in the same change.
- **OQ5 — a blocking module-ownership manifest gate.** An `ownership.toml`-style
  manifest maps modules to owners and the allowed dependency direction; a proof
  gate blocks new cross-owner edges that violate the downward direction, seeded
  with a ratcheted baseline of the current graph so it can land before the
  extraction completes and tighten as owners are extracted.

The subsections below are retained as the original open questions for provenance.

### Original open questions (pre-ruling, for provenance)

This Decision is under review; ratification and the choice of first slice and
cadence are the author's call (Charlie Cheever), consistent with LLP governance.
Open questions for the author:

- **OQ1.** Ratify incremental-extraction-no-rewrite as a standing decision?
- **OQ2.** Confirm generation activation as the first semantic slice, or start
  instead with the storage/migration kernel. Note these own **different** defects,
  not the same one: the activation coordinator owns the projection-digest P1; the
  migration kernel owns the P0's persisted rollback artifact. Either can go first;
  the question is ordering, and whether to co-sequence them since the activation
  coordinator composes the kernel's transaction primitive.
- **OQ3.** Activation atomicity/crash-recovery contract (the first slice's
  load-bearing design question, surfaced here so the author can decide whether it
  is settled in the slice's design or pre-constrained now): which state
  transitions must be atomic together, which single durable fact controls crash
  recovery, and composite-commit vs journaled/compensating protocol.
- **OQ4.** The opportunistic cosmetic split may proceed as background work **only
  if** each split co-migrates its file-path-keyed selectors, frozen-record gates,
  source-reading generators, and `@ref`s in the same change (per Sequencing);
  approve on that condition, or hold it until the semantic sequence is fixed. It
  is not blanket "non-gated" work.
- **OQ5.** Choose the structural-check mechanism (dependency-direction lint vs.
  ownership-manifest drift gate). Given the Acceptance "prevent collapse"
  criterion, it should be blocking for its covered domain rather than advisory —
  confirm, or relax the criterion. This mechanism can only be fully specified
  once the ownership graph and OQ3 contract exist, so it may land after the first
  slice.

## Confidence

High on the need for the decision and on no-rewrite (two independent reviews
converged). Medium on the exact first slice; generation activation is recommended
because this review found a concrete atomicity failure (the P1) there, but the
author should choose based on current product priorities.

## Revision history

- **2026-08-09, OQ3 owner #1/#2 composite activation slice.** Split projection
  materialization from publication; joined pending pins, sequence enrollments,
  and the owning complete-pair or raw-dev generation fact in one kernel
  transaction; limited in-transaction materialization to complete pairs whose
  successor DDL/seed does not physically exist before that transaction; and
  retired activation's P1 clear-digest compensation.

- **2026-08-08, round-1 super-refine revision** (from the dual-family review):
  distinguished the P0 (migration/storage kernel, owner #2) from the
  projection-digest P1 (generation activation, owner #1) — they are the same
  discipline gap at different owners, not one defect with two candidate owners;
  assigned the six owners to transport/service/kernel layers and resolved the
  embed-vs-transport and publication-vs-kernel-commit overlaps; distinguished the
  shared language-neutral contract from Cloudflare's target-local implementation;
  surfaced the activation atomicity/crash-recovery contract as OQ3; corrected the
  cosmetic-split feasibility claim (file-path-keyed selectors/gates/generators
  must co-migrate in the same change per LLP 0189 D-4); made the structural check
  blocking to satisfy the "prevent collapse" acceptance criterion.
- **2026-08-08, round-2 delta review (GPT valid; the round was voided because the
  two reviewers landed on different revisions — orchestrator directory error).**
  The valid GPT delta caught two defects the round-1 revision itself introduced:
  owner #1 asserted "one kernel transaction" while OQ3 deferred the mechanism (a
  contradiction), and `manifest.rs` was mislabeled a "leaf" with a dangling
  Sequencing reference. Both fixed: owner #1 now states an *atomic-transition
  invariant* with the mechanism deferred to OQ3; `manifest.rs` is described
  accurately and the "shared contract/types leaf" is a real Sequencing item.
- **2026-08-08, round-3 review — dual-family READY convergence.** Both families
  (Claude Fable 5, gpt-5.6-sol@xhigh), reviewing the same worktree revision,
  returned READY with only non-material dispositionable notes. Post-convergence
  polish (non-material, applied after the READY-bound revision `0530bc26…`):
  corrected the "three vs four" module count and named the three plain-split hubs;
  marked owner #1's atomic set the *minimum* OQ3 may extend but not weaken;
  clarified the contract/types leaf is consumed as code by Rust owners and as
  generated artifacts by target-local implementations (Cloudflare); fixed the
  `capability-maturity.mjs` generator reference; distinguished stable module/symbol
  `@ref`s from migrating file-path references.
