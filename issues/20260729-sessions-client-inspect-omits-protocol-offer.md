# Sessions client inspect omits the auth-client protocol offer

**Status:** Open
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
