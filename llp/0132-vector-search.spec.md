# LLP 0132: Portable vector search

**Type:** Spec
**Status:** Implemented
**Systems:** Search, Storage, Schema, Code generation, Auth, Client integration, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:** 2026-08-05 (authoring-safety clarification: visibility is a
required declaration; omission refuses with
`SNAPBACK_VECTOR_INDEX_VISIBILITY_REQUIRED`, so public release is affirmative
rather than defaulted); 2026-08-03 (IMPLEMENTED for the experimental local
`local-dev-sqlite-ibex.v1` target: declared fields/indexes/queries, synchronous
maintenance and resumable rebuild, exact `dot`/`l2sq` execution, public and
owner release, closed bounds/diagnostics/facts, generated/client/provider
projection, Guide publication, and both local macOS and independent Linux Fly
filled-partition receipts. Hosted/Postgres/live/ANN remain explicit nonclaims.)
2026-08-03 (VEC-3 SQLite maintenance/rebuild checkpoint:
transactional shadow generations, mutation-global preflight, retained CAS
frontiers/tombstones, exact-generation corruption quarantine handoff, and the
approved resumable `derived-vector-catchup.v1` executor; still no target
qualification or capability-support claim) 2026-08-02 (VEC-2 static-carrier/authoring checkpoint: closed
field, index, query, contract/provider, client, and target-facts carriers;
registered the experimental capability vocabulary while every target remains
support=false/GAP) 2026-08-02 (VEC-1 storage-primitives checkpoint: pinned canonical
little-endian binary64 bytes, the admitted-vector JCS digest, mutation-global
vector maintenance accounting, source-frontier CAS/tombstone classification,
and the write-side maintenance diagnostic split; no storage adapter or support
claim) 2026-08-02 (VEC-0 numeric-authority checkpoint: committed the
Rust-owned `snapback-vector-distance-v1` profile artifact and schema, JCS
payload digest, independent BigInt exact-arithmetic derivation, and shared
Rust/JavaScript witnesses for the named binary64 divergence classes; this is
implementation-sequence step 1 evidence only and publishes no field, index,
query, target, or capability support) 2026-07-31 (ACCEPTED under LLP 0130 SD-4's standing
authorization: dual-family READY — Fable round 2, Codex round 4 —
with the three conditions checked and satisfied: (1) zero unresolved
MATERIAL concerns in either family's final round; (2) within the
decided scope of its commission (decision 8: exact-k-NN base profile,
embeddings-from-outside, Spec beside 0073, the OQ3 float-pinning
rider; the one beyond-commission item — the approximate door — is
disclosed as this Spec's own undecided proposal routed to the author);
(3) no evidence boundary weakened — the classification matrix,
custody, and telemetry rules mirror 0073's resolved posture and every
mechanism is additive. Recorded per SD-4's honesty rule: the author's
standing acceptance made in advance, not a fresh manual adjudication.
Review artifacts: reviews/0132-vector-search.{fable,codex}.md.) 2026-07-31 (v0.4, round-3 single fix —
`reviews/0132-vector-search.codex.md` round 3 NOT READY on one item:
the fixed beyond-20-significant-digit conversion witness cannot
detect round-to-H double rounding on a target whose
implementation-defined H exceeds 20 — IEEE 754-2019 §5.12.2 requires
only H ≥ M+3, with larger or unbounded H permitted. Applied: the
conversion-witness requirement made per-target in the conversion pin
and the acceptance corpus bullet — each target with finite H runs a
distinguishing witness with more significant digits than that
target's own H, constructed to differ between direct correct
rounding and round-to-H-then-binary64 double rounding; a target
correctly rounding at any input length records that fact as its
conversion evidence; the beyond-20-digit witness kept as the
portable floor)
2026-07-31 (v0.3, round-2 micro-fixes —
`reviews/0132-vector-search.codex.md` round 2 NOT READY — all five
round-1 findings RESOLVED, one new MATERIAL on the mutation-side
refusal contract; `reviews/0132-vector-search.fable.md` round 2
READY — all seven round-1 findings RESOLVED, three detail notes
R2-1–R2-3. Applied: the `SNAPBACK_VECTOR_CORPUS_BOUND` refusal
extended from the overflowing insert to every source mutation that
would push any destination visibility partition over its declared
bound — ownership/visibility transfers and partition-key-changing
updates included — with atomic rollback and the full-destination
transfer-overflow acceptance probe beside the insert probe (Codex
MATERIAL); the conversion pin's IEEE 754 attribution corrected — 754
§5.12.2 mandates correct rounding only to H significant digits
(H ≥ 20 for binary64) and permits long-input double rounding, so this
Spec's unconditional any-length pin is deliberately stronger — with a
beyond-20-significant-digit corpus witness (R2-1); work counter 2
pinned to declaration-order short-circuit semantics, counting filter
comparisons actually executed (R2-2); and the query-vector telemetry
rule moved to its own paragraph, unconditional for every index rather
than scoped to the private-custody clause (R2-3))
2026-07-31 (v0.2, round-1 dual-family review fixes — both
round-1 reviews NOT READY (`reviews/0132-vector-search.fable.md`:
3 MATERIAL C1–C3 + 4 detail C4–C7;
`reviews/0132-vector-search.codex.md`: 4 MATERIAL M1–M4 + 1 MINOR M5);
every finding re-verified against LLP 0073's text, LLP 0115 v0.7's
decision-8 registry entry, LLP 0102 App 5, and Diary 0031 before
application; all findings applied, none refuted; overlapping findings
(Fable C1 = Codex M1, Fable C6 = Codex M3) fixed once. Applied: the
classification-to-visibility admission matrix closed to 0073's
resolved-OQ4 rule for every participating role, with private-posting
custody, query-vector telemetry, and generation-negative acceptance
(C1/M1); the wire-decimal→binary64 admission conversion pinned to the
correctly rounded strtod-class conversion with halfway-case corpus
witnesses (C2); the approximate ANN door re-attributed as this Spec's
own undecided proposal — disclosed beyond-commission, routed to the
author (C3); the closed logical-work object and evaluation order
defined so the paired-database noninterference claim is falsifiable
(M2); the adversarial-corpus claim scoped to named divergence classes
on exercised kernels, with committed bit-pattern witnesses, per-kernel
coverage, and build/flag evidence replacing the universal
nonconforming-build claim (C6/M3); the realistic-scale floor pinned to
the filled maximum generation-validated partition with a receipt
recording exact cardinality (M4); the cosine recipe's preconditions
stated — both sides consistently normalized and nonzero, the claim
being portable dot ranking over admitted binary64 components (M5); the
never-−0-output lemma and partial-bound representability clause added
and the RFC 8785 injectivity claim scoped to the reachable output
domain (C4, C7c); filter conjunction and duplicate-field refusal
stated (C5); the load-bearing product claim restated as specification
rather than present-tense shipping (C7a); the mutation-side
corpus-bound refusal coded `SNAPBACK_VECTOR_CORPUS_BOUND` (C7b); and
the 32-dimension attribution corrected to Diary 0031's freeze (C7d))
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
value and index contract, bounds, and acceptance. It additionally
*proposes without deciding* one item: the approximate-door admission
constraint in §ANN successor admission. Decision 8 decided only the
proved-superset accelerator route; the approximate door is this
Spec's own proposal, undecided, and routed to the author (see that
section).

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

Admission also pins the conversion *in*, not only the arithmetic
after it. Wire components arrive as JSON decimals; admission converts
each to the nearest binary64 value with ties to even — the correctly
rounded strtod-class decimal-to-binary conversion — and the admitted
binary64 value, not the wire spelling, is the semantic input to
storage, digests, and every distance. This pin is deliberately
stronger than IEEE 754's: §5.12.2 mandates correct rounding only for
decimal sequences of at most H significant digits (H ≥ 20 for
binary64) and permits rounding a longer sequence to H digits first —
a double rounding this Spec does not allow. JSON wire decimals can be
arbitrarily long, and that is exactly where halfway-straddling inputs
live, so here correct rounding is unconditional at any input length.
A parser off by an ulp on halfway-adjacent decimals is a divergence
source of exactly the same kind as the forbidden fast-math
transformations and does not conform. The adversarial corpus carries
conversion witnesses (§Acceptance): a portable floor of at least one
entry beyond 20 significant digits, and, on each target whose
conversion is correctly rounded only up to a finite
implementation-defined H, a distinguishing witness with more
significant digits than that target's H, constructed so direct
correct rounding and round-to-H-then-binary64 double rounding produce
different binary64 values; a target whose conversion is correctly
rounded at any input length records that fact as its conversion
evidence.

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
  field classification, admitted under the classification matrix
  below — an embedding is derived from content and inherits its
  custody;
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

Visibility is required in the authoring declaration. Omission refuses codegen
with `SNAPBACK_VECTOR_INDEX_VISIBILITY_REQUIRED`; codegen never interprets an
absent value as `public-read`.

**Classification-to-visibility admission matrix.** Classification
closes over every participating role, mirroring LLP 0073's resolved
open question 4 exactly: the vector field, every equality-filter
field, and every stored display field carries a
`public`/`private`/`sensitive`/`forbidden` classification; omission
is `forbidden`, and a table-wide classification may only make the
result more restrictive. `public-read` indexes admit only `public`
fields in every participating role. `owner.v1` indexes may admit
`public` or `private` fields, because the canonical effective-user
partition is both the posting key and release authority. `sensitive`
and `forbidden` fields are rejected from every participating role on
every target; admitting `sensitive` content requires a later named
profile, as in 0073. Generation refuses any declaration outside this
matrix, and a classification change is a semantic index migration and
rebuild, never an in-place flag.

Private custody travels with the matrix. When any participating field
is `private`, the index inherits 0073's private-custody clause:
posting bytes, content digests, caches, rebuild and rollback
generations, backups, and administrative access carry a storage and
encryption class at least as restrictive as the source.

Query vectors are custody-bearing for every index — all-`public`
indexes included, not only under the private-custody clause above —
because they are embeddings of caller content: logging is redacted,
and default telemetry records query shape (dimensions, `k`, filter
shape) and digest, never raw components — 0073's query-text telemetry
rule, transferred unconditionally.

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

- `l2sq`: `d ← a[i] − b[i]; acc ← acc + d × d` — the difference is
  computed and rounded once, then squared — acc from +0.0;
- `dot`: `acc ← acc + a[i] × b[i]`, acc from +0.0.

Each subtraction, multiplication, and addition is one correctly rounded
binary64 operation — three per `l2sq` term, two per `dot` term, in the
order written. Gradual underflow is honored: subnormal intermediates
and results are produced exactly as IEEE 754 requires, so
flush-to-zero / denormals-are-zero (FTZ/DAZ) execution modes are
nonconforming. Fused multiply-add, reassociation, extended-precision
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
(2^101)^2 = 2^202, so the accumulator never exceeds
2^12 × 2^202 = 2^214; each `dot` term is at most 2^200, accumulator at
most 2^212. The bounds hold under rounding, not merely in exact
arithmetic: every partial bound k·2^202 (resp. k·2^200) is exactly
representable for k ≤ 2^12 — 12 bits beside a 53-bit significand — and
correctly rounded addition is monotone, so the accumulator can never
round past a representable bound. Both bounds are far below the
binary64 overflow threshold of 2^1024, so no admitted computation
produces infinity or NaN. No admitted computation produces −0 either:
components are +0-canonicalized at admission; in `l2sq` an exact-zero
difference rounds to +0 under round-to-nearest-ties-even and every
square is ≥ +0; in `dot` the accumulator starts at +0.0 and IEEE
zero-sign rules yield −0 only from (−0) + (−0), which induction
excludes — a −0 product term is absorbed as +0 + (−0) = +0. There is
no division and no square root anywhere in v1 — which is also why
`cosine` is not a v1 metric id: the platform is embedding-agnostic, so
an application wanting cosine ranking unit-normalizes where it
computes embeddings and declares `dot`, under stated preconditions:
stored and query vectors must both be consistently
application-normalized, and both must be nonzero — a zero vector has
no cosine, so the application rejects or defines it before admission
(a versioned normalization producer is the documented Guide recipe).
The resulting claim is portable dot *ranking* over the
application-normalized binary64 components as admitted, not exact-real
cosine over the pre-normalization vectors. Distances therefore need no
epsilon vocabulary and no saturation rule.

**Ordering.** The ordering profile is `nearest-first-row-id.v1`:
results order by ascending distance for `l2sq`, descending similarity
for `dot`, then by canonical opaque row-id bytes in the declared
direction. Bit-equal distances are well defined, so the tie-break is
total and deterministic. Distances are surfaced as informational
binary64 JSON numbers — RFC 8785's shortest round-trip spelling is
injective on the profile's reachable output domain (binary64 excluding
−0 and non-finites, none of which the profile can produce — §Provable
finiteness), so the wire value is exact and fixtures may pin it as a
string. Distances are never authorization, moderation, pricing,
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
matches). Filters conjoin: a row is a candidate only if every listed
filter matches. A filter list naming the same field twice refuses with
`SNAPBACK_VECTOR_QUERY_INVALID` — the validation posture used
everywhere else in this Spec — rather than being admitted as a
duplicate or vacuously empty conjunction.

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

Stable diagnostics: `SNAPBACK_VECTOR_INDEX_INVALID`,
`SNAPBACK_VECTOR_QUERY_PLAN_INVALID`, `SNAPBACK_VECTOR_QUERY_INVALID`,
`SNAPBACK_VECTOR_WORK_LIMIT`, `SNAPBACK_VECTOR_INDEX_UNAVAILABLE`,
`SNAPBACK_VECTOR_INDEX_CORRUPT`, `SNAPBACK_VECTOR_VALUE_INVALID`,
`SNAPBACK_VECTOR_CORPUS_BOUND`, `SNAPBACK_VECTOR_MAINTENANCE_LIMIT`, and
`SNAPBACK_VECTOR_MAINTENANCE_FAILED` — all on the existing structured
`Diagnostic` envelope. The first two distinguish invalid authored index and
query-plan artifacts before any target execution. The last two transfer LLP
0073's write-side split:
`MAINTENANCE_LIMIT` is the planned aggregate-effects/bytes refusal before any
write, while `MAINTENANCE_FAILED` is inability to produce or commit the required
derived state. Neither is query `WORK_LIMIT` or authored `VALUE_INVALID`.

## Candidate-to-release consistency

This is the section 0124 said any vector path owes, and it is the
load-bearing product claim: what Convex ships as
action → internal query → vector search → internal query — Diary 0031's
"works, but adds conceptual overhead," with a documented
nontransactional seam — this Spec specifies as one authorized query
call.

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
shape (value/code, termination-insensitive, over the closed
logical-work object defined next; wall-clock effects explicitly
outside the semantic transcript). Any later ANN capability inherits
the pre-filter-or-proved-over-fetch obligation explicitly; it cannot
weaken this posture silently.

**Logical work, closed.** The counted logical-work object the
noninterference and work-limit claims range over is closed, and the
evaluation order is fixed. The four counters: (1) partition postings
enumerated — rows read from the caller's visibility-partition key
range in canonical key order; (2) filter comparisons evaluated —
declared filters test in declaration order with short-circuit on the
first mismatch, and the counter is the comparisons actually executed;
(3) scored candidates and their scalar pairs — candidates admitted
past filtering, and that count times dimensions; (4) release source
reads — one authoritative-row read per released candidate. Evaluation
proceeds enumeration → equality filtering → distance evaluation →
top-k selection → release recheck; ceilings are checked in that order,
and a `SNAPBACK_VECTOR_WORK_LIMIT` refusal names the first exceeded
ceiling. These four counters are the work-accounting inspection facts
the acceptance evidence compares. Every counter and every work-limit
outcome depends only on the caller's partition contents and the query,
never on any other partition. Physical pages, caches, elapsed time,
cancellation, and machine loss are coupled nondeterminism outside the
semantic transcript, exactly per 0073: the claim is value/code,
termination-insensitive noninterference over these counted units, not
constant-time execution, and no target may report a stronger
timing-sensitive claim without separate evidence.

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
Any source mutation that would cause any destination visibility
partition to exceed its declared corpus bound — an insert, an
ownership or visibility transfer moving an existing row into a full
destination partition, or any partition-key-changing update — refuses
with `SNAPBACK_VECTOR_CORPUS_BOUND` on the ordinary validation
envelope, rolling back the complete source mutation atomically and
leaving source and index state unchanged — the write side enforces
what the generation-time product rule proved, so
`SNAPBACK_VECTOR_WORK_LIMIT` at query time indicates drift, is
fail-closed defense in depth, and never releases a partial or
unordered page.

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

### Implementation record — 2026-08-02 VEC-2 static carrier checkpoint

Building on VEC-0's numeric authority and VEC-1's transaction-neutral storage
primitives, this checkpoint lands the closed, non-claiming authoring surface:
the dedicated `v.vector(D)` / `ResultValueContract::Vector { dimensions }`
node on argument and result lanes; schema, index, query-plan, request, item,
page, and future target-facts carriers; generated authoring and declarations;
exact provider/Contract projection; and the items-only client adapter. The
ordinary array ceiling remains 1,024 while the vector node admits exact
dimensions 1–4,096 and finite components with absolute value at most 2^100.
`maxScalarPairs` is derived exactly from dimension × declared corpus, and the
mutation-global maintenance limits reuse VEC-1's fixed authority rather than
becoming authoring knobs. Equality-filter fields are exact per operation;
unknown, duplicate, and null-bearing filters refuse. Stored-field projection
categorically excludes vector fields.

The public diagnostic inventory is classified deliberately at the HTTP seam:
authored index/query-plan artifacts, query/value shape, and pre-write
maintenance admission are terminal 400s for an unchanged request; a full
corpus partition is a state-dependent 409; index readiness is a 503 whose retry
waits for readiness to change; and index corruption, failed synchronous
maintenance, or a query-time work-bound breach are fail-safe 500 server
invariants, not blind-client-retry classes.

This is deliberately a staged checkpoint, not target support. The capability
id is registered as experimental, but every target predicate remains false,
every target publishes the structured `vector_search_v1` GAP, and the closed
`VectorSearchFactsV1` block remains absent. SQLite can lower a direct manifest
to the specified `BLOB` affinity without panicking, while every vector write
still refuses with `SNAPBACK_CAPABILITY_UNSUPPORTED`. No distance executor,
database-adapter integration, derived-index maintenance, corpus qualification,
runtime route, local or hosted claim, guide-row flip, or LLP status change
lands here. Those remain behind the acceptance sequence above.

## ANN successor admission

The base profile is exact and stays exact. Two future doors are
named, both outside `vector_search_v1`. The first is decision 8's
rule made concrete; the second is **this Spec's own proposal** —
decision 8 decided only the proved-superset route, and no document
has decided the second door:

- **Accelerator door** (decision 8's proved-superset rule; 0073's
  precedent): an ANN or pruning structure
  whose candidate set provably contains the true top-k for every
  admitted query — proved by construction, not by finite corpus — may
  serve as a physical accelerator behind the *same* exact claims, with
  exact re-scoring on release and its own separately reported
  accelerator identity. The pre-filter obligation transfers: it must
  return k authorized candidates under partition pushdown or
  over-fetch by a proved bound.
- **Approximate door — this Spec's proposal, undecided**: an honest
  approximate capability (`vector_search_ann_v1` or successor) with a
  different evidence vocabulary — recall@k against pinned corpora,
  per-target measured claims — its own consistency analysis against
  §Candidate-to-release consistency, and its own guide row, never
  changing, shadowing, or silently substituting for the exact base
  profile. This door is not part of decision 8: it is disclosed in
  §Commission's beyond-the-commission list, rides open question 2,
  and its adoption as policy is routed to the author. A future
  `vector_search_ann_v1` document may not cite this section as
  commissioned or decided policy.

What observed corpus or work evidence justifies opening either door is
open question 2; the ceilings above are instrumented so that evidence
can exist.

## Acceptance

The implementation must retain executable evidence that:

- the pinned golden corpus — seeded from Diary 0031's frozen
  Research Room fixture (LLP 0102 App 5's deterministic embedding
  fixture; the 32 dimensions are Diary 0031's freeze, not a 0102
  specification), restated under v1's `owner.v1` and `public-read`
  visibility shapes — produces byte-identical distances (pinned RFC
  8785 spellings), ranks, and pages through the semantic oracle and
  every claimed target adapter; the fixture's room-membership
  visibility itself is restated, not claimed (membership shapes are a
  v1 nonclaim, as in 0073);
- an adversarial arithmetic corpus covers negative zero, subnormals,
  components at the 2^100 admission bound, halfway-case
  decimal→binary64 conversion entries (adjacent decimals that a
  non-correctly-rounded parser converts off by one ulp; the portable
  floor is at least one witness whose decimal spelling exceeds 20
  significant digits, and each target whose conversion is correctly
  rounded only up to a finite implementation-defined H must
  additionally run a distinguishing witness with more significant
  digits than that target's H, constructed so direct correct rounding
  and round-to-H-then-binary64 double rounding produce different
  binary64 values — a target whose conversion is correctly rounded at
  any input length instead records that fact as its conversion
  evidence), bit-equal distance ties resolved by row-id direction,
  dimension mismatch, and non-finite refusal. For each named
  divergence class — FMA contraction, reassociation/reduction
  reorder, extended-precision
  (x87) intermediates, FTZ/DAZ subnormal flushing, and one-ulp
  decimal conversion — the corpus commits bit-pattern witness vectors
  with expected output bits per metric, and every compiled kernel a
  target ships (scalar, SIMD, or dimension-specialized) must run the
  full corpus. The claim is scoped honestly: the corpus detects the
  named divergence classes on the kernels it exercises; no finite
  corpus detects every nonconforming build, so conformance evidence
  combines corpus results, per-kernel coverage records, and
  build/flag evidence (strict-FP flags, contraction and fast-math
  disabled, no extended-precision intermediates). The normative
  guarantee remains the pin (§Distance profile); the corpus is its
  detector;
- paired databases differing only in another owner's vectors are
  identical across items, distances, refusal codes, the four closed
  logical-work counters (§Candidate-to-release consistency), and
  ordinary inspection, to 0073's termination-insensitive claim;
- inserts, updates, ownership transfers, and deletes are reflected at
  their commit head; post-delete and post-transfer negative probes
  pass deterministically; injected maintenance failure rolls back the
  complete source mutation;
- the declared corpus bound refuses the overflowing insert with
  `SNAPBACK_VECTOR_CORPUS_BOUND`, and an ownership transfer into a
  full destination partition refuses with the same code and leaves
  source and index state unchanged — the full-destination
  transfer-overflow probe beside the insert probe; activation
  preflight refuses an over-bound legacy partition; the generation
  refuses a declaration violating the product rule;
- generation refuses every admission-matrix violation — a `private`
  vector, filter, or stored field in a `public-read` index, and a
  `sensitive` or `forbidden` field in any participating role — and
  paired public/private evidence shows an `owner.v1` index over
  `private` fields releasing to its owner and never across the
  partition;
- a preregistered realistic-scale budget corpus of at least 1,536
  dimensions, with its partition filled to the maximum
  generation-validated bound for its dimensionality
  (min(⌊2^26 / dimensions⌋, 65,536); at 1,536 dimensions, exactly
  43,690 vectors — a one-vector or token-cardinality index does not
  satisfy this bullet), meets pinned build, update, query-latency,
  and memory budgets; the budget receipt records the exact vector
  count, vector bytes, and scalar-pair count, and boundary evidence
  shows the bound-filling insert admitted and the next insert refused.
  Dimensionality demonstrates realistic width; the filled partition
  demonstrates corpus-scale scan behavior; the 32-dimensional fixture
  exercises mechanics, not scale (0124's caveat, adopted);
- release-recheck drift, tampered postings, and digest mismatch fail
  closed with the coded corruption outcome and quarantine; and
- generated schemas, TypeScript pages, the client adapter, capability
  facts, the provider/contract projection, and guide rows agree
  byte-for-byte on the declared profile and its nonclaims.

## Implementation record — 2026-08-02: numeric authority only

The first collision-safe part of implementation-sequence step 1 is present.
`schemas/vector.distance-profile-v1.json` is generated from the Rust-owned
closed profile shape and binds `snapback-vector-distance-v1`, ordering profile
`nearest-first-row-id.v1`, and its full witness payload under a pinned RFC 8785
SHA-256 digest. `scripts/vector-distance-reference.mjs` derives decimal
conversion and primitive-operation results independently with BigInt exact
rational/dyadic arithmetic; the Rust and JavaScript semantic kernels consume
the committed expected bits rather than generating them.

The corpus distinguishes FMA contraction, reduction reordering, extended/x87
intermediates, FTZ/DAZ, and finite-H decimal double rounding for both metrics,
and additionally pins subnormals, ±2^100 including the next representable
outside value, negative-zero canonicalization, and bit-equal row-id ordering.
This is deliberately not a `vector_search_v1` implementation or qualification:
there is still no vector field/declaration carrier, index storage, query,
authorization/release seam, client surface, target receipt, capability-registry
entry, or support fact. The Guide therefore remains an explicit design-only
GAP.

## Implementation record — 2026-08-02: storage primitives only

The collision-safe storage primitive layer is present without a database
adapter. It admits and encodes vectors as fixed-width little-endian binary64,
revalidates all stored bytes while treating negative-zero bytes as corruption,
and hashes the admitted component JSON array through the repository's RFC 8785
authority rather than hashing storage bytes. One checked accumulator composes
the 1,024 posting-effect and 4 MiB vector-byte ceilings across every vector
index touched by a mutation; failed charges leave it unchanged. Closed source
identity/frontier values classify CAS work as apply, exact-idempotent, stale,
or corrupt and retain tombstones against older replay.

This checkpoint also makes the write-side diagnostic split above explicit,
matching LLP 0073 instead of misclassifying transaction planning as query work.
It creates no tables, schema/manifest carriers, query or runtime wiring, target
qualification, capability fact, or Guide claim.

## Implementation record — 2026-08-03: SQLite maintenance and approved rebuild

The local SQLite durability domain now has ordinary-table shadow generations,
canonical little-endian posting bytes, exact RFC 8785 posting identities,
gap-free CAS frontiers and tombstones, and one pre-write planning pass that
shares the fixed 1,024-effect / 4 MiB budget across every vector index touched
by a source transaction. Final destination-partition occupancy is checked
before the first derived write, including ownership transfers, and active
generation roots plus rebuild receipts are resealed in the source commit.
Same-version divergence and malformed derived state fail closed; a private
exact-generation identity crosses the read/write-lane boundary so delayed
quarantine cannot poison a newer successor.

Schema installation remains metadata-only. Publication belongs to the
approved `derived-vector-catchup.v1` executor: it binds plan, approval,
audience, predecessor, ceilings, operation-owned fixed snapshot, and an exact
journal-floor lease; advances in restart-safe baseline and complete-commit
catch-up batches; verifies authoritative content before the short generation
switch; retains one predecessor; and closes rollback on the first later source
commit. Missing, expired, tampered, or pruned-below leases quarantine the exact
candidate. Tests exercise cross-index budget refusal, full-destination
transfer rollback, CAS replay/divergence/tombstones, same-snapshot authoritative
release and quarantine identity, approval collisions, process restart,
concurrent journal catch-up, lease/floor loss, verified activation, and the
predecessor rollback boundary.

This is storage/executor evidence, not target qualification. It does not flip
any target predicate, publish `VectorSearchFactsV1`, change the capability
index or Guide GAP, wire a public runtime/client route, or satisfy the
realistic-scale and cross-target acceptance corpus.

## Implementation record — 2026-08-03: local exact profile complete

`vector_search_v1` is implemented and honestly published at experimental
maturity for `local-dev-sqlite-ibex.v1`. The shipped surface includes declared
fixed-width vector fields and exact indexes, `defineVectorQuery`, closed
request/result pages, the public client adapter, Rust-owned generated schemas,
Contract/provider projections, target facts, and the capability-manifest enum.
The runtime executes the pinned `snapback-vector-distance-v1` `dot` and `l2sq`
profiles over the active verified SQLite generation, applies equality filters
before scoring, orders bit-equal distances by row id, and releases only through
the declared `public-read` or `owner.v1` partition. Synchronous source
maintenance and `derived-vector-catchup.v1` share the same canonical posting,
root, frontier, quarantine, and mutation-global budget authorities.

The complete validation corpus is executable. Rust and independent JavaScript
distance authorities agree on all named float/conversion divergence witnesses;
dimension, component, k, effect, byte, scalar-pair, corpus, ownership-transfer,
activation, and query-work ceilings refuse under stable diagnostics; paired
owner databases agree on items, distances, work counters, codes, and ordinary
inspection; commit-head insert/update/delete/transfer and injected-failure
atomicity pass; corruption and release drift quarantine the exact generation;
and generated schemas, TypeScript pages, client/provider projections, target
facts, manifests, and Guide agree on the closed profile.

Two retained realistic-scale receipts fill the D=1,536 partition to the exact
43,690-vector product bound and prove the bound-filling insert plus next-insert
refusal:

- `tests/acceptance/vector-search-sqlite-scale.v1.json` qualifies the local
  macOS/aarch64 adapter (build 16,869 ms, update 1,833 ms, query 411 ms, peak
  RSS 2,102,558,720 bytes, database 1,491,980,288 bytes).
- `tests/acceptance/vector-search-single-instance-container-vm-scale.v1.json`
  independently qualifies the same local adapter in a Linux/x86_64 Fly
  container/VM at product revision
  `8ce5f357a2282eee389e5b7b826d3a568776da0c` (build 258,462 ms, update
  5,156 ms, query 4,953 ms, peak RSS 1,931,902,976 bytes, database
  1,491,980,288 bytes). Machine `849764f2e7dd58` used a temporary two-shared-
  CPU / 4,096 MiB qualification shape and was restored to shared-cpu-1x /
  512 MiB immediately afterward.

The Guide A5 row is shipped only for the local target. Remote-service,
Cloudflare, hosted, and PostgreSQL projections remain support-false with
structured GAPs. The exact executor has no accelerator (`accelerator: none`):
ANN, approximate search, live vector queries, embedding computation, and every
other §Non-goal remain unbuilt. The approximate door is still undecided and
the proved-superset accelerator door has not been opened.

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

## Implementation record — 2026-08-02

The local SQLite/Ibex target implements `vector_search_v1` at experimental
maturity. `v.vector(dimensions)` and `table.vectorIndex(name, spec)` carry the
fixed dimension, metric, complete participating-field classifications,
equality/stored fields, visibility, tie direction, semantic version, and
per-partition corpus bound into `TableManifest.vectorIndexes`.
`defineVectorQuery` emits the closed `VectorQuery` host plan and exact result
contract; generated references expose the dimension-bound request schema, and
`SnapbackClient.vectorSearch` validates the request before transport and
returns the cursor-free `{items}` page.

The SQLite adapter stores canonical little-endian binary64 postings in an
ordinary transactional shadow generation. Every source insert, update,
owner-partition transfer, delete, seed/reset, and activation path maintains or
preflights that generation in the same transaction. Query execution resolves
the caller's `public-read` or `owner.v1` partition before scanning, performs
the fixed-order scalar `l2sq` or `dot` kernel, applies declared equality
filters, source/version/partition release rechecks, and sorts by distance plus
the declared row-id tie direction. Generation-root, manifest-digest, or source
drift quarantines the index and fails closed.

Executable evidence retained by this landing includes:

- `crates/snapback/src/vector/sqlite.rs` tests the Research Room-shaped 32-dimensional
  public/owner fixture end to end, both metrics and tie directions, declared
  filters and stored fields, cross-owner noninterference counters, mutation
  freshness, transfer and corpus overflow rollback, activation/classification
  refusal, injected maintenance failure, and corruption quarantine;
- `schemas/vector.distance-fixtures-v1.json` is the Rust-owned conversion and
  arithmetic corpus. Rust and JavaScript run the same expected binary64 bits
  for the named FMA, reassociation, x87, FTZ/DAZ, decimal-conversion, negative
  zero, and component-ceiling divergence classes. The artifact records the
  exercised kernel/build evidence, and the local capability manifest binds its
  SHA-256 profile digest;
- `packages/snapback-codegen/vector-result-contracts.test.mjs` proves the
  declaration, schema/function manifests, generated TypeScript, client carrier,
  provider projection, capability facts, profile, and ANN nonclaim agree; and
- `tests/acceptance/vector/realistic-scale-budget-v1.json` records the
  preregistered 1,536-dimensional partition filled to 43,690 vectors
  (67,107,840 scalar pairs), one synchronous update and exact k=64 query, the
  admitted boundary insert, and the next-insert atomic refusal.

The capability is claimed only by `local-dev-sqlite-ibex`; remote-service,
Cloudflare, PostgreSQL, and hosted targets remain unsupported. No ANN or other
accelerator, approximate profile, embedding computation, cosine, range or
membership filters, live/offline query, or pagination surface was built. The
four open questions remain policy inputs rather than implementation gaps in
the exact v1 claim.
