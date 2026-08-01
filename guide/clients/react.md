---
title: The React client
id: clients.react
order: 2
audience: agent-first
capabilities: [clients.react]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0064-native-client-surfaces.rfc.md, llp/0108-inline-handlers-and-result-contracts.spec.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0107-react-presence-and-optimistic-lifecycle.spec.md, llp/0112-generated-query-group-bundle-adoption.spec.md, packages/snapback-client/canonical-client-value.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-contract/result-contract-validator.mjs, packages/snapback-react/index.mjs, packages/snapback-react/index.d.mts, packages/snapback-react/exact-result-types.fixture.ts]
examples: [packages/snapback-cli/templates/react, demos/signal-desk/src/backends/snapback.ts, demos/signal-desk/tests/react.mjs, demos/signal-desk/acceptance/results/react-presence.v1.json, packages/snapback-react/package.test.mjs, packages/snapback-react/optimistic.test.mjs, packages/snapback-react/presence.test.mjs, packages/snapback-react/offline.test.mjs, packages/snapback-react/exact-result-types.fixture.ts]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-01
reviewed-commit: HEAD
---

# The React client

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`@expo/snapback-react` supplies a prepared provider, exact generated-reference
inference, shared single and grouped live queries, optimistic mutations,
managed presence, and connection state through React's `useSyncExternalStore`
contract. The provider owns canonical query and room identity, Strict Mode
replay, late-handle disposal, auth custody blanking, expiry/heartbeat work, and
cleanup. Components do not open live handles in `useEffect`, add a second
query cache, or manage presence intervals.

Prepare the connected deployment before rendering, then construct a provider
from that immutable binding:

```ts fragment reason="application composition varies by renderer and generated artifact imports"
const binding = await client.prepareReactBinding({
  generatedManifest: { schema, functions, capabilityManifest },
});
const provider = createSnapbackReactProvider(binding);

root.render(
  <SnapbackProvider provider={provider}>
    <App />
  </SnapbackProvider>,
);
```

Preparation verifies app, deployment, auth-mode, schema, function-catalog,
result contracts, ephemeral declarations, and capability identity. The
provider borrows the client; `provider.dispose()` drains provider-owned
subscriptions, rooms, stores, listeners, timers, connection grant, socket
demand, and its auth-barrier participant.

## Bind a generated query

Pass a generated operation reference and its exact arguments. The reference
supplies both argument and result types, so there is no result generic to fill
in or override:

```ts source=packages/snapback-react/exact-result-types.fixture.ts
const query = useSnapbackQuery(todos, { owner: 'ada' });
if (query.status === 'ready' || query.status === 'refreshing') {
  query.data[0]?.title.toUpperCase();
}
```

`useSnapbackQuery` returns:

- `status`: `pending | ready | refreshing | error | skipped`;
- `data`: immutable result rows only for `ready` or `refreshing`, otherwise
  `undefined`;
- `connection`: `idle | connecting | live | polling | stale | disconnected |
  closed | error`;
- `error`: a structured diagnostic for `error`, otherwise `null`;
- `freshness`: `unknown | retained | current` — `retained` rows came from
  the persisted cache (an offline cold boot) and are never presented as
  settled: a retained frame keeps `status: 'refreshing'` even on a live
  connection until the authoritative answer makes it `current`;
- `retention`: the headless handle's refuse-with-clarity retainability fact
  (`{ retainable, code, reason, store }`, `null` until classified) — see
  [offline retention](../sync/offline-and-retention.md) for the opt-in that
  makes a query retainable.

Same-reference, same-argument siblings under one provider share one store and
one upstream subscription while retaining independent React consumers.
Different provider objects, complete generated references, or canonical
arguments stay isolated.

## Read a query group

When the group is also a declared route bundle, use its generated reference.
Prepare it before mount so the LLP 0090 register-mode owner takes every
initial snapshot and creates every live registration at one commit:

```ts fragment reason="route and parameter names come from the generated application API"
const workspaceGroup = await binding.prepareQueryGroup(
  groups['/workspace/:incidentId'],
  { incidentId },
  { fallbackToLive: true },
);
const provider = createSnapbackReactProvider(binding, {
  preparedGroup: workspaceGroup,
});

// Inside the provider:
const workspace = useSnapbackQueries(workspaceGroup);
```

The generated reference closes the child refs, argument mappings, string route
parameters, app, and definition digest. The prepared group is opaque: its
`$param` mappings target string args only; numeric/boolean parameter routes
remain available through ordinary read bundles but do not receive a registered
group reference. Literal numeric/boolean args are fine. The prepared group's
public entries contain safe generated identity, never rows, subscription ids,
resume receipts, authorization projections, namespaces, grants, or a
connection handle, and the private transferred owner is not reachable through
provider properties. The provider publishes registered rows only after
positive server-confirmed socket attach. On a successful registered boot,
`workspace.boot` records the one initial
`{commitVersion, generation, versionStream, attachDeadline}` and each canonical
child store adopts its registration without an ordinary prime/subscribe race.
That field is initial provenance only; later child deltas are independently
live.

Fallback is intentionally narrow. Only a target whose served capability
manifest lacks experimental `registered_bundle_boot_v1` can produce
`source: "live-fallback"` when the author set `fallbackToLive: true`.
Authentication, authorization, integrity, limit, timeout, and malformed
bundle failures still refuse. If a valid registered preparation reaches its
attach deadline before provider adoption, the provider reports
`source: "live-recovery"`, `reason: "attach-deadline-expired"`, and
`boot: null`; it discards the expired rows and opens ordinary fresh live
subscriptions.

A lazy child is also fail-closed: if its registered subscription receives a
delta before that child store adopts it, the provider reports
`source: "live-recovery"`, `reason: "unadopted-delta"`, and `boot: null`.
First demand opens a fresh subscription that supersedes the dirty registration
instead of exposing the older bundle rows.

For view-local group membership that is not a route bundle, pass the existing
typed object map directly:

```ts fragment reason="view-local group membership is application-specific"
const filters = useSnapbackQueries({
  incidents: { ref: api.listIncidents, args: {} },
  tasks: { ref: api.tasksForIncident, args: { incidentId } },
  comments: { ref: api.commentsForIncident, args: showComments ? {} : skip },
});
```

Groups contain 1–64 entries. Each non-skipped child counts as one consumer and
one live subscription unless it shares an existing canonical store. Changing
one entry preserves unrelated entry snapshots. Validation and cap admission
are transactional: a refused update leaves the previous group attached.

## Run a mutation

```ts fragment reason="mutation names and fields come from the application schema"
const addTask = useSnapbackMutation(api.addTask);
const taskId = await addTask({ incidentId, body: 'Check headers' });
```

The returned function infers exact arguments and the unwrapped result from the
generated mutation reference. Runtime refusals reject with Snapback's
structured diagnostic.

For a mutation whose optimistic projection updates a currently authoritative
live query, declare that projection beside the hook:

```ts fragment reason="mutation and query fields come from the generated application API"
const toggleTask = useSnapbackMutation(api.toggleTask, {
  optimistic: {
    query: api.allTasks,
    args: {},
    update(tasks, { taskId }) {
      return tasks.map((task) =>
        task.id === taskId ? { ...task, done: !task.done } : task);
    },
    isAuthoritative(tasks, result) {
      return tasks.some((task) => task.id === result.id
        && task.done === result.done);
    },
  },
});
```

The optimistic layer is installed only over the provider's already-current
authoritative query store and is validated against the generated result
contract before network work. Overlapping attempts rebase in invocation order.
Rejection removes only its own layer and recomputes over the newest
authoritative base. An HTTP response validates and settles the mutation
promise, but is not itself live-query authority; `isAuthoritative`, when
present, retires that layer only after a matching validated live delivery.
There are at most 256 pending optimistic layers per store.

## Publish and observe presence

Pass a generated connection-keyed ephemeral reference. A non-skipped value is
declarative managed intent: the provider publishes it after the authoritative
room snapshot and refreshes it within the generated TTL and rate limits.

```ts fragment reason="presence fields come from the generated ephemeral declaration"
const presence = useSnapbackPresence(ephemeral.incidentPresence, {
  scope: { incidentId },
  value: {
    userId: persona.id,
    name: persona.name,
    color: persona.color,
    viewing: 'incident',
  },
  ttlMs: 4_000,
});

if (presence.status === 'ready' || presence.status === 'stale') {
  renderViewers(presence.entries);
}
```

Equal provider/reference/scope consumers share one headless room, overlay,
listener, and heartbeat. Their managed values and TTLs must agree. Use
`value: skip` for an observer; only observers may call `publish` and `delete`
imperatively. Managed TTL is 500 ms through the collection's generated
maximum, and scope/value contracts, payload size, sustained rate, burst rate,
and React-local room/consumer/publisher caps refuse before invalid work.

The closed state is `pending | resyncing | ready | stale | error |
unsupported`. Only `ready` is authoritative. `stale` retains same-authority
entries only to their server-stamped monotonic expiry; predecessor authority
entries are blanked. Presence is never persisted, hydrated, or counted as a
durable mutation. This first-class surface is deliberately local-target only;
a hosted binding returns `unsupported` without starting a room or socket.

## Render connection state honestly

`useSnapbackConnection()` observes the provider-wide weakest connection state
and active-subscription count without creating demand. Render `connecting`,
`live`, `polling`, `stale`, and `disconnected` as distinct facts. Retained data
under `refreshing` is useful but is not proof that the transport is currently
live.

The provider admits at most 256 cached query stores, 1,024 committed query
consumers, and 64 simultaneous server subscriptions. A saturated replacement
can supersede exactly one predecessor only when the updating group uniquely
owns it; shared or multi-entry saturated replacement refuses without changing
the old group.

This is an Online projection. It does not claim local handler execution or
Parity merely because it can retain data while a connection is stale.

## Render offline facts honestly

The hooks project the headless client's own offline facts — they surface,
never invent. An offline cold boot of a retainable query renders its
persisted rows with `freshness: 'retained'` and `status: 'refreshing'`
(never `'ready'`), holding the `stale` connection axis, and settles to
`freshness: 'current'` when the authoritative answer arrives:

```js source=packages/snapback-react/offline.test.mjs
  await act(async () => {
    handle.seedRetained(RETAINED_ROWS);
    handle.surviveOffline();
    await flush();
  });
  assert.equal(latest.freshness, 'retained');
  assert.equal(latest.status, 'refreshing');
  assert.equal(latest.connection, 'stale');
  assert.equal(latest.retention?.retainable, true);
```

`useSnapbackOutbox()` projects the durable queued-intent state
(LLP 0043 M2): `{ status, supported, pending, failed, replaying }` plus a
`replay()` action that drains through the client's single-flight
`replayQueuedMutations()`. Render a queued-changes badge from it next to
retained rows — the retained rows themselves stay **pre-intent** (this arm
runs no local execution, so queued writes are never fabricated into the
frame; LLP 0090 D3's rendering note). A client without the projection seam
refuses with `SNAPBACK_REACT_OUTBOX_UNSUPPORTED` instead of reporting a
false empty queue. `observeSnapbackOutbox(provider, listener)` is the
framework-neutral twin for acceptance adapters.

An optimistic mutation projection still requires a **current authoritative**
store: installing an optimistic layer over a retained-only frame refuses
with `SNAPBACK_REACT_OPTIMISTIC_STORE_MISSING`.

The retained Signal Desk receipt at
`demos/signal-desk/acceptance/results/react-presence.v1.json` proves two
independent WebSocket clients, TTL expiry, disconnect deletion, durable-version
separation, optimistic rebase/matcher ordering, SSR zero demand, hosted
no-work refusal, and exact provider/client/server cleanup with zero skips.

## Anti-patterns

- **Do not construct a provider from an unprepared client.** Await
  `prepareReactBinding` before rendering.
- **Do not rebuild live ownership with `useEffect` and `useState`.** That
  reintroduces Strict Mode, sibling-sharing, and teardown races.
- **Do not key by `JSON.stringify(args)` in component code.** Pass args and
  generated references to the hook; the canonical identity contract owns them.
- **Do not add a parallel React query cache.** The external store is the shared
  current-value-plus-subscription seam.
- **Do not call Online local-first or Parity.** Those classes require the
  retained execution/replay proofs in LLP 0012 and LLP 0064.
- **Do not pass string names from components.** Pass generated query and
  mutation references admitted by the prepared binding.
- **Do not add a caller-selected row/result generic around a generated
  reference.** Fix the function's result contract and regenerate the API.
- **Do not treat a mutation HTTP response as live-query authority.** Use the
  subsequent validated live delivery to retire optimistic state.
- **Do not create presence heartbeat intervals in application code.** Pass
  managed intent to `useSnapbackPresence`; the provider owns admission,
  refresh, disconnect, and teardown.
