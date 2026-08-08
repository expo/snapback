---
title: "Recipe: optimistic create with a server-minted ID"
id: recipes.optimistic-create
order: 5
audience: agent-first
capabilities: [clients.optimistic-mutation-view]
authorities: [llp/0107-react-presence-and-optimistic-lifecycle.spec.md, llp/0133-local-settlement.spec.md, llp/0155-local-sync-product-direction.rfc.md, packages/snapback-client/index.mjs, demos/zero-bakeoff/apps/contention-calendar/snapback/functions.mjs, demos/zero-bakeoff/apps/contention-calendar/snapback/src/App.tsx, tests/acceptance/contention-calendar-rung2-v1.mjs]
examples: [demos/zero-bakeoff/apps/contention-calendar, tests/acceptance/contention-calendar-rung2-v1.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-commit: HEAD
---

# Recipe: optimistic create with a server-minted ID

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback can render an optimistic insert before the server mints its canonical
row id without forging a generated `Id<Table>`. The shipped path is the
framework-neutral `SnapbackClient.createOptimisticMutationView` over a durable
outbox and a locally executable generated mutation IR. Contention Calendar is
the executable React witness, and its retained rung-2 acceptance proves
provisional filtering/order/count/relationships, rejection, logical-mint id
mapping, response-loss retry, and observer convergence.

This is a lower-level composition than `useSnapbackMutation`. There is still
no first-class provider-owned React hook that inserts a typed provisional row
into a canonical `useSnapbackQuery` store; that ergonomic capability remains
the explicit `clients.optimistic-create` GAP.

## Author one generated insert

Use `defineMutation`, not a server JS mutation plus a separate application
optimistic reducer. The generated plan is the one authored operation the local
evaluator predicts and the server executes authoritatively:

```js source=demos/zero-bakeoff/apps/contention-calendar/snapback/functions.mjs
export const reserve = defineMutation({
  args: {
    idempotencyKey: v.string(),
    resourceKey: v.string(),
    slotKey: v.string(),
    ownerId: v.string(),
    title: v.string(),
    now: v.integer(),
  },
  result: results.value(v.id('reservations')),
  plan: insert('reservations', {
    idempotencyKey: arg('idempotencyKey'),
    resourceKey: arg('resourceKey'),
    slotKey: arg('slotKey'),
    resourceSlotKey: concat(arg('resourceKey'), '|', arg('slotKey')),
    ownerId: arg('ownerId'),
    title: arg('title'),
    createdAt: arg('now'),
  }, { bindIdAs: 'reservationId' }),
  returns: returnBinding('reservationId'),
});
```

Generation must classify the mutation `local-executable`. Unsupported local
IR refuses or degrades explicitly; do not add a handwritten reducer while
claiming same-operation parity.

## Keep provisional and canonical identities distinct

The optimistic layer contains a speculative mint, but application UI must not
cast it to the branded canonical id. Derive presentation identity from the
layer's durable `clientMutationId`; use the generated row id only after the
authoritative query supplies it:

```tsx source=demos/zero-bakeoff/apps/contention-calendar/snapback/src/App.tsx
type VisibleReservation = Readonly<{
  identity:
    | Readonly<{ kind: 'provisional'; intentId: string }>
    | Readonly<{ kind: 'canonical'; id: Reservation['_id'] }>;
  fields: ReservationFields;
  resourceTitle: string;
}>;
```

That distinction prevents a speculative string from leaking into mutation
arguments or durable application state as if the server had minted it. It also
gives React a stable key: `intent:${intentId}` while provisional,
`canonical:${id}` after authoritative delivery.

## Open one view over the canonical base

The client needs a durable RQS store and offline queue. Fetch the canonical
rows, create the optimistic view, subscribe to it, and rebase it whenever the
canonical live query advances:

```tsx source=demos/zero-bakeoff/apps/contention-calendar/snapback/src/App.tsx
      const view = await client.createOptimisticMutationView({
        authoritativeRows: { reservations: scheduleRows.rows },
        connected: true,
      });
```

The view replays private generated-IR layers over the newest authoritative
base in durable sequence. Projection code can filter, sort, count, and join
the `visibleRows` with already-complete bounded local data; it must preserve
the identity union above and never expose a provisional mint as canonical.

## Mutate normally, then retire by settlement identity

`client.mutate(api.reserve, { args })` sees the generated IR, records durable
intent, and paints the provisional row before the server response. On success,
install authoritative rows and retire the exact `clientMutationId`:

```tsx source=demos/zero-bakeoff/apps/contention-calendar/snapback/src/App.tsx
      const schedule = await client.query(api.schedule);
      canonicalRef.current = schedule.rows;
      await viewRef.current?.rebase({
        authoritativeRows: { reservations: schedule.rows },
        retiredSettlementIdentities: settlement.clientMutationId
          ? [settlement.clientMutationId]
          : [],
        connected: true,
        cause: 'reservation-authoritative-delivery',
      });
```

A successful server-minted insert carries an LLP 0133 `idMap`. The mapping is
not guessed from equal row content, call order, or mint counts: it pairs the
local and authoritative ids by logical mint identity `(site, occurrence)`.
The executable acceptance checks every member:

```js source=tests/acceptance/contention-calendar-rung2-v1.mjs
  assert.equal(mapping.speculative, claim.claimed);
  assert.equal(mapping.site, claim.site);
  assert.equal(mapping.occurrence, claim.occurrence);
  assert.equal(mapping.authoritative, settlement.result);
  assert.equal(mapping.disposition, 'mapped');
```

On rejection, refresh/rebase from the canonical base. The rejected private
layer retires immediately and later layers replay. Show a stable declared
application refusal when the backend supplies one; never parse handler message
text ([declared refusals](../backend/mutations.md#consume-the-structured-result)).

## Reuse the exact intent after an ambiguous response

Do not call the mutation again as a new user intent after response loss. The
durable outbox replays the original `clientMutationId` and its exact
semantics-affecting identity. The server's settlement ledger republishes the
stored result and the same logical-mint mapping, so one intent creates one
canonical row.

Contention Calendar's retained receipt proves two wire attempts, one
authoritative application, the same result, and the same `idMap` after a
simulated response loss **after commit**. Run the source check without a
server:

```sh
node tests/acceptance/contention-calendar-rung2-v1.mjs --check
```

The same view also replays pending generated operations on boot. App code owns
view/live-handle teardown and must keep one authority partition per durable
store; never adopt an old authority's optimistic layers into a new principal.

## Choose the right current path

| Need | Current path |
| --- | --- |
| A simple React form where pending rows need no query filtering, ordering, counts, or relationships | Use the component-local intent-keyed pending sidecar in [the React guide](../clients/react.md#optimistically-create-a-row-the-server-will-name). |
| Generated-IR create must participate in one shared local projection and survive ambiguous retry/restart | Compose `createOptimisticMutationView` as this recipe shows. |
| A provisional row directly inside the provider's typed `useSnapbackQuery` store through a first-class hook | GAP: `clients.optimistic-create`; do not pretend this lower-level view is that API. |

## Anti-patterns

- Do not cast or admit a speculative mint as `Id<Table>`.
- Do not author a generated mutation IR and a second optimistic reducer for
  the same operation.
- Do not settle by row-content equality, response order, or mint count.
- Do not retry an ambiguous mutation under a fresh intent identity.
- Do not claim `useSnapbackMutation` has a first-class optimistic-insert
  option; the shipped view is a lower-level headless composition.
