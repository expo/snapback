# Snapback 4: Password hashing holds the engine lock and is unrate-limited

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-13
Review finding: S04
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [security review](../../llp/reviews/3000-security-review-20260913.md)

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

- [crates/snapback4/src/serve.rs](../../snapback4/crates/snapback4/src/serve.rs) (`/auth/*`)
- [crates/snapback4-core/src/identity.rs](../../snapback4/crates/snapback4-core/src/identity.rs)

## Resolution — 2026-09-13

Argon2 runs outside the engine mutex, with two admitted KDF workers. Authentication bodies are bounded to 4096 bytes and passwords to 1024 UTF-8 bytes. The 60-second admission window permits 30 combined requests per peer and 10 login/signup requests per normalized email; denied peers cannot allocate unlimited secondary keys. Unknown emails verify a default-cost dummy Argon2id hash, and login rechecks the credential before issuing a session. Parked-worker regressions prove queries continue while both KDF workers are occupied and a third request is refused.

Validation: Linux `cargo test --workspace --no-fail-fast --quiet`, wasm build, and the full `scripts/test.sh` at `8d8c1b7c170183d6a54d7a37af8b34596410160d` passed (0 failures in 45 seconds; 71 client tests). The final audience-index selection correction at `90152c6f2` passed its affected regression. See the [remediation and review record](../../llp/reviews/3000-security-remediation-20260913.md) for review scope and follow-up integration fixes.
