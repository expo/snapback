# Vite Snapback relay omits first-party password and recovery routes

**Status:** Closed
**Opened:** 2026-08-20
**Closed:** 2026-08-21
**Landing SHA:** 97b628ae7 (with replay-safety follow-up 4e9b589b5)
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

## Resolution

The Vite package now ships a generated projection of the server's installed
`route_registry()` authority. It selects only AppData registrations under
`/auth/password/` and `/auth/recovery/`; the JavaScript relay imports those
exact method/path entries and retains exact matching for every request. No
prefix proxy was added, and the existing header, credential response,
no-store, body-buffering, and retry behavior remains unchanged.

The Contract adapter and Vite authoring-loop pages now point readers to the
same-origin password/recovery lifecycle.

## Verification

- Before the repair, the packed external Vite fixture received HTTP 403
  `SNAPBACK_DEV_PROXY_ROUTE_REFUSED` for
  `POST /__snapback/auth/password/signin`.
- After the repair, that fixture installs only packed package tarballs, uses
  the generated relative binding, and completes live subscribe/update,
  signup, logout, sign-in, logout, recovery consumption, and final logout
  through one Vite page origin without custom middleware or a direct-backend
  auth exception.
- The relay matrix admits the six generated POST routes and continues to
  refuse wrong methods, unknown password/recovery paths, generic `/auth/*`,
  and privileged auth routes.

## Exit

A packed-package browser app using the generated binding performs the complete
password lifecycle and live data over the Vite origin without custom
middleware or a direct-backend auth exception.
