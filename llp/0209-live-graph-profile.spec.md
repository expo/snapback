# LLP 0209: The bounded live graph profile — precision, shared evaluation, and incremental maintenance (the D2 owner-Spec)

**Type:** Spec
**Status:** Review
**Systems:** Live queries, Relational queries, Schema, Auth, Performance, Client SDK
**Author:** Claude Fable 5 (commissioned by the LLP 0191 author rulings, Charlie Cheever, 2026-08-08)
**Date:** 2026-08-09
**Revised:** 2026-08-24 (v0.7 — author ratification recorded; v0.8 Spec-gap
notes appended from the G2-A fix-round rulings: the six hash
domains, `CapturedReadKind::GraphNode`, `KeysetKeyV1`'s wire shape, and the
logical/physical bound split are RATIFIED as landed; the fixture-derived bound
table is RATIFIED PROVISIONALLY — values stand, provisional entries confirm or
revise on the zb5 large-fixture validation; G2 and the LLP 0268 exit extension
commissioned the same day)
**Related:** LLP 0183 (D2 charter this Spec owns), LLP 0191 (evidence and the
five-rung ladder), LLP 0200 (the D4-side sibling: scheduling/settlement;
measured Phase-1 record in its §6a), LLP 0008 (DK-3 `live_delta` precedent,
authorization-invalidation amendment, scheduler/coalescing dated decisions),
LLP 0020 (captured-dependency matcher), LLP 0056 (membership rules),
LLP 0080/0110/0135/0157 (current bounded relational plans and composition),
LLP 0170 (information flow), LLP 0190 (D3 seams; §4's authority question this
Spec shares an answer with), LLP 0007 (query semantics, order/tie-break),
`issues/closed/20260808-oq4-coalescing-measurement-spike.md` (measured basis),
`issues/20260808-live-query-reevaluation-cost-at-scale.md` (workstream anchor),
`issues/20260808-d2-d4-owner-specs-commission.md` (charter source),
`issues/20260823-llp0209-g0-commission.md` (G0 commissioning packet),
LLP 0267 §5 (`queryCost.graph` — the sole bound-declaration carrier),
LLP 0268 §7 (nine named G0 inputs the exit record must carry)

## 0. Charter and position

LLP 0183 §D2 charters the *bounded relational graph profile*: generated,
bounded relational graphs replacing application-code joins, with declared
bounds, authorization at every node, and a conformance corpus. The LLP 0191
author rulings (2026-08-08, OQ1) commission this owner-Spec with rungs 2–4 of
§1's five-rung ladder as required content; rung 5 (delta-fed local replicas)
is *referenced* D3 scope reached through the D2–D3 interface in §8, not owned
here. Per LLP 0191 §5's decision, this Spec keeps what is architectural — the
finite graph IR, authorization at every node, affected-query dependencies,
completeness vocabulary, and server/local evaluator agreement — while the
schema-fidelity quick wins and the compiler prerequisite land independently
through their own owners: stored literal-union enums and structured
route-group argument lowering have since landed via the 2026-08-08 ticket
sweep, and numeric identity/default columns remain author-gated on the
identity-architecture decision
(`issues/20260808-identity-architecture-decision.md`). None of those are
D2 content.

The D4-side sibling, LLP 0200, owns evaluation scheduling, settlement
isolation, the authorization-lane split, and stream lifecycle (rung 1). The
two Specs are deliberately decoupled: LLP 0200 §5 records that rung 2 and
rungs 4–5 are not blocked by, nor blocking, its phases, and this Spec makes
the same commitment from its side. Where this Spec's mechanisms meet the
scheduler (memoization in §6, delta emission in §7), they slot into LLP 0200's
turn/frame machinery without changing its contracts.

## 1. Measured basis (what sizes this Spec)

All numbers are N=1 shape evidence under `benchmarks/protocol.md` unless
stated; sources: the OQ4 spike disposition
(`issues/closed/20260808-oq4-coalescing-measurement-spike.md`, twelve A/B
arms at the 5,549,113-row store) and LLP 0200 §6a (the Phase-1
implementation record and its A/B against the same baseline).

- **E-1 — evaluation cost is the unit everything multiplies.** One
  subscription evaluation at 5.5M rows: p50 863 ms, max 3.6 s (spike);
  the bounded list-engine run measured ~1.3 s standalone
  (`zb5-large.v3`). Six-observer arms delivered ~61–68 MB of frame bytes
  (full 1,000-row windows, replace lane, **zero** delta-lane deliveries —
  the hot queries are auth-scoped and relational, shapes today's
  `live_delta` lane excludes).
- **E-2 — matcher precision is already good on the measured inventory.**
  144 matcher decisions per six-observer arm: 75 match-replace, 69 skip,
  **0 conservative fallbacks, 0 delta**. The skip rate matched the
  receipt's 8-trigger/8-non-trigger partition; the 21 disagreements with
  predeclared relevance were the *predeclaration's* errors (18 ×
  `label.createAndAddToIssue`, which writes the `issueLabel` edge the
  list query joins — waking is correct; 3 × `viewState.set` waking only
  the writing principal's own observer — per-principal precision already
  working).
- **E-3 — sharing headroom is measured, not hypothesized.** Six
  same-partition observers (one principal, six subscriptions of the same
  query) cost the same as six mixed-partition observers (trigger settle
  p50 34.6 s coalesce-on / 40.4 s off): no sharing exists today, so
  same-authority memoization has clean ~6× headroom on this shape.
- **E-4 — after LLP 0200 Phase 1, per-turn evaluation cost is the binding
  constraint.** Phase 1 moved fan-out off the commit turn: burst trigger
  settle p50 15.3 s vs 45.3 s same-binary legacy (~3×), coalescer
  deferral 24/24 (vs 4/24), sustained settles 155/480 (vs ~105/480),
  durable→response p50 3.4–7.6 ms. But its H-1 was **not** met — settle
  p50 at six observers is ~15 s, not < 1 s, because mutations queue
  behind interleaved ~0.9 s evaluation turns — a scheduling-policy
  remainder (write priority,
  `issues/20260808-p1-write-priority-scheduling.md`) that LLP 0200 owns,
  multiplied by a per-turn cost only this Spec's rungs reduce. Whatever
  the D4 remainder recovers on settle latency, queue drain and
  convergence stay bounded by turn count × turn cost; making turns fewer
  (rung 3) and cheaper (rung 4) is this Spec's remit.

The leverage order these facts impose: **rung 3 first** (integer-factor
measured headroom, mechanism-cheap), **rung 4 where admitted shapes are
measured-hot** (orders of magnitude, but only for declared shapes),
**rung 2 demand-gated** (zero measured headroom on the hot inventory —
§5 says so plainly and scopes accordingly).

## 2. The graph IR

The profile is a **finite, acyclic, closed** intermediate representation.
An admitted graph is data, not code: no callbacks, no recursion, no
data-dependent graph construction, no unbounded child expansion, no
client-supplied ASTs (LLP 0183 §D2's exclusions, normative here).

**Node kinds** (the 0183 §D2 investigation list, made the v1 surface):

- one bounded **root window**: portable filters, stable multi-field order
  with the ascending `_id` tie-break (LLP 0007), keyset cursor, `take`;
- **equality to-one** relations;
- **bounded, parent-indexed to-many** relations;
- **exists/semi-join** nodes, including bounded repeated existence
  (all-selected-labels filtering) and declared through-tables;
- **principal-bound** relations, whose predicate binds the
  server-derived principal to private state (`viewState`, notification
  state);
- **admitted search membership** from D6 (an opaque membership input
  with a declared identity, not a re-implemented search);
- a **closed nested projection** over the above.

**Declared bounds.** Every admitted graph declares root, examined-entry,
relationship, fanout, argument, byte, summed-window, and maintained-write
bounds, sized from the normal and large fixtures — current ceilings are
not blindly reused (LLP 0183 §D2).

**Identity, graph-layered and context-wrapped.** Every admitted graph has a closed,
content-addressed, host-recomputed **plan identity** — the normalized
graph shape: nodes, projection, declared bounds, authority
classification (§3), result-contract identity — and every evaluation is
addressed by an **instance identity**: plan identity × canonical args ×
the keyed demand-paged-node window/range vector. These are the LLP 0190 §4.1 admission-record
axes split into their stable and per-demand halves; §2.4 then wraps the
instance in LLP 0157's app/database/target/activation/function materialization
context. The graph identity pair and contextual wrapper
is consumed by server execution, affected-read matching, memoization
keys (§6), delta emission (§7), retention and local evaluation (D3, via
§8), and inspection. The client's demand supplies args and demand-page
values; every identity is host-recomputed from the admitted plan and owner
context, and
the client can author neither the plan nor the admission
(LLP 0190 §3.3).

**Dependencies are part of the IR.** Each node kind defines the captured
read dependencies its execution contributes (§5). A graph plan without
per-node dependency capture would regress affected-read precision exactly
where the profile adds joins — today's two-source relational plans match
table-granularly by design
(`crates/snapback-kernel/src/live_matcher.rs:250`: a commit touching either
declared source resnapshots; LLP 0080 §4), which is honest for two tables and
unacceptable for a 22-relation graph.

### 2.1 The normalized carrier

The following is the complete graph-owned v1 grammar. `readonly` is
descriptive; the Rust/Serde types and generated JSON Schema are the wire
authority. The only unexpanded names are shipped closed owner types reused
byte-for-byte: `FilterExpr`, `OrderExpr`, `JoinEquality`,
`TableVisibilityV1`, `ArgumentBindingContractV1`,
`CanonicalClientValueV1`, `AuthorizationVersion`, and
`ExpectedGenerationV1`. Stage B may not create graph-local look-alikes or
choose another optional/null spelling.

```ts
// JSON Schema pattern: ^sha256:[0-9a-f]{64}$
type Sha256V1 = `sha256:${string}`
type GraphAuthorityClassV1 = 1 | 2 | 3
type GraphDirectionV1 = "forward" | "backward"

// Stage B introduces this wire carrier in snapback-types. Its JSON is
// byte-identical to the kernel's KeysetAfter; the kernel implements From/Into
// in both directions and retains KeysetAfter as its storage-native type.
type KeysetKeyV1 = Readonly<{
  // Declared-order field/value tuples only; `_id` is never an entry.
  entries: readonly (readonly [string, CanonicalClientValueV1])[]
  // The implicit final ascending `_id` tie-break.
  id: string
}>

type GraphArgumentV1 = Readonly<{
  argumentId: string
  name: string
  contract: ArgumentBindingContractV1
  contractHash: Sha256V1
}>

type GraphIntervalEndV1 =
  | Readonly<{ kind: "unbounded" }>
  | Readonly<{
      kind: "inclusive" | "exclusive"
      key: KeysetKeyV1
    }>

// The two spellings are exhaustive. Mixed literal/demand page fields do not
// exist in v1. A demand is transported outside the normalized plan.
type GraphDemandPageV1 = Readonly<{ kind: "demand" }>
type GraphLiteralPageV1 = Readonly<{
  kind: "literal"
  direction: GraphDirectionV1
  lower: GraphIntervalEndV1
  upper: GraphIntervalEndV1
  take: number
}>
type GraphChildPageV1 = GraphDemandPageV1 | GraphLiteralPageV1

type DirectEdgeV1 = Readonly<{
  table: string
  visibility: TableVisibilityV1
  joinOn: readonly JoinEquality[]
  accessIndex: string
}>

type ThroughEdgeV1 = Readonly<{
  table: string
  visibility: TableVisibilityV1
  parentJoin: readonly JoinEquality[]
  targetTable: string
  targetVisibility: TableVisibilityV1
  targetJoin: readonly JoinEquality[]
  parentIndex: string
  targetIndex: string
}>

type GraphPrincipalBindingV1 = Readonly<{
  table: string
  visibility: TableVisibilityV1
  principalField: string
  valueField: string
  uniqueIndex: string
}>

type GraphSearchScopeBindingV1 = Readonly<{
  providerScopeField: string
  source:
    | Readonly<{ kind: "argument"; argumentId: string }>
    | Readonly<{
        kind: "parent-field"
        nodeId: string
        field: string
      }>
}>

type GraphSearchMembershipIdentityV1 = Readonly<{
  format: "snapback.graph-search-membership-identity.v1"
  providerPlanHash: Sha256V1
  argumentContractHash: Sha256V1
  scopeContractHash: Sha256V1
  authorityClass: GraphAuthorityClassV1
  providerVersion: string
  providerCompletenessClass: "complete-membership-v1"
  membershipHash: Sha256V1
}>

type GraphProviderCompletenessClassV1 = "complete-membership-v1"

type GraphDataNodeKindV1 =
  | "root-window" | "equality-to-one" | "bounded-to-many"
  | "exists-semi-join" | "principal-bound" | "search-membership"
type GraphCompletenessLabelV1 =
  | "unknown" | "complete" | "prefix" | "window" | "refused"
type GraphNodeCompletenessProofClassV1 =
  | "none"
  | "refusal"
  | "whole-source"
  | "unique-point"
  | "parent-ranges"
  | "complete-membership"
  | "principal-point"
  | "provider-certificate"
  | "ordered-prefix"
  | "named-window"
  | "projection-composition"

type GraphAdmissionRefusalReasonV1 =
  | "SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN"
  | "SNAPBACK_GRAPH_CODE_FORBIDDEN"
  | "SNAPBACK_GRAPH_RECURSION_FORBIDDEN"
  | "SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION"
  | "SNAPBACK_GRAPH_ROOT_COUNT_INVALID"
  | "SNAPBACK_GRAPH_PROJECTION_COUNT_INVALID"
  | "SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED"
  | "SNAPBACK_GRAPH_UNKNOWN_FIELD"
  | "SNAPBACK_GRAPH_PARENT_INVALID"
  | "SNAPBACK_GRAPH_NODE_INERT"
  | "SNAPBACK_GRAPH_CYCLE"
  | "SNAPBACK_GRAPH_UNBOUNDED_EXPANSION"
  | "SNAPBACK_GRAPH_THROUGH_TABLE_UNDECLARED"
  | "SNAPBACK_GRAPH_SCHEMA_REFERENCE_INVALID"
  | "SNAPBACK_GRAPH_INDEX_UNPROVABLE"
  | "SNAPBACK_GRAPH_INDEX_PREFIX_UNSUPPORTED"
  | "SNAPBACK_GRAPH_ORDER_NOT_TOTAL"
  | "SNAPBACK_GRAPH_PROJECTION_SCOPE_INVALID"
  | "SNAPBACK_GRAPH_PROJECTION_OPEN"
  | "SNAPBACK_GRAPH_PRINCIPAL_BINDING_UNPROVABLE"
  | "SNAPBACK_GRAPH_SEARCH_UNADMITTED"
  | "SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE"
  | "SNAPBACK_GRAPH_BROADCAST_BASE_CLASS_INVALID"
  | "SNAPBACK_GRAPH_BROADCAST_SEPARATION_UNPROVABLE"
  | "SNAPBACK_GRAPH_BROADCAST_SCOPE_UNBOUND"
  | "SNAPBACK_GRAPH_BROADCAST_AUDIENCE_UNPROVABLE"
  | "SNAPBACK_GRAPH_BROADCAST_INVALIDATION_INCOMPLETE"
  | "SNAPBACK_GRAPH_BOUND_INVALID"
  | "SNAPBACK_GRAPH_RESULT_CONTRACT_MISMATCH"
  | "SNAPBACK_GRAPH_PLAN_IDENTITY_MISMATCH"
  | "SNAPBACK_GRAPH_ARGUMENT_UNBOUND"

type GraphDemandTimeRefusalReasonV1 =
  | "SNAPBACK_GRAPH_ARGUMENT_INVALID"
  | "SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID"
  | "SNAPBACK_GRAPH_CURSOR_UNBOUND"
  | "SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH"
  | "SNAPBACK_QUERY_COST_CLIENT_UNSUPPORTED"

type GraphEvaluationTimeRefusalReasonV1 =
  | "SNAPBACK_QUERY_COST_INDEX_REQUIRED"
  | "SNAPBACK_QUERY_COST_PAGINATION_REQUIRED"
  | "SNAPBACK_QUERY_COST_BOUND_EXCEEDED"
  | "SNAPBACK_QUERY_COST_LIVE_TURN_REFUSED"
  | "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED"
  | "SNAPBACK_STORAGE_VERSION_CORRUPT"
  | "SNAPBACK_AUTH_STALE_RESULT"
  | "SNAPBACK_LIVE_STAGE_FENCE_REQUIRED"
  | "SNAPBACK_WATCH_AUTHORITY_DEAD"
  | "SNAPBACK_LIVE_EVALUATION_TIMEOUT"

type GraphMaterializedRefusalReasonV1 =
  | GraphDemandTimeRefusalReasonV1
  | GraphEvaluationTimeRefusalReasonV1

type GraphQualificationFailureReasonV1 =
  | "SNAPBACK_GRAPH_QUALIFICATION_DERIVATION_MISSING"
  | "SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH"

type GraphCompletenessUnknownReasonV1 =
  | "proof-unavailable"
  | "parent-range-unproved"
  | "provider-incomplete"
  | "provider-proof-invalidated"
  | "zero-take-unproved"
  | "mixed-prefix-window"

type GraphRowKeyV1 = Readonly<{ table: string; id: string }>

// The non-negative safe-integer committed changeset version sampled by the
// scheduler's atomic coverage cut. Generated JSON Schema:
// {type:"integer", minimum:0}.
type GraphEvaluationCutV1 = number

type GraphCompletenessProofTupleV1 = Readonly<{
  materializationHash: Sha256V1
  partitionHash: Sha256V1
  authorizationVersion: AuthorizationVersion
  evaluationCut: GraphEvaluationCutV1
}>

type GraphNodeCompletenessEvidenceV1 =
  | Readonly<{
      kind: "root-window"
      label: "unknown"
      reason: GraphCompletenessUnknownReasonV1
    }>
  | Readonly<{
      kind: "equality-to-one"
      label: "unknown"
      reason: GraphCompletenessUnknownReasonV1
    }>
  | Readonly<{
      kind: "bounded-to-many"
      label: "unknown"
      reason: GraphCompletenessUnknownReasonV1
    }>
  | Readonly<{
      kind: "exists-semi-join"
      label: "unknown"
      reason: GraphCompletenessUnknownReasonV1
    }>
  | Readonly<{
      kind: "principal-bound"
      label: "unknown"
      reason: GraphCompletenessUnknownReasonV1
    }>
  | Readonly<{
      kind: "root-window"
      label: "refused"
      reason: GraphMaterializedRefusalReasonV1
    }>
  | Readonly<{
      kind: "equality-to-one"
      label: "refused"
      reason: GraphMaterializedRefusalReasonV1
    }>
  | Readonly<{
      kind: "bounded-to-many"
      label: "refused"
      reason: GraphMaterializedRefusalReasonV1
    }>
  | Readonly<{
      kind: "exists-semi-join"
      label: "refused"
      reason: GraphMaterializedRefusalReasonV1
    }>
  | Readonly<{
      kind: "principal-bound"
      label: "refused"
      reason: GraphMaterializedRefusalReasonV1
    }>
  | Readonly<{
      kind: "search-membership"
      label: "refused"
      reason: GraphMaterializedRefusalReasonV1
    }>
  | Readonly<{
      kind: "root-window"
      label: "prefix"
      order: readonly OrderExpr[]
      continuation: KeysetKeyV1
      stableOrderProof: "declared-order-with-id-tiebreak"
      take: number
      consumed: number
      hasMore: true
    }>
  | Readonly<{
      kind: "root-window"
      label: "window"
      interval: Readonly<{
        lower: GraphIntervalEndV1
        upper: GraphIntervalEndV1
      }>
      take: number
      consumed: number
      hasMore: false
    }>
  | Readonly<{
      kind: "root-window"
      label: "complete"
      interval: Readonly<{
        lower: Readonly<{ kind: "unbounded" }>
        upper: Readonly<{ kind: "unbounded" }>
      }>
      consumed: number
      hasMore: false
      sourceExhausted: true
    }>
  | Readonly<{
      kind: "equality-to-one"
      label: "complete"
      rows: readonly Readonly<{
        parentKey: GraphRowKeyV1
        found: boolean
      }>[]
    }>
  | Readonly<{
      kind: "bounded-to-many"
      label: "complete"
      ranges: readonly Readonly<{
        parentKey: GraphRowKeyV1
        consumed: number
        cap: number
        hasMore: false
      }>[]
    }>
  | Readonly<{
      kind: "bounded-to-many"
      label: "window"
      ranges: readonly Readonly<{
        parentKey: GraphRowKeyV1
        interval: Readonly<{
          lower: GraphIntervalEndV1
          upper: GraphIntervalEndV1
        }>
        consumed: number
        cap: number
        hasMore: boolean
      }>[]
    }>
  | Readonly<{
      kind: "bounded-to-many"
      label: "prefix"
      order: readonly OrderExpr[]
      stableOrderProof: "declared-order-with-id-tiebreak"
      ranges: readonly Readonly<{
        parentKey: GraphRowKeyV1
        consumed: number
        cap: number
        hasMore: true
        continuation: KeysetKeyV1
      }>[]
    }>
  | Readonly<{
      kind: "exists-semi-join"
      label: "complete"
      rows: readonly Readonly<{
        parentKey: GraphRowKeyV1
        existenceBit: boolean
      }>[]
    }>
  | Readonly<{
      kind: "principal-bound"
      label: "complete"
      rows: readonly Readonly<{
        parentKey: GraphRowKeyV1
        // Literal true (vacuous) when the normalized node omits binding.
        bindingFound: boolean
        targetFound: boolean
      }>[]
    }>
  | Readonly<{
      kind: "search-membership"
      label: "complete"
      providerCompletenessClass: "complete-membership-v1"
      providerCertificateHash: Sha256V1
    }>
  | Readonly<{
      kind: "search-membership"
      label: "unknown"
      providerCompletenessClass: GraphProviderCompletenessClassV1
      reason: "provider-incomplete" | "provider-proof-invalidated"
    }>
  | Readonly<{
      kind: "closed-projection"
      label: "unknown"
      composition: GraphCompositionProofV1
    }>
  | Readonly<{
      kind: "closed-projection"
      label: "refused"
      reason: GraphMaterializedRefusalReasonV1
      composition: GraphCompositionProofV1
    }>
  | Readonly<{
      kind: "closed-projection"
      label: "complete"
      composition: GraphCompositionProofV1
    }>
  | Readonly<{
      kind: "closed-projection"
      label: "prefix"
      composition: GraphCompositionProofV1
    }>
  | Readonly<{
      kind: "closed-projection"
      label: "window"
      composition: GraphCompositionProofV1
    }>

type GraphNodeCompletenessProofV1 = Readonly<
  GraphCompletenessProofTupleV1 & GraphNodeCompletenessEvidenceV1
>

type GraphCompositionNodeCitationV1 = Readonly<{
  nodeId: string
  nodeKind: GraphDataNodeKindV1
  label: GraphCompletenessLabelV1
  proofHash: Sha256V1
}>

type GraphCompositionProofV1 =
  | Readonly<GraphCompletenessProofTupleV1 & {
      kind: "graph-composition"
      label: "refused"
      nodes: readonly GraphCompositionNodeCitationV1[]
      primaryReason: GraphMaterializedRefusalReasonV1
    }>
  | Readonly<GraphCompletenessProofTupleV1 & {
      kind: "graph-composition"
      label: "unknown"
      nodes: readonly GraphCompositionNodeCitationV1[]
      reason: GraphCompletenessUnknownReasonV1
    }>
  | Readonly<GraphCompletenessProofTupleV1 & {
      kind: "graph-composition"
      label: "complete"
      nodes: readonly GraphCompositionNodeCitationV1[]
      allComplete: true
    }>
  | Readonly<GraphCompletenessProofTupleV1 & {
      kind: "graph-composition"
      label: "prefix"
      nodes: readonly GraphCompositionNodeCitationV1[]
      partialNodeIds: readonly string[]
    }>
  | Readonly<GraphCompletenessProofTupleV1 & {
      kind: "graph-composition"
      label: "window"
      nodes: readonly GraphCompositionNodeCitationV1[]
      partialNodeIds: readonly string[]
    }>

type GraphPartitionEquivalenceProofV1 = Readonly<{
  format: "snapback.graph-partition-equivalence-proof.v1"
  nodeId: string
  declaredClass: 2
  policyInputs: readonly [Readonly<{
    declarationId: string
    kind: "permissionBacking" | "membership" | "role"
    identity: Sha256V1
  }>, ...Readonly<{
    declarationId: string
    kind: "permissionBacking" | "membership" | "role"
    identity: Sha256V1
  }>[]]
  // SHA-256(ASCII "snapback:graph-partition-function:v1:" ||
  // RFC 8785 JCS(policyInputs)), preserving the vector's declared order.
  partitionFunction: Sha256V1
  equivalenceWitness: "declared-inputs-only"
}>

type GraphNodeAuthorityV1 =
  | Readonly<{ declaredClass: 1 | 3; proof: null }>
  | Readonly<{
      declaredClass: 2
      proof: GraphPartitionEquivalenceProofV1
    }>

type GraphQueryShapedReasonV1 =
  | "base-not-class-1"
  | "separation-unprovable"
  | "scope-unbound"
  | "audience-parity-failed"
  | "invalidation-incomplete"
  | "declared-query-shaped"

type GraphProjectionLiteralV1 = null | boolean | string | number

type GraphProjectionObjectV1 = Readonly<{
  scopeNodeId: string
  fields: readonly Readonly<{
    name: string
    value: GraphProjectionValueV1
  }>[]
}>

type GraphProjectionValueV1 =
  | Readonly<{ kind: "field"; nodeId: string; field: string }>
  | Readonly<{ kind: "literal"; value: GraphProjectionLiteralV1 }>
  | Readonly<{
      kind: "object"
      nodeId: string
      object: GraphProjectionObjectV1
    }>
  | Readonly<{
      kind: "array"
      scopeNodeId: string
      item: GraphProjectionObjectV1
    }>
  | Readonly<{ kind: "exists"; nodeId: string }>

type GraphNodeV1 =
  | Readonly<{
      nodeId: string
      kind: "root-window"
      edgeName: "$root"
      authority: GraphNodeAuthorityV1
      table: string
      visibility: TableVisibilityV1
      filters: readonly FilterExpr[]
      accessIndex: string
      order: readonly OrderExpr[]
      page: GraphDemandPageV1
    }>
  | Readonly<{
      nodeId: string
      kind: "equality-to-one"
      edgeName: string
      authority: GraphNodeAuthorityV1
      parentNodeId: string
      table: string
      visibility: TableVisibilityV1
      joinOn: readonly JoinEquality[]
      accessIndex: string
      presence: "required" | "optional"
      filters?: readonly FilterExpr[]
    }>
  | Readonly<{
      nodeId: string
      kind: "bounded-to-many"
      edgeName: string
      authority: GraphNodeAuthorityV1
      parentNodeId: string
      table: string
      visibility: TableVisibilityV1
      joinOn: readonly JoinEquality[]
      accessIndex: string
      order: readonly OrderExpr[]
      page: GraphChildPageV1
      filters?: readonly FilterExpr[]
    }>
  | Readonly<{
      nodeId: string
      kind: "exists-semi-join"
      edgeName: string
      authority: GraphNodeAuthorityV1
      parentNodeId: string
      mode: "exists"
      edge: DirectEdgeV1 | ThroughEdgeV1
      filters?: readonly FilterExpr[]
      argumentId?: never
    }>
  | Readonly<{
      nodeId: string
      kind: "exists-semi-join"
      edgeName: string
      authority: GraphNodeAuthorityV1
      parentNodeId: string
      mode: "all"
      edge: DirectEdgeV1 | ThroughEdgeV1
      argumentId: string
      filters?: readonly FilterExpr[]
    }>
  | Readonly<{
      nodeId: string
      kind: "principal-bound"
      edgeName: string
      authority: Readonly<{ declaredClass: 3; proof: null }>
      parentNodeId: string
      table: string
      visibility: TableVisibilityV1
      parentJoin: readonly JoinEquality[]
      principalField: string
      accessIndex: string
      principalSource: "auth.userId"
      binding?: GraphPrincipalBindingV1
      filters?: readonly FilterExpr[]
    }>
  | Readonly<{
      nodeId: string
      kind: "search-membership"
      edgeName: string
      authority: GraphNodeAuthorityV1
      parentNodeId: string
      providerCapabilityId: string
      membershipIdentity: GraphSearchMembershipIdentityV1
      memberField: string
      scopeBindings: readonly GraphSearchScopeBindingV1[]
      invalidationTables: readonly string[]
      providerCompletenessClass: GraphProviderCompletenessClassV1
      argumentIds?: readonly string[]
    }>
  | Readonly<{
      nodeId: string
      kind: "closed-projection"
      edgeName: "$result"
      authority: GraphNodeAuthorityV1
      object: GraphProjectionObjectV1
    }>

type GraphNodeCostV1 = Readonly<{
  nodeId: string
  maxRootRowsPerPage?: number
  maxExaminedEntriesPerExecution: number
  maxRelationshipLookupsPerExecution?: number
  maxChildrenPerParent?: number
  maxArgumentExpansion?: number
  maxWindowPages?: number
  maxWindowRootRows?: number
  maxWindowScannedRows?: number
  maxWindowResultRows?: number
  maxWindowResultBytes?: number
  maxWindowIndexRanges?: number
}>

type GraphQueryCostV1 = Readonly<{
  nodes: readonly GraphNodeCostV1[]
  arguments: readonly Readonly<{
    argumentId: string
    maxItems: number
  }>[]
  maxArgumentItems: number
  maxPageResultBytes: number
  // Host-derived checked sums of the six corresponding per-node fields.
  windowRollup: Readonly<{
    maxWindowPages: number
    maxWindowRootRows: number
    maxWindowScannedRows: number
    maxWindowResultRows: number
    maxWindowResultBytes: number
    maxWindowIndexRanges: number
  }>
  maxMaintainedWritesPerMutation: number
}>

type GraphAuthorityEventSelectorV1 =
  | Readonly<{
      kind: "permission-backing-write"
      table: string
      permissionFields: readonly string[] | null
      scope:
        | Readonly<{
            kind: "bindings"
            bindings: readonly Readonly<{
              rowField: string
              scopeArgumentId: string
            }>[]
          }>
        | Readonly<{ kind: "all-declaration-scopes" }>
    }>
  | Readonly<{
      kind: "authorization-metadata-activation"
      declarationId: string
    }>
  | Readonly<{
      kind: "authorization-incarnation-change"
      cause: "app-reset" | "logical-import" | "declared-physical-restore"
    }>
  | Readonly<{
      kind: "out-of-band-permission-revocation"
      declarationId: string
    }>
  | Readonly<{
      kind: "authority-transition"
      cause: "login" | "logout" | "user-switch" | "session-expiry"
           | "admin-session-revocation" | "lease-expiry"
           | "grant-issued" | "grant-ended"
           | "credential-issued" | "credential-ended"
           | "token-issued" | "token-ended"
    }>

type GraphAuthorityPartitionRuleV1 = Readonly<{
  format: "snapback.graph-authority-partition-rule.v1"
  class2Inputs: readonly Readonly<{
    nodeId: string
    declarationId: string
    scopeArgumentIds: readonly string[]
    policyIdentity: Sha256V1
    eventSelectors: readonly GraphAuthorityEventSelectorV1[]
  }>[]
  class3: "none" | "partition-of-one"
}>

type GraphBroadcastScopeV1 = Readonly<{
  argumentIds: readonly string[]
  policyIdentity: Sha256V1
  resourceEqualities: readonly Readonly<{
    nodeId: string
    field: string
    argumentId: string
  }>[]
}>

type GraphBroadcastEstablishmentV1 = Readonly<{
  effect: "admit-only"
  predicate: TableVisibilityV1
  overlayProjection: null
  scope: GraphBroadcastScopeV1
  audience: Readonly<{ strictEvaluatorIdentity: Sha256V1 }>
  invalidation: readonly Readonly<{
    declarationId: string
    event: GraphAuthorityEventSelectorV1
    affectedScopeArgumentIds: readonly string[]
  }>[]
}>

type GraphBroadcastAdmissionV1 =
  | Readonly<{
      format: "snapback.graph-broadcast-admission.v1"
      classification: "query-shaped"
      reason: GraphQueryShapedReasonV1
    }>
  | Readonly<{
      format: "snapback.graph-broadcast-admission.v1"
      classification: "broadcast"
      baseNodeIds: readonly string[]
      establishment: GraphBroadcastEstablishmentV1
    }>

type GraphQueryPlanV1 = Readonly<{
  format: "snapback.graph-query-plan.v1"
  capabilityId: "graph_query_v1"
  rootNodeId: "n0"
  nodes: readonly GraphNodeV1[]
  arguments: readonly GraphArgumentV1[]
  queryCost: Readonly<{
    // LLP 0267 whole-query/operational siblings. The three live fields are
    // orthogonal policy, not a ninth graph-bound family.
    maxScannedRows: number
    maxIndexRanges: number
    maxResultRows: number
    maxResultBytes: number
    maxEvaluationTurnMs: number
    maxObservers: number
    maxDistinctEvaluationGroups: number
    maxEstimatedLiveFanoutMs: number
    graph: GraphQueryCostV1
  }>
  authorityPartitionRule: GraphAuthorityPartitionRuleV1
  broadcast: GraphBroadcastAdmissionV1
  resultContractHash: Sha256V1
}>

// Exact payload of Rust HandlerPlan::GraphQuery. Serde's externally tagged
// HandlerPlan spelling is {GraphQuery: GraphQueryCarrierV1}.
type GraphQueryCarrierV1 = Readonly<{
  normalizedPlan: GraphQueryPlanV1
  planHash: Sha256V1
}>
type GraphPlanIdentityV1 = GraphQueryCarrierV1

type GraphWindowIdentityV1 = Readonly<{
  // Copied from the node's declared order, which excludes the implicit `_id`
  // tie-break, and exact-matched at demand time.
  order: readonly OrderExpr[]
  direction: GraphDirectionV1
  lower: GraphIntervalEndV1
  upper: GraphIntervalEndV1
  take: number
}>

type GraphParentWindowIdentityV1 = Readonly<{
  // null is valid only for the root; child entries require the exact parent.
  parentKey: GraphRowKeyV1 | null
  window: GraphWindowIdentityV1
}>
type GraphNodeWindowIdentityV1 = Readonly<{
  nodeId: string
  intervals: readonly GraphParentWindowIdentityV1[]
}>

type GraphInstancePreimageV1 = Readonly<{
  format: "snapback.graph-instance.v1"
  graphPlanHash: Sha256V1
  argsDigest: Sha256V1
  windows: readonly GraphNodeWindowIdentityV1[]
}>
type GraphInstanceIdentityV1 = Readonly<{
  preimage: GraphInstancePreimageV1
  instanceHash: Sha256V1
}>

type GraphExportedFunctionIdentityV1 = Readonly<{
  artifactKind: "functionReference"
  schemaVersion: string
  appId: string
  id: string
  name: string
  kind: "Query" | "LiveQuery"
  implementationHash: Sha256V1
  argsContractHash: Sha256V1
  resultContractHash: Sha256V1
  expectedGeneration: ExpectedGenerationV1
}>
type GraphMaterializationPreimageV1 = Readonly<{
  format: "snapback.graph-materialization.v1"
  appId: string
  databaseId: string
  deploymentId: string
  targetProfileId: string
  activationHash: Sha256V1
  function: GraphExportedFunctionIdentityV1
  graphInstanceHash: Sha256V1
}>
type GraphMaterializationIdentityV1 = Readonly<{
  preimage: GraphMaterializationPreimageV1
  materializationHash: Sha256V1
}>
```

Every record is closed; `?` means absent-or-present and never `null`. Literal
numbers are finite JSON numbers, and integer/count fields are exact
non-negative safe integers subject to §2.6. `filters` is absent only when its
conjunction is empty. `argumentIds` is absent only when search has no provider
arguments; when present it is non-empty. `scopeBindings` and
`invalidationTables` are non-empty. Every digest exact-matches its owner
artifact before admission. `GraphPartitionEquivalenceProofV1.policyInputs`
is non-empty and sorts by `(declarationId,kind,identity)` in RFC 8785 string
order; that normalized array order is its declared order.
**[author-ratify]** `partitionFunction` is exactly lowercase SHA-256 over ASCII
`snapback:graph-partition-function:v1:` followed by RFC 8785 JCS of the
`policyInputs` vector itself in that order—there is no wrapper object. An
authored mismatch refuses `SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE`.
The normalized proof is plan content at `GraphNodeV1.authority.proof`, is
present exactly when `declaredClass` is 2, and is literal `null` for class 1
or 3. It therefore participates in plan normalization and the plan hash.
Every `Sha256V1` string exact-matches JSON Schema
pattern `^sha256:[0-9a-f]{64}$`; the template-literal notation above is only
the TypeScript shorthand. A search node's `authority.declaredClass` and
`providerCompletenessClass` must exact-match the same fields nested in
`membershipIdentity`; its canonical `argumentIds` and `scopeBindings` must
reproduce `argumentContractHash` and `scopeContractHash`, and the provider
certificate must reproduce `providerPlanHash`, `providerVersion`, and
`membershipHash`.

`KeysetKeyV1` is wire-identical to kernel `KeysetAfter`
(`crates/snapback-kernel/src/storage.rs:8004`–`:8007`) rather than a value-only
graph look-alike. Each `entries` element is the JSON two-tuple
`[field, value]`; its JSON Schema has `type:"array"`,
`prefixItems:[{type:"string"}, <CanonicalClientValueV1 schema>]`, and
`minItems:2,maxItems:2`. Entry field names exact-match the node's declared
`order` fields in that order; `_id` is forbidden in both `entries` and
`order`. The separate `id` is the implicit final ascending `_id` tie-break
after the declared-order entries. `KeysetKeyV1` is only a continuation or
interval-end boundary carrier, never a parent-row identity. This is the same
tuple-array shape frozen in
`schemas/migration.journal-entry.schema.json:52`–`:74`.

`AuthorizationVersion` is the existing closed `{incarnation,epoch}`
authorization-version spelling reused byte-for-byte and governed by LLP 0008
§Authorization-Aware Sync (and implemented at
`crates/snapback-types/src/storage.rs:20`). `GraphEvaluationCutV1` is the
existing non-negative safe-integer committed changeset version: LLP 0200 §2.2
samples that value at the atomic coverage cut, and LLP 0008 §Realtime Delivery
keeps the same comparable changeset version on the wire. Its generated schema
is exactly `type:"integer", minimum:0`; host validation also rejects values
outside the JavaScript safe-integer range, while the store owner is the `u64`
returned by `crates/snapback-kernel/src/storage.rs:9011`. These are independent
closed axes; neither is a free-form `version:string`.

Projection output cardinality and lexical row scope are closed. The top-level
result is one ordered array entry per root row, and its `object.scopeNodeId`
is the root. Every `GraphProjectionObjectV1` is bound to exactly that one row
scope. A `field` may name the scope node or an ancestor on its unique root
path; each is the one correlated row on that parent chain. The sole exception
does not create another row scope: fields of an `equality-to-one` or
`principal-bound` child are referenced from an object scoped to that child's
parent. A nested `object.nodeId` names that to-one child, its
`object.scopeNodeId` exact-matches the parent scope, and it emits one object on
a hit, literal `null` on an admitted optional miss, or refusal on a required
miss. A bare `field` naming that to-one child outside the `object` wrapper is
invalid, even when the child exists. The `object` arm is only the to-one
scope transition just described: using it to group fields from the current
scope (`nodeId` equal to the enclosing `scopeNodeId`) is also invalid. Both
forms refuse `SNAPBACK_GRAPH_PROJECTION_SCOPE_INVALID`.

A to-many/semi-join child row may be referenced only by an `array` projection
whose `scopeNodeId` is that row-producing node and whose
`item.scopeNodeId` exact-matches it; the array emits one object per child row
in node order. In v1, `bounded-to-many` is the row-producing arm.
An `exists-semi-join` itself is predicate-only and may be referenced only by
`exists`, which emits one Boolean and establishes no row scope. Thus sibling,
unarrayed descendant, descendant-to-ancestor inversion, and any other
cross-cardinality reference refuse
`SNAPBACK_GRAPH_PROJECTION_SCOPE_INVALID`. A `field`, `literal`, or `exists`
otherwise produces exactly one value in its enclosing object.

Projection field names are non-empty and unique within an object. Their array
order is semantic declaration order: emitted JSON object keys appear in that
exact order, and emitted arrays appear in child-node order. The plan hash
therefore preserves each `fields` array rather than sorting it. A literal
payload is exactly the adjacent scalar or `null`, never executable code, an
omitted value, or a nested open JSON value.

Worked scope example — issue → labels array → label to-one:

```ts
{
  scopeNodeId: "n0", // issue root
  fields: [
    {name: "id", value: {kind: "field", nodeId: "n0", field: "id"}},
    {name: "labels", value: {kind: "array", scopeNodeId: "n1", item: {
      scopeNodeId: "n1", // issueLabel child row
      fields: [
        {name: "edgeId", value: {kind: "field", nodeId: "n1", field: "id"}},
        {name: "label", value: {kind: "object", nodeId: "n2", object: {
          scopeNodeId: "n1", // label to-one is read from its parent scope
          fields: [
            {name: "id", value: {kind: "field", nodeId: "n2", field: "id"}},
            {name: "name", value: {kind: "field", nodeId: "n2", field: "name"}},
          ],
        }}},
      ],
    }}},
  ],
}
```

The bytes place `id` before `labels`, each label entry places `edgeId` before
`label`, and the labels array follows `n1`'s declared order. If the optional
`n2` edge misses, the `label` value is JSON `null`.

The compiler, not the author, assigns dense `nodeId` values by one unique
preorder DFS: emit the current non-projection node immediately; recurse into
its owned children sorted by RFC 8785 UTF-16 code-unit `edgeName` order; after
the root subtree is exhausted, emit the sole projection node last. The emitted
preorder index is the id: `n0`, `n1`, ... . For a four-node graph whose root
`$root` owns sibling `labels` and `comments` children and whose projection is
`$result`, UTF-16 `edgeName` ordering visits `comments` first: the walk emits
`$root → n0`, `comments → n1`, `labels → n2`, `$result → n3`. `edgeName` is
required and unique among one parent's children. This makes source declaration
order irrelevant while retaining stable diagnostics. All node references use
the recomputed ids.

Arguments sort by RFC 8785 UTF-16 code-unit `name` order; after sorting, the
compiler assigns `argumentId` values `a0`, `a1`, ... and the host recomputes
them. `contract` and `contractHash` reuse LLP 0157 §D2's
`ArgumentBindingContractV1`. A collection requires the matching
`queryCost.graph.arguments` entry in §2.6; a scalar forbids one. A collection
without that `maxItems`, or with a `maxItems` larger than its argument-contract
maximum, refuses. Graph filters bind by that rewritten id, never the authored
name: the normalized `ValueExpr::Arg(String)` inside `FilterExpr.value`
carries `a0`, `a1`, ... . The compiler rewrites authored names to ids during
normalization and refuses any reference it cannot bind with
`SNAPBACK_GRAPH_ARGUMENT_UNBOUND`. No runtime argument value is present in a
plan.

The shipped field and identity precedents are concrete: `TableVisibilityV1`
is the closed public/owner/membership/any-of union
(`crates/snapback-types/src/manifest/types.rs:1235`);
`RelationalQueryPlan`, `BoundedChildrenQueryPlan`, and
`SnapshotBatchPlanV2` are closed Serde records at
`crates/snapback-types/src/manifest/types.rs:8977`,
`crates/snapback-types/src/manifest/types.rs:9051`, and
`crates/snapback-types/src/manifest/types.rs:9190`;
and `FilterExpr`, `FilterOp`, and `OrderExpr` are at
`crates/snapback-types/src/manifest/types.rs:10265`,
`crates/snapback-types/src/manifest/types.rs:10272`, and
`crates/snapback-types/src/manifest/types.rs:10282`.
`JoinEquality` is the shipped closed pair at
`crates/snapback-types/src/contract_types.rs:1897`.
`GraphQueryPlanV1` reuses those value types; it does not copy their JSON into
new look-alike types.

### 2.2 Node kinds

Common required fields on every non-projection node are `nodeId`, `kind`,
`edgeName`, and `authority`. `authority.declaredClass` is the node class and
`authority.proof` follows §2.1's class-discriminated placement. Any node that directly reads one declared
application table, rather than reading through `edge` or an owner-issued
provider certificate, additionally requires `table`, `accessIndex`, and an
explicit `visibility: TableVisibilityV1`; public read is represented as
`{kind:"public-read"}`, not omission. Bounds exist only in the
`queryCost.graph` records in §2.6, keyed by `nodeId`; they are not node
fields. `FilterExpr[]` is a conjunction. Normalized `OrderExpr[]` is exactly
the non-empty declared semantic order and never contains `_id`; the compiler
rejects an authored `_id` entry. The one total-order rule is: after every
declared component, the kernel appends `_id ASC` to the SQL order as the
implicit tie-break; `KeysetKeyV1.id` only carries that boundary value and
applies no ordering itself. This applies LLP 0007's total-order rule and
reuses the shipped `KeysetAfter {entries,id}` boundary
(`crates/snapback-kernel/src/storage.rs:8004`). Stage B introduces
`KeysetKeyV1` in `snapback-types` with byte-identical JSON and adds `From` and
`Into` conversions in both directions in the kernel; the storage-native
`KeysetAfter` remains in place and is not moved.

In the table, `new` means new to `graph_query_v1`; all unqualified names are
literal normalized-record field names. “Dependency” names refer to §5.

| Kind | Required fields | Optional fields | Reuse/new | Cardinality and edge rules | Exact `queryCost.graph` declarations | §5 dependencies | Allowed authority class |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `root-window` | common fields; `table`; `visibility`; `filters`; `accessIndex`; non-empty `order`; `page:{kind:"demand"}` | none | `FilterExpr`, `OrderExpr`, `TableVisibilityV1` reused; `KeysetKeyV1` is the new wire-identical carrier for kernel `KeysetAfter`; demand page and named interval ends new | Exactly one; no parent; every non-projection node is reachable from it; maximum child-node count is its immutable normalized out-degree; the demand supplies `take`/direction/ends and contributes the mandatory root entry to §2.4's window vector | `maxRootRowsPerPage`; node `maxExaminedEntriesPerExecution`; all six node `maxWindow*` fields; whole-query `queryCost.maxScannedRows`; collection inputs also use the argument fields below | root range `Query`, returned `Row`, point-shaped `MissingRow`, `GraphNode.RootRange` | 1, 2, or 3 when §3 proves it |
| `equality-to-one` | common fields; `parentNodeId`; `table`; `visibility`; ordered non-empty `joinOn`; unique `accessIndex`; `presence: "required" \| "optional"` | `filters` | `JoinEquality`, `FilterExpr`, `TableVisibilityV1` reused; `parentNodeId`/`presence` new | Child of root, to-one, to-many, or principal-bound; one incoming edge; zero or one child row per parent, statically proved by the complete unique-index key; maximum child-node count is its immutable normalized out-degree | node `maxExaminedEntriesPerExecution`; `maxRelationshipLookupsPerExecution`; no `maxChildrenPerParent` (fixed one) | concrete-key point `Row`/`MissingRow`; storage-free null/omitted `GraphNode.ParentEdge` attempt | 1, 2, or 3 when §3 proves it |
| `bounded-to-many` | common fields; `parentNodeId`; `table`; `visibility`; ordered non-empty `joinOn`; `accessIndex`; non-empty `order`; `page` | `filters` | shipped expressions/visibility/keyset reused; parent-indexed edge and per-parent page new | Child of root, to-one, to-many, or principal-bound; one incoming edge; maximum child-node count is its immutable normalized out-degree; emitted rows per parent are at most the node's `maxChildrenPerParent`; `page:{kind:"literal",direction,lower,upper,take}` is wholly plan-literal and adds no demand identity, while `page:{kind:"demand"}` supplies all four values per parent and adds one keyed §2.4 vector entry for the node; no mixed spelling exists | node `maxExaminedEntriesPerExecution`; `maxRelationshipLookupsPerExecution`; `maxChildrenPerParent`; a demand-paged node also carries all six node `maxWindow*` fields | per-parent range `Query`, returned `Row`, empty range, `GraphNode.ParentRange` | 1, 2, or 3 when §3 proves it |
| `exists-semi-join` | common fields; `parentNodeId`; `mode: "exists" \| "all"`; `edge: DirectEdgeV1 \| ThroughEdgeV1` | `filters`; `argumentId` only for `all` | `JoinEquality`, `FilterExpr`, `TableVisibilityV1` reused; bounded repeated existence and `ThroughEdgeV1 {table, visibility, parentJoin, targetTable, targetVisibility, targetJoin, parentIndex, targetIndex}` new | Predicate child of root or another result-bearing relation; leaf, so maximum child-node count is zero; contributes no result row unless projection uses its `exists` bit; `all` requires one bounded collection `argumentId`, probes each distinct canonical item once, and uses no vacuous hidden-row shortcut; a through table must be named in `ThroughEdgeV1` | node `maxExaminedEntriesPerExecution`; `maxRelationshipLookupsPerExecution`; `maxChildrenPerParent`; `all` also declares argument `maxItems`, graph `maxArgumentItems`, and node `maxArgumentExpansion` | membership plus direct bounded-range `Query` or unique point, or through edge-range `Query` plus target points; never `Permission` | 1, 2, or 3 when every edge and predicate has that proof |
| `principal-bound` | common fields; `parentNodeId`; `table`; `visibility`; `parentJoin`; `principalField`; unique `accessIndex`; `principalSource: "auth.userId"` | `binding: {table, visibility, principalField, valueField, uniqueIndex}` only when the target stores an app-user id instead of `v.principal()`; `filters` | table/filter/visibility/join reused; server-principal source and optional declared binding new | Child of root, to-one, or to-many; maximum child-node count is its immutable normalized out-degree; exactly zero or one row per `(principal,parent)` from the complete unique index; the optional binding is one unique point step and may not be caller-selected. This covers Zerobugs' `identityBinding` plus private `viewState`/notification rows (`demos/zerobugs/control/snapback/schema.mjs:149`, `demos/zerobugs/control/snapback/schema.mjs:70`, `demos/zerobugs/control/snapback/schema.mjs:134`) | node `maxExaminedEntriesPerExecution`; `maxRelationshipLookupsPerExecution`; fixed fanout one | `Auth`, target `Row`/`MissingRow`, optional-binding `Row`/`MissingRow` only when present, `GraphNode.PrincipalField` | 3 only |
| `search-membership` | common fields; `parentNodeId`; `providerCapabilityId`; `membershipIdentity`; `memberField`; `scopeBindings`; non-empty `invalidationTables`; `providerCompletenessClass` | `argumentIds` | parent field binding reused; provider certificate, membership identity, and invalidation tables new; the graph never embeds or evaluates search text | Predicate child of root only in v1; leaf, so maximum child-node count is zero; one admitted membership input may filter the root; no nested search, result hydration, or search implementation; the provider certificate binds plan, arguments, scope, authority class, version, and completeness | node `maxExaminedEntriesPerExecution`; `maxRelationshipLookupsPerExecution`; collection args use `maxItems`, `maxArgumentItems`, `maxArgumentExpansion` | `GraphNode.SearchTable` for every declared table; always table-granular in G0/G2 | exactly the class in the owner-issued provider certificate: 1, 2, or 3 |
| `closed-projection` | `nodeId`; `kind`; `edgeName`; `object: GraphProjectionObjectV1`; `authority` | none | closed nested projection new; scalar leaves reuse shipped result-value contracts and `resultContractHash` | Exactly one and last; no table and no children. Every object carries §2.1's lexical `scopeNodeId`; object fields preserve declared emitted-key order and use the exact `field {nodeId,field}`, `literal {value}`, `object {nodeId,object}`, `array {scopeNodeId,item}`, or `exists {nodeId}` arms. Every reference must satisfy the scope/correlation rules; undeclared fields and open objects refuse | no independent bound; its serialized whole result consumes `queryCost.maxResultBytes`/`maxPageResultBytes` and the per-lineage window byte/row fields | no storage read; `GraphNode.Projection` links source node ids for ledger composition | maximum class of every referenced or predicate-affecting node; author cannot declare it lower |

Every non-root, non-projection node has exactly one `parentNodeId`, so the
owned node edges form a rooted tree. The §2.1 walk rejects a back edge before
assigning ids; projection references do not add ownership edges. “Normalized
out-degree” above is the exact count of statically declared children in that
tree, not a runtime/data-dependent value and not a second work-bound carrier.

`DirectEdgeV1` is the closed record `{table, visibility, joinOn,
accessIndex}`. `ThroughEdgeV1` is the exact record shown in the table; both
join lists preserve index-component order. A direct or through edge with an
unproved index, cardinality, table policy, or nominal id domain refuses; it
never degrades to a scan. In every `JoinEquality`, `rootField` is the upstream
component and `joinedField` is the downstream component. Therefore
`parentJoin` maps parent → through and `targetJoin` maps through → target;
neither edge reverses those meanings.

### 2.3 Closure, admission, demand-time, evaluation-time, and qualification registers

**Admission refusals** are decidable from the candidate manifest, installed
schema, and installed policy declarations alone. Admission evaluates the
following rules in the listed order. The first miss is the public `refused`
reason; later misses may be value-free diagnostic notes. These identifiers and
their precedence are part of the v1 conformance contract. This register owns
plan reconstruction, `baseNodeIds` recomputation, schema/policy proofs, and
closure; it consumes no runtime arguments, cursor, partition, or
materialization instance.

| Order | Refusal reason | Exact refused condition |
| ---: | --- | --- |
| 1 | `SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN` | The manifest declares any node, field, filter, order, projection, table, index, or operator position as argument-bindable instead of closing it as plan data. This condition is decided from the manifest argument-routing declarations; it does not inspect a runtime value. |
| 2 | `SNAPBACK_GRAPH_CODE_FORBIDDEN` | The declaration contains a callback, JavaScript body, SQL text, dynamic property/table access, ambient time/randomness/network access, or any executable value. |
| 3 | `SNAPBACK_GRAPH_RECURSION_FORBIDDEN` | A node or projection recursively contains itself or invokes the graph. |
| 4 | `SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION` | A node/edge/projection exists only on a data-, authority-, or argument-dependent construction branch rather than as unconditional plan data. |
| 5 | `SNAPBACK_GRAPH_ROOT_COUNT_INVALID` | The normalized plan has other than one `root-window`. |
| 6 | `SNAPBACK_GRAPH_PROJECTION_COUNT_INVALID` | The normalized plan has other than one `closed-projection`, or it is not last. |
| 7 | `SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED` | A node kind or tagged-union arm is outside §2.2. |
| 8 | `SNAPBACK_GRAPH_UNKNOWN_FIELD` | Any closed record has an unknown field, duplicate field/name, control character, or invalid identifier. |
| 9 | `SNAPBACK_GRAPH_PARENT_INVALID` | A non-root node lacks exactly one existing, kind-allowed parent, a projection reference is unreachable, or a node is orphaned. |
| 10 | `SNAPBACK_GRAPH_NODE_INERT` | A reachable non-projection node cannot affect bytes, membership, order, length, existence bits, completeness, refusal, or future delta construction and is therefore outside §4.2's exact input set. |
| 11 | `SNAPBACK_GRAPH_CYCLE` | The parent/reference graph is cyclic. |
| 12 | `SNAPBACK_GRAPH_UNBOUNDED_EXPANSION` | A child, argument multiplication, page, or repeated-existence path lacks its applicable §2.6 bound. |
| 13 | `SNAPBACK_GRAPH_THROUGH_TABLE_UNDECLARED` | An exists/membership path consults a table not named in its `DirectEdgeV1`/`ThroughEdgeV1`, or a through edge omits either join/index/visibility. |
| 14 | `SNAPBACK_GRAPH_SCHEMA_REFERENCE_INVALID` | A named table, field, nominal id domain, policy declaration, result-contract leaf, or capability id does not exist in the installed owner artifacts. |
| 15 | `SNAPBACK_GRAPH_INDEX_UNPROVABLE` | An access index is missing, ordered incompatibly, not bounded by the equality prefix/range, or not unique where v1 requires uniqueness. |
| 16 | `SNAPBACK_GRAPH_INDEX_PREFIX_UNSUPPORTED` | An `accessIndex` equality/range prefix cannot support §2.6's unique entries-per-consultation cap for that node and would require an unbounded suffix scan. |
| 17 | `SNAPBACK_GRAPH_ORDER_NOT_TOTAL` | An order is empty where required, uses an unportable field/direction, contains the reserved `_id` field, or cannot accept the implicit ascending `_id` tie-break. |
| 18 | `SNAPBACK_GRAPH_PROJECTION_SCOPE_INVALID` | A projection object's `scopeNodeId` is absent/wrong, a field names a sibling or uncorrelated descendant, a to-many row is referenced without its array scope, a to-one field appears bare outside its required `object` wrapper, an `object` merely groups fields from the same scope, a to-one is not referenced from its parent scope, or another cross-cardinality reference violates §2.1. |
| 19 | `SNAPBACK_GRAPH_PROJECTION_OPEN` | A projection is open, references an unprojectable field/node, or fails the exact result contract after lexical-scope validation. |
| 20 | `SNAPBACK_GRAPH_PRINCIPAL_BINDING_UNPROVABLE` | A principal node accepts caller identity, lacks a unique declared binding, or cannot prove the target principal field from `auth.userId`. |
| 21 | `SNAPBACK_GRAPH_SEARCH_UNADMITTED` | A search input lacks an owner-issued provider identity/class/completeness/invalidation certificate or attempts graph-side search evaluation. |
| 22 | `SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE` | §3 cannot prove the declared class and complete authority inputs for every node. |
| 23 | `SNAPBACK_GRAPH_BROADCAST_BASE_CLASS_INVALID` | The manifest authors `classification:"broadcast"`, but at least one host-recomputed `baseNodeIds` member derives valid authority class 2 or 3 rather than the class 1 required by LLP 0268 §1.1. |
| 24 | `SNAPBACK_GRAPH_BROADCAST_SEPARATION_UNPROVABLE` | The manifest authors `classification:"broadcast"`, but its certificate does not match the host proof because the establishment predicate reaches result membership/projection/order/length/existence/completeness or produces an overlay. |
| 25 | `SNAPBACK_GRAPH_BROADCAST_SCOPE_UNBOUND` | The manifest authors `classification:"broadcast"`, but its certificate does not match the host proof of §3.3 same-instance canonical-argument/resource equality. |
| 26 | `SNAPBACK_GRAPH_BROADCAST_AUDIENCE_UNPROVABLE` | The manifest authors `classification:"broadcast"`, but its certificate does not match the host proof that the establishment deny-set equals the strict fail-closed audience at the same instance and authorization version. |
| 27 | `SNAPBACK_GRAPH_BROADCAST_INVALIDATION_INCOMPLETE` | The manifest authors `classification:"broadcast"`, but its certificate does not match the host proof because an establishment input lacks a declared authorization-event-to-affected-scope mapping. |
| 28 | `SNAPBACK_GRAPH_BOUND_INVALID` | A bound is zero where work is required, exceeds its argument/result contract, overflows checked arithmetic, conflicts with another bound, or differs from §2.6's unique analytical function/derived rollup. |
| 29 | `SNAPBACK_GRAPH_RESULT_CONTRACT_MISMATCH` | The projection and host-recomputed `resultContractHash` do not describe the same exact serialized result. |
| 30 | `SNAPBACK_GRAPH_PLAN_IDENTITY_MISMATCH` | The emitted normalized plan, plan hash, or authored `baseNodeIds` differs from admission-time host reconstruction. |
| 31 | `SNAPBACK_GRAPH_ARGUMENT_UNBOUND` | A filter or other admitted expression refers to an authored argument name the compiler cannot rewrite to one normalized `argumentId`. |

**Demand-time refusals** depend on one request's arguments, cursor, partition,
or materialization inputs and therefore cannot inhabit the admission ladder.
Demand validation evaluates this separate register in the listed order; the
first miss is public and later misses may be value-free notes.

| Order | Refusal reason | Exact refused condition |
| ---: | --- | --- |
| 1 | `SNAPBACK_GRAPH_ARGUMENT_INVALID` | A runtime argument is missing/extra, fails its declared contract or canonical-value limits, or exceeds its per-argument or aggregate cardinality bound. |
| 2 | `SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID` | The demand omits/adds/duplicates a demand-paged node or per-parent interval, supplies a parent outside the evaluated parent set, uses a malformed end/direction/take, or violates canonical node/parent order. |
| 3 | `SNAPBACK_GRAPH_CURSOR_UNBOUND` | A cursor or cumulative ledger cannot authenticate against `(generation, planHash, argsDigest, partition, target, nodeId, canonical per-parent interval vector)` or cannot reproduce its direction/boundary/lineage. |
| 4 | `SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH` | The supplied instance/materialization record or hash differs from host reconstruction, or any `GraphWindowIdentityV1.order` differs byte-for-byte from its node's declared order. |
| 5 | `SNAPBACK_QUERY_COST_CLIENT_UNSUPPORTED` | An enabled live-query guardrail receives a connection that did not negotiate LLP 0267's exact terminal protocol before snapshot/establishment. |

**Evaluation-time refusals** occur only after the host has minted and begun a
real `GraphMaterializationIdentityV1`; they are result outcomes at that
materialization, even when no result bytes can be published. The register is
closed over the LLP 0267 §4.1 hard error siblings that can arise during
evaluation—`SNAPBACK_QUERY_COST_INDEX_REQUIRED`,
`SNAPBACK_QUERY_COST_PAGINATION_REQUIRED`,
`SNAPBACK_QUERY_COST_BOUND_EXCEEDED`,
`SNAPBACK_QUERY_COST_LIVE_TURN_REFUSED`, and
`SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED`—plus the existing storage and
authority-transition fence outcomes `SNAPBACK_STORAGE_VERSION_CORRUPT`,
`SNAPBACK_AUTH_STALE_RESULT`, `SNAPBACK_LIVE_STAGE_FENCE_REQUIRED`,
`SNAPBACK_WATCH_AUTHORITY_DEAD`, and `SNAPBACK_LIVE_EVALUATION_TIMEOUT`.
`SNAPBACK_QUERY_COST_WARNING` is not a refusal;
`SNAPBACK_QUERY_COST_CLIENT_UNSUPPORTED` is demand-time because it refuses
before materialization. Evaluation applies the owner register's ordering;
when two imported owner registers fire at the same materialization, the first
canonical node consulted wins, then the owner register order.

**Qualification failures** require corpus, fixture, or observation artifacts
that manifest admission cannot see. They block G0 exit and every capability
publication, but do not retroactively turn a structurally admitted manifest
into an admission refusal. Qualification failures have no precedence at all:
the runner reports the complete set of failures it observes, in stable id
order, rather than selecting a primary failure or comparing them with another
register.

| Qualification failure | Exact failed condition |
| --- | --- |
| `SNAPBACK_GRAPH_QUALIFICATION_DERIVATION_MISSING` | An applicable declared bound lacks the required fixture/oracle derivation or normalized-plan analytical derivation and its required G0/G2 observation posture. |
| `SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH` | A paired-world, allow/deny, audience, scope, transition, mixed-commit, oracle-parity, or refusal row falsifies the admitted static class/broadcast/result certificate. |

Section 4's materialized `refused` label may draw only from the demand-time or
evaluation-time register, applying the applicable register's precedence.
Admission reasons live solely in non-materializing `GraphRefusalCaseV1`
admission arms. Qualification failures likewise cannot become a result label:
they fail the corpus/G0 exit or publication qualification and produce no
executable materialization.

### 2.4 Plan, instance, and contextual materialization identity

The normalized plan preimage is exactly the `GraphQueryPlanV1` record in
§2.1, with these canonicalization rules:

1. Unknown/omitted-default fields are impossible: the host materializes every
   required field and exact tagged-union spelling before hashing.
2. Nodes and ids are recomputed by §2.1's traversal. `FilterExpr`
   conjunctions sort by their individual RFC 8785 JCS bytes. `JoinEquality`
   and `OrderExpr` arrays preserve index/semantic order. Projection object
   field arrays preserve declared emitted-key order; arguments sort by RFC
   8785 UTF-16 code-unit name order, then every authored filter-argument name
   is replaced by its assigned `argumentId` before filter JCS sorting.
   Role/capability/table sets use the same string order and deduplicate. All
   other arrays retain the order their type states.
3. Every record is serialized with RFC 8785 JCS, exactly the shipped
   `domain_hash` path (`crates/snapback-types/src/manifest/types.rs:7058`).
   The hash is SHA-256 over ASCII `snapback:graph-plan:v1:` immediately
   followed by those JCS bytes, rendered `sha256:` plus 64 lowercase hex
   digits. **[author-ratify]** This dedicated domain is additive and avoids
   aliasing the shipped node/composite domains.
4. Included facts are the complete nodes and nested projection, normalized
   argument contracts and collection maxima, every `queryCost` declaration,
   every per-node `authority` record including each class-2
   `GraphPartitionEquivalenceProofV1`, the roll-up rule, the required tagged
   broadcast admission record, capability id, and `resultContractHash`. The
   latter reuses the shipped authenticated result-contract digest
   (`crates/snapback-types/src/manifest/types.rs:3727`).
5. Excluded facts are runtime argument values, cursor bytes, observed cost or
   corpus values, data/authorization/evaluation versions, target/deployment,
   exported function name/id/generation, source locations/comments, captured
   dependencies, and ledger counters. The contextual identity below closes
   the excluded serving axes without making them graph-plan facts.

`GraphPlanIdentityV1` is `{normalizedPlan, planHash}` on the shipped
`SingleNodeIdentityV1` and `SnapshotBatchIdentityV2` patterns
(`crates/snapback-types/src/manifest/types.rs:6929` and
`crates/snapback-types/src/manifest/types.rs:6917`). The snapshot-batch node
serialization precedent is the `serde_json::to_value` helper at
`crates/snapback-types/src/manifest/types.rs:9172`; RFC 8785 JCS and domain
hashing occur separately at `crates/snapback-types/src/manifest/types.rs:7058`.
The existing distinct node/composite domains are fixed at
`crates/snapback-types/src/manifest/types.rs:7193` and
`crates/snapback-types/src/manifest/types.rs:7227`. Codegen emits both graph
facts; the host reconstructs and exact-compares both before admission,
matching the existing snapshot-batch host checks at
`crates/snapback-types/src/manifest/types.rs:2893` and
`crates/snapback-types/src/manifest/types.rs:2910`.

Runtime arguments first pass `CanonicalClientValueV1`; object keys are JCS
ordered and its quantitative limits apply. `ArgsDigestV1` remains SHA-256 over
`snapback:materialization-args:v1:` plus the canonical argument JCS, as the
existing client bridge implements at
`packages/snapback-client/materialization-bridge.mjs:168`. Graph canonical
args contain every non-window argument exactly once and omit cursor,
direction, interval-end kind, page size, and range endpoints, which instead
enter §2.1's `windows` identity vector.

That vector is canonical and keyed by `nodeId` in §2.1 preorder node order.
It contains exactly one `GraphNodeWindowIdentityV1` for every node whose
interval, `take`, or direction is demand-supplied: the root always contributes
one entry, and each `bounded-to-many` with `page:{kind:"demand"}` contributes
one. A child with `page:{kind:"literal",...}` contributes nothing because all
four values are already in the plan hash. The root entry has exactly one
interval and `parentKey:null`. A demand-paged child entry has exactly one
interval per evaluated parent, sorted by the RFC 8785 JCS bytes of
`parentKey`; duplicate parents refuse. Its per-parent continuation key is the
tuple `(parentKey, KeysetKeyV1.entries declared-order values,
KeysetKeyV1.id)`. The `entries` vector and every
`GraphWindowIdentityV1.order` omit `_id`; `id` alone carries the implicit
ascending tie-break. Both decoded, schema-validated interval ends, including
the `_id` component in each bounded end, are recorded in `window`; opaque
cursor bytes never enter an identity.

The instance hash is SHA-256 over `snapback:graph-instance:v1:` plus the
`GraphInstancePreimageV1` JCS, rendered in the same digest spelling.
**[author-ratify]** A separate instance domain makes a plan hash impossible to
substitute as demand identity. Reordering the node vector, omitting one
demand-paged child, changing one parent key, boundary order value, `_id`,
direction, or `take`, or adding a literal-paged child all fail exact
reconstruction; the last case fails because the plan hash, not the vector,
rotates. Every `GraphWindowIdentityV1.order` is copied from its node's
normalized declared order without `_id`; the host exact-matches it at demand
time and refuses any difference with
`SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH`.

`QueryCostWindowLedgerV1` is not identity input. It rides beside the opaque
cursor and each ledger is authenticated against the exact key `(generation,
planHash, argsDigest, partition, target, nodeId, canonical per-parent interval
vector)`, where the final component is the complete canonical
`GraphParentWindowIdentityV1[]` for that node. There is one independent ledger
lineage per demand-paged node—one for the root and one for each demand-paged
child—and a child lineage cumulatively charges every per-parent interval in
that node's vector entry. Every published page charges structural work for the
whole subtree its lineage root induces: the root lineage's per-page
`scannedRows`, `indexRanges`, and per-node consultations include every
descendant consultation the root page triggers, while a demand-paged child
lineage includes only that child and its descendants. Induced-subtree
accounting applies only to those structural fields. Independently, every
lineage page—root or child—charges the published graph's top-level `resultRows`
and its one whole-result `resultBytes`, measured by the single
`serde_json::to_vec` serialization required by LLP 0267 §1.4/§5, to its own
ledger. A child-page publication therefore re-charges the whole result, a
deliberately conservative ceiling; there is no serialized child result or
child-sub-result carrier. The root lineage charges all six counters; a child
lineage keeps `rootRows` at zero. Each structural maximum remains
`maxWindowPages` times its per-page induced-subtree maximum, while each result
maximum is `maxWindowPages` times the per-page top-level whole-result value.
This extends LLP 0267 §5's singular one-window wording; no ledger counter can
rotate an otherwise equal window or instance identity.

The outer `GraphMaterializationIdentityV1` is host-recomputed over the inner
instance hash using LLP 0157 §D2's contextual-wrapper precedent: app,
database, deployment and target profile, activation/generation, and exported
function identity are all closed in `GraphMaterializationPreimageV1`. Its hash
is SHA-256 over `snapback:graph-materialization:v1:` plus that preimage's JCS.
**[author-ratify]** App/function app ids, the function's complete
`ExpectedGenerationV1`, and activation generation must exact-match their
owners before hashing. The broadcast group key and any cross-process sharing
consume this **outer** identity, never the inner instance hash alone.

Within one materialization context, equal graph instance hash,
authority-partition identity, authorization version, and evaluation cut imply
byte-identical result bytes, order, length, existence bits, completeness
label, and refusal reason. The plan hash closes shape, projection, policy
class, bounds, and result encoding; the args/vector hash closes every demand
value; and the partition, authorization-version, and evaluation-cut axes close
the remaining owner-derived inputs.
The inner hash alone is sufficient only inside one serving process at one
generation because that process has a single already-validated app/database/
target/activation/function context. The outer wrapper prevents two equal
inner hashes from crossing those contextual namespaces in a broadcast group
or another process.

### 2.5 Additive sibling carrier (Stage B plan, not shipped surface)

Stage B adds `HandlerPlan::GraphQuery(GraphQueryCarrierV1)`, serialized as
`{GraphQuery:{normalizedPlan,planHash}}`; capability id `graph_query_v1`; and
authoring constructor `defineGraphQuery`. The sibling insertion point is the shipped
`HandlerPlan` enum at `crates/snapback-types/src/manifest/types.rs:9724`, whose
three frozen family arms begin at
`crates/snapback-types/src/manifest/types.rs:9754`. There is no registry
collision: shipped ids are closed through `TargetCapabilityId`
(`crates/snapback-types/src/manifest/types.rs:11648`) and the current nearby
registrations are `bounded_children_v1`, `relational_query_v1`, and
`snapshot_batch_v2`
(`crates/snapback-types/src/manifest/capability_registry.rs:117`,
`crates/snapback-types/src/manifest/capability_registry.rs:133`, and
`crates/snapback-types/src/manifest/capability_registry.rs:136`). Stage B
reserves the new id through that same enum/`ALL`/string/maturity path; it
starts Experimental.

The TypeScript declaration and implementation live beside the existing
constructors at `packages/snapback-codegen/define.d.ts:1034`,
`packages/snapback-codegen/define.d.ts:1044`, and
`packages/snapback-codegen/define.d.ts:1049`; their implementations are at
`packages/snapback-codegen/define.mjs:3581`,
`packages/snapback-codegen/define.mjs:3284`, and
`packages/snapback-codegen/define.mjs:3393`. The Rust-derived mirror is
`schemas/functions.manifest.schema.json`, beside current `HandlerPlan` arms at
`schemas/functions.manifest.schema.json:2072` and
`schemas/functions.manifest.schema.json:2111`. These are placement
instructions, not a claim that the surface ships in v0.5.

`RelationalQueryPlan`, `BoundedChildrenQueryPlan`, and
`SnapshotBatchPlanV2`, their capability ids, schema arms, corpora, identity
domains, and table-granular matcher behavior are frozen. The current matcher
arms are explicit at `crates/snapback-kernel/src/live_matcher.rs:254`,
`crates/snapback-kernel/src/live_matcher.rs:270`, and
`crates/snapback-kernel/src/live_matcher.rs:289`. No migration occurs in G0.
A shipped two-source relational plan's root plus one relation is a degenerate
graph semantically, but byte-equivalence through the graph evaluator is a G2
conformance row, not a G0 carrier rewrite.

Because Stage B has no graph executor or graph dependency capture, it also
adds exactly one new fail-closed `live_matcher` arm for `GraphQuery`. That arm
returns `LiveMatchOutcome::ConservativeFallback` and marks the graph
not-executed until G2. It does not inspect the normalized plan or claim a
table-granular skip. This is the only Stage B matcher change; the three frozen
relational/bounded-children/snapshot-batch arms and their behavior remain
untouched.

### 2.6 Bounds and fixture derivation

`queryCost` is the sole carrier. `queryCost.graph` owns the graph structural
fields; LLP 0267's single whole-result check stays solely at
`queryCost.maxResultBytes`, with no `queryCost.graph.maxResultBytes` duplicate.
None of these fields is duplicated in `GraphQueryPlanV1` under another
`bounds` or `g0Bounds` key. Per-node and per-argument fields exist only in the
keyed entries below, never directly on `GraphNodeV1` or `GraphArgumentV1`.
Kind-inapplicable optional fields must be absent, and every kind-applicable
field must be present. The exact type is in §2.1.

`nodes` is in canonical §2.1 node order and omits only the projection;
`arguments` is in canonical argument order and contains collection arguments
only. Argument cardinality is zero for an absent optional, array length for an
array, and one for every other canonical value, including `null` and objects;
`maxArgumentItems` sums every top-level argument once. Every demand-paged node,
including the root, carries all six `maxWindow*` fields on its
`GraphNodeCostV1`; a literal-paged or non-pageable node carries none. The
graph-level `windowRollup` is present but purely derived and exact-checked:
each of pages, root rows, scanned rows, result rows, result bytes, and index
ranges is the checked sum of its corresponding node maximum across all
independent demand-page ledger lineages. It is not an independently chosen
ceiling. The structural fields sum each lineage's induced-subtree maximum;
`maxWindowResultRows` and `maxWindowResultBytes` sum lineage maxima that each
re-charge the published graph's top-level rows and one whole-result
serialization. The result rollups are therefore deliberately conservative,
including when different lineages' largest pages cannot occur simultaneously.

`GraphNodeCostV1` presence is kind-conditional and closed; TypeScript's
optional syntax does not weaken this table:

| Node kind | Required `GraphNodeCostV1` fields | Required only when stated | Forbidden fields / entry |
| --- | --- | --- | --- |
| `root-window` | `nodeId`, `maxRootRowsPerPage`, `maxExaminedEntriesPerExecution`, and all six `maxWindow*` fields | `maxArgumentExpansion` only when a normalized collection argument multiplies root consultations | `maxRelationshipLookupsPerExecution`, `maxChildrenPerParent`; otherwise-conditional `maxArgumentExpansion` |
| `equality-to-one` | `nodeId`, `maxExaminedEntriesPerExecution`, `maxRelationshipLookupsPerExecution` | `maxArgumentExpansion` only for normalized multiplicative collection arguments | `maxRootRowsPerPage`, `maxChildrenPerParent`, all six `maxWindow*`; otherwise-conditional `maxArgumentExpansion` |
| `bounded-to-many` | `nodeId`, `maxExaminedEntriesPerExecution`, `maxRelationshipLookupsPerExecution`, `maxChildrenPerParent` | all six `maxWindow*` exactly when `page.kind == "demand"`; `maxArgumentExpansion` only for normalized multiplicative collection arguments | `maxRootRowsPerPage`; all six `maxWindow*` for literal pages; otherwise-conditional `maxArgumentExpansion` |
| `exists-semi-join` | `nodeId`, `maxExaminedEntriesPerExecution`, `maxRelationshipLookupsPerExecution`, `maxChildrenPerParent` | `maxArgumentExpansion` for `mode:"all"` and for any other normalized multiplicative collection input | `maxRootRowsPerPage`, all six `maxWindow*`; otherwise-conditional `maxArgumentExpansion` |
| `principal-bound` | `nodeId`, `maxExaminedEntriesPerExecution`, `maxRelationshipLookupsPerExecution` | `maxArgumentExpansion` only for normalized multiplicative collection arguments | `maxRootRowsPerPage`, `maxChildrenPerParent`, all six `maxWindow*`; otherwise-conditional `maxArgumentExpansion` |
| `search-membership` | `nodeId`, `maxExaminedEntriesPerExecution`, `maxRelationshipLookupsPerExecution` | `maxArgumentExpansion` exactly when a declared collection `argumentId` multiplies provider consultations | `maxRootRowsPerPage`, `maxChildrenPerParent`, all six `maxWindow*`; otherwise-conditional `maxArgumentExpansion` |
| `closed-projection` | none | none | no `GraphNodeCostV1` entry exists; every field is forbidden |

**G0 declaration/observation ruling [author-ratify].** Ruled 2026-08-23 under
`issues/20260823-llp0209-g0-commission.md`; author ratification recorded at the
v0.6 exit; LLP 0267 §5 amendment requested (drift list). G0 declares every
applicable field. Because Stage B has no graph executor, it does not claim to
observe physical per-node work. Logical bounds are derived from fixture facts
and opaque-oracle results, which Stage B can observe without executing a graph:
`maxRootRowsPerPage`, `maxChildrenPerParent`, `maxItems`,
`maxArgumentItems`, `maxArgumentExpansion`, `queryCost.maxResultBytes`,
`maxPageResultBytes`, `maxWindowPages`, `maxWindowRootRows`,
`maxWindowResultRows`, `maxWindowResultBytes`, and
`maxMaintainedWritesPerMutation` (exactly zero at G0). Physical bounds are
declared analytically from normalized plan shape:
`maxExaminedEntriesPerExecution`,
`maxRelationshipLookupsPerExecution`, `maxWindowScannedRows`,
`maxWindowIndexRanges`, and whole-query `queryCost.maxScannedRows` plus
`queryCost.maxIndexRanges`; every one
is marked **[G2 measures]**. LLP 0267's observed-value consumption for graph
plans begins at G2, when an executor exists.

The physical declaration is one closed analytical consultation-count
function. Because every input is normalized plan shape or a declared maximum,
the physical fields are unique plan-hash inputs; an author cannot choose a
looser number. Analytical declarations take the worst-case consultation arm,
while G2 observations charge zero consultations when the actual key is null or
omitted. Derivation always runs in these four steps and no field has a second
counting rule.

1. **Parent population `P(node)`.** Let a present node
   `maxArgumentExpansion` contribute its declared checked factor and an absent
   one contribute 1. Start with
   `P(root) = maxArgumentExpansion(root)` when present, otherwise `1`; root is
   not hard-coded to one. For a non-root node, checked-multiply the root's
   `maxRootRowsPerPage`, every distinct multiplicative-argument factor on its
   root path exactly once, every to-many or semi-join ancestor's
   `maxChildrenPerParent` (`C`), and `1` for every to-one or principal-bound
   ancestor. The current `all` node's own argument is excluded from `P(node)`
   because step 2 charges its `maxItems` probes; any other node-local
   multiplicative argument remains in `P(node)`. Reuse never multiplies an
   argument twice.
2. **Consultations per parent row.** A root window makes one range
   consultation. Every equality-to-one parent is one attempted relationship
   lookup; a concrete complete key makes one unique point consultation, while
   a null/omitted key makes no storage consultation and fabricates no point or
   range. A bounded-to-many makes one range consultation. A direct semi-join
   makes one probe for `exists` and `Q = maxItems` probes for `all`; each probe
   is a `boundedIndex` range with `LIMIT 1`, unless the complete child index
   proves uniqueness, in which case it is one point. A through semi-join is
   unchanged: one edge-range consultation plus `C` target-point consultations
   per probe. A principal-bound node makes one point consultation for the
   principal-keyed target row, plus one binding point only when its optional
   `binding` is present; captured concrete-key misses still count. When
   `binding` is absent, the complete proof's only legal encoding is the literal
   `bindingFound:true` (vacuous), and no binding consultation is charged.
   Anonymous nullable absence for which §4 proves that no lookup is attempted
   makes no storage consultation. Search makes one opaque provider
   consultation. Projection makes none.
3. **Entries per consultation.** Every point, unique, or opaque consultation
   has an entry maximum of 1. A non-unique direct semi-join's bounded-index
   range also has an entry maximum of 1 because its exact access is `LIMIT 1`;
   it does not fetch a successor. Every other bounded range has `cap + 1`:
   root uses `maxRootRowsPerPage + 1`; bounded child and through-edge ranges use
   `maxChildrenPerParent + 1`. The `+1` is the mandatory successor lookahead
   used to derive `hasMore`; the existing bounded-child executor fetches
   `take + 1` at `crates/snapback-engine/src/local/engine.rs:37942`–`:37962`.
   The plan-hashed cap remains the emitted-row cap, while the lookahead is
   examined but not emitted. The exact demand `take` is validated separately
   and may only tighten a request-local budget.
4. **Derived fields.** For every node, checked-sum
   `consultations × entries-per-consultation × P(node)` into
   `maxExaminedEntriesPerExecution`; checked-sum attempted edge resolutions on
   every non-root relationship node into that node's
   `maxRelationshipLookupsPerExecution`, including null/omitted-key to-one
   attempts that made zero consultations; and checked-sum **every actual**
   consultation—`point`, `unique`, `boundedIndex`, `fullScan`, or opaque—into
   `queryCost.maxIndexRanges`. Thus one consultation is one index range, exactly
   as LLP 0267 §1.1 requires with
   `indexRangeCount == accessPathConsultations.length`; relationship lookups
   also contribute per LLP 0267 §5. The host checked-sums node examined maxima
   into `queryCost.maxScannedRows`. For each demand-paged lineage, a page's
   structural maximum is the checked sum for the entire induced subtree: the
   lineage node and every descendant consultation that publishing that page
   triggers. The root lineage therefore includes all descendant structural
   work; a child lineage includes only its own subtree. `maxWindowRootRows`
   remains zero for a child lineage. By contrast, every lineage page charges
   the published graph's top-level `resultRows` and the single whole-result
   `resultBytes` to its own ledger, including for a child-page publication.
   Every cumulative window field is the checked product of `maxWindowPages`
   and its applicable per-page maximum. Thus, for example,
   `maxWindowScannedRows = maxWindowPages × per-page induced-subtree examined
   maximum` and `maxWindowIndexRanges = maxWindowPages × per-page
   induced-subtree consultation maximum`; the result-row and byte products use
   the per-page top-level whole-result values instead. `windowRollup` then
   checked-sums corresponding lineage maxima, conservatively re-charging that
   whole result once per lineage page.

For clarity, if a `ThroughEdgeV1` node has parent population `P`, probe count
`Q` (`1` for `exists`, the declared `maxItems` for `all`), and edge cap `C`,
its three formulas are exactly:

- examined: `P × Q × ((C + 1) + C)`;
- relationship lookups: `P × Q × (1 + C)`; and
- index ranges: `P × Q × (1 + C)`.

The first examined term is the one edge range including successor lookahead;
the second is the `C` target points. There is no additional multiplication of
the target term by `C` after those `C` consultations have already been
enumerated.

Any checked overflow refuses `SNAPBACK_GRAPH_BOUND_INVALID`. Any
`accessIndex` whose equality/range prefix cannot enforce the applicable
entries-per-consultation cap refuses
`SNAPBACK_GRAPH_INDEX_PREFIX_UNSUPPORTED`; it never receives a guessed scan
bound. G2 observations must fit these declarations before publication.

Worked `issueDetail` candidate calculation follows only those four steps. Its
point-shaped issue root has `P = 1` and `maxRootRowsPerPage = 1`, hence one
range examining `2` entries. Project, creator, and optional-assignee to-ones
each have `P = 1`, one consultation, and one examined entry. The label edge
has `P = 1`, `C = 16`, one range, and `17` examined entries; the label to-one
below it has `P = 16`, hence `16` point consultations and `16` entries. Let
`C_comments` be the Stage-B-derived, plan-hashed comments cap: its one range
examines `C_comments + 1`, not the corpus request's `take = 50`. Each of the
view-state and notification principal nodes declares `binding`, so each has
`P = 1`, two point consultations, and two entries.

For this slice,
`queryCost.maxScannedRows = 2 + 1 + 1 + 1 + 17 + 16 +
(C_comments + 1) + 2 + 2 = 43 + C_comments`.
`maxRelationshipLookupsPerExecution` is the per-node vector
`[project:1, creator:1, optionalAssignee:1, labelEdge:1, labelTarget:16,
comments:1, viewState:2, notification:2]`, whose checked whole-graph sum is
25. `queryCost.maxIndexRanges = 26`: the root consultation plus every one of
those 25 relationship consultations.

Request validation is separate: `take = 50` must satisfy
`50 <= C_comments`; only then may the runtime tighten this request's comments
range to `51` examined entries including lookahead, yielding a request-local
scanned ceiling of `93` without changing any plan field or hash. For a
one-page illustration, the present-issue top-level `resultRows` is `1`; let
`B_root` and `B_comments` be the single whole-result `resultBytes` of the root-
and comments-page publications, respectively. The root lineage charges
`(43 + C_comments scanned, 26 ranges, 1 result row, B_root result bytes)`,
including all 25 descendant consultations. The comments lineage charges
`(C_comments + 1 scanned, 1 range, 1 result row, B_comments result bytes)` in
the plan, versus
`(51 scanned, 1 range, 1 result row, B_comments result bytes)` for that
validated request. Across those two one-page lineage maxima, `windowRollup`
therefore carries `2` pages, `1` root row,
`44 + 2 × C_comments` scanned rows, `2` result rows,
`B_root + B_comments` result bytes, and `27` ranges. Both byte terms are full
top-level result serializations; the conservative child-page charge is not
evidence of a serialized comments sub-result. Additional
issue-emoji/comment-emoji nodes do not inherit `16`; Stage B must fill their
fixture maxima or admission refuses, which keeps the example from fabricating
an uncommissioned plan maximum.

This exact counter exposes an owner conflict rather than redefining the
counter: the `issueListV2` corpus shape can admit 1,024 roots, so even one
to-one per root requires at least `1 + 1,024 = 1,025` consultations. That
exceeds LLP 0267's instance absolute `maxIndexRanges = 512` at
`llp/0267-query-cost-guardrails.rfc.md:335`. Stage B keeps the
`issueListV2` corpus row as the evidence and the drift list requests an LLP
0267-owner amendment; point consultations remain counted.

For logical rows, fixture maximum means the maximum fact or oracle result—not
the mean—over `normal-seed-v1` and `large-seed42-v1`;
`hot-recent-v1` additionally sizes the 1,000-root operational window. Stage B
records that raw maximum and proposes a headroom factor `H`, then derives an
integer bound as `ceil(fixture maximum × H)`. **[author-ratify]** The factor
and resulting values are ratified together at G0 exit; v0.5 assigns no numeric
factor that the packet did not supply. `H` is recorded per field with a
one-sentence fixture-skew, repeated-observation, or discrete-contract
justification. A missing derivation is
`SNAPBACK_GRAPH_QUALIFICATION_DERIVATION_MISSING`; an analytically invalid or
internally conflicting value is the admission refusal
`SNAPBACK_GRAPH_BOUND_INVALID`.

| Exact field | What it bounds | Declaring node/kind | G0 declaration derivation | Packet first-cut candidate | G0 evidence / later observation |
| --- | --- | --- | --- | ---: | --- |
| `maxRootRowsPerPage` | Authorized root rows consumed before relationship projection | sole `root-window` | The hot fixture requests and observes exactly 1,000 roots; retain the existing portable 1,024 page boundary, giving 24 rows of explicit spare without changing the gate's shape | 1,024 **[author-ratify]** | **[Stage B fills]** |
| `maxExaminedEntriesPerExecution` | Physical candidates consulted for one read node | every table/search/relationship node | Host analytical maximum from index shape × maximum consultations derived recursively from root take/fanout/argument expansion; logical result rows may not substitute | — | **[Stage B declares analytically; G2 measures]** |
| `queryCost.maxScannedRows` | Whole-query checked sum of all graph-node examined entries | LLP 0267 whole-query carrier | Checked sum of every node's analytical `maxExaminedEntriesPerExecution`; no `GraphQueryCostV1.maxScannedRows` twin | — | **[Stage B declares analytically; G2 measures]** |
| `queryCost.maxIndexRanges` | Whole-query checked sum of all access-path consultations | LLP 0267 whole-query carrier | Apply the same consultation product as `maxScannedRows`; every point, unique, bounded-index, full-scan, and opaque consultation contributes one, then checked-sum in canonical node/subconsultation order | — | **[Stage B declares analytically; G2 measures]** |
| `maxRelationshipLookupsPerExecution` | Attempted edge resolutions, including null/omitted keys | every relationship, semi-join, principal, and search node | Host analytical maximum from attempted parent population × distinct argument expansion; one lookup per attempted edge | — | **[Stage B declares analytically; G2 measures]** |
| `maxChildrenPerParent` | Maximum authorized to-many or semi-join edge rows consumed for one parent | `bounded-to-many`, `exists-semi-join` | Measure the per-parent maximum, not mean, on both fixtures; max × H. Label edges are the first slice; comments remain a pageable child window | 16 for label edges **[author-ratify]** | **[Stage B fills]** |
| `maxItems` | Cardinality of one collection argument | each collection `GraphArgumentV1` | For each argument id (selected labels/assignees/projects and any later collection), max canonical array length in corpus cases × H, capped by its contract | — | **[Stage B fills]** |
| `maxArgumentItems` | Sum of all top-level argument cardinalities | graph | Per corpus invocation, apply the exact scalar/optional/array rule above and sum each argument once; maximum across fixtures × H | — | **[Stage B fills]** |
| `maxArgumentExpansion` | Product of distinct multiplicative collection arguments for one node | each expanding node | Host derives multiplicative argument ids from edges, observes their checked product (empty product one), and uses maximum across fixtures × H; reuse does not multiply twice | — | **[Stage B fills]** |
| `queryCost.maxResultBytes` | One validated authored whole-result serialization | LLP 0267 whole-query carrier | Maximum exact `serde_json::to_vec` result bytes on normal/large full-window rows × H; do not use six-observer aggregate frame bytes; LLP 0267 §5 performs this one whole-result check | — (packet's ~10–11 MiB is scale evidence, not an exact value) | **[Stage B fills]** |
| `maxPageResultBytes` | One keyset page's validated result bytes | every pageable graph | Maximum exact page bytes on normal/large/hot, including the 1,000-root hot page, × H | — | **[Stage B fills]** |
| node `maxWindowPages` | Published pages in one demand-paged-node ledger lineage | each demand-paged node | Count pages needed for the oracle to exhaust each named interval at declared page size; maximum × H, minimum one | — | **[Stage B fills]** |
| node `maxWindowRootRows` | Cumulative authorized root rows across one lineage | each demand-paged node; zero for child lineages | Node `maxWindowPages` × per-page root maximum (`maxRootRowsPerPage` for root; zero for child) | — | **[Stage B fills]** |
| node `maxWindowScannedRows` | Cumulative physical candidates across one demand-paged-node induced subtree | each demand-paged node | Checked analytical sum of the per-page examined maxima for the lineage node and every descendant that page triggers × node `maxWindowPages` | — | **[Stage B declares analytically; G2 measures]** |
| node `maxWindowResultRows` | Cumulative published-graph top-level result rows re-charged by one demand-paged-node lineage | each demand-paged node | Node `maxWindowPages` × the fixture/oracle-derived per-page top-level `resultRows`; a child lineage uses the same whole published-graph unit, not subtree rows | — | **[Stage B fills]** |
| node `maxWindowResultBytes` | Cumulative published-graph whole-result bytes re-charged by one demand-paged-node lineage | each demand-paged node | Node `maxWindowPages` × the fixture/oracle-derived per-page single `serde_json::to_vec` whole-result bytes; no child serialization exists | — | **[Stage B fills]** |
| node `maxWindowIndexRanges` | Cumulative access-path consultations across one demand-paged-node induced subtree | each demand-paged node | Checked analytical sum of every per-page consultation by the lineage node and every descendant that page triggers × node `maxWindowPages` | — | **[Stage B declares analytically; G2 measures]** |
| `windowRollup.*` | Derived graph-wide totals for the six lineage fields | graph | Checked sum of each corresponding per-node maximum across demand-paged lineages; structural fields retain induced-subtree units, while result rows/bytes conservatively sum repeated top-level whole-result charges; exact equality required | derived | **[Stage B exact-checks]** |
| `maxMaintainedWritesPerMutation` | Graph-owned maintained fact/index writes attempted for one source mutation | graph | G0 has no maintained graph facts, so the exact observed and declared value is zero; G3 must amend it from mutation observations before maintenance | 0 | **[Stage B fills: 0]** |

The general `queryCost` fields `maxIndexRanges` and `maxResultRows` remain
applicable conjunctive aggregate ceilings, but they are not aliases for the
per-lineage summed-window fields or their derived `windowRollup` and are not a
ninth graph-bound family. Stage B derives
`maxResultRows` from oracle results and `maxIndexRanges` analytically from plan
shape; G2 first observes the latter.

The G0-exit observation carrier for broadcast sizing is separate from the
hard declaration and exact:

```ts
type GraphG0ExitObservationV1 = Readonly<{
  format: "snapback.graph-g0-exit-observation.v1"
  fixture: "normal-seed-v1" | "large-seed42-v1" | "hot-recent-v1"
  graphPlanHash: Sha256V1
  groupCount: number
  subscriberFanout: number
  groups: readonly Readonly<{
    groupOrdinal: number
    resultBytes: number
    dependencyBytes: number
    groupStateBytes: number
  }>[]
}>
```

Stage B records one row for every corpus graph × fixture cell and orders
`groups` by dense `groupOrdinal`; the v0.6 G0-exit note records those rows and
their evidence pointer. This record is an observation, not a hard bound
carrier. LLP 0268 B1 must declare the hard group-state, frame, and
handoff bounds, and because LLP 0267 owns the sole `queryCost` carrier, that
declaration requires the LLP 0267-owner amendment recorded below.

The current 1,024 summed-batch ceiling is affirmatively **not** a candidate:
the large fixture has 2,000,370 label edges / 1,000,000 issues = **2.00**
labels per issue and 2,527,886 comments / 1,000,000 issues = **2.53** comments
per issue. The means are context only; every declaration uses fixture
**maxima**. Even the mean label density makes a 1,000-root list about 2,000
child rows before other graph work, strengthening the falsification. Thus
`SNAPSHOT_BATCH_SUMMED_TAKE_CEILING = 1_024`
(`packages/snapback-contract/limits.mjs:11`) is falsified for this profile;
Stage B measures and proposes the graph's per-lineage window fields and
derived checked rollup rather than copying it. The root candidate happens to equal the separate shipped
`RELATIONAL_TAKE_CEILING` at `packages/snapback-contract/limits.mjs:10`, but
its derivation is the pinned 1,000-root hot shape in the table, not inheritance.

## 3. Authorization at every node

LLP 0170 continues to govern; this section binds it to the IR.

- A visible parent does not make a child visible. Hidden rows may not
  affect an observable result, order, length, existence bit,
  completeness claim, search membership, or caller-visible hydration
  behavior unless policy explicitly admits that channel. Opaque handler
  assertions do not constitute mechanically proved protection.
- **Every node declares its authority-dependency class**, checked by the
  compiler, not asserted by the author:
  1. **authority-independent** — the node's rows and membership are
     invariant across principals and partitions (public data);
  2. **partition-scoped** — varies with the authority partition (role,
     project membership) but not the individual principal within it;
  3. **principal-scoped** — binds the server-derived principal
     (`viewState` and friends).
- **Classification is proved, not trusted.** The §9 conformance corpus
  includes paired-world rows — the same admitted graph evaluated against
  fixture pairs differing only in rows the policy hides — asserting the
  observable result, order, length, existence bits, completeness labels,
  and refusal reasons are identical across the pair (the LLP 0170
  discipline made mechanical). A node whose admitted class the paired
  worlds falsify fails G0 qualification with
  `SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH`; corpus evidence is not
  available to manifest admission.
- The per-node classification rolls up to the graph's **authority
  partition identity**: an owner-computed function of the policy inputs
  the partition-scoped nodes declare. LLP 0053/0008 authorization events,
  including declared `permissionBacking` writes, advance the adjacent
  authorization version; session/lease/grant/credential/token authority
  transitions instead rotate/end the partition or retained instance. Two
  subscriptions share a partition iff this identity matches at the same
  authorization version.

### 3.1 Class enum and compiler proofs

The normalized `GraphAuthorityClassV1` enum is the closed numerical
`1 | 2 | 3` grammar in §2.1: authority-independent, partition-scoped, and
principal-scoped respectively.

An author may request a class; the installed value is the compiler's derived
class. A requested class lower than the derived class refuses with
`SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE`; a higher class is accepted only when
the compiler can still enumerate its complete inputs. The paired-world corpus
is a falsifier and qualification gate, never a substitute for a missing static
proof.

For class 2, each node carries §2.1's closed
`GraphPartitionEquivalenceProofV1` at `GraphNodeV1.authority.proof`. The
compiler reconstructs the ordered `policyInputs` from the installed
permission-backing, membership, and role declarations, exact-checks
`nodeId`/`declaredClass`, and recomputes `partitionFunction` over only those
declared identities. `equivalenceWitness:"declared-inputs-only"` is valid
only when every policy leaf is derived from those inputs and no
principal/session/grant/delegation value reaches result data. A missing,
extra, reordered, stale-identity, or hash-mismatched input refuses admission
with `SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE`. Class-1 and class-3 nodes carry
`proof:null`; any non-null class-1/class-3 proof also refuses. A raw
owner/membership visibility declaration is principal-relative and therefore
derives class 3 unless this stronger equivalence proof discharges it. This
conservative rule chooses a smaller sharing class because schema membership
alone proves access, not equal bytes for every principal in a partition.

| Node kind | Static compiler proof | What the corpus can falsify |
| --- | --- | --- |
| `root-window` | Walk every filter, order, visibility, table policy, argument binding, and index predicate. Class 1 requires `public-read`, no authority value, and no permission-backed result input. Class 2 requires §3.1's partition-equivalence proof for every authority-varying leaf. Owner/membership visibility without that proof, any `auth.userId`, principal binding, provider/session/grant/delegation field, or unenumerated policy input derives class 3 or refuses. | Hidden roots occupying order/limit slots; role partitions changing membership/order/length; absent versus invisible roots; argument scope not binding returned rows. |
| `equality-to-one` / `bounded-to-many` | Prove parent class, both endpoint visibility declarations, join equality and nominal domains, and the child policy independently. The node class is at least the maximum of parent, child, and edge-policy inputs; class 2 requires the partition-equivalence proof for every authority-varying endpoint. Parent visibility never discharges child visibility. | Hidden child existence, fanout, ordering, continuation, or null/required behavior; a child policy input omitted from the declared partition. |
| `exists-semi-join` | Prove every direct/through table's visibility and permission inputs, the parent/resource equality, the `all` argument contract, and absence capture. Class 1 requires authority-independent edges; class 2 requires the partition-equivalence proof for every varying edge and proof that hidden rows cannot alter the bit. Otherwise derive class 3 or refuse. An argument-only membership check without returned-resource equality is unprovable per LLP 0170 Finding 1. | A hidden edge changing `exists`/`all`; empty-to-present and present-to-empty; duplicate argument/edge handling; undeclared through-table influence. |
| `principal-bound` | `principalSource` must be host `auth.userId`; any binding must be a declared unique point relation and every target lookup must include the bound value. The derived class is exactly 3. | Cross-principal row substitution, missing binding versus hidden binding, and a caller-supplied app-user id affecting bytes. |
| `search-membership` | Exact-compare the D6/provider certificate: provider capability and membership identity, scope/argument bindings, authority class, version, completeness class, and complete invalidation-table set. The graph may not lower search itself or reduce the certificate's class. | Hidden search-document membership, public/internal partition leakage, stale epoch/version, or an omitted invalidation table. |
| `closed-projection` | Walk every referenced leaf and predicate-affecting node. The class is their numerical maximum; literals add no class. The exact closed result contract must accept that projection and no unenumerated authority input may affect serialization. | Projection-versus-storage-column leakage, hidden nullable/existence differences, or an author-declared lower roll-up. |

Schema/policy declarations prove structure and complete input provenance; the
corpus proves the implementation honors that structure on adversarial data.
An opaque `reads` list, `authScopeField`, one runtime trace, or authored
“public” assertion proves neither, as LLP 0170 records.

### 3.2 Authority-partition identity and versioning

The normalized plan carries §2.1's exact
`GraphAuthorityPartitionRuleV1`/`GraphAuthorityEventSelectorV1` grammar, not
resolved authority values.

The first four arms are LLP 0053's closed authorization-event universe; only
they advance or replace `authorizationVersion`. The last arm rotates or ends
the authority partition/retained instance. Within each arm, string sets use
RFC 8785 UTF-16 code-unit order; `permissionFields:null` means inserts, deletes, and
unknown-field updates all match. A `bindings` selector computes the affected
scope from the changed row; `all-declaration-scopes` is the explicit
conservative broadcast rather than an omitted mapping.

`class2Inputs` sorts by `(nodeId,declarationId)` in RFC 8785 string order;
`scopeArgumentIds` uses that order and `eventSelectors` sorts by individual
JCS bytes. At evaluation,
the owner resolves those inputs and hashes the following JCS record with
`snapback:graph-authority-partition:v1:`:

```ts
{
  format: "snapback.graph-authority-partition.v1",
  graphPlanHash,
  class2: [{ nodeId, declarationId, scopeIdentity, policyIdentity }],
  class3: null | AuthorityPartitionV1
}
```

`AuthorityPartitionV1` is LLP 0157 §D2's complete owner-issued data and
invocation partition (principal data scope, authority instance, fingerprint,
tenant/provider, and delegation), not a caller-provided user id. In G0, any
class-3 node sets `class3` to that exact record: this is OQ-3's conservative
**partition of one**. No sharing across two authority instances is implied,
even if their effective user ids compare equal. A class-1-only graph has empty
`class2` and `class3:null`; a class-2 graph includes only its resolved inputs.
**[author-ratify]** The new hash domain is dedicated so a plan or instance
digest cannot be substituted as authority identity.

`authorizationVersion` is deliberately not inside the partition digest: the
two form adjacent, mandatory identity axes, so a permission event can rotate
the version without falsely claiming the population partition itself changed.

Versioning has two independent causes and neither may be omitted:

1. `authorizationVersion {incarnation,epoch}` follows LLP 0053/0008: known
   relevant writes to declared `permissionBacking` tables, authorization
   metadata activation, reset/import/declared restore, and explicit
   out-of-band permission revocation advance or replace it. Every class-2
   declaration maps each such cause to affected `scopeIdentity` values; an
   unknown mapping successfully classifies the valid graph query-shaped with
   `invalidation-incomplete`; only a contradictory authored broadcast
   certificate refuses under §2.3 row 27.
2. Login/logout, user switch, session expiry/admin revocation, lease expiry,
   and grant/credential/token issue or end are authority-instance transitions.
   They rotate/end the owner-issued partition or retire the affected retained
   graph instance; LLP 0200 §2.4 applies the fail-closed fence and delivery
   gate before restoration. They are not relabelled as ordinary data writes.

Two subscriptions share an authority partition only when the partition digest
and current authorization version are byte-equal. `evaluationCut` remains the
separate third memo/completeness axis; §6 pairs those three axes with the outer
materialization identity.

### 3.3 The nine LLP 0268 inputs and their carriers

`GraphBroadcastAdmissionV1` is a closed plan member. It is either
`{format, classification:"query-shaped", reason:GraphQueryShapedReasonV1}` or a broadcast certificate
with `classification:"broadcast"`, `baseNodeIds`, and
`establishment`; its exact grammar is in §2.1. A valid non-eligible graph is
successfully admitted as `query-shaped`: class-2/3 base, failed separation,
unbound scope, failed audience parity, and incomplete invalidation map to
`base-not-class-1`, `separation-unprovable`, `scope-unbound`,
`audience-parity-failed`, and `invalidation-incomplete` respectively. An
author who elects the ordinary lane without presenting a broadcast
certificate gets `declared-query-shaped`. These are classifications, not
refusal reasons, and the ordinary query-shaped materialization remains
executable. When more than one query-shaped condition applies, the fixed
precedence is exactly `GraphQueryShapedReasonV1` declaration order and the
first match wins; the selected reason therefore enters the plan hash
deterministically.

For a broadcast certificate, `baseNodeIds` is
host-recomputed, not author-supplied: it is the canonical node-order set of
**every** non-projection node that can affect bytes, membership, order, length,
existence bits, completeness label, refusal reason, or future delta
construction—exactly every §4.2 input. Every member must derive class 1. An
authored broadcast certificate over an otherwise valid class-2 or class-3
base is counterfeit and refuses
`SNAPBACK_GRAPH_BROADCAST_BASE_CLASS_INVALID`; it is not downgraded to the
successful query-shaped `base-not-class-1` classification. An authored
`baseNodeIds` value that differs in membership or order refuses
`SNAPBACK_GRAPH_PLAN_IDENTITY_MISMATCH`. An unreachable node refuses
`SNAPBACK_GRAPH_PARENT_INVALID`; a reachable but inert node refuses
`SNAPBACK_GRAPH_NODE_INERT`. Therefore the host set is exact rather than a
conservative author-selected superset.

The compiler proves `predicate` reaches only establishment allow/deny and has
no data-flow path to projection, membership, order, length, existence,
completeness, refusal, or delta construction. `overlayProjection` has only the
literal `null` inhabitant. Scope identity is owner-computed from graph materialization
identity, the listed canonical argument values, and `policyIdentity`; every
delivered resource is tied to those arguments by the executable equalities.
Specifically, it is the lowercase `sha256:` digest of RFC 8785 JCS for
`{format:"snapback.graph-broadcast-scope.v1", graphMaterializationHash,
policyIdentity, arguments:[{argumentId,value}]}` under the ASCII domain
`snapback:graph-broadcast-scope:v1:`; `arguments` follows canonical graph
argument order and each `value` is the already-validated
`CanonicalClientValueV1`. **[author-ratify]** The dedicated scope domain keeps
an establishment scope from substituting for plan, instance, or partition
identity. `strictEvaluatorIdentity` is the host-recomputed content identity of
the closed fail-closed audience predicate, including its policy and schema
declaration identities. The strict evaluator establishes exact audience parity
at the same instance and authorization version. If the host is classifying an
otherwise valid graph, failure produces the corresponding successful
`query-shaped` reason above. If the manifest instead authors
`classification:"broadcast"`, any contradiction between that authored
certificate and the host recomputation is counterfeit and refuses admission
under §2.3 rows 23–27; the host must not downgrade it to query-shaped.

| LLP 0268 label | This Spec's carrier | Required §3.4 case kind(s) | G0 exit record must show |
| --- | --- | --- | --- |
| `G0-BCAST-CLASS` | §3.1 node certificates plus host-recomputed `GraphBroadcastAdmissionV1.baseNodeIds` | `pairedWorld`, `refusal` | Every complete delivered/delta-relevant §4.2 input in a broadcast certificate derives class 1; no omitted, unreachable, or inert node. A valid class-2/3 base without a broadcast certificate is admitted query-shaped with `base-not-class-1`; an authored broadcast certificate claiming otherwise is counterfeit and refuses `SNAPBACK_GRAPH_BROADCAST_BASE_CLASS_INVALID` under row 23. |
| `G0-BCAST-SEPARATION` | `establishment.effect`, literal-null `overlayProjection`, compiler data-flow proof | `allowDeny`, `refusal` | Establishment decides join/deny only. Valid non-separation is query-shaped with `separation-unprovable`; an authored broadcast certificate contradicted by overlay/result reach refuses `SNAPBACK_GRAPH_BROADCAST_SEPARATION_UNPROVABLE`. |
| `G0-BCAST-SCOPE` | `establishment.scope` and its outer-materialization-bound owner scope identity | `allowDeny`, `scopeMismatch` | Canonical argument ordering, policy identity, normalization/hash vector, and P/Q-distinct scope vector. |
| `G0-BCAST-SCOPE-BINDING` | `resourceEqualities` from each delivered resource to same-materialization scope arguments | `scopeMismatch`, `refusal` | Executable equality passes. Valid P/Q scope mismatch is successfully query-shaped with `scope-unbound`; an authored broadcast certificate claiming the binding refuses `SNAPBACK_GRAPH_BROADCAST_SCOPE_UNBOUND`. An argument-only membership check never qualifies. |
| `G0-BCAST-AUDIENCE` | `strictEvaluatorIdentity` plus exact-audience cases | `allowDeny`, `audienceParity` | For both pinned principals at one instance and authorization version, establishment deny-set equals fresh strict evaluation. Valid parity failure is query-shaped with `audience-parity-failed`; a counterfeit authored broadcast certificate refuses under row 26. |
| `G0-BCAST-INVALIDATION` | `establishment.invalidation` plus §3.2 event selectors | `authorityTransition`, `mixedCommit` | Every predicate/policy input maps permission writes and authority transitions to affected scopes; both case kinds prove fence-before-delivery. Valid incompleteness is query-shaped with `invalidation-incomplete`; a counterfeit authored broadcast certificate refuses under row 27. |
| `G0-BCAST-IDENTITY` | §2.4 outer materialization plus args/window-vector/partition/authorization-version/evaluation-cut identities | `pairedWorld`, `audienceParity`, `scopeMismatch`, `authorityTransition` | Rust/JS/host vectors reproduce hashes and equal complete identity tuples produce byte-identical results/labels/refusals within one context; a contextual-axis change rotates the outer identity. |
| `G0-BCAST-CORPUS` | §3.4 closed case union and `tests/conformance/graph/corpus.v1.json` (Stage B) | `pairedWorld`, `allowDeny`, `audienceParity`, `scopeMismatch`, `authorityTransition`, `mixedCommit`, `refusal` | Projection-versus-storage-column, hidden-world, allow/deny, P/Q mismatch, exact audience, transition, mixed-commit, and refusal rows all pass. |
| `G0-BCAST-BOUNDS` | §2.6 declarations plus `GraphG0ExitObservationV1` | `pairedWorld`, `allowDeny`, `audienceParity`, `scopeMismatch`, `authorityTransition`, `mixedCommit` | For every corpus graph on normal/large/hot, record measured group count, subscriber fan-out, per-group result bytes, dependency bytes, and group-state bytes. These are G0-exit observations, not hard retained-state bounds; LLP 0268 B1 declares hard group-state/frame/handoff fields through LLP 0267's sole `queryCost` carrier amendment. |

### 3.4 Closed corpus case kinds

`GraphCorpusCaseV1` is the following closed union. Result bytes are canonical
authored serialization, not semantic object comparison; fixture/principal/
commit references are corpus-local stable ids, not production wire values.

```ts
type GraphCorpusCaseV1 =
  | GraphPairedWorldCaseV1
  | GraphAllowDenyCaseV1
  | GraphAudienceParityCaseV1
  | GraphScopeMismatchCaseV1
  | GraphAuthorityTransitionCaseV1
  | GraphMixedCommitCaseV1
  | GraphRefusalCaseV1

type GraphCorpusInvocationV1 = Readonly<{
  planHash: Sha256V1
  args: CanonicalClientValueV1
  windows: readonly GraphNodeWindowIdentityV1[]
  // The complete outer-wrapper inputs, deliberately not materializationHash.
  materialization: GraphMaterializationPreimageV1
  partition: CanonicalClientValueV1
  authorizationVersion: AuthorizationVersion
  evaluationCut: GraphEvaluationCutV1
}>

type NodeCompletenessV1 = Readonly<{
  nodeId: string
  nodeKind: GraphDataNodeKindV1 | "closed-projection"
  label: GraphCompletenessLabelV1
  proofClass: GraphNodeCompletenessProofClassV1
  proof: GraphNodeCompletenessProofV1
}>

type GraphCorpusGraphCompletenessV1 = Readonly<
  GraphCompletenessProofTupleV1 & (
    | Readonly<{
        label: "unknown"
        proofClass: "none"
        proof: GraphCompositionProofV1
      }>
    | Readonly<{
        label: "refused"
        proofClass: "refusal"
        proof: GraphCompositionProofV1
      }>
    | Readonly<{
        label: "complete"
        proofClass: "all-complete"
        proof: GraphCompositionProofV1
      }>
    | Readonly<{
        label: "prefix"
        proofClass: "composed-prefix"
        proof: GraphCompositionProofV1
      }>
    | Readonly<{
        label: "window"
        proofClass: "composed-window"
        proof: GraphCompositionProofV1
      }>
  )
>

type GraphCorpusExpectedResultV1 =
  | Readonly<{
      kind: "result"
      label: "unknown" | "complete" | "prefix" | "window"
      resultBytes: string
      orderedRootIds: readonly string[]
      resultLength: number
      nodeCompleteness: readonly NodeCompletenessV1[]
      graphCompleteness: GraphCorpusGraphCompletenessV1
      refusalReason: null
    }>
  | Readonly<{
      kind: "result"
      label: "refused"
      resultBytes: null
      orderedRootIds: readonly []
      resultLength: 0
      nodeCompleteness: readonly NodeCompletenessV1[]
      graphCompleteness: GraphCorpusGraphCompletenessV1
      refusalReason: GraphMaterializedRefusalReasonV1
    }>

type GraphOracleDivergenceV1 = "direction-tie-break"

type GraphPairedWorldCaseV1 = Readonly<{
  caseKind: "pairedWorld"
  id: string
  oracleDivergence?: GraphOracleDivergenceV1
  plan: GraphPlanIdentityV1
  invocation: GraphCorpusInvocationV1
  worlds: {
    present: Readonly<{ fixture: string; hiddenSlice: readonly Readonly<{
      table: string; rowIds: readonly string[] }>[] }>
    absent: Readonly<{ fixture: string; hiddenSlice: readonly [] }>
  }
  expect: GraphCorpusExpectedResultV1
}>

type GraphAllowDenyCaseV1 = Readonly<{
  caseKind: "allowDeny"
  id: string
  oracleDivergence?: GraphOracleDivergenceV1
  plan: GraphPlanIdentityV1
  invocations: Readonly<{
    allowed: GraphCorpusInvocationV1
    denied: GraphCorpusInvocationV1
  }>
  principals: Readonly<{ allowed: string; denied: string }>
  expect: Readonly<{
    allowed: GraphCorpusExpectedResultV1
    denied: "deny"
    deniedResultBytes: null
  }>
}>

type GraphAudienceParityCaseV1 = Readonly<{
  caseKind: "audienceParity"
  id: string
  oracleDivergence?: GraphOracleDivergenceV1
  plan: GraphPlanIdentityV1
  invocations: readonly [GraphCorpusInvocationV1, GraphCorpusInvocationV1]
  principals: readonly [string, string]
  expect: Readonly<{
    establishment: readonly ["allow" | "deny", "allow" | "deny"]
    strict: readonly ["allow" | "deny", "allow" | "deny"]
  }>
}>

type GraphScopeMismatchCaseV1 = Readonly<{
  caseKind: "scopeMismatch"
  id: string
  oracleDivergence?: GraphOracleDivergenceV1
  plan: GraphPlanIdentityV1
  invocations: Readonly<{
    memberScope: GraphCorpusInvocationV1
    presentedInstance: GraphCorpusInvocationV1
  }>
  principal: string
  expect: Readonly<{
    classification: "query-shaped"
    reason: "scope-unbound"
    resultBytes: null
  }>
}>

type GraphAuthorityTransitionCaseV1 = Readonly<{
  caseKind: "authorityTransition"
  id: string
  oracleDivergence?: GraphOracleDivergenceV1
  plan: GraphPlanIdentityV1
  invocations: Readonly<{
    before: GraphCorpusInvocationV1
    after: GraphCorpusInvocationV1
  }>
  principal: string
  commit: Readonly<{
    dataChanges: readonly []
    authorityEvents: readonly [GraphAuthorityEventSelectorV1,
                               ...GraphAuthorityEventSelectorV1[]]
    afterAuthorizationVersion: AuthorizationVersion
  }>
  observed: readonly Readonly<{
    ordinal: number
    kind: "fence" | "delivery"
    authorizationVersion: AuthorizationVersion
  }>[]
}>

type GraphMixedCommitCaseV1 = Readonly<{
  caseKind: "mixedCommit"
  id: string
  oracleDivergence?: GraphOracleDivergenceV1
  plan: GraphPlanIdentityV1
  invocations: Readonly<{
    before: GraphCorpusInvocationV1
    after: GraphCorpusInvocationV1
  }>
  principal: string
  commit: Readonly<{
    dataChanges: readonly [Readonly<{ table: string; rowId: string }>,
                           ...Readonly<{ table: string; rowId: string }>[]]
    authorityEvents: readonly [GraphAuthorityEventSelectorV1,
                               ...GraphAuthorityEventSelectorV1[]]
    afterAuthorizationVersion: AuthorizationVersion
  }>
  observed: readonly Readonly<{
    ordinal: number
    kind: "fence" | "delivery"
    authorizationVersion: AuthorizationVersion
  }>[]
}>

type GraphRefusalCaseV1 =
  | Readonly<{
      caseKind: "refusal"
      id: string
      trigger: Readonly<{
        phase: "admission"
        plan: CanonicalClientValueV1
        schemaFixture: string
        policyFixture: string
      }>
      expect: Readonly<{
        reason: GraphAdmissionRefusalReasonV1
        resultBytes: null
      }>
    }>
  | Readonly<{
      caseKind: "refusal"
      id: string
      trigger: Readonly<{
        phase: "demand-time"
        plan: GraphPlanIdentityV1
        demandInputs: CanonicalClientValueV1
      }>
      expect: Readonly<{
        reason: GraphDemandTimeRefusalReasonV1
        resultBytes: null
      }>
    }>
  | Readonly<{
      caseKind: "refusal"
      id: string
      trigger: Readonly<{
        phase: "qualification"
        plan: GraphPlanIdentityV1
        qualificationFixture: string
      }>
      expect: Readonly<{
        reasons: readonly [GraphQualificationFailureReasonV1,
                           ...GraphQualificationFailureReasonV1[]]
        resultBytes: null
      }>
    }>
```

`GraphCorpusInvocationV1` is the one reusable executable invocation record.
Every executable case kind carries it: `pairedWorld` carries one because both
worlds hold the same invocation fixed; `allowDeny` and `audienceParity` carry
two because they compare principals; `scopeMismatch` carries the member-scope
and presented-instance invocations; and `authorityTransition`/`mixedCommit`
carry before and after invocations. The runner requires the invocation
`planHash` to equal `plan.planHash`, canonicalizes `args`, exact-checks the
§2.4 window vector, reconstructs the outer materialization from the complete
preimage (never from a supplied hash), and binds partition, authorization
version, and evaluation cut before executing.

`refusal` is deliberately not executable. Its `trigger` is discriminated by
register and contains only the candidate/admitted plan plus the minimum raw
inputs or evidence fixture needed to trigger that refusal. It never contains
`GraphCorpusInvocationV1`, `GraphMaterializationPreimageV1`, or
`GraphMaterializationIdentityV1`, and never mints a materialization. A
demand-time refusal's raw `demandInputs` may contain a malformed candidate
field under test, but not a valid outer-wrapper record.

For a result, `nodeCompleteness` has exactly one entry for every normalized
node in canonical order. Its label/proof-class pairing must satisfy §4.1;
the outer `nodeKind`, `label`, and `proofClass` must exact-match the proof's
`kind`/`label` discriminants and §4.1's proof-class mapping; there is no
arbitrary or null proof payload. Equality-to-one and principal-bound complete
proofs carry one `rows` entry per admitted parent, in parent-key order. An
`exists-semi-join` is a leaf and its complete proof likewise carries exactly
one `{parentKey,existenceBit}` row per admitted parent; there is no redundant
`childNodeIds` vector and nested semi-joins never key evidence by a root that
is not their immediate parent. The corpus has no flat top-level
`existenceBits`: it compares these per-node proof vectors directly.
`graphCompleteness` separately records §4.2's composed graph label and proof;
it is not copied from one convenient node. Its `GraphCompositionProofV1.nodes`
cites exactly every non-projection node proof in canonical node order, using
the host-computed SHA-256 of that complete `NodeCompletenessV1` JCS entry;
`partialNodeIds` is exactly the cited non-complete set. The projection node
uses the same composition proof. Missing, extra, duplicate, reordered, or
hash-mismatched citations fail the corpus. The node proof, projection proof,
composition proof, and `GraphCorpusGraphCompletenessV1` axes must all
exact-match on materialization hash, partition hash, authorization version,
and evaluation cut. `GraphCorpusGraphCompletenessV1.proofClass` is derived
from the composed label by the same closed mapping discipline as node proof
classes: `unknown→none`, `refused→refusal`, `complete→all-complete`,
`prefix→composed-prefix`, and `window→composed-window`.

An executable `GraphCorpusExpectedResultV1` may be `label:"refused"` only
after a real materialization exists and only with a demand-time or
evaluation-time reason from §2.3; it publishes no rows or result bytes.
For every expected result, the top-level `label` exact-matches
`graphCompleteness.label`; on a refused result, `refusalReason` also
exact-matches its composition proof's `primaryReason` and the first refused
node selected by §4.2.
Admission and pre-materialization demand/qualification triggers remain solely
in non-executable `GraphRefusalCaseV1`. A demand-time code is therefore found
in exactly one form per case: non-materializing raw-trigger refusal, or a
materialized refused result, never both.

Only `pairedWorld` is the hidden-world class proof. Its two fixture worlds
have byte-identical schema, indexes, visible rows,
args/window, authority inputs, and logical data/authorization versions. They
differ only because `present` contains the listed rows that the asserted
authority cannot observe and `absent` deletes exactly those rows and their
wholly hidden dependent slice. The runner asserts identical result bytes,
order, length, every per-proof existence vector, every node completeness
label/proof class, the composed graph label/proof, and the required null refusal field. A difference
in any one is
`SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH`; timing is not claimed.

The other runners permit exactly the deltas their case kind names; they do not
reuse `pairedWorld`'s authority/authorization-version/evaluation-cut equality
precheck.

| Case kind | Closed pass condition |
| --- | --- |
| `pairedWorld` | The worlds differ only by the named wholly hidden slice and exact-match result bytes, order, length, per-proof existence vectors, per-node completeness, composed graph completeness, and the null refusal field. |
| `allowDeny` | The allowed and denied invocation records differ only in declared principal/partition axes; `allowed` establishes and receives its complete `GraphCorpusExpectedResultV1`, while `denied` is rejected before any result byte is produced. |
| `audienceParity` | Exactly two principals exercise allow and deny at one instance and authorization version, and the two-entry establishment vector exact-equals the fresh strict-evaluator vector. |
| `scopeMismatch` | A principal who is a member of P presented to a Q broadcast candidate is successfully classified query-shaped with `scope-unbound`; this classification-only case produces no broadcast result byte and is not a refusal. An authored broadcast certificate making the contradicted claim belongs in a separate admission `refusal` case under row 25. |
| `authorityTransition` | Its one commit contains at least one authority event, advances `authorizationVersion`, and records a fence at the new version before any later delivery; no old-version delivery occurs after the commit. |
| `mixedCommit` | Its one commit contains at least one data change and one authority event, advances `authorizationVersion`, fences before any delivery, and delivers neither a data delta nor replacement under the old version. |
| `refusal` | Admission/demand-time returns exactly the stable expected primary reason; qualification returns the complete deduplicated failure set in stable id order. No form produces result bytes, and every reason is limited to its §2.3 register. |

Every successful executable result has all fields present and
`refusalReason:null`; a materialized refused result instead has the closed
empty-row/null-byte form above and retains per-node plus composed refused
proofs. `GraphRefusalCaseV1` remains the only non-materializing refusal form
and has no result/order/completeness fields. `hiddenSlice` entries sort by table then row id;
each row id must exist only in `present`, and the runner exact-compares every
other fixture row and input before evaluating either world.

On `normal-seed-v1`, `policy-extension-v1` supplies internal issues and
protected comment/emoji/private-state rows
(`demos/zerobugs/manifest/acceptance.v1.json:109`). Stage B clones that
extended fixture. Its exact six tables supply separate pairs for the internal
root, protected comment, issue/comment emoji through-path, another principal's
view state, preference, and notification state. Stage B adds a deterministic
corpus-only overlay containing one `issueLabel` edge from an existing normal
label to that internal issue and one provider membership for the same issue;
those exercise repeated/through membership and search without pretending the
extension itself contains either table. Each present world removes one named
hidden slice (including any wholly hidden dependent rows) to form its absent
world. It also pairs missing versus invisible unique children and admission
refusals. The runner rejects any visible-row, schema, index, argument,
authority, or version delta, so “differing only in hidden rows” is mechanically
checked rather than inferred from two independent fixture generations.

This classification is load-bearing three times over: it is the §6 memo
key's soundness argument, it is the "authority-independent base"
declaration that alone can ever unlock cross-principal sharing, and it is
the answer to the trust question LLP 0190 §4 poses for projected facts —
*evaluated under whose authority?* Per LLP 0191 rung 3, the two designs
share this one answer rather than inventing two.

Authority-transition execution is not this Spec's concern: §3.2 supplies the
identity/version inputs, while the fail-closed fence, restoration scheduling,
and quarantine lifecycle remain LLP 0200 §2.4/§2.6 contracts and apply
unchanged to graph subscriptions.

## 4. Completeness vocabulary

The result vocabulary distinguishes (LLP 0183 §D2, normative):

- `unknown` — useful facts exist without a sufficient proof;
- `complete` — the entire named graph at one materialization, authority
  partition, authorization version, and evaluation cut;
- `prefix` — only when ordering and continuation prove a stable prefix;
- `window` — a complete named interval without a whole-query claim;
- `refused` — with a stable reason.

Binding rules this Spec adds: every label is claimed *at* a
(materialization identity, authority partition, authorization version,
evaluation cut) tuple and
is meaningless without it; `prefix` carries the declared `OrderExpr[]` without
`_id`, while `KeysetKeyV1.id` proves the implicit ascending tie-break and the
keyset continuation; a delta-maintained result
(§7) carries the same label it would carry freshly evaluated, enforced by
the §7 convergence assertion; and a local evaluator (§8) must reproduce
the label exactly or answer `unknown` — a downgraded label is honest, an
upgraded one is a conformance failure.

### 4.1 Per-node production rules

Every evaluator returns one
`NodeCompletenessV1 {nodeId, nodeKind, label, proofClass, proof}` for every
normalized node, in canonical node order. `proof` is §2.1's closed
`GraphNodeCompletenessProofV1`, never `CanonicalClientValueV1` or `null`; its
tuple fields name the outer materialization hash, partition hash,
authorization version, and evaluation cut, and its `(kind,label)`
discriminator selects the only legal evidence
shape. Outer `nodeKind`/`label`/`proofClass` exact-match that arm. A claimed
terminal is an independently observed source/range end; reaching a cost or
page bound is never terminal.

| Node kind | Labels it may produce | Required proof |
| --- | --- | --- |
| `root-window` | `unknown`, `prefix`, `window`, `complete`, `refused` | `prefix` uses `{kind:"root-window",label:"prefix",order,continuation,stableOrderProof:"declared-order-with-id-tiebreak",take,consumed,hasMore:true}`; `order` is the declared array without `_id`, and `continuation.id` supplies the implicit tie-break. `continuation` must be non-null and resume strictly after/before the last consumed authorized root. `window` uses the closed `{interval:{lower,upper},take,consumed,hasMore:false}` arm and proves both named ends exhausted. `complete` uses two unbounded ends plus `sourceExhausted:true`. `take:0` is the closed `unknown/zero-take-unproved` arm unless independent exhaustion proves otherwise; it never mints a zero-progress continuation. |
| `equality-to-one` | `unknown`, `complete`, `refused` | The `complete` arm carries a parent-key-ordered `rows` array with one `{parentKey,found}` record for every admitted parent, including captured misses. Visibility executes before presence/projection, so missing and invisible have the same public fact. |
| `bounded-to-many` | `unknown`, `prefix`, `window`, `complete`, `refused` | Each `(kind,label)` is a distinct arm. `complete` has one parent-key-ordered range per parent with literal `hasMore:false`; `window` has a named `interval` and `ranges[].hasMore:boolean`; when a `ranges[].hasMore` value is true that range carries no continuation, and resume supplies the next named interval through §2.4's demand window vector. `prefix` has literal `hasMore:true`, non-null continuation, and total order; its `order` excludes `_id` and `continuation.id` supplies the implicit tie-break. One absent/unproved parent selects the closed `unknown/parent-range-unproved` arm. |
| `exists-semi-join` | `unknown`, `complete`, `refused` | The leaf node's `complete` arm captures every direct/through lookup, including misses, as one `{parentKey,existenceBit}` row per immediate parent in parent-key order. There is no `childNodeIds` field because the proof is already for this one node. `all` additionally proves the complete deduplicated canonical argument set was checked and every item matched; there is no partial existence label. |
| `principal-bound` | `unknown`, `complete`, `refused` | The `complete` arm carries a parent-key-ordered `rows` array with one `{parentKey,bindingFound,targetFound}` record per admitted parent, proving the host principal, binding resolution, and target point/miss at one tuple. Absence for anonymous authority is complete only when the result contract declares the node nullable and no lookup is attempted. |
| `search-membership` | `unknown`, `complete`, `refused` | `complete` carries `providerCompletenessClass:"complete-membership-v1"` and the exact provider-certificate hash. `unknown` still carries the provider completeness class plus `provider-incomplete` or `provider-proof-invalidated`. A provider prefix, stale epoch, absent certificate, or invalidation after the certificate never becomes a graph-minted `prefix`. |
| `closed-projection` | `unknown`, `prefix`, `window`, `complete`, `refused` | Exact result-contract validation plus §4.2's closed `GraphCompositionProofV1`; projection itself adds no data proof. |

Every completeness `rows` or `ranges` entry identifies its immediate parent
with `GraphRowKeyV1 {table,id}`. Each such array contains exactly one entry for
every admitted parent and sorts entries by the RFC 8785 JCS bytes of its
`parentKey` record alone, not the whole proof element. A duplicate or missing
parent key fails the proof; `KeysetKeyV1` never serves as a parent key.

`proofClass` is also derived, never authored independently: `unknown → none`,
`refused → refusal`, root `complete/prefix/window →
whole-source/ordered-prefix/named-window`, to-one `complete → unique-point`,
to-many `complete|window → parent-ranges` and `prefix → ordered-prefix`,
semi-join `complete → complete-membership`, principal `complete →
principal-point`, search `complete → provider-certificate`, and every
projection label `→ projection-composition`. Any other pairing is a corpus
mismatch.

### 4.2 Graph composition

The projection's input set is every non-projection node, including nodes used
only by predicates. Its node label, and therefore the graph label, is the
following deterministic function of that set after exact result-contract
validation; an evaluator may not choose a more optimistic label:

1. Any materialized refusal produces `refused(primaryReason)`.
   `primaryReason` is the first reason in the applicable §2.3 demand-time or
   evaluation-time register. Admission reasons never enter a node or
   composition proof; they remain solely in the non-materializing
   `GraphRefusalCaseV1`. Imported evaluation refusals use that register's owner
   ordering, then canonical node order as §2.3 specifies. Qualification
   failures never enter this composition. The reason is a closed registered
   identifier, including imported owner codes such as
   `SNAPBACK_QUERY_COST_BOUND_EXCEEDED`.
2. Otherwise, any `unknown` produces `unknown`.
3. Otherwise, if every input is `complete`, the graph is `complete`.
4. Otherwise, if every non-complete input is `window`, the graph is `window`;
   its proof is the canonical ordered vector of the named node intervals.
5. Otherwise, if every non-complete input is `prefix`, the graph is `prefix`;
   its proof is the canonical ordered vector of successor boundaries.
6. A mixture of `prefix` and `window` produces `unknown`: neither label alone
   states the mixed partial claim. Stage B pins this row in the corpus.

`GraphCompositionProofV1.nodes` cites exactly every non-projection input proof
above, in canonical node order, by `(nodeId,nodeKind,label,proofHash)`;
`proofHash` is SHA-256 over ASCII `snapback:graph-node-completeness:v1:` plus
the complete `NodeCompletenessV1` RFC 8785 JCS. `partialNodeIds` is the exact
ordered set of non-complete citations for `prefix`/`window`; `allComplete` and
`primaryReason` close their respective arms. The projection node records that composed label last and cannot hide a
predicate-affecting node. A graph labelled `prefix` therefore has a stable
prefix at each partial sequence, not merely `rows.len() == take`; a graph
labelled `window` names every non-whole interval. The composed proof and label
carry and exact-match every cited proof at the single `(materialization
identity, authority partition, authorization version, evaluation cut)` tuple.

## 5. Rung 2 — affected-read precision: extend and measure

**What exists** (grounded in
`crates/snapback-kernel/src/live_matcher.rs:163`, LLP 0020 Phase 4):
subscriptions capture read dependencies at evaluation — `Row`/`MissingRow`
point reads, `Query` dependencies carrying the serialized plan predicate,
order, limit, result count, and the window **boundary** (first/last sort
key plus a completeness bit), membership dependencies for declaration-bound
semi-joins (LLP 0056), and auth-scope disjointness summaries for Ibex
handlers. The matcher skips a commit only when every changed row is
provably disjoint from every captured dependency; everything unprovable
takes the conservative replace fallback. Since LLP 0200 Phase 1, every
disposition is recorded in the permanent matcher-decision ledger
(`LiveMatchOutcome` → skip / match / conservative-fallback counters on the
stats surface) — the spike's counter instrument, now a product surface.

**What the evidence says: rung 2 is not the near-term bottleneck.** E-2 is
unambiguous — on the hot inventory the matcher took zero conservative
fallbacks and its skip set matched the trigger partition; the only
"misses" were errors in the human predeclaration. The expensive problem is
what happens *after* a correct match (one full re-evaluation per
subscriber), not deciding whether to match. **This Spec therefore scopes
rung 2 as extend-and-measure, not build** — the commission's own
post-spike instruction ("rung 2 is not the binding constraint"): no
speculative precision machinery lands on the single-table path, and no
rung-2 work is scheduled ahead of §6. The widening axes the commission
names — joins, ranges, windows, authority partitions — are all specified
below; joins land with the IR because omitting them would *regress*
precision, while the rest are gated on ledger evidence.

**Required now, with the IR (not speculative — it prevents a regression):**
per-node dependency capture for graph plans, specified in §2. Each node
kind contributes the captured vocabulary it already has a precedent for:
root windows contribute predicate + boundary dependencies (the existing
`Query` vocabulary); to-one and to-many relations contribute
parent-indexed edge dependencies (table, join field, bound parent keys);
semi-join nodes contribute membership dependencies (the LLP 0056
mechanism, unchanged); principal-bound nodes contribute field-scope
dependencies (the `viewState.set` precision E-2 shows working); search
nodes stay table-granular until D6 supplies versioned invalidation facts
(OQ-4). The match/skip/fallback ledger reports **per node kind** so
coverage is measurable per the commission's requirement.

### 5.1 Captured vocabulary by normalized node

The shipped carrier has `Row`, `MissingRow`, `Query`, `Auth`, and
`Permission` (`crates/snapback-types/src/storage.rs:279` and
`crates/snapback-types/src/storage.rs:307`). Root-query capture already
records returned rows plus predicate, order, limit, result count, and boundary
(`crates/snapback-kernel/src/live_matcher.rs:26` and
`crates/snapback-kernel/src/live_matcher.rs:82`).
Graph edges need one additive variant because the shipped record has no graph
plan/node identity, parent-keyed edge form, or search-membership identity:

```ts
CapturedReadKind += GraphNode

type GraphParentEdgeDependencyV1 =
  | Readonly<{
      kind: "parent-point"
      table: string
      index: string
      parentKey: GraphRowKeyV1
      lookupKey: readonly CanonicalClientValueV1[]
      childKey: GraphRowKeyV1 | null
      found: boolean
      rowVersion: number | null
    }>
  | Readonly<{
      // A relationship attempt, not a storage consultation.
      kind: "parent-lookup-skipped"
      table: string
      index: string
      parentKey: GraphRowKeyV1
      reason: "null-or-omitted-key"
    }>

type GraphMembershipDependencyV1 =
  | Readonly<{
      kind: "membership"
      tables: readonly string[]
      indexes: readonly string[]
      parentKey: GraphRowKeyV1
      argumentId: null
      argumentDigest?: never
      matchedCount: number
      complete: boolean
    }>
  | Readonly<{
      kind: "membership"
      tables: readonly string[]
      indexes: readonly string[]
      parentKey: GraphRowKeyV1
      argumentId: string
      argumentDigest: Sha256V1
      matchedCount: number
      complete: boolean
    }>

type GraphCapturedReadV1 = Readonly<{
  format: "snapback.graph-captured-read.v1"
  graphPlanHash: Sha256V1
  instanceHash: Sha256V1
  nodeId: string
  nodeKind: GraphNodeV1["kind"]
  authorityClass: GraphAuthorityClassV1
  dependency:
    | Readonly<{
        kind: "root-range"
        table: string
        index: string
        predicate: readonly FilterExpr[]
        order: readonly OrderExpr[]
        limit: number
        resultCount: number
        boundary: KeysetKeyV1 | null
        complete: boolean
      }>
    | GraphParentEdgeDependencyV1
    | Readonly<{
        kind: "parent-range"
        table: string
        index: string
        parentKey: GraphRowKeyV1
        predicate: readonly FilterExpr[]
        order: readonly OrderExpr[]
        limit: number
        resultCount: number
        boundary: KeysetKeyV1 | null
        complete: boolean
      }>
    | GraphMembershipDependencyV1
    | Readonly<{
        kind: "principal-field"
        table: string
        index: string
        partitionHash: Sha256V1
        field: string
        valueDigest: Sha256V1
        found: boolean
      }>
    | Readonly<{
        kind: "search-table"
        table: string
        membershipIdentity: GraphSearchMembershipIdentityV1
        providerVersion: string
      }>
    | Readonly<{
        kind: "projection"
        sourceNodeIds: readonly string[]
      }>
}>
```

Stage B adds optional `graph: GraphCapturedReadV1` to
`CapturedReadDependency`; it is required exactly when `kind == GraphNode` and
absent otherwise. `table`, `index`, keys, predicates, and boundaries above use
the existing internal value representations needed by matching. Ordinary
inspection exposes only ids, counts, kinds, and digests—never argument values,
row ids, principal ids, or interval endpoints. **[author-ratify]** One tagged
variant is chosen over several enum arms so later node additions do not grow
the shared top-level `CapturedReadKind` for every graph-specific distinction.

Canonical validation is fail-closed per variant. Every record is closed;
`nodeId`/`nodeKind` must name the normalized node; count/version fields are
non-negative safe integers; table/index vectors are non-empty, equal-length,
and in edge traversal order; `sourceNodeIds` is the exact §4.2 input vector in
canonical node order. A `parent-point` hit requires `found:true`, `childKey`,
and `rowVersion`; a miss requires `found:false`, `childKey:null`, and
`rowVersion:null`; both require a complete non-null `lookupKey`. An absent/null
join component emits only `parent-lookup-skipped` for the
`(nodeId,parentKey)` relationship attempt. It emits no `Row`, `MissingRow`,
`Query`, range, or point consultation. For `membership`, `mode:exists`
uses `argumentId:null` and the `argumentDigest` field must be absent;
`mode:all` requires the normalized non-null `argumentId` and its canonical
digest. `argumentDigest` is present if and only if `argumentId` is non-null.

| Node kind | Captured dependencies at execution |
| --- | --- |
| `root-window` | One `GraphNode.root-range` and the equivalent existing `Query`; one `Row` per returned versioned row; `MissingRow` as well when the statically point-shaped root misses. Boundary includes first/last total-order keys and complete/source-exhausted bit. |
| `equality-to-one` | One graph edge-attempt dependency per parent: `GraphNode.parent-point` plus `Row` on a concrete-key hit, `GraphNode.parent-point` plus ordinary `MissingRow` on a concrete-key miss, or storage-free `GraphNode.parent-lookup-skipped` on a null/omitted key. The declared unique index and complete ordered join fields are present. |
| `bounded-to-many` | One `GraphNode.parent-range` and one existing `Query` per parent range, including zero-result ranges; returned versioned children contribute `Row`. Each range carries its own predicate/order/limit/count/boundary, so one parent cannot shadow another. |
| `exists-semi-join` | One `GraphNode.membership` per attempted parent. For each probe, a non-unique direct edge additionally records an ordinary `Query`-style bounded-index dependency with `limit:1`, result count, and boundary for both hit and empty outcomes; a unique direct edge records its point `Row`/`MissingRow` instead. A through probe retains its ordinary edge-range `Query` dependency plus target-point `Row`/`MissingRow` dependencies. `exists` carries `argumentId:null` and no digest; `all` binds non-null `argumentId` and `argumentDigest`, never values. In the LLP 0056 precedent these are ordinary query dependencies; `Permission` is never correctness evidence. |
| `principal-bound` | Existing `Auth` for the host principal dimension; target `Row`/`MissingRow`, plus binding `Row`/`MissingRow` only when `binding` is present; one `GraphNode.principal-field` for each consulted binding/target field scope. Anonymous nullable absence proven to attempt no lookup adds no point/range/row dependency. A field/value disjointness skip is permitted only when all consulted inputs are captured. |
| `search-membership` | One `GraphNode.search-table` for each `invalidationTables` entry, carrying the same membership/provider identity. Any write to any listed table matches the node in G0/G2; no matched-id, term, posting, range, or document-level skip exists before D6/OQ-4. |
| `closed-projection` | One storage-free `GraphNode.projection` linking all referenced and predicate-affecting source ids. It exists for ledger/completeness attribution and never makes a changed row match by itself. |

Capture is all-or-conservative. Missing one required dependency marks that
node incomplete and yields `ConservativeFallback`; a coarser static table set
may wake the graph but may not produce a false `Skip`. This preserves the
current matcher's ordering, where captured dependencies are consulted before
the carrier-specific table-granular arms
(`crates/snapback-kernel/src/live_matcher.rs:212` and
`crates/snapback-kernel/src/live_matcher.rs:217`).

### 5.2 Per-node decision ledger

Every graph matcher decision emits one value-free row per normalized node in
canonical order:

```ts
type GraphNodeDecisionLedgerV1 = Readonly<{
  graphPlanHash: string
  instanceHash: string
  nodeId: string
  nodeKind: GraphNodeV1["kind"]
  authorityClass: GraphAuthorityClassV1
  captureComplete: boolean
  dependencyKinds: readonly CapturedReadKind[]
  capturedDependencyCount: number
  changedRowCount: number
  disposition: "skip" | "match" | "conservative-fallback"
  reason: "captured-disjoint" | "captured-intersects"
          | "capture-incomplete" | "static-table-intersects"
          | "search-table-write" | "search-capture-incomplete"
          | "projection-only"
}>
```

`dependencyKinds` uses enum declaration order and deduplicates;
`changedRowCount` is the number of commit rows tested against that node, not
the number proved relevant. Projection always reports
`skip/projection-only`. The graph disposition is
`conservative-fallback` if any storage-reading node falls back, otherwise
`match` if any node matches, otherwise `skip`.

The stats roll-up groups by `(graphPlanHash,nodeKind,disposition,reason)` and
reports `decisions`, `skips`, `matches`, `conservativeFallbacks`, and
`captureIncomplete`. It does not group or expose instance, node, row,
argument, principal, or scope values. Search reasons distinguish only
`search-table-write` from `search-capture-incomplete`; both remain
table-granular.

**Demand-gated (the widening this rung names, deliberately unscheduled):**
range/index intersection beyond the captured boundary, join-selectivity
proofs, and authority-partition-aware skipping (a commit provably confined
to partition P need not wake partition Q's partition-scoped nodes). The
gate is measured, not aesthetic: a real workload — the general shape LLP
0191 names, many subscriptions over *different* data, where sharing
collapses nothing — in which the decision ledger shows wake-rate ×
evaluation-cost material *and* attributes it to fallbacks or provable
false wakes. No widening lands without before/after ledger evidence on
the A/B harness.

## 6. Rung 3 — same-authority-partition memoization first

**Mechanism.** Within one serving process/generation, the evaluation scheduler
memoizes evaluation results keyed by **(graph materialization identity,
authority partition identity, `authorizationVersion`, `evaluationCut`)** —
every component owner-computed (§2, §3; LLP 0200 §2.2's atomic cut supplies
the evaluation cut). When N subscriptions
share the key, one evaluation turn produces one result consumed by N
per-subscription deliveries. E-3 measures the headroom at ~6× for the
same-partition six-observer shape: six serialized ~0.9 s turns become one
turn plus delivery. The materialization component is §2.4's outer
`GraphMaterializationIdentityV1`, so no process-local optimization may weaken
the semantic key to the inner instance hash.

**Soundness.** The key is exactly the tuple the completeness vocabulary
already claims results at (§4), so a memo hit delivers bytes the
subscriber's own evaluation would have produced — same materialization, same
partition, same authorization version, same evaluation cut, same label.
Principal- and policy-ambience is why nothing weaker is safe: LLP 0191 rung 3
records that an opaque handler partitioning
before counting cannot be evaluated under a super-principal and projected
afterward. The IR makes the ambient inputs declared inputs; the partition
identity makes "same authority" checkable instead of assumed.

**Invalidation is the matcher, not a second system.** A matcher wake for
any subscription holding the key retires the memo entry (the key's cut
is superseded). An `authorizationVersion` advance retires every entry at the
older version even when the partition digest and evaluation cut are unchanged;
an authority-instance transition additionally fences subscriptions and thereby
the entries their partition identity depends on (LLP 0200 §2.4's fence
semantics, unchanged). There is no TTL and no separate cache coherence
protocol to get wrong.

**Placement.** Memo entries live in the scheduler beside the pending-frame
structures, bounded (entry count and byte budget declared per instance,
overflow evicts oldest — eviction only costs a re-evaluation). Frames,
watermarks, obligations, and ordering are per-subscription and unchanged;
a memo hit skips the *turn*, never the delivery or its
witnessed-shrink/obligation accounting (LLP 0200 §2.4).

**Scope honesty.** The memo collapses only identical (materialization,
partition, authorization-version, evaluation-cut) tuples. The hot inventory's
*mixed*-partition six observers gain nothing from this rung — their lever is
§7 where the shape admits it, or D3's retained facts. This rung is first
because it is mechanism-cheap (a cache with matcher-driven invalidation) against
measured integer-factor headroom, not because it solves the general case.

**Cross-principal sharing is gated, not designed here.** It becomes
credible only after a graph declares an authority-independent base (§3
class 1) with separately evaluated partition/principal overlays —
evaluate the base once under no principal's authority, then overlay
per-partition. This Spec names the gate and the shared answer with
LLP 0190 §4; designing the overlay evaluator is future work that must not
precede the classification's existence.

## 7. Rung 4 — incremental maintenance for admitted shapes (extending DK-3)

**Precedent, load-bearing.** LLP 0008 DK-3's `live_delta` lane is the
existing admitted-shapes IVM: single-table `HostPlan` queries classify
changed rows against the captured predicate and membership (no re-query,
no VM), emit `add`/`update`/`remove` ops as an additive wire kind, and
keep `live_replace` as the honest fallback. Its guards are the design
pattern this rung extends: conservative eligibility (only where
classification is exact), the **debug-build convergence assertion**
(delta-maintained membership must equal a fresh evaluation's — the L4
parity pattern), the **matcher/SQL agreement invariant** (the predicate
evaluator and the SQL `WHERE` must agree on every operator — the NULL
three-valued-logic HIGH), last-change-per-row-id collapse, and fail-closed
exclusion of membership-gated plans until proven (LLP 0067 §F2a).

**Extension: per-node-kind delta rules over the IR.** Eligibility grows
node kind by node kind, never generically:

- root windows: boundary-aware classification — the captured first/last
  sort keys and completeness bit (already in the dependency vocabulary)
  decide whether an op is inside the window, displaces the boundary, or
  falls outside; boundary displacement without a provable replacement row
  falls back to replace;
- equality to-one: row-keyed patch of the projected parent field;
- bounded to-many: parent-indexed insert/remove/update within the
  declared fanout bound; bound overflow falls back;
- semi-joins: membership-delta classification lands only behind the
  certified evaluator LLP 0056 already names as the condition — until
  then semi-join nodes pin their graph to replace, fail-closed;
- principal-bound nodes: their effective partition is the principal
  itself (partition-of-one) unless OQ-3 rules a coarser identity, so
  their deltas never cross principals by construction;
- search-membership nodes: never delta-maintained by this Spec; D6's
  writer owns their invalidation facts (OQ-4).

Each admitted node rule ships with its own convergence assertion and
conformance rows; a graph's delta eligibility is the conjunction of its
nodes' — one ineligible node pins the whole graph to replace, because a
frame is one graph result, not per-node fragments.

**Authorization-lane interaction.** Deltas ride the data-driven lane
only. Authority transitions are never delta-maintained — the fence and
restoration own them (LLP 0200 §2.4); a subscription resynced while
changes are pending is pinned to replace (LLP 0008's dated decision,
unchanged). A delta frame must carry the same resolution-ticket and
watermark obligations as any other frame.

**Opaque handlers stay re-run.** The no-IVM categorical is scoped to
opacity (LLP 0191's repaired framing): opaque JavaScript handlers cannot
be incrementally maintained, only re-run — and re-run plus rung-1
scheduling plus §6 memoization is a legitimate stable resting point, not
a waypoint (external prior art, non-load-bearing: Convex reportedly
stopped exactly there). This rung is the expensive one; it lands only
where the ledger shows an admitted shape's re-run cost × wake rate still
dominating after rungs 1 and 3.

## 8. Server/local evaluator agreement (the D2–D3 interface; rung 5 referenced)

D3 (LLP 0190) consumes owner-issued identities; it cannot infer a plan
from result bytes or add a graph node to make a retention experiment pass
(LLP 0190 §3.3). This Spec's side of that seam:

- **One IR, two evaluators.** A local evaluator for admitted graphs runs
  the same IR under the same authority classification and produces
  byte-identical results and identical completeness labels, or answers
  `unknown`. Conformance is corpus-based: the same corpus rows the server
  execution qualifies on (§9 G0), evaluated locally, compared exactly —
  the LLP 0008 DK-3 convergence-assertion discipline applied across
  runtimes.
- **Identity-stamped deltas, with an honest replica boundary.** §7's
  delta frames carry (materialization identity, partition, authorization
  version, evaluation cut) so a
  retained-fact carrier can know exactly what a frame claims. A retained
  fact plus an ordered delta stream *is* the local replica — rung 5 —
  and it is D3's to build. But this Spec does **not** yet define the
  replica **continuity contract**: LLP 0200 §2.3's latest-value delivery
  may elide intermediate states, so replica application additionally
  needs per-frame base-version/predecessor stamping, cumulative (not
  compositional) delta semantics or a declared continuity mode, and a
  gap-to-replace rule — the LLP 0191 §2 replica-needs list. That
  contract is designed jointly at this seam when D3 takes up rung 5
  (OQ-6). Until then, §7's deltas are safe for live windows (each frame
  is convergence-asserted against fresh evaluation) and are *not*
  claimed replica-applicable.
- **Refusal parity.** A graph the server would refuse (bounds, policy,
  admission) must refuse identically locally; `refused` reasons are part
  of the conformance corpus.

## 9. Sequencing and measurement (what lands first, and how it is measured)

Instrument: the preserved spike harness
(`spike/oq4-coalescing-measurement` branch — per-arm APFS clones of the
5.5M-row baseline, minutes per arm;
`demos/zerobugs/control/scripts/run-oq4-arm.sh`/`run-p1-ab.sh`) for
per-phase A/Bs, plus the zb5-hot gate for requalification, fix-forward
per LLP 0189. Hypotheses are shape targets; N≥3 per
`benchmarks/protocol.md` before any published claim.

### Stage A — this revision, v0.5

Stage A is this docs-only landing. Sections 2–5 define the closed IR,
identity, authority/broadcast certificates, completeness composition,
dependency capture, refusals, and fixture-derivation skeleton. Section 9
binds Stage B and exit evidence. It adds no manifest/schema type, constructor,
capability registration, generated schema, corpus, executor, matcher arm, or
runtime behavior. Status remains **Draft**.

### Stage B — IR, admission compiler, and frozen corpus

Stage B implements only the data/admission/evidence side: Rust IR and identity
types, codegen normalization/refusal, host reconstruction, JSON-schema mirror,
the Zerobugs declarations, and the frozen corpus/measurement runner. No server
or local evaluator executes `GraphQueryPlanV1`; opaque `issueListV2` and
`issueDetail` remain the serving oracle. The only matcher addition is §2.5's
fail-closed `GraphQuery` arm returning `ConservativeFallback`/not-executed;
execution and dependency consumption remain G2. The committed corpus location is
`tests/conformance/graph/corpus.v1.json`, copied structurally from
`tests/conformance/relational/corpus.v1.json:254`; its Rust runner follows
`crates/snapback/tests/relational_corpus_v0.rs:1` at
`crates/snapback/tests/graph_corpus_v1.rs`. Stage B registers both with
`volta run --node 24.18.0 node scripts/check-inventories.mjs`.

The declarations are grounded in the 23-table control schema, from
`demos/zerobugs/control/snapback/schema.mjs:11` through its final table at
`demos/zerobugs/control/snapback/schema.mjs:371`. The frozen oracles are
`issueDetail` and its ten reads at
`demos/zerobugs/control/snapback/functions.mjs:3869` and
`demos/zerobugs/control/snapback/functions.mjs:3875`, `issueListV2` and its
ten reads at `demos/zerobugs/control/snapback/functions.mjs:3933` and
`demos/zerobugs/control/snapback/functions.mjs:3942`, plus the point/list
companion at `demos/zerobugs/control/snapback/functions.mjs:3976`. Fixture
inputs are pinned at `demos/zerobugs/manifest/acceptance.v1.json:30`,
`demos/zerobugs/manifest/acceptance.v1.json:54`, and
`demos/zerobugs/manifest/acceptance.v1.json:94`.

#### Stage B oracle comparison contract

Each declared query stores this closed field map beside its corpus cases:

```ts
type GraphOracleLabelTranslationV1 =
  | Readonly<{
      oracleStatus:
        | "complete" | "incomplete" | "refreshing"
        | "not-found-authoritative"
      oracleReason: string | null
      when: Readonly<{
        cursor: "non-null" | "null" | "any"
        rows: "non-empty" | "empty" | "any"
      }>
      graphLabel: GraphCompletenessLabelV1
      graphRefusalReason:
        | GraphDemandTimeRefusalReasonV1
        | GraphEvaluationTimeRefusalReasonV1
        | null
      excludedReason: null
    }>
  | Readonly<{
      oracleStatus: "refreshing" | "complete" | "incomplete"
      oracleReason: string | null
      when: Readonly<{
        cursor: "non-null" | "null" | "any"
        rows: "non-empty" | "empty" | "any"
      }>
      graphLabel: null
      graphRefusalReason: null
      excludedReason: string
    }>

type GraphOracleFieldMapV1 = Readonly<{
  query: "issueListV2" | "issueDetail" | "listIssueByID"
  rows: Readonly<{
    graphProjectionPaths: readonly string[]
    oracleFields: readonly string[]
    comparison: "exact-declared-rows"
  }>
  order: Readonly<{
    graphNodeId: string
    oracleFields: readonly string[]
    comparison:
      | "exact-id-order"
      | "exact-after-id-tiebreak-normalization"
  }>
  nodeCompleteness: readonly Readonly<{
    graphNodeId: string
    oracleStatusField: string
    oracleReasonField: string | null
    oracleCursorField: string
    oracleRowsField: string
    comparison: "translated-label"
    translations: readonly GraphOracleLabelTranslationV1[]
  }>[]
  outerStatusReason: Readonly<{
    oracleStatusField: "status"
    oracleReasonField: "reason"
    oracleCursorField: string
    oracleRowsField: string
    comparison: "translated-label"
    translations: readonly GraphOracleLabelTranslationV1[]
  }>
  continuation: readonly Readonly<{
    graphNodeId: string
    oracleHasMoreField: string
    oracleCursorField: string
    comparison: "same-next-page-rows"
  }>[]
  excluded: readonly Readonly<{
    oracleField: string
    reason: string
  }>[]
}>
```

The corpus compares the **declared graph result**—rows, their order,
translated per-node completeness labels/proofs, composed graph completeness,
and continuation semantics—against the oracle's mapped fields. It never
compares the oracle status strings directly with graph labels. `issueListV2`
maps its item rows/order, each item's `labelsCompleteness` to the label-edge
graph node, and `hasMore`/`cursor` to root continuation semantics. A
continuation passes only when resuming each side yields the same next-page rows
in the same order; opaque cursor bytes are never compared. `issueDetail`
records the corresponding map for its root and demand-paged comments node, and
`listIssueByID` records its point/list map. Every oracle-envelope field appears
exactly once as corresponding or excluded. In every `nodeCompleteness` entry
and in `outerStatusReason`, `oracleCursorField` and `oracleRowsField` are
required explicit dotted paths within that query's oracle envelope. A
translation's `when.cursor` and `when.rows` test exactly those two mapped
fields—even for `"any"`—and never an inferred sibling, the outer result by
convention, or a field borrowed from another query.

The graph emits the declared order without `_id`; the kernel appends `_id ASC`
to the SQL order, including for `direction:"backward"` (LLP 0007).
`KeysetKeyV1.id` only carries that tie-break's boundary value in a continuation
or interval end; it does not apply the ordering. The frozen Zerobugs D1
control instead multiplies its id comparison by direction
(`demos/zerobugs/control/snapback/functions.mjs:2824`–`:2833`); Stage B must
not edit that oracle. More precisely, `compareIssueRows` ties on
`sourceIssueID`, not physical `_id`. Before tie normalization, the corpus
resolves each `sourceIssueID` to the physical `issue._id` through the frozen
fixture's one-row identity binding: `issueListRead` carries both typed
`issueID` and `sourceIssueID`, with the latter uniquely indexed
(`demos/zerobugs/control/snapback/schema.mjs:208`–`:224`). It then compares or
normalizes the tied group by that resolved physical `_id`; missing, duplicate,
or inconsistent bindings fail the corpus. A corpus case whose demand direction is backward and
whose expected rows contain at least two equal declared sort keys must carry
`oracleDivergence:"direction-tie-break"`; the field is forbidden otherwise.
Its expected rows and order remain the graph/LLP-0007 order. The case
exact-compares the row set, then exact-compares order after re-sorting only
each oracle tie group by ascending `_id`; its field map uses
`comparison:"exact-after-id-tiebreak-normalization"`. Every case without the
disposition uses `exact-id-order` and compares exactly. The corpus file records
the disposition, and the v0.6 exit note records it as a known control-app
deviation; B3 files the follow-up ticket against the control. It is not a G0
blocker and grants no other oracle normalization.

Each query's field map records the following closed, reason-sensitive rows;
the status/reason pair plus the serialized `when:{cursor,rows}` discriminator
is one translation key. `cursor` refers to the mapped continuation field and
`rows` to the mapped row collection; `any` is explicit, never omission.

| Query / mapped field | Oracle `(status, reason)` | `when.cursor` | `when.rows` | Graph disposition |
| --- | --- | --- | --- | --- |
| all mapped node fields; `issueListV2` / `listIssueByID` outer | `complete, null` | `any` | `any` | `complete`, no refusal |
| `issueListV2` outer | `incomplete, page-limit` | `non-null` | `non-empty` | `prefix`, with the §4.1 directional order proof |
| `issueListV2` outer | `incomplete, child-bound` | `any` | `any` | `refused`, `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` |
| `issueListV2` outer | `incomplete, issue-read-model-bound` | `any` | `any` | `refused`, `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` |
| `issueListV2` outer | `incomplete, label-membership-bound` | `any` | `any` | `refused`, `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` |
| `issueListV2` outer | `incomplete, positive-limit-required` | `null` | `empty` | `refused`, `SNAPBACK_GRAPH_ARGUMENT_INVALID` |
| `issueListV2` outer | `refreshing, search-document-bound-or-epoch-missing` | `any` | `any` | excluded: transient provider state, not a graph result label |
| `issueListV2` item `labelsCompleteness` | `incomplete, null` | `any` | `any` | `refused`, `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` |
| `issueDetail` outer | `complete, null` | `any` | `any` | excluded: aggregate duplicate; compose the mapped node labels under §4.2 |
| `issueDetail` outer | `incomplete, bounded-child-window` | `any` | `any` | excluded: it coalesces pageable and hard-bound child causes; compose the mapped node labels under §4.2 |
| `issueDetail` outer | `not-found-authoritative, missing-or-invisible-issue` | `null` | `empty` | `complete` with zero root/result rows and no refusal |
| `issueDetail` `labelsCompleteness` / `emojiCompleteness` | `incomplete, null` | `any` | `any` | `refused`, `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` |
| `issueDetail` `commentsCompleteness` | `incomplete, null` | `non-null` | `non-empty` | `window`, when next-page row parity proves the named interval |
| `issueDetail` `commentsCompleteness` | `incomplete, null` | `null` | `empty` | `refused`, `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` (the oracle's 1,024-comment collection ceiling) |
| `listIssueByID` outer | `not-found-authoritative, missing-or-outside-list-context` | `null` | `empty` | `complete` with zero root/result rows and no refusal |
| `listIssueByID` outer | `incomplete, child-bound` or `incomplete, label-membership-bound` | `any` | `any` | `refused`, `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` |
| `listIssueByID` outer | `refreshing, search-document-bound-or-epoch-missing` | `any` | `any` | excluded: transient provider state, not a graph result label |
| `listIssueByID` item `labelsCompleteness` | `incomplete, null` | `any` | `any` | `refused`, `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` |

The two slash/`or` rows above are emitted as separate
`GraphOracleLabelTranslationV1` entries with identical dispositions. Every
translation listed in the table is serialized into the applicable field map,
including the excluded rows with their exact `excludedReason`. Any oracle
`(status, reason, when.cursor, when.rows)` key absent from that map, a
`page-limit`/comments window without the required continuation proof, or a continuation on a zero-row
authoritative miss fails the corpus with
`SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH`.
In particular, the null-cursor/empty-comments row above is the closed
evaluation-time cost-bound result, never a
`SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH` translation.

`examined` is excluded because it is opaque-handler physical work rather than
a graph result leaf; `total` because it is a full filtered count outside the
bounded declared projection; and `searchEpoch` because it is provider
diagnostic/version metadata rather than a projected graph field. Any query
whose **rows** cannot be reproduced by the v1 graph grammar is frozen as a
`refusal` case with its stable reason; envelope-only exclusions may not hide a
row mismatch.

At G0 every applicable `queryCost`/`queryCost.graph` field is declared under §2.6. Logical fields are
derived from fixture facts and these oracle results. Physical fields are
analytical plan-shape declarations marked **[G2 measures]**; no Stage B
`StructuralWorkV1` value is represented as graph-executor observation.
**[author-ratify]** Ruled 2026-08-23 under
`issues/20260823-llp0209-g0-commission.md`; author ratification recorded at the
v0.6 exit; LLP 0267 §5 amendment requested (drift list). LLP 0267
observed-value consumption begins at G2.

The following is the complete G0 deliverable checklist. Every command named
below is a command Stage B must make runnable from the repository root; test
filters are stable test names, not prose descriptions.

| # | Deliverable | Stage B artifact | Verification command Stage B must provide |
| ---: | --- | --- | --- |
| 1 | [ ] **The IR, as data.** All seven §2.2 node kinds; finite, acyclic, closed; normative exclusions/refusals. | `GraphQueryPlanV1`/`GraphNodeV1` and `GraphQueryCarrierV1` in `snapback-types`; `defineGraphQuery`; `HandlerPlan::GraphQuery`; generated JSON Schema; fail-closed matcher arm; `@ref LLP 0209#2-the-graph-ir` on the IR. Placement follows LLP 0276; no new crate. | `cargo test -p snapback-types graph_query_v1 && volta run --node 24.18.0 node --test packages/snapback-codegen/graph-query.test.mjs` |
| 2 | [ ] **Plan, demand, and contextual identity.** Host-recomputed normalized plan identity; plan × canonical args × keyed node-window-vector instance identity; LLP 0157 contextual materialization wrapper; wire-identical keysets. | `GraphPlanIdentityV1`, `GraphInstanceIdentityV1`, `GraphMaterializationIdentityV1`, frozen Rust/JS positive and one-axis-rotation vectors, plus positive and negative `KeysetKeyV1` JSON round-trip vectors through the kernel `KeysetAfter` type (multi-field declared order, null declared value, separate `id`, forbidden `_id` in `entries`/`order`, wrong tuple arity/type, wrong field order). | `cargo test -p snapback-types graph_plan_identity_v1 && cargo test -p snapback-types graph_keyset_kernel_round_trip && cargo test -p snapback --test graph_corpus_v1 identity_vectors` |
| 3 | [ ] **Per-node authority classification, proved not trusted.** Classes 1/2/3, compile checks, paired-world falsification, partition roll-up; class 3 is partition-of-one. | Codegen proof report embedded in normalized plans; class-2 `GraphPartitionEquivalenceProofV1` host-recomputation vectors; `GraphAuthorityPartitionRuleV1`; paired-world and exact-audience corpus rows from §3; `@ref LLP 0209#3-authorization-at-every-node` on admission. | `volta run --node 24.18.0 node --test --test-name-pattern=authority packages/snapback-codegen/graph-query.test.mjs && cargo test -p snapback --test graph_corpus_v1 paired_worlds` |
| 4 | [ ] **Completeness vocabulary bound to the IR.** `unknown`/`complete`/`prefix`/`window`/`refused` at one materialization/partition/authorization-version/evaluation-cut tuple. | Closed per-node `GraphNodeCompletenessProofV1` and composed `GraphCompositionProofV1` in every materialized corpus result; materialized refusal reason pinned to the demand/evaluation registers. | `cargo test -p snapback --test graph_corpus_v1 completeness_labels` |
| 5 | [ ] **Per-node dependency capture specified for every kind.** Root predicate/boundary; parent edges; membership; principal field; table-granular search. | `CapturedReadKind::GraphNode`/`GraphCapturedReadV1` in `snapback-types`, with the matching vocabulary registered in `snapback-sync`; schema/round-trip fixtures only. Execution and matcher consumption wait for G2. | `cargo test -p snapback-types graph_captured_read_v1 && cargo test -p snapback-sync graph_captured_read_v1 && cargo test -p snapback --test graph_corpus_v1 dependency_shapes` |
| 6 | [ ] **The Zerobugs corpus is declared and compiles or refuses.** `issueListV2`, `issueDetail`, and point/list companion shape use the opaque JS handlers as oracle. | Normal-fixture declared rows/order/node labels/continuation semantics, explicit per-query `GraphOracleFieldMapV1`, exclusions, stable refusals, host identities, oracle digests, closed `when` translation discriminators, any required `direction-tie-break` case disposition, and all §3.4 case kinds in `tests/conformance/graph/corpus.v1.json`; large-fixture identity/label spot checks. | `cargo test -p snapback --test graph_corpus_v1 && volta run --node 24.18.0 node scripts/check-inventories.mjs` |
| 7 | [ ] **Every bound declared under the G0 ruling.** Logical fields are sized from fixture facts/oracle results; physical fields are analytical plan-shape declarations tagged `[G2 measures]`; 1,024 summed-batch reuse is rejected; maintained-write is zero. | Normal/large/hot logical derivations, analytical physical derivations, node-ledger declarations, `GraphG0ExitObservationV1`, and completed §2.6 table in the v0.6 note; no fabricated graph-executor observations. | `volta run --node 24.18.0 node demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs --fixtures normal-seed-v1,large-seed42-v1,hot-recent-v1 && cargo test -p snapback --test graph_corpus_v1 bounds_are_fixture_derived` |
| 8 | [ ] **All nine LLP 0268 §7 inputs.** Each named label has its §3.3 carrier, mapped case kinds, and exit evidence; omission blocks B1. | `GraphBroadcastAdmissionV1` proof/refusal records, all seven §3.4 case kinds, and normal/large/hot G0-exit observations. | `cargo test -p snapback --test graph_corpus_v1 broadcast_inputs_complete` |
| 9 | [ ] **OQ-1 applied.** New sibling arm/capability/constructor; shipped carriers frozen; no migration; degenerate equivalence deferred to G2. | Registry reservation and schema arm for `graph_query_v1`; existing relational corpus unchanged; explicit no-executor admission test and fail-closed matcher arm. | `cargo test -p snapback-types graph_query_sibling_arm && cargo test -p snapback --test relational_corpus_v0 && cargo test -p snapback --test graph_corpus_v1 no_runtime_consumer` |

### Exit — v0.6 G0 exit note

#### G0 exit record (dated note, 2026-08-23)

Landed evidence: Stage A `77ed8394d` (this Spec v0.5), Stage B1 series ending `73232029d` (graph IR, identities, registers, `HandlerPlan::GraphQuery`, fail-closed matcher arm), Stage B2 series ending `4627f9d95` (`defineGraphQuery`, JS lowering with RFC 8785 JCS parity, source-stage refusals with the allowance handshake, shared JS/Rust parity corpus), Stage B3 series ending `40e76924c` (Zerobugs declarations, `tests/conformance/graph/corpus.v1.json`, `bound-derivation.v1.json`, `paired-world-fixtures.v1.json`, `broadcast-cases.g2-pending.v1.json`, the oracle freezer). Review records: `llp/reviews/0209-g0-stage-{a,b1,b2,b3}.*`.

The exit is recorded **as measured, not as hoped**: the checklist rows the artifacts support are marked COMPLETE; rows that depend on an evaluator (G2), on the large fixture (absent locally — only its receipt), or on host-proven broadcast certificates (which B1 refuses by design until owner proofs exist) are PARTIAL or NOT SATISFIED. Per LLP 0268 §0, this exit does **not** unblock 0268 B1: it must be extended and re-recorded with the eight missing §7 inputs. G2 and G3 are unblocked by rows 1, 2, 5, 9 and the frozen corpus.

The verbatim exit draft that the B3 lane produced and both review families checked follows; it is the authoritative row-by-row status and the author-ratification table (provisional entries carry their zb5 validation command).

### LLP 0209 v0.6 G0 exit note — orchestrator draft

**Draft date:** 2026-08-23  
**Contract:** LLP 0209 v0.5  
**Stage A evidence:** `50c1b610d` through converged record `77ed8394d`  
**Stage B1 evidence:** series ending `73232029d`  
**Stage B2 evidence:** series ending `4627f9d95`  
**Stage B3 evidence:** series ending `40e76924c`

This draft does **not** claim G0 exit. It records the evidence available now
and the missing carriers without making a G2, G3, runtime, publication,
latency, or graph-executor claim. It does not change LLP 0209's status.

#### Stage B checklist

| # | Status | Evidence and remaining gap | Verification |
| ---: | --- | --- | --- |
| 1 | COMPLETE | B1 closed plan/node vocabulary and fail-closed matcher; B2 codegen constructor | `cargo test -p snapback-types`; codegen graph suite |
| 2 | COMPLETE | Rust/JS vectors plus three host-admitted Zerobugs carriers | `identity_vectors`; `zerobugs_declarations_admit_with_host_identities` |
| 3 | PARTIAL | The crew-or-public `visibility` inputs derive class 2, principal-bound nodes derive class 3, five paired worlds exact-match across wholly hidden rows, and the executable `allowDeny` case freezes the legitimate crew/ordinary activation against the oracle. Class-2 scope identities are owner-resolved from frozen role, membership, and visibility facts and independently reconstructed by Rust. The hidden-root detail pair correctly has an empty child vector, but B1 still refuses that form; no graph evaluator or host-proven broadcast certificate exists at G0. | `paired_worlds`; `allow_deny_cases_are_oracle_frozen_and_structurally_executable`; `owner_resolved_class2_scope_identities_partition_equivalence`; `issues/20260823-graph-empty-child-demand-window-vector.md` |
| 4 | PARTIAL | Every paired-world result and the allowed activation result carries a proof tuple whose materialization and partition hashes are reconstructed by Rust. The hidden-root detail pair remains explicitly blocked on B1 accepting the empty-child interval vector, so this row does not claim universal instance admission. | `completeness_labels`; `paired_worlds` |
| 5 | COMPLETE | Closed `GraphCapturedReadV1` vocabulary and one top-level captured-read arm exist; execution consumption remains deferred by the staged contract | `dependency_shapes`; snapback-types graph-capture tests |
| 6 | PARTIAL | Three declarations, eight executable oracle cases, five exact-match paired worlds, one executable oracle-frozen `allowDeny`, three executable refusals, closed translation coverage, a real detail resume through `commentsPage`, authoritative miss and closed cost-refusal cases, graph-order labels, and the one live comments tie disposition are frozen. The large fixture spot check and graph evaluator remain unavailable. | corpus freezer; `oracle_field_maps_and_refusals_are_closed`; `paired_worlds`; `allow_deny_cases_are_oracle_frozen_and_structurally_executable` |
| 7 | PARTIAL | Normal-fixture typed exit observations are complete for all three graphs. Large/hot maxima and observations are unavailable, and every affected bound field is explicitly provisional with its validation command. | `bounds_are_fixture_derived`; `broadcast_inputs_complete` |
| 8 | NOT SATISFIED | Only `G0-BCAST-IDENTITY` is satisfied. Every admitted base is class 2 and every projection rolls up to class 3, so all three plans record `base-not-class-1`; no class-1 broadcast base or executed counterfeit-broadcast refusal exists. `allowDeny` is executable in the main corpus; four graph-evaluator case kinds remain non-executable structural records, and eight LLP 0268 §7 labels lack named carriers. | `g2_pending_broadcast_cases_are_structurally_frozen`; `broadcast_inputs_complete` |
| 9 | COMPLETE | Additive sibling arm/capability/constructor; relational corpus unchanged; no serving consumer | `no_runtime_consumer`; relational corpus suite |

The executable G0 corpus contains five exact-match `pairedWorld` cases, one
oracle-frozen `allowDeny` case, and three `refusal` cases. The eight oracle
comparison cases execute through the fixture oracle/freezer. The sidecar
contains only `audienceParity`, `scopeMismatch`, `authorityTransition`, and
`mixedCommit`; those four graph-evaluator records are structurally closed,
carry no `pending` arm, and are not executed.

#### LLP 0268 §7 inputs

| Label | Status | Evidence or specific missing carrier |
| --- | --- | --- |
| `G0-BCAST-CLASS` | NOT SATISFIED | `issueListV2` and `listIssueByID` derive n0–n4 as class 2 and n5–n6 as class 3; `issueDetail` derives n0–n5/n7 as class 2 and n6/n8/n9 as class 3. All three broadcast admissions therefore say `base-not-class-1`; no class-1 base or executed counterfeit-broadcast refusal is frozen. |
| `G0-BCAST-SEPARATION` | NOT SATISFIED | Missing host-proven separation certificate and evaluator |
| `G0-BCAST-SCOPE` | NOT SATISFIED | Owner-normalized scope identities and same/different equivalence assertions are frozen and Rust-reconstructed; executed P/Q mismatch evidence remains missing |
| `G0-BCAST-SCOPE-BINDING` | NOT SATISFIED | Missing executed resource-to-scope equality proof |
| `G0-BCAST-AUDIENCE` | NOT SATISFIED | Missing executed establishment/strict-evaluator parity |
| `G0-BCAST-INVALIDATION` | NOT SATISFIED | Missing executed authority-transition and mixed-commit fence evidence |
| `G0-BCAST-IDENTITY` | SATISFIED | Full plan, instance, materialization, partition, authorization-version, and evaluation-cut preimages with Rust reconstruction |
| `G0-BCAST-CORPUS` | NOT SATISFIED | Four graph-evaluator case kinds are structurally pending and non-executable at G0; `allowDeny` is executable in `corpus.v1.json` |
| `G0-BCAST-BOUNDS` | NOT SATISFIED | Missing large/hot typed observations and non-provisional maxima with pending author ratification (v0.6) |

The machine-readable source is `corpus.v1.json.broadcastInputs`. Per LLP 0268
§0, G0 exit must be extended and re-recorded before LLP 0268 B1; the eight
unsatisfied labels cannot be carried forward as an implicit claim.

#### Bounds and provisional ratification

No aggregate or average substitutes for a maximum. The freezer derives normal
maxima from rows, large totals from the receipt, label fanout from the
generator's closed uniform `1..3` rule, comment fanout from the documented
floored-exponential rule (which has no finite per-issue ceiling), and the hot
working set from the manifest-defined `W = 1,000` interval.

| Query / field | Declared value | Basis | Ratification |
| --- | ---: | --- | --- |
| `issueListV2.maxRootRowsPerPage` | 1,024 | hot filtered interval maximum 1,000 with portable-boundary headroom | PROVISIONAL — hot validation required |
| `issueListV2.maxWindowPages` | 1 | `ceil(max(normal filtered project 516, hot W 1,000) / 1,024)`; never the million-row whole-table receipt | PROVISIONAL — large selected-project interval required |
| list/point label `maxChildrenPerParent` | 16 | max(normal 5, generator closed maximum 3), with declared headroom | derived — provisional, pending author ratification (v0.6) |
| selected-label `maxItems` / expansion | 16 | authored collection ceiling | derived — provisional, pending author ratification (v0.6) |
| `issueListV2.maxResultRows` | 1,024 | one admitted hot page | PROVISIONAL — hot validation required |
| `issueListV2.maxResultBytes` | 33,554,432 | normal mapped result 436,163 bytes with exact declared ratio | PROVISIONAL — large validation required |
| detail comment `maxChildrenPerParent` | 1,024 | control refusal boundary; normal maximum 21; large receipt ceiling 2,527,886; seed-42 per-issue maximum unavailable | PROVISIONAL — large validation required |
| detail comments `maxWindowPages` | 1 | `ceil(normal maxCommentsPerIssue 21 / maxChildrenPerParent 1,024)` | PROVISIONAL — seed-42 per-issue maximum requires zb5 |
| detail comments lineage | pages 1; scanned rows 1,025; index ranges 1; result rows 1; result bytes 8,388,608 | one declared comments page at the normal maximum | PROVISIONAL — seed-42 per-issue maximum requires zb5 |
| detail `windowRollup` | pages 2; root rows 1; scanned rows 2,092; result rows 2; result bytes 16,777,216; index ranges 27 | root lineage plus one planned comments lineage, per §2.6 | PROVISIONAL — seed-42 per-issue maximum requires zb5 |
| `issueDetail.maxResultRows` | 1 | point root | derived — provisional, pending author ratification (v0.6) |
| `issueDetail.maxResultBytes` | 8,388,608 | normal mapped result 20,261 bytes with exact declared ratio | PROVISIONAL — large validation required |
| `listIssueByID.maxResultRows` | 1 | point root | derived — provisional, pending author ratification (v0.6) |
| `listIssueByID.maxResultBytes` | 1,048,576 | normal mapped result 6,479 bytes with exact declared ratio | PROVISIONAL — large validation required |
| all graphs `maxMaintainedWritesPerMutation` | 0 | G0 owns no graph-maintained writes | derived — provisional, pending author ratification (v0.6) |

Every provisional field in `bound-derivation.v1.json`, including analytical
physical and operational fields omitted from this compact table, carries the
applicable command:

```sh
ZBUGS_LARGE_FIXTURE_ROOT=demos/zerobugs/fixtures-local/large-seed42-v1 ZBUGS_ATTEMPT=v4 volta run --node 24.18.0 node demos/zerobugs/control/tests/acceptance/gates/zb5-large.mjs
ZBUGS_LARGE_FIXTURE_ROOT=demos/zerobugs/fixtures-local/large-seed42-v1 ZBUGS_ATTEMPT=v11 volta run --node 24.18.0 node demos/zerobugs/control/tests/acceptance/gates/zb5-hot.mjs
```

Normal facts are 14 users, 516 issues, 924 comments, 30 labels, and 603
issue-label edges, with per-issue maxima of 21 comments and 5 labels. The
large receipt records 100 users, 100 projects, 1,000,000 issues, 2,527,886
comments, 4,810 labels, and 2,000,370 issue-label edges; the preserved CSV
shards needed for the exact seed-42 per-issue maximum are absent.

#### Exit observations

All fields of `GraphG0ExitObservationV1` are present for the normal fixture.
Each group-state measurement is the serialized mapped result plus its proof
tuple, and dependency bytes are the serialized typed captured-dependency
vector.

| Query | Result bytes | Captured-dependency bytes | Group-state bytes |
| --- | ---: | ---: | ---: |
| `issueListV2` | 436,163 | 1,459,700 | 436,471 |
| `issueDetail` | 20,261 | 5,341 | 20,569 |
| `listIssueByID` | 6,479 | 3,752 | 6,787 |

Large and hot observations are **NOT SATISFIED** for each of the three queries.
They remain outside the typed observation array and appear only in
`g0ExitObservationGaps`, with the commands above. `GraphG0ExitObservationV1`
has no deferred/unavailable arm; that missing arm is a Spec gap for the v0.6
note. No incomplete pseudo-observation is emitted.

#### Oracle dispositions

- All mapped `labels` arrays are ordered by graph `labelID` before freezing.
  The exact through-target `label.name` ordering remains an admission refusal
  for all three full oracle shapes.
- `issueListV2` declares `modified DESC, sourceIssueID DESC`. The 69 equal-
  `modified` groups are resolved by the explicit secondary field; only the
  residual physical `_id` layer is eligible for `direction-tie-break`, and the
  frozen fixture has zero residual groups.
- `issueDetail` comments declare `created DESC`. Its executable continuation
  case emits the singular `oracleDivergence: "direction-tie-break"` and uses
  `exact-after-id-tiebreak-normalization`: row sets exact-match, and physical
  `_id` normalization applies only within the one tied `createdAt` group.
- The detail oracle suite resumes its frozen non-null cursor through the
  control's `commentsPage` seam and exact-compares the non-empty mapped next
  page (`g0_window_0050`, digest
  `sha256:766a764b9762f427c38d04926229681841d0b09dba80e46c026dee86dfcbd19b`).
  It also includes the null-cursor/empty cost-bound refusal and an
  authoritative miss. Every
  `(status, reason, when)` translation row is linked to an executable case or
  explicitly marked unexercised in the corpus.

Normal raw-oracle and mapped-result measurements:

| Query | Raw bytes / digest | Mapped bytes / digest |
| --- | --- | --- |
| `issueListV2` | 517,010 / `sha256:ebbb09fcf00829c123668cb17f6ef4b85c463140a72aa284796bf9ef27920d57` | 436,163 / `sha256:91cae199e894962f4a8b65c27f96e6ccdb267978eedd9c599ac02c5c27073e5a` |
| `issueDetail` | 26,549 / `sha256:7bb0b07afc67af3b26612714f3a60a7127129efc58941a242331c643f81671ee` | 20,261 / `sha256:3c9376a566186db13c096228213bf38cf41634c68b0b8f500547078b8b14637a` |
| `listIssueByID` | 6,806 / `sha256:6e4f672f309fb6d8d8c98e8317a6aee3908c08dc1d0ce8471b9a23766abe910f` | 6,479 / `sha256:401b1a6821acac378d285223eeff07b74a0ecfeb7938556f42b6c7d3726adee8` |

#### Frozen artifact digests

| Artifact | Content digest |
| --- | --- |
| `corpus.v1.json` | `sha256:bd28f10b51057cfec697c31eb0104ee9e30d9999a4e571d495fd1e77d25932d3` |
| `bound-derivation.v1.json` | `sha256:3e2f942c7d627da65eb8af0b7545e7e164c1d0a312aca5d5d9817f9b71a59430` |
| `paired-world-fixtures.v1.json` | `sha256:afcb09c4d2599a0fff1efb3123f6b9692e31ab43c99ae236314caeb6a9cb9d25` |
| `broadcast-cases.g2-pending.v1.json` | `sha256:98b9de2ef61745507b6faf72af5d4b89e709c643a00df3ea210a6ee3b312ce4d` |

#### Remaining gaps

- Eight LLP 0268 §7 broadcast inputs are not satisfied; their exact missing
  carriers are listed above.
- The hidden/missing-root detail pair has the correct empty comments interval
  vector but remains blocked on B1's empty-child acceptance ticket.
- Large/hot maxima and typed exit observations require the recorded zb5 runs.
- `GraphG0ExitObservationV1` needs a deferred/unavailable arm or an explicit
  owner ruling in the v0.6 note.
- LLP 0267's physical-window wording and hard retained group-state/frame/
  handoff bounds remain owner work; normal measurements here are observations,
  not those hard bounds.
- The exact label-name-ordered through shape remains unrepresentable in v1 and
  is refused rather than approximated.

#### Exit command block

The orchestrator appends the final verbatim results after all requested checks
run. Until the missing carriers above are supplied, those green checks validate
this partial record; they do not convert it into a G0 exit claim.

## 10. Non-goals

Generic IVM for opaque handlers; cross-principal shared evaluation
(gated in §6, not designed); evaluation scheduling, settlement,
authorization-lane routing, fences, and quarantine lifecycle (LLP 0200);
retention carriers, local persistence, and replica lifecycle (D3 /
LLP 0190); D6 projection writers and search invalidation facts; any
weakening of declared bounds, refusal discipline, the fail-closed client
postures, or the server-authoritative trust model; client-authored plans
or identities.

## Decisions requiring author ratification

- The dedicated `snapback:graph-plan:v1:`,
  `snapback:graph-instance:v1:`,
  `snapback:graph-materialization:v1:`,
  `snapback:graph-partition-function:v1:`,
  `snapback:graph-authority-partition:v1:`, and
  `snapback:graph-broadcast-scope:v1:` hash domains (§2.1, §2.4, §§3.1–3.3).
- One additive top-level `CapturedReadKind::GraphNode` carrying the closed
  graph dependency union rather than multiple graph-specific top-level arms
  (§5.1).
- The logical-bound headroom factors and resulting G0 values, including the
  1,024-root, 16-label-edge, and zero-maintained-write candidates (§2.6).
- Author ratification at the v0.6 exit of the 2026-08-23 ruled
  declaration/observation split: fixture/oracle derivation for logical bounds,
  the closed normalized-plan function for analytical physical declarations,
  and LLP 0267 observed-value consumption deferred until the G2 executor
  exists (§2.6, §9; ruling source is the commission packet).

## Drift found, not fixed

- **LLP 0267 §2.2 `maxIndexRanges` absolute:** request an LLP 0267-owner
  amendment to reconcile its 512 per-invocation consultation maximum
  (`llp/0267-query-cost-guardrails.rfc.md:335`) with the admitted
  `issueListV2` corpus shape. A 1,024-root page with even one to-one needs at
  least 1,025 consultations under LLP 0267 §1.1/§5. The Stage B corpus row is
  the evidence; the amendment must change the owner ceiling/profile, not
  redefine point consultations out of `indexRangeCount` (§2.6).
- **LLP 0267 §5 window wording:** amend the singular stable-window/
  `QueryCostWindowLedgerV1` wording to admit one independent ledger lineage
  for every demand-paged graph node, with the node id and its canonical
  per-parent interval vector in the binding (§2.4).
- **LLP 0267 §5 summed-window wording:** replace its singular graph tuple with
  six per-lineage declarations on every demand-paged node plus a graph-level
  derived checked sum for pages, rows, bytes, and ranges across those lineages
  (§2.6).
- **LLP 0267 §5 G0 observation wording:** amend “G0 must populate every
  applicable entry” so G0 populates declarations and logical fixture/oracle
  evidence, while graph-executor physical observations begin at G2; this Spec
  does not edit the Accepted owner (§2.6, §9).
- **LLP 0267 / LLP 0268 broadcast bounds:** LLP 0268 B1 must declare hard
  retained group-state, frame, and handoff bounds, via an LLP 0267-owner
  amendment to the sole `queryCost` carrier. G0 supplies the normal/large/hot
  `GraphG0ExitObservationV1` measurements, not a parallel hard-bound surface
  (§2.6, §3.3).
- **LLP 0268 metadata line 12:** the four pre-LLP-0276 paths are stale after
  the crate split. Their current owners are
  `crates/snapback-engine/src/local.rs`,
  `crates/snapback-kernel/src/live_matcher.rs`,
  `crates/snapback-kernel/src/ephemeral.rs`, and
  `crates/snapback-server/src/server.rs`; correction belongs to LLP 0268.
- **Zerobugs D1 descending tie-break:** the frozen control multiplies `_id`
  comparison by direction while LLP 0007 requires the graph's `_id` tie-break
  to remain ascending. Stage B records only the closed
  `direction-tie-break` corpus disposition; B3 files the control-app ticket
  named in §9 and records it in the v0.6 exit note. G0 does not edit the
  oracle and this known deviation is not a G0 blocker.

## Open questions

- **OQ-1 — Resolved 2026-08-23 (grammar lineage).** The ruled surface is the
  additive sibling `HandlerPlan::GraphQuery` arm in §2.5; all three shipped
  carriers remain frozen and degenerate equivalence waits for G2.
  History: the prior question was extend-in-place versus supersede/migrate,
  with the earlier “0080/0100/0155” lineage corrected to
  LLP 0080/0110/0135+0157.
- **OQ-2 (memo placement on hosted profiles).** On the Cloudflare DO
  target the single-threaded owner changes the memo's concurrency story
  (and LLP 0200 OQ-1's `waitUntil` question touches the same seam).
  Process-wide vs per-connection scope, and the byte budget, are sized
  at G1 on the local target and revisited for DO.
- **OQ-3 (partition identity function).** Is the authority partition
  identity derivable purely from LLP 0008's authorization-version
  vocabulary plus declared `permissionBacking` inputs, or does it
  require hashing resolved policy inputs at evaluation time? The former
  is cheaper and pre-declarable; the latter is more precise. G1 can
  start with the conservative choice (principal-scoped = partition of
  one) and widen.
- **OQ-4 (search-node invalidation).** When D6 lands versioned
  projection identities and writer/rebuild contracts, do search nodes
  get matcher facts (making them precision-bearing) or stay
  table-granular? Owned jointly with D6 at its landing, not before.
- **OQ-5 (the rung-2 widening gate's workload).** Which concrete
  workload represents the general many-subscriptions-over-different-data
  shape well enough to arm §5's gate, and does it need a new fixture or
  an extension of the existing harness? Deferred until after G2's
  ledger data exists.
- **OQ-6 (replica continuity contract).** When D3 takes up rung 5, the
  D2–D3 seam must define how a latest-value-elided delta stream becomes
  replica-applicable: per-frame base-version/predecessor stamping,
  cumulative delta semantics or a declared continuity delivery mode,
  gap detection, and the gap-to-replace rule (§8). Designed jointly with
  LLP 0190's owner at that point, not before; until ruled, no §7 delta
  is claimed replica-applicable.

### v0.8 Spec-gap notes from G2-A fix round 1

- GraphRowKeyV1.id is the physical `_id`, never an application identity.
- A required equality-to-one miss materializes `SNAPBACK_GRAPH_REQUIRED_EDGE_MISSING` in the evaluation-time register and is classified 4xx.
- Through-edge filters apply to the edge range before target resolution; target-row predicates belong to target nodes.
- Graph interval ends honor inclusive/exclusive boundary comparison, and backward traversal reverses declared order components while retaining the ascending physical `_id` tie within equal keys.

## Revision history

- **v0.7 (2026-08-24).** **Author ratification** (Charlie Cheever, 2026-08-24
  session): (1) the mechanical identity choices are ratified as landed — the
  six graph hash domains, the unit `CapturedReadKind::GraphNode` with its
  enforced sibling `graph` payload, `KeysetKeyV1` wire-identical to kernel
  `KeysetAfter`, and the ruled logical-now/physical-at-G2 bound split
  (LLP 0267 observed-value consumption for graph plans begins at G2);
  (2) the fixture-derived bound table (§9 exit note;
  `tests/conformance/graph/bound-derivation.v1.json`, content digest
  `sha256:3e2f942c…a59430`) is **ratified provisionally** — the declared
  values stand now, and every entry marked `provisional` is confirmed or
  revised when the zb5 large-fixture validation runs (command in the
  derivation record); a revision is an ordinary amendment, not a
  retroactive invalidation. The "pending author ratification (v0.6)"
  labels in the exit note are discharged by this entry. Same-day
  commissions: **G2** (`issues/20260824-llp0209-g2-commission.md`) and the
  **LLP 0268 exit extension**
  (`issues/20260824-llp0268-exit-extension-commission.md`), running in
  parallel by author ruling.
- **v0.6 (2026-08-23).** **G0 exit recorded** (see §9 "Exit"). Stages A, B1, B2, B3 landed; checklist rows 1/2/5/9 COMPLETE, 3/4/6/7 PARTIAL, 8 NOT SATISFIED (only `G0-BCAST-IDENTITY` of the LLP 0268 §7 labels is satisfied; the exit must be extended and re-recorded before 0268 B1). Author ratification owed on: the six hash domains, `CapturedReadKind::GraphNode`, the headroom factors and the fixture-derived bound values (provisional where large-fixture maxima are unverified), and the logical/physical bound split. Status Draft → Review. Open follow-ups: `issues/20260823-graph-empty-child-demand-window-vector.md` (B1 hidden-root pair), `issues/20260823-graph-codegen-rust-admission-parity-gaps.md`, `issues/20260823-zerobugs-control-descending-tiebreak-deviation.md` (control-owned), the large-fixture spot check (zb5 rerun), and the 0267/0268 drift requests listed in v0.5.
- **v0.5 (2026-08-23, Stage A).** Tightened G0 as a docs-only landing:
  §2 now fixes the normalized graph record, all seven node kinds and their
  edges/cardinalities, stable refusal precedence, plan/instance identity,
  contextual materialization identity,
  sibling `HandlerPlan::GraphQuery` lineage, and the complete
  `queryCost.graph` derivation skeleton; §3 fixes class proofs,
  partition-of-one roll-up, all nine LLP 0268 inputs, and paired-world row
  shape; §4 binds labels/proofs to nodes and defines graph composition; §5
  fixes `GraphNode` dependency capture and ledger fields; §9 separates Stage
  A, Stage B, and the v0.6 exit. Author ratification is requested only where
  marked: plan, instance, materialization, partition-function,
  authority-partition, and broadcast-scope hash
  domains; one tagged graph captured-read variant; and the fixture headroom
  factor `H` plus the resulting logical bound table (including the packet's
  1,024-root, 16-label-edge, and zero-maintained-write candidates); the
  commission-ruled declaration/observation split and closed physical-bound
  function are recorded for author ratification at exit. Stage B
  fills the fixture/oracle-derived logical values, analytically declares
  physical values for G2 measurement, and supplies identity vectors, declarations,
  admission/refusal implementation, broadcast certificates, and frozen
  corpus. The commissioning packet's two exit mentions move from v0.5 to
  **v0.6** so v0.5 can name this prerequisite Stage A revision. Status stays
  Draft; no runtime semantics or capability claim changes.
  - **Fix round 1 — M1:** §2.1/§2.4 replace the singleton window with the canonical demand-paged-node vector and per-parent child interval keys.
  - **Fix round 1 — M2:** §2.4 removes `priorLedger` from identity and assigns one beside-cursor ledger lineage per demand-paged node.
  - **Fix round 1 — M3:** §2.1 defines the unique emit-then-recurse preorder DFS and pins a three-node id example.
  - **Fix round 1 — M4:** §2.3/§3.3 make `baseNodeIds` host-recomputed over every §4.2 input and refuse unreachable or inert nodes.
  - **Fix round 1 — M5:** §2.6/§3.3 make G0 broadcast bounds declaration plus exit observation, leaving hard group-state/frame/handoff fields to LLP 0268 B1 via LLP 0267.
  - **Fix round 1 — M6:** §2.3 separates manifest admission refusals from corpus/fixture qualification failures.
  - **Fix round 1 — M7:** §5.1 closes nullable point-miss and argumentless/multiplicative membership dependency spellings.
  - **Fix round 1 — M8:** §2.1 closes the complete wire grammar and §2.5 adds only a fail-closed not-executed matcher arm before G2.
  - **Fix round 1 — M9:** §3.4 adds seven closed corpus case kinds and §3.3 maps every LLP 0268 label to them.
  - **Fix round 1 — M10:** §9 fixes per-query oracle field maps, declared-result comparison, justified envelope exclusions, and continuation semantics.
  - **Fix round 1 — M11:** §2.4 wraps instance identity in the LLP 0157 contextual materialization namespace used by broadcast/cross-process sharing.
  - **Fix round 1 — author ruling:** §2.6/§9 derive logical bounds from fixture/oracle facts, physical bounds analytically with `[G2 measures]`, and defer LLP 0267 graph observations to G2.
  - **Fix round 2 — R1:** §2.3 establishes ordered admission, demand-time, and qualification registers and splits plan from demand identity mismatch.
  - **Fix round 2 — R2:** §2.1/§2.2 bind every projection object to lexical row scope, pin correlation and emitted order, and add the worked issue/labels/label example.
  - **Fix round 2 — R3:** §3.4 adds reusable complete invocation records, discriminated non-materializing refusals, per-node proof classes, and composed graph completeness.
  - **Fix round 2 — R4:** §9 replaces exact oracle labels with closed reason-sensitive translations and dispositions every outer status/reason field.
  - **Fix round 2 — R5:** the G0 commission packet is minimally reconciled to the three-layer identity, qualification timing, one matcher arm, and ruled bounds posture.
  - **Fix round 2 — R6:** §2.1/§2.4/§2.6 move window maxima per demand-paged node, bind each ledger to its node interval vector, and exact-check a summed rollup.
  - **Fix round 2 — R7:** §2.3/§2.6 pin the unique analytical physical-bound function, index-prefix refusal, and numeric `issueDetail` candidate calculation.
  - **Fix round 2 — MINOR:** the plan broadcast tag, demand order identity, allowed-result expectation, sole result-byte check, keyset placement, join direction, SHA pattern, DFS example, and history figures are closed.
  - **Fix round 3 — F1:** §2.1/§3.4/§4 replace arbitrary completeness payloads with node-kind/label proof unions, a closed existence-bit index, and exact graph-composition citations.
  - **Fix round 3 — F2:** §2.1/§2.3/§3 separate evaluation-time materialized refusals, non-materializing refusal cases, successful query-shaped non-eligibility, and counterfeit broadcast certificates.
  - **Fix round 3 — F3:** §9 makes oracle translation keys discriminate cursor/row state and maps the null-cursor/empty-comments ceiling to the evaluation-time cost refusal.
  - **Fix round 3 — F4:** §2.6 hashes only plan maxima, counts every point/range/through consultation, derives `maxIndexRanges` identically, and separates the `take=50` demand check.
  - **Fix round 3 — F5:** §2.1/§2.4/§3.1 define, place, normalize, hash, and host-recompute `GraphPartitionEquivalenceProofV1` for every class-2 node.
  - **Fix round 3 — F6:** §3.4/§9 freeze the backward tied-key oracle divergence disposition without changing the D1 control and require B3's follow-up ticket at exit.
  - **Fix round 3 — F7:** §2.3 makes admission row 1 manifest-decidable and qualification failures a complete unordered-by-precedence set.
  - **Fix round 3 — rulings/minor:** §2/§9 and the commission packet pin the `KeysetKeyV1` placement/conversions, rewritten filter argument ids, conservative byte rollup, nested-object refusals, kind-conditional cost presence, resolved OQ-1 heading, materialization tuple, and per-node window wording.
  - **Fix round 4 — G1:** §2.1 makes `KeysetKeyV1.entries` the kernel's ordered field/value tuple array, pins its tuple schema, and requires Stage B kernel round-trip vectors.
  - **Fix round 4 — G2:** §2.6 counts every access-path consultation in `maxIndexRanges`/`maxWindowIndexRanges`, re-derives `issueDetail`, and records the triggered LLP 0267 512-absolute drift.
  - **Fix round 4 — G3:** §2.6 gives `ThroughEdgeV1` one edge-range-plus-target-point function and explicit examined/lookup/range formulas without a second `C` multiplication.
  - **Fix round 4 — G4:** §2.6 defines `P(node)`, consultations, entries including `cap + 1`, and all derived physical/window fields in one four-step function.
  - **Fix round 4 — G5:** §2.1/§3.4/§4 split proof arms by literal `(kind,label)`, key equality/principal/semi-join evidence per parent, and remove flat corpus existence bits.
  - **Fix round 4 — G6:** §2.1/§3.4/§4 replace the ambiguous completeness `version` with closed authorization-version and evaluation-cut axes throughout node, projection, composition, and corpus proofs.
  - **Fix round 4 — G7:** §2.1/§2.3/§4 restrict materialized refusal proofs/results to demand-time and evaluation-time reasons and leave admission reasons only in non-materializing refusal cases.
  - **Fix round 4 — G8:** §2.1/§2.3/§3.3 add the precedence-23 `SNAPBACK_GRAPH_BROADCAST_BASE_CLASS_INVALID` refusal for counterfeit class-2/3 broadcast certificates.
  - **Fix round 4 — MINOR:** §2/§3/§4/§9 pin the partition-function preimage, query-shaped precedence, dotted oracle cursor/row bindings, source-id-to-`_id` normalization, mandatory root continuation, per-node lookup vector, graph proof-class derivation, and this history.
  - **Fix round 5 — H1:** §2.1/§4 use `GraphRowKeyV1` for every completeness parent and require JCS-byte parent ordering with complete, duplicate-free coverage.
  - **Fix round 5 — H2:** §2/§4/§9 keep declared `order` and `KeysetKeyV1.entries` free of `_id`; the separate `id` carries the implicit ascending tie-break in continuations and interval ends.
  - **Fix round 5 — H3:** §2.4/§2.6 charge every demand-paged lineage for its page-induced subtree's structural work and re-derive the root example as `43 + C_comments` scanned entries and 26 ranges.
  - **Fix round 5 — H4:** §2.6/§5.1 distinguish direct semi-join range/unique-point access, optional principal binding points, and storage-free null-key to-one attempts.
  - **Fix round 5 — H5:** §6 keys graph memos on materialization, partition, authorization-version, and evaluation-cut axes and retires stale authorization versions. This tightens G1's shipped key description without changing the session-exact, pre-G0 G1 mechanism.
  - **Fix round 5 — MINOR:** §2.1/§4/§9 pin evaluation-cut integer schema, demand-vector resume for a to-many named window, outer oracle cursor/row bindings, the commission packet's four-axis completeness tuple, and this history.
  - **Fix round 6 — J1 + MINOR:** §2.4/§2.6 restore LLP 0267's top-level `resultRows` and single whole-result `resultBytes` charge to every root or child lineage while keeping induced-subtree accounting structural; the worked example and `windowRollup` now expose the conservative repeated charge. §2.1/§2.6/§4.1/§9 pin vacuous principal binding evidence, worst-case-versus-observed null-key consultations, `ranges[].hasMore`, `parentKey`-only proof ordering, and kernel SQL tie-break ownership.
  - **Converged:** grok READY r6 and r7; codex READY r7 (both on this revision).
- **v0.4 (2026-08-23).** **G0 commissioned** (author ruling, Charlie
  Cheever, 2026-08-23 session: "worth commissioning G0 now"). Context: the
  fan-out P1 this Spec anchors is no longer minutes-scale — LLP 0200
  Phases 1–4 plus G1 took six-observer burst settle p50 45 s → 1.65 s —
  and the remainder is the per-turn opaque re-evaluation floor that only
  G2/G3 remove, both sequenced behind G0; LLP 0268 (Accepted) further
  binds its implementation on a recorded G0 exit carrying its §7 inputs.
  Packet: `issues/20260823-llp0209-g0-commission.md`. Three rulings it
  records against §9's G0 text: (1) **bounds are a lane deliverable, not
  an author gate** — the lane sizes every §2 bound from the pinned
  `normal-seed-v1` / `large-seed42-v1` fixtures with the derivation
  beside each value, carried in LLP 0267 §5's `queryCost.graph` fields,
  and the author ratifies the table at G0 exit (the packet records the
  first-cut derivation, including that the 1,024 summed-batch ceiling is
  already falsified even by the contextual means of a 1,000-row list × 2.00
  label edges (with 2.53 comments per issue also context; declarations use
  maxima, not means)); (2) **OQ-1 is
  applied as proposed in the packet and recorded by Stage A**; (3) **OQ-3 is
  taken conservatively at G0**
  (principal-scoped = partition of one). G0's exit record must
  additionally carry LLP 0268 §7's nine named inputs by label. G0 changes
  no runtime semantics and claims no latency effect; Status stays Draft
  until the G0 exit note (then called v0.5; renumbered v0.6 by the v0.5
  revision above) moves §2–§4 to Review.
- **v0.3 (2026-08-16).** G1 measured, and its shipped key recorded
  precisely. Two facts the D2-H1 run established:
  1. **The sound pre-G0 key is session-exact, not user-exact.** Opaque JS
     handlers can read `ctx.auth.sessionId` (and the full prepared
     projection), so LLP 0190 §4.3's complete-inputs standard forces every
     handler-visible authority field — session and authority-instance
     identity included — into the memo key (two independent review
     families converged on this). Consequently "N identical same-principal
     subscriptions" shares only when the N subscriptions present the
     *same session*. E-3's six-observer spike shape as operationalized by
     the OQ4 harness minted six sessions of one user; that shape gains
     little (~15% evaluation-count reduction measured) and its collapse
     is a G0-era target: sharing across sessions of one principal
     requires declared inputs proving sessionId non-consumption. The
     harness gained `--observer-session shared|distinct` to measure the
     truly-identical shape.
  2. **D2-H1 on the shared-session arm (2026-08-16, N=2, regenerated
     era-stamped 5.5M-row fixture, memo on/off interleaved on one host):**
     per-turn evaluation duration p50 869 ms → 42 ms; total serialized
     evaluation time 25.9 s → 10.7 s (2.4×, r2 pair; the r1 pair's
     memo-on arm paid cold page cache); one ~900 ms real evaluation per
     trigger version with the remainder memo hits (vs six real
     evaluations memo-off); mixed-partition arms byte-identical eval
     counts (47/47); 6-observer memo-on trigger settle p50 169–190 ms,
     inside 2× of the 1-observer arm (262–283 ms). Host-noise and
     store-era caveats recorded in the arm directories; the regenerated
     store's hot frames are ~5 MB (the 2026-08-08 store's 61–68 MB frames
     included burned-in diagnosis history), so byte-scale claims must
     requalify on a burned-in store. Kill switch
     `SNAPBACK_LIVE_EVAL_MEMO_DISABLED=1` is the control arm; memo
     entries are drain-cycle-scoped; oversize results are refused
     clone-free with a 256 MiB budget sized to the measured hot shape.
- **v0.2 (2026-08-15).** G1 same-principal live-evaluation memoization landed.
- **v0.1 (2026-08-09).** Initial draft per
  `issues/20260808-d2-d4-owner-specs-commission.md`, grounded in the OQ4
  spike disposition and LLP 0200 §6a. Before landing, one informal
  read-only pre-landing review pass from a second model family (Codex,
  gpt-5.6-sol, 2026-08-09) was taken on the draft; its corrections were
  folded into this same v0.1: skip-*rate* (not set) phrasing in E-2,
  honest E-4 attribution of the unmet H-1 to scheduling policy × turn
  cost, the plan/instance identity split (§2), paired-world proof rows
  for the §3 classification, the G0 bound-sizing exit and the LLP 0183
  §D2 capability-publication gate (§9), G1 narrowed to same-principal
  dedup pre-classification, and the §8/OQ-6 replica-continuity boundary.
  This was one informal pass, not a super-refine loop — the author runs
  that separately if wanted.
