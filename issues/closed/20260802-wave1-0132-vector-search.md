# Wave-1 remainder: implement LLP 0132 — portable vector search

**Status:** Closed
**Systems:** Search, Storage, Runtime, API
**Related:** LLP 0132

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

## Resolution — 2026-08-02

Implemented and closed on the local SQLite/Ibex target at experimental
maturity. The landing adds `v.vector(dimensions)`, declared vector indexes,
the closed `VectorQuery` plan, generated result/argument carriers,
`SnapbackClient.vectorSearch`, synchronous transactional posting maintenance,
public and owner partitions, fixed-order exact `l2sq`/`dot` ranking, stable
bounded diagnostics, generation/source/digest rechecks, and quarantine on
corruption. `TargetCapabilityId::VectorSearchV1` is registered through LLP
0134's single maturity authority; no parallel maturity list was introduced.

Acceptance covers the Research Room-shaped 32-dimensional fixture end to end,
Rust/JavaScript binary64 conversion and arithmetic witnesses, declaration and
carrier agreement, authorization/work noninterference, mutation and transfer
freshness, corpus/maintenance rollback, activation/classification refusal, and
tamper quarantine. The preregistered scale gate is retained at
`tests/acceptance/vector/realistic-scale-budget-v1.json`: 1,536 dimensions ×
43,690 vectors, 67,107,840 scalar pairs, k=64, all latency/RSS budgets green,
the filled boundary admitted, and N+1 refused atomically.

The Guide's `backend.vector-search` GAP row is now a witnessed local/partial
row and links the new local-only page. LLP 0132 carries the dated
implementation record; LLP 0115 carries the administrative PB-8 completion
row outside its parity tranches.

Nothing in the v1 claim is stubbed. Deliberate nonclaims remain hosted and
PostgreSQL targets, ANN/approximate search or accelerators, embedding
computation, hybrid/cosine/range/membership search, live or offline queries,
and pagination. LLP 0132's four open questions remain underdetermined by the
commission: whether to add a cosine metric id, what evidence opens an ANN
door, whether to design a live profile, and whether qualification data should
retune the ceilings. None blocks the bounded exact local v1 capability.
