# Snapback 4: Sessions never rotate and the default store is page-readable

Status: Open
Severity: minor
Priority: P2
Area: security
Observed: 2026-09-13
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Review provenance: Snapback4 comprehensive-review synthesis (2026-09-13 child review)
Related: `20260913-snapback4-auth-engine-lock-and-rate-limits` (covers KDF-under-lock, rate limits, password max — not session lifecycle)

## Problem and reproduction

Two session-custody gaps, both read from the code:

1. Server sessions live 90 days (`SESSION_DAYS = 90`,
   [identity.rs](../snapback4/crates/snapback4-core/src/identity.rs):15,55)
   with no rotation on use, no revoke-all, and no lockout signal:
   `open_session` inserts, `resolve` only checks expiry, `close_session`
   deletes one token (`grep -n "revoke\|rotat" identity.rs` is empty).
   Combined with unbounded guest minting (covered in the related ticket),
   `_sessions` grows monotonically and a stolen token is good for 90 days
   with no way to invalidate all of a principal's sessions.
2. The client default session store is page-readable `localStorage` on
   the web ([auth.ts](../snapback4/packages/snapback4/src/auth.ts):55-67
   `defaultSessionStore`); the secure-enclave style backend is opt-in via
   a custom `SessionStore`. Any XSS (or shared-subdomain script) reads
   the Bearer [REDACTED] directly. The interface documents the choice, so this is
   hardening, not a surprise — but the secure default is one line away
   and the current default maximizes blast radius of the 90-day tokens
   from (1).

## Implementation locations

- [crates/snapback4-core/src/identity.rs](../snapback4/crates/snapback4-core/src/identity.rs) (`open_session`, `resolve`, `close_session`)
- [packages/snapback4/src/auth.ts](../snapback4/packages/snapback4/src/auth.ts) (`defaultSessionStore`, `SessionStore`)

## Suggestion

Rotate tokens on a schedule (or sliding expiry), add
revoke-all-for-principal plus per-session labels, and shorten the default
lifetime with a documented refresh path. On the client, prefer an
httpOnly-cookie or enclave-backed default where the platform allows, and
call out the `localStorage` tradeoff on the auth card. Tests: rotation
invalidates the old token; revoke-all logs out every device.
