---
title: The headless client
id: clients.headless
order: 1
audience: agent-first
capabilities: [clients.headless, clients.external-store]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0064-native-client-surfaces.rfc.md, packages/snapback-client/index.mjs, packages/snapback-client/online.mjs, packages/snapback-client/external-store.mjs, packages/snapback-client/agent-authority.mjs, demos/_kit/agent-authority-filesystem.mjs, packages/snapback-contract/index.mjs, packages/snapback-contract/lifecycle-generation-exhaustion.test.mjs, demos/todo/tests/acceptance/headless.mjs, demos/card-game/tests/acceptance/authority-scope.mjs]
examples: [demos/todo, demos/todo-v2, demos/graffiti, demos/card-game, demos/partiful-matrix/surfaces/vanilla]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-23
reviewed-commit: HEAD
---

# The headless client

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`SnapbackClient` from the versioned `@snapback/client` package is the
framework-neutral reference arm. The old `demos/_kit/client.mjs` path is a
compatibility re-export only. Demos, acceptance suites, the React arm, and
`@snapback/contract` build on the same transport, live-stream, ephemeral,
receipt, and auth behavior rather than reimplementing HTTP.

Browser bundles that load a client entry as a dynamic module namespace should
import `SnapbackClient` from `@snapback/client/online`. It re-exports the same
class while keeping optional agent-custody and external-store package exports
out of consumers that did not select them. Use the root entry when those
additional exports are required.

## Construct one client per backend and custody context

```js source=packages/snapback-client/index.mjs
  constructor(baseUrl, {
    adminToken = (typeof process !== 'undefined' && process.env ? process.env.SNAPBACK_ADMIN_TOKEN : null) ?? null,
    bearerToken = null,
    authClientProtocol = null,
    authInvalidationProtocol = null,
    authorityDescriptorProtocol = 1,
    authorizedLeaseProtocol = null,
    authCoordinator = null,
    agentAuthority = null,
    senderConstrained = false,
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
`replaceAgentCredential(...)`. The client first offers the proposed bearer to
`GET /auth/session` without changing custody, verifies the exact returned
service-principal descriptor, and only then begins the transition. A rejected
or mismatched proposal leaves the predecessor custody record and its queued
work unchanged. A same-tuple replacement preserves the durable
actor/credential-generation/grant axis while invalidating the old token
carrier; a changed tuple deletes predecessor state before publishing the
validated successor. In either case, no successor result can publish until an
exact final custody comparison succeeds.

Long-running Node CLI and daemon processes should import
`createFilesystemAgentAuthorityCustodyStorage` directly from
`demos/_kit/agent-authority-filesystem.mjs` and pass its result plus a stable
`custodyId` to `AgentAuthorityFence`. The factory requires an absolute private
state directory. It creates 0600 atomic custody files under a 0700 directory,
serializes independent processes with a bounded OS advisory lock, and never
persists the scoped-token bearer or carrier id. This is a Node-only import;
browser code continues to import the portable client arm without filesystem
dependencies. The first handshake, restart adoption, and interrupted-transition
recovery all require the server-issued descriptor proof; plain synchronization
cannot claim an unvalidated durable tuple. Treat the state directory and
`custodyId` as stable deployment identity, not as per-process temporary state.

The adapter validates the directory once and retains its exact POSIX inode in a
dedicated helper. SQLite locking, record reads, temporary writes, rename,
cleanup, and directory fsync all use single-component names relative to that
kernel-held directory, so replacing the configured pathname cannot redirect a
commit. A helper crash releases both the lock and the only possible writer; the
current process then fails closed until restart instead of reopening the path.
Keep the configured-directory set small: one process retains at most 32 such
capabilities and refuses the next one with
`SNAPBACK_AUTH_CUSTODY_DIRECTORY_CAPABILITY_LIMIT`.

The directory must be a normalized absolute path to an effective-user-owned
`0700` directory. The adapter rejects untrusted symlink components, unsafe
ancestor owners/ACLs, hard-linked or non-`0600` custody files, and records over
64 KiB. Under each primary, ledger-root, bucket, or migration-witness partition
lock it removes only validated files in that exact record's temporary
namespace: one deterministic `<record>.tmp` sidecar capped at 64 KiB.
`maintenanceSnapshot()` reports the last exact cleanup; partial-cleanup failures use the
exported `SNAPBACK_AUTH_CUSTODY_ORPHAN_*` diagnostics. A ledger/migration scan
examines at most 4,096 directory entries and fails closed with
`SNAPBACK_AUTH_CUSTODY_PARTITION_SCAN_LIMIT` above that operator-rotation
boundary. Do not share the directory with another Unix account. The retained
capability closes directory-name ABA, but it does not protect against a
malicious same-uid process mutating entries inside the pinned inode.

Durable deletion records the exact actor/credential-generation/grant tuple in
a bounded terminal ledger. By default the ledger has 64 deterministic buckets
of at most 64 exact entries; it stores no bearer, token id, or carrier id. If a
bucket fills, the root becomes globally `closed` and every tuple is refused —
Snapback never evicts an entry or risks reopening an old validated descriptor.
Call `await agentAuthority.inspectCustody()` for redacted operations data:
format/state, unique witness count, stored ledger bytes, capacity, the 75%
total and per-bucket warning thresholds, largest bucket count, and a warning
bit. It does not return tuple identities, and closed state always warns.

Upgrading from tuple-specific v1 witness files is automatic and crash-safe
under the universal custody gate. Until the primary moves to format 2, new
terminal facts are written to the v1 journal first so an interrupted old reader
still sees them. Once the bucket ledger is active (or closed), Snapback cuts the
primary to format 2, retires each identified journal JSON and lock file, and
writes the legacy-cut cleanup seal last. Steady v2 gates do not scan the shared
directory. They derive and strictly inspect only a candidate tuple's exact v1
filename, so an unidentifiable malformed related witness still fails that
candidate closed, while malformed unrelated files are isolated. This exact
lookup also absorbs and retires a post-cut journal from a straggling v1
terminal process before comparing publication authority. Drain
and upgrade every process sharing one custody directory together; mixed
versions are not a supported availability mode, although the journal/format
cut fails closed instead of forgetting evidence. Custom storage adapters must
advertise `partitionOwnership: "partitioned-v2"` and implement the gate owner's
independent `withPartition(...)`, paged `scanPartitions(...)`, exact-revision
`remove(...)`, and both-file `retire(...)` operations. A v1 or
single-global-mutex adapter is
refused.

Contract's durable client store is a separate coordinated protocol. Its current
format 6 makes the terminally-unbound anti-rebind marker mandatory and migrates
format 5 deletion-only. Drain and upgrade every process or browser context
sharing one physical client-store key together; upgrading only the Agent
custody directory does not make a mixed-version client-store writer safe.

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

## Project live state into a framework-neutral external store

Import `createExternalQueryStore`, `createExternalQueryStoreRegistry`,
`externalStoreIdentity`, `ExternalQueryScope`, and
`SNAPBACK_EXTERNAL_STORE_PROTOCOL` from `@snapback/client/external-store` when
building a framework or generated UI adapter.

The registry owns logical stores above physical `liveQuery` handles. Its key is
the exact protocol token plus canonical provider/query/authority/args identity.
Same-key sibling consumers share one upstream attempt, updates, errors, and
connection state; each `subscribe` cleanup remains independent, and the last
listener disposes the handle. Different keys remain isolated. Late handles and
stale-generation deliveries are fenced and inspected rather than republished.

`ExternalQueryScope` groups independently keyed stores behind one replaceable
Vanilla view generation. Renewing a scope disposes every predecessor binding;
closing it is terminal and idempotent. Prefer it over an app-authored
generation counter. React apps should normally consume the thin
[`@snapback/react` adapter](./react.md), which projects the same store through
`useSyncExternalStore`.

Providers must declare `externalStoreProtocol: "snapback.external-store.v1"`.
If a resolved handle also declares a protocol, an incompatible token publishes
`SNAPBACK_EXTERNAL_STORE_INCOMPATIBLE` and disposes that handle. The external
store is lifecycle/state ownership, not a second transport
or cache: generated Snapback refs and `SnapbackClient.liveQuery` still own the
actual query.

## Subscribe to ephemeral state

`subscribeEphemeral(ref, { connectionId, scope, ... })` returns an overlay
whose `currentEntries()`, `onChange`, `publish`, `delete`, and
`dispose` methods implement the snapshot/delta/expiry contract.
The `connectionId` argument is a readable, client-local label used to share a
grant and socket. It is not wire identity. `overlay.grantedConnectionId` is
the exact opaque id used by the successful subscribe and therefore the key of
this overlay's connection-owned entry. Those strings may happen to match when
the local server adopts an unclaimed suggestion, but collision or mint-only
containment makes them diverge. Low-level adapters that construct raw frames
must obtain `(await client.connectionGrant(label)).id`; never put the readable
label in a `connection_id` wire field.
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

`authLogout()` returns `null` only for an exact empty 204. The logout request
keeps ownership of that response while its own live terminal event blanks the
captured predecessor; a peer-installed successor is preserved and makes the
call stale instead of being reported as logout success. Non-transient custody
diagnostics remain exact.

`setBearerToken` and `clearAuthSession` support the uncoordinated legacy/dev
surface. Do not use them to bypass an `AuthCoordinator`.
`captureAuthority` / `authorityCaptureFor` are adapter-level stale-work
fences. `authorizedLeaseQuery` is the only lease-renewal query path;
`acknowledgeAuthorizationInvalidation` closes the live authorization barrier.

Contract resume and ephemeral reconnect generations fail closed if their
safe-integer identity space is exhausted. The affected boundary or room is
blanked and permanently detached with
`SNAPBACK_CONTRACT_LIFECYCLE_GENERATION_EXHAUSTED`; dispose remains safe and
idempotent, but recovery requires constructing a new client process/surface
rather than retrying the terminal instance.

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
- **Do not treat the readable connection label as the granted wire id.** Use
  the overlay/grant authority fact for connection-owned keys and raw frames.
- **Do not reuse a connection id across unrelated custody/lifecycle owners.**
- **Do not forget `dispose()` / `closeAuth()`.** Handles, overlays, and
  coordinator participants own resources.
