# Main red: `cargo clippy --all-targets -D warnings` fails in the auth identity floor

**Opened:** 2026-08-10 · **Severity:** P2 (blocks the clippy gate for every
subsequent landing) · **Area:** auth identity floor / lint hygiene

**Resolved:** 2026-08-11 in the catalog-v4/password-auth storage lane. The
three redundant byte conversions were removed, the recovery-key arguments
were grouped under `RecoveryKeyMaterial`, and the intentionally ahead-of-callers
identity-core surface received narrow, reasoned dead-code allowances naming
the route/provisioning lanes that consume it. The post-fix clippy signature
set contains no error in either affected file; the only remaining all-targets
error is the pre-existing `manual_inspect` lint in
`src/local/auth_room_kick_acceptance.rs`.

## What

On clean `origin/main` at `3d1553975`, `cargo clippy --all-targets -- -D
warnings` fails with 14 errors, all in two modules landed by the 2026-08-10
auth-floor work — `src/auth/identity_core.rs` and
`src/storage/auth_identity.rs`. No other module is implicated.

```
error: enum `DeploymentPosture` is never used        src/auth/identity_core.rs:30:17
error: variants `Dev` and `Demo` are never constructed  src/auth/identity_core.rs:32:5
error: method `admit` is never used                  src/auth/identity_core.rs:52:19
error: method `refuse_binding_write` is never used   src/auth/identity_core.rs:119:19
error: associated function `new` is never used       src/auth/identity_core.rs:130:19
error: field `0` is never read                       src/auth/identity_core.rs:143:33
error: method `expose_once` is never used            src/auth/identity_core.rs:148:19
error: needless call to `as_bytes`                   src/storage/auth_identity.rs:161:12
error: needless call to `as_bytes`                   src/storage/auth_identity.rs:176:8
error: needless call to `as_bytes`                   src/storage/auth_identity.rs:177:12
error: this function has too many arguments (8/7)    src/storage/auth_identity.rs:370:5
error: this function has too many arguments (8/7)    src/storage/auth_identity.rs:428:5
```

## Attribution

Pre-existing on main, not introduced by the LLP 0225 item-3 first-cut slice
that observed it (`issues/20260810-owner2-kernel-auth-authority-shapes-slice.md`)
— that slice touches neither file, and its own clippy error (an unused
`ServiceAuthorityWitness` import in `src/server.rs`) was fixed before landing.

The shape reads as an identity floor that landed ahead of its callers: the
dead-code errors are all "never used" on a coherent new API surface, which is
what you would expect if the consuming slice has not landed yet.

## Fix

Two independent halves:

1. `src/storage/auth_identity.rs` — mechanical: drop the three redundant
   `as_bytes` calls, and either group the 8-argument parameter lists into a
   struct or add a scoped `#[allow(clippy::too_many_arguments)]` with a reason.
2. `src/auth/identity_core.rs` — needs the owning author's call: if the
   consuming slice is imminent, gate the surface with a scoped
   `#[allow(dead_code)]` carrying a pointer to the slice that will use it;
   if it is not, delete the unreached surface rather than let it rot.

The 24h fix-forward rule (LLP 0225 / the 2026-08-10 rulings) applies: this is
routed to the auth-floor landing author, not to unrelated slices that merely
observe it.

## Confidence

High — reproduced on a clean worktree at `3d1553975` with
`DYLD_FRAMEWORK_PATH` set, before any local edit.
