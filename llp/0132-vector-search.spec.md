# LLP 0132: Portable vector search

**Type:** Spec
**Status:** Draft
**Systems:** Search, Storage, Schema, Code generation, Auth, Client integration, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:**
**Related:** LLP 0004, LLP 0007, LLP 0019, LLP 0037, LLP 0044, LLP 0046, LLP 0058, LLP 0065, LLP 0073, LLP 0074, LLP 0080, LLP 0081, LLP 0102, LLP 0113, LLP 0115, LLP 0124, LLP 0127, LLP 0130, Diary 0031

## Summary

This Spec is the owning design document for Snapback vector search — the
capability whose absence LLP 0124 recorded as "no owner at all," answering
LLP 0019's open question 5. It stands beside LLP 0073, which remains the
full-text-search owner; nothing here alters `full_text_search_v1`.

The direction is decided, not proposed. LLP 0115 open question 7 (0127
decision 8) fixed it: the vector design lives in a new owned Spec beside
LLP 0073, copies 0073's staged-admission pattern, and claims **exact k-NN
as the base profile first**, with ANN admitted later as a separate
capability with proved-superset translation. This Spec executes that
decision and adjudicates what it left open, including the float-pinning
rider (0124 OQ3): portable exactness is achieved by pinning the
arithmetic, not by quantizing it or scoping the claim down.

`vector_search_v1` is a bounded exact nearest-neighbor scan over admitted
candidate sets: application-supplied fixed-dimension vectors, declared
beside ordinary schema, maintained synchronously, scanned exhaustively
within the caller's visibility partition inside one ordinary read
snapshot, and released only through the generated authorization recheck.
Ranks and distances are deterministic and pinnable in fixtures on every
conforming target. Embeddings arrive from outside; the platform never
computes them in v1 (LLP 0124 V2's boundary, LLP 0019's sequencing).

Review path: commissioned under LLP 0074's umbrella (LLP 0115
§Sequencing 1 carve-out). On dual-family READY convergence with zero
unresolved MATERIAL concerns, within this decided scope, weakening no
evidence boundary, acceptance runs under LLP 0130 SD-4.

## Commission and decided direction

Decision 8 (LLP 0115 open question 7, v0.6/v0.7; 0127 §Sequencing 4)
binds this Spec to: a new owned Spec beside LLP 0073, filling 0073's
"vectors ... are separate named capabilities" admission slot; 0073's
staged-admission pattern copied — version-bound artifact profiles, an
honest capability id with explicit target nonclaims, fail-closed
digests, per-target executable evidence before any claim; exact k-NN
as the base profile, ANN later as a separate capability with
proved-superset translation (0073's accelerator precedent); and the
float-pinning rider decided *here*, because the FTS integer-scoring
precedent does not transfer (§Distance profile is that answer).

Beyond the commission, this Spec decides: the candidate-to-release
consistency model (snapshot participation, pre-authorization filter
timing, leakage posture — 0124 OQ8), filtered k-NN in the minimum
profile (0124 OQ9's first half; hybrid ranking excluded), the vector
value and index contract, bounds, and acceptance.

## Vector values and declarations

### The `v.vector(dimensions)` value

A vector is a fixed-length array of IEEE 754 binary64 components with
declared dimensionality 1–4096. Admission validates, at write time, in
the writing transaction:

- exact declared length;
- every component finite (NaN and ±Infinity refuse with
  `SNAPBACK_VECTOR_VALUE_INVALID`, rolling back the source mutation);
- every component magnitude at most 2^100 (the bound that makes every
  v1 distance provably finite — see §Distance profile); and
- negative zero canonicalized to positive zero, because RFC 8785 spells
  both as `0` and LLP 0073's Diary 0039 lesson is that representation
  divergence between admission and reload is a corruption trap. The
  canonical component spelling is the RFC 8785 / LLP 0080 shortest
  round-trip form; binary64 survives the SQLite REAL round trip
  exactly, so the integral-Real hazard 0073 repaired cannot recur here.

The type contract is specified by this Spec as the vector owner; its
schema-vocabulary landing (`v.vector(dims)` beside `v.number()` et al.)
and one-physical-mapping-per-engine storage mapping are executed as
LLP 0004/0007/0037 amendments citing this section, per LLP 0019 F7's
recommendation and LLP 0007's frame.

### Index declarations

Application source declares `table.vectorIndex(name, spec)` with:

- a stable index name and schema version;
- one ordinary source table with a stable row identity;
- exactly one `v.vector(dimensions)` source field with a declared
  field classification (`public` or `private`; `sensitive` and
  `forbidden` vector fields are rejected from v1 indexing — an
  embedding is derived from content and inherits its custody);
- `metric`: exactly `l2sq` (squared Euclidean distance) or `dot`
  (inner-product similarity) — see §Distance profile;
- at most 8 equality-filter fields from LLP 0073's closed scalar
  vocabulary under LLP 0080's portable exact semantics;
- optional stored display fields, as in 0073;
- exactly `public-read` visibility or owner visibility through one
  required field under LLP 0065's `owner.v1` — 0073's two admitted
  pushdown shapes, unchanged; membership joins and relational
  visibility are not v1 declarations;
- a declared `id-asc` or `id-desc` row-id tie-break; and
- a declared corpus bound `maxIndexedVectorsPerPartition` (1–65,536).

Generation validates every field, filter, and authorization fact, and
additionally proves the **bounded-scan product rule**:
`dimensions × maxIndexedVectorsPerPartition ≤ 2^26` (67,108,864 scalar
pairs). A declaration that could require more exact-scan work than that
ceiling refuses at generation; the exact scan is therefore bounded by
construction, not by runtime luck. Activation preflights every existing
row and partition; an over-bound legacy partition refuses activation
rather than becoming an index the write path cannot maintain.

An index version binds source schema, vector field and dimensions,
metric, distance-profile id, filter/stored sets, classification,
tie-break, visibility shape, and every limit. Any semantic change is a
new version and rebuild, never a silent reinterpretation. Rust owns the
closed artifacts (LLP 0037): `VectorIndexManifestV1` in
`TableManifest.vectorIndexes`, `VectorQueryPlanV1` as a host plan,
`VectorRequestV1` / `VectorPageV1` / `VectorItemV1` as public carriers,
and `VectorSearchFactsV1` with capability id `vector_search_v1`.
Unknown members refuse.

## Distance profile — the portable-exactness answer

The v1 distance profile is `snapback-vector-distance-v1`, and it makes
the full 0073-strength determinism claim — same current index state and
same query vector produce the identical ordered result, bit-identical
distances included, on every conforming target — in floating point.
This is 0124 OQ3's rider, decided as follows.

**Pin the arithmetic, not a quantization.** Every distance is computed
in IEEE 754 binary64 with round-to-nearest-ties-even, evaluated as a
strict sequential accumulation in ascending dimension index:

- `l2sq`: `acc ← acc + (a[i] − b[i]) × (a[i] − b[i])`, acc from +0.0;
- `dot`: `acc ← acc + a[i] × b[i]`, acc from +0.0.

Each subtraction, multiplication, and addition is one correctly rounded
binary64 operation. Fused multiply-add, reassociation, extended-precision
intermediates (x87), and reduction-order-changing vectorization are
forbidden — a SIMD implementation must reproduce the sequential
accumulation bit-for-bit or not report the capability. Because IEEE 754
fully specifies these operations, conforming implementations agree
bitwise; portability follows from the pin, not from testing luck.

**Why this answer.** Integer quantization (the mechanical transfer of
FTS's u32 scorer) would discard embedding precision and still need a
pinned quantization map — the determinism problem moves, it does not
shrink. Scoping the determinism claim down would surrender the
cross-target order guarantee that is the spine of 0073's pattern.
Pinned binary64 arithmetic keeps both, at the cost of forbidding
fast-math — acceptable for a scan already bounded to 2^26 scalar pairs.

**Provable finiteness.** With components bounded by 2^100 and
dimensions by 4096 (= 2^12): each `l2sq` term is at most
(2^101)^2 = 2^202, so the accumulator never exceeds 2^214; each `dot`
term is at most 2^200, accumulator at most 2^212. Both are far below
the binary64 overflow threshold of 2^1024, so no admitted computation
produces infinity or NaN. There is no division and no square root
anywhere in v1 — which is also why `cosine` is not a v1 metric id: the
platform is embedding-agnostic, so an application wanting cosine
similarity normalizes its vectors where it computes them and declares
`dot` (a documented Guide recipe). Distances therefore need no epsilon
vocabulary and no saturation rule.

**Ordering.** The ordering profile is `nearest-first-row-id.v1`:
results order by ascending distance for `l2sq`, descending similarity
for `dot`, then by canonical opaque row-id bytes in the declared
direction. Bit-equal distances are well defined, so the tie-break is
total and deterministic. Distances are surfaced as informational
binary64 JSON numbers — RFC 8785's shortest round-trip spelling is
injective on binary64, so the wire value is exact and fixtures may pin
it as a string. Distances are never authorization, moderation, pricing,
or other correctness inputs (0073's rule, unchanged).

The distance profile — formulas, evaluation order, admission bounds,
ordering, and its golden corpus — is one committed versioned artifact
with a content digest. Changing any of it is a new profile id and a new
semantic index version.

## Query surface

`defineVectorQuery({ table, index })` exports a callable operation with
`FunctionKind::Query` — not `LiveQuery`; subscription attempts refuse
with the existing `SNAPBACK_FUNCTION_NOT_LIVE` diagnostic, exactly as
0073's search operations do. It uses the existing authenticated query
invocation route and envelope; there is no new backend-specific route.

Exact arguments:
`{ vector: number[], k?: 1..64, filters?: [{field, op: 'eq', value}] }`.
The query vector passes the same admission as stored vectors (exact
declared dimensions, finite, magnitude-bounded, −0 canonicalized);
violations refuse with `SNAPBACK_VECTOR_QUERY_INVALID` before storage
work, as does an unknown field, operator, or filter value. `k` defaults
to 10. At most 8 equality filters, `eq` only, over declared filter
fields; `eq null` is not admitted (LLP 0080's authority — null never
matches).

Exact result: `VectorPageV1 { items }`, each item
`{ rowId, distance, fields }` with `fields` exactly the declared stored
fields. **V1 has no pagination**: one bounded page of at most `k`
results, no cursor, no `hasMore` — the complete answer fits in one
page, so no cursor-crypto surface is minted; k-NN beyond k=64 is not a
v1 claim. The wire remains the existing
`QueryOutput {version, rows, cursor}` with `cursor` always null; the
generated/headless `client.vectorSearch()` adapter projects it to
`VectorPageV1`. Fewer than `k` items means fewer than `k` authorized
candidates matched — never an elided remainder. The byte-for-byte
agreement obligation covers the generated JSON Schemas, TypeScript
pages, client carrier, capability facts, **and the provider/contract
projection** — named explicitly so 0073 open question 12's
`unknown`-argument drift cannot recur here.

Stable diagnostics: `SNAPBACK_VECTOR_QUERY_INVALID`,
`SNAPBACK_VECTOR_WORK_LIMIT`, `SNAPBACK_VECTOR_INDEX_UNAVAILABLE`,
`SNAPBACK_VECTOR_INDEX_CORRUPT`, `SNAPBACK_VECTOR_VALUE_INVALID` — all
on the existing structured `Diagnostic` envelope.

## Candidate-to-release consistency

This is the section 0124 said any vector path owes, and it is the
load-bearing product claim: what Convex ships as
action → internal query → vector search → internal query — Diary 0031's
"works, but adds conceptual overhead," with a documented
nontransactional seam — Snapback ships as one authorized query call.

**Snapshot participation.** Candidate selection, visibility filtering,
equality filtering, distance evaluation, and document hydration all
execute inside the same pinned per-request application snapshot as any
ordinary query. Index maintenance is synchronous (§Index maintenance),
so the index at any commit head is exactly the derivation of the source
rows at that head; there is no window in which a returned candidate can
have been deleted or mutated between selection and hydration. Snapback's
commit-version evidence keeps meaning what it means — LLP 0115's
no-evidence-regression constraint (governing constraint 1, LLP 0130
ER-2) is engaged and satisfied: nothing here weakens snapshot,
authorization, or commit-version claims to buy a convenient API.

**Filter timing: pre-authorization, chosen and justified.** The
caller's visibility partition is part of every vector posting access
key (0073's pushdown, unchanged), and declared equality filters apply
before distance evaluation. Unauthorized rows never enter the distance
scan. Justification: (a) an exact scan pre-filters for free — there is
no traversal structure for the predicate to break, so the ANN
pre-filter dilemma 0124 names (over-fetch or filter-aware traversal)
does not exist in the base profile; (b) the page is the true top-k of
the authorized candidate set by construction — no under-filled k, no
post-filter re-ranking; (c) leakage is excluded structurally rather
than statistically — distances, ranks, result counts, work accounting,
and admission all range over the caller's partition only, so 0073's
paired-database noninterference boundary transfers with the same claim
shape (value/code, termination-insensitive, over counted logical work;
wall-clock effects explicitly outside the semantic transcript). Any
later ANN capability inherits the pre-filter-or-proved-over-fetch
obligation explicitly; it cannot weaken this posture silently.

**Release recheck.** Pushdown narrows work but never authorizes.
**Vector search never authorizes data**: before any rowId, distance,
stored field, or existence fact is released, the server reads the
candidate's current authoritative source row in the same snapshot,
proves the posting matches it by canonical content digest (RFC 8785
bytes, never in-memory representation — 0073's Diary 0039 pin adopted
wholesale), and evaluates the generated public/owner predicate.
Recheck failure is storage drift and fails closed with
`SNAPBACK_VECTOR_INDEX_CORRUPT`; no partial page is released.

**Deletion.** Synchronous maintenance makes post-delete negative probes
deterministic: a deleted or ownership-transferred row is absent from
the very next query at the commit head. The Diary 0030/0031 probe style
transfers directly, with no sync-lag caveat to disclose.

**Reactive posture: one-shot, honestly.** V1 vector queries are not
live; the refusal is coded, not silent. Because selection runs in the
ordinary query tier over one snapshot, a live vector query is
*plausible* future work in a way it structurally is not for Convex's
action tier — recorded as open question 3, a separate capability under
its own id, and not claimed here.

## Index maintenance and storage

The v1 profile is synchronous: source commit and vector index
maintenance advance in one transaction, and a maintenance or bound
failure rolls back the complete source mutation with a stable
diagnostic (0073's resolved choice, adopted). Accepted rows are
retrievable at their commit head; no stale-success state exists.
Inserting a row that would exceed the declared partition corpus bound
is an ordinary validation refusal — the write side enforces what the
generation-time product rule proved, so `SNAPBACK_VECTOR_WORK_LIMIT`
at query time indicates drift, is fail-closed defense in depth, and
never releases a partial or unordered page.

Work composes globally with 0073's ceilings rather than beside them:
one mutation may replace at most 1,024 per-index vector postings
(counted against a `vectorMaintenanceEffects` ceiling analogous to
`searchMaintenanceEffects`) and write at most 4 MiB of vector bytes;
the existing application/projection-row and search ceilings are
unchanged. Every update carries the idempotent
`(indexVersion, sourceId, sourceVersion)` identity with CAS,
tombstones, and gap-free frontiers, exactly as 0073 specifies.

On the SQLite lane, each index generation stores one shadow posting
table keyed by `(visibilityPartition, canonicalRowIdBytes)` whose
vector column is the canonical fixed-width little-endian binary64
encoding (8 × dimensions bytes; at most 32 KiB per row). The scan reads
the caller's partition in canonical key order — deterministic
enumeration, so equal-distance ties resolve identically everywhere.
Content digests over the RFC 8785 canonical form bind the posting to
its source. No SQLite vector extension (sqlite-vec or otherwise) is
part of `vector_search_v1`; an engine-native structure is a candidate
*successor* capability (§ANN successor), never a silent substitution.

Rebuilds and migrations reuse 0073's machinery: an LLP 0081 plan and
approval receipt executed by `derived-vector-catchup.v1` (the vector
sibling of `derived-search-catchup.v1`), journal-floor leases, verified
activation under the switch fence, and the same rollback boundary.
Backup/restore follows 0073: derivable index bytes may be omitted when
the manifest records what rebuild needs, and restore keeps vector
search unavailable or explicitly stale until verification completes.
Deleting source content and completing retention removes vectors from
active and rollback generations, build artifacts, and backups — an
embedding is content.

## Capabilities, targets, and staging

The capability id is `vector_search_v1`, reported through
`VectorSearchFactsV1`: distance-profile id and digest, metric and
dimension bounds, k bound, corpus-bound and product-rule ceilings,
filter/stored support, visibility shapes, synchronous freshness,
no-pagination, tie-break, storage class, and corruption posture.
Invocation refuses before storage work unless the target advertises the
exact profile. Maturity enters through LLP 0113's qualification route
(LLP 0115 decision 3's default for new profiles) at experimental;
stable promotion awaits the stable-promotion design and this Spec's
acceptance evidence. The guide's `backend.vector-search` GAP row flips
to a witnessed row only when the local target reports the capability
with the evidence below — never before (the nonclaim discipline 0124
found the diaries rewarding).

Implementation sequence, copying 0073's:

1. publish the distance-profile artifact, golden corpus, and carriers;
2. implement the exact profile on local SQLite;
3. qualify the same adapter inside `single-instance-container-vm.v1`
   independently;
4. PostgreSQL only after LLP 0046's store-seam prerequisite, against
   the same corpus (pgvector, if used physically, must reproduce
   `snapback-vector-distance-v1` bitwise or stay a nonclaim); and
5. ANN and accelerators only as separate capabilities (below).

## ANN successor admission

Decision 8's rule, made concrete. The base profile is exact and stays
exact. A later ANN admission takes one of two doors, both outside
`vector_search_v1`:

- **Accelerator door** (0073's precedent): an ANN or pruning structure
  whose candidate set provably contains the true top-k for every
  admitted query — proved by construction, not by finite corpus — may
  serve as a physical accelerator behind the *same* exact claims, with
  exact re-scoring on release and its own separately reported
  accelerator identity. The pre-filter obligation transfers: it must
  return k authorized candidates under partition pushdown or
  over-fetch by a proved bound.
- **Approximate door**: an honest approximate capability
  (`vector_search_ann_v1` or successor) with a different evidence
  vocabulary — recall@k against pinned corpora, per-target measured
  claims — its own consistency analysis against §Candidate-to-release
  consistency, and its own guide row. It never changes, shadows, or
  silently substitutes for the exact base profile.

What observed corpus or work evidence justifies opening either door is
open question 2; the ceilings above are instrumented so that evidence
can exist.

## Acceptance

The implementation must retain executable evidence that:

- the pinned golden corpus — seeded from Diary 0031's frozen
  Research Room fixture (LLP 0102 App 5's deterministic 32-dimensional
  embeddings), restated under v1's `owner.v1` and `public-read`
  visibility shapes — produces byte-identical distances (pinned RFC
  8785 spellings), ranks, and pages through the semantic oracle and
  every claimed target adapter; the fixture's room-membership
  visibility itself is restated, not claimed (membership shapes are a
  v1 nonclaim, as in 0073);
- an adversarial arithmetic corpus covers negative zero, subnormals,
  components at the 2^100 admission bound, bit-equal distance ties
  resolved by row-id direction, dimension mismatch, and non-finite
  refusal — and includes vectors chosen so that FMA, reassociated, or
  extended-precision evaluation produces detectably different bits,
  so a nonconforming build fails the corpus rather than passing
  approximately;
- paired databases differing only in another owner's vectors are
  identical across items, distances, refusal codes, work accounting,
  and ordinary inspection, to 0073's termination-insensitive claim;
- inserts, updates, ownership transfers, and deletes are reflected at
  their commit head; post-delete and post-transfer negative probes
  pass deterministically; injected maintenance failure rolls back the
  complete source mutation;
- the declared corpus bound refuses the overflowing insert; activation
  preflight refuses an over-bound legacy partition; the generation
  refuses a declaration violating the product rule;
- a preregistered realistic-dimensionality budget corpus (at least
  1,536 dimensions at its generation-validated partition bound) meets
  pinned build, update, query-latency, and memory budgets — because
  the 32-dimensional fixture exercises mechanics, not scale (0124's
  caveat, adopted);
- release-recheck drift, tampered postings, and digest mismatch fail
  closed with the coded corruption outcome and quarantine; and
- generated schemas, TypeScript pages, the client adapter, capability
  facts, the provider/contract projection, and guide rows agree
  byte-for-byte on the declared profile and its nonclaims.

## Non-goals and claim boundary

V1 provides no approximate/ANN retrieval, no embedding computation or
model integration (LLP 0124 V3; sequenced later per LLP 0019), no
hybrid lexical+vector scoring or fusion ranking — that is named
successor work, a separate profile composing `full_text_search_v1` and
this capability, owned by a future document — no external vector-store
integration (0124 V4), no hosted-target claim, no live subscriptions,
no pagination or cursors, no `cosine` metric id, no range filters, no
membership/relational visibility, no sensitive-field indexing, and no
offline or client-side vector search (LLP 0073's client-side fence
holds). Storing vectors in ordinary rows and scanning them in
application code does not satisfy this profile, and no target may
report the capability without its own evidence.

## Open questions

1. **Cosine metric id.** Is `dot` over application-normalized vectors
   a sufficient permanent answer, or does a `cosine` id (division and
   square root, both correctly rounded and thus pinnable) ever pay for
   itself? Decide on demand evidence, not speculation.
2. **ANN crossing trigger** (0124 OQ3's second subquestion). What
   observed corpus size, refusal rate at the declared bounds, or
   latency evidence justifies opening an ANN door — and which door
   first?
3. **Live vector queries.** Snapshot-tier selection makes read-set
   participation plausible; a live profile would be a genuine
   differentiator (0124's observation) under its own capability id.
4. **Ceiling tuning.** Whether 2^26 scalar pairs, k ≤ 64, and 4,096
   dimensions are the right product bounds is an empirical question
   for the qualification evidence before stable promotion.
