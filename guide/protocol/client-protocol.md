---
title: Client protocol
id: clients.protocol
order: 1
audience: agent-first
capabilities: [clients.protocol]
authorities: [llp/0093-client-protocol-and-native-clients.rfc.md, llp/0094-wire-envelope-contract.spec.md, llp/0095-client-lifecycle-and-conformance.spec.md, llp/0096-auth-profiles-for-protocol-clients.spec.md, schemas/live.envelope.schema.json, schemas/live.socket-server.schema.json, schemas/live.wire-fixtures.v1.json]
examples: [clients/swift/SnapbackClient]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-26
reviewed-commit: HEAD
---

# Client protocol

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use this page when a platform cannot run `@snapback/client`. The committed JSON
Schemas are the exact wire shapes; the
[`snapback.v1` fixture corpus](repo:schemas/live.wire-fixtures.v1.json) is the
language-neutral conformance entry point. The protocol does not make a client
safe by itself: lifecycle, demand release, auth invalidation, and retries are
part of conformance.

## Choose a delivery lane

- `poll/local`: open a connection, subscribe, and drain
  `GET /outbox/{connectionId}` on one non-overlapping declared cadence.
- `live/local`: open a connection, subscribe, and attach
  `GET /live/{connectionId}/stream` as a WebSocket.
- `live/hosted`: specified, but each hosted target must prove it separately.
- `poll/hosted`: not claimable. Hosted demand is socket-owned today.

Both local lanes begin with `POST /connection/open`. Offer
`wireVersion: "snapback.v1"` and carry the returned connection token on every
connection-scoped request. A WebSocket offers `snapback.v1` plus
`snapback.connection-token.<token>` as subprotocols.

`@snapback/client` verifies the open response echoes that exact version. Its
compatibility bridge downgrades only when the exact pre-B1 decode refusal
disappears on one offerless retry, or when an offered hosted open succeeds
without the B1 echo; either case emits a structured diagnostic and is cached
per endpoint. Set `strictWireVersion: true` to refuse any unproven legacy
binding instead of using the bridge.

## Keep the envelope families distinct

The casing differences are wire contract, not style:

| Family | Where | Tag and casing |
| --- | --- | --- |
| `LiveEnvelope` | durable updates | `kind`, mostly `snake_case` |
| `LiveSocketServerFrame` | socket control | `kind`, mostly `camelCase` members |
| `RealtimeEnvelope` | HTTP drain wrapper | externally tagged `Durable` / `Ephemeral` |

Socket durable frames are unwrapped. HTTP drain durable frames are byte payloads
inside `{"Durable": {"payload": [...]}}`; decode the bytes, then dispatch the
inner `LiveEnvelope`. Unknown kinds and unknown fields are skipped. A known kind
missing required fields after the drain ownership cut is data loss and forces
connection-wide resync.

## Apply versions and recover deliberately

Track the last applied version per subscription. Drop an ordinary
`live_replace`, `live_delta`, or `current_as_of` whose version is not newer.
Apply delta operations by row id. `resync_required` re-enters the named
subscription through fresh snapshot-with-subscribe; an absent subscription id
means every subscription and retained ephemeral overlay must resync.

The socket has an application heartbeat: send `{"type":"ping"}` every five
seconds and require a `pong` or other activity inside the 15-second freshness
budget. A missed budget forces socket loss and reconnect. Reconnect is always a
fresh subscribe with `supersedes`; it is not implicit resume.

On mobile, do not infer death from a quiet socket. Backgrounding explicitly
releases demand and quiesces transport. Foregrounding reconnects and performs
fresh snapshot-with-subscribe. The
[Swift client](../clients/swift.md) exposes this as
`pauseForBackground()` / `resumeAfterForeground()`; JS live-query handles use
`pause()` / `resume()`.

## Offer session auth exactly

A client holding a Snapback session bearer repeats
`x-snapback-auth-client-protocol: 1` on authenticated request/response work.
This includes `POST /connection/open`: the route is Public for credential
classification, but sessions mode still applies the `auth/rr` capability gate.
Auth-scoped live additionally requires:

1. `authInvalidationProtocol: 1` in `POST /connection/open`;
2. `x-snapback-auth-invalidation-protocol: 1` on every live subscribe and
   unsubscribe (a client cannot infer target independence);
3. a stable `authorizationNamespace` with `clientStoreId`, `queryKey`, and
   positive `queryInstanceId`; and
4. handling `authorization_invalidation` as the primary row-delivery lane.

Apply the invalidation frame's camelCase `snapshot` atomically, then POST
`{connectionId, ackToken}` to
`/live/authorization-invalidation/acknowledge`. Never acknowledge a snapshot
that was not applied. A duplicate redelivery whose version is already held is
safe to acknowledge again; do not regress rows.

Session mode rejects client-selected identity in bodies. Carry the bearer in
`Authorization`; omit `auth.user_id`.

After connection open, connection-scoped HTTP and WebSocket routes authenticate
the returned connection grant and ignore a session bearer. A changed identity
therefore opens a fresh grant and establishes fresh subscriptions; replacing a
bearer on an old connection cannot change its bound authority.

## Release demand

Normal shutdown and backgrounding unsubscribe explicitly. Socket close releases
server demand, and the local idle reaper is a crash backstop, not a lifecycle
API. There is exactly one drain owner per connection.

## Anti-patterns

- Do not normalize the mixed casing.
- Do not pass bearer or connection tokens in URLs.
- Do not treat a quiet socket as dead without heartbeat evidence.
- Do not handle only `live_replace`; auth-scoped rows arrive through
  `authorization_invalidation`.
- Do not claim a lane/target tuple that the fixture corpus and a live witness
  did not prove.
