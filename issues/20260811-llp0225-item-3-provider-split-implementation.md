# LLP 0225 item-3 remainder: implement the ruled `provider.rs` split (A1/A2/A3)

**Opened:** 2026-08-11 · **Status:** open, ruled, **A1/A2/A3 claimed
2026-08-11** · **Area:** core
modularization / ownership ratchet (LLP 0225 §4 "Item-3 remainder — the
provider split, ruled", revision (n))

The ownership question is settled; this is the implementation worklist it
produced. Read LLP 0225 §4's ruling section and the closed question ticket
(`issues/closed/20260810-item-3-remainder-auth-catalog-ops-owner-question.md`)
before starting — the closed ticket's *interpretation* is corrected by the
ruling, and starting from its premise will send you the wrong way.

**Claim a stage in this file before starting it.** `main` moves continuously;
first-claim-wins.

**CLAIMED 2026-08-11 — all three stages, sequentially, by the session that
landed the ruling.** A1 in flight; A3 then A2 to follow. Each stage lands on
its own. If you need one of these, say so here and I will hand it over rather
than duplicate.

Verified against `2fa1af6f6` while claiming, so the next worker does not have
to re-derive it:

- The three frozen kernel→provider edges are `store_state`,
  `storage/auth_rehearsal`, and `storage/auth_catalog_ops`. A1 targets the
  first two; `auth_catalog_ops` needs A2.
- **A1 carries zero waiver risk.** Every consumer of the A1 symbols
  (`AuthProviderProfile`, `PlannedIdentityState`, `code_invalid`,
  `code_locked`, `ProviderError`) is transport, sync, or kernel — there is no
  *unassigned* consumer, so a leaf destination adds only allowed downward
  edges.
- Two dependency constraints shape A1: `impl From<AuthProviderProfile> for
  AuthBudgetDeploymentProfile` names **kernel-owned** `src/auth/throttle.rs`,
  so it cannot follow the enum to a leaf; and `code_locked()` is likewise
  budget-bound and therefore not leaf-safe, while `code_invalid()` is a plain
  `SnapbackError` and is.
- `store_state.rs`'s only provider reference is a **function-local** `use` at
  line 1113 — the whole-file grep matters here.
- A3's shape is confirmed: `src/storage/auth_sender.rs` is a 136-line
  connection-scoping wrapper that passes `&self.conn` / `&mut self.conn` down
  into `sender_proof`'s SQL — structurally identical to
  `auth_catalog_ops`→`provider`, which is exactly what the ruling describes.

## The shape of the work

`src/storage/auth_catalog_ops.rs` (kernel) scopes transactions correctly. The
misplacement is in `src/auth/provider.rs` (sync, 7,466 lines), which holds SQL
bodies against the canonical auth store. Three directions:

- **behavior down** — SQL body → `src/storage/`
- **shapes down** — plan/outcome value types → the contract leaf
- **policy stays** — plan composition and refusal classification stay in
  `provider.rs` (§2: neither leaf nor kernel owns domain policy)

## A1 — shapes down (proven recipe, small) — **DONE 2026-08-11**

**349 → 347 frozen forbidden, 2 removed / 0 added, no waiver, no manifest
edit.** Recorded as LLP 0225 revision (q). Both target edges inverted:
`store_state → provider` and `storage/auth_rehearsal → provider`. The
`auth_catalog_ops → provider` edge remains and is A2's.

What moved, and the two places the dependency drew the line rather than taste:

- `AuthProviderProfile` and `PlannedIdentityState` → `src/contract_types.rs`
  (leaf), the former with its pure `permits_capture`.
- `impl From<AuthProviderProfile> for AuthBudgetDeploymentProfile` **stayed in
  `provider.rs`** — it names kernel-owned `src/auth/throttle.rs`, which a leaf
  may not.
- `code_invalid()` / `code_locked()` → **`src/auth/throttle.rs` (kernel)**, not
  a leaf. `code_invalid` is leaf-safe but `code_locked` names
  `AuthBudgetRefusal`/`AuthBudgetName`, so splitting the pair by dependency
  would have scattered one compatibility refusal across two owners. Both went
  beside the `auth.guessing` budget rules instead. Every resulting edge is
  allowed: kernel→kernel, sync→kernel, transport→kernel.
- `provider.rs` keeps thin `ProviderError` wrappers, so its callers and
  `server.rs` are untouched. `ProviderError`/`SessionRevocation` did **not**
  move — `server.rs` still calls `provider::code_invalid()` for the
  `ProviderError`, and transport→sync is allowed.

Envelope: storage/auth/server failure name sets byte-identical to the
merge-base with identical pass counts (449/0, 696/2, 287/2).

*Original A1 plan follows.*

Move the plan/outcome value shapes that cross the boundary to the contract
leaf, leaving every `impl` block that touches non-leaf state behind
("shape down, behavior up" — the recipe three landed cuts used).

Candidate set, from `auth_catalog_ops.rs`'s import block plus the two smaller
consumers: `AuthenticatedUse`, `AuthenticatedUseRow`,
`DurableIssuanceReconcile`, `DurableRejectedIssuanceReconcile`,
`DurableRevocationReconcile`, `DurableRotationReconcile`,
`ExchangeCoordination`, `PlannedExchange`, `PlannedFamilyAlarmCommit`,
`PlannedIssuanceCommit`, `PlannedRevocationCommit`,
`PlannedRotationTransaction`, `ProviderFamilyAlarmPlan`,
`ProviderRevocationPlan`, `ProviderSessionIssuanceCommitPlan`,
`ProviderTokenRotationCommitPlan`, `RejectedExchangeOutcome`,
`RequestInsertOutcome`, `SessionCandidate`, `StepUpBinding`,
`PlannedIdentityState`, `AuthProviderProfile`.

Edges A1 alone clears: `src/store_state.rs → src/auth/provider.rs` (its only
provider import is `AuthProviderProfile`) and
`src/storage/auth_rehearsal.rs → src/auth/provider.rs` (`PlannedIdentityState`
plus the `code_invalid()` / `code_locked()` refusal constructors, which are
contract-leaf error shapes). It does **not** clear
`auth_catalog_ops → provider`; that needs A2 as well.

**Before promising an edge will clear**, grep each consumer for
`use crate::auth::provider::{` *anywhere in the file*, not just the header — a
function-local `use` is what made the second cut's schema_seed prediction
wrong. And pre-check the destination: `unassigned → anything` is forbidden
including `→ leaf`, so check `ownership.baseline.json` `edges[]` for which leaf
modules each unassigned consumer already depends on. If the charter-correct
destination costs a waiver, take the waiver — do not distort the architecture
to dodge a record.

## A2 — the provider bodies (the substantial one)

~24 functions. Move each SQL body into `src/storage/`, co-located with the
`auth_catalog_ops` wrapper that scopes its transaction, so the kernel stops
calling up.

**The hard part, and the reason this is a semantic slice and not a
relocation:** `plan_exchange_read` and `plan_session_issuance_read` both fetch
durable rows *and* classify them — attempt exhaustion, expiry,
consumed/superseded state, `Create` versus `Existing` identity. That
classification is domain policy and may not land in the kernel. Cut them so
the kernel operation returns the durable facts it read and `provider.rs`
classifies those facts into the plan. Every other function in the set should
be checked against the same test before it moves: *does this decide anything,
or does it only read and write?*

`is_constraint_error`, `auth_required`, `throttled_snapback`,
`internal_state_snapback`, `internal_collision_snapback` are error
constructors/classifiers, not SQL — they belong with the shapes in A1's
direction, not with the bodies.

This stage needs a real characterization envelope: capture the merge-base
failing-test **name sets** for `cargo test --lib {auth,storage,server}` with
`RUST_MIN_STACK=33554432` and prove them byte-identical pre/post. Do not
attempt it in the same landing as A1.

## A3 — `sender_proof`

`src/storage/auth_sender.rs` imports six functions from
`src/auth/sender_proof.rs` (`admit_sender_constrained_request`,
`apply_sender_replay_epoch_floor`, …). Same class, same ruling, same method.

## Constraints (all three stages)

- Do not rewrite `scripts/check-module-ownership.mjs`; do not hand-edit
  `ownership.baseline.json` (regenerate via `--update-baseline` only). Adding a
  module *assignment* is fine (§5, operational); a direction-changing manifest
  edit needs a 0225 prose amendment first (§5, OQ-B).
- `relocation` provenance requires the predecessor edge to vanish **and** to
  retain the predecessor owner pair, so a shape moving *down a layer* can never
  be a relocation. The only escape is a time-bounded waiver naming the edge,
  the inversion owner, and a deadline.
- Never run `cargo fmt --all` — `main` is not rustfmt-idempotent under rustfmt
  1.9.0 (`issues/20260810-main-rustfmt-drift-under-1-9-0.md`). Format only what
  you wrote.
- The 2 inherited-outstanding jobs edges
  (`issues/20260810-main-module-ownership-red-jobs-edges.md`) belong to other
  landing authors. Do not fix them and do not mistake them for a regression.
