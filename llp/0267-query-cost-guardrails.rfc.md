# LLP 0267: Query-cost guardrails before production admission

**Type:** RFC
**Status:** Accepted
**Systems:** Live queries, Relational queries, Performance, Diagnostics, Schema
**Author:** Codex gpt-5.6-sol xhigh, orchestrated by Claude Fable 5 (commissioned by the author performance-direction ruling 2026-08-15, Charlie Cheever)
**Date:** 2026-08-16
**Revised:** 2026-08-16 (v0.6 — author-authorized trim, no normative change)
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
- Nested `FUNCTION_QUERY duration_ms`, `src/server.rs::record_app_data_invocation`'s outer
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

## Open questions

None. Signal dispositions, capture points, defaults, declaration/instance split, diagnostics,
refusal parity, and the G0 relationship are decided. Calibration may motivate a dated amendment;
implementation may not silently retune defaults or add another bounds surface.

## Revision history

- **v0.6 (2026-08-16).** Author-authorized trim: -237 lines, no normative change.
- **v0.5 (2026-08-16).** Status Draft → Accepted by author ruling (Charlie Cheever, 2026-08-16 session), on the converged dual-family review record in the run journal.
- **v0.4 (2026-08-16).** Resolves the round 3 residual by binding mixed-bundle finite and live-establishment executions to a new exact per-child timing seam carried through pinned live registration.
- **v0.3 (2026-08-16).** Applies review round 2: isolates all three timing kinds; records per-argument cardinality; defines all-cell quarantine clearing; offer-gates terminal wire behavior with sticky custody and terminal retry handling; and makes window exhaustion `refused`, never a short end-of-data lookalike.
- **v0.2 (2026-08-16).** Applies review round 1: reconciles relational, examined-entry, finite/live timing, invocation-ring, result-byte, and vector seams; adds per-consultation work, result rows, and memo timing; makes defaults tighten-only; resolves raw/scaled boundaries; defines terminal quarantine; corrects LLP 0209 §8 attribution; specifies all eight G0/window rules; scopes identities; parameterizes messages; and closes `notPageable`/`single_table_v1@1`.
- **v0.1 (2026-08-16).** Initial commissioned draft: four measured signals plus estimated fan-out; one declaration/observation/policy system with G0; warn→index→pagination→refuse; instance tightening; six diagnostics, one guide, and exact local/server parity.
