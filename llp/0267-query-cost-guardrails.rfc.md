# LLP 0267: Query-cost guardrails before production admission

**Type:** RFC
**Status:** Accepted (§7 only: Proposed per LLP 0295 W5; owners to accept)
**Systems:** Live queries, Relational queries, Performance, Diagnostics, Schema
**Author:** Codex gpt-5.6-sol xhigh, orchestrated by Claude Fable 5 (commissioned by the author performance-direction ruling 2026-08-15, Charlie Cheever)
**Date:** 2026-08-16
**Revised:** 2026-08-21 (v0.14 — §7 round-8: the four-outcome derivation is
a strict ordered decision list — step-0 client lifecycle classes
(initial-`PENDING`, lifecycle-settled/inverse-skew) precede the member
enumeration and row-present residuals, removing the two overlapping
matches; no semantic change).
2026-08-21 (v0.13 — §7 round-7 edge completions: active stage
is itself an owed obligation (writeless restorations covered), member 6
requires an active stage, residual classification total across
`ATTACHED_POLL`/`GRANTED`/initial-`PENDING`/inverse-skew shapes, and the
retirement seams named exactly — T-REAP/expiry server-side,
refresh-cannot-enter-transport teardown).
2026-08-21 (v0.12 — §7 round-6: orthogonal
`evaluation`/`pendingWork` stage fields with the complete LLP 0200
§2.4–2.5 exit and lifecycle rows, and an exhaustive four-outcome
derivation — reason/neutral/defect/snapshot-skew).
2026-08-21 (v0.11 — §7 round-5: total registry transition table
— delivery is compare-and-clear preserving a mid-evaluation charge, and a
T-LOSS-retired/absent row is a defined derivation branch yielding
`transport-recovery`). 2026-08-21 (v0.10 — §7 round-4: exact unsampled
per-subscription registry facts
`owedThroughVersion`/`pendingState`/`currentWaveSeq` make the
derived `pendingDeliveryReason` computable from the two gated snapshots).
2026-08-21 (v0.9 — §7 round-3 delta review: retention becomes a
distinct `QueryCostObservationInspectV1` projection so §1.1's closed
invariants are untouched; caller-influencable identifiers pseudonymized on
every snapshot; collision-free subscription-id → registry → `waveSeq` join
with the `LIVE(version)` domain pinned; `pendingDeliveryReason` made a
derived inspect-time join result; delivery-lag scalar pinned to the most
recent covered commit; hash availability claim corrected).
2026-08-21 (v0.8 — §7 revision round from the dual xhigh
review: budget wording consumes D0.5 verbatim, byte-accounted rings and
capped counter maps, gated-only surfaces with D0.5 tuple projection, §5
canonical-args hash reuse with honest fingerprint framing, server/client
record split with a defined join key, closed `pendingDeliveryReason`
precedence enum, `MutationPhaseCostV1` typed). 2026-08-21 (v0.7 — §7 dated
design-proposal amendment: runtime cost visibility at the app boundary,
proposed per LLP 0295 W5; owners to accept). 2026-08-16 (v0.6 —
author-authorized trim, no normative change)
**Related:** LLP 0209 (bounded live graph profile, especially §§1–2, 8–9),
LLP 0183 §D2 (bounded relational graph charter), LLP 0198 (typed,
evidence-heavy strategic frame), LLP 0200 (live evaluation scheduling and
settlement), LLP 0091 (CurrentAsOf offer pattern), LLP 0093 and LLP 0094
§0C.2 (offer-gated wire evolution), LLP 0004 (bounded application queries),
LLP 0108 (result contracts and value-free diagnostics),
LLP 0295 §W5 (commissioning plan for §7),
LLP 0059 (D0.2 ruling 6 — mutation phase timing fields, consumed by §7),
LLP 0218 (disposition union carrying those fields),
LLP 0095 and LLP 0278 (D0.5 owner-inspection floor and subscription budgets,
consumed by §7), LLP 0114 (React provider identity),
LLP 0031 (D3 public/gated inspection split — §7's snapshot carrier),
`issues/20260815-query-cost-guardrails-commission.md`,
`issues/20260808-live-query-reevaluation-cost-at-scale.md`,
`issues/20260821-app-boundary-runtime-cost-diagnostics-design.md`,
`issues/closed/20260808-p1-commit-turn-overhead.md`

## 0. Charter and position

Snapback will make expensive queries predictable before production. Every query produces one cost
observation containing scanned rows, index consultations, result rows/bytes, evaluation or delivery
time, and estimated live fan-out cost. One declaration and policy apply **warn, require an index,
require pagination, refuse**.

LLP 0209 §1 measured a 5.5M-row subscription evaluation at p50 863 ms and max 3.6 s, with six
same-partition observers serializing like six mixed observers before G1. Correct convergence does
not admit roughly one-second unpreemptible turns or waves that queue several of them. Predictable
bounded refusal—not a copied Convex API—preserves LLP 0198 §II.2/§II.4's typed, evidence-heavy
strategy.

This RFC decides new work; it does **not** claim the unified record, declarations, configuration,
qualification, diagnostics, terminal protocol/client handling, or guide ship today. “New” means
qualification-grade unified capture and policy over the shipped seams named below.

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

Each actual consultation gets an entry; repeats stay separate with consecutive ordinals.
`indexRangeCount == accessPathConsultations.length`, and `scannedRows` is the checked sum of their
`examinedEntries`. Early refusal retains charged work with `complete: false` and cannot qualify.
`resultRows` is a top-level collection's length (including zero), otherwise `null`; `resultBytes`
is `null` until serialization. Executed and memo-only turns carry only `evaluationTurnMs` and
`memoDeliveryTurnMs`, respectively; skipped turns carry neither. Qualification requires a complete
successful observation with every applicable field.

Status invariants are exact: `executed` has the real ledger and no memo time; `memoDelivery` has an
empty ledger, zero scan/range counts, copied keyed `resultRows`/`resultBytes`, and no evaluation
time; `skipped` has empty/zero access, null result/timing facts, and `complete: true`; `refused`
retains charged facts and is incomplete unless refusal followed a fully measured result/turn. Real
and memo samples never pool with each other or across `executionKind`.

Counts are checked `u64`; overflow refuses rather than saturates. Milliseconds are finite,
non-negative binary64 values from a monotonic clock. Count fields serialize as JSON numbers only
while exact safe integers; larger target counts are unrepresentable evidence and refuse.

Scan/consultation work, result rows/bytes, and turn times are measured; the range count is derived.
`estimatedLiveFanoutMs` is always labelled `estimated`, carries measured maxima, the fixed factor,
and declared populations in `estimateBasis`, and is never called measured settlement. Public
diagnostics may name `functionId`, host-recomputed `planIdentity`, table, index, and node id; they
omit fixture/data identity and forbid arguments, literal endpoints, principal/session/connection
identities, row ids, and application values (LLP 0108's value-free discipline).

### 1.2 Scanned rows — measured at storage, new work

`scannedRows` counts physical candidates before filters, visibility, joins, or projection. A point
lookup contributes zero or one; a miss contributes zero rows but one consultation. Membership,
relational-child, search-membership, and opaque `ctx.db.query` reads share the accumulator, and
repeats count repeatedly so deduplication cannot hide N+1 work.

Four shipped seams map into, but do not duplicate, this accounting:

- `query_on_with_examined_entry_ceiling` physically charges `single_table_v1@1` and refuses before
  entry 1,025 with `SNAPBACK_SINGLE_TABLE_EXAMINED_ENTRY_CEILING_EXCEEDED`; inherit its hook and add
  the successful count it does not return.
- `RelationalExecutionObservation`'s `examined_root_entries`/`joined_lookups` and bounded-child
  `rows.len()` are successful structural/result-count facts enforced with
  `SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED`; inherit them into `structuralWork` and §5 root/
  relationship checks, never `scannedRows`.
- Test-only SQLite `KeysetScanStats` (full-scan steps, VM steps, fetched rows) remains a conformance
  oracle; its target-specific units are not product-observation units.
- `VectorWorkCountersV1` (postings, comparisons, scored candidates, scalar pairs, release-source
  reads) is inherited unchanged as `targetWork.vector`, never relabelled as rows. The specialized
  `SNAPBACK_VECTOR_WORK_LIMIT` remains, and vector queries must also pass this generic ladder.

For v1 `queryCost`, low-level early-abort hooks remain but the outer policy normalizes them to the
applicable query-cost code/details; their owner-pinned numbers live inside the one declaration.
The two legacy codes above remain byte-compatible only without v1 `queryCost`, not as a second
numeric authority. Exact imports are: `single_table_v1@1.examinedEntryCeiling = 1_024` → that plan's
physical `maxScannedRows`; snapshot-batch `node_examined_entry_ceilings` → per-node
`maxRootRowsPerPage`; `node_joined_lookup_ceilings` → per-node
`maxRelationshipLookupsPerExecution`. The latter two never become physical
`maxExaminedEntriesPerExecution` without candidate instrumentation. The executor invariant
`joined_lookups == examined_root_entries` remains; mismatch yields incomplete v1 evidence and
`SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED`.

Every executor increments the target-neutral accumulator at its physical candidate seam. Generic
SQLite does not yet expose the successful count; relational logical facts cannot substitute. A
target lacking complete scan work refuses with `SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED`.

### 1.3 Index ranges consulted — measured after target plan selection, new work

Record consultations after target physical-plan selection, never from `QueryPlan.indexed_by` or
live-matcher hints, which do not prove SQLite's chosen range. Executor-owned prepared-statement
plan/scan instrumentation records SQLite's path and explicit full scans; pinned host plans record
their selected index, and other targets use the same vocabulary. An estimate alone is unavailable
evidence and refuses qualification. Each uncompressed entry carries `examinedEntries`, including
when one invocation mixes indexed and full-scan reads.

### 1.4 Result bytes — measured after validation, partly present

`resultBytes` is `serde_json::to_vec(value).len()` after result-contract validation and before
framing—the shipped 4 MiB serializer, not LLP 0108's identity-only JCS. Thread that existing length
into `QueryInvocation`; memo hits reuse it while measuring delivery separately. Existing exact live
wire-byte accounting remains a different signal and is never compared with `maxResultBytes`.

### 1.5 Evaluation time — measured at the complete turn, partly present

Timing is lane-specific, never defined by mutex ownership:

- Ordinary finite invocations outside mixed bundles inherit the monotonic `FUNCTION_QUERY` span
  around `execute_query_invocation`, including mutex-free
  `ReadLane::invoke_query_prepared_generation_with_facts`. It starts after
  admission/input preparation and covers execution, dependencies, validation, and accounting, but
  excludes outer HTTP/lock queueing and response transport.
- Non-mixed live establishment inherits the distinct `FUNCTION_QUERY` span in
  `subscribe_live_prepared_with_invalidation_generation`. It covers the same work as finite timing,
  excluding registry work, initial-snapshot serialization, outer HTTP work, and transport; result
  rows/bytes keep their independent bounds.
- Mixed bundles add a per-child span in `evaluate_mixed_bundle_v2`, immediately around each
  `prepared_children.iter().map(...)` child's `execute_query_invocation`, before sibling collection,
  pinned-version coherence checks, or registration. Finite and live children record it as their
  respective `evaluationTurnMs`; live timing travels with
  `QueryInvocation` through `subscribe_live_prepared_from_pinned_bundle`, and the
  `pinned_bundle_invocation` branch consumes it without replacement or registration time. It covers
  only that child's execution/dependencies/validation/accounting, excluding shared read-view,
  siblings, version/route aggregation, registration, and transport. Until this new seam lands,
  every mixed child has incomplete evidence and refuses under §3.4(5).
- Live re-evaluation inherits `run_pending_live_subscription_with_path`'s
  `CurrentLiveEvaluation.started_at` through `finish_current_live_evaluation`: nested query,
  authored-result/durable-envelope serialization, delivery accounting, and transfer to
  `enqueue_subscription_durable` custody, excluding scheduler queue and later transport. Custody is
  included because it blocks the next turn. Real and G1 memo-only turns write `evaluationTurnMs`
  and `memoDeliveryTurnMs`, respectively.
- Nested `FUNCTION_QUERY duration_ms`, `crates/snapback/src/server.rs::record_app_data_invocation`'s outer
  `function_id`/integer `duration_ms`, `LiveEvaluationStats`, and the spike trace remain diagnostics, not separate
  qualification profiles. The outer ring may include request-level work.

No `turn_prof` symbol remains. This RFC extends existing seams into the keyed observation.

### 1.6 Estimated live fan-out — one conservative formula

Each fixture/authority cell takes at least three warm samples per applicable `executionKind`.
Finite, `liveEstablishment`, and `liveReevaluation` executed populations never pool. Qualification
stores each `rawEvaluationMaxMs`; both live kinds also store
`admissionEvaluationBasisMs = rawEvaluationMaxMs × 1.25`. V1 `memoDelivery` is
`liveReevaluation`-only, with its own raw maximum and ×1.25 basis; another kind is invalid evidence.
The factor is an admission margin, not p95.

`LiveFanoutBasisV1` projects only `liveReevaluation` real/memo maxima and bases. Live declarations
require `0 < maxObservers` and `0 < maxDistinctEvaluationGroups <= maxObservers`. Equal populations
make both memo maxima/bases exactly zero; otherwise a three-sample memo fixture is required.

Raw samples compare with inclusive `maxEvaluationTurnMs`; scaling never rewrites that declaration.
Each live kind's basis separately meets the refuse-at safety check, while only re-evaluation enters
fan-out. Runtime live turns are new, unscaled raw measurements at their §1.5 boundary and compare
with both declaration and safety boundary. Finite timing compares only with its declaration.

For one invalidation wave:

```text
estimatedLiveFanoutMs =
  realEvaluationBasisMs * maxDistinctEvaluationGroups
  + memoDeliveryBasisMs * (maxObservers - maxDistinctEvaluationGroups)
```

Both populations are declared. Pre-G0 opaque handlers group only on the complete G1 memo key
(generation, args, every handler-visible authority field, cut, drain cycle), so distinct sessions
remain distinct; G0 may prove fewer groups under LLP 0209 §§3, 6, 9. Unknown means groups equal
observers.

The estimate is one wave's queue occupancy, not convergence. Read/fan-out overage gates activation
and prospective registration, never the triggering mutation; only §5's independent maintained-write
bound may refuse a mutation before commit (LLP 0200 settlement isolation).

The 1,000 ms admission boundary applies after scaling per live kind: raw 800.000 ms becomes
1,000.000 ms and refuses. Runtime drift is not rescaled: 1,000.000 ms at either §1.5 live boundary
refuses. Section 6's 999.999/1,000/1,000.001 inputs are post-scale bases or same-kind runtime turns,
never raw fixture samples.

## 2. One declaration surface; instance policy may only tighten it

### 2.1 Function/plan declaration owns semantic bounds

Every production query carries one closed `queryCost` declaration in its generated function/plan
artifact. Codegen authors this new manifest surface from explicit schema/function syntax; the host
validates it and recomputes identity. It is neither client input nor an environment variable.

The v1 declaration contains:

- `maxScannedRows`, `maxIndexRanges`, `maxResultRows`, `maxResultBytes`, `maxEvaluationTurnMs`;
- live-only `maxObservers`, `maxDistinctEvaluationGroups`, `maxEstimatedLiveFanoutMs` (zero/absent
  for finite-only queries);
- allowed schema index identities per declared consultation; `fullScan` requires that
  consultation's declared examined-entry bound to fit the effective unindexed threshold;
- `keyset` pagination with page-row/page-byte maxima and stable continuation identity, or
  `notPageable` under §3.3's closed proof; and
- the structural graph bounds when the query is a G0 graph (§5).

These are hard maxima, never `unbounded`, sized from normal/large fixtures rather than production
traffic. They may tighten instance policy. Function-generation or plan-identity change invalidates
qualification.

An explicit local authoring/qualification lane may run undeclared queries for observations and
warnings; production requires the declaration and matching evidence. There is no production learn
mode.

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

Every default is a product ceiling. Instance configuration may only tighten it:
`0 < warnFraction <= 0.50` (lower warns earlier), and every other value is at most its default; a
target capability may tighten again. Ordinary effective inclusive maxima are the minimum of present
function, target, and instance operands. Index/pagination thresholds omit a function operand and
use `min(target, instance)` while the declaration posture must fit beneath them. Crossing means
`observed > effective max`. For millisecond safety, declared timing/fan-out maxima remain inclusive,
but target/instance values are refuse-at: either `observed > declared max` or
`observed >= min(target refuse-at, instance refuse-at)` refuses. No operator may raise 256 to 10^7,
raise another ceiling, or delay warnings; loosening needs a new RFC/author ruling and capability
version.

The existing 30 s `max_eval_turn` is only catastrophic containment: one timeout retries a refresh;
a second tears down with `SNAPBACK_LIVE_EVALUATION_TIMEOUT` (LLP 0200 §2.5). It cannot loosen the
1,000 ms query-cost admission ceiling.

## 3. Enforcement ladder and exact precedence

Collect all available signals before verdict. Precedence is hard refusal > pagination > index >
warning; missing evidence is hard refusal. Lower rungs may be remediation notes but never mask the
winner. Ties use §1.1 schema order, then §5 canonical node order.

### 3.1 Rung 1 — warn

Warn when a measured/estimated signal reaches `warnFraction` of its next bound. At defaults this is
128 unindexed entries, 128 unpaged rows, 128 KiB unpaged bytes, 256 consultations, or 500 ms; a
declaration at half its own maximum likewise warns. `SNAPBACK_QUERY_COST_WARNING` includes signal,
measured/estimated quantity, unit, effective limit, function/plan identity, and next rung—never app
values. Codegen/verify and local/operator diagnostics retain it; results do not change.

### 3.2 Rung 2 — require an index

Independently refuse any `fullScan` consultation whose `examinedEntries` exceeds effective
`maxUnindexedScannedRows`, using `SNAPBACK_QUERY_COST_INDEX_REQUIRED`; no invocation-total inference
is allowed. Codegen may issue it earlier for a provably over-bound closed plan, but runtime remains
authoritative for opaque handlers/planner choices. Remediation requires an executed, declared schema
index plus new evidence; `.withIndex(...)` alone is insufficient, and indexed ranges still face
later rungs.

### 3.3 Rung 3 — require pagination

Unless it is one page of an admitted keyset continuation, a collection exceeding effective
`maxUnpagedRows` or `maxUnpagedResultBytes` refuses with
`SNAPBACK_QUERY_COST_PAGINATION_REQUIRED`. Offset does not bound skipped work. Declarations name
stable keyset order/tie-break, page row/byte maxima, and for G0 the §5 window maxima.

Point/scalar contracts use `resultRows: null` and may be `notPageable`. A collection/aggregate may
be closed-small `notPageable` only if the host proves declared result rows/bytes at or below both
effective limits and evidence stays within both. `single_table_v1@1`'s whole result, no cursor, and
1,024 examined-entry ceiling is no exemption: only individually bounded narrow plans qualify;
wider plans refuse until a reviewed cursor-capable successor. `.take(1_024)` bounds results, not
scan work or this rung.

### 3.4 Rung 4 — refuse

Refuse when:

1. an integer/byte value exceeds its effective inclusive maximum, or evaluation exceeds its
   declared inclusive maximum;
2. consultations exceed the effective maximum (at most 512), or `serde_json` bytes exceed the
   effective maximum (at most 4 MiB);
3. `liveEstablishment.admissionEvaluationBasisMs`, live-re-evaluation
   `realEvaluationBasisMs`/`memoDeliveryBasisMs`, or a same-kind runtime §1.5 turn reaches its
   effective refuse-at boundary (at most 1,000 ms);
4. `estimatedLiveFanoutMs` reaches its effective refuse-at boundary (at most 1,000 ms); or
5. matching target-specific qualification is absent, identity-stale, incomplete, or cannot
   measure an applicable field.

The live boundary is per kind: post-scale basis or same-kind runtime turn 999.999 ms passes and
1,000.000 ms refuses. Raw qualification is scaled exactly once, making 800.000 ms the raw boundary;
no finite/establishment/re-evaluation or real/memo population averages with another.

Generic, one-second-live, and evidence failures use `SNAPBACK_QUERY_COST_BOUND_EXCEEDED`,
`SNAPBACK_QUERY_COST_LIVE_TURN_REFUSED`, and `SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED`; index and
pagination keep their actionable codes. Activation validates fixture-bound qualification;
registration recomputes prospective observer/group totals before insertion. Later drift may still
cross a limit after elapsed work that cannot be undone.

Quarantine key and rollup are exact:
`CostQuarantineKeyV1 = (functionId, functionGeneration, planIdentity, targetProfile)`; each
qualification cell adds `(fixtureIdentity, authorityClass, executionKind)`. Drift in any cell
quarantines the key. Clearing requires one atomic artifact whose host-declared manifest covers and
passes **every currently required fixture/data × authority-class × applicable-kind cell** for that
key; one rerun cannot clear it. Other targets/generations/plans do not participate. A new key must
pass its full matrix and does not erase historical quarantine.

Do not use `ResyncRequired`: its free-form reason makes full/micro clients auto-resubscribe. Add the
snake-case durable `query_cost_terminal { subscription_id, code, details }`, offer-gated per
LLP 0093 D1/0094 §0C.2. `OpenConnectionRequest.queryCostTerminalProtocol: 1` (snake-case alias
accepted) is immutable on the connection lineage and echoed exactly as
`ConnectionGrant.queryCostTerminalProtocol: 1`. Unknown
values refuse open with `SNAPBACK_QUERY_COST_CLIENT_UNSUPPORTED`; absent is legacy and works only
where guardrails are disabled. **On an enabled instance, every live subscribe synchronously refuses
before snapshot/establishment without the echoed offer; there is no legacy live fallback.**

Rollout: QT1 server accepts/echoes the optional offer with policy disabled; QT2 full/micro clients
offer and require the echo; only QT3 enables policy and subscribe gate. V1 configuration is fixed
before connections, so old clients either use a disabled instance or receive a typed pre-snapshot
refusal, never an ignored terminal frame.

Atomically: (1) record the turn, (2) quarantine its key with deciding code/details, (3) install one
terminal obligation per using subscription and retire them, and (4) make fresh registrations refuse
with identical details; publish only afterward. Obligations use sticky out-of-band custody keyed by
`(connection effect fence, subscription_id)`, bounded by existing live-subscription caps. A retired
tombstone consumes its connection/global slot until acknowledgement or teardown, outranks
`RecoveryMarkerPriority::{Poison, Unbound, Exact}`, and cannot be erased or converted by
`OutboundQueue::overflow` to `resync_required`. Teardown leaves connection-independent quarantine
to refuse the next subscribe. Other subscriptions retain any connection-wide overflow marker, but
terminals select first and their client ignores later recovery markers for the retired handle.

Full/micro clients treat both envelope and same-code subscribe refusal as terminal: clear memory
and persisted continuity, mark refused, surface the typed error, cancel fresh-subscribe/retry work,
and **never auto-resubscribe** that handle. `resync_required` remains only nonterminal recovery. The
drift-triggering mutation still settles. Offer, custody, and both client behaviors must precede
post-drift enforcement, preserving LLP 0200 settlement isolation without stale retention or loops.

## 4. Refusal contract, guide, and local/server parity

### 4.1 Stable diagnostic register

Add these codes to the generated register and typed unions:

| Code | Severity/domain | Meaning and primary remediation |
| --- | --- | --- |
| `SNAPBACK_QUERY_COST_WARNING` | warning / queries | approaching the next effective guardrail; inspect the named signal |
| `SNAPBACK_QUERY_COST_INDEX_REQUIRED` | error / queries | measured full-scan work exceeded the reported effective `limit`; declare and prove an index |
| `SNAPBACK_QUERY_COST_PAGINATION_REQUIRED` | error / queries | measured unpaged rows or bytes exceeded the reported effective `limit`; add keyset pagination |
| `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` | error / queries | a declared/effective hard signal bound was exceeded |
| `SNAPBACK_QUERY_COST_LIVE_TURN_REFUSED` | error / realtime | a turn or declared fan-out wave reached the reported effective safety boundary |
| `SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED` | error / queries | production evidence is missing, identity-stale, incomplete, or unmeasurable |
| `SNAPBACK_QUERY_COST_CLIENT_UNSUPPORTED` | error / realtime | the connection did not offer exactly `queryCostTerminalProtocol: 1`; update the client and reconnect before subscribing |

HTTP is 400 for required plan/client changes and 409 for missing/stale activation evidence; none is
429. Identical inputs fail identically, including post-drift terminal code/details. Query-cost
details are closed and value-free:
`{ functionId, planIdentity?, signal, kind: measured|estimated|missing, observed?, limit, unit, rung,
remediation }`; the two identities are permitted, while arguments, literal endpoints, content,
fixture/data, principal/session/connection, and row ids are forbidden. Offer refusal instead uses
`{ requiredProtocol: 1, offeredProtocol: missing|unsupported, remediation }`.

### 4.2 One guide page

Add `guide/backend/query-costs.md`, linked from query/live guidance and every diagnostic. It teaches
observation reading (`resultRows`, per-consultation scan, measurement vs estimate); why `.take()`
does not bound scans; selected-index proof; stable keyset conversion; observer/group fan-out; and
local-fixture production qualification. It states target coverage and cannot claim scan/range
measurement before paired conformance.

### 4.3 One policy contract, server and local evaluators

LLP 0209 §8 requires one IR and identical server/D3-local refusals, not a shared host function. This
RFC newly defines pure, versioned `QueryCostPolicyV1`: declaration, observation, target capability,
instance configuration, qualification, and current groups in; verdict/diagnostics out, without I/O
or ambient config. G0 also inputs host-recomputed `argumentId → maxItems` and
`structuralWork.argumentItemsByArgument`; it receives no values and never reconstructs per-argument
facts from aggregate `argumentItems`.

Server and every D3 local evaluator apply this contract and the same target facts, via a portable
implementation or corpus-qualified twins. Ordinary remote clients do not override admission; a D3
claim must return `refused` for any server-refused graph.

The parity corpus exact-compares code, rung, signal, observed, limit, unit, and details across
below/at/above; scan/index and implicit-take/keyset pairs; identical-key/distinct-session fan-out;
missing/stale/unmeasurable evidence; post-admission drift; and full/micro terminal handling without
auto-resubscribe. Qualifications are target-specific: differing measurements may decide
differently, identical observations may not.

## 5. LLP 0209 G0 bounds and guardrails are one system

`queryCost` is the sole pre-G0/G0 declaration and enforcement surface. `queryCost.graph` carries
LLP 0209 §2's root, examined-entry, relationship, fanout, argument, byte, summed-window, and
maintained-write bounds; there is no `g0Bounds` twin. Canonical order is host-recomputed IR order.
Any structurally owned plan may populate `structuralWork`; G0 must populate every applicable entry:

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

Argument cardinality is zero for absent optional, array length for arrays, and one for every other
canonical JSON value including `null`/objects. Record it only beside host-recomputed `argumentId`;
sum each top-level argument once. Missing/duplicate/unknown/out-of-order ids refuse as incomplete.
Node expansion multiplies only distinct arguments marked multiplicative by its IR edges; reuse does
not multiply again.

The opaque keyset cursor carries host-authenticated `QueryCostWindowLedgerV1`, bound to generation,
plan, canonical-args hash, authority partition, target, and stable window identity, with `pages`,
`rootRows`, `scannedRows`, `resultRows`, `resultBytes`, and `indexRanges`. The first page starts
from all-zero prior totals across all six ledger fields.
On resume, verify binding, refuse if `pages == maxWindowPages`, and derive remaining
root/scan/row/byte/range budgets. Executors receive those count budgets and stop before charging a
unit that would exceed one; this is a **refusal boundary, never a short-page boundary**:
without independent source exhaustion or named-interval end, inability to complete the requested
page within every budget publishes neither result nor successor. Check rows/bytes before publication,
then checked-add the page and check all six maxima. Overflow, mismatch, incompleteness, or excess
refuses.

Every published nonterminal page is `prefix` with successor—even exactly at a maximum when more data
exists, so the next resume refuses. No-successor requires independently proved graph exhaustion
(`complete`) or named-interval end (`window`), never budget exhaustion. Retain the final ledger in
qualification/inspection; server and D3 local use identical encoding, labels, and checks.

Structural and aggregate limits are conjunctive. Examined work is effectively
`min(maxScannedRows, checked_sum(node.maxExaminedEntriesPerExecution))`. Runtime checks evaluate canonical
nodes in order and, within each node, the bound kinds in the order root, examined-entry,
relationship, fanout, argument; then summed-window limits in the tuple order above; then
whole-query aggregates.
If both cross, the first structural miss is primary and aggregate may be a note; either refuses.

`maxObservers`, `maxDistinctEvaluationGroups`, and `maxEstimatedLiveFanoutMs` are orthogonal live
fields, **not a ninth G0 bound**. G0 proof may reduce groups, never alter §§1.6/3.4.

Pre-G0 opaque queries use whole-invocation limits; G0 adds closed IR, node attribution, proved
inputs, structural checks, and the window ledger. One run executes every normal/large cell, records
a complete observation, computes fan-out, and checks all eight kinds. Placeholder ceilings cannot
pass merely because instance absolutes did not fire; values remain fixture-derived (LLP 0209 §9).

## 6. Landing and acceptance sequence

Land: (1) target-neutral accumulator, per-consultation SQLite scan/range measurement, and shipped
relational/vector/guard adapters; (2) exact `serde_json` bytes, `resultRows`, keyed finite/live/memo
timing, and mixed-bundle per-child spans without changing other boundaries; (3) declaration, window
ledger, target qualification, and identity invalidation; (4) pure policy, tighten-only defaults,
diagnostics, activation/registration gates, quarantine, staged terminal offer, sticky custody, and
terminal full/micro handling; (5) server/D3 parity corpus; (6) guide/generated references. No slice
claims a later surface; post-drift enforcement waits for terminal client behavior.

Acceptance requires physical scan measurement from execution (never results/hints), exact
per-consultation attribution for empty/correlated/repeated/full scans, exact top-level result rows,
and fan-out reproducing conservative six-observer serialization and complete-key G1 sharing.
Timing acceptance is:

- separately for `liveEstablishment` and `liveReevaluation`, post-scale policy inputs and runtime
  measurements at their named §1.5 boundaries at
  999.999/1,000.000/1,000.001 ms pass/refuse/refuse;
- with the 1.25 qualification factor, raw fixture maxima at
  799.999/800.000/800.001 ms produce pass/refuse/refuse; and
- no fixture maximum pools execution kinds, and no policy path scales an already-scaled basis or a
  runtime drift measurement again.

The corpus also pins: every inclusive integer/byte equality and just-over case; mixed-bundle finite/
establishment child timing without sibling/registration time; mixed indexed/full-scan attribution;
`resultRows` null/zero/nonzero; lowered instance limits and every attempted raise; `notPageable`
below/at/above both limits; narrow/wide `single_table_v1@1`; legacy/wrapped examined-entry codes;
`serde_json` cases differing from JCS; every §5 per-node/sum/max/product/cumulative and conflict rule;
`a=6,b=4` versus `a=4,b=6` under distinct `maxItems`; every prefix/window/refused edge; vector
counters; all-cell quarantine clearing; and persistence through attempted auto-resubscribe.

Remedies must lower normal/large-fixture cost, not silence diagnostics. The triggering mutation must
commit; refusals must be value-free with local/served code/detail parity. Terminal fixtures cover
known/unknown/absent offers, ordinary delivery, durable-capacity overflow, teardown then subscribe
refusal, and full/micro auto-resubscribe cancellation. G0 consumes this declaration/report without
another registry. Claims follow LLP 0189: thresholds are product contract; measured magnitudes are
snapshot-scoped.

## 7. Amendment (2026-08-21) — runtime cost visibility at the app boundary

**Proposed per LLP 0295 W5; owners to accept.** This is a dated design
proposal to this RFC (server/query cost phases) and to the client/React
owners — LLP 0095/LLP 0114 (client lifecycle, provider identity) and
LLP 0278 (subscription budgets) — for the visibility program LLP 0295 §W5
commissioned in
`issues/20260821-app-boundary-runtime-cost-diagnostics-design.md`. It adds a
**diagnostics/inspection surface only**: no new bounds surface, no policy
rung, no change to §§1–6 enforcement, and no ambient telemetry. Sections
7.2–7.6 consume the already-landed Phase 0 rulings (LLP 0059 ruling 6;
LLP 0095/0278 D0.5) without re-deciding them; where those rulings pinned a
field or vocabulary, this amendment cites it and adds nothing on top.

### 7.1 Posture first: redaction, bounded storage, local/hosted

The plan requires the posture settled before any instrumentation, so it comes
first and everything after is subordinate to it.

**Local developer diagnostics first; hosted telemetry explicitly deferred
(recommendation on LLP 0295 open question 5: yes).** The argument:

1. Every motivating observation — the matrix's reactive loops, the Diary 0105
   missed-delivery investigation, the zb5 evidence anchor — was hit on a
   **local developer loop**, and the intended consumer is an agent or
   developer running `snapback dev` who needs attribution without source
   inspection. Nothing in the W5 evidence base requires cross-instance
   aggregation.
2. Hosted telemetry is a different program: export pipelines, retention
   governance, tenancy isolation, and a privacy review under LLP 0060's
   hosted posture. Coupling W5 to that program would delay the diagnostics
   that unblock the matrix rerun for a capability nobody has asked for.
3. A local-only v1 keeps the redaction contract enforceable: records stay
   on the developer's own instance, the only egress is the gated pull
   snapshot below, and the value-free discipline still applies so a pasted
   record (into an issue, a diary, a model context) does not carry
   application values.

The **hosted nonclaim** is explicit: v1 ships no export, no upload, no
hosted collection, and no new streaming/telemetry protocol for cost
records. The single egress is the **pull-only snapshot on the existing
gated inspection surface** (LLP 0031 D3's authenticated
`/_snapback/api/inspect`-class path, or an in-process CLI read); the
unauthenticated `PublicInspect` allowlist gains **no** cost fields — no
rings, no counters, and none of the correlation identities below. On a
hosted instance the recorder is off by default; an operator may enable the
same instance-local gated inspection, which is still not telemetry. Lifting
the nonclaim requires a new dated amendment with its own privacy review;
implementation tickets may not do it.

**Redaction.** Cost-visibility records inherit §1.1's value-free discipline
(LLP 0108) verbatim: they may carry `functionId`, host-recomputed
`planIdentity`, table/index/node ids, typed diagnostic codes, counts,
durations, and monotonic/wall timestamps. They must never carry arguments,
literal endpoints, row contents, row ids, principals, tokens, or application
values. Query-cost retention keeps not the closed §1.1 record but its
bounded inspection projection (§7.3, `QueryCostObservationInspectV1`),
which drops `fixtureIdentity` entirely — that field is qualification
storage only and never enters the recorder. Where a record family joins
the D0.5 inspection carrier, the D0.5 **ownership tuple is projected, not
copied**: settled authority appears as its authority class, never a
principal identity, and the server-origin component appears as the
instance's own identity, never a literal URL; D0.5's sharing key itself is
unchanged. Two gated-surface-only extensions beyond §1.1's
public-diagnostic rule, each confined to the gated/in-process surfaces
above (never `PublicInspect`, and reverting to §1.1's stricter public rule
at any future export boundary):

- (a) correlation identities, split by **who can influence the string**.
  Framework-minted identities — subscription id, server-minted connection
  id (`sct_`-granted lineage, LLP 0031), the framework's opaque asset id —
  appear verbatim. **Caller-influencable** identities cannot be trusted to
  be value-free: `clientMutationId` is caller-suppliable on the client
  surface, and trusted-local profiles may adopt caller-suggested
  connection ids verbatim (LLP 0031 D3), so either may embed application
  values. Every snapshot therefore projects caller-influencable
  identifiers to **stable inspection-only pseudonyms** — the (b) hash of
  the identifier string — never the raw string; the pseudonym is stable
  across both sides' snapshots, so joins by `clientMutationId` still work
  (both sides project identically), while an id like
  `save-<user-email>-draft` never appears in a snapshot. In-memory
  records may hold the raw id; the projection applies at every snapshot
  boundary. The D0.5 owner label is framework-assigned (component, hook,
  or cell identifiers; LLP 0095 inspection floor) and appears verbatim;
  implementations must not embed argument or row values in labels, and a
  label sourced from caller-provided text is caller-influencable and
  projects like one.
- (b) a canonicalization **hash** for equivalence counting (§§7.5–7.6) and
  the pseudonym projection in (a): the same canonical-JSON hash
  **algorithm** the §5 window ledger binds cursors to — no second
  algorithm. This hash is non-invertible only for high-entropy inputs; for
  low-entropy inputs (row ids, principals appearing in args) it is a
  stable **fingerprint**, which is exactly why it is admitted only on the
  gated/local surface and forbidden on any public or exported surface.
  Raw args remain forbidden everywhere.

**Bounded storage.** No unbounded accumulation anywhere, in records or
keys:

- Exactly **three ring families** exist (client `MutationPhaseCostV1`,
  server `QueryCostObservationInspectV1`, server `LiveDeliveryWaveV1`;
  §§7.4–7.6 are joins and counters, not rings). Each ring is bounded by
  **both** a record count (default 512) and a per-family byte budget whose
  sum is the recorder total (default at most 4 MiB); admission is
  byte-accounted against the family budget. Ring records are **inspection
  projections, never the closed §1–§5 records themselves**: a projection
  type bounds its own variable-size components (a fixed retained-sample
  cap plus total-count fields and a truncation flag, §7.3), so §1.1's
  closed-record invariants are never violated by truncation — the closed
  record is complete or it is not retained. A projection still larger than
  its family budget is dropped whole, never admitted. Overflow evicts
  oldest, never blocks, and increments a per-family `droppedRecords`
  counter (oversize drops included) so absence of a record is itself
  diagnosable. These caps are recorder storage bounds for this diagnostics
  surface, **not** the §3.4 consultation/result-byte enforcement maxima.
- Per-key counter maps (§7.2 per-function, §7.5 per-(function, args hash),
  §7.6 per-(asset id, owner label)) hold at most a fixed key capacity
  (default 1,024 keys per map). At capacity, the least-recently-updated
  key's counts merge into one visible `otherKeys` aggregate bucket and a
  monotone `evictedKeys` counter increments; retained-key values and the
  aggregate bucket never reset within a process, so totals stay exact even
  when per-key detail is evicted.
- No durable persistence in v1. A snapshot is produced only on demand at the
  inspection surface (§7.7); nothing serializes on the hot path.
- Sampling: below a per-family rate threshold every event gets a detail
  record; above it, counters always increment while detail records are
  sampled. The threshold and sampling rule are implementation-owned; the
  invariant is counters-exact, details-sampled — a count is never wrong,
  a detail record may be missing.
- Overhead: recording is constant-bounded field capture per event — field
  copies plus, where an equivalence key or pseudonym is needed, one
  canonicalization hash. The **algorithm** is §5's; the value is reused
  where a keyset path computed it already, and computed fresh on paths
  that never had one (mutation enqueues, non-pageable subscriptions) —
  there its cost is bounded by the already-enforced args/identifier size.
  No snapshot serialization happens on the hot path. A disabled recorder
  (hosted default) is a branch, not a buffer. The recorder defaults on
  under `snapback dev` and off under serving; enabling it in serving is an
  explicit instance flag.

### 7.2 Mutation phase visibility (consumes LLP 0059 ruling 6 — decided)

The per-mutation phase fields are **already ruled** by LLP 0059's D0.2
ruling 6 and are not re-decided here: `enqueuedAtMs`, `dispatchedAtMs`,
`authorizedAtMs`, `executedAtMs`, `committedAtMs` ride the LLP 0218
disposition union (`mutationStatus`/`subscribeMutation`, keyed by
`clientMutationId`); pending-phase attribution is `outboxStatus()`
(`drainPhase`, `lastAttemptAtMs`, `nextRetryAtMs`, `oldestPendingAtMs`,
typed `blockedReason` with the pinned `auth-barrier`/`custody-unsettled`/
`authority-unavailable:*` vocabulary); live delivery is the subscription
projection's `lastDeliveryAtMs`/`authoritativeRevision`. Carrier plumbing is
W2's.

What this amendment adds is only the **derived phase vocabulary and its
bounded retention**. The names are normative so every surface reports the
same subtraction, licensed by ruling 6's field definitions; each duration is
`null` whenever either endpoint timestamp is `null` (a phase not reached —
pre-transport refusal, stranded/deleted custody, or a still-pending phase):

- `queueWaitMs = dispatchedAtMs − enqueuedAtMs`
- `authWaitMs = authorizedAtMs − dispatchedAtMs`
- `executionMs = executedAtMs − authorizedAtMs`
- `commitMs = committedAtMs − executedAtMs`

Delivery lag is deliberately **not** a field of the per-mutation record: it
is subscription-scoped and lives only on the §7.4 subscription inspection
row. Per covered commit it is client-clock time from the client's
observation of that commit's settled disposition to its observation of the
**first** delivery whose `authoritativeRevision` covers it — both endpoints
are client-observed events on one clock, so no cross-clock subtraction
against server timestamps is implied, and later waves never inflate earlier
mutations. The row stores one scalar: the lag of the **most recent covered
commit** (recomputed at each delivery); per-commit history is not retained.

The client recorder retains one ring record per settled mutation:

```ts
type MutationPhaseCostV1 = Readonly<{
  format: "snapback.mutation-phase-cost.v1"
  clientMutationId: string
  functionId: string
  enqueuedAtMs: number | null
  dispatchedAtMs: number | null
  authorizedAtMs: number | null
  executedAtMs: number | null
  committedAtMs: number | null
  queueWaitMs: number | null
  authWaitMs: number | null
  executionMs: number | null
  commitMs: number | null
  disposition: string   // the LLP 0218 terminal disposition kind
}>
```

(`clientMutationId` is caller-influencable and appears in any snapshot only
as its §7.1 pseudonym, never raw)

plus per-function monotone counters (count, max/total per phase). The
per-mutation detail is client-retained only: ruling 6 already carries the
server-settled timestamps to the client on the disposition union, so a
server-side detail ring would duplicate it. The server contributes
per-function monotone **counters** for its authorization/execution/commit
spans (count, max/total per phase, same duration vocabulary) on its own
snapshot; the two sides are two observations of the same phases on two
clocks and are never merged into one record. No surface reports an
undifferentiated "pending" (ruling 6's closing invariant).

### 7.3 Query and live re-evaluation visibility (extends §1, adds delivery)

§1's `QueryCostObservationV1` already measures examined rows
(`scannedRows`, per-consultation `examinedEntries`), result rows/bytes, and
per-kind timing. W5 adds **bounded local retention** of recent observations
so a developer can read the last N per function without qualification
tooling. The ring does **not** retain the closed §1.1 record — §1.1's
invariants (every consultation present, `indexRangeCount ==
accessPathConsultations.length`, `scannedRows` the checked sum) admit no
truncation — but a distinct bounded inspection projection:

```ts
type QueryCostObservationInspectV1 = Readonly<{
  format: "snapback.query-cost-observation-inspect.v1"
  // every §1.1 scalar field verbatim (functionId … targetWork), except:
  // - no fixtureIdentity field at all (qualification storage only)
  // - accessPathConsultations is replaced by the bounded view below
  consultationSample: readonly AccessPathConsultationV1[] // first K, K=16
  totalConsultations: number         // == the observation's indexRangeCount
  consultationsTruncated: boolean    // totalConsultations > sample length
}>
```

The scalar totals (`scannedRows`, `indexRangeCount`, timing) remain exact
even when the sample is truncated; §1.1's invariants are statements about
the complete underlying observation, which qualification keeps owning —
this projection never feeds qualification or policy.

W5 also adds one **new sibling record** for the facts §1 does not carry,
the delivery/rerun side. This record is **server-owned**: it is emitted in
the serving process at the §1.5 boundaries and appears only on the server
snapshot. Client-observed facts (consumer dedup, delivery lag) live on the
§7.4 client inspection row, and no wire carrier moves either record to the
other side. The **join** is collision-free by construction: each wave gets
a process-monotone `waveSeq`; the server snapshot's per-subscription
registry rows (the server half of the D0.5 enumeration) carry the delivery
and pending facts below; the client row and the server registry row share
the **subscription id** — already a shared identity on both sides of the
shipped protocol — so tooling joins client row → server registry row →
`waveSeq` → wave record, never by the ambiguous (`functionId`, version)
pair. The registry-row facts are **exact and unsampled** — completed wave
records and the aggregate `liveCoalesce` counters cannot answer whether
*this* subscription is owed work, so these per-subscription scalars are
maintained at the seams that already touch the subscription (invalidation
match, coalescer merge, §1.5 evaluation start/finish) and are exempt from
the §7.1 sampling rule (they are current-state fields, not event
details):

- `lastDeliveredWaveSeq: number | null` and
  `lastDeliveredVersion: number | null` — the completed-wave join anchor;
- `owedThroughVersion: number | null` — the newest committed
  `LIVE(version)` whose commit invalidated this subscription and has not
  yet been covered by a delivery; `null` when nothing is owed;
- **two orthogonal stage fields**, so a charge that lands during an
  evaluation has a recorded home instead of an inferred one:
  - `evaluation: "idle" | "evaluating"`, with
    `currentWaveSeq: number | null` non-null exactly while `evaluating`,
    naming the in-flight wave before its record exists;
  - `pendingWork: "none" | "queued" | "coalescing"` — charged work not
    yet inside an evaluation turn (scheduler queue or rung-1 coalescer
    pending frame). `evaluating` + `queued`/`coalescing` is the composite
    state of LLP 0200's admitted post-cut race.

An **active stage** (`evaluation != "idle"` or `pendingWork != "none"`)
is itself an owed obligation, independent of `owedThroughVersion` —
LLP 0200 §2.4 admits **writeless** authority transitions whose
restoration is owed work with no committed `LIVE(version)` to record, so
`pendingWork: "queued"` with `owedThroughVersion: null` is a valid owed
state, never a neutral one. `owedThroughVersion` is the data-commit
half of owed-ness, not the whole of it.

The maintenance is a **total transition table** — every seam that touches
the subscription has exactly one row, delivery is a **compare-and-clear**,
never an unconditional reset, and every LLP 0200 §2.4–2.5 non-delivery
exit defines its `currentWaveSeq` clearing and owed-ness disposition.
Delivery's successor stage is the recorded `pendingWork` value, never an
unrecorded "merged frame" inference:

| Event | `owedThroughVersion` | `evaluation`/`currentWaveSeq` | `pendingWork` |
| --- | --- | --- | --- |
| T-SUB establishes (row created; also T-RECONNECT's fresh `supersedes` subscribe) | `null`; `lastDelivered*` from the establishment snapshot | `idle` / `null` | `none` |
| Matcher charges the subscription at committed version `V` | `max(owed, V)` (`null` counts as 0) | unchanged | `none → queued`; `queued`/`coalescing` unchanged |
| Writeless authority transition charges re-resolution (LLP 0200 §2.4 — no commit to record) | unchanged (may stay `null`; the active stage carries the obligation) | unchanged | `none → queued`; `queued`/`coalescing` unchanged |
| Coalescer merges the pending frame | unchanged (already charged) | unchanged (defined during `evaluating` too — the race's merge is representable) | `queued → coalescing` |
| Wave `W` starts its §1.5 turn (dequeues the pending work at its atomic cut) | unchanged | `→ evaluating`, `currentWaveSeq = W` | `→ none` |
| Wave `W` delivers at version `V` | if `owed <= V`: `→ null`; if `owed > V` (charged during evaluation): **preserved** | `→ idle` / `null`; `lastDelivered* = (W, V)` | unchanged — the mid-flight charge already recorded `queued`/`coalescing`; nothing is inferred |
| Delivery-time authority-gate discard (LLP 0200 §2.4 — frame resolved under pre-transition authority; subscription fenced, owed re-resolution) | preserved | `→ idle` / `null` | `→ queued` (the restoration is owed work) |
| Cancellation of queued work by a superseding frame (LLP 0200 §2.5 latest-value collapse; obligations transfer) | unchanged | unchanged | unchanged (`queued`/`coalescing` — the superseding frame takes the slot) |
| Best-effort in-flight cancellation completes | preserved | `→ idle` / `null` | `→ queued` |
| Evaluation-turn timeout (LLP 0200 §2.5 — waiter abandoned, one refresh retry; result discarded on eventual completion) | preserved | `→ idle` / `null` | `→ queued` (the refresh retry) |
| Refresh degradation (LLP 0200 §2.5 overload/timeout collapse to a priority refresh-signal obligation) | preserved | unchanged per its own row | `→ queued` (its wave records `rerunCause: "refresh"`) |
| Retirement — T-UNSUB release; T-LOSS socket drop; **T-REAP / grant expiry-or-purge** (the server-side event — T-GRANT-LOSS is the client's *later observation* of it, not a server seam); second-timeout `resync_required` teardown; **refresh-cannot-enter-transport teardown** (LLP 0200 §2.5's capacity escape); §3.4 terminal quarantine | row **retired** — no registry row for the subscription id; a still-in-flight turn's result is discarded at the gate. Owed-ness does not survive retirement: a successor's T-SUB establishment snapshot subsumes it | — | — |

A retired/absent row is a defined state of this system, not a gap: T-LOSS
removes the server subscription while D0.5 keeps the client row alive in
its `DROPPED`/`RECOVERING` states, and §7.4's derivation rule consumes the
absence explicitly. Every version in this
system (`deliveredVersion`, `coveredVersions`, the client row's
`authoritativeRevision`, D0.5's held snapshot version) is the LLP 0095
§1.3 `LIVE(version)` **storage commit version** — not the same-named
client-local optimistic counter in
`packages/snapback-client/external-store.mjs`.

```ts
type LiveDeliveryWaveV1 = Readonly<{
  format: "snapback.live-delivery-wave.v1"
  waveSeq: number                    // process-monotone; the join anchor
  functionId: string
  planIdentity: string | null
  rerunCause:                        // primary trigger class, precedence =
    | "authorization-invalidation"   //   this listed order when a merged
    | "mutation-invalidation"        //   wave has several trigger classes
    | "refresh"                      // resync/refresh supersession
    | "reconnect-reestablish"        // fresh snapshot-with-subscribe
  coalesced: boolean                 // this wave flushed a merged frame
  coveredVersions:                   // commit versions this wave covers
    Readonly<{ first: number; last: number }> | null
  deliveredVersion: number | null    // LIVE storage commit version delivered
  subscriberCount: number            // observers registered at the wave
  distinctEvaluationGroups: number   // observed groups (G1 memo key)
  realEvaluations: number            // real §1.5 turns in this wave
  memoDeliveries: number             // G1 memo-only deliveries in this wave
  deliveredFrames: number            // frames handed to fan-out
  maxEvaluationTurnMs: number | null   // max over real turns (§1.5)
  totalEvaluationTurnMs: number | null // checked sum over real turns
  maxMemoDeliveryTurnMs: number | null // max over memo turns (§1.5)
  totalMemoDeliveryTurnMs: number | null
}>
```

`rerunCause` is a closed enum of trigger classes; memo delivery and
coalescing are not causes — they are how the wave executed, carried by
`memoDeliveries` and `coalesced` — so a wave that is simultaneously
mutation-triggered, coalesced, and partly memo-delivered is one record with
one primary cause. A merged wave covering several commits reports the range
in `coveredVersions` (`first == last` for a single-commit wave). Per-group
timing multiplicity is explicit: max and checked-sum per §1.5 kind, never
one scalar pretending to cover N groups. A new cause requires a dated
amendment. `subscriberCount`/`distinctEvaluationGroups` are the **observed**
counterparts of §1.6's declared `maxObservers`/`maxDistinctEvaluationGroups`
and never substitute for the declaration in policy. Timing reuses §1.5's
boundaries exactly — this record adds no new clock. The coalescing counters
(`LiveCoalesceStats`) already serialize on `InspectState`/`PublicInspect` as
`liveCoalesce` (schema rotation accepted with LLP 0200 §3); this amendment
adds no second coalesce surface — the wave record's `coalesced` flag and
`coveredVersions` complement those existing counters, and the per-wave
detail the 20260808 re-evaluation ticket deferred to a future observability
section is this record.

### 7.4 Subscription owner, readiness, and missed delivery (consumes D0.5 — decided)

The per-subscription inspection floor is **already ruled** by LLP 0095's
D0.5 amendment: owner label, function name, subscription state, held
snapshot version, auth-barrier/readiness state, and — when delivery is
suspended — the outbox suspension reason. The budget semantics are likewise
ruled and only consumed here: counts above the provisional 16-per-view
budget remain **supported** and draw only a structured warning; the sole
hard refusal is the 64-per-connection transport ceiling, with its own
pre-refusal warning (LLP 0278/0095). None of that is re-decided.

W5 adds the **client-owned cost fields** on that row — each one an event the
client itself observes, so no server→client cost carrier is implied:
`lastDeliveryAtMs` and `authoritativeRevision` (ruled, LLP 0059 ruling 6),
`deliveryLagMs` (defined in §7.2: first covering delivery, client clock,
scalar = most recent covered commit), and the `suppressedEqualSnapshots`
counter (LLP 0278 consumer-notification dedup — the suppression happened in
this process). Server wave facts are **not** copied onto the row; tooling
joins them from the server snapshot by subscription id → registry row →
`waveSeq` (§7.3).

The D0.5 answerability requirement becomes checkable as a closed rule over
that join. `pendingDeliveryReason` is **not a stored field on either side**
— the client cannot know owed-ness or server execution state, and the
server cannot know client hold states, without the carrier this amendment
disclaims. It is a **derived result of the inspect-time join**: the
CLI/tooling that reads both gated snapshots computes it, normatively, and
the derivation is **exhaustive** — every admitted (client state, registry
state) pair yields exactly one of four outcomes:

- **reason** — a member of the closed enum below;
- **neutral** — nothing is owed or the work is in ordinary in-flight
  transit; not a hold, not a defect (detail names the neutral class);
- **snapshot-skew** — the two gated snapshots are pulled without causal
  alignment, and this pair is a valid transient of that skew; the
  resolution is a re-read of both snapshots, and only a **persistent**
  skew across the re-read is a defect;
- **defect** — a pair the transition table makes unrepresentable, or a
  persistent skew.

The derivation is a **strict ordered decision list — first match wins,
and the client lifecycle classes of step 0 precede the owed/member
evaluation of steps 1–2** — so every reachable pair matches exactly one
rule and no later rule is consulted once an earlier one matches.

**Step 0 — client lifecycle classification.** Two client classes are
decided before any reason member or residual, whatever the registry row
holds (an active-stage row included — member 6 is never consulted for
these clients):

- **Ordinary initial `PENDING`** (no `supersedes`): **neutral,
  unconditionally — row present or absent.** A `PENDING` subscription
  holds no `LIVE` revision, so the owed comparison has no
  `authoritativeRevision` operand and is **undefined, not attempted**; a
  present row already charged (or already staged) by concurrent commits
  is establishment racing ordinary traffic, and the establishment
  snapshot will subsume the charges.
- **Client lifecycle-settled** (`RELEASED`, `TERMINAL_DELETED`,
  connection `CLOSED`): with the row **absent**, **neutral** — already
  retired on both sides. With a row **present** (idle or active-stage
  alike), **snapshot-skew** — the inverse skew: the server snapshot may
  predate the T-UNSUB/teardown processing. Re-read both; a skew that
  persists is the defect (an orphaned **server** subscription leaking
  registry and evaluation work).
- **Connection `IDLE`** is lifecycle-settled **only with the row
  absent** (neutral, as above). With a row present, an `IDLE` client is
  not step-0-classified: the pair proceeds to steps 1–2 exactly as in
  v0.13, where it resolves as `server-pending`, neutral, or defect by
  row state.

**Step 1 — the closed reason enum**, in precedence (first match wins).
Members 1–5 derive from the client row's ruled state **alone** — a
recovery or hold state is a reason in its own right and is never gated on
the owed comparison (delivery cannot proceed regardless of what the
server owes):

1. `terminal-quarantine` — §3.4 retired handle or `TERMINAL_AUTH`; detail
   carries the terminal code;
2. `auth-barrier` — the ruled LLP 0059 barrier suspension;
3. `custody-unsettled` — the ruled non-barrier custody pause;
4. `authority-unavailable` — detail carries the ruled
   `authority-unavailable:*` spelling verbatim, so the enum member is
   closed while the ruled open-suffix vocabulary stays where LLP 0059
   owns it;
5. `transport-recovery` — bounded recovery in flight, from the client
   row's own states: connection `RECOVERING` or `GRANT_LOST`
   (T-LOSS/T-GRANT-LOSS), subscription `DROPPED`,
   `PENDING`-with-`supersedes` (T-RECONNECT resubscribe), or
   `RESYNC_PENDING` (`resync_required`-driven resubscribe). Applies with
   the registry row present **or** absent — row-present +
   `PENDING`-with-`supersedes` + `owed = null` (replacement established
   server-side, client not yet caught up) is still `transport-recovery`;
6. `server-pending` — requires a registry row with an **active stage**
   (`evaluation != "idle"` or `pendingWork != "none"`; §7.3's
   owed-obligation rule): the composite names the stage (`evaluating`
   with `currentWaveSeq`, `queued`, `coalescing`, or the race composite,
   carried in the derived detail), and the detail carries
   `owedThroughVersion` when non-null — a writeless authority restoration
   (`queued` with `owed = null`) is `server-pending`, not neutral. The
   version comparison alone never selects this member: an owed version
   with **no** active stage falls through to the defect branch. The wave
   records and the existing `liveCoalesce` counters add context but are
   not the per-subscription authority.

**Step 2 — residuals.** Pairs reaching this step have a client neither in
a step-0 lifecycle class nor in a step-1 hold state; the classification
is total:

- **Row present, no active stage, not version-owed**
  (`owedThroughVersion` null or `<= authoritativeRevision`): **neutral**.
  This includes ordinary settled rows and the in-transit case —
  `lastDeliveredVersion > authoritativeRevision` with the client settled
  on either lane means the delivery sits in outbox/socket custody
  (`ATTACHED_POLL` awaiting its declared drain cadence, or a live frame
  in flight); detail names it `in-transit`.
- **Row present, version-owed, `evaluation: "idle"` and
  `pendingWork: "none"`**: **defect** — the §7.3 table makes owed work
  with no recorded stage unrepresentable (reachable because member 6
  requires an active stage).
- **Row absent, client claiming an established subscription** —
  `LIVE(v)` under **any** connection shape LLP 0095 admits for
  established subscriptions (`ATTACHED_LIVE`, `ATTACHED_POLL`, or
  `GRANTED` between attachments): **snapshot-skew** — server-side
  retirement (T-LOSS, T-REAP/expiry) can precede the client's
  observation, and the two snapshots carry no causal alignment. Re-read
  both; only a skew that persists across the re-read is the defect (an
  orphaned **client** subscription).

Consumer-level equal-snapshot dedup is deliberately **not** in this enum:
a value-equal delivery that advanced `authoritativeRevision` is a completed
delivery with a suppressed notification (visible via the suppression
counter and the advanced revision), not a miss. The four outcomes are
normative; the exact per-surface spelling of the neutral-class details is
owner-acceptance detail for LLP 0095/0114 alongside their inspection
carrier.

### 7.5 Repeated equivalent writes and effects (bounded to what the framework knows)

The framework reports only equivalences it can prove without guessing
application intent; everything here is a counter or warning, never a refusal
(idempotent retries are legitimate):

- **No-op commits.** A committed mutation whose in-transaction row-image
  delta is empty (no net row/index effect) increments a per-function
  `noopCommits` counter.
- **Equivalent enqueues.** Mutations with identical (`functionId`,
  args hash — §7.1's canonical-args hash) enqueued within a short
  implementation-owned window increment an equivalence counter keyed by that
  pair; crossing a warn threshold emits one structured warning naming the
  function and count. This detects identical-args repetition only; writes
  whose args differ each time (an evolving text field per keystroke) are
  visible through per-function phase counters and the housekeeping lane,
  not through this counter — same-function rate detection is out of scope.
- **Housekeeping supersession.** The count of
  `SNAPBACK_HOUSEKEEPING_SUPERSEDED` dispositions per function (LLP 0059
  ruling 4) is surfaced as the measure of coalesced repeated housekeeping —
  already-ruled semantics, counted here.

Explicitly out of scope: semantic-intent equivalence (two different
functions achieving one effect) and any value comparison beyond the row
image the commit path already holds.

### 7.6 React/provider and asset multiplicity (consumes D0.5 budgets — decided)

The budgets and their diagnostics are **already ruled**: 16 per
view/provider (provisional, LLP 0278; the proposed
`SNAPBACK_LIVE_SUBSCRIPTION_VIEW_BUDGET` class names owners and the D4
aggregate remediation) and the 64-per-connection transport ceiling with a
pre-refusal warning (LLP 0095). W5 adds two multiplicity facts the framework
owns enough information to know:

- **Duplicate subscriptions.** N concurrent subscriptions with identical
  (`functionId`, canonical-args hash, D0.5 connection ownership tuple)
  under one connection manager produce a multiplicity fact listing the N
  owner labels. The identity **excludes** the owner label — that is what
  makes cross-owner duplicates fire; the labels are the attribution output,
  not part of the key. The framework knows they are the same query; it does
  not guess whether the duplication is intended, so this is a warning-class
  fact with the shared-provider/aggregate alternatives as remediation.
- **Asset-issuance multiplicity.** Per (asset identity, owner label), a
  counter of asset URL/hook issuances within an implementation-owned window;
  crossing a warn threshold names the owner labels and count (the "dozens
  of unnecessary asset hooks per card" shape). Asset identity here is the
  framework's opaque asset id (§7.1 extension (a)), never a URL with
  embedded secrets.

Both surface through the same D0.5 inspection carrier and §7.7 snapshot
(gated surfaces only); neither adds a refusal.

### 7.7 Surfaces, worked attributions, and acceptance

**Surfaces reuse what exists.** The client side rides the D0.5 inspection
carrier, `outboxStatus()`, and the subscription projection — all ruled. The
server side adds one on-demand snapshot of the §7.1 rings and counters on
the **gated** inspection surface only (LLP 0031 D3's authenticated path or
an in-process CLI read; exact spelling is implementation-owned). It is a
pull surface, never a stream, and never a new protocol; `PublicInspect`
carries none of it (§7.1). New diagnostic codes are warning-class only —
the §7.5/§7.6 warn facts (final spellings via the generated register,
LLP 0193 discipline) — and inherit §4.1's **value-free rule, not its
query-cost field set**: each multiplicity warning defines its own closed
details in the register, owner labels permitted there because the warnings
emit only on the gated/local surfaces; no new error/refusal codes.

**The two attribution obligations from the design ticket, closed:**

1. *Delayed foreground send.* While pending: `outboxStatus()` names
   `drainPhase` and typed `blockedReason` (e.g. `auth-barrier`). After
   settlement: the §7.2 record shows which derived phase absorbed the time
   (`queueWaitMs` vs `authWaitMs` vs `executionMs` vs `commitMs`). No source
   inspection, no empirical timeout.
2. *Stalled live projection.* The D0.5 inspection row names owner, state,
   held snapshot version, and auth-barrier/readiness; the inspect-time join
   over both gated snapshots derives — when a delivery is owed — exactly
   one `pendingDeliveryReason` per §7.4's precedence rule; a
   dedup-suppressed value-equal delivery shows as an advanced revision
   plus the suppression counter, not a miss; the joined §7.3 wave record
   (subscription id → registry row → `waveSeq`) shows the wave's cause,
   coverage, and fan-out.

**Guide.** The §4.2 page (`guide/backend/query-costs.md`) gains a
cost-snapshot section teaching how to read the gated snapshot and both
worked attributions — an extension of the already-decided page, not a new
page.

**Acceptance fixtures** (land with implementation, per lane):

- both worked attributions above as end-to-end fixtures asserting closed
  vocabulary output, not log text;
- redaction: a captured gated snapshot under adversarial values contains no
  argument, row content, row id, principal, token, literal endpoint, or
  `fixtureIdentity`; **caller-supplied identifiers** (a `clientMutationId`
  and a trusted-local suggested connection id, each seeded with an
  application value) appear only as their §7.1 pseudonyms, never raw;
  owner labels contain no application values; the D0.5 tuple appears only
  in its §7.1 projection; `PublicInspect` gains no cost field at all;
- bounds: ring record/byte caps honored with per-family `droppedRecords`
  and `consultationsTruncated` visible with exact scalar totals;
  counter-map key caps honored with `otherKeys`/`evictedKeys` visible and
  totals exact; counters monotone and exact under detail sampling;
  recorder-off is a no-op branch;
- join: the subscription-id → registry-row → `waveSeq` join resolves
  uniquely with two subscriptions on one function at the same delivered
  version (distinct args/owners); the derived `pendingDeliveryReason` is
  reproducible from the two snapshots alone, exercising
  `owedThroughVersion` advance and compare-and-clear, each
  `evaluation`/`pendingWork` value, a not-owed sibling subscription on the
  same function that derives **neutral**, **invalidation during
  evaluation via the composite state** (charge `V+1` while wave `W`
  evaluates its cut at `V`: the row records `evaluating` +
  `queued`/`coalescing` — including the coalescer merge landing during
  `evaluating` — and delivery of `V` preserves
  `owedThroughVersion = V+1` with the recorded `pendingWork` as the
  successor, then drains), **one LLP 0200 non-delivery exit**
  (authority-gate discard: `currentWaveSeq` clears, owed-ness preserved,
  `pendingWork → queued`, and the derived reason follows the fence
  through members 2/4 to `server-pending` at restoration),
  **commitless authority restoration** (a writeless LLP 0200 §2.4
  transition: `pendingWork: "queued"` with `owedThroughVersion: null`
  derives `server-pending`, never neutral),
  **T-LOSS/T-RECONNECT** (socket loss retires the registry row while the
  client holds `DROPPED`/`RECOVERING` — the absent-row branch derives
  `transport-recovery`; row-present + `PENDING`-with-`supersedes` +
  `owed = null` also derives `transport-recovery`; after establishment a
  fresh row appears with `owed = null`, `idle`/`none`), one
  **snapshot-skew** case (row retired before the client observes the
  loss: first read classifies snapshot-skew, the re-read resolves it —
  and a fabricated persistent skew classifies defect), and the
  **inverse skew** (client `RELEASED` against a stale server row: first
  read snapshot-skew, re-read resolves; a fabricated persistent server
  orphan classifies defect);
- §7.5/§7.6: no-op-commit, equivalent-enqueue, duplicate-subscription, and
  asset-multiplicity counters each triggered and attributed to owner labels;
- posture: hosted-default-off proven; no export path exists to test;
- guide: the §4.2 extension lands with the surfaces it documents.

**Ownership and acceptance.** On acceptance, this RFC owns §§7.1, 7.3, and
the server half of 7.2/7.5; LLP 0095/LLP 0114 own the client inspection
joins (§7.4, client 7.2) and provider multiplicity (§7.6); LLP 0278 owns
the subscription-budget interactions it already owns today. Until each
owner accepts, this section is a proposal and no implementation ticket may
cite it as Accepted. Implementation slices and the graduation into
independently closable tickets live in
`issues/20260821-app-boundary-runtime-cost-diagnostics-design.md`.

## Open questions

None. Signal dispositions, capture points, defaults, declaration/instance split, diagnostics,
refusal parity, and the G0 relationship are decided. Calibration may motivate a dated amendment;
implementation may not silently retune defaults or add another bounds surface.
§7 is a dated **proposed** amendment (LLP 0295 W5) awaiting owner acceptance;
it adds a visibility surface and deliberately adds no bounds surface.

## Revision history

- **v0.14 (2026-08-21).** §7 round-8 (codex ordering item, no new
  semantics): §7.4's derivation restructured as a strict ordered decision
  list — first match wins, and step-0 client lifecycle classification
  (ordinary initial `PENDING` → neutral even against a present
  active-stage row; lifecycle-settled `RELEASED`/`TERMINAL_DELETED`/
  `CLOSED`/`IDLE` → neutral when the row is absent, inverse snapshot-skew
  when a row is present, idle or active alike) precedes the step-1 member
  enumeration and step-2 row-present residuals, so the two previously
  overlapping matches (initial-`PENDING` vs member 6; lifecycle-settled
  vs member 6/row-present neutral) each resolve to exactly one rule.
- **v0.13 (2026-08-21).** §7 round-7 (codex final edge completions): (1) an
  active stage (`evaluation != idle` or `pendingWork != none`) is itself
  an owed obligation independent of `owedThroughVersion`, with a writeless
  authority-transition charge row — commitless restoration (`queued`,
  `owed = null`) derives `server-pending`, never neutral; (2) member 6
  requires an active stage, so the version comparison alone never selects
  it and the owed+idle+none defect branch is reachable; (3) residuals made
  total: initial-`PENDING` neutrality is unconditional (the owed
  comparison has no `authoritativeRevision` operand and is undefined, not
  attempted), the absent-row skew rule covers every LLP 0095-admitted
  established shape (`ATTACHED_LIVE`/`ATTACHED_POLL`/`GRANTED`), and the
  inverse skew (client `RELEASED`/`CLOSED` against a stale server row)
  classifies snapshot-skew with persistent server orphans reaching
  defect; (4) retirement seams named exactly — T-REAP/grant
  expiry-or-purge as the server-side event (T-GRANT-LOSS being the
  client's later observation) and LLP 0200 §2.5's
  refresh-cannot-enter-transport teardown alongside second-timeout.
  Fixture extended with commitless restoration and the inverse-skew
  persistent orphan.
- **v0.12 (2026-08-21).** §7 round-6 (codex two remaining MAJORs): the
  single `pendingState` scalar splits into orthogonal `evaluation`
  (`idle`/`evaluating` + `currentWaveSeq`) and `pendingWork`
  (`none`/`queued`/`coalescing`) fields, so a charge during evaluation has
  a recorded home and delivery's successor stage is recorded fact; the
  transition table gains every LLP 0200 §2.4–2.5 exit (authority-gate
  discard, queued/in-flight cancellation, timeout, refresh degradation)
  and the lifecycle rows (T-SUB creation; T-UNSUB/T-LOSS/T-GRANT-LOSS/
  second-timeout/terminal-quarantine retirement, owed-ness not surviving
  retirement). The inspect-time derivation is exhaustive with four
  outcomes (reason/neutral/defect/snapshot-skew): members 1–5 derive from
  client state alone, never gated on the owed comparison (fixing
  row-present + `PENDING`-supersedes + `owed=null`); `RESYNC_PENDING`,
  `GRANT_LOST`, and `TERMINAL_AUTH` mapped; ordinary initial `PENDING`
  and poll-lane/in-transit settled states are neutral; row-absent +
  `ATTACHED_LIVE` is snapshot-skew with defect reserved for persistence
  across a re-read. Fixture extended (composite-state race, authority-gate
  discard exit, snapshot-skew re-read). Neutral-class detail spellings
  delegated to LLP 0095/0114 owner acceptance with the four-outcome shape
  normative.
- **v0.11 (2026-08-21).** §7 round-5 (codex remaining MAJOR — non-total
  state machine): the registry facts gain a total transition table.
  Delivery of wave `W` at version `V` is a **compare-and-clear**:
  `owedThroughVersion <= V` clears to `null`/`idle`, a newer charge landed
  during evaluation (the admitted LLP 0200 post-cut race) is preserved and
  transitions to `queued`/`coalescing`. A T-LOSS-retired row is a defined
  absence: §7.4's derivation now has two total branches — row present
  (owed comparison, members 1–6) and row absent (client-row candidates
  only; D0.5 `DROPPED`/`RECOVERING`/`PENDING`-supersedes derive
  `transport-recovery`; settled-claiming client against an absent row is
  the defect case; member 6 never derivable without a row). Fixture
  extended with invalidation-during-evaluation and T-LOSS/T-RECONNECT.
- **v0.10 (2026-08-21).** §7 round-4 (codex single remaining MAJOR): the
  registry row's completed-delivery anchors alone could not establish
  owed-ness or the server stage, so the server snapshot's per-subscription
  registry rows gain exact, unsampled current-state facts —
  `owedThroughVersion` (newest committed `LIVE(version)` that invalidated
  this subscription; advances at matcher charge, resets on delivery),
  `pendingState` (`idle`/`queued`/`coalescing`/`evaluating`), and
  `currentWaveSeq` while evaluating — maintained at the seams that already
  touch the subscription and exempt from the sampling rule. §7.4's
  owed-delivery condition and `server-pending` derivation now consume
  them, and the reproducibility fixture exercises advance/reset, every
  stage, and a not-owed sibling.
- **v0.9 (2026-08-21).** §7 round-3 delta review (codex remaining items 1–4;
  grok round-4 pins 1–3): (1) bounded retention no longer truncates the
  closed §1.1 record — a distinct `QueryCostObservationInspectV1` projection
  carries a consultation sample plus exact totals and a truncation flag,
  and `fixtureIdentity` has no field at all; (2) correlation identities
  split by influencability — caller-suppliable `clientMutationId` and
  trusted-local suggested connection ids are projected to stable
  inspection-only pseudonyms at every snapshot boundary, with an
  adversarial caller-supplied-ID fixture; (3) the cross-snapshot join is
  subscription id → server registry row (`lastDeliveredWaveSeq`,
  `lastDeliveredVersion`) → process-monotone `waveSeq`, replacing the
  ambiguous (`functionId`, version) pair; all versions pinned to LLP 0095
  §1.3 `LIVE(version)` storage commit versions (not the client-local
  counter of the same name); `pendingDeliveryReason` is a derived result of
  the inspect-time join over both gated snapshots, stored on neither side;
  `deliveryLagMs` scalar pinned to the most recent covered commit; (4) the
  §5 hash claim reduced to algorithm reuse — the value is computed fresh on
  paths that never had a cursor.
- **v0.8 (2026-08-21).** §7 revision round resolving the codex/grok xhigh
  reviews (5 MAJOR, 10 MINOR/NIT): 16-per-view budget warns only (D0.5
  consumed, not re-decided); storage bound made real (byte-accounted ring
  admission/truncation, capped per-key maps with `otherKeys`/`evictedKeys`);
  redaction honest (fingerprint framing, §5 canonical-args hash reuse,
  gated-only correlation ids, `fixtureIdentity` and D0.5-tuple projections,
  `PublicInspect` nonclaim); `LiveDeliveryWaveV1` made server-owned with
  client dedup facts on the inspection row and a defined join key; causal
  vocabularies closed (primary-cause precedence, `coalesced`/
  `coveredVersions`, per-group timing, six-member `pendingDeliveryReason`
  with owed-delivery definition); `MutationPhaseCostV1` typed with
  nullability and delivery lag moved to the subscription row;
  `LiveCoalesceStats` claim corrected (already on `InspectState`/
  `PublicInspect`); ownership wording, ring enumeration, §3.4-maxima
  disambiguation, and the §4.2 guide sentence.
- **v0.7 (2026-08-21).** Adds §7, the LLP 0295 W5 design-proposal amendment
  (proposed; owners to accept): local-first posture with an explicit hosted
  nonclaim, value-free bounded recorder, derived mutation-phase vocabulary
  over the LLP 0059 ruling-6 fields, `LiveDeliveryWaveV1` rerun/fan-out
  record, D0.5 inspection cost joins with a closed missed-delivery
  vocabulary, repeated-equivalent-write counters, and React/provider/asset
  multiplicity facts. No normative change to §§1–6.
- **v0.6 (2026-08-16).** Author-authorized trim: -237 lines, no normative change.
- **v0.5 (2026-08-16).** Status Draft → Accepted by author ruling (Charlie Cheever, 2026-08-16 session), on the converged dual-family review record in the run journal.
- **v0.4 (2026-08-16).** Resolves the round 3 residual by binding mixed-bundle finite and live-establishment executions to a new exact per-child timing seam carried through pinned live registration.
- **v0.3 (2026-08-16).** Applies review round 2: isolates all three timing kinds; records per-argument cardinality; defines all-cell quarantine clearing; offer-gates terminal wire behavior with sticky custody and terminal retry handling; and makes window exhaustion `refused`, never a short end-of-data lookalike.
- **v0.2 (2026-08-16).** Applies review round 1: reconciles relational, examined-entry, finite/live timing, invocation-ring, result-byte, and vector seams; adds per-consultation work, result rows, and memo timing; makes defaults tighten-only; resolves raw/scaled boundaries; defines terminal quarantine; corrects LLP 0209 §8 attribution; specifies all eight G0/window rules; scopes identities; parameterizes messages; and closes `notPageable`/`single_table_v1@1`.
- **v0.1 (2026-08-16).** Initial commissioned draft: four measured signals plus estimated fan-out; one declaration/observation/policy system with G0; warn→index→pagination→refuse; instance tightening; six diagnostics, one guide, and exact local/server parity.
