---
title: The headless client
id: clients.headless
order: 1
audience: agent-first
capabilities: [clients.headless]
authorities: [llp/0012-headless-integration-contract.spec.md, demos/_kit/client.mjs, demos/todo/tests/acceptance/headless.mjs, demos/card-game/tests/acceptance/authority-scope.mjs]
examples: [demos/todo, demos/todo-v2, demos/graffiti, demos/card-game]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-16
reviewed-commit: HEAD
---

# The headless client

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`SnapbackClient` in `demos/_kit/client.mjs` is the framework-neutral
reference arm. Demos, acceptance suites, the React arm, and
`@snapback/contract` build on the same transport, live-stream, ephemeral,
receipt, and auth behavior rather than reimplementing HTTP.

## Construct one client per backend and custody context

```js source=demos/_kit/client.mjs
  constructor(baseUrl, {
    adminToken = (typeof process !== 'undefined' && process.env ? process.env.SNAPBACK_ADMIN_TOKEN : null) ?? null,
    bearerToken = null,
    authClientProtocol = null,
    authInvalidationProtocol = null,
    authorityDescriptorProtocol = 1,
    authorizedLeaseProtocol = null,
    authCoordinator = null,
    agentAuthority = null,
    clientStoreId = processClientStoreId,
```

`baseUrl` is the running server. `adminToken` is only for explicit
development/operations methods. In sessions mode, pass an
`AuthCoordinator`; do not also pass `bearerToken`, because that would
bypass coordinator custody. `clientStoreId` binds authorization and retained
query namespaces to one durable client store.

CLI and daemon agents use `AgentAuthorityFence`, not the browser
`AuthCoordinator`. Construct it from the scoped-token mint response plus its
actor id, then pass it as `agentAuthority` with
`authInvalidationProtocol: 1`. Replace an expiring token only through
`replaceAgentCredential(...)`: the fence preserves the durable
actor/credential-generation/grant axis, invalidates the old token carrier, and
forces a fresh handshake before more work can publish. A changed grant or
credential generation clears the bound descriptor, so queued work from the
predecessor cannot migrate to the successor authority.

Start app boot with `health()`, then
`ensureApp({ schema, functions, seed })`. Ensure is idempotent: it provisions
only missing/mismatched artifacts and seeds only empty tables. Never reset as a
mount side effect.

## Call ordinary functions

`query(ref, { args, userId, readSet })`,
`mutate(ref, { args, userId, readSet, ... })`, and
`action(ref, { args, userId, readSet })` accept a generated function reference
or name. In sessions mode the server accepts no caller-selected identity—the
coordinator repeats the session bearer and the server resolves authority.

Mutation responses carry `result`, `changed_count`, `version`, and a
terminal receipt. The client records receipts before returning or rethrowing;
read them with `receipts()` or subscribe with `onReceipt(listener)`.

## Subscribe to durable state

`liveQuery(ref, options)` is the author-facing composite. It performs the
snapshot-with-subscribe operation and returns a handle with `rows`,
`version`, `connection`, `poll()`, and `dispose()`:

```js source=demos/todo/tests/acceptance/headless.mjs
    const handle = await db.liveQuery(api.listTodos, { connectionId: 'client_a', userId: ADA });
    assertEqual(handle.rows.length, 3, 'snapshot rows');
```

Use `transport: 'stream'` for managed WebSocket push; the manager multiplexes
all durable and ephemeral consumers sharing a `connectionId`. Consume
`onUpdate`, `onConnectionChange`, subscription events, and authorization
callbacks instead of reading socket internals. Always dispose the handle.

The lower-level `subscribeLive` / `unsubscribeLive`, `openLiveStream`,
`liveStreamManager`, and drain methods exist for adapters and acceptance
harnesses. App UI code normally uses `liveQuery`.

## Subscribe to ephemeral state

`subscribeEphemeral(ref, { connectionId, scope, ... })` returns an overlay
whose `currentEntries()`, `onChange`, `publish`, `delete`, and
`dispose` methods implement the snapshot/delta/expiry contract.
`publishEphemeral`, `deleteEphemeral`, and `unsubscribeEphemeral` are the
lower-level transport operations. See the
[presence recipe](../recipes/presence-cursors.md) for the paved feature and
[ephemeral-state reference](../realtime/ephemeral-state.md) for the complete
declaration, overlay, and recovery contract.

## Enter and leave session authority

The session entry points are:

- `authRequestCode(email)` and `authExchange({ challengeId, code })`;
- `authRefresh()` and `authLogout()`;
- `authSession({ force })` for the exact server/mode/authority projection;
- `closeAuth()` to unregister/close the client-side auth participants;
- `currentAuthorityDescriptor()` and `currentAuthorizationScope()` for
  adapter fences;
- `registerAuthBarrierParticipant(participant)` for a state owner that must
  quiesce, blank, durably clear/quarantine, and resume with the coordinator.

`setBearerToken` and `clearAuthSession` support the uncoordinated legacy/dev
surface. Do not use them to bypass an `AuthCoordinator`.
`captureAuthority` / `authorityCaptureFor` are adapter-level stale-work
fences. `authorizedLeaseQuery` is the only lease-renewal query path;
`acknowledgeAuthorizationInvalidation` closes the live authorization barrier.

## Complete public method inventory

This is the complete `SnapbackClient` public surface; methods are grouped by
intent so source additions cannot hide as “advanced” APIs:

| Area | Methods |
| --- | --- |
| Construction/static helpers | `constructor`, `AgentAuthorityFence`, `SnapbackClient.auth`, `SnapbackClient.roomPermission` |
| Discovery | `health`, `inspect` |
| App/admin lifecycle | `ensureApp`, `loadSchema`, `loadFunctions`, `ensureEphemeralCollections`, `reset`, `seed`, `cronTick` |
| Function calls | `query`, `authorizedLeaseQuery`, `mutate`, `action`, `acknowledgeMutations` |
| Durable live | `liveQuery`, `subscribeLive`, `unsubscribeLive`, `openLiveStream`, `liveStreamManager`, `acknowledgeAuthorizationInvalidation` |
| Ephemeral | `subscribeEphemeral`, `publishEphemeral`, `deleteEphemeral`, `unsubscribeEphemeral` |
| Connections/drains | `connectionGrant`, `refreshConnectionGrant`, `disconnect`, `drainEnvelopes`, `drainConnection`, `drainUpdates`, `registerDurableConsumer`, `registerEphemeralConsumer` |
| Receipts | `recordReceipt`, `receipts`, `onReceipt` |
| Session/auth | `authSession`, `authRequestCode`, `authExchange`, `authRefresh`, `authLogout`, `closeAuth`, `setBearerToken`, `replaceAgentCredential`, `clearAuthSession`, `currentAuthorityDescriptor`, `currentAuthorizationScope`, `captureAuthority`, `authorityCaptureFor`, `registerAuthBarrierParticipant` |

The overlay returned by `subscribeEphemeral` and the live handle returned by
`liveQuery` are separate owned objects with their own methods and disposal
lifecycle; they are not additional client methods.

## Anti-patterns

- **Do not hand-wire fetch calls to app-data routes.** Use this arm so
  authority, diagnostics, receipts, and connection grants stay consistent.
- **Do not use admin lifecycle methods from ordinary UI events.** Provision
  idempotently at boot; reserve reset/tick/load primitives for dev/ops/tests.
- **Do not treat `openLiveStream` as the ordinary subscription API.** Use
  `liveQuery({ transport: 'stream' })` unless writing an adapter.
- **Do not reuse a connection id across unrelated custody/lifecycle owners.**
- **Do not forget `dispose()` / `closeAuth()`.** Handles, overlays, and
  coordinator participants own resources.
