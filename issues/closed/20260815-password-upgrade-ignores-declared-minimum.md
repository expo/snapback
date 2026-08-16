# Password upgrade-on-verify ignores the declared `minimumLength`

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Auth, Password credentials
**Date:** 2026-08-15
**Governing:** password `minimumLength` (8–128, default 12)
**Related:** `issues/closed/20260815-password-provider-min-length-default.md`
(signup/hash path only)
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

Signup hashes through `hash_password_on_blocking_pool_with_profile` and
honors the app's `minimumLength`. Upgrade-on-verify does not:

```892:894:src/storage/auth_identity.rs
    let replacement = if verified && prepare_upgrade && password_hash_needs_upgrade(hash_phc) {
        Some(hash_password_on_blocking_pool(secret, random)?)
    } else {
```

`hash_password_on_blocking_pool` always uses the Prod/default profile
(minimum 12). Sign-in calls this with `prepare_upgrade: true` whenever a
credential exists (`src/auth/provider.rs:1638-1640`). That path is
first-class (imported bcrypt upgrade at `src/auth/provider.rs:7545`).

Two broken directions:

1. App `minimumLength: 8` + imported/legacy hash of an 8–11 byte
   password: verify succeeds, rehash throws `SNAPBACK_AUTH_PASSWORD_POLICY`,
   **login fails**.
2. App `minimumLength: 20` + imported 12–19 byte password: rehash
   **succeeds** and stores a hash below the declared floor.

The closed minimum-length ticket only covered the signup/hash path.

## Desired outcome

Upgrade hashing uses the same `PasswordSecurityProfile` as signup and
sign-in policy. A password that already verified against the stored hash
must not fail login because the *upgrade* hasher used a different
minimum. A declared floor above 12 must apply to the replacement hash
too (refuse the upgrade or refuse login consistently — do not store a
below-floor replacement).

## Acceptance

- `minimumLength: 8` + bcrypt-imported 8-byte password: sign-in
  succeeds and the replacement hash is argon2id under that profile.
- `minimumLength: 20` + imported 15-byte password: no replacement
  hash below 20 is stored.
- Signup path is unchanged.

## Resolution (2026-08-15)

Resolved in `src/storage/auth_identity.rs` and `src/auth/provider.rs`.

- Threaded the provider's exact `PasswordSecurityProfile` into the
  upgrade-on-verify blocking job.
- Upgrade rehashes now use `hash_password_on_blocking_pool_with_profile`, the
  same policy-aware path used by signup and password changes.
- When a verified legacy plaintext does not satisfy the app's current profile,
  sign-in succeeds but the opportunistic replacement is skipped. This avoids
  both failing a valid minimum-8 login and persisting a below-floor replacement
  under a minimum-20 declaration.
- Added provider-level bcrypt import tests for the minimum-8 upgrade and the
  minimum-20 skipped replacement, while retaining the generation-CAS upgrade
  and signup minimum-policy coverage.

Test evidence:

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2701 filtered out; finished in 3.20s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2701 filtered out; finished in 2.93s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2701 filtered out; finished in 0.22s
```
