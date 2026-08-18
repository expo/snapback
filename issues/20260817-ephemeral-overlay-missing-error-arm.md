# Client overlay never surfaces the ephemeral terminal Error frame (removal looks like a silent stall)

**Opened:** 2026-08-17
**Source:** membership-backed ephemeral slice 3 (Q5 check of the design in
issues/20260817-ephemeral-membership-permission-backing.md); five-scenario
sessions battery in demos/messaging-snapback

## Defect

When a member is removed from a membership-backed protected room, the server
side is correct: survivors receive `RemoveReason::AuthRevoked`
(crates/snapback/src/ephemeral.rs:~5702) and the removed subscriber receives a terminal
`PermissionDenied` error frame with no further delivery
(crates/snapback/src/ephemeral.rs:~5757; the battery pins `postTerminalFrames: 0`).

The client never surfaces that terminal:

- `packages/snapback-client/index.mjs:~18382` recognizes `Error` as an
  ephemeral envelope, but
- `EphemeralOverlay.apply()` (index.mjs:~17900) has arms for
  snapshot/upsert/remove/resync and NO `Error` arm — it falls through to
  `not_ephemeral` without notifying listeners,
- so the room handle receives no terminal transition and retains its prior
  status/diagnostic. React presence and the LLP 0257 activity-presence hook
  pass status/diagnostic through faithfully
  (packages/snapback-react/implementation.mjs:~5776), but the base client
  never updates them.

Net effect: a removed member's typing/presence UI silently stalls in its
last ready/empty state instead of surfacing terminal `status`/`onError`.
LLP 0257 requires base status/diagnostic passthrough and observable refusal
(llp/0257-activity-scoped-presence-convenience.rfc.md:~194).

## Wanted

Add the `Error` arm to `EphemeralOverlay.apply()`: transition the room
handle to a terminal errored status carrying the frame's diagnostic
(`SNAPBACK_AUTH_PERMISSION_DENIED` / `AuthRevoked` semantics per LLP
0013:626-631), notify listeners once, and stop further application. Extend
the sessions battery's removal scenario (demos/messaging-snapback
tests/acceptance/headless.mjs, the terminal-removal scenario) to assert the
overlay/hook surfaces the terminal state instead of only the wire-level
silence.

## Coordination

The client authorization-invalidation surface is under active concurrent
work (public-wiper dispatch gates, authority lifecycle hooks); whoever owns
that lane should take this to avoid collision. The guide typing-indicator
recipe (slice 5 of the membership-backed ephemeral program) documents the
gap honestly until this lands.
