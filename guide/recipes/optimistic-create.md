---
title: "Recipe: optimistic create with a server-minted ID"
id: recipes.optimistic-create
order: 6
audience: agent-first
capabilities: [clients.optimistic-create, clients.optimistic-mutation-view]
authorities: [llp/0107-react-presence-and-optimistic-lifecycle.spec.md, llp/0133-local-settlement.spec.md, llp/0155-local-sync-product-direction.rfc.md, packages/snapback-client/index.mjs, packages/snapback-react/index.mjs, packages/snapback-react/index.d.mts, packages/snapback-react/optimistic-create.test.mjs, demos/_kit/tests/provider-live-conformance.mjs, demos/zero-bakeoff/apps/contention-calendar/snapback/functions.mjs, tests/acceptance/contention-calendar-rung2-v1.mjs]
examples: [packages/snapback-react/optimistic-create-types.fixture.ts, packages/snapback-react/optimistic-create.test.mjs, demos/_kit/tests/provider-live-conformance.mjs, demos/zero-bakeoff/apps/contention-calendar]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:a12838a91ec8d10412f534c734aafbb28bb727c1177f2a49cbf91363932cd3ec
---

# Recipe: optimistic create with a server-minted ID

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback can render an optimistic insert before the server mints its canonical
row id without forging a generated `Id<Table>`. React applications use
`useSnapbackOptimisticCreate`, a provider-owned projection over the exact
canonical query store. The lower-level
`SnapbackClient.createOptimisticMutationView` remains available for headless
compositions. Both paths use the durable outbox, the same locally executable
generated mutation IR, and the same LLP 0133 logical-mint settlement.

The React package tests prove typed provisional presentation, filtering,
ordering, relationship projection, both response/query orderings, overlapping
rejection, Strict Mode remount, authority cuts, and cleanup. The real-server
provider conformance gate drops a response after commit, replays the exact
durable intent, consumes the same `idMap`, and observes one canonical rendered
row.

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

## Project the provider-owned query

The hook pairs one generated insert with one generated documents live query.
Its `select` function is where provisional and canonical entities share
filtering, ordering, counts, and relationship projection:

```ts source=packages/snapback-react/optimistic-create-types.fixture.ts
const calendar = useSnapbackOptimisticCreate(api.reserve, {
  query: api.schedule,
  args: {},
  select: (entities) => entities
    .filter((entity) => entity.fields.slotKey === 'slot-a')
    .sort((left, right) => left.fields.resourceKey.localeCompare(right.fields.resourceKey)),
});
```

The generated `OptimisticCreateEntity<Row>` union has a top-level `kind`.
Canonical identity is the server's `Id<Table>` and canonical fields include
the server metadata. Provisional identity is a distinct generated
`ProvisionalId<Table>` backed by `clientMutationId`; its fields omit all
server-authored identity/version/timestamp fields. TypeScript therefore
refuses a provisional identity where a canonical id is required. The private
speculative mint used by local IR evaluation is never application data.

Call `calendar.create(args)` rather than `client.mutate` plus a handwritten
append reducer. The provider opens one shared optimistic view for the exact
canonical query store, replays private layers over every authoritative base,
and closes it after its consumers and durable work are gone. Because this is a
generated insert rather than the generic reducer API, it does not trigger the
append-reducer replay advisory.

## Settle by durable intent identity

A successful server-minted insert carries an LLP 0133 `idMap`. The provider
does not guess from equal row content, call order, or mint counts: it pairs the
local and authoritative ids by logical mint identity `(site, occurrence)`.
Response-first success bridges the provisional entity until canonical
delivery. Query-first delivery is held behind the unresolved mutation, then
the mapping retires the provisional layer atomically. The lower-level
Contention Calendar acceptance checks every mapping member:

```js source=tests/acceptance/contention-calendar-rung2-v1.mjs
  assert.equal(mapping.speculative, claim.claimed);
  assert.equal(mapping.site, claim.site);
  assert.equal(mapping.occurrence, claim.occurrence);
  assert.equal(mapping.authoritative, settlement.result);
  assert.equal(mapping.disposition, 'mapped');
```

On rejection, only the rejected private layer retires and later layers replay.
Show a stable declared application refusal when the backend supplies one;
never parse handler message text
([declared refusals](../backend/mutations.md#consume-the-structured-result)).

## Reuse the exact intent after an ambiguous response

Do not call the mutation again as a new user intent after response loss. The
durable outbox replays the original `clientMutationId` and its exact
semantics-affecting identity. The server's settlement ledger republishes the
stored result and the same logical-mint mapping, so one intent creates one
canonical row.

The provider-live conformance gate proves two wire attempts, one authoritative
application, the same durable `clientMutationId`, the same `idMap`, and one
canonical entity after a simulated response loss **after commit**:

```sh
node demos/_kit/tests/provider-live-conformance.mjs
```

`create` rejects a queued dispatch with
`SNAPBACK_REACT_MUTATION_QUEUED`, but the provider keeps the provisional layer
and discovers the retained settlement after outbox replay. Never issue a fresh
create to recover an ambiguous response. Authority replacement blanks the old
view; Strict Mode and HMR remounts share the provider-owned view instead of
duplicating durable work.

## Choose the right current path

| Need | Shipped path |
| --- | --- |
| React create participates in one provider-owned canonical query projection | `useSnapbackOptimisticCreate`. |
| Acceptance adapter needs the exact hook path without a React renderer | `observeSnapbackOptimisticCreate`. |
| A headless composition genuinely needs direct view/rebase control | `SnapbackClient.createOptimisticMutationView`. |

## Anti-patterns

- Do not cast or admit a speculative mint as `Id<Table>`.
- Do not author a generated mutation IR and a second optimistic reducer for
  the same operation.
- Do not settle by row-content equality, response order, or mint count.
- Do not retry an ambiguous mutation under a fresh intent identity.
- Do not hand-author a parallel pending sidecar when the row needs the query's
  filtering, ordering, counts, or relationships.
