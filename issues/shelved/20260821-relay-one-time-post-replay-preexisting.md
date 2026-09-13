# Vite relay may replay pre-existing one-time POST routes after an ambiguous commit

**Status:** Open
**Opened:** 2026-08-21
**Systems:** Vite integration, Auth, Browser client, Retry semantics
**Related:** LLP 0030; LLP 0031;
issues/closed/20260820-vite-password-auth-relay-allowlist.md

## Problem

The Vite relay buffers request bodies and, after an upstream transport error,
may resolve a refreshed target and replay an allowlisted request once. A
connection reset cannot distinguish failure before the server received the
request from failure after the server committed its effect but before the
response reached the relay.

The password/recovery repair now marks its generated first-party routes
`retrySafe: false`, and its commit-then-drop regression proves that recovery
consumption commits exactly once. The older hand-maintained allowlist entries
still inherit `retrySafe: true` by default. At minimum, `/auth/exchange`
consumes a one-time challenge proof, so replaying it after an ambiguous commit
can turn a successful credential issuance whose response was lost into a
second, failed exchange. Other effectful auth, mutation, action, and asset
routes have not been classified one by one.

## This is pre-existing, not a regression

The replay-on-refresh behavior and `/auth/exchange` relay entry predate the
password/recovery route addition. The focused repair did not widen its
generated authority beyond the six newly admitted password/recovery routes;
it exposed the older relay-wide retry-classification gap while proving the new
routes do not inherit it.

## Requested repair

- Classify retry semantics for the complete relayed method/path authority
  instead of relying on a blanket `true` default for hand-maintained entries.
- Treat a route as replay-safe only when its server contract is idempotent for
  the same request or carries a tested idempotency identity.
- Add commit-then-drop regressions for `/auth/exchange` and every other route
  classified as one-time or non-idempotent, while preserving target-refresh
  replay for routes whose contract proves it safe.
- Keep the classification joined to the Rust route authority or another
  mechanically checked server-owned contract so a newly added relay route
  cannot silently acquire replay authority.

## Exit

Every allowlisted non-read request has a checked retry classification. A
commit-then-drop witness proves that each one-time/non-idempotent request is
forwarded at most once, and retry-safe requests retain the managed-backend
restart recovery behavior.
