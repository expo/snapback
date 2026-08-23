# LLP 0209: The bounded live graph profile — precision, shared evaluation, and incremental maintenance (the D2 owner-Spec)

**Type:** Spec
**Status:** Draft
**Systems:** Live queries, Relational queries, Schema, Auth, Performance, Client SDK
**Author:** Claude Fable 5 (commissioned by the LLP 0191 author rulings, Charlie Cheever, 2026-08-08)
**Date:** 2026-08-09
**Revised:** 2026-08-23 (v0.5, Stage A — the G0 graph IR, identity,
authorization proofs, completeness composition, dependency vocabulary,
bounds derivation, broadcast inputs, and exit checklist are concrete; code
and fixture measurements remain Stage B; Status remains Draft)
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
`TableVisibilityV1`, `KeysetAfter`, `ArgumentBindingContractV1`,
`CanonicalClientValueV1`, and `ExpectedGenerationV1`. Stage B may not create
graph-local look-alikes or choose another optional/null spelling.

```ts
type Sha256V1 = `sha256:${string}`
type GraphAuthorityClassV1 = 1 | 2 | 3
type GraphDirectionV1 = "forward" | "backward"

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
      key: KeysetAfter
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

type GraphProjectionLiteralV1 = null | boolean | string | number

type GraphProjectionObjectV1 = Readonly<{
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
      nodeId: string
      item: GraphProjectionObjectV1
    }>
  | Readonly<{ kind: "exists"; nodeId: string }>

type GraphNodeV1 =
  | Readonly<{
      nodeId: string
      kind: "root-window"
      edgeName: "$root"
      authorityClass: GraphAuthorityClassV1
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
      authorityClass: GraphAuthorityClassV1
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
      authorityClass: GraphAuthorityClassV1
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
      authorityClass: GraphAuthorityClassV1
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
      authorityClass: GraphAuthorityClassV1
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
      authorityClass: 3
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
      authorityClass: GraphAuthorityClassV1
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
      authorityClass: GraphAuthorityClassV1
      object: GraphProjectionObjectV1
    }>

type GraphNodeCostV1 = Readonly<{
  nodeId: string
  maxRootRowsPerPage?: number
  maxExaminedEntriesPerExecution: number
  maxRelationshipLookupsPerExecution?: number
  maxChildrenPerParent?: number
  maxArgumentExpansion?: number
}>

type GraphQueryCostV1 = Readonly<{
  nodes: readonly GraphNodeCostV1[]
  arguments: readonly Readonly<{
    argumentId: string
    maxItems: number
  }>[]
  maxArgumentItems: number
  maxResultBytes: number
  maxPageResultBytes: number
  maxWindowPages: number
  maxWindowRootRows: number
  maxWindowScannedRows: number
  maxWindowResultRows: number
  maxWindowResultBytes: number
  maxWindowIndexRanges: number
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
      reason: string
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
  broadcast: GraphBroadcastAdmissionV1 | null
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
  order: readonly OrderExpr[]
  direction: GraphDirectionV1
  lower: GraphIntervalEndV1
  upper: GraphIntervalEndV1
  take: number
}>

type GraphRowKeyV1 = Readonly<{ table: string; id: string }>
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
artifact before admission. A search node's `authorityClass` and
`providerCompletenessClass` must exact-match the same fields nested in
`membershipIdentity`; its canonical `argumentIds` and `scopeBindings` must
reproduce `argumentContractHash` and `scopeContractHash`, and the provider
certificate must reproduce `providerPlanHash`, `providerVersion`, and
`membershipHash`.

Projection output cardinality is closed: the top-level result is one ordered
array entry per root row, and `object` describes that entry. A `field`,
`literal`, or `exists` produces exactly one value in its enclosing object.
Nested `object` may reference only `equality-to-one` or `principal-bound` and
produces one object on a hit, literal `null` on an admitted optional miss, and
refusal on a required miss. `array` may reference only `bounded-to-many` and
produces exactly one array with zero through that node's declared bound items.
`exists` may reference only `exists-semi-join` and produces one boolean.
Projection field names are non-empty, unique within an object, and in RFC 8785
UTF-16 code-unit order; the literal payload is exactly the adjacent scalar or
`null`, never executable code, an omitted value, or a nested open JSON value.

The compiler, not the author, assigns dense `nodeId` values by one unique
preorder DFS: emit the current non-projection node immediately; recurse into
its owned children sorted by RFC 8785 UTF-16 code-unit `edgeName` order; after
the root subtree is exhausted, emit the sole projection node last. The emitted
preorder index is the id: `n0`, `n1`, ... . For a three-node graph whose root
`$root` owns one `comments` child and whose projection is `$result`, the walk
emits `$root → n0`, `comments → n1`, `$result → n2`. `edgeName` is required
and unique among one parent's children. This makes source declaration order
irrelevant while retaining stable diagnostics. All node references use the
recomputed ids.

Arguments sort by RFC 8785 UTF-16 code-unit `name` order; after sorting, the
compiler assigns `argumentId` values `a0`, `a1`, ... and the host recomputes
them. `contract` and `contractHash` reuse LLP 0157 §D2's
`ArgumentBindingContractV1`. A collection requires the matching
`queryCost.graph.arguments` entry in §2.6; a scalar forbids one. A collection
without that `maxItems`, or with a `maxItems` larger than its argument-contract
maximum, refuses. No runtime argument value is present in a plan.

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
`edgeName`, and `authorityClass`. Any node that directly reads one declared
application table, rather than reading through `edge` or an owner-issued
provider certificate, additionally requires `table`, `accessIndex`, and an
explicit `visibility: TableVisibilityV1`; public read is represented as
`{kind:"public-read"}`, not omission. Bounds exist only in the
`queryCost.graph` records in §2.6, keyed by `nodeId`; they are not node
fields. `FilterExpr[]` is a conjunction.
`OrderExpr[]` is semantic order; the compiler appends ascending `_id` when it
is absent and rejects an authored non-ascending `_id`. This applies LLP 0007's
total-order rule and reuses the shipped `KeysetAfter {entries,id}` boundary
(`crates/snapback-kernel/src/storage.rs:8004`).

In the table, `new` means new to `graph_query_v1`; all unqualified names are
literal normalized-record field names. “Dependency” names refer to §5.

| Kind | Required fields | Optional fields | Reuse/new | Cardinality and edge rules | Exact `queryCost.graph` declarations | §5 dependencies | Allowed authority class |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `root-window` | common fields; `table`; `visibility`; `filters`; `accessIndex`; non-empty `order`; `page:{kind:"demand"}` | none | `FilterExpr`, `OrderExpr`, `TableVisibilityV1`, and `KeysetAfter` reused; demand page and named interval ends new | Exactly one; no parent; every non-projection node is reachable from it; maximum child-node count is its immutable normalized out-degree; the demand supplies `take`/direction/ends and contributes the mandatory root entry to §2.4's window vector | `maxRootRowsPerPage`; node `maxExaminedEntriesPerExecution`; whole-query `queryCost.maxScannedRows`; collection inputs also use the argument fields below | root range `Query`, returned `Row`, point-shaped `MissingRow`, `GraphNode.RootRange` | 1, 2, or 3 when §3 proves it |
| `equality-to-one` | common fields; `parentNodeId`; `table`; `visibility`; ordered non-empty `joinOn`; unique `accessIndex`; `presence: "required" \| "optional"` | `filters` | `JoinEquality`, `FilterExpr`, `TableVisibilityV1` reused; `parentNodeId`/`presence` new | Child of root, to-one, to-many, or principal-bound; one incoming edge; zero or one child row per parent, statically proved by the complete unique-index key; maximum child-node count is its immutable normalized out-degree | node `maxExaminedEntriesPerExecution`; `maxRelationshipLookupsPerExecution`; no `maxChildrenPerParent` (fixed one) | point `Row`/`MissingRow`, `GraphNode.ParentEdge` | 1, 2, or 3 when §3 proves it |
| `bounded-to-many` | common fields; `parentNodeId`; `table`; `visibility`; ordered non-empty `joinOn`; `accessIndex`; non-empty `order`; `page` | `filters` | shipped expressions/visibility/keyset reused; parent-indexed edge and per-parent page new | Child of root, to-one, to-many, or principal-bound; one incoming edge; maximum child-node count is its immutable normalized out-degree; emitted rows per parent are at most the node's `maxChildrenPerParent`; `page:{kind:"literal",direction,lower,upper,take}` is wholly plan-literal and adds no demand identity, while `page:{kind:"demand"}` supplies all four values per parent and adds one keyed §2.4 vector entry for the node; no mixed spelling exists | node `maxExaminedEntriesPerExecution`; `maxRelationshipLookupsPerExecution`; `maxChildrenPerParent`; demand-paged nodes also declare the summed-window tuple | per-parent range `Query`, returned `Row`, empty range, `GraphNode.ParentRange` | 1, 2, or 3 when §3 proves it |
| `exists-semi-join` | common fields; `parentNodeId`; `mode: "exists" \| "all"`; `edge: DirectEdgeV1 \| ThroughEdgeV1` | `filters`; `argumentId` only for `all` | `JoinEquality`, `FilterExpr`, `TableVisibilityV1` reused; bounded repeated existence and `ThroughEdgeV1 {table, visibility, parentJoin, targetTable, targetVisibility, targetJoin, parentIndex, targetIndex}` new | Predicate child of root or another result-bearing relation; leaf, so maximum child-node count is zero; contributes no result row unless projection uses its `exists` bit; `all` requires one bounded collection `argumentId`, probes each distinct canonical item once, and uses no vacuous hidden-row shortcut; a through table must be named in `ThroughEdgeV1` | node `maxExaminedEntriesPerExecution`; `maxRelationshipLookupsPerExecution`; `maxChildrenPerParent`; `all` also declares argument `maxItems`, graph `maxArgumentItems`, and node `maxArgumentExpansion` | ordinary membership `Query` including empty ranges, `GraphNode.Membership`; never `Permission` | 1, 2, or 3 when every edge and predicate has that proof |
| `principal-bound` | common fields; `parentNodeId`; `table`; `visibility`; `parentJoin`; `principalField`; unique `accessIndex`; `principalSource: "auth.userId"` | `binding: {table, visibility, principalField, valueField, uniqueIndex}` only when the target stores an app-user id instead of `v.principal()`; `filters` | table/filter/visibility/join reused; server-principal source and optional declared binding new | Child of root, to-one, or to-many; maximum child-node count is its immutable normalized out-degree; exactly zero or one row per `(principal,parent)` from the complete unique index; the optional binding is one unique point step and may not be caller-selected. This covers Zerobugs' `identityBinding` plus private `viewState`/notification rows (`demos/zerobugs/control/snapback/schema.mjs:149`, `demos/zerobugs/control/snapback/schema.mjs:70`, `demos/zerobugs/control/snapback/schema.mjs:134`) | node `maxExaminedEntriesPerExecution`; `maxRelationshipLookupsPerExecution`; fixed fanout one | `Auth`, binding/target `Row` or `MissingRow`, `GraphNode.PrincipalField` | 3 only |
| `search-membership` | common fields; `parentNodeId`; `providerCapabilityId`; `membershipIdentity`; `memberField`; `scopeBindings`; non-empty `invalidationTables`; `providerCompletenessClass` | `argumentIds` | parent field binding reused; provider certificate, membership identity, and invalidation tables new; the graph never embeds or evaluates search text | Predicate child of root only in v1; leaf, so maximum child-node count is zero; one admitted membership input may filter the root; no nested search, result hydration, or search implementation; the provider certificate binds plan, arguments, scope, authority class, version, and completeness | node `maxExaminedEntriesPerExecution`; `maxRelationshipLookupsPerExecution`; collection args use `maxItems`, `maxArgumentItems`, `maxArgumentExpansion` | `GraphNode.SearchTable` for every declared table; always table-granular in G0/G2 | exactly the class in the owner-issued provider certificate: 1, 2, or 3 |
| `closed-projection` | `nodeId`; `kind`; `edgeName`; `object: GraphProjectionObjectV1`; `authorityClass` | none | closed nested projection new; scalar leaves reuse shipped result-value contracts and `resultContractHash` | Exactly one and last; no table and no children. Object fields sort by RFC 8785 UTF-16 code-unit name order and use §2.1's exact `field {nodeId,field}`, `literal {value}`, `object {nodeId,object}`, `array {nodeId,item}`, or `exists {nodeId}` arms. Every reference must be reachable; arrays may reference only to-many nodes; undeclared fields and open objects refuse | no independent bound; its serialized whole result consumes `maxResultBytes`/`maxPageResultBytes` and the summed-window byte/row fields | no storage read; `GraphNode.Projection` links source node ids for ledger composition | maximum class of every referenced or predicate-affecting node; author cannot declare it lower |

Every non-root, non-projection node has exactly one `parentNodeId`, so the
owned node edges form a rooted tree. The §2.1 walk rejects a back edge before
assigning ids; projection references do not add ownership edges. “Normalized
out-degree” above is the exact count of statically declared children in that
tree, not a runtime/data-dependent value and not a second work-bound carrier.

`DirectEdgeV1` is the closed record `{table, visibility, joinOn,
accessIndex}`. `ThroughEdgeV1` is the exact record shown in the table; both
join lists preserve index-component order. A direct or through edge with an
unproved index, cardinality, table policy, or nominal id domain refuses; it
never degrades to a scan.

### 2.3 Closure, admission refusals, and qualification failures

**Admission refusals** are decidable from the candidate manifest, installed
schema, and installed policy declarations alone. Admission evaluates the
following rules in the listed order. The first miss is the public `refused`
reason; later misses may be value-free diagnostic notes. These identifiers and
their precedence are part of the v1 conformance contract.

| Order | Refusal reason | Exact refused condition |
| ---: | --- | --- |
| 1 | `SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN` | A runtime/client argument supplies a node, field, filter, order, projection, table, index, or operator rather than a value for a declared argument slot. |
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
| 16 | `SNAPBACK_GRAPH_ORDER_NOT_TOTAL` | An order is empty where required, uses an unportable field/direction, or cannot end in the canonical ascending `_id` tie-break. |
| 17 | `SNAPBACK_GRAPH_CURSOR_UNBOUND` | A keyset cursor/window cannot bind plan, canonical non-window args, authority partition, its demand-paged node, stable per-parent intervals, order, direction, boundary, and §2.6 cumulative ledger lineage. |
| 18 | `SNAPBACK_GRAPH_PROJECTION_OPEN` | A projection is open, references an unprojectable field/node, uses a to-one as an array or to-many as a scalar, or fails the exact result contract. |
| 19 | `SNAPBACK_GRAPH_PRINCIPAL_BINDING_UNPROVABLE` | A principal node accepts caller identity, lacks a unique declared binding, or cannot prove the target principal field from `auth.userId`. |
| 20 | `SNAPBACK_GRAPH_SEARCH_UNADMITTED` | A search input lacks an owner-issued provider identity/class/completeness/invalidation certificate or attempts graph-side search evaluation. |
| 21 | `SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE` | §3 cannot prove the declared class and complete authority inputs for every node. |
| 22 | `SNAPBACK_GRAPH_BROADCAST_SEPARATION_UNPROVABLE` | A broadcast candidate's establishment predicate reaches result membership/projection/order/length/existence/completeness or produces an overlay. |
| 23 | `SNAPBACK_GRAPH_BROADCAST_SCOPE_UNBOUND` | A broadcast candidate lacks §3.3's same-instance canonical-argument/resource equality proof. |
| 24 | `SNAPBACK_GRAPH_BROADCAST_AUDIENCE_UNPROVABLE` | Its establishment deny-set is not proved equal to the strict fail-closed audience at the same instance/version. |
| 25 | `SNAPBACK_GRAPH_BROADCAST_INVALIDATION_INCOMPLETE` | Any establishment input lacks a declared authorization-event-to-affected-scope mapping. |
| 26 | `SNAPBACK_GRAPH_BOUND_INVALID` | A bound is zero where work is required, exceeds its argument/result contract, overflows checked arithmetic, or conflicts with another bound. |
| 27 | `SNAPBACK_GRAPH_RESULT_CONTRACT_MISMATCH` | The projection and host-recomputed `resultContractHash` do not describe the same exact serialized result. |
| 28 | `SNAPBACK_GRAPH_IDENTITY_MISMATCH` | Emitted normalized plan, plan hash, instance/materialization record or hash, or authored `baseNodeIds` differs from host reconstruction. |

**Qualification failures** require corpus, fixture, or observation artifacts
that manifest admission cannot see. They block G0 exit and every capability
publication, but do not retroactively turn a structurally admitted manifest
into an admission refusal. They have stable ids but no precedence relative to
the admission ladder:

| Qualification failure | Exact failed condition |
| --- | --- |
| `SNAPBACK_GRAPH_QUALIFICATION_DERIVATION_MISSING` | An applicable declared bound lacks the required fixture/oracle derivation or normalized-plan analytical derivation and its required G0/G2 observation posture. |
| `SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH` | A paired-world, allow/deny, audience, scope, transition, mixed-commit, oracle-parity, or refusal row falsifies the admitted static class/broadcast/result certificate. |

### 2.4 Plan, instance, and contextual materialization identity

The normalized plan preimage is exactly the `GraphQueryPlanV1` record in
§2.1, with these canonicalization rules:

1. Unknown/omitted-default fields are impossible: the host materializes every
   required field and exact tagged-union spelling before hashing.
2. Nodes and ids are recomputed by §2.1's traversal. `FilterExpr`
   conjunctions sort by their individual RFC 8785 JCS bytes. `JoinEquality`
   and `OrderExpr` arrays preserve index/semantic order. Projection object
   fields and arguments sort by RFC 8785 UTF-16 code-unit name order.
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
   per-node authority classes and the roll-up rule, the broadcast admission
   record or explicit `null`, capability id, and `resultContractHash`. The
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
tuple `(parentKey, KeysetAfter.entries order values, KeysetAfter.id)`. Both
decoded, schema-validated interval ends, including the `_id` component in each
bounded end, are recorded in `window`; opaque cursor bytes never enter an
identity.

The instance hash is SHA-256 over `snapback:graph-instance:v1:` plus the
`GraphInstancePreimageV1` JCS, rendered in the same digest spelling.
**[author-ratify]** A separate instance domain makes a plan hash impossible to
substitute as demand identity. Reordering the node vector, omitting one
demand-paged child, changing one parent key, boundary order value, `_id`,
direction, or `take`, or adding a literal-paged child all fail exact
reconstruction; the last case fails because the plan hash, not the vector,
rotates.

`QueryCostWindowLedgerV1` is not identity input. It rides beside the opaque
cursor and is authenticated against generation, plan hash, args digest,
authority partition, target, and the stable `GraphWindowIdentityV1`, exactly
as LLP 0267 §5 requires. There is one independent ledger lineage per
demand-paged node—one for the root and one for each demand-paged child—and a
child lineage cumulatively charges every per-parent interval in that node's
vector entry. The root lineage charges all six counters; a child lineage keeps
`rootRows` at zero and charges its page/result/scan/range counters over the
child intervals. This extends LLP 0267 §5's singular one-window wording; no
ledger counter can rotate an otherwise equal window or instance identity.

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
value; and the partition/version/cut close the remaining owner-derived inputs.
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

`queryCost.graph` is the sole carrier. In particular, these fields are not
duplicated in `GraphQueryPlanV1` under another `bounds` or `g0Bounds` key.
Per-node and per-argument fields exist only in the keyed entries below, never
directly on `GraphNodeV1` or `GraphArgumentV1`; graph/window fields live in the
same closed object. Kind-inapplicable optional fields must be absent, and every
kind-applicable field must be present. The exact type is in §2.1.

`nodes` is in canonical §2.1 node order and omits only the projection;
`arguments` is in canonical argument order and contains collection arguments
only. Argument cardinality is zero for an absent optional, array length for an
array, and one for every other canonical value, including `null` and objects;
`maxArgumentItems` sums every top-level argument once.

**G0 declaration/observation ruling [author-ratify].** G0 declares every
applicable field. Because Stage B has no graph executor, it does not claim to
observe physical per-node work. Logical bounds are derived from fixture facts
and opaque-oracle results, which Stage B can observe without executing a graph:
`maxRootRowsPerPage`, `maxChildrenPerParent`, `maxItems`,
`maxArgumentItems`, `maxArgumentExpansion`, `maxResultBytes`,
`maxPageResultBytes`, `maxWindowPages`, `maxWindowRootRows`,
`maxWindowResultRows`, `maxWindowResultBytes`, and
`maxMaintainedWritesPerMutation` (exactly zero at G0). Physical bounds are
declared analytically from normalized plan shape:
`maxExaminedEntriesPerExecution`,
`maxRelationshipLookupsPerExecution`, `maxWindowScannedRows`,
`maxWindowIndexRanges`, and whole-query `queryCost.maxScannedRows`; every one
is marked **[G2 measures]**. LLP 0267's observed-value consumption for graph
plans begins at G2, when an executor exists.

The analytical declaration is deterministic: the host computes the maximum
attempted parent population recursively from root `take`, every ancestor
fanout, and distinct argument expansion; charges one relationship lookup per
attempted edge, including null-key attempts; bounds a node's examined entries
by its maximum consultations times the index-bounded entries per consultation;
and checked-sums node examined bounds into the sole whole-query
`queryCost.maxScannedRows`. That rollup is **not** duplicated inside
`GraphQueryCostV1`. Window scan and range declarations multiply the applicable
per-page analytical maxima by the declared maximum pages using checked
arithmetic. Any shape for which these maxima cannot be derived refuses
admission; G2 observations must fit them before publication.

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
| `maxRelationshipLookupsPerExecution` | Attempted edge resolutions, including null/omitted keys | every relationship, semi-join, principal, and search node | Host analytical maximum from attempted parent population × distinct argument expansion; one lookup per attempted edge | — | **[Stage B declares analytically; G2 measures]** |
| `maxChildrenPerParent` | Maximum authorized to-many or semi-join edge rows consumed for one parent | `bounded-to-many`, `exists-semi-join` | Measure the per-parent maximum, not mean, on both fixtures; max × H. Label edges are the first slice; comments remain a pageable child window | 16 for label edges **[author-ratify]** | **[Stage B fills]** |
| `maxItems` | Cardinality of one collection argument | each collection `GraphArgumentV1` | For each argument id (selected labels/assignees/projects and any later collection), max canonical array length in corpus cases × H, capped by its contract | — | **[Stage B fills]** |
| `maxArgumentItems` | Sum of all top-level argument cardinalities | graph | Per corpus invocation, apply the exact scalar/optional/array rule above and sum each argument once; maximum across fixtures × H | — | **[Stage B fills]** |
| `maxArgumentExpansion` | Product of distinct multiplicative collection arguments for one node | each expanding node | Host derives multiplicative argument ids from edges, observes their checked product (empty product one), and uses maximum across fixtures × H; reuse does not multiply twice | — | **[Stage B fills]** |
| `maxResultBytes` | One validated authored whole-result serialization | graph | Maximum exact `serde_json::to_vec` result bytes on normal/large full-window rows × H; do not use six-observer aggregate frame bytes | — (packet's ~10–11 MiB is scale evidence, not an exact value) | **[Stage B fills]** |
| `maxPageResultBytes` | One keyset page's validated result bytes | every pageable graph | Maximum exact page bytes on normal/large/hot, including the 1,000-root hot page, × H | — | **[Stage B fills]** |
| `maxWindowPages` | Published pages in one demand-paged-node ledger lineage | each demand-paged node | Count pages needed for the oracle to exhaust each named interval at declared page size; maximum × H, minimum one | — | **[Stage B fills]** |
| `maxWindowRootRows` | Cumulative authorized root rows across the root lineage | root demand page | Maximum checked cumulative oracle root rows for each named interval over both fixtures × H | — | **[Stage B fills]** |
| `maxWindowScannedRows` | Cumulative physical candidates across one node lineage | each demand-paged node | Checked analytical per-page scan maximum × `maxWindowPages` | — | **[Stage B declares analytically; G2 measures]** |
| `maxWindowResultRows` | Cumulative result rows across one demand-paged-node lineage | each demand-paged node | Maximum checked cumulative corresponding oracle rows for each named interval over both fixtures × H | — | **[Stage B fills]** |
| `maxWindowResultBytes` | Cumulative validated result bytes across one demand-paged-node lineage | each demand-paged node | Maximum checked cumulative corresponding oracle bytes over both fixtures × H | — | **[Stage B fills]** |
| `maxWindowIndexRanges` | Cumulative selected index-range consultations across one node lineage | each demand-paged node | Checked analytical per-page consultation maximum × `maxWindowPages` | — | **[Stage B declares analytically; G2 measures]** |
| `maxMaintainedWritesPerMutation` | Graph-owned maintained fact/index writes attempted for one source mutation | graph | G0 has no maintained graph facts, so the exact observed and declared value is zero; G3 must amend it from mutation observations before maintenance | 0 | **[Stage B fills: 0]** |

The general `queryCost` fields `maxIndexRanges` and `maxResultRows` remain
applicable conjunctive aggregate ceilings, but they are not aliases for the
summed-window tuple and are not a ninth graph-bound family. Stage B derives
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
Stage B measures and proposes the graph's summed-window tuple rather than
copying it. The root candidate happens to equal the separate shipped
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

For class 2, an installed policy declaration must carry a closed
`GraphPartitionEquivalenceProofV1 {declarationId, scopeArgumentIds,
policyIdentity, permissionBacking, eventSelectors,
equivalence:"all-principals-in-scope"}`. The compiler accepts that proof only
when every policy leaf is scope-derived, `permissionBacking` names every table
whose writes can change the predicate, `eventSelectors` covers §3.2's event
universe, and no principal/session/grant/delegation value reaches result data.
A raw owner/membership visibility declaration is principal-relative and
therefore derives class 3 unless this stronger equivalence proof discharges
it. This conservative rule chooses a smaller sharing class because schema
membership alone proves access, not equal bytes for every principal in a
partition.

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
   unknown mapping refuses broadcast and falls back conservatively for a
   query-shaped graph.
2. Login/logout, user switch, session expiry/admin revocation, lease expiry,
   and grant/credential/token issue or end are authority-instance transitions.
   They rotate/end the owner-issued partition or retire the affected retained
   graph instance; LLP 0200 §2.4 applies the fail-closed fence and delivery
   gate before restoration. They are not relabelled as ordinary data writes.

Two subscriptions share an authority partition only when the partition digest
and current authorization version are byte-equal. Evaluation cut version
remains the separate third memo/completeness axis.

### 3.3 The nine LLP 0268 inputs and their carriers

`GraphBroadcastAdmissionV1` is a closed plan member. It is either
`{format, classification:"query-shaped", reason}` or a broadcast certificate
with `classification:"broadcast"`, `baseNodeIds`, and
`establishment`; its exact grammar is in §2.1. `baseNodeIds` is
host-recomputed, not author-supplied: it is the canonical node-order set of
**every** non-projection node that can affect bytes, membership, order, length,
existence bits, completeness label, refusal reason, or future delta
construction—exactly every §4.2 input. Every member must derive class 1. An
authored value that differs in membership or order refuses
`SNAPBACK_GRAPH_IDENTITY_MISMATCH`. An unreachable node refuses
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
at the same instance and authorization version. Failure classifies the graph
query-shaped with the applicable stable §2.3 reason; it never produces a
weaker broadcast certificate.

| LLP 0268 label | This Spec's carrier | Required §3.4 case kind(s) | G0 exit record must show |
| --- | --- | --- | --- |
| `G0-BCAST-CLASS` | §3.1 node certificates plus host-recomputed `GraphBroadcastAdmissionV1.baseNodeIds` | `pairedWorld`, `refusal` | Every complete delivered/delta-relevant §4.2 input derives class 1; no class 2/3, omitted, unreachable, or inert node; class-1 hidden worlds pass. |
| `G0-BCAST-SEPARATION` | `establishment.effect`, literal-null `overlayProjection`, compiler data-flow proof | `allowDeny`, `refusal` | Establishment decides join/deny only; any overlay/result reach refuses `SNAPBACK_GRAPH_BROADCAST_SEPARATION_UNPROVABLE`. |
| `G0-BCAST-SCOPE` | `establishment.scope` and its outer-materialization-bound owner scope identity | `allowDeny`, `scopeMismatch` | Canonical argument ordering, policy identity, normalization/hash vector, and P/Q-distinct scope vector. |
| `G0-BCAST-SCOPE-BINDING` | `resourceEqualities` from each delivered resource to same-materialization scope arguments | `scopeMismatch`, `refusal` | Executable equality passes; P-member/Q-instance mismatch refuses `SNAPBACK_GRAPH_BROADCAST_SCOPE_UNBOUND`. An argument-only membership check never qualifies. |
| `G0-BCAST-AUDIENCE` | `strictEvaluatorIdentity` plus exact-audience cases | `allowDeny`, `audienceParity` | For both pinned principals at one instance/version, establishment deny-set equals fresh strict evaluation; neither narrower nor broader scope passes. |
| `G0-BCAST-INVALIDATION` | `establishment.invalidation` plus §3.2 event selectors | `authorityTransition`, `mixedCommit` | Every predicate/policy input maps permission writes and authority transitions to affected scopes; both case kinds prove fence-before-delivery. |
| `G0-BCAST-IDENTITY` | §2.4 outer materialization plus args/window-vector/partition/version/cut identities | `pairedWorld`, `audienceParity`, `scopeMismatch`, `authorityTransition` | Rust/JS/host vectors reproduce hashes and equal complete identity tuples produce byte-identical results/labels/refusals within one context; a contextual-axis change rotates the outer identity. |
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

type GraphCorpusPlanV1 =
  | Readonly<{ kind: "plan"; normalizedPlan: GraphQueryPlanV1;
               planHash: Sha256V1 }>
  | Readonly<{ kind: "refusal"; reason: string }>

type GraphCorpusExpectedResultV1 =
  | Readonly<{
      kind: "result"
      resultBytes: string
      orderedRootIds: readonly string[]
      resultLength: number
      existenceBits: readonly boolean[]
      completeness: Readonly<{
        label: "unknown" | "complete" | "prefix" | "window"
        materializationHash: Sha256V1
        partitionHash: Sha256V1
        version: string
      }>
      refusalReason: null
    }>
  | Readonly<{
      kind: "refusal"
      resultBytes: null
      orderedRootIds: null
      resultLength: null
      existenceBits: null
      completeness: null
      refusalReason: string
    }>

type GraphPairedWorldCaseV1 = Readonly<{
  caseKind: "pairedWorld"
  id: string
  planOrRefusal: GraphCorpusPlanV1
  canonicalArgs: CanonicalClientValueV1
  windows: readonly GraphNodeWindowIdentityV1[]
  materialization: GraphMaterializationIdentityV1
  authority: Readonly<{ partition: string; authorizationVersion: string }>
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
  plan: GraphPlanIdentityV1
  canonicalArgs: CanonicalClientValueV1
  windows: readonly GraphNodeWindowIdentityV1[]
  materialization: GraphMaterializationIdentityV1
  authorizationVersion: string
  principals: Readonly<{ allowed: string; denied: string }>
  expect: Readonly<{ allowed: "admit"; denied: "deny";
                     deniedResultBytes: null }>
}>

type GraphAudienceParityCaseV1 = Readonly<{
  caseKind: "audienceParity"
  id: string
  plan: GraphPlanIdentityV1
  materialization: GraphMaterializationIdentityV1
  authorizationVersion: string
  principals: readonly [string, string]
  expect: Readonly<{
    establishment: readonly ["allow" | "deny", "allow" | "deny"]
    strict: readonly ["allow" | "deny", "allow" | "deny"]
  }>
}>

type GraphScopeMismatchCaseV1 = Readonly<{
  caseKind: "scopeMismatch"
  id: string
  plan: GraphPlanIdentityV1
  materialization: GraphMaterializationIdentityV1
  principal: string
  memberScopeArgs: CanonicalClientValueV1
  instanceScopeArgs: CanonicalClientValueV1
  authorizationVersion: string
  expect: Readonly<{
    classification: "query-shaped"
    reason: "SNAPBACK_GRAPH_BROADCAST_SCOPE_UNBOUND"
    resultBytes: null
  }>
}>

type GraphAuthorityTransitionCaseV1 = Readonly<{
  caseKind: "authorityTransition"
  id: string
  plan: GraphPlanIdentityV1
  materialization: GraphMaterializationIdentityV1
  principal: string
  beforeAuthorizationVersion: string
  commit: Readonly<{
    dataChanges: readonly []
    authorityEvents: readonly [GraphAuthorityEventSelectorV1,
                               ...GraphAuthorityEventSelectorV1[]]
    afterAuthorizationVersion: string
  }>
  observed: readonly Readonly<{
    ordinal: number
    kind: "fence" | "delivery"
    authorizationVersion: string
  }>[]
}>

type GraphMixedCommitCaseV1 = Readonly<{
  caseKind: "mixedCommit"
  id: string
  plan: GraphPlanIdentityV1
  materialization: GraphMaterializationIdentityV1
  principal: string
  beforeAuthorizationVersion: string
  commit: Readonly<{
    dataChanges: readonly [Readonly<{ table: string; rowId: string }>,
                           ...Readonly<{ table: string; rowId: string }>[]]
    authorityEvents: readonly [GraphAuthorityEventSelectorV1,
                               ...GraphAuthorityEventSelectorV1[]]
    afterAuthorizationVersion: string
  }>
  observed: readonly Readonly<{
    ordinal: number
    kind: "fence" | "delivery"
    authorizationVersion: string
  }>[]
}>

type GraphRefusalCaseV1 = Readonly<{
  caseKind: "refusal"
  id: string
  candidateManifest: CanonicalClientValueV1
  schemaFixture: string
  policyFixture: string
  phase: "admission" | "qualification"
  expect: Readonly<{ reason: string; resultBytes: null }>
}>
```

Only `pairedWorld` is the hidden-world class proof. Its two fixture worlds
have byte-identical schema, indexes, visible rows,
args/window, authority inputs, and logical data/authorization versions. They
differ only because `present` contains the listed rows that the asserted
authority cannot observe and `absent` deletes exactly those rows and their
wholly hidden dependent slice. The runner asserts identical result bytes,
order, length, existence bits, completeness tuple/label, and stable refusal
reason. A difference in any one is
`SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH`; timing is not claimed.

The other runners permit exactly the deltas their case kind names; they do not
reuse `pairedWorld`'s authority/version-equality precheck.

| Case kind | Closed pass condition |
| --- | --- |
| `pairedWorld` | The worlds differ only by the named wholly hidden slice and exact-match result bytes, order, length, existence bits, completeness tuple/label, and refusal reason. |
| `allowDeny` | At one materialization and authorization version the `allowed` principal establishes and receives the expected result, while `denied` is rejected before any result byte is produced. |
| `audienceParity` | Exactly two principals exercise allow and deny at one instance/version, and the two-entry establishment vector exact-equals the fresh strict-evaluator vector. |
| `scopeMismatch` | A principal who is a member of P presented to a Q materialization is classified query-shaped and refuses exactly `SNAPBACK_GRAPH_BROADCAST_SCOPE_UNBOUND`; no result byte is produced. |
| `authorityTransition` | Its one commit contains at least one authority event, advances `authorizationVersion`, and records a fence at the new version before any later delivery; no old-version delivery occurs after the commit. |
| `mixedCommit` | Its one commit contains at least one data change and one authority event, advances `authorizationVersion`, fences before any delivery, and delivers neither a data delta nor replacement under the old version. |
| `refusal` | The named admission or qualification phase returns exactly the stable expected reason and no result bytes; qualification reasons are limited to §2.3's qualification register. |

For an admitted case, every `expect` field is required and
`refusalReason:null`; for a refusal case, result bytes/order/length/existence
and completeness are `null`, while `refusalReason` is the required stable §2.3
identifier in both worlds. `hiddenSlice` entries sort by table then row id;
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
- `complete` — the entire named graph at one
  materialization/authority/version;
- `prefix` — only when ordering and continuation prove a stable prefix;
- `window` — a complete named interval without a whole-query claim;
- `refused` — with a stable reason.

Binding rules this Spec adds: every label is claimed *at* a
(materialization identity, authority partition, version) tuple and
is meaningless without it; `prefix` requires the declared order including
the tie-break plus a keyset continuation proof; a delta-maintained result
(§7) carries the same label it would carry freshly evaluated, enforced by
the §7 convergence assertion; and a local evaluator (§8) must reproduce
the label exactly or answer `unknown` — a downgraded label is honest, an
upgraded one is a conformance failure.

### 4.1 Per-node production rules

Every evaluator returns one `NodeCompletenessV1 {nodeId, label, proof}` for
every normalized node, in canonical node order. `proof` is `null` for
`unknown`, `{reason}` for `refused`, and otherwise names the outer
materialization hash, partition hash, version, interval ends,
terminal/source-exhausted bit, and
input/output `KeysetAfter` boundary where applicable. A claimed terminal is
an independently observed source/range end; reaching a cost or page bound is
never terminal.

| Node kind | Labels it may produce | Required proof |
| --- | --- | --- |
| `root-window` | `unknown`, `prefix`, `window`, `complete`, `refused` | `prefix`: interval begins unbounded at the declared order minimum, every emitted root is authorized before `take`, order includes ascending `_id`, and authenticated successor boundary resumes strictly after/before the last consumed root in the requested direction. `window`: both named interval ends are validated and the requested interval is exhausted. `complete`: both ends are unbounded and the root source is exhausted. `take:0` performs no read and is `unknown` unless independent source/interval exhaustion proves `complete`/`window`; it never mints a zero-progress continuation. |
| `equality-to-one` | `unknown`, `complete`, `refused` | One unique-index point resolution, including a captured `MissingRow`, is complete for every admitted parent at the tuple; visibility executes before presence/projection, so missing and invisible have the same public fact. |
| `bounded-to-many` | `unknown`, `prefix`, `window`, `complete`, `refused` | Apply the root-window proofs independently to every admitted parent's exact indexed range. `prefix` requires every nonterminal parent range to begin at its minimum and carry a successor; `window` requires complete named ends for every ranged parent; `complete` requires every parent range exhausted. One unproved parent makes the node `unknown`. |
| `exists-semi-join` | `unknown`, `complete`, `refused` | Every direct/through lookup, including empty ranges, is captured at one tuple. `all` additionally proves the complete deduplicated canonical argument set was checked and every item matched; hidden rows cannot alter the bit. There is no partial existence label. |
| `principal-bound` | `unknown`, `complete`, `refused` | Host principal, optional unique binding, and unique `(principal,parent)` point result/miss are all proved at one authority tuple. Absence for anonymous authority is complete only when the result contract declares the node nullable and no lookup is attempted. |
| `search-membership` | `unknown`, `complete`, `refused` | The owner-issued provider certificate names this membership/args/scope/partition/version and says its full membership input is complete. A provider prefix, stale epoch, absent certificate, or table-granular invalidation after the certificate yields `unknown` or the provider's stable refusal, never graph-minted `prefix`. |
| `closed-projection` | `unknown`, `prefix`, `window`, `complete`, `refused` | Exact result-contract validation plus §4.2 composition over every referenced or predicate-affecting node; projection itself adds no data proof. |

### 4.2 Graph composition

The projection's input set is every non-projection node, including nodes used
only by predicates. Its node label, and therefore the graph label, is the
following deterministic function of that set after exact result-contract
validation; an evaluator may not choose a more optimistic label:

1. Any refusal produces `refused(primaryReason)`. `primaryReason` is the first
   reason in §2.3 admission order, otherwise the first runtime node in
   canonical order; the reason is a stable `SNAPBACK_GRAPH_*` identifier or
   an explicitly imported owner code such as
   `SNAPBACK_QUERY_COST_BOUND_EXCEEDED`.
2. Otherwise, any `unknown` produces `unknown`.
3. Otherwise, if every input is `complete`, the graph is `complete`.
4. Otherwise, if every non-complete input is `window`, the graph is `window`;
   its proof is the canonical ordered vector of the named node intervals.
5. Otherwise, if every non-complete input is `prefix`, the graph is `prefix`;
   its proof is the canonical ordered vector of successor boundaries.
6. A mixture of `prefix` and `window` produces `unknown`: neither label alone
   states the mixed partial claim. Stage B pins this row in the corpus.

The projection node records that composed label last and cannot hide a
predicate-affecting node. A graph labelled `prefix` therefore has a stable
prefix at each partial sequence, not merely `rows.len() == take`; a graph
labelled `window` names every non-whole interval. The composed proof and label
are claimed only at the single
`(materialization identity, authority partition, version)` tuple.

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

type GraphParentPointDependencyV1 = Readonly<{
  kind: "parent-point"
  table: string
  index: string
  parentKey: GraphRowKeyV1
  lookupKey: readonly CanonicalClientValueV1[] | null
  childKey: GraphRowKeyV1 | null
  found: boolean
  rowVersion: number | null
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
        boundary: KeysetAfter | null
        complete: boolean
      }>
    | GraphParentPointDependencyV1
    | Readonly<{
        kind: "parent-range"
        table: string
        index: string
        parentKey: GraphRowKeyV1
        predicate: readonly FilterExpr[]
        order: readonly OrderExpr[]
        limit: number
        resultCount: number
        boundary: KeysetAfter | null
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
canonical node order. A `parent-point` hit requires `found:true`, non-null
`lookupKey`, `childKey`, and `rowVersion`; a miss requires `found:false`,
`childKey:null`, and `rowVersion:null`. An absent/null join component uses
`lookupKey:null` and still records that miss as a `MissingRow`-equivalent for
the `(nodeId,parentKey)` attempt; if a concrete unique key existed, the
ordinary sibling `MissingRow` is captured too. For `membership`, `mode:exists`
uses `argumentId:null` and the `argumentDigest` field must be absent;
`mode:all` requires the normalized non-null `argumentId` and its canonical
digest. `argumentDigest` is present if and only if `argumentId` is non-null.

| Node kind | Captured dependencies at execution |
| --- | --- |
| `root-window` | One `GraphNode.root-range` and the equivalent existing `Query`; one `Row` per returned versioned row; `MissingRow` as well when the statically point-shaped root misses. Boundary includes first/last total-order keys and complete/source-exhausted bit. |
| `equality-to-one` | One `GraphNode.parent-point` per attempted parent key, including null/omitted attempts; `Row` on hit, ordinary `MissingRow` on a concrete-key miss, and the graph `MissingRow`-equivalent above on a null-key attempt. The declared unique index and complete ordered join fields are present. |
| `bounded-to-many` | One `GraphNode.parent-range` and one existing `Query` per parent range, including zero-result ranges; returned versioned children contribute `Row`. Each range carries its own predicate/order/limit/count/boundary, so one parent cannot shadow another. |
| `exists-semi-join` | One `GraphNode.membership` plus ordinary `Query` dependencies for every direct/through range and both present/empty outcomes. `exists` carries `argumentId:null` and no digest; `all` binds non-null `argumentId` and `argumentDigest`, never values. In the LLP 0056 precedent these are ordinary query dependencies; `Permission` is never correctness evidence. |
| `principal-bound` | Existing `Auth` for the host principal dimension; binding and target `Row`/`MissingRow`; one `GraphNode.principal-field` for each binding/target field scope. A field/value disjointness skip is permitted only when all such inputs are captured. |
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
memoizes evaluation results keyed by **(inner graph instance identity,
authority partition identity, evaluation cut version)** — every component
owner-computed (§2, §3; LLP 0200 §2.2's
atomic cut supplies the version). When N subscriptions
share the key, one evaluation turn produces one result consumed by N
per-subscription deliveries. E-3 measures the headroom at ~6× for the
same-partition six-observer shape: six serialized ~0.9 s turns become one
turn plus delivery. Any memo shared across a process or materialization
context must substitute §2.4's outer materialization identity for the inner
instance hash.

**Soundness.** The key is exactly the tuple the completeness vocabulary
already claims results at (§4), so a memo hit delivers bytes the
subscriber's own evaluation would have produced — same instance, same
partition, same version, same label. Principal- and policy-ambience is why nothing weaker
is safe: LLP 0191 rung 3 records that an opaque handler partitioning
before counting cannot be evaluated under a super-principal and projected
afterward. The IR makes the ambient inputs declared inputs; the partition
identity makes "same authority" checkable instead of assumed.

**Invalidation is the matcher, not a second system.** A matcher wake for
any subscription holding the key retires the memo entry (the key's cut
version is superseded); an authority transition fences subscriptions and
thereby the entries their partition identity depends on (LLP 0200 §2.4's
fence semantics, unchanged). There is no TTL and no separate cache
coherence protocol to get wrong.

**Placement.** Memo entries live in the scheduler beside the pending-frame
structures, bounded (entry count and byte budget declared per instance,
overflow evicts oldest — eviction only costs a re-evaluation). Frames,
watermarks, obligations, and ordering are per-subscription and unchanged;
a memo hit skips the *turn*, never the delivery or its
witnessed-shrink/obligation accounting (LLP 0200 §2.4).

**Scope honesty.** The memo collapses only identical
(instance, partition) tuples. The hot inventory's *mixed*-partition six
observers gain nothing from this rung — their lever is §7 where the shape
admits it, or D3's retained facts. This rung is first because it is
mechanism-cheap (a cache with matcher-driven invalidation) against
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
  delta frames carry (materialization identity, partition, version) so a
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
    comparison: "exact-id-order"
  }>
  nodeCompleteness: readonly Readonly<{
    graphNodeId: string
    oracleField: string
    comparison: "exact-label"
  }>[]
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
per-node completeness labels, and continuation semantics—against the oracle's
mapped fields. `issueListV2` maps its item rows/order, each item's
`labelsCompleteness` to the label-edge graph node, and `hasMore`/`cursor` to
root continuation semantics. A continuation passes only when resuming each
side yields the same next-page rows in the same order; opaque cursor bytes are
never compared. `issueDetail` records the corresponding map for its root and
demand-paged comments node, and `listIssueByID` records its point/list map.
Every oracle-envelope field appears exactly once as corresponding or excluded.
`examined` is excluded because it is opaque-handler physical work rather than
a graph result leaf; `total` because it is a full filtered count outside the
bounded declared projection; and `searchEpoch` because it is provider
diagnostic/version metadata rather than a projected graph field. Any query
whose **rows** cannot be reproduced by the v1 graph grammar is frozen as a
`refusal` case with its stable reason; envelope-only exclusions may not hide a
row mismatch.

At G0 every `queryCost.graph` field is declared under §2.6. Logical fields are
derived from fixture facts and these oracle results. Physical fields are
analytical plan-shape declarations marked **[G2 measures]**; no Stage B
`StructuralWorkV1` value is represented as graph-executor observation.
**[author-ratify]** LLP 0267 observed-value consumption begins at G2.

The following is the complete G0 deliverable checklist. Every command named
below is a command Stage B must make runnable from the repository root; test
filters are stable test names, not prose descriptions.

| # | Deliverable | Stage B artifact | Verification command Stage B must provide |
| ---: | --- | --- | --- |
| 1 | [ ] **The IR, as data.** All seven §2.2 node kinds; finite, acyclic, closed; normative exclusions/refusals. | `GraphQueryPlanV1`/`GraphNodeV1` and `GraphQueryCarrierV1` in `snapback-types`; `defineGraphQuery`; `HandlerPlan::GraphQuery`; generated JSON Schema; fail-closed matcher arm; `@ref LLP 0209#2-the-graph-ir` on the IR. Placement follows LLP 0276; no new crate. | `cargo test -p snapback-types graph_query_v1 && volta run --node 24.18.0 node --test packages/snapback-codegen/graph-query.test.mjs` |
| 2 | [ ] **Plan, demand, and contextual identity.** Host-recomputed normalized plan identity; plan × canonical args × keyed node-window-vector instance identity; LLP 0157 contextual materialization wrapper. | `GraphPlanIdentityV1`, `GraphInstanceIdentityV1`, `GraphMaterializationIdentityV1`, frozen Rust/JS positive and one-axis-rotation vectors in the graph corpus. | `cargo test -p snapback-types graph_plan_identity_v1 && cargo test -p snapback --test graph_corpus_v1 identity_vectors` |
| 3 | [ ] **Per-node authority classification, proved not trusted.** Classes 1/2/3, compile checks, paired-world falsification, partition roll-up; class 3 is partition-of-one. | Codegen proof report embedded in normalized plans; `GraphAuthorityPartitionRuleV1`; paired-world and exact-audience corpus rows from §3; `@ref LLP 0209#3-authorization-at-every-node` on admission. | `volta run --node 24.18.0 node --test --test-name-pattern=authority packages/snapback-codegen/graph-query.test.mjs && cargo test -p snapback --test graph_corpus_v1 paired_worlds` |
| 4 | [ ] **Completeness vocabulary bound to the IR.** `unknown`/`complete`/`prefix`/`window`/`refused` at one materialization/partition/version tuple. | Per-node and composed expected label/proof fields in every graph corpus case; refusal reason pinned. | `cargo test -p snapback --test graph_corpus_v1 completeness_labels` |
| 5 | [ ] **Per-node dependency capture specified for every kind.** Root predicate/boundary; parent edges; membership; principal field; table-granular search. | `CapturedReadKind::GraphNode`/`GraphCapturedReadV1` in `snapback-types`, with the matching vocabulary registered in `snapback-sync`; schema/round-trip fixtures only. Execution and matcher consumption wait for G2. | `cargo test -p snapback-types graph_captured_read_v1 && cargo test -p snapback-sync graph_captured_read_v1 && cargo test -p snapback --test graph_corpus_v1 dependency_shapes` |
| 6 | [ ] **The Zerobugs corpus is declared and compiles or refuses.** `issueListV2`, `issueDetail`, and point/list companion shape use the opaque JS handlers as oracle. | Normal-fixture declared rows/order/node labels/continuation semantics, explicit per-query `GraphOracleFieldMapV1`, exclusions, stable refusals, host identities, oracle digests, and all §3.4 case kinds in `tests/conformance/graph/corpus.v1.json`; large-fixture identity/label spot checks. | `cargo test -p snapback --test graph_corpus_v1 && volta run --node 24.18.0 node scripts/check-inventories.mjs` |
| 7 | [ ] **Every bound declared under the G0 ruling.** Logical fields are sized from fixture facts/oracle results; physical fields are analytical plan-shape declarations tagged `[G2 measures]`; 1,024 summed-batch reuse is rejected; maintained-write is zero. | Normal/large/hot logical derivations, analytical physical derivations, node-ledger declarations, `GraphG0ExitObservationV1`, and completed §2.6 table in the v0.6 note; no fabricated graph-executor observations. | `volta run --node 24.18.0 node demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs --fixtures normal-seed-v1,large-seed42-v1,hot-recent-v1 && cargo test -p snapback --test graph_corpus_v1 bounds_are_fixture_derived` |
| 8 | [ ] **All nine LLP 0268 §7 inputs.** Each named label has its §3.3 carrier, mapped case kinds, and exit evidence; omission blocks B1. | `GraphBroadcastAdmissionV1` proof/refusal records, all seven §3.4 case kinds, and normal/large/hot G0-exit observations. | `cargo test -p snapback --test graph_corpus_v1 broadcast_inputs_complete` |
| 9 | [ ] **OQ-1 applied.** New sibling arm/capability/constructor; shipped carriers frozen; no migration; degenerate equivalence deferred to G2. | Registry reservation and schema arm for `graph_query_v1`; existing relational corpus unchanged; explicit no-executor admission test and fail-closed matcher arm. | `cargo test -p snapback-types graph_query_sibling_arm && cargo test -p snapback --test relational_corpus_v0 && cargo test -p snapback --test graph_corpus_v1 no_runtime_consumer` |

### Exit — v0.6 G0 exit note

G0 exits only in a dated **v0.6 (“G0 exit”)** revision-history note. That
note checks all nine rows above, links the Stage B commit/evidence, records
the oracle/corpus digests, replaces every **[Stage B fills]**, and records the
author's ratification or override of every **[author-ratify]** decision. It
moves the §2–§4 content from Draft to Review, while making no G2/G3/runtime or
publication claim. In particular, the author ratifies or overrides §2.6's G0
declaration/observation ruling: every logical placeholder is replaced by its
fixture/oracle derivation, every physical field has a complete analytical
plan-shape derivation and remains explicitly **[G2 measures]**, and LLP 0267
observed-value consumption begins only at G2. The exit run is:

```sh
cargo test -p snapback-types graph_query_v1
volta run --node 24.18.0 node --test packages/snapback-codegen/graph-query.test.mjs
cargo test -p snapback --test graph_corpus_v1
cargo test -p snapback --test relational_corpus_v0
volta run --node 24.18.0 node scripts/check-inventories.mjs
./ref-check --verbose
```

The exit record is incomplete if any command is absent/red, any checklist row
lacks an evidence pointer, any LLP 0268 label is missing, or any bound retains
a placeholder, missing analytical derivation, or unexplained inherited
ceiling. A physical field's `[G2 measures]` label is a required observation
posture, not a G0 placeholder.

- **G0 — IR, identity, vocabulary, corpus (first; no runtime semantics
  change).** Specify the node kinds, bounds, authority classification,
  and plan identity; compile the Zerobugs issue-list and issue-detail
  queries (the control's corpus, per LLP 0191 §5) to admitted graphs or
  explicit refusals; freeze the conformance corpus (results, labels,
  refusals) against the oracle. Exit: corpus compiles/refuses with
  host-recomputed identities; **declared bound values sized from the
  normal and large fixtures or analytically from normalized plan shape**
  under §2.6's ruled logical/physical split (LLP 0183 §D2's sizing
  requirement — v0.5 carries only the packet's first-cut candidates, and G0
  cannot exit until Stage B replaces every logical placeholder and records
  every physical derivation with `[G2 measures]`); per-node dependency
  capture specified for every admitted node kind; the §3 paired-world
  authorization rows present in the corpus.
  (OQ-1's grammar ruling is a G0 input.)
- **G1 — same-partition memoization (rung 3), behind a kill switch.**
  Scheduler memo keyed per §6, `SNAPBACK_LIVE_EVAL_MEMO_DISABLED=1` as
  the control arm. **D2-H1:** on the same-partition six-observer burst
  arm, trigger settle p50 within 2× of the one-observer arm (vs ~6×
  serial today) and evaluation count ≈ one per drain cycle (vs six);
  mixed-partition arm unchanged; oracle-exact rows throughout. This
  phase does not require G0's full profile, but its pre-G0 scope is
  deliberately narrower than the partition key: **same-principal dedup
  only** — identical (function, canonical args, principal, cut version)
  tuples, exactly the spike's measured same-partition shape. That is
  re-execution deduplication, not plan inference: with LLP 0009's VM
  denying ambient nondeterminism (deterministic Date/Math policy) and
  every declared input identical including the principal, N
  re-executions are N copies of one evaluation. Partition-level
  memoization — sharing across principals inside one partition — waits
  for G0's §3 classification, because a deterministic VM proves nothing
  about *which* ambient authority inputs feed an opaque handler —
  LLP 0190 §4.3 admits conclusions about an opaque handler only from an
  extraction that proves its complete inputs, which same-principal
  identity sidesteps and partition-level sharing cannot.
- **G2 — graph-profile server execution + per-node matching (rung 2's
  required half).** Admitted graphs execute server-side with per-node
  captured dependencies feeding the existing matcher; the decision
  ledger reports per node kind. **D2-H2:** on the graph corpus, wake
  precision is at least the single-table baseline — conservative-
  fallback rate ≈ 0 and no table-granular full-graph wakes for commits
  provably disjoint at a node — with correctness pinned by the
  conformance corpus.
- **G3 — delta lanes for measured-hot admitted shapes (rung 4).**
  Per-node-kind delta rules from §7, narrowest first (root window +
  to-one), each behind the convergence assertion. **D2-H3:** on the
  target shape's arm, delivered frame bytes and per-commit evaluation
  cost drop materially (target sized at G2 from the ledger), replace
  fallback remains correct and honest, assertion green across the
  corpus.
- **Demand-gated, deliberately unscheduled:** rung-2 widening beyond
  per-node capture (§5's gate) and cross-principal sharing (§6's gate).

Capability publication rides LLP 0183 §D2's gate unchanged: the first D2
capability publishes only when the complete named corpus — pinned project
restriction, role visibility, open/creator/assignee/all-label/search
filters, selectable orders, two-way windows, private overlays, list
relations, and detail relations — passes one conformance corpus on every
claimed target. The G-phase exits above are engineering gates; none of
them is that publication.

Ordering rationale: E-3 gives G1 measured ~6× headroom for a cache
whose invalidation already exists; E-2 says precision work has no
measured payoff before graphs exist, so it rides in with the IR (G2)
rather than ahead of it; E-1 says delta maintenance pays orders of
magnitude but only per admitted shape, so it goes last and
shape-by-shape. Each phase lands separately and is A/B'd on the landed
commit per LLP 0189; no phase's claim outruns its arm.

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
  `snapback:graph-authority-partition:v1:`, and
  `snapback:graph-broadcast-scope:v1:` hash domains (§2.4, §3.2, §3.3).
- One additive top-level `CapturedReadKind::GraphNode` carrying the closed
  graph dependency union rather than multiple graph-specific top-level arms
  (§5.1).
- The logical-bound headroom factors and resulting G0 values, including the
  1,024-root, 16-label-edge, and zero-maintained-write candidates (§2.6).
- The G0 declaration/observation ruling: fixture/oracle derivation for logical
  bounds, analytical normalized-plan derivation for physical bounds, and LLP
  0267 observed-value consumption deferred until the G2 executor exists
  (§2.6, §9).

## Drift found, not fixed

- **LLP 0267 §5 window wording:** amend the singular stable-window/
  `QueryCostWindowLedgerV1` wording to admit one independent ledger lineage
  for every demand-paged graph node, with the node id and its canonical
  per-parent interval vector in the binding (§2.4).
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

## Revision history

- **v0.5 (2026-08-23, Stage A).** Tightened G0 as a docs-only landing:
  §2 now fixes the normalized graph record, all seven node kinds and their
  edges/cardinalities, stable refusal precedence, plan/instance identity,
  sibling `HandlerPlan::GraphQuery` lineage, and the complete
  `queryCost.graph` derivation skeleton; §3 fixes class proofs,
  partition-of-one roll-up, all nine LLP 0268 inputs, and paired-world row
  shape; §4 binds labels/proofs to nodes and defines graph composition; §5
  fixes `GraphNode` dependency capture and ledger fields; §9 separates Stage
  A, Stage B, and the v0.6 exit. Author ratification is requested only where
  marked: plan, instance, materialization, authority-partition, and broadcast-scope hash
  domains; one tagged graph captured-read variant; and the fixture headroom
  factor `H` plus the resulting logical bound table (including the packet's
  1,024-root, 16-label-edge, and zero-maintained-write candidates). Stage B
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
  already falsified by a 1,000-row list × 1.5 label edges); (2) **OQ-1 is
  applied as proposed in the packet unless the author overrides** before
  Stage A lands; (3) **OQ-3 is taken conservatively at G0**
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
