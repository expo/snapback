# Claim: kernel→sync auth authority shapes move to the contract leaf (LLP 0225 §4 continuing item 1 / ratchet worklist item 3, first cut)

**Opened:** 2026-08-10 · **Status:** claimed, in progress · **Area:** core
modularization / ownership ratchet

## Claim

This ticket claims the first cut of ratchet worklist item 3
(`issues/20260809-0199-ownership-ratchet-worklist.md`, "kernel→sync/auth-core
×~24") under LLP 0225 §4's continuing-sequence item 1 (kernel typed-operation
slices, inverting the frozen kernel→sync edges as each slice touches them).
First-claim-wins: another session taking any edge below should say so here
before starting.

Predecessor slices, both landed 2026-08-10: owner #2 generation-commit kernel
primitive (99fbf9907) and owner #5 server writer-gate seam (4493063c0). The
OQ#4 asset-prepare-outside-the-writer follow-up is likewise landed
(c966a7745, ca7119ed5), so §3.6 is no longer the blocking sequence item.

## Scope — value shapes down, behavior stays up

Item 3's ~24 edges are not one shape. They split into (a) kernel files that
import auth **value shapes** from sync-owned modules, and (b) kernel files that
genuinely **call up** into sync behavior (`lookup_presented_session`,
`planned_family_alarm_transaction`, `presented_token_has_sender_family_binding`
— the `with_auth_*` escape-hatch shape). Only (a) is in this cut; (b) needs
typed kernel operations and rides a later slice.

Move set (pure relocation, no behavior change). The governing pattern is the
one worklist item 7 already used for `auth/descriptor.rs`: **the shape goes
down, the behavior that consumes non-leaf state stays up**, as a same-crate
inherent `impl` block on the relocated type.

1. **Step-up proof shapes → `src/auth/crypto.rs`** (already leaf-owned, and the
   home of every field type these carry — `ChallengeId`, `CanonicalAddress`,
   `AuthKeyId`, `StepUpDigest`, all verified in `crypto.rs`): the
   `StepUpProof` struct (fields widened to `pub(crate)`), its `fmt::Debug`
   redaction impl, `StepUpConsumption`, and `step_up_required_error()`.

   `impl StepUpProof { reconcile_consumed_on, reconcile_unconsumed_on,
   consume_on }` **stays in `src/auth/provider.rs`** — those take a
   `&Connection` and reach `checked_stored_time`, `internal_state_snapback`,
   and `AUTH_MAXIMUM_ATTEMPTS`, so they are behavior, not shape. Sync→leaf is
   an allowed direction, so the impl block is fine where it is.
   `StepUpProofAdmission` also stays — it holds an `AuthAdmission` and an
   `OwnedMutexGuard`, which are sync-owned custody.

2. **Service-authority fence value shapes → a new leaf module**
   `src/auth/service_authority_contract.rs` (following the `rqs_contract.rs` /
   `host_ops_contract.rs` precedent set by worklist items 2/6/7):
   `ServiceAuthorityDisposition`, the `ServiceAuthorityWitness` struct and its
   getters, `ServiceAuthorityActResolution`,
   `ServiceAuthorityDeadlineTerminal`.

   `ServiceAuthorityWitness::from_resolved` moves to
   **`src/storage/auth_agent_credentials.rs`**, as an inherent impl block
   beside `ResolvedScopedToken` — which is defined there and is
   **kernel**-owned, not leaf-owned as an earlier draft of this ticket
   assumed. The kernel owning the conversion from its own token type into a
   leaf shape is kernel→leaf, an allowed downward edge; leaving the
   constructor in `service_fence.rs` would have kept edge 1 alive.

   It is further exposed as a **method** on the token —
   `ResolvedScopedToken::service_authority_witness` — so that call sites
   (`src/server.rs` ×2, `src/server/effects.rs`, `src/local/tests.rs` ×2,
   `src/storage/auth_agent_credentials.rs`) project the witness without naming
   any module path. That is what keeps the unassigned `src/local/tests.rs`
   off the new leaf module entirely.

Explicitly **not** moved: `PreparedServiceAuthorityTerminal` and
`ServiceAuthorityCommitInterlock` (traits whose implementors carry fence
custody), `ServiceAuthorityPublication`, `ServiceAuthorityExternalEffectPermit`,
`ServiceAuthorityTerminalGate`, `ServiceAuthorityFenceRegistry`, and
`with_service_authority_terminal_gate` — these are the sync engine's behavior
and stay put.

## Frozen edges this cut inverts (6)

| # | Frozen fingerprint |
| --- | --- |
| 1 | `src/storage/auth_agent_credentials.rs (storage-migration-kernel) → src/auth/service_fence.rs (sync-realtime-engine)` |
| 2 | `src/storage/auth_agents.rs (storage-migration-kernel) → src/auth/provider.rs (sync-realtime-engine)` |
| 3 | `src/storage/auth_agents.rs (storage-migration-kernel) → src/auth/service_fence.rs (sync-realtime-engine)` |
| 4 | `src/storage/auth_grants.rs (storage-migration-kernel) → src/auth/provider.rs (sync-realtime-engine)` |
| 5 | `src/storage/auth_grants.rs (storage-migration-kernel) → src/auth/service_fence.rs (sync-realtime-engine)` |
| 6 | `src/storage/pending_effects.rs (storage-migration-kernel) → src/auth/provider.rs (sync-realtime-engine)` |

Edge 2/4 are the ones the worklist's "Growth 2026-08-09 (frozen at the slice-4
landing)" entry named with exactly this inversion ("move the step-up proof
shapes to the leaf").

`src/storage/auth.rs → src/auth/service_fence.rs` deliberately **stays** frozen:
that file imports the two retained traits, so the shape move does not clear it.
It inverts when the prepared-terminal custody becomes a typed kernel operation.

## Baseline disposition (LLP 0225 §2)

Removals, plus allowed downward edges into the leaf: new
`kernel → src/auth/service_authority_contract.rs` and
`kernel → src/auth/crypto.rs` edges are allowed (kernel→leaf).

The one unavoidable exception is `src/local.rs`, which genuinely matches on
`ServiceAuthorityActResolution`/`ServiceAuthorityDisposition` (local.rs:3842-3856).
Its frozen `→ src/auth/service_fence.rs` edge is removed and re-keyed onto the
leaf module — strictly better layering (unassigned→sync becomes
unassigned→leaf), but the arm's `relocation` disposition asserts the
predecessor **owner pair is retained**, so it cannot express a shape moving
down a layer. Recorded as a time-bounded waiver with the real disposition in
prose, per `issues/20260810-owngate-split-relocation-disposition-gap.md`.
Any *other* added forbidden edge would be a scoping error to fix before
landing, not something to freeze.

Re-export trap (paid for at the owner-#5 landing): kernel call sites are
repointed at the **leaf path** rather than left on a `service_fence`/`provider`
re-export, so the edges actually re-key instead of resolving through a
re-export chain.

## Acceptance

- `node scripts/check-module-ownership.mjs` green, with the 6 fingerprints gone
  and no added forbidden edge.
- Affected cargo subsets match the merge-base baseline exactly (this is a pure
  relocation; the pre-existing main reds stay pre-existing).
- `./ref-check --verbose` green.
- LLP 0225 §4's migration-sequence section records the slice.

## Outcome — LANDED 2026-08-10

All six edges inverted; gate green. Two scoping premises in the original draft
of this ticket were wrong and were corrected before implementation (the
implementing model stopped on both rather than working around them, which is
the behavior the stop condition exists to produce):

1. `impl StepUpProof`'s methods reach `checked_stored_time`,
   `internal_state_snapback`, and `AUTH_MAXIMUM_ATTEMPTS` — they are behavior
   and stayed in `provider.rs`; only the shape moved.
2. `ResolvedScopedToken` is **kernel**-owned (`storage/auth_agent_credentials.rs`),
   not leaf-owned, so `from_resolved` could not move to the leaf. It became
   `ResolvedScopedToken::service_authority_witness`, a method on the kernel
   type — which additionally kept `src/local/tests.rs` off the new leaf module
   and avoided a second edge-key split.

Baseline: 388 → 382 frozen forbidden (7 removed, 1 added). The single addition
is the `src/local.rs` downward re-key, recorded as a waiver for the
vocabulary-gap reason stated above and in the ratchet worklist.

Verification: `auth`/`storage`/`server` lib-test subsets returned failure sets
byte-identical to the merge-base `3d1553975` (56/50/24 pre-existing named
failures); `./ref-check --verbose` green (230 docs, 4929 refs, 0 errors);
`cargo build --all-targets` clean. No repo-wide reformat rides this landing —
`cargo fmt --all` rewrites ~400 lines across a dozen untouched modules on main
under rustfmt 1.9.0, filed as
`issues/20260810-main-rustfmt-drift-under-1-9-0.md`; the churn it introduced
mid-slice was reverted hunk-by-hunk. The clippy
gate is red on main in the untouched auth identity floor — filed separately as
`issues/20260810-main-red-clippy-auth-identity-floor.md`, attributed to the
auth-floor landing, not to this slice.

Remaining item-3 work (the behavior call-ups) stays open in
`issues/20260809-0199-ownership-ratchet-worklist.md`.
