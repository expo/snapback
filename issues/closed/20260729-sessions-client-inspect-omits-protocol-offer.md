# Sessions client inspect omits the auth-client protocol offer

**Status:** Resolved (2026-07-30)
**Area:** JavaScript client, Sessions auth, Inspection
**Found by:** LLP 0102 Research Room/Snapback remediation rerun
**Date:** 2026-07-29
**Governing:** LLP 0039, LLP 0058, LLP 0102

## Problem

In sessions mode, the official client can perform ordinary authenticated
queries, mutations, actions, and subscriptions, but `SnapbackClient.inspect()`
does not offer `x-snapback-auth-client-protocol: 1`. Public `/inspect`
therefore rejects the method's request even though the same client is already
operating under the sessions profile.

The Research Room confirmation had to issue the public request directly with
the protocol header. Sensitive `/_snapback/api/inspect` correctly returned 401
without a separate secret-read lease and is not an acceptable workaround.

## Required outcome

- The public client inspection method negotiates every supported active auth
  profile in the same way as ordinary client requests.
- Sensitive operator inspection remains separately authorized and is never
  silently substituted.
- A typed diagnostic distinguishes a missing auth-client protocol offer from a
  missing operator lease.

## Evidence

- `demos/backend-bakeoff/arms/research-room/snapback/remediation-2-handoff/commands-and-failures.v1.json`
- `demos/backend-bakeoff/arms/research-room/snapback/remediation-2-handoff/schedule-steps.v1.json`
- `diaries/0031-research-room-backend-bakeoff.diary.md`

## Acceptance

A fresh sessions client calls its official public inspection method without
hand-authoring protocol headers and receives the served public projection.
The same client cannot read the sensitive operator projection until it holds
the exact secret-read lease, and both refusals remain value-free.

## Resolution

**Date:** 2026-07-30

The header-emission half of this ticket had already landed on main
(commit `90e13112`, 2026-07-27): `SnapbackClient.inspect()` passes
`#authOfferHeaders(false)`, the same offer/bearer builder ordinary sessions
requests use, so the exact `x-snapback-auth-client-protocol: 1` offer rides
the public inspection request with no hand-authored headers. The bakeoff
rerun that filed this ticket exercised the frozen pre-fix client.

What remained — and was fixed here — was a client-side availability defect
the evidence masked: on a *fresh signed-out* browser-custody sessions client
(`authCoordinator` present, no settled record), `inspect()` failed before any
network request with `SNAPBACK_CLIENT_AUTHORITY_CLEARING`, because
`#request` unconditionally re-captured settled custody for coordinator
clients even on handshake-exempt public bootstrap paths. `#request` now
demands settled custody only when a handshake ran, a capture already exists,
or the path requires the handshake; handshake-exempt public probes
(`/health`, `/inspect`) proceed anonymously with the same protocol-offer
headers and no bearer (`packages/snapback-client/index.mjs`, annotated
`@ref LLP 0058#bootstrap-handshake`).

The typed-diagnostic distinction already existed server-side and is now
pinned by tests: public `/inspect` without the offer refuses HTTP 400
`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` (message names the repair
header); sensitive `/_snapback/api/inspect` without the operator lease
refuses HTTP 401 `SNAPBACK_ADMIN_SECRET_READ_REQUIRED`. The sensitive twin
is never substituted for the public projection, and neither refusal carries
application values.

**Verified by:**

- `demos/_kit/tests/auth-handshake.mjs` (extended, 22/22): the official
  `inspect()` emits the exact offer with no hand-authored headers for both
  fresh signed-out custody (offer, no bearer) and settled sessions custody
  (offer plus custody bearer), with no handshake round-trip.
- `packages/snapback-cli/sessions-dev-loop.test.mjs` (extended, real
  sessions-mode server on the built binary): a fresh sessions client's
  `inspect()` returns the served public projection (trimmed — no storage
  path); an offerless raw request refuses 400
  `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` value-free; the sensitive
  operator projection without the secret-read lease refuses 401
  `SNAPBACK_ADMIN_SECRET_READ_REQUIRED` value-free; the two refusal codes
  are asserted distinct.
- Full `packages/snapback-client/*.test.mjs` suite (20 files) and the auth
  kit suites pass; `./ref-check --verbose` clean.
  (`demos/_kit/tests/auth-invalidation-client.mjs` fails identically with
  and without this change on this machine — pre-existing, unrelated.)
