# snapback2 bearer carriers: localStorage + 30-day no-rotation + URL ?s=

**Status:** Closed
**Priority:** P1 (credential theft window)
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `templates/react/main.tsx:8`; `guide/.../auth.md:23`; `snapback2/crates/.../identity.rs:15`, `:314` (`authenticate`); `snapback2/crates/snapback2/src/asset_http.rs:376`

## What was reported

- The starter persists the bearer in `localStorage` (`main.tsx:8`,
  `auth.md:23`); sessions are 30-day fixed (`identity.rs:15`) and
  `authenticate():314` never rotates or extends — any XSS steals a
  maximal-window credential.
- `asset_http.rs:376` carries an asset bearer-equivalent in the URL
  (`?s=`): history/logs/proxy exposure (partly mitigated by existing
  no-store/no-referrer usage — verify).

## Suggested fix

- Offer an httpOnly-cookie session option, rotation/sliding expiry, and
  document `SecureStore` (native) vs. cookie (web) guidance in the starter.
- Move the asset carrier to a header/cookie, or document and bound the
  URL-carrier exposure explicitly.

## Acceptance

- Starter no longer models localStorage-bearer as the happy path; session
  rotation covered by tests; asset-carrier exposure decided and recorded.

## Resolution (2026-09-11)

Web starters now select sessionStorage; Expo keeps SecureStore. Issued bearer
sessions expire after 24 hours. `client.auth.refresh()` and each starter's Renew
session action rotate the credential atomically through `/api/auth/refresh`,
immediately rejecting the previous token while preserving principal, auth epoch,
live leases, and offline custody. Refresh is explicit: automatic rotation would
create avoidable races between clients sharing a token and ambiguous response
loss. A lost refresh reply or failed token persistence requires login again; a
guest cannot recover a lost credential.

This deliberately does not claim HttpOnly/XSS isolation: sessionStorage remains
JavaScript-readable, and an attacker holding a live bearer can refresh it. The
short expiry bounds an unrefreshed credential, not repeated attacker renewal.
These tradeoffs and recovery behavior are recorded in LLPs 1001/1002 and the auth
guide.

Asset URL carriers remain supported for native media controls, with ten-minute
expiry, 1,024 owner-wide and 32 per-principal caps, reuse, periodic/mint sweeping,
and epoch logout revocation. Delivery retains no-store/no-referrer protections.
LLP 1006 and the guide document URL transferability, browser history and proxy
log exposure, redaction, and preference for Authorization where supported.

Verification:

- Integrated core identity tests passed: one-day expiry, old-token rejection,
  same principal/epoch, restart persistence, and logout after rotation.
- Integrated writer-auth tests passed: existing streams/carriers survive refresh;
  carrier caps/sweeps and epoch expiry/logout still apply.
- Integrated served-owner suite passed 11/11 (32.46s), including actual refresh
  with live query/channel leases and old-token me/logout rejection.
- Auth-custody TS suite passed 35/35, including delayed old-token 401 and failed
  refresh-token persistence. Focused starter tests exercise the Renew buttons.
- File, IndexedDB, and SQLite offline-carrier regressions retain held rows and
  queued intents through same-epoch refresh.
- Integrated raw asset roundtrip passed (23.93s); package build passed with
  32 guide cards at 98,201/98,304 bytes. Reference validation reported 0 errors.
