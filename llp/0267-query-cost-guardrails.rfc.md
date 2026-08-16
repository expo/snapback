# LLP 0267: Query-cost guardrails before production admission

**Type:** RFC
**Status:** Accepted
**Systems:** Live queries, Relational queries, Performance, Diagnostics, Schema
**Author:** Codex gpt-5.6-sol xhigh, orchestrated by Claude Fable 5 (commissioned by the author performance-direction ruling 2026-08-15, Charlie Cheever)
**Date:** 2026-08-16
**Revised:** 2026-08-16 (v0.5 — Status Draft → Accepted, author ruling 2026-08-16)
**Related:** LLP 0209 (bounded live graph profile, especially §§1–2, 8–9),
LLP 0183 §D2 (bounded relational graph charter), LLP 0198 (typed,
evidence-heavy strategic frame), LLP 0200 (live evaluation scheduling and
settlement), LLP 0091 (CurrentAsOf offer pattern), LLP 0093 and LLP 0094
§0C.2 (offer-gated wire evolution), LLP 0004 (bounded application queries),
LLP 0108 (result contracts and value-free diagnostics),
`issues/20260815-query-cost-guardrails-commission.md`,
`issues/20260808-live-query-reevaluation-cost-at-scale.md`,
`issues/closed/20260808-p1-commit-turn-overhead.md`

## 0. Charter and position

Snapback will make expensive queries predictable before production. Every query produces one cost
observation containing scanned rows, index ranges consulted, result rows and bytes,
evaluation/delivery-turn time, and estimated live fan-out cost. One policy contract compares it
with one declaration surface and applies **warn, require an index, require pagination, refuse**.

LLP 0209 §1 measured one 5.5M-row subscription evaluation at p50 863 ms and max 3.6 s; E-3 found
six same-partition observers serialized like six mixed observers before G1. The workstream ticket
records correct mutation settlement from 111 ms to 148 s, median about 74 s
(`issues/20260808-live-query-reevaluation-cost-at-scale.md`). G1 shares only complete identical
inputs, and LLP 0209 v0.3 explains why distinct sessions remain distinct before G0 proves narrower
handler inputs. Correct eventual convergence does not admit a roughly one-second unpreemptible turn
or a live wave that queues several such turns.

Convex is the lesson, not an API to copy: predictable bounded refusal is preferable to
correct-but-multi-second queueing. This preserves LLP 0198 §II.2/§II.4's typed, evidence-heavy
strategy. This RFC decides new work; it does **not** claim the unified record, declarations,
instance configuration, qualification artifact, diagnostics, terminal cost envelope, client
terminal handling, or guide page ship today. It does build on shipped measurement seams named
below; “new” means the unified qualification-grade capture and policy, not an absence of existing
counters or timing.

## 1. One cost observation, with ladder-complete measurements and one estimate

### 1.1 The record

Every finite execution, live establishment, and live re-evaluation produces an internal
`QueryCostObservationV1`. The qualification key is function generation, host-recomputed plan
identity where one exists, target profile, fixture/data identity, authority class, and execution
kind. The closed measurement payload is:

```ts
type QueryCostObservationV1 = Readonly<{
  format: "snapback.query-cost-observation.v1"
  functionId: string
  functionGeneration: string
  planIdentity: string | null
  targetProfile: string
  fixtureIdentity: string | null       // qualification storage only
  authorityClass: string
  executionKind: "finite" | "liveEstablishment" | "liveReevaluation"
  status: "executed" | "memoDelivery" | "skipped" | "refused"
  complete: boolean
  scannedRows: number
  accessPathConsultations: readonly AccessPathConsultationV1[]
  indexRangeCount: number
  resultRows: number | null
  resultBytes: number | null
  evaluationTurnMs: number | null
  memoDeliveryTurnMs: number | null
  estimatedLiveFanoutMs: number | null
  estimateBasis: LiveFanoutBasisV1 | null
  structuralWork: StructuralWorkV1 | null
  targetWork: { vector: VectorWorkCountersV1 } | null
}>

type AccessPathConsultationV1 = Readonly<{
  ordinal: number
  nodeId: string | null
  table: string
  selectedPath:
    | Readonly<{ kind: "fullScan" }>
    | Readonly<{ kind: "point" | "unique" | "boundedIndex"; index: string }>
  boundShape: readonly Readonly<{
    component: string
    lower: "absent" | "exclusive" | "inclusive"
    upper: "absent" | "exclusive" | "inclusive"
  }>[]
  direction: "asc" | "desc" | "unordered"
  examinedEntries: number
}>

type LiveFanoutBasisV1 = Readonly<{
  executionKind: "liveReevaluation"
  rawRealEvaluationMaxMs: number
  rawMemoDeliveryMaxMs: number
  admissionFactor: 1.25
  realEvaluationBasisMs: number
  memoDeliveryBasisMs: number
  maxObservers: number
  maxDistinctEvaluationGroups: number
}>
```

Every actual storage consultation gets one entry; repeated identical reads remain separate and
receive consecutive ordinals. `indexRangeCount` is exactly
`accessPathConsultations.length`, and `scannedRows` is exactly the checked sum of every entry's
`examinedEntries`. A partially observed early refusal has `complete: false` and retains only work
actually charged through refusal; it cannot qualify a function. `resultRows` is the top-level array
length for a collection result, zero for an empty collection, and `null` for a non-collection or an
execution that produced no result. `resultBytes` is likewise `null` until a result is serialized.
An executed turn has `evaluationTurnMs`; a memo-only delivery has `memoDeliveryTurnMs`; the fields
are otherwise `null`. A skipped turn has neither. Qualification requires complete successful
observations with every field needed by the applicable ladder rung.

Status invariants are exact. `executed` carries the real access ledger and has
`memoDeliveryTurnMs: null`. `memoDelivery` carries an empty access ledger, zero `scannedRows` and
`indexRangeCount`, copies `resultRows`/`resultBytes` from the keyed executed observation it reuses,
and has `evaluationTurnMs: null`. `skipped` carries empty/zero access facts, null result/timing
facts, and `complete: true`. `refused` carries every fact charged before refusal and
`complete: false` unless refusal occurred only after a complete result/turn was measured. Real and
memo qualification samples are selected by status and never pooled with each other or across
`executionKind` values.

All counts are checked unsigned 64-bit integers; overflow is a bound refusal, never saturation.
Milliseconds are finite non-negative binary64 values read from a monotonic clock. The serialized
schema uses JSON numbers only while they are exact safe integers for count fields; larger target
counts refuse as unrepresentable evidence.

`scannedRows`, each consultation's work, result rows/bytes, and turn times are measured;
`indexRangeCount` is the exact derived ledger length. `estimatedLiveFanoutMs` is always labelled
`estimated`, carries `estimateBasis` that distinguishes measured timing maxima, the fixed factor,
and declared population inputs, and is never presented as measured settlement.
Public diagnostics may name the structural `functionId`, host-recomputed `planIdentity`, table,
index, and node id. They omit fixture/data identity and forbid arguments, literal endpoints,
principal/session/connection identities, row ids, and application values. That scoped prohibition
follows `src/result_contract.rs` and LLP 0108's value-free diagnostic discipline.

### 1.2 Scanned rows — measured at storage, new work

`scannedRows` counts physical candidates visited before filters, visibility, joins, or projection.
A point lookup contributes zero or one; a miss contributes zero rows but one range consultation.
Membership, relational-child, search-membership, and opaque-handler `ctx.db.query` reads share the
invocation accumulator. Repeats count repeatedly so N+1 work is not hidden by dependency
deduplication.

The repository already has four relevant work-accounting seams, and this RFC assigns each one an
explicit boundary:

- `src/storage.rs::query_on_with_examined_entry_ceiling` physically charges the closed
  `single_table_v1@1` path and refuses before entry 1,025 with
  `SNAPBACK_SINGLE_TABLE_EXAMINED_ENTRY_CEILING_EXCEEDED`. The unified accumulator **inherits** its
  candidate hook and adds the successful count that the shipped path does not return.
- `src/storage.rs::RelationalExecutionObservation` reports `examined_root_entries` and
  `joined_lookups`; `src/local.rs` compares them, plus bounded-child `rows.len()`, with owner-pinned
  per-node ceilings and emits `SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED`. Those are successful
  structural/result-count facts, not physical candidates. They are **inherited** losslessly into
  `structuralWork` and §5 relationship/root checks, but never substituted for `scannedRows`.
- `cfg(test)` `KeysetScanStats` reports SQLite full-scan steps, VM steps, and fetched rows. It stays
  as a target conformance oracle; the product observation **does not inherit** its test-only or
  SQLite-specific units.
- `src/vector/query.rs::VectorQueryEvaluationV1` and
  `src/vector/sqlite.rs::VectorSqliteQueryResultV1` already return
  `VectorWorkCountersV1`—postings enumerated, filter comparisons, candidates scored, scalar pairs,
  and release-source reads—beside each vector result, and
  `SNAPBACK_VECTOR_WORK_LIMIT` enforces vector-specific logical ceilings. The counters are
  **inherited** unchanged as `targetWork.vector`; their units are not re-labelled physical rows.
  The specialized vector refusal remains in place as a capability boundary, and a vector query
  must pass both that boundary and the generic query-cost ladder.

For a query carrying `queryCost`, the policy **wraps rather than removes** the two shipped
examined-entry refusal paths. Their owner-pinned numbers become structural fields inside the one
`queryCost` declaration. The low-level early-abort hooks remain, but the outer policy normalizes an
early abort to the applicable query-cost code and closed details. The legacy
`SNAPBACK_SINGLE_TABLE_EXAMINED_ENTRY_CEILING_EXCEEDED` and
`SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED` codes remain byte-compatible only for executions without
a v1 `queryCost` declaration; they are not a second numeric authority for admitted v1 executions.
The import mapping is exact: `single_table_v1@1.examinedEntryCeiling = 1_024` becomes that plan's
target/declared physical `maxScannedRows` ceiling; snapshot-batch
`node_examined_entry_ceilings`, despite their shipped name, bound returned/consumed root rows and
therefore become per-node `maxRootRowsPerPage`; and `node_joined_lookup_ceilings` become per-node
`maxRelationshipLookupsPerExecution`. Neither snapshot-batch field becomes a physical
`maxExaminedEntriesPerExecution` without the new candidate instrumentation. The shipped relational
check that `joined_lookups == examined_root_entries` remains an executor invariant, not a numeric
bound; a mismatch makes v1 evidence incomplete and normalizes to
`SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED`.

Every storage executor must increment the target-neutral accumulator at its physical candidate
seam. The generic SQLite success path does not yet expose that count, and the relational logical
facts above do not fill the gap. A target unable to report complete successful scan work produces
`SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED`; result count is never a substitute.

### 1.3 Index ranges consulted — measured after target plan selection, new work

An index consultation is recorded after target physical-plan selection, not from an author hint.
`src/storage.rs::validate_query_index` validates `QueryPlan.indexed_by`, but its comment says v0
SQLite does not yet consult the hint for planning. `src/live_matcher.rs` dependencies retain the
logical plan and invalidation facts; they do not prove SQLite's physical range.

An executor-owned ledger must obtain SQLite's selected path from actual prepared-statement
plan/scan instrumentation and record full scans explicitly; pinned host plans record the selected
index. Other targets emit the same vocabulary. Planner estimate alone makes the signal unavailable
and qualification refuse. The ledger is not compressed: each consultation carries its own
`examinedEntries`, which makes §3.2 evaluable even when one invocation mixes indexed and full-scan
reads.

### 1.4 Result bytes — measured after validation, partly present

`resultBytes` is exactly `serde_json::to_vec(value).len()` for the post-JSON value, measured after
result-contract validation and before envelope framing. It deliberately uses the shipped serializer,
not RFC 8785 JCS: LLP 0108 uses JCS for contract identity, while `src/result_contract.rs` uses
`serde_json::to_vec` for the 4 MiB result ceiling. A memo hit reuses the authored-result byte fact
and separately measures delivery.

`src/result_contract.rs` already computes this byte length for a 4 MiB post-JSON ceiling;
`src/local.rs::prepare_scheduler_live_delivery_enqueue` counts exact live wire bytes globally and
per current evaluation. Neither is this per-query authored-result signal. Implementation threads
the already-computed post-contract length into `QueryInvocation`; wire bytes remain a separate
delivery measurement and are never compared with `maxResultBytes`.

### 1.5 Evaluation time — measured at the complete turn, partly present

The timing boundary is execution-lane-specific, never defined by mutex ownership:

- Every ordinary finite invocation outside a mixed bundle already opens and finishes a
  per-invocation `FUNCTION_QUERY` telemetry span around `execute_query_invocation`, including the
  file-backed read lane in
  `src/local.rs::ReadLane::invoke_query_prepared_generation_with_facts`, which runs without the
  global mutex. Finite `evaluationTurnMs` **inherits that span's monotonic start/finish boundary**:
  after admission and input preparation, through execution, dependency capture, result validation,
  and query accounting, excluding any outer HTTP/lock queue and response transport.
- Live establishment outside a mixed bundle **inherits the distinct shipped `FUNCTION_QUERY` span
  inside `src/local.rs::subscribe_live_prepared_with_invalidation_generation` around its
  `execute_query_invocation`**. It includes the same execution, dependency, validation, and query-
  accounting work as the finite span, but excludes subscription-registry work, initial-snapshot
  serialization, outer HTTP response work, and transport. Those excluded establishment costs do
  not occupy the live scheduler; result rows/bytes still have their independent hard bounds.
- Mixed bundles require **new per-child instrumentation** in
  `src/local.rs::evaluate_mixed_bundle_v2`: each `prepared_children.iter().map(...)` child opens one
  `FUNCTION_QUERY` observation immediately before its own `execute_query_invocation` call and
  finishes it immediately after that call returns, before sibling collection, pinned-version
  coherence checks, or registration. A finite child records that interval as finite
  `evaluationTurnMs`; a live child records it as `liveEstablishment` `evaluationTurnMs` and carries
  the completed timing fact with its `QueryInvocation` through
  `subscribe_live_prepared_from_pinned_bundle`. The `pinned_bundle_invocation` branch in
  `subscribe_live_prepared_with_invalidation_generation` consumes that fact and must neither replace
  it nor add registration time. Thus each boundary includes only that child's execution, dependency
  capture, result validation, and query accounting; it excludes shared read-view acquisition,
  sibling work, version/route aggregation, live registration, and transport. Until this seam lands,
  every mixed-bundle child has incomplete timing evidence and refuses cost qualification under
  §3.4(5).
- Live re-evaluation **inherits**
  `src/local.rs::run_pending_live_subscription_with_path`'s
  `CurrentLiveEvaluation.started_at` through `finish_current_live_evaluation`. That boundary encloses
  the nested `FUNCTION_QUERY` span, authored-result and durable-envelope serialization, delivery
  accounting, and transfer into `enqueue_subscription_durable` custody for one subscription; it
  excludes scheduler queue time and later socket/poll transport. Serialize/enqueue is included
  because the scheduler cannot start the next subscription turn before that custody transfer. A
  real turn writes `evaluationTurnMs`; a future G1 memo-only turn writes `memoDeliveryTurnMs`, so
  cheap delivery cannot hide computation.
- `FUNCTION_QUERY` telemetry remains as the nested execution diagnostic and continues to emit
  `duration_ms`. The served app-data invocation ring in `src/server.rs::record_app_data_invocation`
  remains an outer service diagnostic carrying `function_id` and integer `duration_ms`; it can
  include request-level work and is **left in place**, not used as qualification evidence.
  `LiveEvaluationStats` and the spike trace likewise remain aggregate/diagnostic projections of the
  same live boundary, not separate cost profiles.

No `turn_prof` symbol remains in `src/`. The closed overhead ticket records targeted timing and the
staged-authorization cause; this RFC extends the shipped seams into a keyed observation and does not
claim they were absent.

### 1.6 Estimated live fan-out — one conservative formula

Each fixture/authority cell takes at least three warm samples **for each applicable
`executionKind`**. Qualification computes maxima inside that kind: finite,
`liveEstablishment`, and `liveReevaluation` executed samples are three separate populations and
must never be pooled. The qualification record stores each population's `rawEvaluationMaxMs`;
for both live kinds it also stores
`admissionEvaluationBasisMs = rawEvaluationMaxMs × 1.25`. `memoDelivery` is a
`liveReevaluation`-only status in v1 and has its own `rawMemoDeliveryMaxMs` and
`memoDeliveryBasisMs = rawMemoDeliveryMaxMs × 1.25`. Any memo sample carrying another kind is
invalid evidence. The factor is an admission margin, not a p95 claim.

`LiveFanoutBasisV1` is specifically the `liveReevaluation` projection: its
`rawRealEvaluationMaxMs`/`realEvaluationBasisMs` and memo counterparts come only from that kind.
Those basis values, not finite or establishment samples, enter the fan-out formula. Live declarations
must satisfy `0 < maxObservers` and
`0 < maxDistinctEvaluationGroups <= maxObservers`. When the two population values are equal, the
memo term is zero and `rawMemoDeliveryMaxMs`/`memoDeliveryBasisMs` are exactly zero; otherwise the
memo-delivery fixture and its three samples are required.

Raw `evaluationTurnMs` samples are compared with the function's inclusive
`maxEvaluationTurnMs`; scaling does not rewrite that semantic declaration. Each live kind's
post-scale basis is compared separately with the refuse-at safety boundary; only the
`liveReevaluation` basis is used in the fan-out estimate. A runtime live turn is a new raw
measurement at that kind's named §1.5 boundary: it is compared with both the declaration and the
safety boundary and is never scaled. Finite timing is compared with the declaration but not the
live-scheduler safety boundary.

For one invalidation wave:

```text
estimatedLiveFanoutMs =
  realEvaluationBasisMs * maxDistinctEvaluationGroups
  + memoDeliveryBasisMs * (maxObservers - maxDistinctEvaluationGroups)
```

Both population multiplicands are declared, never inferred from a small dev run. Before G0, opaque
handlers group only on the complete G1 memo key (generation, args, every handler-visible authority
field, cut, drain cycle), so distinct sessions remain distinct. G0 may prove fewer groups under
LLP 0209 §§3, 6, and 9. Unknown means `maxDistinctEvaluationGroups = maxObservers`.

This estimates one wave's queue occupancy, not convergence. LLP 0200 moved fan-out off commit, so
a read-evaluation or fan-out overage never refuses the mutation that triggered re-evaluation. It
gates function activation and prospective live registration. LLP 0209's separate
maintained-write bound can refuse a mutation before commit under §5; that write-side structural
guard is not a fan-out consequence.

The 1,000 ms admission boundary in §§2.2/3.4 applies **after scaling**, separately to
`liveEstablishment` and `liveReevaluation`: a raw fixture maximum of 800.000 ms produces a
1,000.000 ms basis and refuses, while a raw maximum below 800.000 ms may pass this boundary. At
runtime, post-admission drift is not scaled again: either live kind measured at 1,000.000 ms at its
own §1.5 boundary refuses. Section 6's 999.999/1,000/1,000.001 fixtures are per-kind post-scale
policy inputs or same-kind runtime measured turns, never raw fixture samples.

## 2. One declaration surface; instance policy may only tighten it

### 2.1 Function/plan declaration owns semantic bounds

Every query eligible for production activation must carry one closed
`queryCost` declaration in its generated function/plan artifact. This is a new
manifest surface. Codegen authors it from explicit schema/function syntax;
the host validates it and recomputes its identity. It is not a client argument
and not an environment variable.

The v1 declaration contains:

- `maxScannedRows`, `maxIndexRanges`, `maxResultRows`, `maxResultBytes`, and
  `maxEvaluationTurnMs`;
- `maxObservers`, `maxDistinctEvaluationGroups`, and
  `maxEstimatedLiveFanoutMs` for live queries (all zero/absent for finite-only
  queries);
- an index posture: the allowed schema index identities for each declared
  consultation, with `fullScan` admitted only when that consultation's declared
  examined-entry bound is at most the effective unindexed threshold;
- a pagination posture: `keyset` with a declared maximum page-row/page-byte
  bound and stable continuation identity, or `notPageable` under §3.3's closed
  proof; and
- the structural graph bounds when the query is a G0 graph (§5).

These are hard maxima, not targets. A declaration may be tighter than the
instance policy and may not use `unbounded`. Values are sized from normal and
large fixtures before production, not inferred from production traffic. A
function-generation or plan-identity change invalidates its qualification
record.

Local development may execute an undeclared query in the explicit
qualification/authoring lane to produce observations and warnings. The same
artifact is not production-admissible until its declaration and matching
evidence exist. There is no production “learn mode.”

### 2.2 Instance configuration owns uniform operational ceilings

A new typed instance configuration block, `queryCostGuardrails`, owns the
uniform resource posture. It is deployment configuration, not schema or
function syntax. Its v1 defaults are:

| Instance policy | Default | Rule |
| --- | ---: | --- |
| `warnFraction` | 0.50 | warn when any signal reaches half its effective blocking/hard bound |
| `maxUnindexedScannedRows` | 256 | absolute; a larger full-scan consultation requires an index |
| `maxUnpagedRows` | 256 | absolute; a larger collection result requires keyset pagination |
| `maxUnpagedResultBytes` | 262,144 (256 KiB) | absolute; a larger collection result requires keyset pagination |
| `maxIndexRanges` | 512 | absolute per-invocation consultation maximum |
| `maxResultBytes` | 4,194,304 (4 MiB) | absolute; preserves the shipped handler-result maximum |
| `maxUnpreemptibleLiveTurnMs` | 1,000 | absolute inclusive refusal boundary |
| `maxEstimatedLiveFanoutMs` | 1,000 | absolute inclusive one-wave refusal boundary |

Every numeric default in this table is a product ceiling. Instance
configuration may only tighten it: `warnFraction` must be greater than zero
and at most 0.50 (lower warns earlier), while every other instance value must
be at most its listed default. A target capability may tighten again. For an
ordinary inclusive maximum with a corresponding function field, the effective
maximum is the minimum of the present function, target-capability, and instance
operands; absent inapplicable operands are omitted. The index/pagination rung
thresholds have no function operand: their effective values are the minimum of
target capability and instance value, while the function's closed
access/pagination posture must fit beneath them. An observation refuses when it
is greater than an applicable inclusive maximum. For the two millisecond safety
boundaries, the function's `maxEvaluationTurnMs` and
`maxEstimatedLiveFanoutMs` remain inclusive declared maxima, but the
target/instance safety boundary is a refuse-at threshold: either
`observed > declared max` or
`observed >= min(target refuse-at, instance refuse-at)` refuses. Therefore an
operator cannot raise 256 to 10^7, raise any other listed ceiling, or turn
warnings later. Any loosening requires a new RFC/author ruling and a
capability-version change, not an instance flag.

The existing `max_eval_turn` default of 30 seconds in
`src/live_coalesce.rs::LiveCoalesceTunables` and `src/server.rs` remains a
catastrophic containment timeout: after one timeout the scheduler retries a
refresh, and after a second it tears the subscription down with
`SNAPBACK_LIVE_EVALUATION_TIMEOUT` (`src/local.rs`; LLP 0200 §2.5). It is not
the query-cost budget and cannot loosen the new 1,000 ms admission ceiling.

## 3. Enforcement ladder and exact precedence

All available signals are collected before the policy engine chooses a
verdict. The highest crossed rung wins: hard refusal, then pagination, then
index, then warning. Missing evidence is a hard refusal. Lower-rung diagnostics
may appear as remediation notes but cannot mask the deciding rung. Within one
rung, deterministic signal order is the schema order in §1.1 followed by §5's
canonical node order.

### 3.1 Rung 1 — warn

Warn when a measured/estimated signal reaches `warnFraction` of its next
effective blocking or hard bound. With defaults, examples are 128 unindexed
entries in one full-scan consultation, 128 unpaged result rows, 128 KiB
unpaged result bytes, 256 index
consultations, or 500 ms for a live turn/fan-out estimate. A declaration at
half its own maximum warns similarly.

Warnings use `SNAPBACK_QUERY_COST_WARNING`, include the signal, observed or
estimated quantity, unit, effective limit, function/plan identity, and next
remediation rung, and never include application values. Warnings are emitted
by codegen/verify and retained in local/operator diagnostics. They do not
change query results.

### 3.2 Rung 2 — require an index

For each `AccessPathConsultationV1` independently, if `selectedPath.kind` is
`fullScan` and `examinedEntries` is greater than the effective
`maxUnindexedScannedRows`, activation/qualification refuses with
`SNAPBACK_QUERY_COST_INDEX_REQUIRED`. No invocation-total inference is needed:
the counter is attached to the consultation that performed the work. Codegen
may issue the same code earlier when a closed plan proves a full scan's
declared consultation bound already exceeds the threshold; runtime measurement
remains authoritative for opaque handlers and target planner choices.

The fix is a declared schema index selected by the executed plan, followed by
new fixture evidence. Merely spelling `.withIndex(...)` is insufficient while
the target does not prove that it used the index (§1.3). An indexed range may
still hit later rungs.

### 3.3 Rung 3 — require pagination

A collection-shaped query whose measured `resultRows` is greater than the
effective `maxUnpagedRows`, or whose measured `resultBytes` is greater than the
effective `maxUnpagedResultBytes`, refuses with
`SNAPBACK_QUERY_COST_PAGINATION_REQUIRED` unless this result is one page of an
admitted keyset continuation. Offset pagination does not satisfy the rung
because it does not bound skipped work. The declaration must name a stable
keyset order, tie-break, page-row maximum, page-byte maximum, and §5
summed-window maxima when it is a G0 graph.

Point and scalar contracts use `resultRows: null` and may declare
`notPageable`. A collection/aggregate is “closed-small” and may declare
`notPageable` only when the host-recomputed declaration proves both
`maxResultRows <= effective maxUnpagedRows` and
`maxResultBytes <= effective maxUnpagedResultBytes`; qualification evidence
must then stay within both. The shipped `single_table_v1@1` profile has
whole-result/no-public-cursor semantics and an examined-entry ceiling of
1,024, so class membership is **not** a pagination exemption. An individual
single-table plan qualifies as `notPageable` only if its own closed
`maxResultRows` and `maxResultBytes` meet the two limits. A wider plan refuses
production qualification with `SNAPBACK_QUERY_COST_PAGINATION_REQUIRED` until
a reviewed cursor-capable successor profile exists. `.take(1_024)` remains a
result-count bound, not proof of cheap scan work or a waiver.

### 3.4 Rung 4 — refuse

Refuse when any of the following holds:

1. an integer/byte measurement is greater than its effective inclusive maximum,
   or an evaluation measurement is greater than its declared inclusive maximum;
2. index consultations are greater than the effective (at most 512) maximum or
   `serde_json` result bytes are greater than the effective (at most 4 MiB)
   maximum;
3. a `liveEstablishment` post-scale `admissionEvaluationBasisMs`, a
   `liveReevaluation` post-scale `realEvaluationBasisMs` or
   `memoDeliveryBasisMs`, or an actual runtime measurement of either live kind
   at its named §1.5 boundary is at least the effective (at most 1,000 ms)
   safety boundary;
4. `estimatedLiveFanoutMs` is at least the effective (at most 1,000 ms)
   boundary for the declared observer population; or
5. matching, target-specific qualification evidence is absent, stale by
   identity, incomplete, or unable to measure a field required by the
   applicable ladder rung.

The millisecond safety boundary is inclusive and evaluated per live
`executionKind`: a **post-scale basis or same-kind runtime turn** at 999.999 ms
is below it; 1,000.000 ms refuses. Raw qualification samples are scaled exactly
once per §1.6, so with the 1.25 factor the raw fixture boundary is 800.000 ms.
No finite, establishment, re-evaluation, real, or memo population can average
with another to pass.

Generic bound excess uses `SNAPBACK_QUERY_COST_BOUND_EXCEEDED`; the one-second
live cases use `SNAPBACK_QUERY_COST_LIVE_TURN_REFUSED`; missing or unusable
evidence uses `SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED`. Index and pagination
violations retain their more actionable rung-specific codes even though they
also block activation.

Production activation validates the fixture-bound qualification record before
serving. Live registration recomputes the prospective observer/evaluation-
group totals and refuses before inserting the subscription. A later data or
hardware drift can still make one already-admitted turn cross the limit; the
runtime cannot undo elapsed unpreemptible work.

The quarantine rollup is exact. Its four-field key is
`CostQuarantineKeyV1 = (functionId, functionGeneration, planIdentity,
targetProfile)`. A qualification cell is that key plus `(fixtureIdentity,
authorityClass, executionKind)`. Runtime drift in any cell quarantines the
four-field key. Clearing requires one new atomic qualification artifact whose
host-declared cell manifest covers **every currently required fixture/data ×
authority-class × applicable-execution-kind cell for that four-field key** and
whose cells all pass; rerunning only the violating cell cannot clear it. Cells
for another target or another function/plan generation do not participate. A
new generation/plan is a different key and must pass its own complete matrix
before activation; it does not erase the historical quarantine record.

The shipped `LiveEnvelope::ResyncRequired` is deliberately **not** used for
this case: it carries only a free-form reason, and both full and micro clients
automatically fresh-subscribe on receipt. This RFC adds a distinct
`query_cost_terminal` durable envelope carrying
`{ subscription_id, code, details }` in the existing durable-lane snake-case
convention. Per LLP 0093 D1 and LLP 0094 §0C.2, the kind is offer-gated. The
open-time offer is `OpenConnectionRequest.queryCostTerminalProtocol: 1`
(snake-case alias accepted); the exact value is stored immutably on the
connection lineage and echoed as `ConnectionGrant.queryCostTerminalProtocol:
1`. Unknown values refuse open with `SNAPBACK_QUERY_COST_CLIENT_UNSUPPORTED`.
Absent means a legacy connection that can use an instance with guardrails
disabled, but **every live subscribe on a `queryCostGuardrails`-enabled
instance synchronously refuses before snapshot/subscription establishment
unless its connection has the echoed offer**. There is no legacy live fallback.
This follows `CurrentAsOf`: a server emits a new kind only after the client has
proved it can decode the required transition.

Rollout is staged: QT1 servers accept and echo the optional offer while the
cost policy remains disabled; QT2 full and micro clients offer it and require
the exact echo before claiming support; only QT3 may enable
`queryCostGuardrails` and the subscribe gate. The configuration is fixed before
the instance accepts connections in v1, so enabling it cannot strand already-
established legacy subscriptions. An old client therefore either uses a
guardrails-disabled instance or receives a typed subscribe refusal before any
snapshot; it can never receive and ignore `query_cost_terminal`.

The server atomically (1) records the completed turn, (2) quarantines its
`CostQuarantineKeyV1` with the deciding code/details, (3) installs one terminal
obligation for every subscription using that key and retires those
subscriptions, and (4) makes fresh registrations for the key refuse with the
identical code/details; terminal publication follows that state transition.
Terminal obligations use out-of-band sticky custody keyed by
`(connection effect fence, subscription_id)`, bounded by the already-enforced
live-subscription caps, rather than the ordinary durable deque; each retired
terminal tombstone continues to consume its connection/global subscription
slot until acknowledgement or teardown. They outrank
`src/ephemeral.rs`'s `RecoveryMarkerPriority::{Poison, Unbound, Exact}`, remain
until transport acknowledgement or connection teardown, and cannot be erased
or converted by `OutboundQueue::overflow` into its `resync_required` sentinel.
If teardown wins, the connection-independent quarantine record supplies the
same typed refusal on the next subscribe. A pending connection-wide overflow
marker remains valid for other subscriptions, but terminal obligations are
selected first and a terminal client ignores every later recovery marker for
that retired handle.

Full and micro clients classify both the envelope and the same-code quarantine
subscribe refusal as terminal: clear in-memory and persisted retained
continuity, mark the handle refused, surface the typed error, cancel pending
fresh-subscribe work and retry timers, and **never auto-resubscribe** that
handle. Existing `resync_required` semantics remain unchanged only for
nonterminal recoverable resnapshot cases. Thus every client generation either
fails establishment before holding a cost-policy snapshot or performs the
terminal transition; no silent-stale-retention outcome exists. The drift-
triggering mutation still settles. This new offer, wire/server custody, and
full/micro behavior must land before post-drift enforcement, preserving LLP
0200's settlement isolation without a resubscribe loop.

## 4. Refusal contract, guide, and local/server parity

### 4.1 Stable diagnostic register

Add these codes to the generated register and typed unions in the style of
`guide/reference/diagnostics.md`:

| Code | Severity/domain | Meaning and primary remediation |
| --- | --- | --- |
| `SNAPBACK_QUERY_COST_WARNING` | warning / queries | approaching the next effective guardrail; inspect the named signal |
| `SNAPBACK_QUERY_COST_INDEX_REQUIRED` | error / queries | measured full-scan work exceeded the reported effective `limit`; declare and prove an index |
| `SNAPBACK_QUERY_COST_PAGINATION_REQUIRED` | error / queries | measured unpaged rows or bytes exceeded the reported effective `limit`; add keyset pagination |
| `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` | error / queries | a declared/effective hard signal bound was exceeded |
| `SNAPBACK_QUERY_COST_LIVE_TURN_REFUSED` | error / realtime | a turn or declared fan-out wave reached the reported effective safety boundary |
| `SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED` | error / queries | production evidence is missing, identity-stale, incomplete, or unmeasurable |
| `SNAPBACK_QUERY_COST_CLIENT_UNSUPPORTED` | error / realtime | the connection did not offer exactly `queryCostTerminalProtocol: 1`; update the client and reconnect before subscribing |

HTTP uses 400 when plan/client changes are required and 409 for missing/stale activation evidence;
the `query_cost_terminal` envelope carries the same code/details after drift. Identical inputs fail
identically. None is 429: these are admission defects, not rate limits. Query-cost verdict details
are the closed value-free shape `{ functionId, planIdentity?, signal, kind:
measured|estimated|missing, observed?, limit, unit, rung, remediation }`. `functionId` and
`planIdentity` are expressly permitted structural identifiers. Arguments, literal endpoints,
content, fixture/data identity, principal/session/connection identity, and row ids are forbidden.
The protocol-offer refusal instead carries the closed value-free shape
`{ requiredProtocol: 1, offeredProtocol: missing|unsupported, remediation }`.

### 4.2 One guide page

Add `guide/backend/query-costs.md`, linked from query/live guidance and every new diagnostic. It
teaches:

- how to read the observation, its ladder-supporting `resultRows` and
  per-consultation scan attribution, and distinguish measurement from estimate;
- why `.take()` bounds output but may not bound scanned rows;
- how to add an index and prove it was selected;
- how to convert a list to stable keyset pagination;
- how observer/evaluation-group declarations affect live fan-out; and
- how local fixture qualification produces the production admission record.

The page states target coverage and cannot claim scan/range measurement before paired conformance.

### 4.3 One policy contract, server and local evaluators

LLP 0209 §8 requires one graph IR evaluated by server and D3 local evaluators, with identical graph
refusals. It does **not** already require a shared host function. This RFC newly decides a pure,
versioned `QueryCostPolicyV1` in service of that parity requirement. It consumes the
host-recomputed declaration, observation, target capability, instance configuration,
qualification, and current observer groups and returns a verdict plus diagnostics without I/O or
ambient configuration. For G0 argument checks, the relevant inputs are specifically the
declaration's host-recomputed `argumentId → maxItems` map and the observation's
`structuralWork.argumentItemsByArgument`; the policy receives no argument values and never tries to
reconstruct per-argument cardinality from the aggregate `argumentItems`.

The server evaluator and every D3-capable local evaluator must apply this same policy contract and
the same target facts. They may share one portable implementation or use separate implementations
qualified by the corpus; implementation sharing is not the normative claim. An ordinary remote
client does not override server admission, but a client/runtime claiming LLP 0209 D3 local graph
evaluation **does** implement these refusals and returns `refused` rather than evaluating a graph
the server would reject.

The parity corpus compares exact code, rung, signal, observed value, limit, unit, and detail shape
for below/at/above thresholds; scan/index and implicit-take/keyset pairs;
identical-key/distinct-session fan-out; missing/stale/unmeasurable evidence; and post-admission
drift. It also drives the new terminal envelope through full and micro clients and proves that
neither auto-resubscribes. The same target facts cannot pass locally and refuse on server, or vice
versa.

Qualifications are target-specific: different measurements may decide differently; identical
observations may not.

## 5. LLP 0209 G0 bounds and guardrails are one system

`queryCost` is the one declaration/enforcement surface for ordinary pre-G0 queries and later graph
plans. LLP 0209 §2 requires eight distinct G0 bound kinds: root, examined-entry, relationship,
fanout, argument, byte, summed-window, and maintained-write. The `queryCost.graph` member carries
all eight; there is no `g0Bounds` twin. Canonical node order means the order encoded in the
host-recomputed graph IR.

Every structurally owned plan may populate `structuralWork`; a G0 graph must
populate every applicable entry in this closed value-free shape:

```ts
type StructuralWorkV1 = Readonly<{
  rootRowsByNode: readonly Readonly<{ nodeId: string; observed: number }>[]
  examinedEntriesByNode: readonly Readonly<{ nodeId: string; observed: number }>[]
  relationshipLookupsByNode: readonly Readonly<{ nodeId: string; observed: number }>[]
  maxFanoutByNode: readonly Readonly<{ nodeId: string; observed: number }>[]
  argumentItemsByArgument: readonly Readonly<{ argumentId: string; observed: number }>[]
  argumentItems: number
  argumentExpansionByNode: readonly Readonly<{ nodeId: string; observed: number }>[]
}>
```

The exact consumption rules are:

| LLP 0209 §2 bound | Declared field and observed fact | Check and rollup |
| --- | --- | --- |
| root | The sole G0 root node declares `maxRootRowsPerPage`; its `rootRowsByNode` value is the number of authorized root rows consumed for this page before relationship projection. | Require exactly one G0 root entry and check it directly (`observed <= max`). It is a logical structural count, not a physical scan and not inferred from top-level `resultRows`. There is one G0 root, so no sum/max rollup. Non-G0 snapshot-batch adapters may carry one root entry per owned node without claiming the G0 invariant. |
| examined-entry | Every read node declares `maxExaminedEntriesPerExecution`; its observed value is the checked sum of `examinedEntries` for consultations carrying that `nodeId`. | Check every node independently, then set `scannedRows` to the checked sum across all nodes and check whole-query `maxScannedRows`. A consultation is charged once. `RelationalExecutionObservation.examined_root_entries` remains a companion root fact until physical attribution lands, never the examined-entry value. |
| relationship | Every relationship node declares `maxRelationshipLookupsPerExecution`; one lookup is charged for every attempted edge resolution, including a null-key/omitted resolution. | Check each node independently; report `relationshipLookups` as the checked sum in canonical node order. A lookup's storage consultation separately contributes to `indexRangeCount` and `scannedRows`; the relationship count is not added to either again. Shipped `joined_lookups` feeds this fact. |
| fanout | Every to-many/semi-join node declares `maxChildrenPerParent`; the observer counts authorized children emitted for each parent but retains only that node's maximum, without a parent id. | Check every parent while executing and report `maxFanoutByNode`; the graph rollup is `max()` across node maxima, not a sum. To-one nodes have a fixed maximum of one. |
| argument | Every collection argument has a host-recomputed structural `argumentId` and declares `maxItems`; scalar arguments have cardinality one. The graph declares `maxArgumentItems`, and each expanding node declares `maxArgumentExpansion`. | Require exactly one `argumentItemsByArgument` entry per declared top-level argument in canonical declaration order. Match by `argumentId` and check **each collection entry against its own `maxItems`** before summing; then require `argumentItems` to equal that checked sum and check the graph maximum. For each node, `argumentExpansion` is the checked product of the matched cardinalities of the distinct arguments that multiply that node's consultations (empty product one); check it per node. Actual consultations are still counted rather than predicted. Values are never recorded. |
| byte | The graph declares whole-result `maxResultBytes`; a keyset posture also declares `maxPageResultBytes`. | Serialize the authored result once with `serde_json::to_vec`; check that single `resultBytes` value against both applicable inclusive maxima. Do not sum nested-node serializations or wire-envelope bytes. |
| summed-window | A pageable graph declares the tuple `maxWindowPages`, `maxWindowRootRows`, `maxWindowScannedRows`, `maxWindowResultRows`, `maxWindowResultBytes`, and `maxWindowIndexRanges`. | Use the cumulative mechanism below. Every field is a checked sum across published pages; no per-page value substitutes for it. |
| maintained-write | The graph declares `maxMaintainedWritesPerMutation`; one maintained write is one graph-owned row/index effect attempted because a source mutation changes a maintained graph fact. | The write path emits sibling `QueryCostMaintenanceObservationV1 { graphPlanIdentity, mutationVersion, maintainedWrites }`, checked per graph before commit. `maintainedWrites` is a checked sum of effects, not read `scannedRows`; exceeding it refuses the mutation before commit with `SNAPBACK_QUERY_COST_BOUND_EXCEEDED`. |

For argument accounting, an absent optional argument has cardinality zero, an array has its exact
length, and every other canonical JSON argument—including `null` and objects—has cardinality one.
The observer records that count beside the host-recomputed structural `argumentId`, never the name
or value. Each declared top-level argument is summed once. Missing, duplicate, unknown, or
out-of-order ids are incomplete evidence and refuse. A node's expansion product includes only the
distinct top-level arguments that its IR edges mark multiplicative; reuse elsewhere does not
multiply that node again.

The summed-window mechanism is a host-authenticated
`QueryCostWindowLedgerV1` carried inside the opaque keyset continuation. It binds function
generation, plan identity, canonical-args hash, authority partition, target profile, and the stable
window identity, and contains `pages`, `rootRows`, `scannedRows`, `resultRows`, `resultBytes`, and
`indexRanges`. The first page starts from all-zero prior totals. Before executing a resumed page,
the host verifies the binding, refuses immediately if `pages == maxWindowPages`, and derives the
remaining root/scan/row/byte/range budgets. The page executors receive the remaining count budgets
and stop before charging a unit that would exceed one, but that stop is a **refusal boundary, never
a short-page boundary**: unless the executor independently proves source exhaustion or the end of a
declared named interval, failure to complete the requested page within every remaining budget makes
the page `refused`, with no result or successor cursor published. Result rows and bytes are checked
before publication. The host then checked-adds a completed page's observation to the prior ledger
and checks all six declared summed-window maxima. Any overflow, binding mismatch, incomplete page,
or exceeded maximum refuses the page.

Every published nonterminal keyset page is labelled `prefix` and carries its successor, including a
page that exactly reaches a window maximum while proving more data exists; a later resume then
returns `refused`. A no-successor result may be published only when execution independently proves
the entire named graph exhausted (`complete`) or the declared named interval ended (`window`), never
because a cost budget ran out. The final ledger is retained in qualification/inspection. These are
exactly LLP 0209 §4's `prefix` / `window` / `refused` outcomes, so budget exhaustion cannot be
indistinguishable from end-of-data. Server and D3 local evaluators use the same ledger encoding,
labels, and checks.

Structural and aggregate limits are conjunctive; neither can loosen the other. For examined work,
the static whole-graph ceiling is effectively
`min(maxScannedRows, checked_sum(node.maxExaminedEntriesPerExecution))`: a smaller aggregate limit
tightens the node sum, while smaller node limits remain enforceable even when the aggregate is
larger. Runtime checks evaluate canonical nodes in order and, within each node, the bound-kind
order root, examined-entry, relationship, fanout, argument; then summed-window limits in the tuple
order above; then whole-query aggregates. If structural and aggregate limits
are both crossed, the first structural violation is the primary diagnostic and the aggregate miss
may be a remediation note. This precedence changes diagnostics, never admission: crossing either
refuses with the same `QueryCostPolicyV1`.

Live query-cost fields (`maxObservers`, `maxDistinctEvaluationGroups`, and
`maxEstimatedLiveFanoutMs`) are **not** a ninth LLP 0209 §2 G0 bound and do not appear in the table.
They are orthogonal live-admission fields on `queryCost`; G0 authority/input proofs may reduce
`maxDistinctEvaluationGroups`, but the §1.6 formula and §3.4 safety boundary remain unchanged.

Guardrails are the pre-G0 measured-enforcement rung of the same system: opaque queries get
whole-invocation limits, while G0 adds closed IR, node attribution, proved inputs, structural
checks, and the cumulative window ledger. One qualification run executes every normal/large G0
cell, records the complete observation, computes fan-out, and checks all eight declared bound
kinds. Placeholder large ceilings cannot pass merely because instance absolutes did not fire; LLP
0209 §9's values remain fixture-derived.

## 6. Landing and acceptance sequence

Land: (1) target-neutral accumulator, per-consultation SQLite scan/range measurement, and adapters
for shipped relational/vector facts and examined-entry guards; (2) exact `serde_json` result bytes,
`resultRows`, keyed finite/live/memo timing, and the new mixed-bundle per-child span while otherwise
preserving shipped timing boundaries; (3)
declaration, cumulative window ledger, target qualification, and identity invalidation; (4) pure
policy contract, tighten-only defaults, diagnostics, activation/registration gates, cost
quarantine, the staged terminal-protocol offer, sticky `query_cost_terminal` custody, and terminal
full/micro client handling; (5) server/D3 parity
corpus; then (6) guide and generated references. No slice may claim a later surface, and
post-drift enforcement cannot land before its terminal client behavior.

Acceptance requires execution-derived physical scan measurement (never result-count or hint
substitution), exact per-consultation attribution for empty/correlated/repeated/full-scan reads,
exact top-level result rows, and a fan-out estimate reproducing both conservative six-observer
serialization and complete-key G1 sharing. The millisecond matrix is explicit:

- separately for `liveEstablishment` and `liveReevaluation`, post-scale policy inputs and runtime
  measurements at their named §1.5 boundaries at
  999.999/1,000.000/1,000.001 ms pass/refuse/refuse;
- with the 1.25 qualification factor, raw fixture maxima at
  799.999/800.000/800.001 ms produce pass/refuse/refuse; and
- no fixture maximum pools execution kinds, and no policy path scales an already-scaled basis or a
  runtime drift measurement again.

The corpus also pins equality and just-over behavior for every inclusive integer/byte maximum;
mixed-bundle finite/live-establishment per-child timing without sibling or registration time; mixed
indexed/full-scan attribution; `resultRows` null/zero/nonzero; lowered instance limits and
rejection of every attempted raise; `notPageable` just below/at/above both closed-small limits;
`single_table_v1@1` narrow-plan admission and wider-plan pagination refusal; legacy versus
queryCost-wrapped examined-entry codes; `serde_json` byte cases that differ from JCS; every §5
per-node/sum/max/product/cumulative rule and conflict precedence; swapped per-argument cases such as
`a=6,b=4` versus `a=4,b=6` under distinct `maxItems`; prefix/window/refused page outcomes at every
summed-window edge; vector-counter preservation; all-cells quarantine clearing; and quarantine
persistence across attempted auto-resubscribe.

Index/pagination remedies must lower normal and large-fixture cost rather than silence diagnostics;
the drift-triggering mutation must still commit; refusals must be value-free and local/served
code/detail-parity-tested; terminal fixtures must cover known/unknown/absent offers, ordinary
delivery, durable-capacity overflow, connection teardown followed by subscribe refusal, and full/
micro cancellation of auto-resubscribe; and G0
must consume this declaration/report without another registry. Claims follow LLP 0189;
deterministic thresholds are product contract while measured magnitudes remain snapshot-scoped.

## Open questions

None at v0.4. The signal dispositions, capture points, defaults, declaration
versus instance split, diagnostic vocabulary, refusal parity, and G0
relationship are decided here. Calibration data may motivate a later dated
amendment, but implementation may not silently retune the defaults or create a
second bounds surface.

## Revision history

- **v0.5 (2026-08-16).** Status Draft → Accepted by author ruling (Charlie Cheever, 2026-08-16 session), on the converged dual-family review record in the run journal.
- **v0.4 (2026-08-16).** Resolves the round 3 residual by binding mixed-bundle finite and live-establishment executions to a new exact per-child timing seam carried through pinned live registration.
- **v0.3 (2026-08-16).** Applies review round 2: binds and isolates all three
  execution-kind timing seams; records and checks each argument's cardinality;
  defines all-cell qualification-to-quarantine rollup; offer-gates terminal
  wire behavior and gives it overflow-proof sticky custody plus terminal retry
  handling; and makes summed-window budget exhaustion a legal `refused`
  outcome rather than a short end-of-data lookalike.
- **v0.2 (2026-08-16).** Applies review round 1: reconciles shipped relational,
  examined-entry, finite/live timing, invocation-ring, result-byte, and vector
  seams; adds per-consultation examined work, result rows, and memo-delivery
  timing; makes all defaults tighten-only; resolves raw-versus-scaled time
  boundaries; defines a terminal cost envelope plus generation quarantine;
  attributes LLP 0209 §8 correctly; specifies all eight G0 consumption and
  cumulative-window rules; scopes diagnostic identities; parameterizes
  messages; and closes `notPageable`/`single_table_v1@1` pagination behavior.
- **v0.1 (2026-08-16).** Initial commissioned draft. Decides four measured
  signals plus one explicitly estimated fan-out signal; a single
  declaration/observation/policy system shared with LLP 0209 G0; the
  warn→index→pagination→refuse thresholds and instance-tightening rule; six
  typed diagnostics and one guide page; and exact local/server refusal parity.
