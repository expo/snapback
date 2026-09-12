# Snapback 2 password KDF has no upper length

**Status:** Resolved
**Priority:** P2
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2-core/src/identity.rs` (`signup`, `login`)
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1001 §6 (2026-09-05 ruling removed login quotas; it did not require unbounded KDF input)

## Symptom

Signup only rejects passwords shorter than 8 Unicode scalars. Login has no length check at all. The HTTP cap is the 1 MiB JSON body. `hash_password` / `verify_password` feed the whole string to Argon2id m=19456,t=2,p=1. The single writer thread runs that KDF.

A 1 MiB password is a cheap way to stall the owner. Combined with [dev CORS persona CSRF](./20260911-snapback2-dev-cors-star-allows-persona-csrf.md), a page can POST `/api/auth/login` without a bearer (login is unauthenticated) and stall `snapback2 dev`. Login quotas were deliberately removed; an input cap is not a quota.

## Proposed patch

Cap password **bytes** (1024 is conventional; 128 is also fine) before the KDF on both signup and login. Oversized passwords are `E_AUTH_INVALID` on login (do not distinguish from wrong password) and `E_AUTH_PASSWORD_WEAK` on signup (actionable).

```rust
const MIN_PASSWORD_CHARS: usize = 8;
const MAX_PASSWORD_BYTES: usize = 1_024;

fn password_too_long(password: &str) -> bool {
    password.len() > MAX_PASSWORD_BYTES
}

// signup, after the existing min-length check:
        if password.chars().count() < MIN_PASSWORD_CHARS || password_too_long(password) {
            return Err(IdentityError::PasswordWeak);
        }

// login, before the dummy-hash verify:
        if password_too_long(password) {
            return Err(IdentityError::Invalid);
        }
```

Update `from_identity`’s PasswordWeak rewrite to mention the upper bound: `"use a password of 8–1024 bytes"`.

Do **not** run Argon2 on the oversized login path — that would keep the DoS.

## Acceptance

- Signup of a 1025-byte password is `E_AUTH_PASSWORD_WEAK` and does not hash.
- Login of a 1 MiB password is `E_AUTH_INVALID` and returns in well under Argon2-on-1MiB time (milliseconds, not seconds).
- 8-character and 1024-byte passwords still work.
- Existing dummy-hash unknown-email test still runs one verify for a normal-sized password.

## Resolution (2026-09-12)

Resolved with the shared auth hardening: a 256-byte UTF-8 cap is enforced before signup/login Argon2, deliberately stricter than the suggested 1024 bytes. Oversized known/unknown-account and signup inputs reject cheaply. Integrated identity (11 tests), HTTP limiter, and owner wire regressions pass; normal unknown-email requests retain the dummy KDF.
