# snapback2 auth hardening: no login rate limit + unbounded password to Argon2

**Status:** Resolved
**Priority:** P1 (brute force + CPU/pool exhaustion)
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/snapback2/src/serve.rs:456`; `snapback2/crates/.../identity.rs:249`, `:180`, `:786`; `guide/.../auth.md:57`

## What was reported

- Documented `No login rate limit` (`auth.md:57`): full Argon2id per login
  on the shared 1/64 workers (`serve.rs:456` + `identity.rs:249`) — online
  brute force doubles as CPU/pool exhaustion against the serving pool.
- `identity.rs:180` — password minimum is 8 with **no maximum**, fed to
  Argon2 up to the 1MiB body cap (`:786`): attacker-amplified KDF cost on
  the defender's CPU.

## Suggested fix

- Rate-limit logins (per-IP + per-account backoff; consider proof-of-work
  or a separate auth pool so login load can't starve serving workers).
- Enforce a password max length (e.g. 128–256) with a pre-hash beyond it.
- Keep the existing dummy-hash-on-unknown-email behavior (`identity.rs:242`).

## Acceptance

- Login abuse is bounded (tests: rate-limit trips, oversized password
  rejected cheaply, unknown-email timing still generic).

## Resolution (2026-09-12)

Signup/login reject passwords above 256 UTF-8 bytes before Argon2 (stricter than the duplicate ticket suggestion of 1024). HTTP admission bounds each account to 8, IP to 16, and server to 32 attempts per 60 seconds, with at most 2 concurrent password operations and bounded tracking maps. Unknown-account normal-length passwords retain the dummy KDF and generic refusal. Integrated identity tests (11), limiter burst/window/inflight tests, and raw HTTP 429/oversized-password tests pass.
