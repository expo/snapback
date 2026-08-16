# Commission an incremental core-modularization Decision — do not rewrite Snapback

**Opened:** 2026-08-08 · **Severity:** P1 (architecture / change safety) · **Area:** Rust core, server, storage

## Why this needs an explicit decision

The July whole-system review called `src/local.rs` a 3.5k-line god object and
recommended splitting it along its natural seams (LLP 0038). The system has
since grown far past the point where an opportunistic file split is enough:

| module | current lines | production lines before the main test module | commits touching it since 2026-07-01 |
| --- | ---: | ---: | ---: |
| `src/local.rs` | 59,297 | 31,345 | 366 |
| `src/server.rs` | 50,573 | 26,565 | 459 |
| `src/storage.rs` | 36,359 | tests interspersed | 244 |
| `src/manifest.rs` | 16,633 | tests interspersed | 226 |

The same history has 192 commits that change both `local.rs` and `server.rs`,
122 that change both `local.rs` and `storage.rs`, and 104 that change both
`server.rs` and `storage.rs`. This is ownership and dependency coupling, not
just a formatting problem.

The 2026-08-08 full-repository review found data-integrity defects at the
activation/migration boundaries, global-lock asset work, and cross-target
serving-gate drift. Those defects differ in detail, but their common failure
mode is that lifecycle, transaction, authority, persistence, and transport
responsibilities cross the same giant modules without one structurally-owned
commit boundary.

## Decision to commission

Write a short architecture Decision that chooses **incremental boundary
extraction inside the existing system**. It should define at least these
owners and their dependency direction:

1. **Manifest / generation activation coordinator** — prepares a complete
   successor and publishes it atomically; projection, sequence, auth, and
   capability side effects cannot commit independently of generation
   activation.
2. **Storage and migration kernel** — owns SQLite transactions, schema lineage,
   rollback artifacts, cleanup, and durability. Callers receive typed
   operations rather than a wide `LocalDatabase` surface.
3. **Durable sync and realtime engine** — owns subscriptions, version streams,
   outbox settlement, invalidation, and fan-out independently of HTTP handlers.
4. **Background/application services** — assets, jobs, push, forks, and
   telemetry do CPU/network preparation outside the global writer and enter the
   kernel through narrow commit operations.
5. **Transport adapters** — local Axum, Cloudflare, CLI, and embedding compose
   the same domain contracts; they do not independently recreate serving gates
   or wire shapes.
6. **Supported embedding façade** — preserves the `snapback::embed` contract
   while internal modules become genuinely private rather than merely
   `#[doc(hidden)]` where compatibility permits.

The Decision should name one first extraction with a bounded blast radius and
an explicit characterization-test envelope. A good first slice is generation
activation because the current projection-digest defect demonstrates why one
owner must control the prepare/commit boundary.

## Explicit non-decision: no total rewrite

Do **not** replace Rust, SQLite, Hermes/Ibex, or the server-authoritative model.
Do not create a second implementation and attempt a flag-day migration. The
existing conformance corpus, route registry, target profiles, and proof system
are unusually valuable; a rewrite would discard their accumulated semantics
and recreate the exact cross-target drift risk this work should reduce.

Preserve the root LLP's load-bearing invariants: server authority, SQLite
single-writer correctness, bounded execution, language-neutral wire contracts,
and explicit target capability honesty. Use a strangler-style sequence of
internal modules/crates behind the current façade, with behavior held by the
existing proof plus focused boundary tests.

## Acceptance

- An accepted Decision records the ownership map, dependency direction,
  transaction boundaries, and migration sequence.
- The Decision distinguishes semantic extraction from cosmetic file splitting.
- At least one first slice is extracted without changing the public wire or
  embedding API, and the affected proof remains green.
- New features in a chosen domain land behind its owner rather than adding new
  cross-module calls to `local.rs` / `server.rs` / `storage.rs`.
- A lightweight structural check prevents dependency direction from silently
  collapsing again.

## Confidence

High on the need for a decision and on the no-rewrite recommendation. Medium on
the exact first slice; generation activation is suggested because this review
found a concrete atomicity failure there, but the author should choose the
sequence based on current product priorities.

## Author ruling — 2026-08-10

Approved as written, all three parts: (1) the incremental core-modularization
Decision is commissioned; (2) no rewrite — strangler-style extraction behind
the existing façade, preserving the root LLP's load-bearing invariants; (3)
the first slice is generation activation. One addition to the commission: the
lightweight structural check (dependency-direction gate) must land **with**
the first slice, not after — see the companion ruling approving
`issues/20260809-ownership-gate-prepush-tier.md`, which becomes this
Decision's enforcement arm. Next action: author the Decision LLP recording
the ownership map, dependency direction, transaction boundaries, and
migration sequence.

**2026-08-10:** Decision draft authored at
`llp/0225-core-modularization.decision.md` (Status: Draft, awaiting author
review); it consolidates LLP 0199 with the shipped ownership-manifest
vocabulary, the unconditional pre-push gate, and the landed
generation-activation first slice.

## Resolution — 2026-08-15 (backlog sweep)

The commissioned incremental-extraction Decision landed as Accepted
[LLP 0225](../llp/0225-core-modularization.decision.md). It consolidates
superseded LLP 0199, records the ownership map and dependency direction, and
names generation activation as the first slice. That slice and the companion
ownership gate (`issues/closed/20260809-ownership-gate-prepush-tier.md`) are
on main. Remaining extraction continues on
`issues/20260809-0199-ownership-ratchet-worklist.md` and later 0225 slice
tickets, not this commission.
