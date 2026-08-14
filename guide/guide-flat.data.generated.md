<!-- Generated data section flat projection by scripts/generate-guide-manifest.mjs. Never hand-edit. -->

---

<!-- snapback-guide-source: guide/data/resources.md -->
---
title: Generate a tiny typed data resource
id: data.resources
order: 10
audience: agent-first
capabilities: [data.resources-v1]
authorities: [llp/0255-tiny-data-surface-v1-api.spec.md, llp/0065-generated-data-pattern-soundness.rfc.md, llp/0231-entity-and-permissioning-recommendation.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/data-resource.mjs, packages/snapback-codegen/standard-patterns.mjs, packages/snapback-cli/index.mjs]
examples: [tests/fixtures/data-resource-a1-explicit, tests/fixtures/data-resource-a1-familiar, tests/fixtures/data-resource-a2-explicit, packages/snapback-codegen/data-resource.test.mjs, packages/snapback-cli/data-promotion.test.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.21
unreleased: true
reviewed: 2026-08-13
reviewed-authorities-digest: sha256:4b71b09aeb5c088f81d70edff3108162fbc87583fd6104d44c6636e5743ce6da
---

# Generate a tiny typed data resource

> **Unreleased.** DataResourceV1 is newer than the newest published closure,
> 0.1.20. Use it from contributor source until a later closure publishes it.

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use terminal `.data(...)` when one table is either owner-scoped or deliberately
public-read and needs the standard bounded list/get operations. Owner resources
also receive create/update/delete with owner stamping and transactional
non-disclosing guards. The generated list now supports bounded opaque-keyset
continuation. The static `data.<resource>` descriptor builder is documented in
[bounded data queries](./queries.md); transactions and framework doorways remain
later phases.

## Declare one terminal resource

Declare indexes and visibility first. `.data(...)` is terminal in both the
explicit and familiar profiles.

```js source=tests/fixtures/data-resource-a1-explicit/schema.mjs
export const todos = defineTable({
  title: v.string(),
  completed: v.boolean(),
  ownerId: v.principal(),
  createdAt: v.integer(),
})
  .index('by_owner_created', ['ownerId', 'createdAt'])
  .visibility({ kind: 'owner', field: 'ownerId' })
  .data({ createDefaults: { createdAt: 'now' }, immutable: ['createdAt'] });
```

The generated names are `todos.list`, `todos.get`, `todos.create`,
`todos.update`, and `todos.delete`. After generation, choose the
[headless or React/Expo doorway](./doorways.md); do not hand-wire the generated
references into a second client owner.

Public-read resources generate only list/get and require an explicit ordinary
`listIndex`. Owner resources may omit `listIndex` only when exactly one
ordinary index begins with the owner field. Zero or multiple candidates refuse
instead of guessing.

## Continue a list

List accepts optional `after`. Invoke the first page without that key, then pass
the returned `dc1.*` cursor unchanged as `after`. A short/exhausted page has no
cursor. Cursors are bound to the app generation, plan, non-cursor arguments,
and authority partition; malformed, stale, cross-plan, and cross-owner values
all refuse as `SNAPBACK_DATA_CURSOR_INVALID` without disclosing which check
failed.

## Check the v1 eligibility floor

DataResourceV1 admits explicit owner visibility over a required principal or
plain string, or explicit public-read visibility. It refuses membership or
any-of visibility, authority-bearing tables, retained history, relation-
incarnation fields, more than 64 authored fields, and more than 16 ordinary
indexes. An owner unique index must contain the owner field. A bare `v.id(...)`
field is neutral; the LLP 0110 relation-incarnation stamp is what makes a field
ineligible.

Search/vector indexes and asset-sharing declarations remain owned by their
existing systems. They may coexist with an otherwise eligible resource, but
the generated data operations do not claim search, vector, or asset powers.
For membership, relationships, partial updates, compare-and-set, or other
shapes outside this floor, use a [named query](../backend/queries.md) or
[declarative mutation](../backend/declarative-plans.md).

## Choose the application sync mode

Sync is enabled for every data resource by default. Set the one application
policy field to opt out:

```json fragment reason="the application-wide DataResourceV1 sync opt-out"
{
  "schemaVersion": "snapback.codegen-policy.v1",
  "committedProjections": [],
  "dataSync": "disabled"
}
```

Opt-out changes generated list/get from `LiveQuery` to `Query` and disables
local materialization; owner server writes remain. The field is forbidden when
there are no `.data()` resources. Never add authored `.sync()` to a data table:
it refuses because per-table sync would compete with this application policy.
Familiar's automatic sync is tagged as a profile default and is accepted.

## Inspect generated witnesses

Run generation and inspect `schema.manifest.json#dataResources`, plus the
conditional `data.mjs` and `data.d.ts` files. The normalized resource witness
binds field/default/immutability facts, visibility policy, list index,
contracts, plans, effects, sync, capabilities, ceilings, and refusals. It
excludes source profile and paths, so equivalent explicit and familiar A1
declarations mint the same `normalizedDataResourceId`.

When no table calls `.data()`, all data manifest fields, semantic inputs,
generated files, and package exports are absent. There is no empty default
surface that rotates existing applications.

## Promote one write

Preview a generated owner write as ordinary explicit source:

```sh
snapback data promote todos.update --format explicit
```

The command preflights current source, verifies the active generated graph is
not stale, prints the deterministic patch and semantic diff, and writes only
after approval. It freezes the current policy, defaults, immutability, owner
assignment, plan/contracts, effects, and failure facts. A changed destination
or resource witness refuses. Familiar v1 cannot express the generated owner
write guard and always points to the explicit command instead.

## Recover from data-resource refusals

Every data-resource refusal is stable and routes to one next action:

| Code | Next action |
| --- | --- |
| `SNAPBACK_DATA_RESOURCE_DECLARATION_INVALID` | Use only the four `.data(...)` keys, call it once, and make it the final table-builder call. |
| `SNAPBACK_DATA_RESOURCE_VISIBILITY_REQUIRED` | Declare owner or public-read visibility, or move the behavior to a named function. |
| `SNAPBACK_DATA_RESOURCE_INELIGIBLE` | Remove the named authority, relation, history, size, or disclosure fact, or use a named function. |
| `SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED` | Name an eligible ordinary index; owner omission works only for one owner-leading candidate. |
| `SNAPBACK_DATA_RESOURCE_SYNC_PER_TABLE_FORBIDDEN` | Remove authored `.sync()` and use application `dataSync: "disabled"` when needed. |
| `SNAPBACK_DATA_OPERATION_NAME_COLLISION` | Rename the authored export or remove `.data()`; generated names never auto-rename. |
| `SNAPBACK_DATA_QUERY_CAPABILITY_UNAVAILABLE` | Use a target with bounded data-read support, enable required sync delivery, or use an ordinary named query supported by the target. |
| `SNAPBACK_DATA_PROMOTION_REFUSED` | Regenerate stale artifacts, preserve the previewed destination, and use explicit format for owner writes. |
| `SNAPBACK_DATA_FUNCTION_RECORD_PARITY_FAILED` | Update the recursive disposition gate for the changed canonical function record before generating. |

## Anti-patterns

- Do not call table-builder methods after `.data(...)`; move every declaration
  before the terminal call.
- Do not use `.sync()` as a data-table switch; use the application policy.
- Do not infer owner visibility from a field name. Declare the table policy.
- Do not hand-copy generated function bytes. Use promotion so stale facts and
  destination changes fail closed.
- Do not decode or edit `dc1.*` values. Treat them as opaque, query- and
  authority-bound continuation tokens.

---

<!-- snapback-guide-source: guide/data/queries.md -->
---
title: Build a bounded data query
id: data.queries
order: 20
audience: agent-first
capabilities: [data.queries-v1]
authorities: [llp/0255-tiny-data-surface-v1-api.spec.md, llp/0004-application-data-api.rfc.md, llp/0065-generated-data-pattern-soundness.rfc.md, llp/0157-composition-algebra-and-completeness.spec.md, packages/snapback-codegen/data-query.mjs, src/local.rs, src/storage.rs]
examples: [tests/fixtures/data-query-a1, packages/snapback-codegen/data-query.test.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.21
unreleased: true
reviewed: 2026-08-13
reviewed-authorities-digest: sha256:8145953a62c742f37c1c220a0a810819644148c632cceb5f4a6a9bceebd0dbc8
---

# Build a bounded data query

> **Unreleased.** Bounded DataQueryV1 construction and local continuation are
> newer than the newest published closure, 0.1.20. Use contributor source until
> a later closure publishes them.

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use the generated fluent builder for a compile-time-known, single-table query
over a `.data()` resource. Codegen extracts each complete chain into the static
`dataQueryCatalog`, resolves it to an exact generated list when possible, and
otherwise emits an ordinary `<resource>.query_<16hex>` function. Runtime values
fill frozen slots; they never change the plan or its authority policy.

## Write one complete static chain

The method order is closed:

```text fragment reason="compact typestate grammar"
resource.using(index)
  [.where(filters)]
  .orderBy(field, direction)
  [.select(fields)]
  .take(limit)
  [.after(cursor)]
```

Index, field, operator, direction, projection, and take choices must be literals
in source. Values inside `where` and the cursor may be runtime values.

```ts source=tests/fixtures/data-query-a1/query.ts
export const ascending = data.todos
  .using('by_owner_bucket_created')
  .orderBy('bucket', 'asc')
  .take(2);
```

`where` accepts 1–8 distinct contiguous index-prefix fields. A scalar means
`eq`; the closed operators are `eq`, `in`, `lt`, `lte`, `gt`, `gte`, and one
lower-plus-upper range. `in` has 1–32 canonically distinct values. Owner policy
is injected before these predicates and cannot be authored or weakened.

An omitted `select` returns every readable authored field plus `_id`,
`_version`, `_createdAt`, and `_updatedAt`. An explicit selection is a
duplicate-free 1–64-field set normalized to schema order. `take` is a literal
safe integer from 1 through 200.

## Continue without changing the query

Construct page one without `after`. If the returned page has a cursor, call
`.after(cursor)` on the same descriptor shape for the next page. The generated
wire arguments preserve the slot names and add `after` as the final optional
key. The cursor is excluded from `canonicalArgsDigest` but included in the
materialization-key arguments, so pages cannot share materialization state.

The local executor seeks strictly after the complete effective index order and
the same-direction `_id` totalizer. Duplicate and null order values are safe.
Owner policy is composed before the seek, so a fabricated but well-typed
boundary can select only a suffix of the caller's own authorized scan.

Treat `dc1.*` as opaque. Malformed, stale-generation, changed-argument,
cross-plan, and cross-authority presentations all return the same
`SNAPBACK_DATA_CURSOR_INVALID` response. A boundary too large to encode within
2,048 bytes refuses `SNAPBACK_DATA_CURSOR_MINT_UNAVAILABLE`; the server never
pretends that page is complete.

## Inspect without reading rows

The generated module exports `explainDataQuery(descriptor)`. Its closed output
names the witness, resource/index, redacted slot templates, policy id/class,
order, projection, take, ceilings, resolution, plan/result identities,
capabilities, authority partition, and materialization owner. It contains no
filter values, cursor plaintext, bearer material, or rows.

```js fragment reason="the generated path and runtime values are application-specific"
import { data, explainDataQuery } from './generated/data.mjs';

const descriptor = data.todos
  .using('by_owner_bucket_created')
  .orderBy('bucket', 'asc')
  .take(2);

console.log(explainDataQuery(descriptor));
```

The same descriptor is accepted byte-for-byte by the
[headless and React/Expo doorways](./doorways.md). Swift currently has golden
fixtures only and deliberately exposes no DataResourceV1 client API.

For query state, `"skip"`, pagination, `read`, `watch`, and `useQuery`, see the
[client lifecycle](./lifecycle.md).

## Refusals and escape hatches

| Code | Next action |
| --- | --- |
| `SNAPBACK_DATA_QUERY_NOT_CATALOGUED` | Make the complete shape static and regenerate, or use a named function. |
| `SNAPBACK_DATA_QUERY_SHAPE_INVALID` | Restore the method order, contiguous index grammar, valid projection, or exact generated plan facts. |
| `SNAPBACK_DATA_QUERY_BOUND_EXCEEDED` | Reduce filters, `in` values, projection, take, candidate work, descriptor bytes, or result bytes; results are never silently truncated. |
| `SNAPBACK_DATA_QUERY_RESOLUTION_AMBIGUOUS` | Remove the duplicate generated candidate; resolution never chooses by order. |
| `SNAPBACK_DATA_QUERY_NAME_COLLISION` | Remove the colliding authored/generated export; the witness prefix is never silently lengthened. |
| `SNAPBACK_DATA_CURSOR_INVALID` | Discard the cursor and request page one again with the same current arguments. |
| `SNAPBACK_DATA_CURSOR_MINT_UNAVAILABLE` | Reduce the encoded order-key size or promote the behavior to a named bounded query. |

Relationship predicates, retention, transactions, and dynamic shape compilers
remain outside DataQueryV1. Use existing named functions/composition rather
than trying to smuggle those powers into a catalogue descriptor.

---

<!-- snapback-guide-source: guide/data/transactions.md -->
---
title: Compose generated data transactions
id: data.transactions
order: 30
audience: agent-first
capabilities: [data.transactions-v1]
authorities: [llp/0255-tiny-data-surface-v1-api.spec.md, llp/0043-offline-replay-retention.rfc.md, llp/0133-local-settlement.spec.md, llp/0218-outbox-settlement-contract.rfc.md, packages/snapback-codegen/data-transaction.mjs, packages/snapback-client/data-client.mjs, packages/snapback-client/index.mjs, src/storage/settlement.rs, src/local.rs]
examples: [packages/snapback-codegen/data-transaction.test.mjs, packages/snapback-client/data-client.test.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.21
unreleased: true
reviewed: 2026-08-14
reviewed-authorities-digest: sha256:2e583728fdd3a9c9afb182e6794fefd3a9b8bcabcc2919f05e0bd4037084ba7e
---

# Compose generated data transactions

> **Unreleased.** Generated data transactions and their headless contributor
> client are newer than the newest published closure, 0.1.20. Use contributor
> source until a later closure publishes the Phase 4 package doorway.

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use **db.tx** to construct inert, exactly typed write chunks and pass all of
them to one **db.transact(...)** call. Constructing a chunk does no I/O and
paints no optimistic state. Dispatch begins only when the complete, statically
catalogued transaction is admitted.

    const handle = db.transact(
      db.tx.todos.create({ title: "Ship Phase 3" }),
      db.tx.todos.update({ id: todoId, title: "Shipped" }),
    );

    const dispatch = await handle.dispatched;
    const settlement = await handle.settled;

The grammar admits 1–16 ordered create, update, and delete chunks emitted for
generated data resources. Arguments must satisfy each chunk's exact generated
contract. Chunk order, resource, operation, and result shape are static;
runtime values fill only generated argument slots. A shape absent from
**semanticInput.dataSurface.transactionCatalog** is refused rather than
compiled dynamically.

One chunk uses that generated mutation's ordinary function reference. Two or
more chunks resolve to one ordinary **data.tx_<16hex>** mutation. Its HostPlan
sequences all writes in one SQLite commit, renames intermediate bindings and
arguments by position, performs post-write reads, and returns a closed
**{ c0, c1, ... }** record that the client projects to the positional result
tuple. There is one optimistic layer and one authoritative settlement: partial
server writes and partial client paint are not states of this API.

## Custody and prediction are separate

Every transaction declares one custody class at generation:

- **queue-eligible** enters durable replay custody and may dispatch later.
- **online-only** is durably recorded but never enters replay ordering. Before
  transport its boundary is **not-crossed**; immediately before the request it
  atomically becomes **possibly-crossed**.

Callers cannot override this with queue, and the data doorway strips operation
issuance. Every data write requires a durable client store and a target
advertising **offline_mutation_replay**.
**SNAPBACK_DATA_CUSTODY_UNAVAILABLE** distinguishes the next action: configure
or repair the durable store, or choose a target with the settlement ledger
capability.

After a connectivity loss, a possibly-crossed intent reports:

    {
      "status": "pending",
      "blockedReason": "outcome-unknown"
    }

It is never redelivered. **refreshSettlement()** polls the server's bounded
settlement ledger using the original intentId (which is byte-for-byte the
clientMutationId). Both a commit and a server refusal become durable,
ACK-capable terminal rows. A crash before the boundary proves non-acceptance.

Generated-exact prediction may be available for either custody class. All
chunks compose or the entire prediction is withheld; reconciliation uses the
settlement mint claims and then rebases later layers. Prediction being
unavailable does not weaken custody, and online-only custody does not forbid
an exact local prediction.

## Observe and recover

**DataTransactionHandleV1** keeps independent presentation, custody, dispatch,
settlement, and observation axes. subscribe is notify-only: read the current
value with snapshot(). dispose() stops observation but never cancels durable
custody. **db.transaction(intentId)** recovers the same lifecycle from the
canonical mutation-status owner after reload.

**DataQueryStateV1.pendingWrites** is a payload-free intersection between the
query materialization's tables and unresolved transaction reach. Entries
contain only intentId, state, and presentation, ordered first by durable outbox
sequence and then by intent id. Arguments and row values are never projected.

## Refusals and ceilings

| Code | Next action |
| --- | --- |
| SNAPBACK_DATA_TRANSACTION_INVALID | Restore generated chunks, exact contracts, binding identity, or the closed composition grammar. |
| SNAPBACK_DATA_TRANSACTION_NOT_CATALOGUED | Make the whole ordered shape static and regenerate, or use a named mutation. |
| SNAPBACK_DATA_TRANSACTION_BOUND_EXCEEDED | Reduce the first reported dimension: chunks, resources, reads/writes, descriptor/result/durable bytes, or generated HostPlan size/steps. |
| SNAPBACK_DATA_CUSTODY_UNAVAILABLE | Follow the diagnostic's split next action for local durable storage or target settlement capability. |

The public package and framework-specific imports are listed in
[choose a data doorway](./doorways.md). Relationship nodes, retained queries,
and dynamic transaction shapes remain outside this surface.

## Anti-patterns

- Do not await `db.transact(...)` as though dispatch were settlement. Observe
  `handle.dispatched` and `handle.settled` separately.
- Do not recreate an outbox, optimistic reducer, or settlement registry around
  the data facade. The existing client owns all three.
- Do not dynamically assemble a transaction shape. Generate the exact static
  composition or use a named mutation.

---

<!-- snapback-guide-source: guide/data/doorways.md -->
---
title: Choose the tiny data doorway
id: data.doorways
order: 40
audience: agent-first
capabilities: [data.doorways-v1]
authorities: [llp/0255-tiny-data-surface-v1-api.spec.md, llp/0012-headless-integration-contract.spec.md, llp/0064-native-client-surfaces.rfc.md, packages/snapback-client/data-client.mjs, packages/snapback-react/data.mjs, packages/snapback-umbrella/package.json, packages/snapback-expo/package.json]
examples: [tests/fixtures/data-surface-a1, tests/acceptance/data-surface-a1-v1.mjs, packages/snapback-react/data.test.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.21
unreleased: true
reviewed: 2026-08-14
reviewed-authorities-digest: sha256:7a5261926cfacd1fa74bb9395e98f758d3134fb706fced1e342789fd25566c25
---

# Choose the tiny data doorway

> **Unreleased.** The experimental tiny-data package doorways are newer than
> the newest published closure, 0.1.20. Use contributor source until a later
> qualified closure publishes them.

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Generate first. The generated `data.mjs` carries descriptors, transaction
chunks, catalogues, and the binding identity. The doorway supplies no second
transport, cache, auth coordinator, outbox, policy evaluator, settlement
registry, or diagnostic type; it delegates those jobs to the existing client.

## Use the headless doorway

Import from the umbrella package's exact experimental subpath and bind the
generated data projection to an existing Snapback client:

```js source=tests/fixtures/data-surface-a1/snapback/app.mjs
import { createDataClient } from '@expo/snapback/data';
import { db as reactDb } from '@expo/snapback/react/data';
import { db as expoDb } from '@expo/snapback-expo/data';
import { data } from './generated/data.mjs';

// @ref LLP 0255#s9-package-doorway-and-generated-typing
export const createA1Database = (client) => createDataClient({ client, data });
export const reactAndExpoShareDoorway = reactDb === expoDb;
```

The direct client package also exposes
`@expo/snapback-client/data`. `createDataClient({ client, data })` is the
imperative doorway for `read`, `watch`, `explain`, `tx`, `transact`, and
`transaction(intentId)`.

## Use the provider-bound React or Expo doorway

Import only `db` from `@expo/snapback/react/data`. Expo reexports the identical
runtime value from `@expo/snapback-expo/data`; the umbrella package also offers
`@expo/snapback/react/data`. Generated `data.d.ts` augments the React binding,
so resource names, descriptors, transaction chunks, and results retain exact
application types.

`db` must be used below the ordinary `SnapbackProvider` carrying the generated
app binding. Missing or stale data binding refuses
`SNAPBACK_DATA_BINDING_REQUIRED` and tells you to run normal generation and
install that binding. There is deliberately no exported `useQuery`; the hook
spelling is `db.useQuery(descriptor)` so one generated root owns the surface.
Because `db` is provider-bound, obtain its methods during a React render.
Invoke `read`, `watch`, and transaction methods from that captured binding in
an effect or event handler; use the headless doorway in modules and workers.

## Keep Experimental separate from default

These subpaths are additive, Experimental, and non-default. Do not reexport
them from existing package roots, label them recommended, or add compatibility
promises. LLP 0256's evaluation scaffold lives at
[`benchmarks/tiny-data-surface/v1`](repo:benchmarks/tiny-data-surface/v1/README.md);
it is not an application starter and must not be used for a timed lane until
its publication clock and run gates are armed.

## Anti-patterns

- Do not import or invent a standalone `useQuery` for this surface. Use
  `db.useQuery` under the provider.
- Do not construct a data client without generated `data`; regenerate and
  install the generated app binding.
- Do not add a transport, cache, outbox, auth context, or policy layer to make
  the facade feel self-contained. Those are canonical client/runtime owners.
- Do not expose a public Swift API from the Phase 0 goldens.

---

<!-- snapback-guide-source: guide/data/lifecycle.md -->
---
title: Read, watch, and settle tiny data
id: data.lifecycle
order: 50
audience: agent-first
capabilities: [data.lifecycle-v1]
authorities: [llp/0255-tiny-data-surface-v1-api.spec.md, llp/0043-offline-replay-retention.rfc.md, llp/0133-local-settlement.spec.md, llp/0218-outbox-settlement-contract.rfc.md, packages/snapback-client/data-client.mjs, packages/snapback-react/data.mjs]
examples: [tests/fixtures/data-surface-a1, tests/acceptance/data-surface-a1-v1.mjs, packages/snapback-client/data-client.test.mjs, packages/snapback-react/data.test.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.21
unreleased: true
reviewed: 2026-08-14
reviewed-authorities-digest: sha256:7b6ec20435fc4b96477248b9cf126b9c6654dee7dea84b2907c54e45dc00659f
---

# Read, watch, and settle tiny data

> **Unreleased.** The experimental tiny-data lifecycle is newer than the
> newest published closure, 0.1.20. Use contributor source until a later
> qualified closure publishes it.

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Construct a generated descriptor once, then choose one delivery method. The
descriptor, authority policy, cursor, bounds, and result contract are the same
across headless and React; delivery does not create a new query language.

## Read one bounded page

`await db.read(descriptor)` returns `DataPageV1`: frozen `rows`, an opaque
`cursor | null`, and `complete`. Build the next-page descriptor by passing the
cursor to the same generated static query shape. `read` does not subscribe or
retain a cache owner.

## Watch without inventing polling

`db.watch(descriptor)` returns the canonical notify-only handle:
`snapshot()`, `subscribe(listener)`, `refresh()`, and `dispose()`. It delegates
to the existing streaming `liveQuery` owner and never persists its own resume
state. `refresh()` asks that owner for fresh authority data; `dispose()` ends
observation, not transaction custody.

The snapshot is the full `DataQueryStateV1` union intersected with
`pendingWrites`. It distinguishes `pending`, `ready`, `refreshing`, `blocked`,
and `error`; `db.useQuery("skip")` adds the stable `skipped` arm. Every state
also names connection, freshness, retention, and a payload-free ordered list
of relevant unresolved intents.

## Render with `db.useQuery`

Under `SnapbackProvider`, call `db.useQuery(descriptor)`. Pass the literal
`"skip"` to suppress materialization; the returned stable skipped state is:

```json fragment reason="the exact row type is application-specific"
{
  "status": "skipped",
  "connection": "idle",
  "freshness": "unknown",
  "retention": null,
  "pendingWrites": []
}
```

Skip owns no subscription and causes no query I/O. Do not switch to a sentinel
descriptor or conditional hook call.

## Explain or escape after a refusal

`db.explain(descriptor)` returns the generated redacted explain record without
reading rows. `read` refuses absent target read capability; `watch` and
`useQuery` additionally refuse sync-disabled or unretained shapes. Follow the
diagnostic's single next action: enable the required app/target capability,
choose `read` when live materialization is unnecessary, or promote the shape
to a named bounded function. Cloudflare and Expo-store write paths remain
deliberate refusals.

## Settle and recover a write

`db.transact(...chunks)` starts the existing Phase 3 machinery. Observe
`dispatched` separately from `settled`, and use `db.transaction(intentId)` to
recover after reload. Query `pendingWrites` contains intent identity and state,
never argument or row payloads. See [transactions](./transactions.md) for the
closed grammar and custody ceilings.

## Anti-patterns

- Do not treat a prediction, custody acceptance, or dispatch as committed
  settlement.
- Do not poll around `watch`; use its stream and `refresh()` escape.
- Do not read or rewrite opaque cursors.
- Do not render retained protected data after an authority boundary; follow
  the canonical client invalidation owner.
