# LLP 0199: Incremental core modularization — extract owners, do not rewrite

**Type:** Decision
**Status:** Draft
**Systems:** Rust core, Server, Storage, Migration, Live/realtime, Assets, Jobs, Auth, Embedding, LLP governance
**Author:** Claude (Fable 5)
**Date:** 2026-08-08
**Revised:** 2026-08-08
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

The Rust core has three god-object modules:

| module | total lines | production lines (before the in-file test module) | commits touching it since 2026-07-01 |
| --- | ---: | ---: | ---: |
| `src/local.rs` | 59,297 | ~31,345 | 366 |
| `src/server.rs` | 50,573 | ~26,565 | 459 |
| `src/storage.rs` | 36,359 | tests interspersed | 244 |
| `src/manifest.rs` | 16,633 | tests interspersed | 226 |

The coupling is not cosmetic. Since 2026-07-01, **192** commits changed both
`local.rs` and `server.rs`, **122** changed both `local.rs` and `storage.rs`,
and **104** changed both `server.rs` and `storage.rs`. On a `main` that many
concurrent agent sessions push to around the clock, these files are merge-conflict
attractors and exceed a practical review/context window.

More importantly, the highest-severity defects both reviews found share one
failure mode. The P0 (crash/reopen migration rollback republishes the successor
manifest as the "restored predecessor") and the P1 (a projection rebuild digest
commits in a different transaction than the generation install that justifies it)
are not arithmetic mistakes — they are **the absence of a single structurally-owned
prepare/commit boundary**. Lifecycle, transaction, authority, persistence, and
transport responsibilities all cross the same giant modules with no one owner of
the activation transaction. The asset findings (CPU/IO and whole-object buffering
inside the global writer) and the cross-target serving-gate drift (the Cloudflare
`alarm()`/`webSocketMessage` bypass) are the same shape at other seams: work that
should sit behind a narrow owner instead lives inline in a hub module.

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
(transport → domain services → kernel), using a strangler-style sequence of
internal modules (and, where it buys real build/isolation wins, crates) behind
the current public surface:

1. **Generation activation coordinator.** Prepares a complete successor
   (manifest + projections + sequences + auth/capability side effects) and
   publishes it **atomically**. No projection digest, sequence install, or auth
   publication may commit independently of generation activation. This owner is
   the fix-shaped home for the P0 and the projection-digest P1.
2. **Storage / migration kernel.** Owns SQLite transactions, schema lineage,
   rollback **artifacts persisted at admission** (not reconstructed from live
   `self.schema`), cleanup, and durability. Callers receive typed operations, not
   a wide `LocalDatabase` surface.
3. **Durable sync / realtime engine.** Owns subscriptions, version streams,
   outbox settlement, invalidation, and fan-out independently of HTTP handlers.
4. **Background / application services.** Assets, jobs, push, forks, and
   telemetry do CPU/network preparation **outside** the global SQLite writer and
   enter the kernel through narrow commit operations. (This is the structural
   home for the asset-under-global-lock findings.)
5. **Transport adapters.** Local Axum, Cloudflare, the CLI, and the embedding
   compose the same domain contracts; they do not independently re-implement
   serving gates or wire shapes. (This is the structural home for the Cloudflare
   fail-closed-gate-bypass and the hand-written-wire-frame conformance gap.)
6. **Supported embedding façade.** Preserve the `snapback::embed` contract while
   internal modules become genuinely private rather than merely `#[doc(hidden)]`
   where the source-compatibility policy permits.

### Load-bearing invariants that extraction must preserve

Server authority; SQLite single-writer correctness (LLP 0059); bounded handler
execution; language-neutral wire contracts held by the conformance corpus;
explicit per-target capability honesty. Behavior is held by the existing proof
(LLP 0189 cadence) plus focused characterization tests written per slice.

### First slice

**Generation activation** is the recommended first extraction. It has a bounded
blast radius, and this review found a concrete atomicity failure there, so the
characterization-test envelope is easy to state: a reopen-then-rollback test and
a failed-activation-then-retry test that both assert the live manifest and the
materialization agree with what physically committed. The migration/rollback P0
and projection-digest P1 fixes (tracked separately) should land first as
fix-forward, then be **absorbed** by this owner rather than re-implemented.

## Non-goals

- No replacement of Rust, SQLite, Hermes/Ibex, or the server-authoritative
  model.
- No second implementation or flag-day cutover.
- No big-bang N-crate decomposition. The receipt/gate machinery binds to concrete
  paths (`runtime-build-inputs.txt`, digest-bound readiness receipts,
  `cargo clean -p snapback` pinned by a proof-gate regex, drift gates keyed to
  files), and the LLP corpus cites `src/` paths in hundreds of `@ref`s guarded by
  `./ref-check`; a long-lived restructuring branch would starve against `main`'s
  velocity (the exact hazard CLAUDE.md warns about). Extractions land in small,
  path-preserving steps.

## Sequencing guidance (not a schedule)

Cosmetic relief and semantic extraction are different and should not be
conflated:

- **Cosmetic (do opportunistically, low risk):** split the three god-objects into
  module *directories* and hoist their inline `#[cfg(test)]` modules into sibling
  files. This preserves every `snapback::…` path (no `@ref`/proof-gate/test
  churn) and immediately relieves merge-conflict and review pressure. `src/local/`
  and `src/push/` already exist as precedents; LLP 0141 proved the public surface
  can be re-shaped behind a façade.
- **Semantic (do deliberately, behind characterization tests):** the ownership
  map above. Start with generation activation.

## Acceptance

- An accepted Decision records the ownership map, dependency direction,
  transaction boundaries, and a migration sequence, and distinguishes semantic
  extraction from cosmetic file splitting.
- At least one first slice (generation activation) is extracted without changing
  the public wire or embedding API, with the affected proof green.
- New features in a chosen domain land behind its owner rather than adding new
  cross-module calls into `local.rs` / `server.rs` / `storage.rs`.
- A lightweight structural check (e.g. a dependency-direction lint or a
  module-ownership manifest gate) prevents the direction from silently collapsing
  again.

## Author decisions required

This Decision is **Draft**; ratification and the choice of first slice and cadence
are the author's call (Charlie Cheever), consistent with LLP governance. Open
questions for the author:

- **OQ1.** Ratify incremental-extraction-no-rewrite as a standing decision?
- **OQ2.** Confirm generation activation as the first semantic slice, or reorder
  (storage/migration kernel is the alternative first slice, since it owns the
  persisted rollback artifact the P0 needs).
- **OQ3.** Approve the opportunistic cosmetic split of the three god-objects into
  module directories as non-gated background work, or hold it until the semantic
  sequence is fixed to avoid churn.
- **OQ4.** Choose the structural-check mechanism (dependency-direction lint vs.
  an ownership-manifest drift gate) and whether it is advisory or blocking.

## Confidence

High on the need for the decision and on no-rewrite (two independent reviews
converged). Medium on the exact first slice; generation activation is recommended
because this review found a concrete atomicity failure there, but the author
should choose based on current product priorities.
