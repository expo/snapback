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
reviewed-authorities-digest: sha256:37c0280381a45d234c60d459e3a89e945a5cbf52384cdf2a49547a1ea5f35421
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
`todos.update`, and `todos.delete`.

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
reviewed-authorities-digest: sha256:2c2f38a707561dabc68db9a152410259fa3bad95b2d50d616242d099c9e1c033
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

Phase 2 ships headless descriptor construction, catalogue admission, the
ordinary function carrier, and local continuation. React/Expo/Swift facade
doorways are Phase 4 and are not implied by the generated `data` export.

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
