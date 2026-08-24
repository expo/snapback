---
title: "Recipe: provider connection and subscription lifecycle"
id: recipes.provider-lifecycle
order: 15
audience: agent-first
capabilities: [clients.headless, clients.external-store, clients.contract-provider-generation]
authorities: [llp/0034-contract-source-seam-provider-side.rfc.md, llp/0063-partitime-platform-roadmap.plan.md, llp/0095-client-lifecycle-and-conformance.spec.md, llp/0278-paged-live-results-and-relational-composition.rfc.md, llp/0280-cross-system-write-seams.rfc.md, llp/0295-published-matrix-improvement-program.plan.md, packages/snapback-client/index.mjs, packages/snapback-client/external-store.mjs, packages/snapback-react/implementation.mjs, packages/snapback-react/auth-blocked-resource.test.mjs, packages/snapback-react/package.test.mjs]
examples: [packages/snapback-contract/keyed-provider.mjs, packages/snapback-react/package.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-22
reviewed-authorities-digest: sha256:8a63496d82a30b312b43af3e49e76b3625cc47be7276fcb08165153aacff1d4e
---

# Recipe: provider connection and subscription lifecycle

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The provider adapter pattern is one manager above the cells it serves. This
applies to `ContractDataProvider` and other provider-neutral adapters. Within
that manager, one stable readable `connectionId` belongs to each
**(application, storage partition, server origin, settled authority)** tuple.
Every query cell under that tuple reuses the id: N cells create N logical
subscriptions only when their canonical queries differ; they do not create N
transport connections. A second client with another authority or storage
partition owns another tuple and another manager. Do not build a process-global
connection pool that coalesces distinct custody contexts.

This is the route for searches such as “one connection per query”, “too many
websockets”, “connection pool”, “provider adapter pattern”, and “rebuild stream
on auth”. It also reports active connections and subscriptions by owner. One
provider view warns above 16 logical subscriptions and supports independent
subscriptions through the 64-per-connection hard ceiling. The warning is
guidance, not a correctness boundary.

Exact retrieval vocabulary from provider failures:

- connection per subscription
- N cells imply N transport connections
- provider lifecycle budget
- too many websockets

## Own one manager above all provider cells

Construct the `SnapbackClient`, connection manager, external-store registry,
and provider at adapter scope, not inside a cell or query callback. Mint the
readable connection label once for that manager and pass it to every
`liveQuery`/`startLiveQuery` owned by the tuple. A canonical
provider/query/authority/args key shares one upstream store and refcounts its
listeners; different keys remain separate logical subscriptions on the same
connection.

For a two-client acceptance adapter, build this owner once per client. Client A
and client B may therefore report one connection each while each serves many
cells. Never reuse A's manager for B merely because their server origin is the
same: settled authority and storage partition are part of ownership.

The React package fixture mounts several distinct cells under one provider
against the real headless manager. Its injected WebSocket counts actual opens
and closes, so the regression fails if the headless client creates a transport
per cell even while reusing the same readable connection label:

```js source=packages/snapback-react/package.test.mjs
  try {
    const providerLifecycleBinding = await prepareReactBindingForClient(
      providerLifecycleClient,
      { generatedManifest },
    );
    providerLifecycle = createSnapbackReactProvider(providerLifecycleBinding, {
      connectionId: 'provider-lifecycle-shared-authority-origin',
    });
    const providerCellCount = 6;
    providerCells = observeSnapbackQueries(
      providerLifecycle,
      Object.fromEntries(Array.from({ length: providerCellCount }, (_, index) => [
        `cell${index}`,
        { ref: capacityFeeds[index], args: {} },
      ])),
      () => {},
    );
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (
        providerLifecycle.inspection().serverSubscriptions === providerCellCount
        && transportOpens === 1
      ) break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(transportOpens, 1, 'six provider cells open exactly one real transport');
    const lifecycleInspection = providerLifecycle.inspection();
    assert.equal(lifecycleInspection.connections[0].ownershipTuple.canonicalAppId, 'react-fixture');
    assert.equal(
      lifecycleInspection.connections[0].ownershipTuple.storagePartition,
      providerLifecycleClient.clientStoreId,
    );
    assert.equal(
      lifecycleInspection.connections[0].ownershipTuple.serverOrigin,
      'http://provider-lifecycle.test',
    );
    assert.equal(typeof lifecycleInspection.connections[0].grantAgeMs, 'number');
    assert.equal(lifecycleInspection.connections[0].outboxSuspensionReason, null);
    assert(
      lifecycleInspection.subscriptions.every(
        (subscription) => subscription.ownershipTuple
          === lifecycleInspection.connections[0].ownershipTuple
          && typeof subscription.grantAgeMs === 'number'
          && subscription.outboxSuspensionReason === null,
      ),
      'subscription inspection shares the exact connection ownership/grant/outbox facts',
    );
    await providerLifecycle.pause();
    assert.equal(
      providerLifecycle.inspection().connections[0].outboxSuspensionReason,
      'host-paused',
    );
    await providerLifecycle.resume();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (
        providerLifecycle.inspection().serverSubscriptions === providerCellCount
        && transportOpens === 2
      ) break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.deepEqual(inspectProviderOwners(providerLifecycleClient, [providerLifecycle]), [{
      owner: providerLifecycle.providerInstanceId,
      connectionId: 'provider-lifecycle-shared-authority-origin',
      activeConnections: 1,
      activeSubscriptions: providerCellCount,
      clientSubscriptionOwners: Array.from({ length: providerCellCount }, (_, index) => (
        `provider:${providerLifecycle.providerInstanceId}/query:capacityFeed${index}`
      )).sort(),
      socketDemand: providerCellCount,
      timers: 1,
      listeners: providerCellCount,
    }]);
    assert.equal(activeSubscriptions.size, providerCellCount);

    providerCells.dispose();
    providerCells = null;
    await flush();
    await providerLifecycle.dispose();
    assert.equal(transportCloses, 2, 'pause and provider teardown each close their shared transport');
    assert.equal(activeSubscriptions.size, 0);
```

## Subscribe after authority settlement, without a timeout

Consume the provider's landed settlement vocabulary. A protected React query
is `status: "blocked"`, `reason: "authentication-required"`, and
`transitionOwner: "auth-coordinator"` while signed out. During sign-in,
sign-out, or authority replacement it is `status: "blocked"`,
`reason: "authentication-not-settled"`, with the same `transitionOwner`.
Those are stable, owned states—not retry failures. Branch on them and wait for
the next provider snapshot; never add a timeout or poll a client object to
guess when authority settled.

The provider itself starts no live transport while the coordinator owns the
blocked transition:

```js source=packages/snapback-react/auth-blocked-resource.test.mjs
      assert.deepEqual(mounted.registry.snapshot(mounted.descriptor), {
        status: 'blocked',
        reason: 'authentication-not-settled',
        transitionOwner: 'auth-coordinator',
        data: undefined,
        error: null,
        connection: 'idle',
        freshness: 'unknown',
        answerClass: 'unknown',
        retention: null,
        optimisticPresentation: null,
      });
      assert.equal(client.state.attempts, 0, 'held custody starts no live transport');
```

On a principal-class change, quiesce and dispose every predecessor-owned
subscription before opening the successor connection. The settled successor
then starts a fresh snapshot-with-subscribe. This teardown-before-rebuild order
is the persona-replacement seam; “rebuild stream on auth” must not mean rebind
an old sessions connection to a new bearer.

## Keep update callbacks non-reentrant and deduplicate adapter projections

An update callback copies the delivered rows and lifecycle facts into its
store, then returns. Do not synchronously subscribe, unsubscribe, or dispatch a
mutation from inside it. A one-shot read is admitted but usually means the
adapter ignored rows it already has. If delivery must trigger more lifecycle
work, schedule it at a microtask/framework-effect boundary.

The provider deduplicates on the complete consumer-visible snapshot—rows plus
exposed status, connection, freshness, answer class, retention, and optimistic
presentation. A value-equal authoritative frame advances internal
version/resume bookkeeping without notifying consumers. Row equality never
hides a lifecycle transition such as `refreshing` to `ready`, a connection
change, or the successor's first authoritative delivery after reconnect.

Synchronous subscribe/unsubscribe/mutation dispatch inside a delivery callback
refuses with `SNAPBACK_REACT_DELIVERY_REENTRANCY_UNSUPPORTED`. Schedule that
work at a microtask or framework-effect boundary.

## Let the manager retry; explicitly tear down owners

Transport loss uses the client's existing bounded reconnect/resubscribe
machinery. Do not wrap it in a provider retry loop, open a fallback WebSocket,
or mint another connection label. Grant loss similarly reopens and
re-establishes through the client. An auth transition is different: retire the
predecessor, wait for settled successor authority, then create the fresh
subscription described above.

Each cell releases its listener. The last listener releases its logical
subscription; provider disposal closes scopes/registries and conditionally
releases the idle connection. Await `client.close()` only when the adapter owns
that client. A handle's `settled()` waits for its cleanup boundary; it never
replaces `dispose()`.

## Report active connections and subscriptions by owner

Combine the provider's inspection (logical stores/subscriptions) with the
headless client's `localResourceInspection([connectionId])` (managers, grants,
socket demand, timers, and listeners). This CI-verified helper produces one
bounded row per provider owner:

```js source=packages/snapback-react/package.test.mjs
function inspectProviderOwners(client, providers) {
  return Object.freeze(providers.map((provider) => {
    const providerResources = provider.inspection();
    const connectionId = provider.registry.connectionId;
    const clientResources = client.localResourceInspection([connectionId]);
    return Object.freeze({
      owner: providerResources.providerInstanceId,
      connectionId,
      activeConnections: clientResources.managers.filter(
        (manager) => !manager.closed && (manager.open || manager.socketDemand > 0),
      ).length,
      activeSubscriptions: providerResources.serverSubscriptions,
      clientSubscriptionOwners: clientResources.subscriptions.map(
        (subscription) => subscription.owner,
      ).sort(),
      socketDemand: clientResources.socketDemand,
      timers: clientResources.timers,
      listeners: clientResources.listeners,
    });
  }));
}
```

For two independently owned clients, call the helper once per client and
concatenate the rows. Assert the expected owner rows after delivery, then
dispose cells, providers, and owned clients and assert zero active connections,
subscriptions, demand, timers, and listeners. These inspections are
acceptance/debug facts only; they are neither application state nor authority
evidence, and the readable `connectionId` is not the server's opaque wire id.

## Duplicate-subscription diagnostics

The same positively identified local recorder groups active subscriptions by
function identity, canonical argument hash, and the complete provider
ownership tuple. The readable owner label is deliberately not part of that
key: two providers that open the same query under the same custody tuple form
one duplicate fact whose `ownerLabels` attribute both owners. Different
arguments or a different settled-authority/storage/origin tuple never form the
same fact.

`SNAPBACK_LIVE_DUPLICATE_SUBSCRIPTION_MULTIPLICITY` is warning-only. Use its
owner labels to move the common provider or external-store owner above the
duplicate consumers. It neither refuses a subscription nor changes the
existing 16-warning/64-hard envelope, and it is absent from hosted/public
diagnostic surfaces.

## Enforce the warning budget without narrowing correctness

The provisional ordinary-view budget is 16 logical subscriptions. The 17th
emits `SNAPBACK_REACT_SUBSCRIPTION_VIEW_BUDGET_EXCEEDED` with owner, count,
warning budget, hard ceiling, and paved alternatives. It remains admitted.
Independent subscriptions—including six ordinary cells—stay supported and
live-correct through 64. Entry 65 first emits the warning and then refuses with
the existing typed group/capacity diagnostic; there is no partial attachment.

Use `defineSetKeyedAggregate` when many keys need one atomic cross-set fact or
when one stream is materially cheaper. It is an optimization when independent
snapshots are acceptable, not the only correct architecture. Use
`defineChunkedSemiJoin` for the bounded actor-set/top-N shape; it owns 499-item
operand chunks and refuses actor overflow instead of truncating.

Provider inspection reports the warning/hard budgets, connection owner,
per-subscription owner labels, lifecycle state, snapshot version,
auth-barrier/readiness, and outbox suspension reason. Record those owner rows
when debugging fan-out; never infer authority from them.

## Anti-patterns

- One connection per query, cell, render, or retry.
- A process-global connection pool that crosses settled authority or storage
  partitions.
- Starting protected subscriptions while an auth-coordinator-owned blocked
  state is visible, or deriving settlement from a timeout.
- Synchronously subscribing, unsubscribing, or mutating inside an update
  callback.
- Deduplicating equal rows while hiding a real lifecycle transition.
- Rebuilding every query owner after transport-only reconnect.
- Treating `settled()` as disposal, or leaving the owned client open after the
  provider is terminal.
- Treating the 16 warning as a hard cap, or forcing every view into one
  aggregate query despite independent snapshots being sufficient.
- Opening a 65th subscription or partially attaching an over-capacity group.
