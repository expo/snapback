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
