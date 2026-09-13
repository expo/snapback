# LLP 0114: First-class React and query groups

**Type:** Spec
**Status:** Accepted
**Systems:** React, React/Expo, Client integration, Live Queries, Ephemeral state, Code generation, Sync, Auth, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-27
**Revised:** 2026-08-26 (draft-pending-review own-write atomic group:
per-subscription interest, closed rows/blank algebra, authoritative-only
freeze, all-or-nothing pre-overlay/pre-transport acquisition, finite hold,
automatic idle blank successors, honest multi-group retry point, and
deadline-enforcing bookkeeping listener; design only). 2026-08-22 (author acceptance of the LLP 0267 §7 provider/asset
multiplicity obligations owned here; warning-only and local-gated).
2026-08-21 (`useSnapbackAssetUrl` ledger amendment: nullable
absence resolves in the neutral client to one inert `empty` store; the React
hook adds no absence state and `skip` remains outside asset projection
semantics). 2026-08-10 (LLP 0219 subscription-churn diagnostic amendment);
2026-08-10 (static React core composition: the package root
remains the Full synchronous surface/command/asset composition, while
`@expo/snapback-react/core` selects the same provider registry owner without
those optional capabilities; see the dated section); 2026-08-09 (LLP 0210 §D1 registers `useSnapbackAssetUrl` as a named projection over the framework-neutral issued-URL store; no React-owned refresh state); 2026-08-07 (LLP 0189 alignment sweep: verification-cadence/claim-gating clauses re-scoped or annotated to the LLP 0189 D-3/D-6 defaults). 2026-08-06 (descriptor-mode cold retained boot: the existing
binding receipt now carries a compact admitted deployment projection for an
exact AppDescriptor, so descriptor preparation reuses the same process-cold
receipt/RQS machinery and same typed mismatch refusal; no surface cache,
receipt format, or React state owner was added — see §Offline binding
receipt); 2026-08-06 (named-projection amendment, author-accepted with
LLPs 0179/0180: `useSurface` and `useSnapbackCommand` are named projections
over this Spec's canonical stores — see §Named projections from accepted
RFCs; no React state rule changes); 2026-08-06 (IndexedDB binding-receipt commits now defer through
boot-time Web Locks election, with observable terminal refusals and a
browser-carrier regression witness); 2026-08-05 (mounted-provider HMR generation handoff: in a
positively identified development environment, a regenerated same-app
reference presented to an already-mounted provider becomes a
provider-boundary invalidation — complete function admission re-runs against
the live deployment and swaps atomically, hooks render a brief boundary frame
instead of throwing, and a handoff that cannot complete triggers a controlled
dev reload; foreign/stale references and production builds keep the strict
`SNAPBACK_REACT_REFERENCE_INVALID` refusal — see the dated section);
2026-08-04 (bounded subscribe-failure window: a live-query
subscribe whose admission rejects before any transport exists holds its
`error` snapshot behind a per-store timer-owned failure window on the
client's 250 ms → 10 s reconnect ladder, held at the cap while demanded;
render cadence never drives attempt cadence — see the dated section);
2026-08-03 (bounded local-development binding synchronization:
only a live-inspected `local-dev-sqlite-ibex` target in `dev` auth mode turns
a binding mismatch into a 10-second retry state; every attempt re-runs full
admission without offline-receipt fallback, timeout retains the stable code
as developer detail, and all other profiles remain immediate refusals);
2026-08-03 (Accepted 2026-08-03 by the author — decision
sitting #2, "accept all that verify",
`issues/20260803-author-decision-sitting-2.md`; gate verified: the terminal
review's material findings are absorbed by the normative §Round-1 author
reconciliation narrowing (finite React v1), and the register-mode extension
carved out after that review is separately governed by LLP 0112; status
Review → Accepted);
2026-08-03 (Accepted LLP 0157 boundary: the React key remains the
provider-scoped UI index, while `qmk1` and the complete owner-issued authority
partition supply the semantic materialization address beneath it);
2026-08-01 (offline binding receipt: online preparation persists
a digest-bound receipt of the admitted generated manifest + deployment
identity into the persisted RQS store, and a transport-provenance
connectivity failure at prepare time re-runs the complete admission against
that persisted identity — making the process-cold offline boot reachable for
external consumers; `binding.source` names the provenance; see the dated
section; the receipt digest uses a distinct finite generated-artifact
canonicalization profile rather than consuming the public React-argument
node budget). 2026-08-01 (authorization-denial projection: a server-answered
denial on a handle's fresh subscribe — e.g. a bearer custody transition to a
lesser-privileged successor, 0137 A1-Expo f4 — publishes the `error` variant
with the denial diagnostic instead of an empty `ready`; an `error` snapshot
survives ordinary connection movement and clears on the next authoritative
delivery). 2026-07-27 (round-1 author reconciliation: narrows v1 to the
shipped provider/connection, single-query/mutation hooks, finite typed query
groups, and a clean-install starter; removes new authority, RQS adoption, SSR
hydration, presence, optimistic-ledger, and bundle provenance claims).
2026-07-27 (post-bakeoff implementation extension: adopts the super-refine
Fable recommendation to project served route entries as generated group
references and uses LLP 0090's existing register-mode owner for pre-mount
single-commit priming; adds dedicated React reconnect, revocation, and
HMR-replacement evidence without adding a React transport or cache).
2026-07-27 (pre-review security/totality pass: authority
partitions come only from the bound headless client, caller-authored cache
identity and presence permissions are removed, verified preload is the sole
initial-data path, group/store bounds and SSR snapshots are pinned, and
authority replacement/disposal are explicit). 2026-07-27 (initial focused
specification for the backend-bakeoff React, presence, and aggregate-query
program)
**Related:** LLP 0000, LLP 0012, LLP 0013, LLP 0034, LLP 0043, LLP 0053, LLP 0059, LLP 0064, LLP 0074, LLP 0090, LLP 0092, LLP 0094, LLP 0095, LLP 0108, LLP 0157, LLP 0200, LLP 0219, LLP 0267, LLP 0278

## Summary

Snapback should ship one first-party React surface that removes application-
authored subscription, connection, mutation, presence, and query-assembly
glue. The public surface is:

- `createSnapbackReactProvider`;
- `SnapbackProvider`;
- `useSnapbackQuery`;
- `useSnapbackQueries`;
- `useSnapbackMutation`;
- `useSnapbackPresence`; and
- `useSnapbackConnection`.

These APIs are projections over the existing framework-neutral client,
external-store, RQS, and ephemeral-room owners. They do not create a React-
specific transport, query cache, auth model, or durable store. Equivalent
single and grouped queries share one canonical query store; durable and
ephemeral traffic for one provider share one managed connection; every async
start is generation-fenced and reference-counted.

This Spec owns React composition and its public state semantics. LLP 0012 owns
the headless facts, LLP 0013 owns ephemeral room semantics, LLP 0034 owns the
shared live transport and lifecycle, LLP 0053 owns authorization publication
fences, LLP 0064 owns capability-class honesty, LLP 0090/0092 own resumable
snapshot bundles, and LLP 0108 owns operation result contracts and generated
`Args`/`Result` identity.

## Goals and non-goals

V1 must:

- let ordinary components consume generated references without casts, explicit
  row generics, string operation names, or per-app provider glue;
- preserve one current-value-plus-subscription seam for each logical query;
- share a logical query across single-query and grouped-query consumers;
- expose honest query, mutation, connection, freshness, error, presence, and
  optimistic-settlement state;
- own React Strict Mode, unmount, late-handle, resync, expiry, and authority-
  replacement cleanup;
- adopt RQS preload and registered-bundle entries without a duplicate initial
  query;
- make initial bundle consistency inspectable without implying atomicity after
  independent live deltas; and
- remain an `Online` projection unless a separate LLP 0064 profile earns a
  stronger capability.

V1 does not:

- normalize entities or add a second query cache;
- keep ephemeral entries in durable or offline storage;
- infer permission from a React cache key or caller-supplied `authority`;
- make independent live-query deliveries transactionally atomic;
- automatically retry an ambiguous non-idempotent mutation;
- admit direct table writes or string names on the paved application surface;
- make scalar/action invocation a live-query hook; or
- claim hosted bundle registration where the target capability reports it
  unavailable.

## Public surface

The normative shape is:

```ts
const provider = createSnapbackReactProvider({
  client,
  connectionId: "signal-desk",
  transport: "stream",
  fallbackToPoll: false,
  preload,       // optional createRqsPreloadRegistry result
  registered,    // optional createRqsRegisteredRegistry result
})

root.render(
  <SnapbackProvider provider={provider}>
    <App />
  </SnapbackProvider>,
)
```

`SnapbackProvider` establishes the provider default. Every hook may accept an
explicit `provider` compatibility/test override; missing both context and
explicit provider refuses synchronously. Hooks accept no caller-authored user,
authority, tenant, role, delegation, or cache-partition override.

Generated references, not strings, are the application API. Existing
`useSnapbackQuery({ provider, name })` and name-based provider methods remain
deprecated compatibility bridges through v1. New examples, templates, and
generated guidance must not use them.

## Provider construction and ownership

`createSnapbackReactProvider` has this input:

```ts
type SnapbackReactProviderOptions = {
  client: SnapbackClient
  connectionId?: string
  transport?: "stream" | "poll"
  fallbackToPoll?: boolean
  stream?: {
    heartbeatIntervalMs?: number
    freshnessBudgetMs?: number
    reconnectBaseDelayMs?: number
    reconnectMaxDelayMs?: number
  }
  preload?: RqsPreloadRegistry
  registered?: RqsRegisteredRegistry
}
```

The factory returns a stable provider object with:

- the exact `snapback.external-store.v1` compatibility token;
- generated-reference query and mutation methods;
- an ephemeral-room capability when the injected client supports it;
- one provider-scoped query-store registry;
- one provider-scoped mutation registry;
- one provider-scoped ephemeral-room registry; and
- one connection coordinator.

One provider owns one readable connection label. If `registered` contains a
bundle connection, that exact `connectionId` is used. A conflicting explicit
id refuses before a query or socket starts. Otherwise an omitted id is minted
once when the provider is constructed, never during render and never once per
hook.

All durable queries and ephemeral rooms under that provider use this one
connection label. The headless client's connection-grant and
`LiveStreamManager` remain the wire owners, preserving LLP 0034's one-socket,
both-lanes rule. A React hook never constructs a `WebSocket`, polls an outbox,
or interprets a grant.

The factory passes generated references directly to the headless client. It
normalizes:

- query `onUpdate` deliveries into `retained` or `authoritative`;
- query `onConnectionChange` into connection-only or structured-error
  deliveries;
- `client.mutate`'s response envelope into its logical `result`; and
- provider lifecycle disposal into the existing live-handle and room-store
  cleanup.

The compatibility `subscribe(name, ...)` and `mutate(name, ...)` methods may
remain for third-party provider matrices. The first-party methods are
reference-aware so they do not require an app-authored generated-API lookup.
Optional capabilities do not weaken the exact external-store token. A provider
that lacks an optional method causes the corresponding hook to refuse; a shape
superset is not silently treated as a new external-store protocol.

## Context, identity, and authority

`SnapbackProvider` has:

```ts
type SnapbackProviderProps = {
  provider: SnapbackReactProvider
  children?: React.ReactNode
}
```

Provider object identity, generated reference id, canonical args, and
the headless client's current closed `AuthorityPartitionV1` form the
logical-store identity. Equal identities share one store.
Different args, provider objects, or authority identities never share
application rows, mutation ledgers, presence rooms, or RQS adoption.

`AuthorityPartitionV1` is obtained only through the bound headless client's
`getAuthoritySnapshot`/`subscribeAuthority` seam and binds its never-reused
authority instance, auth fingerprint, tenant/provider/delegation facts, and
stream/reset epoch. It is cache identity, not independent authorization
evidence. Dev mode receives the headless client's explicit dev partition;
there is no `"default"` or user-id fallback. A provider without the exact
authority-source capability refuses before constructing a store.

An authority or provider change is a privacy boundary:

1. the provider authority listener invalidates the old registry generation and
   makes every public snapshot empty/pending before publishing the new
   authority snapshot to React;
2. predecessor callbacks cannot publish into the successor store;
3. predecessor optimistic and ephemeral state is not copied;
4. predecessor subscriptions release independently; in-flight mutation
   attempts remain in the predecessor ledger and surface `ambiguous` unless
   the old authority's settlement proves a terminal outcome; and
5. LLP 0053's query/room authorization fence remains authoritative over any
   callback already in flight.

React context does not acknowledge an invalidation obligation. The owning
headless query or room transition acknowledges only after its fenced
replacement/delete boundary commits.

## Generated-reference typing

The React package mirrors, structurally, the generated types:

```ts
interface SnapbackFunctionReference<Name, Kind, Args, Result> {
  readonly artifactKind: "functionReference"
  readonly id: string
  readonly name: Name
  readonly kind: Kind
  readonly __args?: Args
  readonly __result?: Result
}

interface SnapbackEphemeralCollectionReference<Name, Scope, Value> {
  readonly artifactKind: "ephemeralCollectionReference"
  readonly id: string
  readonly name: Name
  readonly __scope?: Scope
  readonly __value?: Value
}
```

Conditional helpers derive `FunctionArgs<R>`, `FunctionResult<R>`,
`QueryRow<R>`, `EphemeralScope<R>`, and `EphemeralValue<R>`. Arguments are
optional only when their generated type is `Record<string, never>`. A caller-
selected generic cannot override a generated result.

This surface depends on LLP 0108:

- query/live-query document and record contracts generate array results;
- mutation contracts generate their direct logical result;
- computed records receive no invented document system fields;
- runtime egress is validated before a typed result is published; and
- an omitted result remains `unknown`.

Before LLP 0108 is implemented for an operation, this React surface preserves
`unknown`; it never restores precision with a cast or first-read-table guess.
`useSnapbackQuery` admits only a generated query/live-query reference whose
result is an array and whose manifest capability permits subscription.
Scalar queries and actions use the headless invocation API.

## Single-query hook

The typed signature is conceptually:

```ts
useSnapbackQuery<R extends QueryReference>({
  query: R,
  args,
  provider?,
}): SnapbackQueryResult<QueryRow<R>>
```

It returns:

```ts
type SnapbackQueryResult<Row> = {
  status: "pending" | "ready" | "refreshing" | "error"
  rows: readonly Row[]
  connection:
    | "connecting"
    | "live"
    | "polling"
    | "stale"
    | "disconnected"
    | null
  error: SerializedSnapbackError | null
  freshness: "unknown" | "retained" | "current"
  generation: number
  mutation: SnapbackMutationSnapshot<unknown> // compatibility projection
  store: ExternalQueryStore<Row>
  mutate: LegacyQueryMutationBridge<Row>
}
```

Rows are always immutable arrays. No-data and error states return `[]` or
retained prior rows, never `undefined`. `retained` rows remain `pending` until
an authoritative answer makes them current. A connection-only transition
never changes rows, increments an authoritative row revision, or retires an
optimistic layer.

The hook resolves its store through the provider registry. The existing
external store continues to own canonical identity, generation fencing,
late-handle disposal, subscriber reference counting, immutable snapshots,
retained/current distinction, optimistic overlays, and authoritative
reconciliation. React owns only the `useSyncExternalStore` projection.

The result's query-scoped `mutate` method remains through v1 for compatibility.
New code should use `useSnapbackMutation`.

## Typed query groups

The aggregate hook is:

```ts
const workspace = useSnapbackQueries({
  queries: {
    incidents: { query: api.listIncidents },
    tasks: { query: api.allTasks },
    comments: { query: api.allComments },
    activity: { query: api.allActivity },
  },
  provider?,
})
```

For a spec map `S`, it returns:

```ts
type SnapbackQueriesResult<S> = {
  status: "pending" | "ready" | "refreshing" | "error"
  data: { readonly [K in keyof S]: readonly QueryRowOf<S[K]>[] }
  queries: { readonly [K in keyof S]: QuerySnapshotOf<S[K]> }
  errors: { readonly [K in keyof S]?: SerializedSnapbackError }
  connection: ExternalConnection
  freshness: "unknown" | "retained" | "current"
  boot: null | {
    source: "inline" | "read-bundle" | "registered-bundle"
    commitVersion: number
    generation: string
    versionStream: string
  }
  store: ExternalQueryGroupStore<S>
}
```

The group store is framework-neutral. It subscribes to ordinary child query
stores and publishes one immutable projection. It does not copy rows into a
normalized cache, open another upstream subscription, or own mutation
reconciliation. A single-query hook and any number of groups naming the same
provider/reference/args/authority share the exact child store and upstream
attempt.

Group aggregation is deterministic:

- `ready` iff every child is `ready`;
- `error` when at least one child is `error` and none remains
  `pending`/`refreshing`;
- `refreshing` when at least one child is `pending`/`refreshing` and at least
  one child holds retained or current rows;
- otherwise `pending`;
- `errors` always contains every errored child, including during partial
  pending/refreshing states;
- freshness is `current` iff every child is current, `retained` iff none is
  unknown and at least one is retained, and `unknown` otherwise; and
- connection is the weakest active child state in this order:
  `disconnected`, `stale`, `connecting`, `polling`, `live`.

Group keys are application labels, not query identities. Two keys may name the
same child store and receive the same snapshot under both keys. Group
unsubscribe releases only the group's child subscriptions; another component
keeps a shared child alive. A group identity change detaches the complete old
projection and cannot accept a late predecessor notification.

A group contains 1–64 own enumerable string keys. Symbols, accessors,
prototypes other than `Object.prototype`/null, duplicate normalized labels, or
an empty/oversized map refuse before any child store is acquired. This makes
aggregation and cleanup finite; zero-child connection/freshness semantics are
not part of v1.

## Bundle boot provenance

The provider may receive one RQS preload registry and one registered-bundle
registry before React mounts. It consumes a matching entry once, at the child
store's upstream start:

- inline/read-mode rows enter through `preloadedResume` and remain
  `retained`/`pending` until proved current;
- registered rows enter through `registeredSubscription`, are current at the
  bundle cut, and open no duplicate snapshot-with-subscribe; and
- a registered bundle's adopted connection grant is used for the shared socket
  attach.

The registries expose `commitVersion`, `generation`, `versionStream`, source,
and their canonical entry keys. A group reports non-null `boot` only when
every child consumed an entry from the same complete bundle identity. A
missing, already-consumed, differently scoped, or differently identified
entry makes `boot` null; the group still runs through ordinary subscriptions.

`boot` is provenance for the initial rows. LLP 0092 guarantees that all bundle
entries were evaluated at that one `commitVersion`, and that a register-mode
bundle created its registrations at the same cut. After any child receives an
independent live replacement or delta, the current `data` object may combine
different durable versions. The hook must not rename `boot` to `consistentAt`,
advance it to a later version, or claim that the current aggregate remains
transactionally consistent.

Bundle acquisition happens before mount. A hook does not start a register-mode
bundle request in an effect because unmount can strand pending registrations
until server reaping. Anonymous register refusal remains explicit and may be
retried by boot code in read mode; it is never silently represented as an
adopted registration. Target capability reports govern whether read, inline,
or register mode is available.

## Mutation hook and optimistic rollback

The hook is:

```ts
const toggle = useSnapbackMutation({
  mutation: api.toggleTask,
  optimistic: {
    query: api.allTasks,
    args: {},
    update: (rows, mutationArgs) => nextRows,
    isAuthoritative: (rows, attempt) => boolean, // optional
  },
  provider?,
})
```

It returns:

```ts
type SnapbackMutationResult<Args, Result> = {
  mutate(args: Args, options?: { id?: string }): Promise<Result>
  status: "idle" | "pending" | "confirmed" | "rejected" | "ambiguous"
  id: string | null
  error: SerializedSnapbackError | null
  result?: Result
  pendingCount: number
  attempts: readonly MutationAttempt[]
  lastSettlement: MutationSettlement<Result> | null
  retryable: boolean
}
```

The mutation registry is keyed by provider, generated mutation id, and the
headless authority partition. Equivalent hooks observe one ledger; concurrent calls retain
distinct ids and one combined `pendingCount`. A supplied id is both the local
attempt identity and, when the provider supports LLP 0043 idempotency, the
`clientMutationId`. Automatic generation produces a never-reused id.

The v1 optimistic option targets at most one canonical query store. The
coordinator:

1. installs one pure optimistic layer over the latest authoritative rows;
2. records the pending attempt;
3. invokes the provider exactly once;
4. confirms the layer with the typed logical result or removes it on
   authoritative rejection; and
5. retires a confirmed layer only when its matcher succeeds or a later
   authoritative query delivery arrives.

If an optimistic reducer throws, the layer is removed before transport starts
and the mutation rejects with a structured local diagnostic. If the server
rejects, rollback recomputes from the newest authoritative rows, not a snapshot
captured at mutation start. A connection-only transition cannot settle a
layer. Query-before-response and response-before-query orderings converge.

`rejected` means the provider proved that the mutation did not commit.
`ambiguous` means transport failed without such proof; it is never labeled
rejected merely to simplify UI. Optimistic presentation is removed while
authoritative live state reconciles. `retryable` is true only when the provider
can resend the same durable id under the same authority; the hook never retries
an ambiguous attempt automatically or invents a new id for it.

The mutation store contains status and settlement facts, not application rows.
Optimistic rows continue to live only in the target query store. Multi-query
optimistic transactions and a normalized cache-update language are deferred.

## Presence hook

The hook is:

```ts
const viewers = useSnapbackPresence({
  collection: api.ephemeral.incidentPresence,
  scope: { incidentId },
  self: {
    value: { userId, name, color, viewing: "incident" },
    ttlMs: 30_000,
    refreshEveryMs: 10_000,
    sessionId?,
    ownerUserId?,
    customKey?,
  },
  provider?,
})
```

Omitting `self` creates a read-only room subscription. The result is:

```ts
type SnapbackPresenceResult<Value> = {
  status: "pending" | "ready" | "refreshing" | "error"
  entries: readonly {
    key: string
    value: Value
    expiresAtMs: number
    receivedAtMs: number
    scopeEpoch: number
    entryVersion: number
  }[]
  connection: ExternalConnection
  error: SerializedSnapbackError | null
  publish(value: Value, options?: PresencePublishOptions): Promise<unknown>
  remove(options?: PresenceRemoveOptions): Promise<unknown>
}
```

The provider-scoped room identity includes generated collection id, canonical
scope, connection, the generated collection permission profile, and the
headless authority partition. Permission facts come from the generated
reference and target grant; the hook accepts no caller permission override.
Equivalent mounts share one
in-flight subscribe and one resolved overlay. Different scopes or authorities
never share. Entries are immutable and sorted by key for stable snapshots.

The room store, not a React effect, owns:

- subscribe-before-snapshot buffering;
- one manager-demand registration on the shared socket;
- in-flight socket-loss detection;
- level-triggered `needs_resync`;
- one fresh-snapshot resubscribe at a time;
- bounded exponential retry;
- stale-generation fencing;
- expiry timers;
- publisher heartbeat reference counts;
- idle linger; and
- server unsubscribe followed by local manager/overlay detach.

Before the first snapshot the result is `pending`, `[]`, and `connecting`.
A valid snapshot makes it `ready`. Socket loss retains non-expired last-known
entries under `stale`; reconnect cannot return to `live` until a fresh room
snapshot/register boundary succeeds. `needs_resync`, epoch change, authority
change, or lost sequencing blanks the poisoned generation and reports
`refreshing` until its successor snapshot lands. An initial or repeated
subscribe failure reports `error` with `[]` while bounded retry continues.

Known server expiry remains authoritative even while the connection is stale:
an entry is not rendered past `expiresAtMs`. A later fresh snapshot may restore
the key if another valid publisher extended its lease. This follows LLP 0013's
TTL backstop and avoids ghost presence when a remove was lost.

`self.ttlMs` defaults to the generated collection default and may not exceed
its maximum. `refreshEveryMs` must be positive and strictly less than
`ttlMs`; its default is one third of the chosen TTL. The store publishes after
the room snapshot, refreshes while at least one equivalent publisher remains,
and best-effort removes the owned key after the final publisher's Strict
Mode-safe linger. Equivalent declarations share one heartbeat. Conflicting
`self` declarations for the same room/provider identity refuse instead of
alternating values.

`publish` and `remove` are ephemeral operations. They do not increment durable
pending mutation state, write the durable database, enter the offline queue,
or receive optimistic query layers. Local overlay disposal alone is not
server cleanup: the final room teardown sends the authenticated best-effort
unsubscribe before releasing the manager listener, so sibling rooms on the
same connection are not disconnected as a side effect.

Ephemeral entries never enter RQS payloads, query groups, IndexedDB retention,
exports, backup, or local-first claims.

## Connection hook

`useSnapbackConnection` returns:

```ts
type SnapbackConnectionResult = {
  connection: ExternalConnection
  activeSubscriptions: number
  error: SerializedSnapbackError | null
}
```

The provider coordinator receives state from every active durable query and
ephemeral room. It reports the weakest active state using the same order as
query groups and removes an entry when that resource disposes. It does not
promote the provider to `live` merely because the raw WebSocket opened: a
durable query or room that still owes a fresh resubscribe remains
`connecting`/`stale`.

With no active resource, `connection` is `null`,
`activeSubscriptions` is zero, and the hook does not create socket demand.
`activeSubscriptions` counts unique demanded upstream query/room resources,
not React hook or group-edge subscribers.
Errors are structured and authority-safe; removing the resource that owned the
latest error recomputes the aggregate.

## Named projections from accepted RFCs

Accepted sibling RFCs may add named projections over this Spec's canonical
stores without becoming second React authorities. This section is the
amendment ledger those acceptances write into; each entry reuses this
Spec's retained/error/lifecycle/cleanup semantics unchanged and adds no
new React state rules.

- **`useSurface` (LLP 0179, accepted 2026-08-06).** A surface binding is a
  projection over this Spec's canonical query stores, mutation attempts,
  and presence rooms: equivalent low-level and surface reads share one
  store, equivalent presence shares one room, and cleanup follows the same
  strict disposal rules as `useSnapbackQuery`/`useSnapbackPresence`. The
  surface grammar, budgets, and refusal vocabulary belong to LLP 0179; the
  React state semantics remain this Spec's.
- **`useSnapbackCommand` (LLP 0180, accepted 2026-08-06).** A command task
  hook is a projection with the same lifecycle/cleanup discipline this
  Spec requires of `useSnapbackMutation`; its child asset/mutation facts
  and residue vocabulary belong to LLP 0180. It never merges into the
  ordinary mutation return type.
- **`useSnapbackAssetUrl` (LLP 0210 §D1, Review — dual-family loop converged 2026-08-09).** An issued
  URL hook is a content-keyed `useSyncExternalStore` projection over the
  framework-neutral asset client's shared issued-URL store. The neutral
  store owns issuance, TTL refresh, retry, denial recovery, authority
  fencing, and final-unsubscribe cleanup; React adds no timer, fetch, cache,
  or state machine. `null` or `undefined` selects the neutral store's inert
  `empty` singleton; `skip` remains a query/presence demand semantic and is
  not an asset-id spelling.

## External-store composition and cleanup

Framework-neutral stores own all mutable lifecycle:

- `ExternalQueryStore` owns durable rows and optimistic layers;
- `ExternalMutationStore` owns mutation attempts and settlement;
- `ExternalQueryGroupStore` projects child query stores;
- `ExternalEphemeralRoomStore` owns presence rooms and publisher leases; and
- `ExternalConnectionStore` projects active resource connection facts.

Every store exposes `subscribe`, `getSnapshot`, and `getServerSnapshot`.
Snapshots are referentially stable until a fact changes and deeply immutable at
the public boundary. Observer exceptions are isolated.

`getServerSnapshot` is the provider's immutable construction snapshot: verified
RQS preload/registered rows when the exact authority and bundle identity were
supplied before render, otherwise the closed empty/pending snapshot. It never
reads browser globals, starts transport, consumes a registry entry, or reflects
a mutation/presence effect. Hydration adopts that same snapshot before any live
start, preventing server/client tearing and duplicate initial demand.

Async starts capture one bounded generation. A final unsubscribe invalidates
that generation synchronously. A handle resolving late is disposed immediately
and cannot publish. Same-identity idle stores remain available through a
single queued-microtask linger for query/group/connection stores and a fixed
250 ms room/publisher linger so React Strict Mode cleanup/replay reattaches
without creating parallel demand. The linger never extends a server TTL or
publishes after its authority generation is fenced. After linger, registries
evict the store and release upstream state.

One provider admits at most 1,024 active query stores, 256 active group stores,
1,024 nonterminal mutation attempts, and 256 active rooms. Before refusing a
new identity it synchronously reclaims only zero-subscriber stores whose linger
has ended and terminal acknowledged mutation attempts; it never evicts a live
subscription, publisher, ambiguous/unacknowledged mutation, or another
authority partition silently. Remaining overflow refuses locally with
`SNAPBACK_REACT_STORE_CAPACITY` before upstream demand. Provider `dispose()` is
idempotent and terminal: it fences the authority generation, releases every
owned demand, best-effort unsubscribes rooms, removes timers/listeners, and
causes every later hook/start call to refuse.

Provider/root unmount does not call an admin disconnect route. Child store
reference counts first retire their subscriptions. The provider then invokes
the client's grant-owned, `ifIdle` connection release: a sibling provider's
remaining socket demand keeps the shared connection live, while the final
provider closes the managed connection and relinquishes the cached grant.
Host background/foreground uses LLP 0064's provider lifecycle once at the
application boundary, not per component.

## Compatibility and capability honesty

Existing external-query snapshots and
`snapback.external-store.v1` remain compatible. New mutation, group,
ephemeral, and connection stores are additive exports. A change to the
existing query-store observer or snapshot meaning requires a new exact token;
this Spec does not authorize accepting an unknown version.

Legacy providers that implement only name-based query/mutation methods keep
working with explicit-provider `useSnapbackQuery` and its query-scoped mutate
bridge. They may also use query groups and the connection coordinator because
those compose existing query stores. Presence and first-party RQS adoption
require declared provider capabilities and refuse when absent.

The React package and guide report `Online`. Retained rows, optimistic
presentation, RQS boot, or preserved stale rows do not prove local execution,
durable offline queueing, replay, or `Parity`. Capability reports remain
target-specific: local register support does not imply Cloudflare register
support, and a web result does not establish an iOS or Android carrier.

## Diagnostics

**W5 acceptance (2026-08-22).** By Charlie Cheever's author ruling, this Spec
accepts LLP 0267 §7.6's React/provider duplicate-subscription and
asset-issuance multiplicity facts. They are warning-class, value-free,
bounded, and visible only through the gated local inspection carrier; they do
not add a refusal or hosted telemetry surface.

New stable diagnostics are:

- `SNAPBACK_REACT_PROVIDER_REQUIRED`;
- `SNAPBACK_REACT_REFERENCE_INVALID`;
- `SNAPBACK_REACT_CAPABILITY_UNAVAILABLE`;
- `SNAPBACK_REACT_CONNECTION_ID_MISMATCH`;
- `SNAPBACK_REACT_BUNDLE_BOOT_INCOMPLETE`;
- `SNAPBACK_REACT_OPTIMISTIC_TARGET_INVALID`;
- `SNAPBACK_REACT_OPTIMISTIC_REDUCER_FAILED`;
- `SNAPBACK_REACT_PRESENCE_HEARTBEAT_INVALID`; and
- `SNAPBACK_REACT_PRESENCE_SELF_CONFLICT`;
- `SNAPBACK_REACT_AUTHORITY_SOURCE_REQUIRED`; and
- `SNAPBACK_REACT_STORE_CAPACITY`.

The existing `SNAPBACK_EXTERNAL_STORE_INCOMPATIBLE` remains the protocol
refusal. Headless RQS, mutation, auth, and ephemeral errors retain their
original codes.

Diagnostics include provider identity, generated operation/collection id,
state class, and safe remediation. They never include bearer/grant material,
mutation arguments, result values, presence payloads, or application rows.

## Executable acceptance

Implementation is accepted only when these executable suites pass.

`packages/snapback-react/package.test.mjs` must prove under React Strict Mode:

- context provider defaults, explicit provider overrides, missing-provider
  refusal, and provider replacement;
- headless authority-source requirement, synchronous emptying before authority
  replacement publication, and no caller-authored authority/permission path;
- same-key sibling sharing, different-key isolation, A→B→A generation
  fencing, late-handle disposal, and final unmount cleanup;
- retained versus authoritative delivery and connection-only non-settlement;
- group plus single-hook sharing with no duplicate upstream start;
- group status/freshness/error/weakest-connection tables and group replacement;
- mutation pending/confirmed/rejected/ambiguous states, concurrent counts,
  one transport call, reducer failure before transport, both authoritative
  ordering races, and rollback from latest authoritative rows;
- connection aggregation without connection-hook-created socket demand; and
- server/client snapshot equality with and without verified RQS preload,
  hydration without duplicate initial demand, every registry/capacity boundary,
  reclaim-only-idle behavior, and terminal provider disposal; and
- legacy provider/query-scoped mutation compatibility.

`packages/snapback-react/types.fixture.ts`, compiled with strict TypeScript,
must use a real generated fixture to prove:

- required and empty query args;
- exact single-query row fields;
- exact per-key group row fields;
- mutation args and direct result;
- ephemeral scope and value;
- rejection of wrong reference kind, missing/extra args, wrong ids, wrong
  presence value, and a caller generic that tries to widen generated output.

Framework-neutral package tests must prove:

- a group of four queries opens four child attempts, not eight, and shares
  children with independent consumers;
- group unsubscribe does not close a child retained by a sibling;
- mutation rollback recomputes over an authoritative delivery that arrived
  while the mutation was pending;
- every late group/mutation/connection publication is fenced; and
- listener exceptions do not starve siblings or own cleanup.

Ephemeral tests must reuse the LLP 0013/0034 conformance fixtures and prove:

- same-room in-flight deduplication and scope/authority isolation;
- subscribe-before-snapshot buffering;
- unmount before subscribe resolution;
- quiet-room TTL removal, including while stale;
- `needs_resync`, socket-loss-during-subscribe, and reconnect fresh snapshot;
- exactly one resubscribe in flight under overlapping triggers;
- heartbeat sharing, update, validation, and final cleanup;
- server unsubscribe before final manager-demand detach; and
- no durable version, RQS, retained-store, or offline-queue effect.

RQS integration tests must fetch a real multi-query bundle and prove:

- all initial entries bind the response's one `commitVersion`;
- register adoption starts no fresh subscribe and socket attach delivers no
  duplicate initial rows;
- read/inline adoption is retained until authoritative proof;
- an incomplete/mixed registry yields `boot: null`;
- the first independent child update leaves `boot` unchanged as provenance
  and does not claim current aggregate consistency; and
- anonymous register refusal remains distinguishable from read fallback.

A maintained React demo must replace hand-built multi-query and presence
assembly with these APIs while preserving cross-client live delivery, atomic
mutation-plus-activity, optimistic rollback, TTL/disconnect presence, and
durable-version separation.

The landing gate runs:

```sh
bun run --cwd packages/snapback-client test
bun run --cwd packages/snapback-contract test
bun run --cwd packages/snapback-codegen test
bun run --cwd packages/snapback-react test
node scripts/check-guide.mjs
./ref-check --verbose
```

The demo's named acceptance suite and any target-specific bundle/React Expo
receipt also run when their code changes. Guide and capability rows update in
the same landing.

## Status and implementation sequence

This is an Accepted specification (accepted 2026-08-03). Its implementation
order is:

1. land LLP 0108's generated result contracts and reference extractors;
2. factor reference-aware provider construction and context;
3. add framework-neutral mutation, group, connection, and ephemeral-room
   stores without changing query-store ownership;
4. add typed hooks and Strict Mode acceptance;
5. wire RQS preload/registered provenance and bundle integration tests;
6. migrate the maintained React comparison fixture; and
7. run LLP review, corpus maintenance, and guide checks before changing this
   Spec's status, with the most recent eligible complete battery green on
   this Spec's claim-relevant gates (LLP 0189 D-6; unrelated reds ticketed
   and named) in place of a complete landing proof at one commit.

## Round-1 author reconciliation: finite React v1

Both reviewers found that the original draft combined several independent
protocol projects. The first landing is narrowed below. This section is
normative and supersedes contrary earlier text.

### Shipped ownership and authority only

React v1 wraps the existing headless client and its existing one
`SnapbackProvider` connection manager. It introduces no
`AuthorityPartitionV1`, caller-carried authority, provider authority override,
bundle registry owner, RQS adoption, or second mutation ledger. Credential and
authority facts remain entirely server/prepared-client owned under LLP 0059;
React never derives or accepts them from props.

The provider identity is an opaque manager instance id plus target/app
identity. A query-store key is
`sha256(JCS({providerInstanceId, functionReference, args}))`, where the
function reference is the complete generated LLP 0108 reference and `args`
uses the existing finite canonical client value grammar. No token, secret,
authorization descriptor, function, symbol, prototype-bearing object,
undefined member, non-finite number, or cyclic value is keyable. The hook
throws `SNAPBACK_REACT_ARGS_INVALID` synchronously before manager demand for an
unkeyable input.

### Public v1 hooks

The package exports:

```ts
useSnapbackQuery<Ref extends QueryReference>(
  ref: Ref,
  args: Ref["Args"] | typeof skip
): QueryState<Ref["Result"]>

useSnapbackQueries<const Entries extends QueryEntryMap>(
  entries: Entries
): QueryGroupState<Entries>

useSnapbackMutation<Ref extends MutationReference>(
  ref: Ref
): (args: Ref["Args"]) => Promise<Ref["Result"]>

useSnapbackConnection(): ConnectionState
```

`skip` is a package-owned symbol usable only as the whole args value.
`QueryEntryMap` is a closed name-keyed map of 1 through 64 entries, each
`{ref, args}` where `args` may independently be `skip`. Entry names are
nonempty portable identifiers. The group result has the same keys, each
holding the ordinary `QueryState<Result>`, plus aggregate
`status: "loading" | "ready" | "error"` and one connection snapshot. The
optionless overload makes no atomic multi-query, shared commit, bundle, or
preload claim; the dated 2026-08-26 draft amendment below is the proposed
explicit opt-in exception and changes nothing until accepted. Each non-skipped
entry is an ordinary live subscription multiplexed through the provider's
single connection; all 64 must fit the shipped per-connection subscription
limit or the complete group refuses before attaching any entry.

The group constructor validates and canonicalizes every entry first, then
increments manager demand transactionally. Partial construction attaches
nothing. Updates diff keys/ref/args, attach replacements before publishing
their first value, then detach retired stores. A ref/args change returns that
entry to loading; unrelated entries retain their current snapshot.

Mutation v1 is only the shipped mutation call with generated Args/Result
inference and existing offline settlement behavior. It adds no optimistic
write set, terminal-attempt vocabulary, replay policy, or grouped mutation
outcome. Runtime refusals reject the returned promise with the existing
structured diagnostic. Query subscription/runtime refusals appear in the
entry's `error` state; authoring/key errors throw synchronously.

Presence/ephemeral rooms, protected presence permissions, TTL/heartbeat
ownership, RQS boot provenance, registered adoption, server-rendered data, and
hydration handoff are explicit nonclaims. `getServerSnapshot` returns a stable
loading/skipped shape without data; effects attach only on the client after
hydration. This avoids publishing unverified authority or stale server data.

### Lifecycle and resource closure

One provider manager owns all stores. Each canonical query store has a
reference count and a monotonically increasing lifecycle generation. Final
release schedules one microtask disposal tagged with that generation; a
Strict Mode reacquire increments the generation and cancels the stale
disposal. Provider replacement synchronously marks old stores terminal,
detaches their manager demand, cancels pending reconnects, and creates a fresh
manager; old events cannot publish across the generation fence.

Hard caps are 64 group entries, 256 distinct live query stores per provider,
1,024 total hook consumers, and the existing single-connection subscription
cap. Store creation that would exceed any cap refuses before attachment.
Final disposal sends unsubscribe, detaches manager demand, removes listeners,
and deletes the store only after the existing bounded connection-close path;
cleanup failure becomes a structured terminal diagnostic and cannot keep the
React tree alive indefinitely.

### Package, starter, and evidence

`@snapback/react` is a first-class packed package with peer dependencies on
React and `@snapback/client`, no repository aliases, and both ESM runtime and
declaration exports. The installable starter is a packed fixture generated by
`snapback create --template react`: one provider, generated query/mutation
references, a two-entry group with independent args/skip, connection state,
and no casts or explicit result generics. Its cold-install test installs only
published/packed tarballs into an empty temporary directory, typechecks,
builds, starts Snapback, observes a live update, exercises a mutation, and
proves final cleanup.

Signal Desk is the maintained acceptance target already imported by the
bakeoff landing. It must replace its hand-built Snapback multi-query assembly
with `useSnapbackQueries`, while presence remains on its existing explicit
adapter because presence is not a React-v1 claim. Acceptance covers Strict
Mode double mount, 1/64/65 entry boundaries, per-entry skip/args changes,
transactional construction failure, one manager connection, reconnect,
provider replacement, exact inference across web and React Expo type fixtures,
packed clean install, no repository aliases, and zero leaked subscriptions or
timers. Neither experimental nor stable capability is advertised before all
evidence passes.

## Round-2 author reconciliation: total React v1

The second review agreed with the narrowed ownership model but found the
provider seam, public state algebra, lifecycle cancellation, cap admission,
canonical grammar, and package evidence under-specified. This section is
normative and supersedes contrary text above.

### Exact provider and dev identity seam

React adds a façade, not another backend owner:

```ts
createSnapbackReactProvider({
  client,
  appId,
  targetId,
  devPrincipal?,
  disposeClient?: false
}): SnapbackReactProvider

<SnapbackProvider provider={provider}>...</SnapbackProvider>
```

`client` is one already-prepared `SnapbackClient`. The factory verifies
`appId`/target identity against the client's manifest before creating demand,
mints one opaque provider instance id and one private connection label, and
borrows the client's existing `LiveStreamManager` plus existing external-store
registry. The client remains the sole credential/authority and transport
owner. By default the provider borrows the client and disposal does not close
it; `disposeClient:true` transfers ownership and closes it only after every
provider resource settles. One provider may be mounted in multiple React
roots.

`devPrincipal` is admitted only when the prepared target reports the local-dev
profile. It binds that principal once at provider construction and is
forwarded through the existing local `userId` request field; hooks never accept
identity. It is refused on sessions or hosted targets. This is a compatibility
projection, not a second authority partition, and it is synchronously blanked
with all stores during a client custody transition.

References from another app/target refuse
`SNAPBACK_REACT_REFERENCE_TARGET_MISMATCH` before demand. A React context swap
from provider A to B releases only that committed subtree's consumers and
presents B's pending states; it does not terminate A, which remains reusable
or concurrently mounted elsewhere. In contrast, an in-place client custody
transition is client-owned: it synchronously blanks every provider store,
replaces the manager internally, and resumes the same provider after the
successor authority is installed.

### Generated typing and closed state algebra

Signatures use LLP 0108's shared `FunctionArgs<Ref>` and
`FunctionResult<Ref>` extractors, never fictional `Ref["Args"]` members:

```ts
useSnapbackQuery<Ref extends QueryReference>(
  ref: Ref,
  args: FunctionArgs<Ref> | typeof skip
): QueryState<FunctionResult<Ref>>

useSnapbackQueries<const Entries extends QueryEntryMap>(
  entries: Entries
): {
  queries: QueryStates<Entries>,
  status: "pending" | "ready" | "refreshing" | "error",
  connection: ConnectionState,
  error: SnapbackDiagnostic | null
}

useSnapbackMutation<Ref extends MutationReference>(
  ref: Ref
): (args: FunctionArgs<Ref>) => Promise<FunctionResult<Ref>>
```

`QueryState<Result>` is this closed discriminated union:

```ts
{status:"pending", data:undefined, error:null, connection:ConnectionState}
{status:"ready", data:Result, error:null, connection:ConnectionState}
{status:"refreshing", data:Result, error:null, connection:ConnectionState}
{status:"error", data:undefined, error:SnapbackDiagnostic,
 connection:ConnectionState}
{status:"skipped", data:undefined, error:null, connection:ConnectionState}
```

`pending` and `error` never retain data. `refreshing` may retain only
same-authority current data while reconnecting. A custody blank immediately
returns every affected entry to `pending` with `data:undefined` until the
successor's first authoritative delivery; predecessor data is never
`refreshing`. `skip` always presents the `skipped` variant and owns no demand.

Group aggregation ignores skipped entries. Any non-skipped error makes the
group `error` and selects the first error by sorted entry name; otherwise any
pending entry makes it `pending`, then any refreshing entry makes it
`refreshing`, else it is `ready`. An all-skipped group is `ready`, has no
error, and does not open a connection. Entry results live only under
`queries`, so user keys cannot collide with aggregate members.

`ConnectionState` is the closed object
`{status, diagnostic, reconnectAttempt}`, where status is
`idle | connecting | open | reconnecting | closed | error`, diagnostic is a
structured diagnostic only for `error`, and `reconnectAttempt` is a
nonnegative integer. `useSnapbackConnection` passively observes the provider;
it does not itself add manager demand or open a socket. Mutation unwraps the
shipped client's `.result` envelope. It adds no client operation id, offline
queue, retry owner, or optimistic state.

Authoring/reference/args errors throw synchronously. Transactional admission
refusals throw during the committed subscription step and preserve the
previous group. Query/runtime and provider-terminal failures publish the
`error` variant. Mutation failures reject. Cleanup errors go to the
provider-level diagnostic sink and inspection, never a dead component.

### Cancellable lifecycle and transactional admission

The client/live manager gains one existing-owner extension:
`startLiveQuery()` returns immediately with a handle whose
`dispose()` is idempotent and whose `settled()` promise resolves after all
subscribe/unsubscribe/socket work and timers settle. A late start success after
dispose is immediately unsubscribed; a late failure is observed by the
provider diagnostic sink. Subscribe, reconnect, heartbeat, and unsubscribe
work is owned by the handle generation and cannot publish after disposal.

Each store has separate monotonically increasing `publicationGeneration` and
`idleDisposalEpoch`. Last unsubscribe schedules a microtask tagged only by the
idle epoch; a committed reacquire invalidates it without changing publication
identity. React render allocates no store, reservation, manager demand, timer,
or connection. Resource acquisition occurs only from
`useSyncExternalStore`'s committed subscribe callback.

The existing registry implements one transactional
`reserveMany/acquireMany/commit/release` path over deduplicated identities.
Reservations count against caps, expire at the end of the committing turn if
abandoned, and are invisible to delivery until commit. Provider caps are 256
cached store objects, 1,024 committed hook consumers, and 64 simultaneous
server subscriptions on the one connection; the first two are registry
headroom, not permission to exceed the third.

Group admission counts only deduplicated net-new server demand plus current
provider demand. At saturation, replacement uses the server's exact
predecessor-supersession path only for retired stores uniquely owned by that
group. Shared retired stores cannot be reclaimed; an over-cap update refuses
atomically and preserves the old group. Failed/abandoned reservations, partial
handoff, and unsubscribe failure never attach a partial successor. Mandatory
fixtures cover 64-to-64 replacement, shared-predecessor refusal, concurrent
near-cap commits, abandoned renders, Strict Mode reuse, and the 1,024th/
1,025th consumer boundary.

### One finite canonical identity grammar

The client exports one `CanonicalClientValueV1` validator/canonicalizer used by
React and the external-store registry. It accepts null, booleans, finite JSON
numbers with `-0` normalized to `0`, UTF-8 strings, arrays, and own enumerable
data properties of ordinary/null-prototype objects. It never invokes a getter
or proxy trap after validation; accessors, proxies, symbols, functions,
undefined values, sparse arrays, cycles, exotic prototypes, and duplicate
normalized keys refuse. Limits are depth 32, 4,096 total nodes, 256 fields per
object, 1,024 array entries, 65,536 UTF-8 bytes per string, and 262,144
canonical UTF-8 bytes total.

The store key is the unambiguous canonical serialization of:

```text
[
  "snapback:react-store-key:v1",
  providerInstanceId,
  {artifactKind,schemaVersion,appId,id,name,kind},
  canonicalArgs
]
```

There is no asynchronous or sync-vendored hash. Credentials are structurally
excluded because neither provider identity nor the complete generated
reference/args carrier contains them. Web, Node, and Expo golden vectors,
including accessor/proxy refusals and every quantitative boundary, must match
byte-for-byte.

### Executable package and demo gate

The shipped scaffold command is
`snapback new <directory> --template react`; no `create` alias is claimed.
`@snapback/client` ships root declarations and `@snapback/react` declares
React and `@snapback/client` as peer dependencies whose ranges are rewritten
and verified by the release packer. Packed-only web and Expo fixtures install
materialized tarballs with no workspace alias, ambient shim, cast, or explicit
result generic, then typecheck required/optional/nullary/skipped/wrong/excess
args, build, run the starter, observe a live change, mutate, and prove cleanup.

The maintained comparison target is `demos/signal-desk`, specifically its
React Snapback adapter under `src/backends/snapback.ts`; its acceptance commands
are the package's `test`, `typecheck`, `build`, and Snapback acceptance scripts
declared in that demo's `package.json`. It migrates durable multi-query
assembly to `useSnapbackQueries`; its separate presence adapter remains
explicit. Neither this document nor implementation may call the demo
"already imported" unless it is tracked in the same revision.

The landing gate additionally proves provider A→B→A context swaps, concurrent
multi-root use, client custody blank/resume, late start success/failure,
unsubscribe failure, missing close events, zero residual timers/listeners/
subscriptions, exact cap inspection, package inventory, and the complete
state/aggregation table. Removed presence, RQS, optimistic, SSR-data, and
authority-partition codes/tests are marked deferred and cannot count toward
React-v1 capability evidence. Status remains Review and no capability is
advertised until that gate passes.

## Final author reconciliation after round 3

Round 3 reached the protocol's maximum round with one READY review and one
NOT READY review. The following requirements close the remaining material
ambiguities. They are implementation requirements, not an unreviewed claim
that the design has converged; this LLP remains Review and the capability
remains unadvertised until every executable gate below passes.

### Prepared binding and provider ownership

The public seam is one asynchronous admission step:

```ts
const binding = await client.prepareReactBinding({ generatedManifest });
```

`prepareReactBinding` validates the manifest against the connected
deployment, then returns an immutable prepared binding containing the exact
`appId`, profile, deployment identity, auth mode, function-catalog digest,
capability digest, and complete generated-reference map. `SnapbackProvider`
constructs synchronously from this already-prepared binding. It never accepts
an unprepared client, never performs asynchronous validation during render,
and never manufactures references. `QueryReference` is exactly the generated
`LiveQuery` reference type admitted by that binding.

The provider owns one external-store registry and one LLP 0059 barrier
participant. The registry borrows the externally owned client's transport; it
does not own or dispose the client. `provider.dispose()` drains the provider's
stores, manager work, listener registrations, and timers, then unregisters
its barrier participant. No `disposeClient` option exists. A second provider
may borrow the same client, but has a distinct registry, participant,
provider-instance identity, caps, and inspection surface.

### Static core capability composition (dated amendment 2026-08-10)

React capability selection is static without adding another store owner.
`@expo/snapback-react/core` constructs its provider over this section's same
`createRegistry` implementation, prepared binding, canonical query stores,
presence rooms, optimistic layers (including `useSnapbackOptimisticCreate`),
outbox projection, barrier participant, and disposal protocol. Its provider
facade deliberately has no `surface`, `assets`, `assetSourceAdapter`, or
command-task inspection member. The root `@expo/snapback-react` entry remains
the Full compatibility composition and decorates that owner with the existing
synchronous surface, command, and asset projections.

The Full entry initializes command and asset factories statically before any
provider can be constructed. Therefore `provider.surface(...)`, command
`start()`/`retry()`, and asset hooks keep their existing synchronous contracts;
there is no asynchronous import, proxy task, or second registry. The narrow
entry reaches prepared-binding admission through
`@expo/snapback-client/react-binding` plus the existing canonical-value
subpath, rather than through the client's root barrel. This makes
`commands.mjs`, `assets.mjs`, and the root-only React capability module absent
from its literal bundle graph.

The package root's export surface and behavior remain compatible. The core
entry exports the provider, query/group, mutation, optimistic-create,
presence, outbox, connection, and framework-neutral observer seams, and omits
surface/command/asset and root-only lifecycle exports. Metrology carries three
negative core profiles plus one Full positive profile; the package test also
constructs a core provider, proves one shared server subscription, and proves
the optional provider members are absent.

### Closed connection and cancellation protocol

The shipped connection axis is the closed union `idle | connecting | live |
polling | stale | disconnected | closed | error`. `refreshing` is a
same-authority resynchronization overlay on an already-published query state,
not a connection state. The normative state/aggregation table enumerates all
connection values: `closed` and `error` are terminal; `disconnected` preserves
the last admissible value as stale when one exists; `connecting`, `polling`,
and `stale` never invent a value; and `live` publishes only the latest accepted
generation.

`startLiveQuery` returns a handle with three operations:
`started(): Promise<void>`, idempotent `dispose(): void`, and
`settled(): Promise<void>`. `started` resolves only after that handle's
subscription is admitted and rejects with its terminal start failure.
`settled` resolves after every task, timer, subscribe, late-start cleanup, and
unsubscribe owned by that handle has settled. Manager-owned reconnect and
heartbeat work is accounted separately by `manager.settled()`. Provider
disposal awaits every handle and the manager, and routes observed cleanup
failures to diagnostics without leaving an unhandled rejection.

### Exact saturated replacement semantics

There is no general atomic 64-to-64 batch replacement. Below the server cap,
admission is make-before-break. At the cap, only an exact one-for-one
replacement may use predecessor supersession, and only when the predecessor is
uniquely owned by the committing group. Any update requiring two or more
net-new subscriptions while saturated, or involving a shared predecessor,
refuses before mutation with `SNAPBACK_REACT_GROUP_CAPACITY` and preserves the
entire previous committed group. The required cap fixtures therefore cover
one-for-one supersession, multi-entry saturated refusal, shared-predecessor
refusal, concurrent near-cap commits, and exact post-settlement resource
counts.

### Exact identity bytes and limits

The canonical key includes the complete generated reference:

```text
[
  "snapback:react-store-key:v1",
  providerInstanceId,
  {
    artifactKind,schemaVersion,appId,id,name,kind,
    implementationHash,argsContractHash,resultContractHash
  },
  canonicalArgs
]
```

Validation captures each ordinary/null-prototype object's own property
descriptors once, rejects accessors before reading values, and canonicalizes
the captured data without another property lookup. Proxy input is refused
because descriptor enumeration/inspection is guarded and any trap, mutation,
or inconsistent descriptor set refuses the value.

The byte grammar is RFC 8785 JSON Canonicalization Scheme for the admitted
subset, with no Unicode normalization. Lone UTF-16 surrogates refuse.
String-size limits count the original scalar-value UTF-8 bytes. The
262,144-byte limit counts the complete final canonical key bytes. Node count
includes the args root and every scalar, array, and object value; object field
names are not nodes. Depth is one for the args root and increases at each
array/object child. Object-field and array-entry limits are per container.
Since no Unicode normalization occurs, there is no “normalized duplicate key”
case.

The 1,024-consumer cap counts committed hook subscriptions: one ordinary
non-skipped query hook is one consumer, and each non-skipped child of a query
group is one consumer. Skipped entries, abandoned renders, reservations, and
registry cache entries are not consumers.

### Exact executable gate

The packed web fixture must install only materialized tarballs for
`@snapback/client` and `@snapback/react`, then run its checked-in `typecheck`,
`test`, `build`, and live starter acceptance commands. The packed Expo fixture
must install the same tarballs and run its checked-in `typecheck` plus
`npx expo export --platform ios`; this gate proves bundling and native-target
module resolution, not an iOS runtime claim. Package inventory rejects
workspace aliases, undeclared generated shims, and source-tree fallbacks.

`demos/signal-desk` must expose both `test` and `test:react` receipts. The
React receipt must exercise the real Snapback adapter, prepared binding,
provider, group transition, mutation, live update, and zero-resource cleanup;
the generic demo receipt must not stand in for it. Exact checked-in command
names and their successful outputs are capability evidence.

## Post-bakeoff implementation extension

The backend bakeoff exposed two acceptance gaps that the narrowed v1 left
open. This section is normative and supersedes only the earlier nonclaims
about generated group references and React adoption of an already-owned
register-mode bundle. It follows the Fable-family super-refine recommendation
recorded in
`llp/reviews/0114-first-class-react-and-query-groups.fable.md`; it does not
revive the rejected React-owned bundle, authority, hydration, or cache owners.

### Bundle-primed generated query groups

LLP 0112 now owns the complete generated-reference, target-capability,
preparation-transfer, registered-adoption, and fallback contract for this
section. The paragraphs below retain LLP 0114's React ownership summary but
defer exact identity bytes, bounds, diagnostics, and cleanup to LLP 0112; where
older wording conflicts, LLP 0112 is authoritative.

Codegen projects every register-eligible (one through 32, all-`LiveQuery`)
`routes.manifest.json` entry into one exact `queryGroupReference` under the
generated `groups[routePattern]` map. The reference binds the app, route
pattern, canonical route definition hash, complete child function references,
collision-free deterministic child labels, literal argument mappings, and
typed route parameters. A prepared binding reconstructs and admits that
reference from the generated routes and already-admitted function manifests;
a stale, partial, forged, cross-app, non-live child, wrong-parameter, or
route-manifest-identity mismatch refuses before a bundle request.

`binding.prepareQueryGroup(reference, params)` is the pre-mount acquisition
seam. It asks the bound headless client for one LLP 0090 register-mode route
bundle, verifies that the closed response contains exactly the generated
children, and returns an opaque one-shot prepared owner. The client retains
the grant in its existing custody store; public inspection carries only child
registrations, the caller-known connection label, attach deadline, and
`{commitVersion,generation,versionStream}` provenance. One provider atomically
consumes that owner and lazily consumes each registration when the canonical
child store starts. A single-query consumer and a generated group still share
the same store. No ordinary snapshot subscribe may race the registered child.
Unconsumed pending registrations remain provider-owned on the same connection
and are removed by provider disconnect.

An explicit `fallbackToLive: true` handles only absence of LLP 0112's
target-authored `registered_bundle_boot_v1` capability and performs no bundle
request. Existing `SNAPBACK_BUNDLE_*` target refusals never downgrade. LLP
0092's separate attach-deadline recovery returns the same generated group with
visible `source:"live-recovery"` and `boot:null`; neither path calls a failed
or expired bundle a single-commit boot. `boot` is immutable provenance for the
initial registered cut, not a claim that later independently delivered child
states remain transactionally aligned.

### Strict Mode, HMR replacement, and late work

The package retains a dedicated React-level lifecycle witness in
`packages/snapback-react/lifecycle.test.mjs`. It drives a room through
`ready → stale → resyncing → ready`, then executes the LLP 0059
`quiesce → blank → resume` barrier and proves predecessor entries are blank
before a fresh successor-authority room is visible. Its HMR-shaped overlap
constructs the successor provider before disposing the predecessor and proves
that disposal drains only predecessor handles, republishers, listeners,
barrier participation, and timers. The successor remains authoritative, and
final cleanup reports zero React-owned resources.

### Authorization-denial projection (dated amendment 2026-08-01)

The 0137 A1-Expo sweep (finding f4, carrier-agnostic) showed a bearer custody
transition to a lesser-privileged successor presenting on the hook as
`ready`/`refreshing` with zero rows and `error: null` — the successor's
server-answered `SNAPBACK_AUTH_PERMISSION_DENIED` never reached the closed
state algebra, and the next connection event wiped any error snapshot back to
`pending`.

The headless client now records such a denial on the handle as a frozen
`authorizationDenial` fact and delivers an `authorization_denied` update
(rows already blanked by the custody barrier). The provider projects that
update as the `error` variant carrying the denial diagnostic. Two rules keep
the projection renderable:

- An `error` snapshot survives ordinary connection movement (`connecting`,
  `disconnected`, …): only the dedicated `error`/`closed` connection
  transitions may replace it, and only the next authoritative delivery —
  a fresh subscribe under an authorized successor — clears it back to
  `ready`.
- The denial never weakens the custody barrier: predecessor rows blank
  before any successor work, and the denial diagnostic is the server's
  uniform non-disclosing refusal.

The transition itself settles (`replaceBearerToken` resolves) when its only
failures are answered denials; the denied handle stays parked and the next
authority transition fresh-subscribes it. Regression witnesses:
`packages/snapback-client/bearer-rotation.test.mjs` and
`packages/snapback-react/authorization-denial.test.mjs`.

### Offline binding receipt (dated amendment 2026-08-01)

The 0.1.8 re-verification (issues/20260801-0137-reverify-react-cold-boot-
binding-requires-server.md) showed the process-cold offline boot was
unreachable for an external consumer: `prepareReactBinding` awaited
`Promise.all([inspect, authSession])`, so a cold process with the backend
unreachable threw `fetch failed` before a provider existed — while the
LLP 0129 Phase 0 client machinery below it (verified persisted entries,
retained rendering, offline-boot survival) was already capable of rendering.

Online preparation now persists a **binding receipt** into the client's
persisted RQS store (feature-detected optional store methods;
availability-only, never failing preparation): the digest of the exact
normalized generated manifest the admission proved equal to the deployment,
plus the deployment identity, route-manifest hash, auth mode, capability
digest, and registered-bundle availability that admission computed. When a
later preparation's inspect/session fetch fails with a transport-provenance
connectivity error (and ONLY then — a server-answered refusal is never
masked), the client re-runs the complete admission against the persisted
identity: digest equality proves the presented generated input is
byte-identical to the one online admission proved. In legacy manifest mode
the deployed view is that manifest; AppDescriptor mode uses the compact
admitted projection specified below. In both cases every per-item check
re-runs in the same owner. The prepared binding names its provenance:
`binding.source` is `'deployment' | 'persisted-receipt'`.

The receipt digest reuses the getter-free canonical JSON implementation but
does **not** classify the complete generated manifest as a React query
argument. It has a separate finite artifact profile: depth 64, 65,536 nodes,
1,024 fields per object, 4,096 array entries, 4 MiB per string, and 16 MiB
canonical bytes. `CanonicalClientValueV1`'s public 4,096-node/262,144-byte
limits remain unchanged for query arguments and store keys. This distinction
is load-bearing: an admitted function catalog may legitimately exceed the
argument-node budget; an artifact beyond the separate receipt profile refuses
instead of silently producing an unbound offline receipt.

The asynchronous-admission rule of this spec is unchanged: admission
completes (against the persisted identity) before a synchronous provider is
constructed. A drifted generated manifest never adopts the receipt. Once a
well-formed same-app receipt is found, digest/generation mismatch uses the
existing typed `SNAPBACK_REACT_BINDING_MISMATCH` refusal rather than exposing
the incidental connectivity error; a missing, foreign, unreadable, or
unknown-version receipt still leaves the original connectivity failure
unmasked. The user-switch custody wipe drops the receipt with the rest of the
store. Regression witness:
`packages/snapback-react/cold-boot-binding.test.mjs` (real client over a
scripted wire; warmed store; cold offline process reaches a ready provider
rendering `freshness: 'retained'` rows).

**Dated implementation amendment (2026-08-06, AppDescriptor projection).**
LLP 0179's portable AppDescriptor intentionally does not duplicate the
server-owned function manifest or ephemeral policy interiors, so the original
digest-only receipt could prove descriptor identity but could not reconstruct
the admitted RQS/presence view. Descriptor-mode online preparation now adds a
compact projection to the same `snapback` React binding receipt: each admitted
function's server-derived query-artifact hash and authority-independent fact,
the admitted ephemeral collection definitions, descriptor identity, and the
existing registered/mixed capability facts. The application supplies the
byte-identical descriptor again; neither the descriptor nor retained rows are
copied into the receipt. Cold preparation reconstructs the inspection input
and re-runs the existing per-function, result-contract, schema/ephemeral,
surface, and capability admission in this owner before provider construction.
An exact descriptor can therefore render the existing RQS rows through
`useSurface`; a descriptor/generation drift remains the typed binding
mismatch. Regression witnesses:
`packages/snapback-react/cold-boot-binding.test.mjs` and
`demos/expo-golden-path-fixture/tests/g2-falsification.mjs`.

**Dated implementation amendment (2026-08-06).** The IndexedDB arm's
boot-time Web Locks election race silently dropped the receipt commit
(`issues/20260804-guide-gap-react-expo-offline-cold-boot.md`). Its commit now
returns `'deferred'` and flushes when this instance's election settles, with a
`savedAt` staleness guard; terminal refusals surface as
`SNAPBACK_REACT_BINDING_RECEIPT_NOT_PERSISTED`. Regression witness:
`packages/snapback-react/cold-boot-binding-indexeddb.test.mjs`.

### Local development binding synchronization (dated amendment 2026-08-03)

Metro/HMR may load a newly generated function or result contract while the
local backend still serves the immediately preceding generation. The binding
mismatch remains an admission refusal, but `prepareReactBinding` now treats it
as a bounded synchronization state only after one live inspection proves both
the exact `local-dev-sqlite-ibex` target profile and `dev` auth mode. A hosted,
sessions, unknown, receipt-only, or otherwise unproved context refuses
immediately with `SNAPBACK_REACT_BINDING_MISMATCH` as before.

The default window is 10 seconds with a 250 ms poll interval (callers may
configure finite values up to 60 seconds and 5 seconds respectively, or set
`developmentSync: false` for immediate refusal). Each retry repeats complete
manifest/deployment admission. Once a live mismatch opens the loop, retries
disable persisted binding-receipt fallback: a receipt for the generated
successor cannot authorize provider construction while the live backend is
unreachable or still serves its predecessor. A transient connectivity failure
inside the already-proved local window remains waiting; any other refusal
terminates immediately. No provider exists until one live retry admits every
artifact.

`developmentSync.onStateChange` is an observational UI projection with
`waiting | ready | timed-out` states. Its primary messages are product copy
(`Updating local backend…`, `Local backend updated.`, and `Client and local
backend are still out of sync.`); callback exceptions cannot affect admission.
On timeout the rejected Error uses human-facing recovery text, while
`error.code`, `error.diagnostic.code`, expected/actual generation details, and
three concrete recovery actions retain
`SNAPBACK_REACT_BINDING_MISMATCH` for expandable developer details. The stable
diagnostic is not hidden or weakened; it is no longer the primary application
copy in the positively identified dev-loop case.

Regression witness:
`packages/snapback-react/binding-development-sync.test.mjs` (predecessor →
backend-unreachable → successor recovery with a prior receipt present;
bounded persistent mismatch; opt-out; and hosted/sessions loud refusal).

## LLP 0157 acceptance boundary — 2026-08-03

Accepted LLP 0157 places one semantic materialization address beneath this
Spec's unchanged provider-scoped React key. The existing key remains the UI
registry index; after composition admission it resolves through the exact
`qmk1` subkey plus client-store/provider namespace and LLP 0053 query instance.
The bound headless client is the sole producer of LLP 0157's complete
`AuthorityPartitionV1`, including principal/data scope and the explicit
tenant, provider, fingerprint, and delegation axes; callers still cannot
author a partition. Prepared binding must exact-match the LLP 0157 activation
and generated-reference facts before creating a materialization. This note
does not accept this Review-status Spec or advertise a new capability.

## Bounded subscribe-failure window — 2026-08-04

A query store whose subscribe rejects before any transport exists (a
synchronous admission/demand failure — the RN carrier storm of
`issues/closed/20260803-rn-carrier-bricked-tosorted-registration-ledger.md`,
which the stream manager's socket backoff can never reach) enters a held
failure state: the rejection is published once through the existing `error`
snapshot, and re-subscription is owned by a per-store timer on the client's
reconnect ladder (`LIVE_RECONNECT_BASE_DELAY_MS` 250 ms doubling to
`LIVE_RECONNECT_MAX_DELAY_MS` 10 s). While the window is armed, render-,
mutation-, and re-subscribe-driven start attempts are inert, so render
frequency is fully decoupled from attempt frequency. At the cap the store
keeps retrying at 10 s while demanded — the stream manager's own convention
for demanded-but-unreachable state; the provider has no terminal-failure
latch, and the held `error` snapshot keeps the failure visible the whole
time, so the retry is bounded-rate, never silent. A successful subscribe
resets the ladder; one-for-one supersession (an explicit invalidation that
must carry its predecessor witness immediately) and every store stop
(idle release, custody quiesce/blank, prepared-frame supersession, disposal)
clear the window. Healthy subscribes and async transport failures below this
layer are untouched. Regression witness:
`packages/snapback-react/subscribe-retry.test.mjs`.

### Mounted-provider HMR generation handoff (dated amendment 2026-08-05)

The 2026-08-03 local-development binding synchronization covers the
pre-provider window. Its post-provider sibling
(`issues/closed/20260803-react-hmr-reference-invalid.md`) remained: Metro/Vite
HMR can hot-replace the generated api module while the mounted
`SnapbackProvider` keeps a prepared binding admitted from the previous codegen
generation. Hooks then present a valid new-generation reference to
old-generation admission state, and the strict
`SNAPBACK_REACT_REFERENCE_INVALID` refusal — correct in substance — threw
uncaught through the application tree, turning a recoverable dev-loop handoff
into a crash.

The provider now treats that exact split as a **provider-boundary
invalidation**, under three fail-closed gates:

- **Positive development identification.** Recovery arms only when the host
  affirmatively identifies itself as development: Metro/React Native's
  compile-time `__DEV__`, a live bundler HMR host (`import.meta.hot` /
  `module.hot`), or an explicit `NODE_ENV === 'development'`. Absence of
  production markers is never treated as development, so release builds keep
  the strict throw.
- **Positive regeneration classification.** Only a complete same-app function
  reference whose codegen-stamped `expectedGeneration` names a *different*
  generation than the currently admitted deployment identity classifies as
  regenerated (`classifyRegeneratedReactReference`). Foreign appIds, missing
  generation stamps, and same-generation corruption stay strict even in
  development.
- **Deployment-proved re-admission.** The handoff
  (`handoffPreparedReactBindingGeneration`) polls the live inspection inside a
  bounded budget (the development-sync defaults: 10 s / 250 ms) until the
  deployment serves exactly the target generation, then re-runs complete
  per-function admission — reference completeness, result-contract
  compilation, and hash binding — off to the side, and publishes the whole
  new-generation admission view in **one synchronous swap** (a WeakMap
  overlay over the frozen binding; single-flight per binding and target).
  No frame can pair a new reference with old admission state: until the swap,
  new-generation references resolve to a handoff descriptor whose snapshot is
  a pending/refreshing boundary frame; after it, admission is exactly as
  strict as boot-time preparation, proved against the live deployment.

The complete polling/re-admission engine is a literal development/failure-only
dynamic runtime (`react-binding-hmr-runtime.mjs`), reached through the React
arm's existing optional runtime loader only after the synchronous positive
development and regeneration gates above pass. The strict classifier, active
generation overlay reads, and the one-write publication seam remain in the
always-loaded binding module. This boundary is semantic, not a hidden byte
transfer: a production build can never arm HMR recovery and therefore never
loads the optional chunk, while a development handoff downloads and executes
the complete machinery before it can publish a replacement admission view.
The LLP 0145 metrology gate excludes that literal optional chunk from its
frozen successful-production entry closure and the package/browser closure
tests still resolve and bundle the shipped runtime itself.

Renderability during and after the window: unchanged functions re-admit
immediately (their store keys exclude the generation stamp), so untouched
queries keep full continuity; changed queries show the brief boundary frame,
then subscribe fresh under the new contract. Deferred mutation references
admit at call time after awaiting the handoff, so a tap during the window is
a handled rejection at worst, never an uncaught render error.

What the overlay cannot re-prove from the live inspection it refuses to hand
off: a changed routes manifest, changed ephemeral collection declarations, a
changed query-group child, or a deployed manifest that fails admission ends
the handoff, and development performs a **controlled full reload** — one
clear `SNAPBACK_REACT_HMR_REBIND_FAILED` console diagnostic, the
`developmentHmr.onReloadRequired` seam (defaulting to `DevSettings.reload` /
`location.reload` where reachable), and an `error` snapshot on the affected
hooks. Presence/ephemeral references are outside the v1 handoff: a changed
collection under HMR resolves through the reload path.

Regression witness: `packages/snapback-react/hmr-generation-handoff.test.mjs`
(atomic handoff with continuity, mutation deferral, controlled reload on a
never-redeployed backend, and strict production/foreign admission — all with
zero uncaught errors).

### Client subscription-churn diagnostic (dated amendment 2026-08-10, LLP 0219)

In positively identified development builds, `useSnapbackQuery` now observes
committed descriptor-identity transitions per hook instance. The first
committed descriptor establishes the baseline; only a later commit to a
different canonical descriptor counts. A same-descriptor Strict Mode
unsubscribe/resubscribe and the mounted-provider HMR generation handoff do not
count. Fresh but content-equal arguments never change the descriptor and never
count — this restates this Spec's content-keying as the correctness fix, not a
memoization requirement. `useSnapbackQueries` keeps its existing content-keyed
child-store sharing and group replacement semantics; no separate group-level
churn producer ships in this slice.

The thresholds are tunable; the shipped defaults are eight transitions inside
two seconds. `SNAPBACK_REACT_SUBSCRIPTION_CHURN` names the
development-captured hook call site and generated reference, recommends
memoizing or hoisting genuinely changing inputs, and emits into the bound
headless client's LLP 0219 diagnostics channel. React owns neither a parallel
history nor direct console delivery. The static package split does not create
a second owner: both the root and `@expo/snapback-react/core` export the same
provider-bound diagnostics projection from the shared implementation.

## Draft own-write atomic group amendment — 2026-08-26

**DRAFT-PENDING-REVIEW — design only.** This amendment owns the group and
provider semantics proposed for Wanted #4 in
`issues/shelved/20260820-familiar-live-subscription-contention.md`. It is inactive;
the shipped optionless group continues to make no atomic claim.

### API, pressure interest, and compatibility

The proposed overload is
`useSnapbackQueries(entries, { atomicOwnWrites: [mutationRefs...] })`, with an
equivalent framework-neutral group observer. It provides own-write atomic
publication only; unrelated writes remain independently versioned and a
relational/aggregate query remains the general cross-set atomic answer.

Grant negotiation is insufficient. Before a group generation becomes active,
the provider reference-counts its interest in every canonical child and waits
for each subscription's exact LLP 0094
`liveDeliveryPressureInterest` subscribe-output echo. The first local 0→1
interest transition establishes a pressure-participating successor; the last
1→0 transition establishes a successor without interest. A missing/mismatched
echo leaves the group at a typed unavailable blank and matching mutations
refuse before transport.

Mounting the first atomic group after an unnegotiated connection open also
publishes `SNAPBACK_LIVE_DELIVERY_PRESSURE_UNAVAILABLE`. It does not re-open,
rotate, or silently upgrade the existing grant: re-open cannot change the
binding. The diagnostic guides the caller to create a fresh provider/
connection whose initial open can preflight and offer the protocol. Existing
ordinary subscriptions continue unchanged.

The pressure interest is an internal sidecar on the shared canonical store.
Only opted group observers in the echoed interest generation see it or receive
its notification. Ordinary `useQuery`, `useQueryState`, headless handles, and
optionless groups retain their existing public shape and notification bytes,
including when they share the same authoritative child store.

### Closed group snapshot algebra and state placement

Gate ownership and public data availability are orthogonal. `blank` is never a
lease or acquisition state:

```ts
atomicDelivery: Readonly<{
  gate: "idle" | "held"
  publication: "rows" | "blank"
  groupIdentity: string
  groupGeneration: number
  requiredRevision: number | null
  ownerLabels: readonly string[]
  deadlineAtMs: number | null
  failureCode:
    | "SNAPBACK_ATOMIC_QUERY_GROUP_HOLD_EXPIRED"
    | "SNAPBACK_ATOMIC_QUERY_GROUP_LIFECYCLE_FENCED"
    | "SNAPBACK_ATOMIC_QUERY_GROUP_OUTCOME_UNKNOWN"
    | "SNAPBACK_LIVE_DELIVERY_PRESSURE_UNAVAILABLE"
    | null
}>
```

The opted return type is a closed discriminated union. The
`publication: "rows"` arm retains the existing group `status`, non-null
`data`, non-null `queries`, `errors`, and freshness algebra. The
`publication: "blank"` arm is exactly `status: "blank"`, `data: null`,
`queries: null`, `errors: {}`, and `freshness: "unknown"`, plus its typed
failure. Existing `connection` and `store` members are common to both arms.
It exposes no retained or staged row. Either publication arm may have
`gate: "held"`: acquiring an idle blank successor keeps it blank until a
committed V is fully covered.

Field invariants are closed: `gate: "idle"` requires
`requiredRevision: null`, empty `ownerLabels`, and `deadlineAtMs: null`;
`gate: "held"` requires a finite deadline and its value-free owner label, with
`requiredRevision: null` before settlement and exact V after committed
settlement. `publication: "rows"` requires `failureCode: null`; a mounting
blank may use `failureCode: null`, while every terminal/recovery blank uses one
listed code. Successful V coverage changes publication to rows and clears the
failure.

`requiredRevision`, value-free owner labels, deadline, and frozen/staged
snapshots belong to one group generation, never the canonical child store or
LLP 0267 inspection row. The opted group projects only each child's immutable
authoritative base. It never consumes or publishes optimistic overlays. Thus a
shared child may publish normally to an ordinary caller while group A waits at
V and group B waits at W; each generation consumes the same authoritative
advances against its own revision.

While held, one generation retains exactly its frozen authoritative public
snapshot when it has one, each gate-entry child's latest immutable
authoritative snapshot, and bounded gate metadata. A latest child update
overwrites the previous staged value; no delivery log is retained.

Each generation registers a synchronous, exception-isolated bookkeeping
listener below the ordinary consumer-notification seam. Accepted content and
`current_as_of` invoke it after the canonical authoritative base applies the
revision, including value-equal delivery for which LLP 0278 suppresses an
ordinary notification. The listener updates the one latest staged snapshot and
tests coverage; it does not delay ordinary consumers. Before staging or testing
coverage, it reads the monotonic clock. If `monotonicNow >= deadlineAtMs` for a
held observing generation, it performs the finite-hold expiry transaction and
returns without releasing predecessor rows, even when this callback is a
reconnect snapshot that already covers V.

### Provider mutation intercept, optimism, and all-or-nothing acquisition

The intercept is the provider's settled-only foreground mutation dispatcher,
after synchronous reference/args/authority/capability validation and before
both optimistic overlay installation and the first transport call. Every React
hook and framework-neutral provider mutation facade uses it.

Optimism is forbidden for a mutation reference matched by any active
`atomicOwnWrites` group. A call carrying an optimistic reducer refuses
synchronously with `SNAPBACK_ATOMIC_QUERY_GROUP_OPTIMISTIC_UNSUPPORTED` before
an overlay, mutation attempt, or transport exists. Unmatched mutations and
ordinary child consumers retain the pre-amendment optimistic lifecycle.

For mutation reference M, the provider snapshots all active group generations
whose `atomicOwnWrites` names M, sorts their generated identities, first
expires any past-deadline holder, and acquires the complete set in one
provider-local transaction. A generation with `gate: "held"` blocks; an idle
rows or blank generation is acquirable. If any match is held or lacks every
exact subscription-interest witness, none changes and M refuses before
transport with `SNAPBACK_ATOMIC_QUERY_GROUP_BUSY` or
`SNAPBACK_LIVE_DELIVERY_PRESSURE_UNAVAILABLE`. Partial multi-group acquisition
is forbidden.

Refusal precedence is deterministic: validate every match's exact pressure
binding first and return `SNAPBACK_LIVE_DELIVERY_PRESSURE_UNAVAILABLE` if any
is unavailable (with no `retryAfterMs`); only an all-available set is checked
for held leases and may return `SNAPBACK_ATOMIC_QUERY_GROUP_BUSY` with the
retry point below.

There is no `closing` state. Replacement or disposal atomically removes the
predecessor from the active acquisition registry and fences it before any
asynchronous listener/subscription cleanup begins.

Successful acquisition sets every match to `gate: "held"` and freezes its
rows arm, if present, before transport. A committed settlement sets
`requiredRevision` to the exact server-issued `committedRevision` V (LLP 0200
§2.1); no local counter, optimistic revision, child row, or inspection fact may
derive V. A commit-free refusal or synchronous local failure releases every
acquisition. A rows generation publishes its latest staged authoritative
snapshot once; a blank generation remains blank because no V proved recovery.
Outcome-unknown takes the blank-successor transition below and never guesses
whether the write committed.

### Finite hold, automatic blank successor, and refused-write progress

At acquisition the generation fixes
`deadlineAtMs = monotonicNow + liveDeliveryPressureMaxAtomicHoldMs`, using the
finite value echoed by LLP 0219 negotiation. Mutation settlement, resync,
reconnect, supersession, and overload-episode extension never reset it. Timer
delivery, every later acquisition, and every snapshot/coverage bookkeeping
callback enforce the monotonic deadline.

At expiry one provider-local transaction fences the predecessor, discards its
frozen/latest staging, releases its lease, removes it from the active registry,
and allocates `groupGeneration + 1` with `gate: "idle"` and
`publication: "blank"`. The external store publishes exactly that one
successor snapshot with `SNAPBACK_ATOMIC_QUERY_GROUP_HOLD_EXPIRED`. Late
coverage cannot resurrect the predecessor.

The successor immediately adopts the group's then-declared membership and
installs fresh generation-fenced bookkeeping listeners, but it publishes no
rows merely because those children already hold data. It may retain only each
child's latest authoritative internal snapshot. A later own-write acquisition
fixes gate-entry membership/V as usual; an explicit resubscribe/remount supplies
the separate no-write data-recovery barrier.

A later matching own write may immediately acquire this idle blank successor.
If it commits at V, complete authoritative coverage through V publishes a rows
snapshot and recovers the group. Remount/resubscribe remains an optional way to
recover data without a later write; it is never the mechanism that releases
the write lock.

The no-write recovery spelling is concrete: React unmounts and later mounts
the opted `useSnapbackQueries` group; the framework-neutral equivalent calls
the observer's existing `dispose()` and constructs a new observer with the same
declaration. That lifecycle creates another idle generation, fresh-establishes
every child, and publishes rows only after the ordinary initial all-child
readiness algebra is satisfied. V1 adds no hidden `retry()` API. This recovery
may observe independently versioned remote writes, exactly like initial mount;
it does not broaden the own-write atomic claim.

The same automatic-successor rule applies after outcome-unknown and every
non-terminal lifecycle blank while the logical group remains mounted and its
fresh exact pressure binding is available. Skip/ref/args/key or authority
replacement creates the already-required fresh blank generation. Provider or
explicit group disposal has no successor because the group is no longer
active; grant replacement creates one only after fresh negotiation and child
interest echoes succeed.

One generation admits one foreground gate and holds no wait queue. A busy
refusal returns the current blocking group identities and
`retryAfterMs = ceil(max(blockingDeadlineAtMs) - monotonicNow)`. The maximum,
not the earliest deadline, is the bounded point by which all **currently
observed** blockers will have been cut; acquisition enforces overdue cuts
synchronously. It remains no reservation or fairness promise, because a new
racer may acquire first. Repeated independent contenders can still starve one
another; callers needing FIFO progress must serialize or move the operation
server-side.

Gate-entry membership is immutable. An entry already `skip`ped owes no V. A
child-only LLP 0095 resync/reconnect changes the subscription generation while
preserving this group generation, required V, and original deadline. The
predecessor may not drop or skip a slow child to manufacture convergence.
Security/lifecycle blanking preempts data composition.

### Release and ordering

After settlement at V, the held generation releases once every gate-entry
active child's bookkeeping revision is `>= V`, using content or LLP 0200
`current_as_of(V)`. It publishes one rows snapshot from the latest
authoritative children and never exposes a mix below and at/above V. A held
blank generation makes this same transition directly from blank to rows. This
release additionally requires `monotonicNow < deadlineAtMs`; equality or a
later instant runs the expiry/blank transition first and permanently fences
the predecessor from releasing rows.

The overload invariant is **diagnostic-before-post-gate-group-notify**. A child
and its ordinary consumers may advance before a later sibling converts to
Refresh; the group remains frozen or blank. Once LLP 0095 accepts pressure,
LLP 0219 inserts `SNAPBACK_LIVE_OVERLOAD_DEGRADE` before the matching interest
generation's next external-store notification exposing post-gate data.

On same-lineage T-RECONNECT, LLP 0094 carries any transferred pressure episode
inside `LiveSubscribeOutput`; LLP 0095 applies it and inserts the diagnostic
before applying the successor snapshot. The snapshot may then cover V and
release the group only while its original local deadline remains unexpired; an
already-due deadline blanks/fences the predecessor before the coverage test.
It can therefore never overtake the warning or revive an expired hold.
Gate-entry/status and
typed security/lifecycle blank notifications expose no staged data and remain
outside this order.

### Acceptance additions

Framework-neutral and React evidence must prove: exact interest enrollment and
unnegotiated/mismatched refusal guidance; negotiated ordinary subscriptions and
all non-opted public projections remain byte-for-byte unchanged; shared child
ordinary publication while two groups wait at distinct revisions;
transactional multi-group acquisition; optimistic refusal before overlay and
transport; authoritative-only bounded latest staging; settlement-only V;
equal-value bookkeeping; skip/generation replacement; response pressure before
reconnect snapshot; unchanged deadline across successors; reconnect snapshot
coverage at/after that deadline expiring before row release; expiry/lifecycle
blank allocating an idle successor that a later own write acquires and recovers
at its V; maximum-blocker `retryAfterMs`; and diagnostic-before-post-gate
notification. The Familiar real-path and silent controls are required by the
coordinated LLP 0094/0095/0200/0219/0267 amendments.
