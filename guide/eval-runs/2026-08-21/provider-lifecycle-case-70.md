# Retrieval eval run — 2026-08-21 — case 70

**Intent:** Provider connection lifecycle
**Fixture:** fresh `gpt-5.6-sol` Codex context; read-only; three tool calls.
**Verdict:** PASS — routed to `guide/recipes/provider-lifecycle.md` on tool
call 3 and returned tuple-scoped manager ownership, settled-authority gating,
owner inspection, and zero-resource teardown without inventing a numeric
budget.

## Actual prompt

````text
Cold retrieval probe for guide/retrieval-eval.md case 70. You are a provider author new to Snapback. In at most 15 tool calls total, follow repository AGENTS.md and use only guide/index/capability/retrieval routes and the specific Guide pages they lead to; do not inspect implementation source, LLPs, issues, or prior eval-run evidence. Answer this exact intent: "My Contract provider creates a connection per subscription; N cells imply N transport connections and teardown leaks timers." Produce a concrete, teardown-safe two-client adapter plan, including owner-scoped connection/subscription inspection and the current numeric-budget boundary. End with a numbered transcript of the actual tool calls you used and state which Guide page you loaded and by which tool-call number. Do not edit files.
````

## Actual tool trace

1. `sed -n '1,240p' skills/snapback-authoring/SKILL.md` — exit 0.
2. `rg -n -i "provider|contract|adapter|subscription|connection|transport|inspection|budget" guide/index.md guide/capabilities.md guide/retrieval-eval.md` — exit 0.
3. `sed -n '1,260p' guide/recipes/provider-lifecycle.md` — exit 0.

## Final response (verbatim)

````text
Create one adapter manager per `(application, storage partition, server origin, settled authority)` tuple—not per Contract cell.

For two clients:

1. Build Owner A and Owner B independently. Each owns:

   - One `SnapbackClient`
   - One connection manager
   - One external-store registry
   - One Contract provider
   - One stable, readable `connectionId`

2. Place each manager above all cells it serves. Every cell under Owner A reuses A’s `connectionId`; every cell under Owner B reuses B’s. Never share a manager across different authority or storage-partition boundaries.

3. Key logical query stores by canonical `(provider, query, authority, args)`. Identical keys share one upstream store with refcounted listeners. Different queries create distinct logical subscriptions, but all subscriptions for an owner share its single transport connection.

4. Subscribe only after authority settles:

   - `authentication-required`: remain blocked.
   - `authentication-not-settled`: remain blocked and wait for the next provider snapshot.
   - Never use a timeout or poll the client to infer settlement.
   - On authority replacement, dispose all predecessor-owned subscriptions before creating the successor connection and obtaining its fresh snapshot.

5. Keep delivery callbacks non-reentrant: copy rows and lifecycle facts into the adapter store, then return. Schedule any further lifecycle work at a microtask or framework-effect boundary.

6. Teardown in ownership order:

   - Each cell releases its listener.
   - The last listener releases the logical subscription.
   - Await provider disposal so scopes and registries close.
   - Await `client.close()` only when that adapter owns the client.
   - `settled()` may confirm a cleanup boundary, but does not replace `dispose()`.

For owner-scoped inspection, combine each provider’s `inspection()` with its own client’s `localResourceInspection([connectionId])`:

```js
function inspectOwner(client, provider) {
  const providerState = provider.inspection();
  const connectionId = provider.registry.connectionId;
  const resources = client.localResourceInspection([connectionId]);

  return {
    owner: providerState.providerInstanceId,
    connectionId,
    activeConnections: resources.managers.filter(
      (manager) =>
        !manager.closed && (manager.open || manager.socketDemand > 0),
    ).length,
    activeSubscriptions: providerState.serverSubscriptions,
    socketDemand: resources.socketDemand,
    timers: resources.timers,
    listeners: resources.listeners,
  };
}

const beforeTeardown = [
  inspectOwner(clientA, providerA),
  inspectOwner(clientB, providerB),
];
```

After disposing cells, providers, and owned clients, inspect each owner again and require zero active connections, subscriptions, socket demand, timers, and listeners. The readable `connectionId` is an inspection label, not a server wire ID.

The current budget boundary is qualitative, not numeric:

- One stable connection label per manager-owned tuple.
- Canonical query stores are refcounted.
- Logical fan-out is declared and inspectable.
- Teardown leaves zero owned resources.

There is currently no published numeric connection or subscription limit. LLP 0295 D0.5 owns those future budgets and diagnostics; measurements from one application must not be presented as platform thresholds.

Tool-call transcript:

1. `sed` read the required `snapback-authoring` skill instructions.
2. `rg` searched only `guide/index.md`, `guide/capabilities.md`, and `guide/retrieval-eval.md` for the permitted retrieval terms.
3. `sed` loaded the routed Guide page `guide/recipes/provider-lifecycle.md`.

The substantive Guide page was loaded on tool call 3.
````
