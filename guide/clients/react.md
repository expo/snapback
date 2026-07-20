---
title: The React client
id: clients.react
order: 2
audience: agent-first
capabilities: [clients.react]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0063-partitime-platform-roadmap.plan.md, packages/snapback-client/external-store.mjs, packages/snapback-react/index.mjs]
examples: [demos/partiful-matrix/surfaces/react, packages/snapback-react/package.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-20
reviewed-commit: 506b622cd3
---

# The React client

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`@snapback/react` projects the framework-neutral
`@snapback/client/external-store` through React's supported
`useSyncExternalStore` contract. Use `useSnapbackQuery` instead of owning a
`useEffect` subscription, a late-handle flag, and a second query cache in each
component.

The adapter owns initial pending/ready state, immutable rows, connection and
error state, canonical argument identity, authority identity, Strict Mode
replay, late-handle disposal, optimistic pending/confirmed/rejected mutation
state, and unmount cleanup. Same-key sibling components over the same provider
share one logical store and upstream attempt; each component still has an
independent React subscription. Different args or authority identities stay
isolated.

## Bind a generated query

Provide the generated operation name/arguments and the current user/authority.
Partitime's entire compatibility hook is now this projection:

```tsx source=demos/partiful-matrix/surfaces/react/src/App.tsx
function useRows<Row>(provider: MatrixProvider, name: QueryName, args: Record<string, unknown>, persona: Persona) {
  const snapshot = useSnapbackQuery<Row>({
    provider,
    name,
    args,
    userId: persona.userId,
    authority: persona.userId,
  });
  return { rows: snapshot.rows, connection: snapshot.connection as Connection };
}
```

The provider declares `externalStoreProtocol: "snapback.external-store.v1"`
and implements `subscribe(name, args, userId, observer)` plus
`mutate(name, args, userId)`. Generated Snapback refs stay behind that provider;
components never write tables directly or mirror server data into another
client cache. Observer deliveries distinguish `authoritative`, `connection`,
and `error`; a cached-row connection transition must never masquerade as a new
authoritative snapshot or retire an optimistic layer.

`useSnapbackQuery` returns:

- `status`: `pending | ready | refreshing | error`;
- `rows`: always an immutable array, including retained previous rows on an
  error or stale connection;
- `connection`: the headless connection axis;
- `error`: a serialized structured error or `null`;
- `mutation`: `idle | pending | confirmed | rejected` plus id/result/error;
- `mutate(name, args, { optimisticRows, id })`;
- `store`, for inspection or advanced composition.

## Let identity replace subscriptions

Pass semantic args, not a manually serialized dependency string. The shared
store canonicalizes plain-object keys, arrays, finite numbers, and authority.
Changing A→B→A opens the current identity without accepting a late B result.
Two siblings at A share one upstream attempt; moving only one sibling to B
leaves A live for the other.

The package suite runs these cases under `StrictMode`, including same-key
sibling sharing, different-key isolation, replay after cleanup, and final
unmount disposal. The framework-neutral suite separately covers late-resolving
handles, stale-generation deliveries, error snapshots, optimistic rollback,
and incompatible-protocol refusal.

## Mutate with visible settlement

Call the hook's `mutate` function when the component needs pending and
settlement state. `optimisticRows` may be an array or a pure projection over
the current rows. Supply `isAuthoritative(rows, mutation)` when generated
result/row identity can correlate the live result with this mutation. That
matcher suppresses the overlay even when the authoritative query update beats
the HTTP response; without it, the conservative fallback retires a confirmed
overlay on the next authoritative delivery. Rejection always recomputes from
the latest authoritative rows rather than restoring a mutation-start snapshot.

This is an Online client projection. It does not claim local handler execution,
durable offline queueing, or Parity merely because it can preserve current rows
while a connection is stale. See [React Expo](./react-expo.md) for the per-OS
native profile.

## Render connection state honestly

Render `connecting | live | polling | stale | disconnected` as distinct facts.
Retained rows under `stale` are useful but are not authoritative current data.
Do not infer freshness from the presence of rows or from an open socket; consume
the same connection axis described by [live queries](../realtime/live-queries.md).

## Anti-patterns

- **Do not rebuild the adapter with `useEffect` and `useState`.** That
  reintroduces Strict Mode, late-handle, sibling-sharing, and teardown races.
- **Do not key by `JSON.stringify(args)` in component code.** Pass args and
  authority to `useSnapbackQuery`; the shared identity contract owns them.
- **Do not add a parallel React query cache.** The external store is the shared
  current-value-plus-subscription seam.
- **Do not omit authority identity when user or tenant context changes.** A
  privacy cut must create a distinct store identity.
- **Do not call Online local-first or Parity.** Those classes require the
  retained execution/replay proofs in LLP 0012 and LLP 0064.
