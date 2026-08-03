# Wave-1 remainder: implement LLP 0132 — portable vector search

**Status:** Open
**Systems:** Search, Storage, Runtime, API
**Related:** LLP 0132 (Accepted 2026-07-31, unimplemented — the A5 sweep arm
records it as an honest GAP with an Accepted design)

Implement `vector_search_v1` per the spec: exact k-NN over app-supplied
embeddings — declared vector fields, pinned `dot`/`l2sq` distance profiles
with per-target float conversion witnesses, bounded corpus/k/dimension
ceilings, and the named ANN successor door left closed (exact-only in v1).

This closes the Supabase/pgvector-shaped breadth gap at the honesty level
the capability index needs: the A5 arm's GAP row flips only when the whole
contract ships (declaration, bounds, witnesses, capability fact).

**Exit:** the spec's validation obligations as tests (distance-profile
conformance across targets, ceiling refusals with stable diagnostics);
capability id registered in the manifest enum; the A5 GAP row flipped;
dated implementation-record amendment on the LLP; LLP 0115 board row
updated.

## Running log

### 2026-08-02 — VEC-2 static carrier and authoring checkpoint

- Added the closed vector field/value, index, plan, request/item/items-only
  page, and future target-facts carriers, with Rust-owned schema exports.
- Added `v.vector(D)`, `vectorIndex`, and `defineVectorQuery` authoring plus
  generated exact argument/result types, Contract/provider projection, and
  the public client `vectorSearch` projection.
- Kept work and maintenance authority closed: scalar pairs are derived,
  maintenance limits reuse VEC-1's mutation-global authority, equality-filter
  fields are exact per operation, duplicate/unknown/null filters refuse, and
  stored vectors are excluded.
- Registered `vector_search_v1` as experimental while holding support false,
  facts absent, and a structured GAP on every current target. Direct SQLite
  schema lowering is non-panicking, but vector writes and execution remain
  unsupported.
- Added exact-D/component-domain, D−1/D+1, ordinary-array non-widening,
  vector-node-budget, forged-manifest, provider-byte, client-page, and
  no-panic storage refusal evidence.
- Classified every public vector diagnostic in the production HTTP inventory:
  authored index/query-plan artifacts plus request/value/maintenance admission
  are 400, corpus-state conflict is 409, index readiness is 503, and
  corruption/maintenance/work-drift invariants are 500. Retry waits for the
  named state/readiness change; no unchanged 400 or blind 500 retry is implied.

This does not satisfy the ticket exit or flip the guide row. Database adapter
integration, derived-index maintenance, the exact executor, corpus and
cross-target qualification, and capability publication remain open.

Per the wave artifact policy, the shared package-test inventory is left for
end-wave greening. Both `vector-distance-profile.test.mjs` and
`vector-authoring.test.mjs` run directly in this checkpoint; the inventory
checker is expected to report those two otherwise-maintained suites as
unregistered until that batched reconciliation.

### 2026-08-02 — VEC-1 transaction-neutral storage primitives

Added canonical little-endian binary64 storage bytes, admitted-vector JCS
digests, mutation-global maintenance accounting, retained source-frontier
CAS/tombstone classification, and stable write-side diagnostic identities.
These are reusable primitives only: they register no database adapter,
executor, invocation surface, or target support claim.

### 2026-08-02 — VEC-0 numeric authority, deliberately unpublished

The first collision-safe checkpoint commits the Rust-owned
`snapback-vector-distance-v1` profile and `nearest-first-row-id.v1` ordering
identity, its generated schema/instance and pinned JCS payload digest, and an
independent BigInt rational/dyadic reference derivation consumed by Rust and
JavaScript tests. The corpus covers the five named divergence classes per
metric, including an explicit direct-vs-round-to-20 decimal double-rounding
witness, plus subnormals, ±2^100 and the next representable outside value,
negative zero, and bit-equal tie directions.

This checkpoint does not register `vector_search_v1` and changes no field,
manifest, storage, runtime, client, target, or capability-support fact. The
ticket remains open for the complete Accepted LLP 0132 implementation and
target evidence; the A5 Guide row remains a design-only GAP.
