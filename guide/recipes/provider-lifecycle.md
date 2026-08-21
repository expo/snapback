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
maturity: partial
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:5e0894bd44d45cf4b8f904e7b4ab5e29c5f2665bd4ed71973697acdea9a355e9
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
on auth”. It also reports active connections and subscriptions by owner. The
numeric per-app and per-query budgets remain LLP 0295 D0.5 work; this page
deliberately gives only today's lifecycle and qualitative bounds.

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
    assert.deepEqual(inspectProviderOwners(providerLifecycleClient, [providerLifecycle]), [{
      owner: providerLifecycle.providerInstanceId,
      connectionId: 'provider-lifecycle-shared-authority-origin',
      activeConnections: 1,
      activeSubscriptions: providerCellCount,
      socketDemand: providerCellCount,
      timers: 1,
      listeners: providerCellCount,
    }]);
    assert.equal(activeSubscriptions.size, providerCellCount);

    providerCells.dispose();
    providerCells = null;
    await flush();
    await providerLifecycle.dispose();
    assert.equal(transportCloses, 1, 'provider teardown closes the shared real transport');
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

React currently republishes every authoritative delivery, including value-equal
rows at a newer internal version; that delivery advances bookkeeping **and**
notifies provider listeners today. If an adapter needs render deduplication,
apply it in the adapter-owned consumer store by comparing the complete visible
snapshot—rows plus exposed status, connection, and freshness facts. Never let
row equality hide a real lifecycle transition such as `refreshing` to `ready`
or the first authoritative successor delivery after reconnect. Platform-level
complete-snapshot deduplication remains an open LLP 0278/0095 implementation
obligation tracked in
`issues/20260821-provider-connection-subscription-budget-decision.md`.

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

## Keep budgets qualitative until D0.5

Today's recipe has four enforced qualitative bounds: one stable connection
label per manager-owned tuple; refcounted canonical query stores; declared,
inspectable logical fan-out; and zero owned resources after teardown. Prefer a
single relational/aggregate query when the UI needs one atomic cross-set fact,
and consider one for large visible-entity fan-out, but do not claim that every
independent query is incorrect.

LLP 0295 D0.5 owns the later numeric connection/subscription budgets and their
diagnostics. Until those values land, do not turn a measurement from one app
into a platform threshold. Record the inspection counts, state which owner
created them, and keep the lifecycle invariants above.

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
- Advertising numeric resource budgets before LLP 0295 D0.5 sets them.
