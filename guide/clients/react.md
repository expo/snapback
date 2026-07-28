---
title: The React client
id: clients.react
order: 2
audience: agent-first
capabilities: [clients.react]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0064-native-client-surfaces.rfc.md, llp/0101-inline-handlers-and-result-contracts.spec.md, llp/0102-first-class-react-and-query-groups.spec.md, packages/snapback-client/canonical-client-value.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-react/index.mjs, packages/snapback-react/index.d.mts, packages/snapback-react/exact-result-types.fixture.ts]
examples: [packages/snapback-cli/templates/react, demos/backend-bakeoff/src/backends/snapback.ts, demos/backend-bakeoff/tests/react.mjs, packages/snapback-react/package.test.mjs, packages/snapback-react/exact-result-types.fixture.ts]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-27
reviewed-commit: HEAD
---

# The React client

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`@snapback/react` supplies a prepared provider, exact generated-reference
inference, shared single and grouped live queries, mutations, and connection
state through React's `useSyncExternalStore` contract. The provider owns
canonical query identity, Strict Mode replay, late-handle disposal, auth
custody blanking, and cleanup. Components do not open live handles in
`useEffect` or add a second query cache.

Prepare the connected deployment before rendering, then construct a provider
from that immutable binding:

```ts fragment reason="application composition varies by renderer and generated artifact imports"
const binding = await client.prepareReactBinding({
  generatedManifest: { functions, capabilityManifest },
});
const provider = createSnapbackReactProvider(binding);

root.render(
  <SnapbackProvider provider={provider}>
    <App />
  </SnapbackProvider>,
);
```

Preparation verifies app, deployment, auth-mode, function-catalog, and
capability identity. The provider borrows the client; `provider.dispose()`
drains only provider-owned subscriptions, stores, listeners, timers, and its
auth-barrier participant.

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
- `error`: a structured diagnostic for `error`, otherwise `null`.

Same-reference, same-argument siblings under one provider share one store and
one upstream subscription while retaining independent React consumers.
Different provider objects, complete generated references, or canonical
arguments stay isolated.

## Read a query group

Use one group when a view assembles several independently live results:

```ts fragment reason="group membership is application-specific"
const workspace = useSnapbackQueries({
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

This is an Online projection. It does not claim local handler execution,
durable offline queueing, or Parity merely because it can retain data while a
connection is stale. Presence remains an explicit headless-client adapter
until its separate React lifecycle gate lands.

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
