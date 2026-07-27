# `@snapback/client` has no supported way to use an externally-minted session bearer

**Filed:** 2026-07-26 · **Source:** building `demos/partitime/backends/snapback`
**Status:** Resolved 2026-07-26

## What happened

An app that mints a Snapback session through its own front door (because the
local target's email-code capture mailbox is admin+impersonation gated and
therefore unreachable from a browser or phone) has a valid bearer and nothing
to do with it. `SnapbackClient` only emits
`x-snapback-auth-client-protocol: 1` when it owns an `AuthCoordinator` or an
`AgentAuthorityFence` (`packages/snapback-client/index.mjs`: `authClientProtocol`
v1 "requires browser or agent authority custody"). Handing it the bearer via
the documented `setBearerToken()` escape hatch produces, verified:

```
setBearerToken ok
query me    FAILED: SNAPBACK_AUTH_POLICY_UNAVAILABLE
                    the request does not offer the exact supported auth-client protocol
liveQuery   FAILED: SNAPBACK_AUTH_POLICY_UNAVAILABLE
```

`setBearerToken` is documented as "the uncoordinated legacy/dev surface", so
this may be intended — but the consequence is that the first-party JS arm,
`@snapback/react`, and the Contract adapter are all unusable by any application
that does not use the built-in email-code ceremony end to end.

## Impact

The Partitime Snapback cell is the reference backend for a 30-cell comparison;
seven of its nine client cells are JS/TS. It had to ship a hand-written
zero-dependency protocol client
(`demos/partitime/backends/snapback/client.mjs`, ~330 lines) so those cells are
not blocked.

## Fix candidates

1. `AuthCoordinator.adopt(credential)` — install an externally-obtained
   credential under coordinator custody, so refresh/logout/barrier still work.
2. An explicit `authClientProtocol: 1` + `bearerToken` construction that is
   supported (not "legacy/dev"), documented in `guide/clients/headless.md`.

## Resolution

Fix candidate 2 landed as
`createExternalSessionClient(baseUrl, { bearerToken })`. The constructor
requires a non-empty explicit bearer, excludes coordinator/agent/sender-bound
custody, and forces the exact auth-client, auth-invalidation, and authority-
descriptor v1 offers. Generic protocol-v1 construction without any custody
owner remains rejected.

The online entry point re-exports the factory, the headless/native-auth guides
document ordinary bearer custody and its non-production boundary, and the
auth-handshake suite proves that the bearer and exact offer headers reach the
wire.
