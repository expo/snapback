# Vite Snapback relay omits first-party password and recovery routes

**Status:** Open
**Opened:** 2026-08-20
**Systems:** Vite integration, Password auth, Browser client, Guide
**Related:** LLP 0277 P14; LLP 0295; diaries 0094, 0095, 0098, 0099,
0102, 0103

## Problem

`@expo/snapback-vite@0.1.24`'s `__snapback` relay admits application-data
and live routes but refuses the first-party `/auth/password/*` and
`/auth/recovery/*` routes used by the documented password client. Independent
Coterie lanes added pre-Vite middleware or split password calls onto the
backend origin. The split then caused CORS, post-issuance handshake, and
live-stream origin correction loops.

## Requested repair

- Add the exact first-party password/recovery method-and-path set to the
  maintained relay registry, derived from the same route authority rather than
  transcribed into a second allowlist.
- Preserve credential/no-store and body-handling policy; do not add a broad
  `/auth/*` proxy.
- Add an external packed-package Vite test proving signup, sign-in, recovery,
  logout, and an already-armed live query through one page origin.
- Link the Contract adapter and Vite guide pages to that supported lifecycle.

## Exit

A published-package browser app using the generated binding performs the
complete password lifecycle and live data over the Vite origin without custom
middleware or a direct-backend auth exception.
