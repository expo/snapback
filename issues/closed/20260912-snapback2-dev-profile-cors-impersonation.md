# snapback2 dev profile: ACAO * + unauthenticated X-Snapback-As + persona auto-mint

**Status:** Resolved
**Priority:** P0 (any visited site reads loopback and acts as anyone — dev profile)
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/snapback2/src/serve.rs:662`, `:751`; `snapback2/crates/.../identity.rs:298`

## What was reported

In the dev profile three weaknesses compose:

- `:662` — dev emits `Access-Control-Allow-Origin: *` on JSON + SSE.
- `:751` — any `X-Snapback-As` value accepted with **no secret**.
- `identity.rs:298` — `ensure_persona` does `INSERT OR IGNORE`,
  auto-minting any persona.

Net: any website visited by a dev running the dev-profile owner can read
loopback responses and act as / mint any persona. Scope is dev-profile,
but dev profiles routinely hold real data.

## Suggested fix

- No `*` (reflect the loopback origin or omit CORS entirely), require a
  secret (or disable `As` outside test owners), no auto-create (explicit
  persona provisioning).
- Reproduce with a cross-origin fetch proof-of-concept before/after.

## Acceptance

- Cross-origin PoC fails after the fix; dev-profile CORS/identity tests
  cover the three legs.

## Resolution (2026-09-12)

Dev reflects only validated literal loopback origins, emits Vary: Origin, and rejects other origins before identity resolution. Browser persona requests (Origin or Sec-Fetch-Site) are refused before auto-mint, including from allowed loopback origins; persona/control headers are excluded from CORS admission. Local no-Origin CLI and journey personas retain their documented behavior. Unit admission tests and the integrated raw owner boundary test pass.
