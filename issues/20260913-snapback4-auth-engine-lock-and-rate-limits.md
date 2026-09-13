# Snapback 4: Password hashing holds the engine lock and is unrate-limited

Status: Open
Priority: P1
Observed: 2026-09-13
Review finding: S04
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [security review](../llp/reviews/3000-security-review-20260913.md)

## Problem and reproduction

`POST /auth/signup` and `POST /auth/login` take the process-wide `engine` mutex, then run argon2id (`Argon2::default()`, ~19 MiB, 2 iterations) on the password. The JSON body ceiling is 1 MiB and there is no password maximum, so the hashed input can be a megabyte. There is no per-IP or per-email rate limit, lockout, or dummy verify for unknown emails.

Consequences:

- An unauthenticated client can stall every query, mutation, sync and poll for the duration of argon2 (and longer with a huge password).
- Online brute force of a known email is limited only by CPU.
- Missing emails return the same message as a wrong password but skip argon2, so timing still enumerates accounts. Signup already names a taken email.

`/auth/guest` (enabled by default `use identity`) is similarly unrate-limited and inserts a principal and session on every call.

## Acceptance

- Do not hold the engine mutex across argon2 (or any password KDF).
- Cap password length to a small documented bound (e.g. 128–1024 bytes) before hashing.
- Rate-limit login, signup and guest by peer address (and email, for login/signup).
- Verify a dummy hash on unknown emails so the missing-account path is not a timing oracle, or accept enumeration explicitly in the identity card and still rate-limit.

## Implementation locations

- [crates/snapback4/src/serve.rs](../snapback4/crates/snapback4/src/serve.rs) (`/auth/*`)
- [crates/snapback4-core/src/identity.rs](../snapback4/crates/snapback4-core/src/identity.rs)
