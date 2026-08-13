---
title: The headless client
id: clients.headless
order: 1
audience: agent-first
capabilities: [clients.headless, clients.external-store, clients.micro]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0064-native-client-surfaces.rfc.md, llp/0218-outbox-settlement-contract.rfc.md, llp/0247-ordinary-client-normalization-and-recovery.rfc.md, packages/snapback-client/index.mjs, packages/snapback-client/index.d.mts, packages/snapback-client/online.mjs, packages/snapback-client/external-store.mjs, packages/snapback-client/agent-authority.mjs, packages/snapback-client/exact-reference-types.fixture.ts, packages/snapback-client/auth-identity-types.fixture.ts, packages/snapback-client/outbox-store.test.mjs, packages/snapback-client/outbox-drain.test.mjs, demos/_kit/agent-authority-filesystem.mjs, packages/snapback-contract/index.mjs, packages/snapback-contract/lifecycle-generation-exhaustion.test.mjs, demos/todo/tests/acceptance/headless.mjs, demos/card-game/tests/acceptance/authority-scope.mjs]
examples: [demos/todo, demos/todo-v2, demos/graffiti, demos/card-game, demos/partiful-matrix/surfaces/vanilla]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-12
reviewed-authorities-digest: sha256:723f591ef92b3a2a4f72c6cb6a5c0f4f40050a55d5274a274395e96c38a686e2
---

# The headless client

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`SnapbackClient` from the versioned `@expo/snapback-client` package is the
framework-neutral reference arm. The old `demos/_kit/client.mjs` path is a
compatibility re-export only. Demos, acceptance suites, the React arm, and
`@expo/snapback-contract` build on the same transport, live-stream, ephemeral,
receipt, and auth behavior rather than reimplementing HTTP.

Browser bundles that load a client entry as a dynamic module namespace should
import `SnapbackClient` from `@expo/snapback-client/online`. It re-exports the same
class while keeping optional agent-custody and external-store package exports
out of consumers that did not select them. Use the root entry when those
additional exports are required.

The compiled **Micro profile** is a third entry-point family: three published
subpaths, `@expo/snapback-client/micro`, `./micro/core`, and `./micro/live`
([LLP 0147](repo:llp/0147-compiled-microclient.rfc.md)). `./micro` re-exports
the capability-minimal core runtime (`createMicroRuntime`); `./micro/core` is
the standalone core/operations/authority-fence graph with no live, outbox,
socket, or storage imports; `./micro/live` is the smallest polling live
composition and is imported only when a generated Micro entry selects a live
operation, so a core-only compiled entry can never make the live lane
reachable through a barrel. Selection rule: the package root when
agent-custody or external-store exports are needed, `./online` for browser
dynamic-namespace bundles, and the Micro subpaths only for LLP 0147 compiled
profiles.

For declaration-exact constructor options and method signatures, use the
generated [`SnapbackClient`](../reference/expo-snapback-client.md#symbol-snapbackclient-cabf32a88f)
and [`SnapbackClientOptions`](../reference/expo-snapback-client.md#symbol-snapbackclientoptions-715941730d)
entries. Those anchors and `snapback guide SnapbackClient` resolve the same
build-bound registry identity.

When something breaks behind this client, open the
[admin console](../operating/admin-console.md) before writing another probe:
`snapback admin --ready-file .snapback/dev.ready.json` opens the shipped
browser debugger for Data, Functions, Realtime, Errors, and Logs against the
same running backend — check it before falling back to `curl`, raw host
operations, or a one-off verification script.

## Construct one client per backend and custody context

```js source=packages/snapback-client/index.mjs
  constructor(baseUrl, {
    adminToken = (typeof process !== 'undefined' && process.env ? process.env.SNAPBACK_ADMIN_TOKEN : null) ?? null,
    bearerToken = null,
    // 0137 A4-f6: an explicit anonymous mode so headless consumers (suites,
    // SSR, prerender) can read `auth: 'public'` operations from a sessions
    // server — the protocol offer is sent with no credential. Auth-required
    // operations receive the server's ordinary anonymous refusal.
    custody = null,
    authClientProtocol = null,
    authInvalidationProtocol = null,
    authorityDescriptorProtocol = 1,
    authorizedLeaseProtocol = null,
    // LLP 0163 pre-publication carrier. Explicit opt-in only while the Spec
    // and capability rows remain Draft/Missing; v1 requires a durable outbox
    // so range, next counter, and intent share one restart-safe transition.
    operationIdentityProtocol = null,
    // Set only after capability preflight advertises the hosted ephemeral
    // authority offer. Old servers therefore never see an unknown member.
    ephemeralAuthorityProtocol = null,
    // LLP 0107's additive expiry clock negotiation. A version-aware server
    // echoes 1; a legacy server is retried without this member so durable
    // operations remain available while React presence reports unsupported.
    ephemeralExpiryProtocol = 1,
    authCoordinator = null,
    agentAuthority = null,
    senderConstrained = false,
    clientStoreId = processClientStoreId,
```

`baseUrl` is the running server. `adminToken` is only for explicit
development/operations methods. Browser-owned sessions use an
`AuthCoordinator`; do not also pass `bearerToken`, because that would bypass
coordinator custody. `clientStoreId` binds authorization and retained query
namespaces to one durable client store.

When a trusted server-side identity broker returns a genuine Snapback session,
construct the explicit protocol-client arm with
`createExternalSessionClient(baseUrl, { bearerToken })`. It repeats the exact
`auth/rr` and `auth/live` offers, including connection-open invalidation
negotiation. This is ordinary bearer custody: it does not refresh or logout
through an `AuthCoordinator`, and it must not be substituted for the dedicated
sender-constrained hosted browser constructor. See
[native authentication](../auth/native-apps.md).

`senderConstrained` is an internal composition option for the dedicated
`@expo/snapback-client/hosted-browser` entrypoint. Local applications should not set
it directly, and no current hosted target has positive admission; see
[target honesty](../auth/targets.md).

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

This fork only **adopts an already-issued agent credential**. No
user-reachable client or server route registers an agent principal or issues
the initial `sbac_` credential today; those credentials come from
harness/test-lane provisioning. Treat
[`auth.agent-registration`](../capabilities.md) as a capability GAP, not as a
missing method to keep searching for.

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

Start app boot with `health()`. For a `dev`-mode app, follow it with
`ensureApp({ schema, functions, seed, routes })`. Ensure is idempotent: it
provisions only missing/mismatched artifacts and seeds only empty tables.

For sessions artifacts, configure `adminToken` and select the privileged
request explicitly:

```js fragment reason="generated manifests and seed are app inputs"
await client.ensureApp({
  intent: 'provision',
  requestedMode: 'sessions',
  schema,
  functions,
  seed,
  routes,
});
```

The client sends that variant through its admin transport. Missing credentials
are an authorization error; matching hashes do not bypass the gate. A fresh
mode transition requires the server restart named by its staged-mode response.
The explicit variant validates and installs `routes` against the same candidate
schema/functions pair. On a cross-mode provision the routes stay staged with
that pair and become active only after the required restart; same-mode
sessions provisioning installs them in the same coordinated operation. Never
reset as a mount side effect.

### Versioned seed lifecycle is capability-gated

A generated `seed.artifact.json` uses the predecessor-unknown v1 family:
`ensureVersionedSeed`, `previewVersionedSeed`,
`resetInstallVersionedSeed`, and `clearVersionedSeed`. Each method first reads
the target capability manifest and refuses
`SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED` when the matching
`versioned_seed_install_v1` or `versioned_seed_reset_v1` assertion is absent.
It never retries through legacy `ensureApp({seed})`, `reset(seed)`, or
`seed(seed)`.

The predecessor-backed executable local gate is complete, so local and remote
SQLite targets advertise those ids with `experimental` maturity while LLP 0109
remains in Review. Artifacts must acknowledge that maturity; hosted
compiled-seed custody remains a GAP. Preview is AdminWrite + NonProd even
though it is read-only; reset-install and clear reuse the ordinary coordinated
app reset and require an exact `{state:"absent"}` or
`{state:"present",value:<UUIDv7>}` predecessor stream.

## Call ordinary functions

`query(ref, { args, userId, readSet })`,
`mutate(ref, { args, userId, readSet, ... })`, and
`action(ref, { args, userId, readSet })` accept a generated function reference
or name. In sessions mode the server accepts no caller-selected identity—the
coordinator repeats the session bearer and the server resolves authority.

**Always nest function arguments under the `args` key.** Fields beside `args`
are call options such as `userId`, `readSet`, or `connectionId`; putting a
function argument at that outer level does not pass it to the function. The
client's compiled reference-type fixture uses the same shape for ordinary and
live calls:

<!-- since: 0.1.18 -->

```ts source=packages/snapback-client/exact-reference-types.fixture.ts fragment="generated query, mutation, and live-query call shapes"
client.query(listTodos, { args: { owner: 'ada' } }).then((output) => {
  output.rows[0]?.title.toUpperCase();
});
client.mutate(createTodo, { args: { title: 'ship it' } }).then((output) => {
  // @ts-expect-error mutate outcomes must be narrowed before settled fields are read.
  output.result;
  if (output.status === 'settled') {
    output.result.toUpperCase();
  } else {
    output.clientMutationId.toUpperCase();
    output.sequence.toFixed();
    const presentation: 'installed' | 'withheld' | 'unavailable' = output.presentation;
    void presentation;
  }
});
client.liveQuery(listTodos, {
  connectionId: 'fixture',
  args: { owner: 'ada' },
  onUpdate(rows) {
    rows[0]?.title.toUpperCase();
  },
});
```

`mutate()` resolves `MutationDispatchOutcome<Result>`. The settled branch is
the existing raw `MutationOutput` with `status: 'settled'` added, so fields
such as `result`, `version`, and `receipt` remain at top level after narrowing.
The queued branch appears only when the foreground attempt is relinquished and
the durable record remains replayable; it carries `status: 'queued'`, the
durable id and sequence, and `presentation: 'withheld'` because the headless
arm attempted no optimistic install. It is pending settlement, not success and
not an error. The temporary `queued: true` compatibility alias is deprecated.

Observe the durable identity separately with
`mutationStatus(clientMutationId)` or
`subscribeMutation(clientMutationId, listener)`. The disposition union is
`pending | settled | failed | stranded | quarantined | resultGone | unknown`.
The subscription delivers the current disposition asynchronously and then
transitions; reads and subscriptions do not consume retained settlement or
change ACK eligibility. `unknown` means there is no durable record and licenses
no settlement inference. Only `markMutationSettlementsConsumed()` owns the
existing consumption cut.

`outboxStatus()` adds `oldestPendingAtMs`, `drainPhase`
(`idle | waiting-barrier | replaying | backoff | paused`), `lastAttemptAtMs`,
`nextRetryAtMs`, and a payload-free `blockedReason` beside the existing
disposition counts and `replaying` fact. For a non-React host, call
`startOutboxDrain()` once per client/store lifecycle and stop the returned
controller at teardown. It scans restored work at start, establishes a fresh
resync/readiness barrier before replay, honors writer and captured-custody
fences, retries transient failures on capped backoff, and wakes on store,
connectivity, and authority transitions. `controller.drainNow()` requests one
safety-gated cycle; `{ automatic: false }` disables scheduling, not safety.

Generated references carry their closed operation argument schema. The client
validates it before network I/O for query, mutation, action, live subscribe,
and authorized-lease calls; missing, extra, nested-type, and unsafe-integer
arguments fail with `SNAPBACK_ARGUMENT_VALIDATION_FAILED`. This is an early
client diagnostic, not a replacement for server validation. A legacy string
name has no generated schema and retains its untyped behavior.

A reference generated from a complete sessions artifact pair also carries the
exact schema/function generation. The client sends it on every call family and
the server compares it atomically with function selection. A deploy between
artifact discovery and dispatch returns HTTP 409
`SNAPBACK_ARTIFACT_IDENTITY_MISMATCH` with
`details.subcause: "generation"`; refetch generated artifacts before retrying.
Successful sessions responses expose the server-derived pair at
`facts.activeGeneration`. String names and older references carry no assertion
and remain unchecked for compatibility.

`search(ref, ...)` and `vectorSearch(ref, ...)` are the retrieval calls over
generated search-plan references; their argument grammar, cursors, and
digest facts are owned by
[text search](../backend/text-search.md) and
[vector search](../backend/vector-search.md).

Mutation responses carry `result`, `changed_count`, `version`, and a
terminal receipt. The client records receipts before returning or rethrowing;
read them with `receipts()` or subscribe with `onReceipt(listener)`.

For the exact HTTP 409 `SNAPBACK_AUTH_RESERVATION_STALE` refusal whose closed
details say `retryable: true`, `retryStrategy: "short-jitter"`, and
`effectCommitted: false`, `mutate()` retries the unchanged complete operation
within its bounded client budget. Construction options
`reservationRetryMaxAttempts` and
`reservationRetryJitterMilliseconds: [minimum, maximum]` configure that
budget. `reservationRetryDiagnostics()` and
`onReservationRetryDiagnostic` expose structured scheduled, settled, and
exhausted attempt evidence. No other status or ambiguous/committed outcome is
automatically retried. The retry episode is pinned to the first attempt's
authority/carrier generation: an overlapping logout, user switch, or bearer
replacement fails with `SNAPBACK_CLIENT_AUTHORITY_STALE` and never replays the
old arguments as the successor.

Asset-bearing generated **commands** need no React provider:
`createCommandClient(client)` (the root also exports the
`SnapbackCommandClient` class) is the LLP 0180 command owner over a bare
`SnapbackClient`, and `commandClient.start(app.commands.<name>, inputs)`
returns the same phased command task documented in
[application surfaces](./surfaces.md#run-a-command-and-read-its-truthful-outcome).
`useSnapbackCommand` and `provider.surface(...)` compose this same owner
rather than a second one.

## Subscribe to durable state

`liveQuery(ref, options)` is the author-facing composite. It performs the
snapshot-with-subscribe operation and returns a handle with `rows`,
`version`, `connection`, `poll()`, and `dispose()`:

```js source=demos/todo/tests/acceptance/headless.mjs
    const handle = await db.liveQuery(api.listTodos, { connectionId: 'client_a', userId: ADA });
    assertEqual(handle.rows.length, 3, 'snapshot rows');
```

**Transport default:** omitting `transport` selects manual polling. The handle
updates only when the caller invokes `poll()`; it does not become push-driven
because an `onUpdate` callback is present. Use `transport: 'stream'` for managed
WebSocket push; the manager multiplexes
all durable and ephemeral consumers sharing a `connectionId`. Consume
`onUpdate`, `onConnectionChange`, subscription events, and authorization
callbacks instead of reading socket internals. Always dispose the handle.
High-level handle retirement is idempotent across ordinary disposal, repeated
disposal, logout, and terminal authority loss. If the server confirms that
this handle's exact subscription generation is already absent, lifecycle
cleanup returns the typed
`SNAPBACK_LIVE_SUBSCRIPTION_ALREADY_RETIRED` outcome and does not send another
server effect. The same local-only outcome applies after this query's own
terminal authorization deletion, whose exact server subscription and fence
have already been retired. The low-level public `unsubscribeLive` method remains strict:
foreign ids and ownership/session mismatches are errors, not idempotent
success. `dispose()` performs local teardown synchronously and returns an
awaitable cleanup task. UI unmount code may safely ignore it; acceptance and
operations code should await it when typed server cleanup failures matter.
`subscriptionId` is a read-only view of the handle's internally owned
generation, so application code cannot substitute a foreign id into the
idempotent path.

The managed stream sends application ping frames every five seconds and forces
reconnect only after its 15-second freshness budget is missed. A quiet socket
is not stale merely because no data rows changed. Mobile hosts map observable
lifecycle to `await handle.pause()` and `await handle.resume()`: pause releases
demand and quiesces transport; resume obtains a fresh subscription snapshot.
Do this once in the provider/framework binding, not in every view. See
[framework bindings](./framework-bindings.md).

The lower-level `subscribeLive` / `unsubscribeLive`, `openLiveStream`,
`liveStreamManager`, and drain methods exist for adapters and acceptance
harnesses. App UI code normally uses `liveQuery`.

Generated live references pin that same generation for the subscription
lifetime. A sessions deployment sends `resync_required` with reason
`SNAPBACK_ARTIFACT_IDENTITY_MISMATCH`; the managed handle fresh-subscribes with
its pinned reference and remains refused until the caller installs/refetches
the successor artifacts and establishes from that reference. If the successor
removed the function, the fresh attempt reports `SNAPBACK_UNKNOWN_FUNCTION`
instead.

## Project live state into a framework-neutral external store

Import `createExternalQueryStore`, `createExternalQueryStoreRegistry`,
`externalStoreIdentity`, `ExternalQueryScope`, and
`SNAPBACK_EXTERNAL_STORE_PROTOCOL` from `@expo/snapback-client/external-store` when
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
[`@expo/snapback-react` adapter](./react.md), which projects the same store through
`useSyncExternalStore`.

When a generated route group needs one-commit boot, call
`binding.prepareQueryGroup(groupRef, params)` before mount. That helper is a
strict projection over the headless client's existing register-mode
`fetchBundle` owner: it validates the closed response and keeps rows,
registrations, resume receipts, namespaces, authorization projections, the
connection handle, and grant in private client custody. Two route shapes receive a
generated register reference: all-`LiveQuery` routes (format 1) and format-2
`mixed-route.v2` routes mixing `Query` and `LiveQuery` children, whose
register-mode `fetchBundle` request additionally binds
`formatVersion: 2`, `profile: 'mixed-route.v2'`, and the generated
`planHash`. In both shapes `$param` targets must be strings and search-plan
children are excluded; the broader read-bundle route grammar still
supports server-decoded numeric and boolean parameters. The provider publishes
registered rows only after the stream returns a positive server readiness
witness. Only absence of the target-owned `registered_bundle_boot_v1`
capability can produce an author-enabled `fallbackToLive` result. It has
`boot: null` and is an ordinary live group, not a degraded single-commit claim;
all bundle request failures refuse. A frame racing a still-lazy child marks
that registration dirty and requires a fresh superseding subscription before
the child can publish.

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

Framework adapters that must own a complete room lifecycle use
`startEphemeralRoom(admittedDefinition, scope)`. Its handle owns subscribe,
grant refresh, overlay, reconnect/resync, and cleanup, and exposes
`started()`, idempotent `dispose()`, bounded `settled()`, the granted identity,
and level-triggered snapshots. Ordinary React code should use
[`useSnapbackPresence`](./react.md) instead. `localResourceInspection(ids)` is
an acceptance-only finite-count view of local managers, grants, lane
consumers, socket demand, timers, and listeners; it is not application state
or an authorization API.

## Enter and leave session authority

The session entry points are:

- `authRequestCode(email)` and `authExchange({ challengeId, code })`;
- `authRefresh()` and `authLogout()`;
- `authSession({ force })` for the exact server/mode/authority projection;
- `closeAuth()` to unregister/close the client-side auth participants and
  release a store resolved by the default persistence ladder (an injected
  `rqsStore` remains caller-owned);
- `currentAuthorityDescriptor()` and `currentAuthorizationScope()` for
  adapter fences and the blessed **who I am** / **am I signed in**
  identity read — after boot or restore, call
  `await client.currentAuthorizationScope()` and read
  `principalScope.userId` ([Ask who I am](../auth/sessions-and-principals.md#ask-who-i-am-am-i-signed-in)).
  `authSession()` remains the mode/authority projection, not that identity
  read. `AuthCoordinator.settledView()` is the coordinator's lower-level
  equivalent, not the app whoami;
- `registerAuthBarrierParticipant(participant)` for a state owner that must
  quiesce, blank, durably clear/quarantine, and resume with the coordinator.

`authLogout()` returns `null` only for an exact empty 204. The logout request
keeps ownership of that response while its own live terminal event blanks the
captured predecessor; a peer-installed successor is preserved and makes the
call stale instead of being reported as logout success. Non-transient custody
diagnostics remain exact.

`setBearerToken` deliberately refuses a synchronous bearer change: it cannot
hide predecessor rows, release durable demand, and close old grants before
returning. An external-bearer client instead uses
`await replaceBearerToken(nextBearer)`. That async custody transition pauses
and unsubscribes every protected live handle, blanks predecessor rows, closes
old transports and grants, installs the successor, then fresh-subscribes the
handles. Passing `null` clears custody and leaves them blank/paused (parked:
the next non-null transition fresh-subscribes them). A successor the server
denies settles the transition rather than rejecting it: the denial becomes
the handle's frozen `authorizationDenial` fact and an `authorization_denied`
`onUpdate` delivery, the handle stays parked for the next transition, and
only genuine lifecycle breakage (transport loss, broken callbacks) rejects
with an `AggregateError`. Prefer
`createExternalSessionClient` for construction so the exact auth offers cannot
be forgotten. Neither method bypasses an `AuthCoordinator`.
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
| Construction/static helpers | `constructor`, `createExternalSessionClient`, `AgentAuthorityFence`, `SnapbackClient.auth`, `SnapbackClient.roomPermission`, `SnapbackClient.mintBundleBootKey` |
| Discovery | `health`, `inspect` |
| App/admin lifecycle | `ensureApp`, `loadSchema`, `loadFunctions`, `ensureEphemeralCollections`, `reset`, `seed`, `cronTick`, `ensureVersionedSeed`, `previewVersionedSeed`, `resetInstallVersionedSeed`, `clearVersionedSeed` |
| Function calls | `query`, `search`, `vectorSearch`, `authorizedLeaseQuery`, `mutate`, `run`, `action`, `acknowledgeMutations` |
| Route bundles | `fetchBundle` |
| Durable live | `liveQuery`, `startLiveQuery`, `subscribeLive`, `unsubscribeLive`, `openLiveStream`, `liveStreamManager`, `acknowledgeAuthorizationInvalidation` |
| Offline queue and settlement | `outboxStatus`, `subscribeOutbox`, `outboxDiagnostics` (getter), `startOutboxDrain`, `replayQueuedMutations`, `mutationStatus`, `subscribeMutation`, `acknowledgeResultGoneMutations`, `adoptQueuedMutations`, `settledMutations`, `markMutationSettlementsConsumed` |
| Offline quarantine and stranded intents | `quarantinedMutations`, `reenterQuarantinedMutations`, `strandedMutations`, `discardStrandedMutations`, `reRecordStrandedMutation` |
| Local store runtime | `storePolicyInspection`, `registerQuery`, `evaluateLocalResultTransform`, `releaseQueryRegistration` |
| Optimistic mutation view | `createOptimisticMutationView` |
| Ephemeral | `subscribeEphemeral`, `startEphemeralRoom`, `publishEphemeral`, `deleteEphemeral`, `unsubscribeEphemeral`, `registerEphemeralRepublisher` |
| Connections/drains | `connectionGrant`, `refreshConnectionGrant`, `disconnect`, `releaseConnection`, `drainEnvelopes`, `drainConnection`, `drainUpdates`, `registerDurableConsumer`, `registerEphemeralConsumer` |
| Framework bindings | `prepareReactBinding` |
| Acceptance inspection | `localResourceInspection` |
| Receipts and retry evidence | `recordReceipt`, `receipts`, `onReceipt`, `reservationRetryDiagnostics` |
| Session/auth | `authSession`, `authRequestCode`, `authExchange`, `authRefresh`, `authLogout`, `closeAuth`, `setBearerToken`, `replaceBearerToken`, `replaceAgentCredential`, `clearAuthSession`, `currentAuthorityDescriptor`, `currentAuthorizationScope`, `authTerminalStatus`, `subscribeAuthTerminal`, `registerAuthBarrierParticipant` |
| Auth adapter/coordinator seam | `captureAuthority`, `authorityCaptureFor`, `isAuthorityCaptureCurrent`, `allocateLiveQueryNamespace`, `registerAuthMaterialization`, `commitAuthorityPublication`, `commitSenderSocketNonce`, `handleTerminalAuthLoss`, `liveStreamProtocolsFor` |

`run` is the primary one-shot action verb: it unwraps success to the plain
typed result and rejects application/protocol refusals with
`SnapbackDiagnosticError` — the same public error class `query` and `mutate`
throw, caught with the exported `isSnapbackDiagnosticError` guard. `action`
keeps returning the raw `{ ok, ... }` envelope for one compatibility release
and emits a one-shot development deprecation pointing at `run`. Queued
dispatch is not an exception: it stays a resolved `{ status: 'queued' }`
union.

The quarantine/stranded family projects the durable offline queue's terminal
custody states: `quarantinedMutations()` lists payload-free tombstones for
server-replay refusals, `reenterQuarantinedMutations()` moves the whole
quarantine back to pending after successor artifacts load,
`strandedMutations()` lists the rerecordable intents owned by the current
re-attested principal, `discardStrandedMutations(ids)` deletes selected ones,
and `reRecordStrandedMutation(id, options)` re-records one under a fresh
queued identity — semantics in
[offline retention](../sync/offline-and-retention.md#replay-and-settle-without-guessing).
The local store runtime methods load the LLP 0166 full-profile store module
on demand: `registerQuery`/`releaseQueryRegistration`
[record and release a durable local-store query registration without a live handle](../sync/offline-and-retention.md#keep-a-generated-query-registered-without-a-live-handle),
`evaluateLocalResultTransform`
[evaluates a generated result-transform plan over proof-verified retained rows](../sync/offline-and-retention.md#evaluate-an-owner-reclassified-retained-result),
and `storePolicyInspection` is the value-free retention/policy inspection for
one authority partition. `createOptimisticMutationView` is the public
LLP 0155 rebase view: app code supplies the authoritative rows and every
private optimistic layer is replayed from the durable outbox in sequence. For
the generated-insert, typed provisional-identity, logical-mint mapping, and
ambiguous-retry composition, follow the
[optimistic-create recipe](../recipes/optimistic-create.md).

Members whose names start with `__` (for example
`__registerExternalBearerHandle`) are internal composition seams between the
client and its own arms, not API, and are deliberately excluded. The overlay
returned by `subscribeEphemeral` and the live handle returned by
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
- **Do not forget `dispose()` / `closeAuth()`.** Handles, overlays,
  coordinator participants, and default-resolved persistence stores own
  resources.
