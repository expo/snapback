---
title: Portable exact vector search
id: backend.vector-search
order: 29
audience: agent-first
capabilities: [backend.vector-search]
authorities: [llp/0132-vector-search.spec.md, crates/snapback-types/src/vector/types.rs, crates/snapback-kernel/src/vector/query.rs, crates/snapback-kernel/src/vector/sqlite.rs, crates/snapback-engine/src/manifest.rs, packages/snapback-codegen/define.mjs, packages/snapback-client/index.mjs]
examples: [packages/snapback-codegen/vector-authoring.test.mjs, packages/snapback-client/package.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:39af92584e57debdcb2baa5c38f3f7b19dac6a588f5fefec6e5ba8d7e77d1dcd
---

# Portable exact vector search

> **Local target only.** Exact vector search requires the experimental
> `vector_search_v1` capability and an explicit experimental-capability
> acknowledgment. The local SQLite target reports the complete arithmetic,
> bounds, visibility, storage, and corruption facts. Hosted targets,
> PostgreSQL, ANN, live and offline search, and embedding computation are not
> claimed.

Use a vector index when an application already has fixed-width embeddings and
needs deterministic nearest-neighbor retrieval inside Snapback's ordinary
query snapshot. The v1 host plan performs a bounded exact scan; it never calls
an embedding model and never substitutes an approximate index.

## Declare a vector field and index

`v.vector(dimensions)` is distinct from an ordinary array, admits 1 through
4,096 binary64 components, canonicalizes negative zero to positive zero, and
rejects non-finite values or components outside ±2^100. A vector index binds
the field, dimensions, metric, classifications, visibility, filters, stored
fields, tie direction, and corpus ceiling into one semantic version.

```js source=packages/snapback-codegen/vector-authoring.test.mjs
  const documents = defineTable({
    embedding: v.vector(3),
    category: v.optional(v.string()),
    title: v.string(),
  }).vectorIndex('by_embedding', {
    semanticVersion: 'documents.embedding.v1',
    vectorField: 'embedding',
    metric: 'l2sq',
    fieldClassifications: {
      embedding: 'public',
      category: 'public',
      title: 'public',
    },
    equalityFilters: ['category'],
    storedFields: ['title'],
    visibility: { kind: 'public-read' },
    tieBreak: 'id-asc',
    maxIndexedVectorsPerPartition: 128,
  });
  defineSchema({ documents });
```

Use `visibility: { kind: 'owner', field: 'ownerId' }` for owner-private
retrieval. Snapback derives the effective principal on the server, pushes it
into the posting partition, and rechecks the authoritative source row before
release. Visibility is required: omission refuses generation with
`SNAPBACK_VECTOR_INDEX_VISIBILITY_REQUIRED`, so `public-read` is always an
affirmative declaration. `public-read` permits only public participating fields. Owner indexes
may use private fields, but every participating role rejects `sensitive` and
`forbidden`; membership-derived visibility is not a v1 shape.

Declare the ordinary query with
`defineVectorQuery({ table: documents, index: 'by_embedding' })`. Generated
argument types fix the vector dimension and the closed equality-filter field
set. Generated result types expose only `{ rowId, distance, fields }`, with
`fields` closed over the index's `storedFields`; there is no cursor.

## Retrieve nearest rows

Call `vectorSearch` with the generated operation reference. `k` defaults to 10
and is bounded to 64. Filters are exact scalar equality predicates, each
declared field may occur once, and at most eight filters are admitted.

```js source=packages/snapback-client/package.test.mjs
    const page = await vectorClient.vectorSearch(vectorRef, {
      vector: [1, -0, 3],
      filters: [{ field: 'category', op: 'eq', value: true }],
    });
```

A filter `value` may be any string, finite real, or boolean — that closed
union is the whole admitted contract, per filter field, regardless of the
stored field's declared type. Equality is exact and typed, so a value whose
type does not match the stored field (the test fixture above filters the
string field `category` with `true`) is admitted by the contract but matches
no rows; it is not a validation error. Match the stored field's type when you
intend the filter to select anything.

`l2sq` ranks ascending squared Euclidean distance; `dot` ranks descending dot
product. Both use `snapback-vector-distance-v1`: strict sequential binary64
arithmetic with round-to-nearest-ties-even, gradual underflow, and no FMA,
reassociation, extended intermediates, or reduction reordering. Equal distance
bits resolve by the declared canonical row-id direction. Distance is
informational and must not become an authorization, moderation, pricing, or
other correctness input.

For cosine-like ranking, normalize nonzero stored and query embeddings in the
same application-owned producer and declare `dot`. That gives portable dot
ranking over the admitted components; it does not add a `cosine` metric or make
Snapback an embedding producer.

## Stay inside the exact-work envelope

Generation requires
`dimensions × maxIndexedVectorsPerPartition ≤ 2^26`, with an absolute corpus
ceiling of 65,536 vectors per visibility partition. Source mutations maintain
the active shadow generation synchronously in the same SQLite transaction.
An insert or ownership transfer into a full destination refuses atomically;
maintenance failure rolls back the source mutation too.

- `SNAPBACK_VECTOR_VALUE_INVALID`: an authored or stored vector violates the
  dimension/component contract.
- `SNAPBACK_VECTOR_QUERY_INVALID`: the invocation vector, `k`, or filter set
  violates its generated contract.
- `SNAPBACK_VECTOR_CORPUS_BOUND`: a destination partition would exceed its
  declared bound.
- `SNAPBACK_VECTOR_MAINTENANCE_LIMIT`: one mutation exceeds the aggregate
  1,024-posting or 4 MiB vector-byte ceiling.
- `SNAPBACK_VECTOR_WORK_LIMIT`: derived state exceeded the declaration-proved
  exact-scan envelope; no partial result is released.
- `SNAPBACK_VECTOR_INDEX_UNAVAILABLE`: activation or a verified rebuild is
  still required.
- `SNAPBACK_VECTOR_INDEX_CORRUPT`: a digest, posting, frontier, or release
  recheck failed; the exact generation is quarantined.

## Anti-patterns

- Do not store embeddings in JSON and scan them in a JavaScript handler; that
  bypasses the vector value, authorization partition, work bounds, and facts.
- Do not treat `vector_search_v1` as ANN. Its advertised accelerator is
  exactly `none`; a future approximate profile needs a separate capability and
  recall evidence.
- Do not subscribe to a vector query, paginate it, retain it offline, or infer
  a hosted/PostgreSQL claim from the local SQLite implementation.
- Do not log query-vector components. They are custody-bearing caller content;
  telemetry records only bounded shape and digest facts.
