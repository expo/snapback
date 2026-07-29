---
title: Protecting live and retained data
id: auth.protecting-data
order: 2
audience: agent-first
capabilities: [auth.invalidation-barrier, auth.authorized-leases]
authorities: [llp/0053-authorization-invalidation.rfc.md, llp/0059-session-projection-and-client-barrier.spec.md, src/auth/invalidation.rs, src/auth/mode.rs, src/auth/service_fence.rs, src/local.rs, src/local/authorization_acceptance.rs, src/server.rs, demos/_kit/tests/auth-invalidation-client.mjs, packages/snapback-client/index.mjs, packages/snapback-contract/authorized-lease.mjs]
examples: [demos/card-game, demos/_kit/tests/auth-invalidation-client.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-26
reviewed-commit: HEAD
---

# Protecting live and retained data

> **Local target only.** These guarantees are witnessed on the canonical
> Ibex/SQLite target. Hosted auth is not available; see
> [target honesty](./targets.md).

Start with [sessions and principals](./sessions-and-principals.md) to sign in
and scope a query, or the [hidden-hands recipe](../recipes/hidden-hands.md) for
the shortest end-to-end example. This page is the systematic reference for
what happens after private data becomes live or retained.

## Check the negotiated capability, not route existence

`authProgramReadiness` in inspect reports separate build/runtime facts:
provider core, the shared invocation gate, staged mode, connection binding,
two-phase revocation, `AuthCoordinator`, authorization invalidation, authority
descriptors, authorized leases, and derived session-activation readiness.

The authenticated `client.authSession()` projection then reports what this
exact connection may use:

- `availability.onlineRequestResponse`;
- `availability.authScopedLive`, including the required invalidation protocol;
- `availability.retainedReads`, requiring invalidation **and** authorized
  leases; and
- `availability.queuedReplay`, requiring authority descriptors.

In sessions mode, an auth-scoped live subscription is admitted only when both
server and client negotiate `authInvalidationProtocol: 1`. Retained reads also
require `authorizedLeaseProtocol: 1`. A route present behind an unavailable
facet is not a supported capability.

Configure `SnapbackClient` with `authInvalidationProtocol: 1`; the client then
offers `x-snapback-auth-invalidation-protocol: 1` on finite live requests and
includes `authInvalidationProtocol: 1` when it opens a connection. A clean-room
HTTP client must send those same values itself. If Snapback answers
`SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED`, add the missing offer or
reopen a stale connection with it before retrying.

## Connection grants bind live work to authority

The string your app supplies as `connectionId` is a logical sharing label. On
open, Snapback returns a granted id, a secret connection token, and the exact
authorization-invalidation expectation:

```js source=demos/_kit/tests/auth-invalidation-client.mjs
      return response({
        connectionId: 'granted-auth',
        connectionToken: 'sct_auth',
        ephemeralExpiryProtocol: 1,
        wireVersion: 'snapback.v1',
        authorizationInvalidation: {
          protocolVersion: 1,
          issuerId,
          connectionGeneration: 2,
          authorization,
          versionStream: 'stream-A',
        },
      });
```

That grant is authority, not a bearer-shaped routing convenience. It is bound
to one anonymous authorization stream, one exact session generation, or one
scoped service-principal authority plus its exact token/deadline carrier. The
service form keeps the durable resolved authority separate from the token and
its service-publication fence, so ending one token cannot widen or silently
rebind the grant. Every live subscribe/resume, outbox drain, ephemeral act, and
publication validates the grant token and binding at its final effect fence.
HTTP sends the token in `x-snapback-connection-token`; browser WebSockets use
the negotiated `snapback.connection-token.*` subprotocol.

Every auth-scoped live subscribe also carries this closed
`authorizationNamespace` identity:

```js fragment reason="closed wire shape for clean-room client authors"
{
  clientStoreId: 'durable-store-id',
  queryKey: 'canonical-query-and-arguments',
  queryInstanceId: 1,
}
```

`clientStoreId` identifies the durable client store, `queryKey` is the
client's canonical query-plus-arguments key, and `queryInstanceId` is a
positive counter distinguishing successive materializations of that key.
`SnapbackClient` creates this object for its live-query path. Clean-room
clients must persist and advance the identity with their store rather than
minting all three fields per request. Omitting it is refused as
`SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED`.

An auth transition clears cached grants and reconnects under a fresh grant.
Never persist, copy between clients, log, or manually reuse a connection
token. Let one `SnapbackClient` multiplex consumers that intentionally share a
logical connection label.

## Authorization change is a persistent obligation

Logout is one visible case, but the barrier also covers permission or
membership changes, coarse authorization-version advances, activation/reset
boundaries, and protected ephemeral-room authority changes. A change that may
shrink a result raises a revisioned obligation against the exact live/query
scope.

The reachable-client sequence is:

1. The client receives the obligation and synchronously applies its maximum
   disposition—normally `quarantine`, sometimes terminal `delete`.
2. Live rows blank; retained reads block; optimistic/outbox custody for that
   scope suspends. Ordinary live frames cannot repopulate it.
3. The server resolves with a fresh satisfying snapshot or trusted terminal
   denial tied to the same scope/revision/witness.
4. The client atomically commits the disposition, snapshot or tombstone,
   queue/store resolution, and local boundary.
5. Only after that commit does it acknowledge the opaque resolution token.

Within one authenticated authorization-stream incarnation, a strictly greater
authorization epoch is the current obligation, not a stale subscribe
expectation. The client advances that exact fence before applying the
resolution. A lower epoch or different incarnation/version stream remains
stale and requires the normal replacement bootstrap.

The kit test pins the order:

```js source=demos/_kit/tests/auth-invalidation-client.mjs
  assert.deepEqual(order.slice(0, 3), [
    'queue-apply:1',
    'queue-resolve:1',
    'ack:ack_1',
  ]);
```

A lost delivery is safe because obligations are level-triggered state, not
one-shot events: connection open, subscribe/resume, drains, and heartbeats
re-project unresolved work. A stale acknowledgement re-quarantines; a duplicate
successful acknowledgement is idempotent. A queue/store failure leaves the
boundary blank and stale until the exact obligation re-fires with valid proof.

Protected ephemeral rooms use the same principle: affected sinks quiesce before
the authorization-changing commit becomes visible, then fresh room
reauthorization either admits the successor generation or revokes it.

## Retry is bounded and explicit

Automatic satisfying resnapshot attempts are bounded. Exhaustion leaves the
scope quarantined; reconnect or subscribe does not reset the episode. The
`POST /live/authorization-invalidation/manual-retry` operation is an
authority-checked recovery control that requires the current connection,
scope, and a fresh idempotency id. It is not an ordinary UI retry button and
cannot replace an episode before automatic attempts are exhausted.

Use normal client/barrier recovery first. Operator or acceptance tooling should
invoke manual retry only for a surfaced unresolved episode, keep the same
current authority, and treat capacity, clock-rollback, stale-scope, and denial
diagnostics as fail-closed outcomes.

## Authorized leases bound unreachable honest clients

An offline client cannot receive an obligation. Therefore every readable
auth-scoped retained snapshot needs a server-issued `AuthorizedLease`, bound to
the exact principal, authorization version, app/data version stream, active
artifacts, client store, query key, and query-instance id.

Lease acquisition is one full revalidation, not a heartbeat:

1. The client durably reserves a fresh `leaseRequestId` and records the request
   start against its clock high-water.
2. `authorizedLeaseQuery` performs the full query. At one server commit-order
   boundary, Snapback proves the app-data head, authority, active artifacts,
   and absence of a pending invalidation obligation.
3. The response carries the snapshot and lease together. The client validates
   its closed shape/bindings and atomically commits rows, witness, exact lease
   bytes/hash, and derived deadline before render.

```js source=packages/snapback-client/index.mjs
    return this.#req('POST', `/query/${encodeURIComponent(name)}/authorized-lease`, {
      args,
      auth: SnapbackClient.auth(userId),
      read_set: readSet,
      leaseRequestId,
      clientStoreId: namespace.clientStoreId,
      queryKey: namespace.queryKey,
      queryInstanceId: namespace.queryInstanceId,
    }, undefined, { expectedAuthorityCapture: authorityCapture });
```

V1 defaults to 24 hours and has a 24-hour hard maximum; configuration may only
shorten it. Session/provider expiries clamp the server deadline. The client
derives its deadline from the request-start clock plus the server-issued
duration, so network delay shortens validity rather than extending it.

Heartbeat, delta delivery, reconnect, acknowledgement, mutation, session
refresh, or presenting an old lease never renews it. Renewal is another full
query and atomic proof. At or beyond the exact client deadline—or on clock
rollback, malformed/missing lease, mismatched identity/witness/instance, stale
activation, or invalid request reservation—the store commits delete-before-read
for that query instance.

The server verifies the lease MAC because only it owns the key. The client
validates structure and bindings and hashes the exact bytes for custody
corruption detection; it cannot cryptographically authenticate a server MAC.

## Understand the threat boundary

The lease bounds an honest device that is temporarily unreachable. It is not
anti-tamper: a hostile client can alter its clock or read bytes it already owns.
If adversarial-client access to retained private bytes is in scope, do not
enable retained reads. A legitimate revocation may remain visible to an honest
offline device until its lease deadline; that is the explicit local-first
product tradeoff.

## Anti-patterns

- **Do not handle invalidation as an edge event.** Preserve the obligation
  until committed resolution and acknowledgement.
- **Do not ACK before the boundary/store commit.** Delivery is not discharge.
- **Do not render quarantined rows or allow ordinary frames to refill them.**
- **Do not treat reconnect as manual retry or lease renewal.**
- **Do not cache authorized rows outside the lease-enforcing client store.**
- **Do not infer hosted guarantees from the local readiness projection.**
