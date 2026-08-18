# LLP 0097 Implementation Plan — Ephemeral data branches & effect isolation

Working plan for implementing [LLP 0097](../../llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md) (Accepted). Built in **verifiable slices** on the local SQLite reference target; each slice compiles + tests before the next. Claim boundary (0097 §Status) holds until the Acceptance corpus passes: no target advertises a branch capability above `Missing`, no effect is marked branch-safe.

## Code reality (grounding)

- **Single Cargo crate** `snapback` (`src/lib.rs`); local store is `rusqlite` (bundled SQLite, `backup` feature already enabled).
- **Version model:** commit version lives in `_snapback_meta` / `_snapback_version`; allocated via `next_storage_version(current)` (storage.rs ~9831), read via `current_version_on(conn)` (~6028), written via `set_version(tx, v)` (~12409). One commit = one version advance (LLP 0007 DK-2).
- **Change journal:** `_snapback_changes(id, version, table_name, row_id, op, row_json, changed_at_ms)`, created in `create_infra` (storage.rs ~3699); indexed by `(version,id)` and `(table_name,version)`. **It is single-stream — keyed by `version` only, assuming one per-app stream.** This is the core assumption 0097's typed child streams amend.
- **Stream identity exists but is singular:** `auth_invalidation::{ensure,rotate}_data_version_stream_in` gives the app one data-version-stream id (rotated on reset); lease reservations carry `version_stream`. There is no per-branch child stream yet.
- **Subscriptions/resume** read the journal by version: `live_matcher.rs`, `live_wire.rs`, `rqs.rs` (resumable query snapshots). These consume the single stream and are the main blast radius of a child-stream dimension.
- **Effects/egress:** `host_ops.rs`, `cron.rs` (actions/egress), notifications outbox, payments, the `uses`/LLP 0036 boundary — where P1 interception sits.
- **Invariant density:** ordering facts are `@ref LLP 0007#commit-version-graduation` and **fail closed**. Touching the journal/version path requires preserving these. Hence slices, not a big-bang edit.

## Implementation status (2026-07-25)

Landed on branch `eng/llp-0097-ephemeral-branches` in `src/branches.rs` as
verifiable, tested slices (26 unit tests, all green). Each phase is a mechanism
built and tested at the `Connection` level; the remaining work is **wiring these
seams into the live `LocalSnapback`/`host_ops` execution path** (integration),
after which the `tests/` black-box + `schemas/` drift-gate corpus and any target
capability advertisement can move off `Missing`.

| Slice | Commit | What landed |
|-------|--------|-------------|
| P0.1 | `d6042395` | Branch registry + lifecycle (`_snapback_branches`, create/get/list/mark_teardown) |
| P0.2 | `f9061c5a` | Typed ephemeral child version-stream (`_snapback_branch_versions`): gap-free, independent replay floor, never comparable to canonical |
| P0.3 | `3de5612f` | Materialized branch base via backup snapshot; `base_version` read back from the snapshot (atomically consistent); idempotent teardown |
| P0.4 | `859a0e20` | COW overlay ledger (`_snapback_branch_overlay`) + cross-branch isolation conformance |
| P1 | `11d21c99` | Effect isolation: capture-don't-fire ledger (`_snapback_captured_effects`), closed `EffectClass` fail-closed classification, simulated outcomes, HostMediated-only v1 |
| P2+P3 | `83d0111e` | Promotion: `branch_op_log`, revalidated authority, v1 base-equality, single-version commit, provisional/pending reconciliation ledger, branch-tagged receipts, `reconcile_effect` |
| Corpus | `f9938acb` | Transitive-dependence + never-rolled-back-after-initiation fixtures |

**Deliberate simplifications (integration refinements, not gaps in the contract):**
- Effect-dependence is a **conservative transitive over-approximation** (any write
  at/after the first captured effect is provisional). Precise per-op read-set
  tracking is a refinement; the over-approximation is sound (never marks a
  truly-dependent write unconditional).
- `promote()` takes an **injected physical applier** so it stays schema-generic;
  the live path supplies the real journal/apply function.
- The captured-effect ledger is a mechanism ready for the egress boundary to call;
  it is **not yet invoked from `host_ops`/`cron`/`uses`** — that interception is
  the P1 integration step.
- Postgres/Cloudflare mappings (OQ1/OQ2) still follow the local reference.

## Phases

### P0 — The branch primitive (local SQLite), additive first
- **P0.1 Branch registry (SAFE, additive, no hot-path change).** New `_snapback_branches` table in `create_infra`: `(branch_id PK, child_stream_id, base_stream, base_version, state, created_at_ms, ttl_ms)`. New module `src/branches.rs`: `BranchId`, `ChildStreamId`, `BranchRecord`, and `create_branch / get_branch / list_branches / mark_teardown`. Unit tests. → *This is the first commit.*
- **P0.2 Child version stream (the 0007/0018 amendment, in code).** A branch gets `(childStreamId, version)` with its own monotonic gap-free counter + independent replay floor, **never comparable to canonical**. Land as a per-branch version counter; keep canonical stream untouched.
- **P0.3 Materialized base.** Capture a consistent base at the current canonical head. First cut: **one attached SQLite DB per branch, seeded from a base snapshot** via the `backup` feature (clean isolation; teardown = detach + delete). Records `base_version` for promotion CAS.
- **P0.4 COW reads/writes + branch subscriptions.** Branch reads resolve overlay-over-base (writes land in the branch DB's own `_snapback_changes`); run `live_matcher`/`live_wire` against the branch DB so a future's live queries reflect its divergence. Isolation conformance test: writes in branch A invisible to B and canonical.

### P1 — Effect isolation (capture-don't-fire)
- Inventory every host-mediated egress path (host_ops/cron/actions/outbox/payments/`uses` boundary) — the exhaustiveness prerequisite (0097 OQ3).
- Add a **branch execution mode** to the action/effect context; at the egress boundary, route to a **captured-effect ledger** (`_snapback_captured_effects`) in the LLP 0070 `CaptureOnly` idiom instead of firing; fail-closed on any un-mediated/unclassifiable path.
- **Simulation adapters** generalizing the 0069 deterministic conformance provider + 0045 capture adapter (return declared simulated outcomes).
- Capability = `HostMediated` only; negative/bypass tests gate it.

### P2 — Receipts + scoped authority
- Branch-tagged receipts (extend LLP 0043 mutation receipts + a new external-effect receipt, OQ6); scoped grant on the branch (LLP 0055); revalidation hooks used at promotion (P3).

### P3 — Promotion
- Durable **operation/command log** per branch (function/artifact id, args, principal/grant, read baseline, idempotency, **simulated-effect outcomes + causal order**).
- Promotion: re-execute the op-log into a **staging overlay**, **v1 requires canonical head == baseVersion** (refuse on any advance), commit **one canonical transaction / one canonical version**.
- **Provisional/pending** state for effect-outcome-dependent writes, **transitively**; fenced reconciliation mutation → succeeded|rejected|ambiguous; non-promotable if no declared pending+handler.
- **Authority revalidated** at promotion and each async effect attempt (LLP 0055/0070), not preserved from fork.

### Conformance corpus (gates capability claims)
Mirror the existing harness (`schemas/` drift-gate + `tests/`): base isolation; no-cross-branch writes; host-mediated egress exhaustive (bypass tests); no real effects fired; clean teardown; v1 base-equality refuse; transitive effect-dependence (multi-command fixture); staged settlement never-rolled-back-after-initiation; authority-revalidated fixtures; portability parity (local reference).

## Sequencing & risk
- P0.1 is landing now (additive). P0.2–P0.4 are the core-touching increments (child-stream dimension in the journal + subscription consumers) — the highest-risk work, done carefully with the version-graduation invariants preserved.
- P1 is comparatively self-contained (egress boundary) and safety-critical.
- Postgres/Cloudflare mappings (0097 OQ1/OQ2) follow the local reference; the portable contract is the branch/overlay/child-stream/capture/promotion model, not the SQLite mechanics.
