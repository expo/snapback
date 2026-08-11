# Claim: `ServerProfile` moves to the contract leaf (LLP 0225 §4 continuing item 2 / ratchet worklist items 4–5, first cut)

**Opened:** 2026-08-10 · **Closed:** 2026-08-10 · **Status:** resolved —
landed · **Area:** core modularization / ownership ratchet

## Claim

Claims the first cut of ratchet worklist items 4 and 5
(`issues/20260809-0199-ownership-ratchet-worklist.md`) under LLP 0225 §4's
continuing-sequence item 2 (contract-leaf completion). First-claim-wins.

Predecessor: the item-3 first cut landed as `5373238eb` with the same
shape-down/behavior-up pattern this slice reuses.

## The finding that scopes it

Items 4 and 5 look like two unrelated families (`sync→transport ×4`,
`kernel→transport ×8`). They are not: **six of those twelve edges cross on a
single type — `crate::admin::ServerProfile`.**

| Frozen fingerprint | Item |
| --- | --- |
| `src/auth/coordinator.rs (sync-realtime-engine) → src/admin.rs (transport-adapters)` | 4 |
| `src/auth/invocation.rs (sync-realtime-engine) → src/admin.rs (transport-adapters)` | 4 |
| `src/ephemeral.rs (sync-realtime-engine) → src/admin.rs (transport-adapters)` | 4 |
| `src/storage/auth_agents.rs (storage-migration-kernel) → src/admin.rs (transport-adapters)` | 5 (2026-08-09 growth) |
| `src/storage/auth_integrations.rs (storage-migration-kernel) → src/admin.rs (transport-adapters)` | 5 (2026-08-09 growth) |
| `src/storage/auth_rehearsal.rs (storage-migration-kernel) → src/admin.rs (transport-adapters)` | 5 (**waiver item 9, deadline 2026-08-11**) |

Clearing the last of those retires waiver item 9 the day before it expires,
rather than letting it lapse.

`ServerProfile` is a four-variant deployment-posture enum (`Dev`/`Demo`/`Test`/
`Prod`) with no serde derive and no generated-artifact exposure. Transport
owning the vocabulary that the kernel and sync engine must both consult is
exactly the inversion items 4–5 describe.

## Scope

1. **`ServerProfile` moves to `src/contract_types.rs`** with its doc comment,
   its derive, and the two **pure** methods `as_str` and
   `allows_provisioning`.
2. **`for_bind_ip` stays in `src/admin.rs`** as an inherent impl block — it
   calls the admin-local `env_profile`, which reads `SNAPBACK_PROFILE` and the
   bind address. That is transport behavior, not shape (the same
   shape-down/behavior-up split the item-3 cut used for `StepUpProof`).
3. **`admin.rs` keeps `pub use crate::contract_types::ServerProfile;`** so the
   public `snapback::admin::ServerProfile` path (`pub mod admin` in `lib.rs`)
   does not break. That re-export is for the *external* surface only —
   internal call sites are repointed at the leaf so the edges genuinely re-key
   rather than resolving through a re-export chain.

## Why `contract_types.rs` and not a new module

The four unassigned god-file residues that consume `ServerProfile`
(`src/local.rs`, `src/local/tests.rs`,
`src/local/auth_room_kick_acceptance.rs`,
`src/local/authorization_acceptance.rs`) may not take a *new* dependency —
`unassigned` confers no dependency rights (LLP 0225 §1), so a new leaf module
would add four forbidden edges and, because a shape moving down a layer cannot
use the `relocation` disposition, four waivers.

Exactly two leaf modules are already depended on by all four:
`src/contract_types.rs` and `src/manifest.rs`. `manifest.rs` is disqualified —
§4's continuing item 2 exists to *split* it, not grow it. `contract_types.rs`
is the canonical dependency-free contract leaf, and a language-neutral
deployment-posture vocabulary is squarely within its charter. So the
destination is chosen on charter grounds and *happens* to cost zero new edges;
had the charter said otherwise the waiver would have been the honest answer.

## Expected baseline disposition

Six frozen forbidden edges removed, **none added**, and waiver item 9 retired.
New `* → src/contract_types.rs` edges from kernel/sync/transport consumers are
allowed downward edges; `admin.rs → contract_types.rs` (from the re-export) is
transport→leaf, also allowed. If the audited `--update-baseline` diff shows
any added forbidden edge, that is a scoping error to fix before landing.

`src/proof_checkpoint.rs → src/admin.rs` deliberately **stays**: it also
imports `ProtectedErasureAdminCredentialBinding`, so the `ServerProfile` move
does not clear it. Same for `src/store_state.rs → src/admin.rs`, which imports
`admin_token_sibling` / `console_credential_sibling` — both are later cuts.

## Acceptance

- Ownership gate green, the six fingerprints gone, no added forbidden edge.
- Affected cargo subsets match the merge-base failure **name sets** exactly.
- `./ref-check --verbose` green.
- `snapback::admin::ServerProfile` still resolves (public surface unchanged).
- LLP 0225 §4 and the ratchet worklist record the cut; waiver item 9 marked
  retired.


## Outcome — LANDED 2026-08-10

**12 frozen forbidden edges removed, none added (382 -> 370)** — twice the six
scoped. `ServerProfile` turned out to be the *sole* `admin` import of six more
modules, so the single move also cleared `src/auth/rehearsal.rs` and
`src/data_patch.rs` (leaf->transport), `src/local.rs`, `src/local/tests.rs`,
`src/local/authorization_acceptance.rs` (unassigned->transport), and
`src/push.rs` (background->transport).

Zero baseline growth and no disposition required, so the waiver this ticket
budgeted for was never needed. The kernel->transport half of ratchet waiver
item 9 is retired (its machine record removed) a day before its 2026-08-11
deadline; the leaf->kernel half (`auth/rehearsal -> secure_file`) still stands
and still expires 2026-08-11 — **not** cleared by this slice.

Verification: `admin`/`auth`/`storage`/`server` lib-test failure name sets
byte-identical to merge-base `ca86e671c` (2/56/50/24 pre-existing);
`cargo build --all-targets` clean; `./ref-check --verbose` green;
`snapback::admin::ServerProfile` preserved via a `pub use`. No repo-wide
reformat (`issues/20260810-main-rustfmt-drift-under-1-9-0.md`).

Remaining items 4-5 work stays tracked in the ratchet worklist:
`proof_checkpoint -> admin`, `store_state -> admin`, `store_state ->
auth/{lifecycle,runtime}`, `storage/hosted_admission -> auth/hosted_edge`.
