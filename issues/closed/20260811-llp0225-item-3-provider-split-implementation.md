# LLP 0225 item-3 remainder: implement the ruled `provider.rs` split (A1/A2/A3)

**Opened:** 2026-08-11 · **Status:** closed, **A1/A2/A3 completed; final
password sender-binding waiver withdrawn 2026-08-15** · **Area:** core
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

## A2 — the provider bodies (the substantial one) — **DONE 2026-08-11**

**The last kernel→provider edge is gone; the direction is now sync→kernel.**
LLP 0225 revision (s). With A1, A3 and A2 landed, **ratchet worklist item 3 is
closed.**

`src/auth/provider.rs`: 9,606 → 7,191 lines, **45 → 0** connection/transaction-
taking functions, **51 → 0** SQL operation sites. `auth_catalog_ops.rs` no
longer names `crate::auth::provider`.

A2 applied A3's typed-operation pattern, not the body-move shorthand below. The
three mixed read-and-classify functions were split explicitly:
`plan_exchange_read` → kernel `exchange_challenge_fact` + sync
`classify_exchange_challenge`; `plan_session_issuance_read` → kernel
`session_issuance_facts` + sync `classify_session_issuance`;
`record_authenticated_use_transaction` → kernel row read/exact update + sync
liveness, coalescing and sliding expiry. Every decision stayed sync-owned.

**Two things future stages should carry forward.**

1. *The regression, because it is this program's characteristic hazard.* The
   first verified run took `auth` from 709/2 to 708/3:
   `guest_claim_and_recovery_consume_use_shared_issuance_finalization` panicked
   `guest claim must commit, got PredecessorChanged`. The relocated kernel
   lookup had turned a guest-aware `LEFT JOIN` into an inner `_auth_identities`
   join; guest sessions have no identity row, so the re-read returned absent and
   an exact predecessor was classified as changed. **Moving SQL across an owner
   boundary can silently change the shape of a read even when the surrounding
   logic is faithfully preserved.** Only the byte-identical failing-**name-set**
   envelope caught it — pass counts alone would not have.
2. *The baseline came out 346 → 346, not 345, and that is provenance not
   growth.* The regeneration removed A2's target fingerprint and recorded a
   previously unrecorded pre-existing edge,
   `storage/auth_identity → auth/sender_proof`, introduced by `ef936353f`
   without a baseline regeneration. A2 does not touch that call site. It is
   ticketed and routed at
   `issues/closed/20260811-main-unrecorded-kernel-sync-auth-identity-sender-proof-edge.md`.

Envelope: storage/auth/server failure name sets byte-identical to the
merge-base with identical pass counts (451/0, 709/2, 287/2).

*Original A2 plan follows, retained for provenance.*

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

## A3 — `sender_proof` — **DONE 2026-08-11**

**347 → 346, 1 removed / 0 added, no waiver.** LLP 0225 revision (r).

**The premise below was wrong and is corrected here.** A3 was filed as "same
class, same ruling, same method" — a six-function body move. It is not.
Measured: `src/auth/sender_proof.rs` is 3,711 lines with **25
connection-taking functions and 76 SQL statements**, SQL and policy
interleaved. Only four of the six imports are mechanical durable authority.
`admit_sender_constrained_request` and `admit_sender_constrained_bound_request`
carry LLP 0077 decision-4 spelling policy, the anti-oracle cover-challenge
posture, and bounded revoked-family tombstones — under the ruling's own
read-versus-decide test they are **not** kernel primitives, and §2 forbids the
kernel owning them.

So A3 became the **typed-kernel-operation inversion**, which is the worked
example A2 needs:

- Kernel gained ten mechanical operations — replay-authority init, epoch
  read/floor/rotation, nonce issue and read, atomic proof consumption with
  nonce rotation, proof-id-only consumption, presented-token constraint
  lookup, revoked-family tombstone lookup — each taking explicit bounds and
  returning typed leaf facts.
- Sync kept every decision, including `fresh_challenge`; only its durable
  nonce issue is delegated downward.
- The seam is shaped by the module's own invariant, "the server layer never
  receives a raw SQLite connection": the `Connection` stays private in
  `src/storage/auth_sender.rs`, and transport passes a narrow
  `SenderProofAuthority` handle *into* the sync policy. Kernel→sync became
  sync→kernel without ever handing a connection upward.

Envelope: storage/auth/server name sets byte-identical (449/0, 696/2, 287/2);
`--lib sender_proof` 22/0; cross-language sender-proof 1/0. `route_policy_v1`'s
four failures were measured at the merge-base and are identical there (28
passed / 4 failed both sides) — pre-existing main reds, not this slice's.

*Original A3 plan, retained for provenance; its "same method" claim is the part
corrected above:*

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

## Three additional edges from the password-auth surface (2026-08-11)

The first-class email+password work (`llp/0227`, LLP 0214 §20) routes password,
guest-claim, and recovery-consume session minting through the real provider
issuance core instead of the LLP 0214 floor's raw `_auth_sessions` INSERT. That
was required for correctness — the floor's bearer did not resolve as a required
session until a projection rebuild — but it makes `src/storage/auth_identity.rs`
(storage-migration-kernel) reference three sync-owned modules.

These are **the same call-up class this ticket already owns**, not a new
problem: the kernel is calling up into plan composition that LLP 0225 §4's
item-3 ruling (revision (n)) places in `src/auth/provider.rs`. Under that
ruling the correct end state is that sync composes the plan and passes typed
input **down**, and the kernel returns durable facts that sync classifies.

What is already cleared rather than waived: the `AuthProviderProfile` edge was
removed outright by repointing the written path at
`crate::contract_types::AuthProviderProfile`, which `provider.rs` merely
re-exports — the zero-code-motion re-export lever.

What remains, and why it is waived rather than fixed here:

- `TokenDigest` is a pure value shape and belongs at the contract leaf under the
  ruling, but it has 252 consumer files. Moving it inside this program would be
  a repo-wide mechanical sweep landing against a main that moves every few
  minutes — high revert risk, and disproportionate to the password surface.
- `plan_session_cap_read`, `plan_user_session_revocations_read`, and
  `presented_token_has_sender_family_binding` are genuine call-ups whose
  inversion is precisely the A1/A2/A3 provider split this ticket tracks.
  Inverting them ad hoc, outside that sequence, is how the split gets done
  twice and inconsistently.

### Two of the three password-auth waivers withdrawn (2026-08-12)

The routes work was re-applied on top of `ad9125a54` (item-3 stage A2). Adopting
main's inverted shapes removed two of the three edges outright rather than
deferring them:

- **`-> src/auth/provider.rs` — GONE.** A2 turned the planners into sync free
  functions taking `database` and moved classification to sync
  (`classify_session_cap` over `session_cap_facts`). The kernel no longer calls
  up; sync composes and passes down, which is the end state the ruling
  describes.
- **`-> src/auth/session_projection.rs` — GONE.** `TokenDigest` is now consumed
  from `crate::contract_types`, main's public contract-leaf shape. The
  252-file move this waiver was deferring turned out not to be needed at all —
  main had already landed the shape at the leaf.

Cross-owner references in `src/storage/auth_identity.rs` went from 11 to 1.

**Only `-> src/auth/sender_proof.rs` remains waived**, unchanged in substance:
`presented_token_has_sender_family_binding` is consulted so password issuance
refuses with a typed code under sender-constrained custody instead of silently
downgrading to bearer-only custody. Its inversion still belongs to this
worklist's A1/A2/A3 sequence.

### Final password-auth waiver withdrawn (2026-08-15)

The durable `presented_token_has_sender_family_binding` read moved to
kernel-owned `src/storage/auth_sender.rs`; all kernel callers now invoke that
same-owner operation on the connection the kernel already holds. The policy
module no longer owns or exports the SQL body. This removes the
`storage/auth_identity → auth/sender_proof` time-bounded waiver through the
predecessor-aware ownership-baseline regeneration. The helper call from
`storage/auth_catalog_ops` is likewise repointed, but that module's older
frozen edge remains because its typed `SenderIssuanceCommitment` inputs still
live in `auth/sender_proof`; this slice does not claim to clear that separate
type-shape edge. No raw connection crosses upward and no policy moved into the
kernel.
