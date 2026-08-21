---
title: "Recipe: provider connection and subscription lifecycle"
id: recipes.provider-lifecycle
order: 15
audience: agent-first
capabilities: [clients.headless, clients.external-store, clients.contract-provider-generation]
authorities: [llp/0034-contract-source-seam-provider-side.rfc.md, llp/0063-partitime-platform-roadmap.plan.md, llp/0095-client-lifecycle-and-conformance.spec.md, packages/snapback-client/index.mjs, packages/snapback-client/external-store.mjs]
examples: [packages/snapback-contract/keyed-provider.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:36b99758a988b2e5ddd7c19d12c8e5c88f4cce7ddef6f6d4ac8565d44235e3e1
---

# Recipe: provider connection and subscription lifecycle

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback exposes connection labels, live-stream managers, keyed provider
scopes, and resource inspection, but it does **not yet select one provider-wide
connection ownership policy**. LLP 0295 D0.5 owns that decision. In particular,
the Coterie demo currently mints per-subscription connection ids; it is evidence
for the open problem, not a positive example of one-transport multiplexing.

Use this page to avoid accidental owner churn and to measure the adapter you
actually built. Do not advertise “N cells imply one transport” until the
requested N-cells regression fixture exists and D0.5 selects the supported
budget.

Search phrase: N cells imply N transport connections.
Inspection phrase: active connections and subscriptions by owner.

## Keep each chosen owner stable

Construct the client at provider scope. If the adapter chooses a shared
connection label, keep it stable for that adapter's documented
app/authority/origin lifetime and reuse `liveStreamManager(connectionId)`.
If it chooses narrower labels, keep each label stable for its declared owner
and report the resulting manager/socket counts. Keyed scopes and the shared
external-store registry can deduplicate equal
provider/query/authority/args identities and refcount listeners, but those
primitives are not themselves proof of a one-transport provider contract.

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
A future D0.5 regression should mount many equal cells, wait for data, and
assert the selected manager/connection budget with refcounted consumers. That
fixture does not exist yet. Current acceptance can still assert its observed
counts and, after unmount and provider close, that scoped managers, grants,
demand, timers, and listeners retire. Provider-specific `inspection()`
projections may add store/subscription counts, but neither inspection surface
is product state or authorization evidence.

## Current budget boundary

The sanctioned decision-independent floor is qualitative: stable connection
identity within the adapter's declared owner, deduplication where the chosen
scope permits it, explicit disposal, and zero owned resources after teardown.
Snapback does **not yet publish a provider-wide ownership rule or numeric
per-provider connection/subscription/timer budget**. That Phase 0 decision remains tracked
in `issues/20260821-provider-connection-subscription-budget-decision.md`.
Do not invent a threshold in application docs or tests and call it platform
policy; record measured counts and keep the qualitative invariants above.

## Anti-patterns

- Minting a new `connectionId` on every render or retry with no declared owner.
- Starting protected subscriptions before authority settles.
- Running a second query from inside each subscription callback.
- Treating reconnect as a reason to reconstruct every logical store.
- Forgetting to dispose handles because their current row snapshot looks
  empty.
- Advertising a numeric resource budget before the Phase 0 decision lands.
