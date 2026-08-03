# Wave-1 remainder: implement LLP 0132 — portable vector search

**Status:** Closed — implemented 2026-08-03
**Systems:** Search, Storage, Runtime, API
**Related:** LLP 0132 (Accepted 2026-07-31; Implemented for the experimental
local target 2026-08-03)

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

### 2026-08-03 — VEC-4 local exact profile shipped and independently qualified

- Completed the runtime publication seam for exact `dot`/`l2sq` search over
  the active SQLite generation, including public/owner release, equality
  filters, stored fields, pinned ordering, logical-work counters, and the
  items-only client page. The local manifest now publishes the closed
  `VectorSearchFactsV1`; remote-service and Cloudflare projections remain
  support-false with structured GAPs.
- Closed the spec's validation obligations: Rust and independent JavaScript
  arithmetic/conversion witnesses agree; dimension/component/k/product/
  corpus/mutation/query ceilings refuse under stable codes; paired-owner,
  commit-head, atomic-failure, corruption/quarantine, transfer, rebuild, and
  generated-projection suites pass. The capability enum and local target facts
  agree with the generated/client/provider surface.
- Retained both required realistic-scale receipts at D=1,536 × 43,690:
  `tests/acceptance/vector-search-sqlite-scale.v1.json` on macOS/aarch64 and
  `tests/acceptance/vector-search-single-instance-container-vm-scale.v1.json`
  on Linux/x86_64 inside Fly Machine `849764f2e7dd58`. The independent run
  passed all four semantic checks and the exact filled/next-refused boundary
  in 419.73 seconds, with 1,931,902,976-byte peak RSS and a 4,953 ms query.
  The temporary two-shared-CPU / 4,096 MiB shape was restored immediately to
  the normal shared-cpu-1x / 512 MiB service shape.
- Flipped the A5 capability row to shipped for local only and added the
  intent-indexed vector guide page. LLP 0132 is now Implemented with a dated
  implementation record; LLP 0115's OQ7/product-breadth execution fact records
  the exact-base landing without inventing a CV board item.
- ANN remains deliberately closed: no accelerator or approximate capability is
  registered, and hosted/Postgres/live/embedding-computation remain explicit
  nonclaims. LLP 0136 remains held. LLP 0135's ticket already contains the
  required held-half note and is otherwise untouched.
- Qualification carrier friction is recorded in Diary 0018 and
  `issues/20260803-linux-hermes-release-carrier-gap.md`. The exact current
  Hermes bundle had to be rebuilt from vendored source, and Fly's source
  builder could not complete the release optimization; the deployed fallback
  verifies the clean product revision and every staged checksum.
- Own correctness is green: 59 focused vector Rust tests pass with the one
  scale test intentionally ignored in ordinary runs, all four capability
  projection tests pass, the independent JavaScript distance reference passes,
  strict all-target Clippy passes with only the separately owned named
  sequence-lane allowance, and both scale receipts pass. The isolated
  `artifact_schemas_v0` result was 29/32 solely because three generated demo
  publications were absent; that end-wave regen residue is recorded in the
  greening ticket under the shared relaxed-cadence policy.

### 2026-08-03 — VEC-3 SQLite maintenance and resumable rebuild checkpoint

- Added ordinary SQLite shadow generations, canonical vector BLOBs and JCS
  content identities, CAS frontiers/tombstones, verified generation roots, and
  exact-generation quarantine handoff.
- Centralized synchronous vector maintenance in every source mutation path.
  One mutation-global 1,024-effect / 4 MiB preflight and final corpus-occupancy
  check complete before derived writes, so maintenance, budget, and ownership
  transfer refusal roll source plus all derived state back together.
- Kept schema install metadata-only; it stages pending generations without a
  source scan or eager activation.
- Added approved `derived-vector-catchup.v1`: audience/plan/approval binding,
  operation-owned fixed snapshot, exact journal-floor lease, resumable bounded
  baseline and complete-commit catch-up, authoritative verification, atomic
  generation switch, retained predecessor, and first-successor-commit rollback
  invalidation.
- Added focused evidence for restart, concurrent catch-up, plan/approval
  collision, missing/tampered lease and pruned-floor quarantine, verified
  switch, rollback boundary, cross-index budget, full destination transfer,
  CAS replay/divergence/tombstones, authoritative release drift, and historical
  quarantine not wedging a successor.

This checkpoint keeps the ticket open. It makes no target support/facts claim,
does not flip the Guide GAP, and does not supply the realistic-scale or
cross-target qualification corpus; runtime publication and qualification stay
with later lanes.

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
  authored `SNAPBACK_VECTOR_INDEX_INVALID` /
  `SNAPBACK_VECTOR_QUERY_PLAN_INVALID` artifacts plus request/value/maintenance
  admission are 400, corpus-state conflict is 409, index readiness is 503, and
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
