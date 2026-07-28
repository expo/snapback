# LLP 0107: React presence and optimistic lifecycle

**Type:** Spec
**Status:** Implemented
**Systems:** React, React/Expo, Ephemeral state, Client integration, Realtime, Auth, Mutation settlement, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-27
**Revised:** 2026-07-27 (implementation reconciliation: the negotiated expiry
carrier, shared result validator, provider-owned presence and optimistic
stores, generated admission descriptors, Signal Desk migration, package
suites, guide, and exact ten-check retained receipt are complete; hosted
presence remains unsupported). 2026-07-27 (final author reconciliation pins
result-contract and expiry negotiation carriers plus remaining lifecycle
diagnostics/tests)
**Related:** LLP 0012, LLP 0013, LLP 0034, LLP 0043, LLP 0053, LLP 0059, LLP 0064, LLP 0094, LLP 0095, LLP 0101, LLP 0102, LLP 0105

## Summary

This Spec adds presence and optimistic rollback to LLP 0102's React surface as
strict projections over its prepared provider, a client-owned room handle, the
existing query-store ledger, and complete generated references. It adds no
transport, authority, cache, ledger, credential carrier, or durable store. V1
is local-target Online; hosted claims require LLP 0013 and, on Fly, LLP 0105.

## Public API

```ts
useSnapbackPresence<Ref extends ConnectionEphemeralCollectionReference>(
  ref: Ref,
  options: {scope: EphemeralScope<Ref>;
    value: EphemeralValue<Ref> | typeof skip; ttlMs?: number}
): PresenceState<EphemeralValue<Ref>>

useSnapbackMutation<Ref extends MutationReference,
  Q extends QueryReference = never>(
  ref: Ref,
  options?: {optimistic?: {query: Q; args: FunctionArgs<Q>;
    update(current: FunctionResult<Q>, mutationArgs: FunctionArgs<Ref>):
      FunctionResult<Q>;
    isAuthoritative?(current: FunctionResult<Q>,
      result: FunctionResult<Ref>): boolean}}
): (args: FunctionArgs<Ref>) => Promise<FunctionResult<Ref>>
```

References match the prepared app/target; scope/value/query args use LLP 0102's
`CanonicalClientValueV1`. Callers supply no identity, credential, authority,
room, expiry, or mutation facts. `prepareReactBinding` privately admits exact
generated/deployed collection name, schemas, key mode, bounds, app/target,
schema, and static policy/projection digest; runtime trusts only that map.
`ConnectionEphemeralCollectionReference` admits literal `Connection`; other,
stale, or forged refs refuse `SNAPBACK_REACT_PRESENCE_KEY_MODE_UNSUPPORTED`.

## Presence ownership

One provider registry owns one `PresenceRoomStoreV1` per canonical
`(providerInstanceId, complete reference, normalized scope)`: one overlay,
listener, heartbeat, and refcount. `useSyncExternalStore` renders allocate no
transport, timer, grant, or demand.

The client seam is `startEphemeralRoom(admittedDefinition, scope)`. Its
`EphemeralRoomHandleV1` owns subscribe, grant refresh, manager demand, overlay,
unsubscribe-before-detach, and late work; the provider only borrows it. After
subscribe, only `grantedConnectionId` is self identity. Same-room consumers
share it. Their managed values and TTLs must be byte-identical or refuse
`SNAPBACK_REACT_PRESENCE_VALUE_CONFLICT`; `value: skip` only observes.

Actions are bound to their committed hook token. With a non-skip prop,
imperative actions refuse `SNAPBACK_REACT_PRESENCE_ACTION_CONFLICT`. An observer
`publish` transactionally admits a managed intent; later calls replace it,
`delete` clears it, and a later non-skip prop replaces it only after admission.
No unmanaged publisher exists.

Each token retains `(source, desired, acknowledged, suspended)`. An unchanged
prop is a no-op; a changed non-skip prop or observer action is admitted, then
sets `desired`/`publishing` and waits for startup if needed. Acknowledgement
sets `acknowledged`/`published`. Admission failure preserves the prior tuple.
Rate/size/auth failure of an initial send, heartbeat, or resync suspends the
desired value, publishes `publish-error`, and never retries until a new prop or
action re-admits it; any old acknowledged entry merely expires. Observer
`delete` clears desired only after acknowledgement; failure suspends it.
Release cancels pending work and best-effort deletes an acknowledged entry.

The first committed publisher publishes immediately after the authoritative
snapshot. Its TTL defaults to generated `defaultTtlMs`, must not exceed
`maxTtlMs`, and is refreshed at:

```text
max(250ms, min(ttlMs / 2, 10_000ms))
```

only while authoritative. Managed TTL is at least 500 ms. Let `I` be the
integer-ms interval rounded down. For every provider connection/collection,
admission requires `sum(ceil(1000/I)) <= sustained` and
`2 * activePublishers <= burst`; the latter reserves one aligned heartbeat and
one initial/resync emission per publisher. Initial, heartbeat, resync,
declarative, and imperative emissions share a provider token scheduler; a
user-driven emission without a token refuses before changing desired state.
Admission or a later value/TTL change that cannot satisfy these rules refuses
`SNAPBACK_REACT_PRESENCE_HEARTBEAT_UNSUPPORTED` before changing publisher
state. This landing adds generated `publishRate: {sustainedHz, burst}`. A value
change publishes once and resets its deadline.
Last publisher release best-effort deletes the connection-owned value and
stops its timer; last consumer disposes the overlay.

## Closed presence state

`PresenceState<Value>` is the following discriminated union; impossible
status/data/diagnostic combinations are not expressible:

```ts
type Entry<Value> = Readonly<{
  key: string; value: DeepReadonly<Value>; expiresAtMs: number;
  receivedAtMs: number; scopeEpoch: number; entryVersion: number
}>
type PublisherState =
  | { status: "observing" | "publishing" | "published"; diagnostic: null }
  | { status: "publish-error"; diagnostic: SnapbackDiagnostic }
type PresenceActions<Value> = {
  publisher: PublisherState;
  publish(value: Value, options?: {ttlMs?: number}): Promise<void>;
  delete(): Promise<void>
}
type PresenceState<Value> =
  | ({status:"pending"|"resyncing"; entries:readonly []; selfKey:null;
      diagnostic:null; connection:ConnectionState} & PresenceActions<Value>)
  | ({status:"ready"|"stale"; entries:readonly Entry<Value>[];
      selfKey:string; diagnostic:null; connection:ConnectionState} & PresenceActions<Value>)
  | ({status:"error"|"unsupported"; entries:readonly []; selfKey:null;
      diagnostic:SnapbackDiagnostic; connection:ConnectionState} & PresenceActions<Value>)
```

`ready` is authoritative; `stale` retains same-authority entries to expiry.
Authority/epoch predecessors never survive. `error` needs a new generation;
`unsupported` is terminal for the capability.

Entry order is raw UTF-8; snapshots and cloned values are deep-frozen.
Connection open offers closed field `ephemeralExpiryProtocol: 1`; the grant
echoes `1`. Unknown values refuse `SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED`;
absence binds legacy, omits the field, and makes React presence `unsupported`
while durable use may retry without the offer. This LLP 0094 §0E-registered
offer binds the grant lineage. Iff echoed, final serialization stamps
`serverObservedAtMs` on every ephemeral HTTP outcome, WebSocket frame, and
lane-P drain. The client converts `max(0, expiresAtMs-serverObservedAtMs)` once
at receipt into a hidden monotonic deadline; wall time is presentation only.
Old/new cross-product fixtures prove echo, omission, refusal, and durable
fallback. Stores schedule earliest expiry even for observers.

## Resync, authority, and lifecycle

Resync need, epoch/authority change, queue overflow, or authorization change
publishes empty `resyncing`, fences the old overlay, resubscribes, then
republishes active intent once. No late predecessor work may publish.

`EphemeralRoomHandleV1` immediately exposes `started()`, idempotent `dispose()`,
and bounded `settled()`, plus granted identity and level-triggered
connection/resync events. Dispose during startup cancels publication; late
success is unsubscribed/disposed, late failure only settles, and shared manager
demand leaves after the last handle. A client-owned 5,000 ms abort deadline
covers HTTP subscribe/unsubscribe and manager work. Every invalid snapshot,
epoch, overflow, or permission path signals a reason. LLP 0105 authority change
surfaces as handle reason `ephemeral_authority_changed`; React never reaches
into `LiveStreamManager`.

Per LLP 0102, custody change synchronously blanks, then quiesces/disposes every
store before successor subscribe; subtree A→B replacement releases only that
subtree. Revocation exposes no denied entries, removes self through the server
barrier, and surfaces its trusted diagnostic.

Last release uses an idle epoch and one Strict-Mode microtask. Settlement covers
overlay/listener, timers, delete/unsubscribe, grant, and socket demand; cleanup
failure is diagnostic and cannot retain the tree.

`getServerSnapshot` is always an empty `pending` or `unsupported` shape.
Presence is never serialized, hydrated, persisted, restored, or treated as a
durable mutation input.

## Optimistic mutation projection

The prepared provider adopts `createExternalQueryStoreRegistry`; it exposes one
private `PreparedQueryStoreV1` per exact complete-reference plus canonical-args
key. `useSnapbackQuery` and `useSnapbackMutation` resolve that same object and
its sole `runMutation` ledger—no provider-local ledger exists. A missing,
blanked, or not-yet-authoritative store refuses
`SNAPBACK_REACT_OPTIMISTIC_STORE_MISSING` before network work.
Each store privately retains the full generated result-contract descriptor;
binding verifies its deployed descriptor/hash. Unknown contracts refuse
`SNAPBACK_REACT_OPTIMISTIC_RESULT_CONTRACT_REQUIRED`; the shared descriptor
validator refuses bad installation as `SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED`.

Attempts use the existing identity. Layers rebase in attempt order; rejection
removes only its layer and recomputes from the latest authoritative base.
HTTP success is not authoritative. A pure `isAuthoritative` may retire a
confirmed layer after validated live delivery; otherwise the next
authoritative delivery retires it.

Installation runs against an immutable same-authority committed base and
validates the generated result schema before visibility or dispatch. A later
reducer/matcher failure atomically removes only that layer, emits
`SNAPBACK_REACT_OPTIMISTIC_REBASE_FAILED`,
preserves other layers and the already-dispatched promise, and never reruns the
failed reducer; backend settlement remains the promise's truth. Correlation
retains only bounded `(authority, revision, valueDigest)` scalars, never
snapshots. Pins keep upstream demand alive and release on authoritative match,
rejection/receipt-less ambiguity, rebase failure, or authority loss. A
receipt-less failure removes the display layer and rejects without claiming
server rejection or retrying. LLP 0059's operation-appropriate gate authorizes
dispatch/expose/commit/terminal publication (`isCurrent` for expose,
`compareAndCommit` for durable commit).
Pending layers cap at 256.

The promise resolves only to the LLP 0101-validated result. No offline queue or
new LLP 0043 settlement identity is claimed.

## Bounds and diagnostics

Per provider:

- at most 128 cached room stores;
- at most 64 simultaneous room subscriptions as an independent React-owned
  local cap (it does not consume the durable-query 64-subscription budget);
- at most 256 presence consumers;
- at most 64 active managed publishers;
- one heartbeat timer per actively published room store; and
- existing generated room, entry, byte, frame, queue, TTL, and rate limits.

Registry admission serializes one committed hook/store acquisition at a time,
deduplicates same-room acquisitions, and rolls back an abandoned reservation.
It makes no cross-component batch-atomicity claim. Exceeding a React cap
refuses before room/grant work with one of:

- `SNAPBACK_REACT_PRESENCE_ROOM_LIMIT` (stores or subscriptions);
- `SNAPBACK_REACT_PRESENCE_CONSUMER_LIMIT`; or
- `SNAPBACK_REACT_PRESENCE_PUBLISHER_LIMIT`.

Headless server diagnostics pass through. Inspection reports stores, consumers,
subscriptions, publishers, timers, late work, resync reasons, and cleanup error.

## Package and acceptance

LLP 0102's `@snapback/react` ships one web/Expo room store and registers it as
LLP 0105's native republisher. Tests cover typing/refusals; room/publisher
transitions; skew/TTL/rate/payload; handle late work; caps/cleanup; optimistic
overlap/order/rebase/rollback; version separation; and packed web/Expo.

The bakeoff removes local presence/rollback glue. Guide/capability claims stay
local-only until its zero-skip receipt proves delivery, rollback, separation,
cleanup, and zero leaks.

Canonical commands are package `test`/`packed-fixtures.test.mjs` and demo
`test:react`/`typecheck`/`build`. The demo emits retained
`acceptance/results/react-presence.v1.json` with schema
`snapback.react-presence-receipt.v1`, exact target/app/function/collection and
package digests, zero skips, and these ten required check ids:
`two-independent-clients`, `ttl-expiry`, `forced-disconnect-delete`,
`durable-version-unchanged`, `rollback-over-newer-authority`,
`matcher-query-first`, `matcher-response-first`, `ssr-zero-demand`,
`hosted-refusal`, and `zero-resources`. The clients have independent identities
and polling disabled. `forced-disconnect-delete` requires a peer-observed
`Disconnected` removal before half the TTL, distinct from expiry. Within five
seconds after `settled()`, `zero-resources` inspects the receipt connection ids
across provider, client manager, and server ephemeral namespaces and requires
zero stores/timers/listeners/subscriptions/grants/socket demand. “Native
delivery” means backend-native WebSocket; Expo bundling is separate.

This supersedes LLP 0102 placeholders
`SNAPBACK_REACT_PRESENCE_SELF_CONFLICT`,
`SNAPBACK_REACT_PRESENCE_HEARTBEAT_INVALID`,
`SNAPBACK_REACT_OPTIMISTIC_TARGET_INVALID`, and
`SNAPBACK_REACT_OPTIMISTIC_REDUCER_FAILED`. Demo inventory/surface metadata add
`backend-bakeoff` and its exact targets.

## Non-goals

No durable/offline/SSR/history/cross-room/custom-key presence, caller authority
facts, React-owned transport/cache/ledger, HTTP authority, or hosted inheritance.

## Implementation journal

Implemented on 2026-07-27 as one projection across:

- `packages/snapback-client` for negotiated expiry, server-time-to-monotonic
  conversion, owned room handles, disconnect cleanup, and finite resource
  inspection;
- `packages/snapback-contract/result-contract-validator.mjs` for the shared
  generated result-contract validator;
- `packages/snapback-codegen`, `src/ephemeral.rs`, and `src/manifest.rs` for
  complete private collection/result descriptors;
- `packages/snapback-react` for the provider-owned presence registry and the
  single authoritative optimistic query-store ledger; and
- `demos/backend-bakeoff/src/backends/snapback.ts` for the removal of manual
  presence heartbeat/overlay and optimistic rollback glue.

The package suites cover descriptor/refusal typing, old/new expiry negotiation,
room sharing and cleanup, optimistic ordering/rebase/selective rollback, and
the shared result validator. `bun run test:react` in
`demos/backend-bakeoff` produced
`acceptance/results/react-presence.v1.json`: all ten required ids passed with
zero skips, using two independent native WebSocket clients and exact
provider/client/server cleanup inspection. `typecheck` and the production
build also pass. The guide and capability index advertise only the proven
local-target Online surface; hosted presence continues to refuse before work.

## Status

Implemented. This consumes LLP 0013/0102. The local-target capability is
advertised only with the package suites and retained ten-check bakeoff receipt
above; no hosted capability or stronger LLP 0064 class is inferred.
