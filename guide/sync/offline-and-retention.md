---
title: Offline retention and mutation replay
id: sync.offline-and-retention
order: 1
audience: agent-first
capabilities: [sync.offline, sync.offline-js-arm]
authorities: [llp/0043-offline-replay-retention.rfc.md, llp/0052-contract-update-economy-and-host-state.rfc.md, llp/0055-agent-principals-and-scoped-grants.rfc.md, llp/0090-resumable-query-snapshots.rfc.md, llp/0129-local-first-program.plan.md, packages/snapback-contract/index.mjs, packages/snapback-contract/offline-replay.test.mjs, packages/snapback-client/index.mjs, packages/snapback-client/outbox-store.test.mjs, packages/snapback-react/index.mjs]
examples: [demos/card-game, demos/todo-v2/surfaces/contract, demos/public-dashboard, packages/snapback-contract/agent-authority-contract.test.mjs, packages/snapback-react/offline.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-01
reviewed-commit: HEAD
---

# Offline retention and mutation replay

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The Contract adapter can retain the last authoritative query snapshot, render
derived optimistic changes while offline, and replay a durable mutation outbox
in order after reconnect. It reports this as `Parity` only when every
required proof is present; otherwise the surface stays honestly `Online`.

## The JS/React arm: default persistence and the offline queue

Since LLP 0129 Phase 0, `@expo/snapback-client` (and the LLP 0114 React hooks
riding it) persists its cache **by default**: the client resolves an
IndexedDB store in browsers, a durable file store on node, and an in-memory
fallback elsewhere, reporting the resolved implementation and durability on
`client.rqsStoreInfo` (pass `rqsStore: null` or set
`SNAPBACK_CLIENT_RQS_STORE=off` to opt out).

The implementation surface includes all three carriers, but the retained
`demos/public-dashboard/tests/acceptance/offline-local-first.mjs` witness runs
headlessly on Node and forces the file store. It does **not** certify React,
standards-real IndexedDB, or a full browser-process restart. Those browser
facts remain an evidence GAP under
`issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md`; do not infer
them from the Node receipt. The headless witness proves:

- **Retained render for the rqsEligible subset on the Node/file
  carrier, by a fresh client instance in the same process.** (Not a
  "cold boot": the witness closes one client and constructs another
  without restarting the process. No full client-process restart is
  proven on any carrier — see the GAP ticket above.) A fresh client —
  including with the backend unreachable — renders the persisted rows of
  authority-independent live queries first, marked
  `freshness: 'retained'`, then settles to `'current'` on reconnect
  (LLP 0090 Channel B). Non-`rqsEligible` queries are NOT retainable: the
  handle's `retention` fact names the refusal
  (`SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE`) instead of silently acting
  local-first. **Not proven by this witness:** the protected/auth-scoped
  and opaque refusal (`SNAPBACK_RETENTION_NOT_RETAINABLE`) is implemented
  but asserted by no test on any carrier — LLP 0053's retainability
  invariant is the intended boundary, and the evidence for it is a GAP
  under the ticket above. Lease-bounded protected retention remains the
  Contract arm's.
- **A durable LLP 0043 M2 outbox.** A mutation refused by connectivity is
  queued durably under a client-minted `clientMutationId` (protocol-lane
  identity) with a monotonic local sequence, and returns
  `{ queued: true, clientMutationId, sequence }`. Connectivity is classified
  by transport provenance — the fetch dispatch itself rejected, so no HTTP
  status, diagnostic, or receipt exists — independent of the rejection's
  constructor (undici throws `TypeError`; Expo/RN fetch rejects a plain
  `Error`). Caller-owned aborts/timeouts and anything the server answered
  never queue.
- **Ordered exactly-once replay.** After reconnect completes a fresh
  authoritative snapshot (full resync first — LLP 0008 §Mutation Replay),
  the client drains the queue in sequence order; the server's settlement
  ledger returns the original result on duplicate delivery. (A refused
  replay is dropped and marked failed, visible in `outboxRecords()`. The
  *store's* drop-and-mark-failed contract is covered by the package unit
  test `packages/snapback-client/outbox-store.test.mjs`; the client
  wiring that maps a server refusal onto it — emitting
  `SNAPBACK_OFFLINE_MUTATION_REPLAY_FAILED` — is asserted by no test, and
  neither is covered by the headless acceptance above.)
- **No `Parity` claim.** This arm runs no local execution, so the queued
  path is Online-class retention/replay under LLP 0043's proof rule. A
  relaunch with pending intent still renders the retained rows — marked
  `retained`, **pre-intent** (the queued writes are not overlaid; there is
  no local execution to derive them), with `handle.pendingIntentsAtSeed`
  naming the queued count — while the resume token is withheld: reconnect
  takes full resync, then ordered replay (LLP 0090's outbox rule and its
  2026-08-01 rendering note). Render the queued-changes state next to the
  retained rows from `client.outboxStatus()` (React:
  `useSnapbackOutbox()`), never by faking the rows themselves.

```js source=packages/snapback-client/outbox-store.test.mjs
  // Offline: fetch refuses at the transport (TypeError, like undici).
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const queued = await client.mutate('createThing', { args: { title: 'offline' } });
  assert.equal(queued.queued, true);
```

```js source=packages/snapback-client/outbox-store.test.mjs
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 2, failed: 0, remaining: 0 },
  );
  assert.deepEqual(
    delivered.map((body) => body.clientMutationId),
    [queued.clientMutationId, queuedUpdate.clientMutationId],
    'replay is ordered by sequence and keeps the minted durable identity',
  );
```

## Opt a live query into cold retention (`rqsEligible`)

Cold retention is **per-query and opt-in by declaration** — a Snapback app
gets ZERO offline retention until at least one live query declares
eligibility. The default is refuse-with-clarity, not silent persistence: in
a sessions-mode app even a plain declarative live query over a table with no
private rows is authority-scoped by default, its handle reports
`retention: { retainable: false, code: 'SNAPBACK_RETENTION_NOT_RETAINABLE' }`,
and nothing ever persists — so the cold-boot claims above silently never
engage until you declare the opt-in below.

The opt-in is two declaration facts on a **declarative** live query
(`defineLiveQuery`):

- `auth: 'public'` — the query is invocable without a resolved user;
- `authorityIndependent: true` — the trusted declaration that the complete
  result is identical for every caller. Codegen accepts it only on a public,
  ambient-free plan; it is refused on queries with `authScopeField`,
  `membership`, `authUserId()` filters, or time/randomness reads.

From those facts plus the closed-inputs proof (single-table plan whose read
summary equals the plan's table), the server derives the `rqsEligible`
predicate and mints resume tokens — there is no authored `rqsEligible`
field, and a query failing the proof is simply not eligible, never a load
error (LLP 0090). The eligible query in the public-dashboard demo:

```js source=demos/public-dashboard/snapback/functions.mjs
export const dashboardMetrics = defineLiveQuery({
  table: 'metrics',
  args: { dashboardId: v.string() },
  filter: [eq('dashboardId', arg('dashboardId'))],
  order: [asc('label')],
  index: 'by_dashboard',
  auth: 'public',
  authorityIndependent: true,
  publicInline: true,
});
```

(`publicInline: true` is the separate snapshot-inlining disclosure
permission for HTML boot — see
[snapshot bundles](../realtime/snapshot-bundles.md) — and is **not**
required for retention.)

The handle tells you whether the opt-in took: `handle.retention` is the
refuse-with-clarity classification, and an eligible query holds a
server-minted resume token:

```js source=demos/public-dashboard/tests/acceptance/offline-local-first.mjs
    assertEqual(handleA.freshness, 'current', 'fresh subscribe is authoritative');
    assert(handleA.retention?.retainable === true, 'eligible query classified retainable');
    assert(handleA.rqsResume?.token, 'server minted a resume token');
```

A query that does not qualify names why instead of silently acting online:

```js source=demos/public-dashboard/tests/acceptance/offline-local-first.mjs
      assertEqual(feed.retention?.retainable, false, 'refused retainability');
      assertEqual(feed.retention?.code, 'SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE', 'refusal code');
```

The refusal codes: `SNAPBACK_RETENTION_NOT_RETAINABLE` (authority-scoped —
protected retention is the lease machinery's, below),
`SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` (the server minted no token: not an
authority-independent closed-inputs declarative query), and
`SNAPBACK_RETENTION_STORE_DISABLED` (eligible, but this client opted out of
persistence).

Two neighbors that are **not** this opt-in:

- `defineJsLiveQuery` handlers are never `rqsEligible` — an opaque JS
  handler cannot carry the closed-inputs proof, so JS live queries stay
  online-only on this arm regardless of `auth`.
- `retainable: true` is the *lease-class* opt-in — AuthorizedLease-backed
  retention of protected, user-scoped results under LLP 0053's custody
  rules, shipped on the Contract arm (see
  [hidden hands](../recipes/hidden-hands.md)). Declaring it does not make a
  protected query cold-retain on the JS arm.

## Enable the complete client-store contract

Pass a durable `clientStore` (localStorage on web; memory only for tests) and
a complete retained identity: app id, database id, target-profile id, and
version-stream id. The generated Contract data manifest must claim
`offlineReplay`, and every mutation exposed by the surface must have a
derivable declarative plan.

If any identity or replay proof is missing, queued writes and retention are
disabled instead of being rebound to a guessed backend. A changed artifact or
authority scope quarantines/deletes the old privacy-bearing state before the
new scope can inspect it.

For `AgentAuthorityFence`, the durable authority key is a canonical SHA-256
identity over the actor, credential id and generation, and grant id. Token id,
bearer bytes, and carrier generation are deliberately excluded: rotating a
token for that same tuple can replay its existing queue, while changing any
durable tuple coordinate advances the authority epoch and deletes predecessor
work. Every replay still resolves and validates a current scoped token before
the server acts. Agent authority does not enable retained service-principal
reads in v1.

Production CLI and daemon replay requires both a durable Contract
`clientStore` and a filesystem-backed `AgentAuthorityFence`; the in-memory
custody adapter is test-only. Construct the Contract surface before manually
synchronizing the fence. Surface construction registers the physical store as
a barrier participant before it performs the strict server handshake, so a
restart that finds an interrupted `clearing` transition replays that store's
epoch-bound deletion before custody can settle. Reversing that order can leave
predecessor queue data outside the recovered authority barrier and is refused
by the supported construction path.

The surface re-synchronizes durable custody before client-store reads,
retained publication, enqueue/acknowledgement, and final replay dispatch. A
missed process-local or BroadcastChannel wakeup therefore cannot expose or
settle predecessor rows and queued writes under a peer successor. The visible
surface blanks at the authority cut; durable predecessor work remains owned by
the barrier until its exact deletion/transition settles rather than being
silently acknowledged or discarded.

Terminal replay is explicit, not inferred from a null browser principal scope
(Agent successors also have no browser principal scope). An exact-current
nonterminal Agent successor preserves its already-committed store bytes. An
exact-current terminal replay verifies or reapplies deletion. If terminal B
finds that shared primary custody now belongs to A, Snapback leaves A's primary
row and any A-keyed local store untouched, but purges and unbinds a local store
still keyed to B so stale retained/queued B data cannot survive behind the
terminal witness.

Client-store write generations do not wrap. The maximum safe integer is
reserved for the terminal privacy cut; an already-exhausted bound store exposes
no retained or queued data even if durable replacement fails. A clean marker at
that final identity can be replayed without another write, but requires explicit
store replacement before any successor bind.

## Boot from retained rows honestly

An online boot publishes and stores the authoritative snapshot. If a later
boot cannot reach the same backend, the adapter may publish those retained
rows with `retained() === true` and connection `'stale'`:

```js source=packages/snapback-contract/offline-replay.test.mjs
// New store + new adapter instance models an app reload. The live request
// fails, retained rows boot stale, and the durable create overlay re-applies.
const secondStore = createMemorySnapbackClientStore({ state: sharedState });
const second = await makeSurface(secondStore);
assert.equal(second.retained(), true);
assert.equal(second.connection(), 'stale');
assert.equal(second.boundary.current('todos')[0]._id, todoId);
```

A first run with no retained snapshot fails with the original network error.
Retained data is never relabeled `live`.

For sessions-mode private rows, ordinary retention is insufficient. The server
must issue an authorized lease and the store must delete rows exactly at its
deadline. That stricter subset is taught in
[hidden hands](../recipes/hidden-hands.md).

## Queue one deterministic mutation identity

Before an offline optimistic change becomes visible, the store durably
allocates:

- an opaque `clientMutationId`;
- a monotonic local sequence (ordering never comes from wall-clock time);
- the function and canonical arguments;
- the authority/artifact scope;
- one deterministic `ctxLedger` containing generated time/id answers.

The derived optimistic overlay consumes the **same** ledger, so a replayed
insert uses the id the UI already rendered. If durable enqueue fails, the
optimistic change is rolled back before any server contact.

The test queues create → toggle → delete and proves durable ordering:

```js source=packages/snapback-contract/offline-replay.test.mjs
const queued = await secondStore.pendingMutations();
assert.deepEqual(queued.map((entry) => entry.function), [
  'createTodo',
  'setCompleted',
  'deleteTodo',
]);
assert.deepEqual(queued.map((entry) => entry.sequence), [1, 2, 3]);
```

## Replay and settle without guessing

Reconnect delivers records in sequence with the original mutation id, ledger,
and authority descriptor. The server settles that id atomically with the data
commit. If a response is lost after commit, redelivery returns the stored
result rather than applying the mutation twice:

```js source=packages/snapback-contract/offline-replay.test.mjs
const replay = await second.reconnect();
assert.deepEqual(replay, { replayed: 3, failed: 0 });
assert.deepEqual(client.state.applied, ['createTodo', 'setCompleted', 'deleteTodo']);
assert.deepEqual(client.state.rows, []);
assert.equal(second.pendingCount(), 0);
```

Before returning an authoritative result, the client atomically changes the
durable record from replayable `pending` to non-replayable `settled`, retaining
the complete response and adding its auth-tagged acknowledgement obligation in
the same store transaction. The file arm flushes bytes and synchronizes the
parent directory after its atomic rename. If that write cannot commit, the result is not
published, is not marked failed, and the original id remains replayable. On
relaunch, read `client.settledMutations()` before new work and either call
`markMutationSettlementsConsumed(ids)` to make those results piggyback-ACK
eligible or send `acknowledgeMutations(...)` directly. Until then, automatic
ACK delivery cannot delete the recovery copy. In authenticated mode recovery
first re-attests the current session and returns only settlements from that
exact server-echoed authority cohort; predecessor results remain opaque in the
store until their authority returns. A typed server refusal is a
visible terminal `failed` record and is never acknowledged as the current id;
a receipt-less outcome stays pending.

The client removes the retained settlement and ACK together only after the
server proves it processed the acknowledgement. A later mutation normally
piggybacks same-authority ACKs; `client.acknowledgeMutations(...)` is the
standalone completion path for one-shot or otherwise quiet callers. A
Snapback-origin terminal receipt proves the origin saw a piggyback ACK stage.
A receipt-less proxy/network failure proves neither, so both records remain
durable for retry. Process stdout alone is not this recovery boundary: use a
durable RQS store (the Node default is file-backed), or explicitly opt out of
queue custody and its guarantee.

ACK records are scoped by user and, when supplied, the server-issued authority
instance echoed on every successful mutation response. That settlement
descriptor is stored separately from the immutable descriptor captured with
the original request, so enrichment cannot change its replay identity.
Piggyback selects only
the current cohort and only results explicitly marked consumed. For standalone session or
service-principal completion, pass that record's `authorityDescriptor`; the
server compares it before GC and the client removes only matching local
proofs. An authority change therefore retains the predecessor proof rather
than leaking its id into, or deleting it under, the successor. A volatile
memory fallback reports `durable: false`, does not auto-queue, and refuses
`queue: true` before network dispatch. The current Expo file adapter makes the
same conservative report because its File/Directory API exposes no fsync cut
and has a non-atomic compatibility replacement; it can cache RQS rows but does
not own durable settlement publication.

Deploying a bundle that removes or renames the mutation does not strand an
already committed result. Until ACK, the server can recover it through the
exact current-authority-bound settlement identity without dispatching removed
code. After ACK garbage collection, the same call follows ordinary function
selection and returns `SNAPBACK_UNKNOWN_FUNCTION`.

## Migration boundaries: quarantine, don't fail

A schema publication can refuse a replay with one of two stable codes, and
neither is a mutation failure — the surface quarantines the write instead of
settling it `failed`, and exposes the state for rendering via
`surface.migrationBoundary()` (`null` in normal operation):

- `SNAPBACK_MIGRATION_RESYNC_REQUIRED` — the record's read baseline predates
  a successor-only publication and its row changed. The record stays
  pending; the next `reconnect()` resyncs first, re-presents the **same**
  `clientMutationId` with baselines refreshed from the successor snapshot,
  and the server settles it exactly once.
- `SNAPBACK_MIGRATION_UPGRADE_REQUIRED` — this client's artifacts predate a
  successor-only publication. The state is stable for the lifetime of the
  artifact-bound surface: the queue stays intact, nothing retries blindly,
  and the app can render "update required".

```js source=packages/snapback-contract/migration-quarantine.test.mjs
  // Quarantine, not failure: the record is still pending, nothing entered
  // the failed ledger, and the boundary state is app-renderable.
  assert.equal(surface.pendingCount(), 1);
  assert.deepEqual(await surface.failedMutations(), []);
  const boundary = surface.migrationBoundary();
  assert.equal(boundary?.kind, 'resync-required');
  assert.equal(boundary?.code, 'SNAPBACK_MIGRATION_RESYNC_REQUIRED');
```

Across the artifact upgrade itself, payload custody follows the client
store's privacy boundary: a write authored under predecessor artifacts is
never blindly replayed under successor artifacts — the successor surface
receives an explicit redacted `SNAPBACK_CLIENT_ARTIFACT_STALE` entry in
`failedMutations()` (identity preserved, args discarded) for the app to
re-enter, while the server keeps the refused `clientMutationId` fresh.

## Derive, then reconcile optimistic rows

Declarative mutation plans produce the local overlay; avoid a second handwritten
reducer. Server rows remain authoritative:

- success reconciles the optimistic wave with the committed result;
- a structured rejection removes/rebases the prediction and exposes the
  diagnostic;
- a connectivity ambiguity keeps the durable record and marks the surface
  stale;
- an artifact or authority change clears/quarantines old rows and writes before
  publishing the successor scope.

## Anti-patterns

- **Do not call a surface Parity because it has localStorage.** The manifest,
  identities, derivable plans, store, and authority fences must all agree.
- **Do not generate a fresh id or timestamp on replay.** Reuse the captured
  mutation id and deterministic ledger.
- **Do not drop a queued write on a receipt-less 502.** The origin outcome is
  ambiguous.
- **Do not serve retained rows as live.** Render the stale connection axis.
- **Do not cache authorized rows outside the lease-aware store.** Use the
  authorized-retention path or keep the surface online-only.
- **Do not key an agent outbox by token id.** Tokens are live carriers; the
  server-issued descriptor and durable grant tuple own replay identity.
