# LLP 0107: React presence and optimistic lifecycle

**Type:** Spec
**Status:** Implemented
**Systems:** React, React/Expo, Ephemeral state, Client integration, Realtime, Auth, Mutation settlement, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-27
**Revised:** 2026-08-15 (LLP 0218 P6 removed the elapsed queued-property
alias and throw-site-free `SnapbackQueuedMutationError` migration export)
**Revised:** 2026-08-10 (LLP 0219 presence-churn, queue-condition, and
advisory-delivery amendment over LLP 0218 P3); 2026-08-10 (LLP 0218 P3 React-contract amendment: accepted
offline intent resolves through the queued dispatch union instead of rejecting;
installed optimistic layers survive enqueue and follow LLP 0218 §4.2's total
durable-disposition map). 2026-08-10 (first-class generated optimistic create: one
provider-owned hook/view projects a typed durable provisional identity over
the exact canonical query store, consumes LLP 0133 logical-mint mappings for
response/query ordering and replay recovery, and preserves authority,
Strict Mode/HMR, and cleanup ownership). 2026-08-09 (queued-settlement truthfulness: a durably queued
React mutation rejects only through the distinct
`SnapbackQueuedMutationError` / `SNAPBACK_REACT_MUTATION_QUEUED` class so the
generated resolved type stays result-only; positive development builds warn
at enqueue and again after a 30-second blocked-head threshold). 2026-08-07
(strand backstop, Charlie Cheever's ruling via the
local-first author-gate packet, item 5 —
issues/closed/20260804-optimistic-matcher-strand-backstop.md options 2+3: a
confirmed `projectRecordFields` layer retires when its identified row is
absent from an authoritative delivery, and installed/confirmed optimistic
layers are surfaced in provider inspection; see "Replay-safety affordances"
and the implementation journal).
2026-08-04 (replay-safety affordances: the development-only
replay advisory and the declarative `projectRecordFields` projection helper;
see "Replay-safety affordances" and the implementation journal).
2026-08-01 (0137 A2 f1/f2 fixes: room readiness is adopted from
the proven level of an already-open managed socket instead of waiting for a
fresh `'open'` edge, and the prepared binding reconstructs every generated
reference — ephemeral included — in the public reference grammar so
`api.ephemeral.*` admits; see the implementation journal).
2026-07-27 (implementation reconciliation: the negotiated expiry
carrier, shared result validator, provider-owned presence and optimistic
stores, generated admission descriptors, Signal Desk migration, package
suites, guide, and exact ten-check retained receipt are complete; hosted
presence remains unsupported). 2026-07-27 (final author reconciliation pins
result-contract and expiry negotiation carriers plus remaining lifecycle
diagnostics/tests)
**Related:** LLP 0012, LLP 0013, LLP 0034, LLP 0043, LLP 0053, LLP 0059, LLP 0064, LLP 0094, LLP 0095, LLP 0101, LLP 0114, LLP 0105

## Summary

This Spec adds presence and optimistic rollback to LLP 0114's React surface as
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
): (args: FunctionArgs<Ref>) => Promise<
  | {status: 'settled'; result: FunctionResult<Ref>}
  | {status: 'queued'; clientMutationId: string; sequence: number;
      presentation: 'installed' | 'withheld' | 'unavailable'}>

useSnapbackSettledMutation<Ref extends MutationReference>(
  ref: Ref,
  options?: {optimistic?: OptimisticOptions<Ref>}
): (args: FunctionArgs<Ref>) => Promise<FunctionResult<Ref>>

useSnapbackOptimisticCreate<Ref extends MutationReference,
  Q extends QueryReference, Selected = readonly OptimisticCreateEntity<
    QueryRow<Q>>[]>(
  ref: Ref,
  options: {query: Q; args: FunctionArgs<Q>;
    select?(entities: readonly OptimisticCreateEntity<QueryRow<Q>>[]): Selected}
): {query: QueryState<Selected>;
    create(args: FunctionArgs<Ref>): Promise<
      | {status: 'settled'; result: FunctionResult<Ref>}
      | {status: 'queued'; clientMutationId: string; sequence: number;
          presentation: 'installed' | 'unavailable'}>}
```

References match the prepared app/target; scope/value/query args use LLP 0114's
`CanonicalClientValueV1`. Callers supply no identity, credential, authority,
room, expiry, or mutation facts. `prepareReactBinding` privately admits exact
generated/deployed collection name, schemas, key mode, bounds, app/target,
schema, and static policy/projection digest; runtime trusts only that map.
`ConnectionEphemeralCollectionReference` admits literal `Connection`; other,
stale, or forged refs refuse `SNAPBACK_REACT_PRESENCE_KEY_MODE_UNSUPPORTED`.

The optimistic-create overload admits only one generated local-executable
`Insert` into the exact documents-query table. Its canonical branch carries
the generated `Id<Table>` and complete row; its provisional branch carries a
distinct generated `ProvisionalId<Table>` backed by durable
`clientMutationId`, with the evaluator's speculative mint and server-authored
row metadata excluded. `select` is the explicit filter/order/count/relation
projection over both branches. `observeSnapbackOptimisticCreate` is the
framework-neutral acceptance twin of the hook.

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

Per LLP 0114, custody change synchronously blanks, then quiesces/disposes every
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

**Amendment (2026-08-10 — LLP 0218 P3).** Queued acceptance now resolves the
React dispatch union rather than rejecting: the settled branch carries only
the LLP 0101-validated result, while the queued branch carries the durable
identity, sequence, and provider-owned presentation disposition. A queued
optimistic layer survives enqueue and subscribes to that durable identity.
`pending` retains it; `settled` retires it through the same matcher/rebase path
as foreground settlement; `failed` rolls it back; `stranded`, `quarantined`,
and `resultGone` retire it while LLP 0043 custody remains visible in the
outbox; and `unknown` retains it as orphaned until evidence or authority loss.
Authority replacement still synchronously blanks every layer. This supersedes
the 2026-08-09 queued-rejection projection; `SnapbackQueuedMutationError`
was retained only as a deprecated, throw-site-free migration export through
the LLP 0218 window and was removed by P6 on 2026-08-15. Callers that
explicitly require a result-only promise use
`useSnapbackSettledMutation` or `{queue:false}`, which makes connectivity
failure reject before any enqueue.

In a positively identified development build, every queued hook dispatch logs
`SNAPBACK_REACT_MUTATION_QUEUED` with the mutation name and durable identity.
A timer observes the headless outbox facts after 30 seconds; if the queue still
has pending work and that identity has no terminal/replayed diagnostic, it logs
`SNAPBACK_REACT_MUTATION_QUEUE_WEDGED` naming the blocked mutation and sequence.
The timer is diagnostic-only and provider-owned/cleaned up. It neither drains
the queue nor adds the app-wide queue-state hook deferred to LLP 0208 G1.

### Replay-safety affordances

The reducer contract above — `update` is a replayable projection over an
evolving authoritative base, never a run-once action — is easy to violate by
writing `!row.liked` or `row.count + 1`
(issues/closed/20260803-guide-gap-optimistic-toggle-across-query-surfaces.md).
Two affordances make the violation visible or inexpressible without changing
admission, rebase, retirement, or refusal semantics:

- **Development replay advisory.** Outside an explicit production build
  (`process.env.NODE_ENV === 'production'`), admission additionally replays
  the just-validated initial projection through the same reducer and compares
  the results structurally. Divergence — or a throw — over the reducer's own
  output is the signature of the action-shaped toggle/increment reducers this
  advisory exists to catch: rebase recomputes each layer over every newer
  authoritative base, and once a base reflects the settled outcome an
  action-shaped reducer re-runs the user action over it. The heuristic is
  deliberately broader than the hazard: a reducer that intentionally grows
  the result over any base (an append-shaped optimistic create) is
  replay-safe under rebase-over-authority yet not idempotent over its own
  output, and will trip the advisory; revisit the heuristic when the
  optimistic-create path is paved
  (issues/20260801-optimistic-create-and-app-error-guide-gap.md). The
  provider emits one `console.warn` prefixed
  `SNAPBACK_REACT_OPTIMISTIC_REPLAY_DIVERGENT` per (mutation, query) pair per
  provider, pointing at the guide recipe. The advisory is observational only:
  it never mutates store or layer state, never refuses admission, and runs
  strictly after the side-effect-free admission validation.

- **`projectRecordFields(recordId, fields, {idField = '_id'})`** returns a
  frozen `{update, isAuthoritative}` pair for the records result shape,
  spread into the existing `optimistic` options. `update` sets the captured
  primitive field values on the identified row — idempotent by construction,
  so it passes the replay advisory. `isAuthoritative` retires only when the
  identified authoritative row carries, for every projected field, the
  mutation receipt's value when the receipt is an object carrying that
  field, else the captured intended value — the complete-receipt matcher the
  recipe demands, derived from the same declaration. Intended values must be
  `boolean | number | string | null`; a non-string/empty record id or
  `idField`, an empty or non-primitive field set, a field set containing the
  id field itself, or a non-array projection base throw `TypeError`. Receipt
  field presence is own-property presence (`Object.hasOwn`). Because the
  helper always supplies a matcher, the revision-based fallback retirement
  never applies to its layers. **Row-absence backstop (2026-08-07 ruling,
  options 2+3 of
  issues/closed/20260804-optimistic-matcher-strand-backstop.md).** For the
  paved path only, a confirmed helper layer additionally retires when its
  identified row (by the layer's `idField`/`recordId`) is absent from an
  authoritative delivery of the query it projects onto: a field projection
  on a row that is not present has nothing to project, so absence in an
  authoritative result is evidence the overlay's claim is moot
  (filtered-out and server-deleted are deliberately indistinguishable
  here). Absence is conclusive because every authoritative delivery at
  this surface is the complete current result set for the exact
  (query, args) subscription — DK-3 `live_delta` frames are materialized
  into the full row set client-side before delivery (LLP 0008 §DK-3), and
  LLP 0114 Channel B retained frames never advance the authoritative
  revision and never key retirement (the confirmation-time absence check
  is gated on `freshness === 'current'` for the same reason). The scope is
  carried by a module-private symbol brand on the exact matcher function
  the helper returns: a caller who overrides `isAuthoritative` with their
  own function — like every hand-written matcher — keeps the ratified
  complete-receipt semantics exactly, with no timer and no delivery-count
  backstop. A projected field settled to a third value while the row stays
  present still strands the layer; that residual is visible through the
  inspection surface below. The helper claims no new authority and adds no
  option surface.

- **Confirmed-layer inspection.** Registry (and therefore provider)
  `inspection()` reports `optimisticLayers` (installed layer count across
  stores) and `confirmedOptimisticLayers` — one frozen
  `{attemptId, mutationId, queryId, confirmedRevision, storeRevision}`
  entry per confirmed, not-yet-retired layer — so stranded or long-lived
  confirmed layers are visible with their mutation/query pair instead of
  silently holding a store pin against the 256-layer cap.

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
subscriptions, publishers, timers, late work, resync reasons, cleanup error,
and the optimistic-layer surface above (installed count plus confirmed-layer
mutation/query identification).

### Client dev diagnostics amendment (2026-08-10 — LLP 0219)

The presence lifecycle now observes committed scope/value descriptor-identity
transitions per `useSnapbackPresence` hook instance in positively identified
development builds. Same-descriptor Strict Mode resubscribe does not count, and
fresh but content-equal scope/value objects never count. At the tunable shipped
default of eight transitions inside two seconds,
`SNAPBACK_REACT_PRESENCE_PUBLISH_CHURN` names the development-captured hook site
and generated collection and emits into the bound client's diagnostics
channel. This detector observes the lifecycle above; it changes no room,
publisher, heartbeat, or admission semantics.

Queue diagnostics are likewise observational only. LLP 0218 P3's queued
dispatch resolves the union and remains authoritative. The canonical
`SNAPBACK_OFFLINE_MUTATION_QUEUED` client event and its React
`SNAPBACK_REACT_MUTATION_QUEUED` compatibility diagnostic projection share
the durable mutation id, so the default dev reporter emits one queued console
line for the pair; the deprecated queued error has no throw site.
`SNAPBACK_REACT_MUTATION_QUEUE_WEDGED` is a client-channel-owned active
condition after 30 seconds, keyed to the durable queue head rather than bounded
diagnostic history: a failed drain clears nothing, head advance clears and
re-arms for the successor, and a `result-gone` head remains active with the
explicit acknowledgement cut as recovery. React owns no queue-warning timer.

The replay-divergence advisory and queued advisories now route through the
client channel and its default dev reporter. The normative replay-divergence
pin remains exactly one advisory per `(mutation, query)` pair per provider;
only the delivery surface changed. LLP 0218 P3's provider-owned automatic
drain and `useSnapbackOutbox().drainNow()` remain the recovery authority.

## Package and acceptance

LLP 0114's `@snapback/react` ships one web/Expo room store and registers it as
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

This supersedes LLP 0114 placeholders
`SNAPBACK_REACT_PRESENCE_SELF_CONFLICT`,
`SNAPBACK_REACT_PRESENCE_HEARTBEAT_INVALID`,
`SNAPBACK_REACT_OPTIMISTIC_TARGET_INVALID`, and
`SNAPBACK_REACT_OPTIMISTIC_REDUCER_FAILED`. Demo inventory/surface metadata add
`backend-bakeoff` and its exact targets.

## Non-goals

No durable/offline/SSR/history/cross-room/custom-key presence, caller authority
facts, React-owned transport/cache/ledger, HTTP authority, or hosted inheritance.

## Implementation journal

2026-08-10 (first-class optimistic create,
`issues/closed/20260808-first-class-react-optimistic-create.md`):
`useSnapbackOptimisticCreate` and its observer twin now own one headless
generated-IR view per exact provider query store. Response-first settlements
bridge until canonical delivery; query-first delivery waits behind the
unresolved dispatch; rejection refreshes only its durable layer; and queued
response-loss recovery discovers the retained settlement by exact
`clientMutationId` and retires through the same LLP 0133 `idMap`. Generated
clients export `ProvisionalId<Table>`, while the React union prevents it from
flowing to `Id<Table>` and omits server metadata from provisional fields.
Package tests cover projection semantics, both delivery orderings, overlapping
rejection, authority cuts, Strict Mode remount, replay recovery, and zero-leak
cleanup. The existing provider-live conformance gate adds a real served
drop-after-commit/replay witness with identical protocol identity and one
canonical rendered row. No new proof gate was introduced.

2026-08-15 (LLP 0218 P6): the post-release caller audit found no live React
consumer of the queued-property alias or the throw-site-free compatibility
class. React now consumes only `status:'queued'`, and the class export was
removed from the root, core, and Expo-re-exported surfaces after the union
first shipped in 0.1.19 and releases through 0.1.22 carried the migration
window.

2026-08-10 (LLP 0218 P3 React contract): queued acceptance resolves the
dispatch union, installed layers remain pending across enqueue, and
`subscribeMutation(clientMutationId)` drives them through LLP 0218 §4.2's
total disposition map. The settled disposition reuses the foreground
matcher/rebase path; every retirement route releases its durable-status
subscription; authority replacement keeps the existing synchronous blanking
rule. `SnapbackQueuedMutationError` is now a deprecated, throw-site-free
migration export. Provider-owned automatic drain and the expanded outbox
inspection/actions complete the React lifecycle handoff to LLP 0043.

2026-08-09 (queued-settlement truthfulness,
`issues/closed/20260809-queued-mutation-settlement-truthfulness.md`): the React
mutation projection now detects the headless `{queued:true}` marker before
result-contract validation, rejects one exported distinct queued class, and
emits development enqueue/30-second blocked-head warnings. The imperative
client contract and durable outbox are unchanged. The React optimistic and
offline suites pin the class, the absence of an `appCode`, mutation naming,
and both warnings; the React and offline Guide pages teach keep-pending and
appCode-only rollback handling.

2026-08-07 (strand backstop, ruled by Charlie Cheever via the local-first
author-gate packet item 5 on
issues/closed/20260804-optimistic-matcher-strand-backstop.md — option 2 plus
option 3; no timer or delivery-count backstop was ruled): a confirmed layer
whose matcher is the exact function `projectRecordFields` returned (module-
private symbol brand carrying `{recordId, idField}`) now retires when the
identified row is absent from an authoritative delivery, both in the
per-delivery retirement loop and at mutation-confirmation time — the latter
gated on `freshness === 'current'` so a retained frame can never key
retirement. Completeness decision recorded: authoritative deliveries at this
surface are complete result sets by construction (DK-3 deltas materialize
client-side before delivery; retained frames never advance the authoritative
revision), so no partial/windowed-delivery carve-out is needed. Custom
matchers — including a helper spread whose `isAuthoritative` is overridden —
are byte-for-byte unchanged. `inspection()` gains `optimisticLayers` and
`confirmedOptimisticLayers`. Regression fixtures in
`packages/snapback-react/optimistic.test.mjs`: row-absent authoritative
delivery retires the helper layer (the pre-ruling strand), present-but-dipped
rows keep it installed, custom never-true matchers still strand (unchanged
semantics), and inspection identifies the confirmed layer's mutation/query
pair. Recipe `guide/recipes/optimistic-toggle.md` updated to scope the
never-true-matcher anti-pattern to hand-written matchers.

2026-08-04 (replay-safety affordances, from the chirp retrospective ticket
issues/20260804-optimistic-projection-replay-lint-and-helpers.md): the
development replay advisory and `projectRecordFields` landed in
`packages/snapback-react/index.mjs` with types, `optimistic.test.mjs`
fixtures (the pre-existing increment reducer warns exactly once; the recipe's
capture-and-set projection and the helper stay silent; an explicit production
`NODE_ENV` suppresses the advisory), and a helper section in
`guide/recipes/optimistic-toggle.md`.

Implemented on 2026-07-27 as one projection across:

- `packages/snapback-client` for negotiated expiry, server-time-to-monotonic
  conversion, owned room handles, disconnect cleanup, and finite resource
  inspection;
- `packages/snapback-contract/result-contract-validator.mjs` for the shared
  generated result-contract validator;
- `packages/snapback-codegen`, `crates/snapback/src/ephemeral.rs`, and `crates/snapback/src/manifest.rs` for
  complete private collection/result descriptors;
- `packages/snapback-react` for the provider-owned presence registry and the
  single authoritative optimistic query-store ledger; and
- `demos/signal-desk/src/backends/snapback.ts` for the removal of manual
  presence heartbeat/overlay and optimistic rollback glue.

2026-08-01 (LLP 0137 A2 findings f1/f2, `@expo/snapback-*` 0.1.7): two
defects made the documented React presence path unreachable and were fixed at
their layers. (f1) `startEphemeralRoom` tracked connection state only through
`LiveStreamManager.onState` transitions, so a provider whose live queries had
already opened the managed socket saw no fresh `'open'` edge and wedged at
`connection: 'connecting'` / `status: 'stale'` forever while deltas still
arrived; the room now adopts the proven readiness level after
`waitUntilReady` resolves (connection events are level-triggered per §Resync,
authority, and lifecycle — an edge-only view of an already-open socket is not
an admissible readiness proof). Regression: `ephemeral-room.test.mjs`
pre-opened-socket scenario, with the test fake corrected to the real
transition-only `onState` contract. (f2) `prepareReactBinding` reconstructed
ephemeral collection references with the schema manifest's carrier grammar
(`snapback.v1` on sessions apps) while generated `api.mjs` stamps the public
reference grammar (`snapback.v0`), so the fail-closed canonical admission
rejected every `api.ephemeral.*` reference with
`SNAPBACK_REACT_REFERENCE_INVALID`; the binding now stamps all reconstructed
references (function, query-group, ephemeral) with the one reference grammar,
keeping them byte-identical to `api.mjs` and the comparison strict.
Regression: `presence.test.mjs` sessions-grammar admission scenario.

The package suites cover descriptor/refusal typing, old/new expiry negotiation,
room sharing and cleanup, optimistic ordering/rebase/selective rollback, and
the shared result validator. `bun run test:react` in
`demos/signal-desk` produced
`acceptance/results/react-presence.v1.json`: all ten required ids passed with
zero skips, using two independent native WebSocket clients and exact
provider/client/server cleanup inspection. `typecheck` and the production
build also pass. The guide and capability index advertise only the proven
local-target Online surface; hosted presence continues to refuse before work.

## Status

Implemented. This consumes LLP 0013/0102. The local-target capability is
advertised only with the package suites and retained ten-check bakeoff receipt
above; no hosted capability or stronger LLP 0064 class is inferred.
