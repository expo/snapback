# Snapback 4: Sessions never rotate and the default store is page-readable

Status: Closed
Resolved: 2026-09-13
Priority: P2
Area: security
Observed: 2026-09-13
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Review provenance: Snapback4 comprehensive-review synthesis (2026-09-13 child review)
Related: [auth lock and rate limits](./20260913-snapback4-auth-engine-lock-and-rate-limits.md)

## Problem and reproduction

Ordinary bearer sessions lived for 90 days, never rotated, accumulated until
expiry, and had only single-token logout. The web client's default session
store persisted the bearer token in page-readable `localStorage`, increasing
the useful lifetime of a token exposed by an XSS or another script in the same
origin.

## Implementation locations

- [crates/snapback4-core/src/identity.rs](../../snapback4/crates/snapback4-core/src/identity.rs)
- [crates/snapback4/src/serve.rs](../../snapback4/crates/snapback4/src/serve.rs)
- [packages/snapback4/src/auth.ts](../../snapback4/packages/snapback4/src/auth.ts)
- [packages/snapback4/src/local.ts](../../snapback4/packages/snapback4/src/local.ts)

## Resolution — 2026-09-13

Ordinary guest and password sessions now have a short fixed lifetime. An
authenticated refresh atomically exchanges the current token and invalidates
the old one; self-service logout-all revokes every session for that principal.
Expired session rows are pruned during ordinary identity lifecycle work.
Service and application-minted sessions retain their explicit caller-selected
durations.

The browser default is now an in-memory `SessionStore`. Persistent
`localStorage` custody is an explicit opt-in helper whose documentation states
that same-origin script can read it; native applications continue to pass an
enclave-backed store. Refresh updates the kept session and observers before
later authenticated metadata, sync, and change requests.

Regressions prove that rotation kills the old token, logout-all kills multiple
tokens, expiry prunes dead rows, and the default store does not touch
`localStorage`. The exact integrated proof and independent-review evidence is
retained in the
[security remediation record](../../llp/reviews/3000-security-remediation-20260913.md).
