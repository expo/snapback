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
reviewed: 2026-08-13
reviewed-authorities-digest: sha256:8145953a62c742f37c1c220a0a810819644148c632cceb5f4a6a9bceebd0dbc8
---

# Build a bounded data query

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
