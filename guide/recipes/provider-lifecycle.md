---
title: "Recipe: provider connection and subscription lifecycle"
id: recipes.provider-lifecycle
order: 15
audience: agent-first
capabilities: [clients.headless, clients.external-store, clients.contract-provider-generation]
authorities: [llp/0034-contract-source-seam-provider-side.rfc.md, llp/0063-partitime-platform-roadmap.plan.md, llp/0095-client-lifecycle-and-conformance.spec.md, packages/snapback-client/index.mjs, packages/snapback-client/external-store.mjs]
examples: [demos/coterie, demos/signal-desk, packages/snapback-contract/keyed-provider.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:36b99758a988b2e5ddd7c19d12c8e5c88f4cce7ddef6f6d4ac8565d44235e3e1
---

# Recipe: provider connection and subscription lifecycle

A framework provider should own one stable connection label for one admitted
app/authority/origin lifetime, then multiplex query consumers over that
connection. Mounting N cells may create N logical subscriptions; it must not
create N sockets merely because each cell mounted independently.

This repairs the “connection per subscription” failure: N cells imply N
transport connections only in a broken owner model. The recipe also supplies
the current provider lifecycle budget boundary and an inspection of active
connections and subscriptions by owner.

Search phrase: N cells imply N transport connections.
Inspection phrase: active connections and subscriptions by owner.

## Put one owner above the cells

Construct the client and connection label at provider scope. Reuse the
client's `liveStreamManager(connectionId)` and the shared external-store
registry for every matching child subscription. The registry deduplicates
equal provider/query/authority/args identities and refcounts listeners; the
last listener disposes the upstream handle. Keyed scopes replace whole route
generations without app-authored generation counters.

Wait for settled principal authority before starting protected subscriptions.
On a transport-only reconnect, update the connection fact and let the manager
resume its consumers; do not rebuild every query owner. Query callbacks should
publish the delivered rows, not start nested queries. Suppress equal snapshots
at the store boundary so a provider does not turn connection churn into render
churn.

On provider disposal, release child handles and close scopes/registries. The
last demand lease closes and retires the stream manager; then await
`client.close()` for final client cleanup. A subscription handle's `settled()`
waits for its lifecycle boundary; it does not replace `dispose()`.

## Inspect the lifecycle in acceptance tests

Use `client.localResourceInspection()` only as an acceptance inspection. It
reports managers, grants, lane consumers, socket demand, timers, and listeners.
A useful regression mounts many equal cells, waits for data, and asserts one
manager/connection with refcounted consumers; after unmount and provider close,
it asserts the scoped manager, grants, demand, timers, and listeners retire.
Provider-specific `inspection()` projections may add store/subscription counts,
but neither inspection surface is product state or authorization evidence.

## Current budget boundary

The sanctioned decision-independent floor is qualitative: stable connection
identity, multiplexing, deduplication, explicit disposal, and zero owned
resources after teardown. Snapback does **not yet publish a numeric per-provider
connection/subscription/timer budget**. That Phase 0 decision remains tracked
in `issues/20260821-provider-connection-subscription-budget-decision.md`.
Do not invent a threshold in application docs or tests and call it platform
policy; record measured counts and keep the qualitative invariants above.

## Anti-patterns

- Minting a new `connectionId` for every query or component mount.
- Starting protected subscriptions before authority settles.
- Running a second query from inside each subscription callback.
- Treating reconnect as a reason to reconstruct every logical store.
- Forgetting to dispose handles because their current row snapshot looks
  empty.
- Advertising a numeric resource budget before the Phase 0 decision lands.
