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
