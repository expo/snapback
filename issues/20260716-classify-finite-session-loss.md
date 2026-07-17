# Classify finite session expiry versus durable revocation

**Status:** Open
**Severity:** P1
**Systems:** Session auth, HTTP diagnostics, JavaScript client, Durable replay
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0059 §Typed terminal auth error
**Marker:** security, durability

Finite `SNAPBACK_AUTH_SESSION_EXPIRED` diagnostics collapse ordinary TTL/cap
carrier expiry with logout, family revocation, and reuse-driven durable
revocation. Missing classification previously made the browser delete durable
session custody even for an ordinary expired carrier.

**Done when:**

- Missing or malformed finite terminal metadata defaults to carrier-only
  blanking and never selects deletion.
- The server preserves enough committed cause to classify expiry/cap eviction
  as `carrier` and logout/family/reuse revocation as `durableDelete`.
- Exact closed disposition survives HTTP serialization.
- Tests cover ordinary expiry, cap eviction, logout, and family/reuse
  revocation.
