---
title: Portable exact vector search
id: backend.vector-search
order: 28
audience: agent-first
capabilities: [backend.vector-search]
authorities: [llp/0132-vector-search.spec.md, src/vector/types.rs, src/vector/sqlite.rs, packages/snapback-codegen/define.mjs, packages/snapback-client/vector-search.mjs]
examples: [packages/snapback-codegen/vector-result-contracts.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-02
reviewed-commit: HEAD
---

# Portable exact vector search

<!-- @ref LLP 0132#capabilities-targets-and-staging — local-only experimental
publication and the exact-only nonclaim boundary are part of the contract. -->

> **Local target only.** This page describes the experimental
> `vector_search_v1` capability on `local-dev-sqlite-ibex`. Hosted targets do
> not advertise it. The profile is exhaustive exact k-NN; no ANN or
> approximate accelerator is hidden behind this API.

Use a vector index for server-side similarity ranking over embeddings your
application already supplies. Snapback fixes the binary64 conversion,
arithmetic order, visibility partition, work ceilings, and tie-break so the
same admitted rows produce the same ordered result on every claimed target.
It does not create embeddings.

## Declare the vector and index

Declare a fixed-size `v.vector(dimensions)` field, then name one vector index.
Every vector, equality-filter, stored, and owner field participating in the
index must appear exactly once in `fieldClassifications`. Public indexes admit
only `public` fields. Owner indexes may use `private` fields and always resolve
the effective principal on the server.

```js source=packages/snapback-codegen/vector-result-contracts.test.mjs
export const papers = defineTable({
  ownerId: v.principal(),
  category: v.string(),
  title: v.string(),
  embedding: v.vector(3),
}).vectorIndex('by_embedding', {
  semanticVersion: 'research-room.embedding.v1',
  vectorField: 'embedding',
  metric: 'l2sq',
  fieldClassifications: {
    embedding: 'private',
    category: 'private',
    title: 'private',
  },
  equalityFilters: ['category'],
  storedFields: ['title'],
  visibility: { kind: 'owner', field: 'ownerId' },
  tieBreak: 'id-asc',
  maxIndexedVectorsPerPartition: 64,
});

export default defineSchema({ papers });
```

The required semantic version changes whenever index meaning changes.
`maxIndexedVectorsPerPartition` must be at most 65,536 and must also satisfy
`dimensions × maxIndexedVectorsPerPartition ≤ 2^26`. Dimensions are in
1..4,096. Components must be finite, normalize negative zero to positive
zero, and have absolute value at most `2^100`.

Choose `l2sq` for squared Euclidean distance or `dot` for dot-product ranking.
For cosine-like ranking, normalize stored and query vectors consistently in
the application and use `dot`; the profile does not claim a `cosine` metric.

## Export and call the exact query

Export one ordinary query for the declared index. Vector queries are
one-shot snapshot reads, never live queries.

```js source=packages/snapback-codegen/vector-result-contracts.test.mjs
export const nearestPapers = defineVectorQuery({
  table: papers,
  index: 'by_embedding',
});
```

Call the generated reference with exactly the declared number of components,
optional `k` in 1..64, and at most eight distinct declared equality filters.
The client returns one cursor-free page ordered nearest first and then by the
declared row-id direction. `fields` contains exactly the declared stored
fields.

```js source=packages/snapback-client/package.test.mjs
    const page = await vectorClient.vectorSearch(vectorRef, {
      vector: [-0, 0.5],
      filters: [{ field: 'category', op: 'eq', value: 'systems' }],
    });
    assert.deepEqual(page, {
      items: [{ rowId: 'paper-a', distance: 0.5, fields: { title: 'Portable indexes' } }],
    });
```

## Stay within the closed bounds

The public diagnostic set is intentionally small:

- `SNAPBACK_VECTOR_QUERY_INVALID` rejects malformed vectors, dimensions, k,
  filters, or values before storage work.
- `SNAPBACK_VECTOR_VALUE_INVALID` rejects an invalid stored vector.
- `SNAPBACK_VECTOR_CORPUS_BOUND` atomically rejects an insert or partition
  transfer beyond the declared corpus ceiling.
- `SNAPBACK_VECTOR_WORK_LIMIT` refuses when the fixed exact-query or
  synchronous-maintenance budget would be exceeded; no partial page or source
  write is released.
- `SNAPBACK_VECTOR_INDEX_UNAVAILABLE` means the target, profile, declaration,
  or active generation is unavailable.
- `SNAPBACK_VECTOR_INDEX_CORRUPT` means manifest, generation, posting, or
  source recheck evidence disagreed. The index is quarantined and source rows
  remain authoritative.

Index maintenance is synchronous with source writes. The default per-mutation
ceilings are 1,024 posting effects and 4 MiB of vector bytes. Do not retry a
bounded refusal as though it were transient; change the declaration or data
shape deliberately.

## Anti-patterns

- Do not scan ordinary rows in a JavaScript handler and call that
  `vector_search_v1`; it bypasses the profile, work, custody, and corruption
  evidence.
- Do not advertise ANN, approximate recall, hosted support, pagination,
  subscription, offline search, membership visibility, or embedding
  generation through this capability.
- Do not store unnormalized vectors and describe `dot` as cosine similarity.
- Do not use distance as an authorization or policy decision. Authorization
  selects the candidate partition before ranking.
