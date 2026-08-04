# Proposal — `single_table_v1` node class

**Status:** Proposal for owner review; non-normative until every named owner
accepts its dated amendment
**Date:** 2026-08-03
**Source ticket:** `issues/20260803-p4-single-table-node-class.md`
**Decision owners:** LLP 0004, LLP 0007, LLP 0080, LLP 0090, LLP 0157, and
LLP 0166, with the boundary-note owners listed in §Required dated amendments

This is the complete amendment proposal the owners would land if they accept
P4. It edits no LLP and grants no implementation or capability claim.

## 1. Decision in one paragraph

Register `single_table_v1`, class version 1, as the owner-governed node form of
the exact shipped `rqsEligible` population. Admit it only through the existing
`single-node.v1` plan profile; do not admit it in any multi-node profile. Reuse
the existing reserved `none.v1` cursor profile and the existing
`established-result-jcs.v1` result encoding. Bind the shipped `mset1`/`seq1`
selector, live-delivery ceiling, and a narrow
`rqs-authority-independent-snapshot-v1` retention authority into node identity.
Derive `NodePlanHashV1`, `PlanHashV1`, and `QueryMaterializationKeyV1` through
LLP 0157 without adding a parallel identity. Adopt a legacy entry only while
connected, only when its identity can be proved, and otherwise fresh-sync; never
relabel legacy bytes in place. The narrow Channel-B authority should travel with
the family. A general anonymous `AuthorizedLease` class is not recommended.

## 2. Baseline and ownership corrections

The P4 ticket describes a 2-class/2-profile registry and says the proposal is
inside a 2/6 class budget (`issues/20260803-p4-single-table-node-class.md:6-15`).
Current accepted LLP 0157 has since added `exported_query_v1` and
`mixed-route.v2`: the live registry is three classes and three profiles, with a
hard ceiling of six classes and four profiles, one class or profile per reviewed
amendment (`llp/0157-composition-algebra-and-completeness.spec.md:240-255`,
`llp/0157-composition-algebra-and-completeness.spec.md:283-292`). This proposal
therefore moves the registry to **four classes and three profiles**. It consumes
one class slot and no profile slot.

LLP 0157 deliberately leaves ordinary LLP 0004/0007 single-table plans under
their existing identities until an owner-governed class is registered; they may
not be silently reclassified (`llp/0157-composition-algebra-and-completeness.spec.md:201-216`).
It also says a new class comes from the node-shape owner, not from LLP 0157 by
side effect (`llp/0157-composition-algebra-and-completeness.spec.md:169-185`).
LLP 0004 owns the app-facing query surface and LLP 0007 owns its portable query
and index semantics (`llp/0004-application-data-api.rfc.md:195-266`,
`llp/0007-storage-portability.spec.md:37-53`).

LLP 0166 already records the legacy family separately: `rqsEntryKey(name,args)`
addresses the shipped public, authority-independent, single-table, plan-based
LiveQuery population; it has a server-MACed token and content digest but no
LLP 0157 completeness proof (`llp/0166-local-persistent-store.spec.md:914-933`).
Registration is the missing act that can give that population plan identity,
proofs, and `qmk1` addresses, subject to the anonymous-retention precondition
(`llp/0166-local-persistent-store.spec.md:930-940`,
`llp/0166-local-persistent-store.spec.md:1977-1986`).

## 3. Exact class admission

### 3.1 The host-derived predicate

Class membership is **derived, never authored**. The host admits a served
function to `single_table_v1@1` if and only if
`rqs_eligible_digest_kind(function)` returns `Some(kind)`. The shipped function
checks all of the following:

1. `authorityIndependent === true`;
2. `kind === LiveQuery`;
3. the effective auth requirement is `public`;
4. `uses` is empty, `readSetSummary.authScopeField` is absent, and
   `authorizationDependence` is empty;
5. the runtime is exactly `HostPlan(Query(plan))`;
6. no ordinary filter value expression uses an authority or ambient input;
7. `membershipFilters` is empty; and
8. the read summary is complete `singleTable`: its primary table is the plan
   table and its one-element table set is exactly that table.

These are the literal shipped branches at `src/manifest.rs:2872-2931`; the
recursive rejected and admitted `ValueExpr` families are at
`src/manifest.rs:2934-2970`. Failure is non-erroring non-eligibility, not a
manifest-load error, and no authored `rqsEligible` field exists
(`src/manifest.rs:2877-2886`). LLP 0092 records the same producer contract and
explains that Channel B keys on this derived fact without requiring an authored
`retainable` declaration
(`llp/0092-rqs-manifest-bundle-and-channel-a-contract.spec.md:135-168`).

No `publicInline` requirement is added: that is a separate disclosure gate, not
part of `rqsEligible` (`llp/0092-rqs-manifest-bundle-and-channel-a-contract.spec.md:170-186`).
No query for which the shipped function returns `None` acquires a node record,
plan hash, proof, or QMK under this amendment. Its current API and any current
legacy behavior stay unchanged.

### 3.2 Owner-normalized closed record

The LLP 0004/0007 owners would add this exact closed record:

```ts
type SingleTableFilterOpV1 = "Eq" | "In" | "Lt" | "Lte" | "Gt" | "Gte"
type SingleTableBinaryOpV1 =
  | "Add" | "Sub" | "Mul" | "Div" | "Mod"
  | "Eq" | "Ne" | "Lt" | "Lte" | "Gt" | "Gte"
  | "And" | "Or"
type SingleTableUnaryOpV1 = "Not" | "Neg"
type SingleTableLiteralV1 =
  | null | boolean | number | string
  | readonly SingleTableLiteralV1[]
  | Readonly<Record<string, SingleTableLiteralV1>>

type SingleTableValueExprV1 =
  | "Args"
  | Readonly<{ Arg: string }>
  | Readonly<{ Binding: string }>
  | Readonly<{ Literal: SingleTableLiteralV1 }>
  | Readonly<{
      Field: Readonly<{ base: SingleTableValueExprV1; key: string }>
    }>
  | Readonly<{
      Binary: Readonly<{
        op: SingleTableBinaryOpV1
        left: SingleTableValueExprV1
        right: SingleTableValueExprV1
      }>
    }>
  | Readonly<{
      Unary: Readonly<{
        op: SingleTableUnaryOpV1
        expr: SingleTableValueExprV1
      }>
    }>
  | Readonly<{
      If: Readonly<{
        cond: SingleTableValueExprV1
        then: SingleTableValueExprV1
        else: SingleTableValueExprV1
      }>
    }>
  | Readonly<{ Concat: readonly SingleTableValueExprV1[] }>
  | Readonly<{
      Call: Readonly<{ func: string; args: readonly SingleTableValueExprV1[] }>
    }>
  | Readonly<{
      Record: Readonly<{
        fields: Readonly<Record<string, SingleTableValueExprV1>>
      }>
    }>

type SingleTablePlanV1 = Readonly<{
  format: "snapback.single-table-plan.v1"
  query: Readonly<{
    table: string
    filters: readonly Readonly<{
      field: string
      op: SingleTableFilterOpV1
      value: SingleTableValueExprV1
    }>[]
    membershipFilters: readonly []
    order: readonly Readonly<{
      field: string
      direction: "Asc" | "Desc"
      maxEncodedBytes: number | null
    }>[]
    limit: number | null
    indexedBy: string | null
  }>
  rqsDigestKind: "mset1" | "seq1"
  examinedEntryCeiling: 1024
}>
```

The host reconstructs this from the served typed `QueryPlan`; it never trusts a
client-carried copy. The shipped plan's fields are `table`, `filters`,
`membership_filters`, `order`, `limit`, and `indexed_by`
(`src/manifest.rs:6702-6728`). The generated manifest producer serializes those
same values, including the `membershipFilters`/`indexed_by` spellings and
optional `maxEncodedBytes` (`packages/snapback-codegen/index.mjs:4204-4238`).
Normalization makes optional values explicit as JSON `null`, translates only
`indexed_by` → `indexedBy`, and re-emits the class-proved empty membership
list. It preserves filter and order declaration order. The closed filter and
order variants are the shipped `FilterExpr`/`OrderExpr` forms
(`src/manifest.rs:6802-6843`); the closed value grammar above is the exact
non-authority/non-ambient subset of shipped `ValueExpr`, with the shipped binary
and unary operators (`src/manifest.rs:6958-7042`,
`src/manifest.rs:7176-7197`). The generated spellings are fixed at
`packages/snapback-codegen/index.mjs:4165-4201`. Unknown fields at any level of
the normalized record refuse.

`limit: null` is identity-significant and must not normalize to `1024`: the
shipped digest selector chooses `mset1` only when `order` is empty **and** the
authored limit is absent; any non-empty order or any explicit limit, including
`0` or `1024`, selects `seq1` (`src/manifest.rs:2927-2931`). The runtime's
effective result limit is nevertheless 1,024 when `limit` is absent
(`src/manifest.rs:5120-5122`).

### 3.3 Bounds and the examined-entry owner decision

The class declares these bounds:

| Bound | Class value | Basis |
| --- | ---: | --- |
| primary tables | exactly 1 | class admission |
| membership semi-joins | 0 | class admission |
| returned rows | explicit `0..=1,024`; absent means 1,024 | shipped portable query bound |
| cumulative literal `In` items | 500 | shipped portable query bound |
| cumulative filter bindings | 500 | shipped portable query bound |
| `ValueExpr` depth | 32 | shipped expression bound |
| optional string order-field `maxEncodedBytes` | integer `1..=2^53-1` when present | shipped schema-reference bound |
| examined storage entries | 1,024 | **new class-only enforcement proposed here** |

The shipped numeric query bounds are defined at `src/manifest.rs:30-39` and
enforced for the plan at `src/manifest.rs:5060-5117`; LLP 0007 states the same
result, `In`, and binding ceilings (`llp/0007-storage-portability.spec.md:318-349`).
The expression-depth bound is 32 (`src/value_expr.rs:44-46`,
`src/value_expr.rs:128-132`). An authored order-field byte ceiling, when
present, is a positive safe integer on a string field and must agree across all
uses (`src/local.rs:23255-23308`).

The examined-entry ceiling is deliberately called out as a **new owner
decision**, not misreported as shipped. LLP 0157 defines a node class as having
an examined-entry ceiling (`llp/0157-composition-algebra-and-completeness.spec.md:201-205`),
but the exact shipped `rqsEligible` predicate does not require an index and does
not prove bounded physical scan work (`src/manifest.rs:2872-2931`). LLP 0007
currently validates a named index when present but allows it to be absent
(`src/storage.rs:11643-11673`).

Acceptance therefore adds a class-only execution guard: while establishing or
re-establishing this node through `single-node.v1`, the target counts storage
entries examined and refuses the whole establishment with a registered closed
reason when entry 1,025 would be examined. It never installs a partial result or
proof. The ordinary non-node LiveQuery API is unchanged. This is the smallest
honest way to register the exact shipped predicate without pretending its result
limit already bounds a sparse scan. The cost is real: a legacy-eligible sparse
query can remain usable through its existing API yet refuse node establishment;
the staged path in §8 then leaves its legacy offline copy in place until an
owner-approved plan/index change makes fresh establishment succeed. The owners
may instead reject this ceiling and the class; they may not register an
unbounded node under the existing LLP 0157 definition.

### 3.4 Cursor and result encoding

Use the existing `CursorProfileIdV1` value **`none.v1`**. LLP 0157 already
reserves it for a future owner-proved unpaginated plan and says it currently has
no active producer (`llp/0157-composition-algebra-and-completeness.spec.md:817-838`).
This class is that producer: one establishment returns one bounded whole result,
has no public input or output cursor, and goes from `{kind:"first"}` to
`{kind:"terminal"}`. Its visible-page boundary vector is the already-specified
canonical empty `none.v1` vector, not a new boundary variant
(`llp/0157-composition-algebra-and-completeness.spec.md:871-892`). No new
`CursorProfileIdV1`, credential prefix, or plan profile is added.

Use the existing proof-result encoding **`established-result-jcs.v1`**: the
validated row array is mapped through canonical client values and RFC 8785 JCS,
then bound by the existing `ResultDigestV1` domain
(`llp/0157-composition-algebra-and-completeness.spec.md:779-786`). The application
result is the complete array of documents returned by the HostPlan Query; this
class adds no projection. The `mset1`/`seq1` RQS content digest remains a
separate resume/corruption identity and never replaces `ResultDigestV1`.

## 4. Registry row and admission profile

The dated LLP 0157 §D1 row would be:

| `classId` | `classVersion` | Owner-normalized record | Single node | Multi-node profile | Parent group |
| --- | ---: | --- | --- | --- | --- |
| `single_table_v1` | 1 | LLP 0004/0007 `SingleTablePlanV1` | admitted through `single-node.v1` | not admitted | none |

The class is single-only. It is not admitted to `snapshot-batch.v1`,
`mixed-route.v2`, or any implicit successor. A future multi-node admission must
name a versioned plan/cursor profile through the normal reviewed-amendment rule;
it is not inferred from this row. This follows LLP 0157's separation between
class registration and substrate multi-node admission
(`llp/0157-composition-algebra-and-completeness.spec.md:319-330`).

The cursor assignment table would gain:

| Plan profile | Node class | `CursorProfileIdV1` | Node boundary variant |
| --- | --- | --- | --- |
| `single-node.v1` | `single_table_v1` | `none.v1` | none; canonical empty vector |

## 5. Capability binding

### 5.1 RQS digest kind

The normalized record pins the exact shipped selector
(`src/manifest.rs:2927-2931`):

- `order.length === 0 && limit === null` → `rqsDigestKind: "mset1"`;
- otherwise → `rqsDigestKind: "seq1"`.

`mset1` is the incremental multiset digest; `seq1` is the delivered-order
sequence digest (`llp/0091-rqs-token-and-wire-contract.spec.md:224-286`). This
selector is host-recomputed and exact-compared with the normalized record. A
mismatch refuses node admission. It is not a new algebra-wide identity axis: it
is an owner-derived field inside `normalizedPlan`, and changes that alter it
already rotate `NodePlanHashV1` through the plan bytes.

### 5.2 `NodeCapabilityBindingV1`

For every admitted node the host emits:

```ts
{
  exportKind: "LiveQuery",
  live: {
    kind: "admitted",
    delivery: "live_delta" | "live_replace",
    pageDomain: "whole-result"
  },
  retention: "rqs-authority-independent-snapshot-v1",
  requiredCapabilityIds: /* served function ids, sorted and unique */
}
```

This is the existing closed capability-record shape with one proposed retention
value added; its axes and host-recomputation rule are owned at
`llp/0157-composition-algebra-and-completeness.spec.md:352-430`.

The binding rules are:

- `seq1` binds `delivery: "live_replace"`.
- `mset1` binds `delivery: "live_delta"` when the served function carries the
  exact schema-derived `documents(table)` result contract and no other shipped
  delta exclusion applies; otherwise it binds `live_replace`. A `live_delta`
  binding names the strongest admitted delivery. The shipped runtime may still
  use its honest additive `live_replace` fallback when the current result has
  reached the implicit cap or another per-delivery proof cannot be made. The
  fallback is part of the shipped DK-3 contract, not a capability or identity
  change (`llp/0008-local-first-sync-and-realtime.rfc.md:276-299`,
  `src/live_matcher.rs:656-682`). The exact result-contract gate is shipped at
  `src/local.rs:21217-21245`.
- `requiredCapabilityIds` is the served function's existing required-capability
  set, UTF-8 sorted and deduplicated. The class does not smuggle a target support
  claim into that set; target support remains an explicit admission/capability
  fact, and a target unable to honor the class refuses as LLP 0157 requires
  (`packages/snapback-codegen/index.mjs:230-282`,
  `llp/0157-composition-algebra-and-completeness.spec.md:1124-1163`).

For the degenerate single-node plan, `PlanCapabilityClassificationV1` is the
same owner fact:

```ts
{
  callable: true,
  live: /* exact node live binding, with delivery/pageDomain fields */,
  invalidation: "proved-disjoint",
  retention: "rqs-authority-independent-snapshot-v1"
}
```

`proved-disjoint` is independent of delivery: the captured HostPlan predicate
may prove a commit irrelevant even for a `seq1`/replace result; whenever the
captured facts cannot prove that skip, the target re-queries or replaces. The
class metadata cannot override the captured affected verdict. Those are the
shipped owner rules (`llp/0053-authorization-invalidation.rfc.md:384-400`).

`exportKind`, live delivery, retention, and required capabilities are identity
inputs, not inferences from a single-table shape. LLP 0157 requires the host to
recompute them and refuses mismatches (`llp/0157-composition-algebra-and-completeness.spec.md:352-430`).

## 6. Identity consequences

### 6.1 `NodePlanHashV1`

For a class member, the exact node preimage is:

```text
"snapback:node-plan:v1:" || JCS({
  format: "snapback.node-plan.v1",
  classId: "single_table_v1",
  classVersion: 1,
  normalizedPlan: SingleTablePlanV1,
  argumentBindings: [
    { name, contract, contractHash }, ...
  ],
  capability: NodeCapabilityBindingV1
})
```

`argumentBindings` preserves the LLP 0004 function's argument declaration
order. Each contract is the exact projected LLP 0131 field descriptor and each
adjacent hash must recompute; class, normalized plan, binding name/contract, or
capability changes rotate the hash. That is the existing LLP 0157 rule
(`llp/0157-composition-algebra-and-completeness.spec.md:432-472`). The output is
the existing lowercase `sha256:` spelling; no `single_table`-specific hash is
introduced.

### 6.2 `PlanHashV1`

The plan is `NormalizedCompositePlanV1` with:

- `profileId: "single-node.v1"`;
- exactly one node at position 0 carrying the node record and hash;
- the existing `MergedArgsContractHashV1` derived from that node;
- the plan classification in §5; and
- `parentAuthorizationGroups: []`.

LLP 0157 already fixes that single-node shape and empty parent group
(`llp/0157-composition-algebra-and-completeness.spec.md:496-527`). `PlanHashV1`
uses the existing `snapback:plan-hash:v1:` domain; any node, contract,
classification, or profile change rotates it
(`llp/0157-composition-algebra-and-completeness.spec.md:542-549`).

### 6.3 QMK derivability for `rqsEligible`

Once the current served function passes §3.1, every input to the existing
`QueryMaterializationPreimageV1` is available without author assertion:

- current application/database/deployment/target and trusted activation;
- the complete current generated LiveQuery reference;
- the derived `PlanHashV1`;
- LLP 0114 canonical runtime args; and
- the current owner-issued authority partition digest.

The result is the existing fixed `qmk1.` spelling under
`snapback:query-materialization:v1:`
(`llp/0157-composition-algebra-and-completeness.spec.md:584-676`). Authority
independence does **not** delete the authority partition from the preimage and
does not permit cross-provider/store dedup: the contextual client and provider
addresses remain separate (`llp/0157-composition-algebra-and-completeness.spec.md:678-707`).

The legacy persisted record alone cannot derive a QMK. It lacks a registered
node/plan hash and completeness proof, exactly as LLP 0166 records
(`llp/0166-local-persistent-store.spec.md:924-933`). A connected client plus the
current served artifacts can derive the QMK and then either prove the legacy
answer or establish a fresh one under §8. A plan/capability registration change
rotates node/plan identity; function, activation, args, or authority changes
rotate the QMK (`llp/0157-composition-algebra-and-completeness.spec.md:710-720`).

## 7. Retention authority — both arms

### 7.1 Arm A — Channel-B authority travels (recommended)

Add one narrow owner-issued retention value:

```ts
"rqs-authority-independent-snapshot-v1"
```

It is issued if and only if the function passes the exact §3.1 predicate and is
registered as `single_table_v1@1`. It is not a general public-data, anonymous,
or lease class. Its custody rules are:

1. A valid current `CompletenessProofV1`, trusted activation/proof-key artifact,
   exact result bytes, current instance fence, and the class binding are
   required before install and every render. LLP 0157 already makes the proof
   bind materialization, plan, node, version, authorization witness, page, and
   result (`llp/0157-composition-algebra-and-completeness.spec.md:910-999`).
2. `authorizedLeaseHash` is exactly `null`. No `AuthorizedLease` is minted or
   implied because the result is proved invariant across callers and has no
   mutable authorization dependence by class admission.
3. `retentionRequest: "durable"` is still required. For compatibility with
   Channel B's indefinite offline display, the generated mapping from
   `persistResume: true` for this class also fixes
   `idleTtlClass: "pinned"`. A released record is therefore exempt from grace
   GC but remains subject to the materialization budget, owner transitions, and
   store reset. LLP 0166 already defines `pinned` as no grace GC and still
   budget-compactable (`llp/0166-local-persistent-store.spec.md:1102-1121`,
   `llp/0166-local-persistent-store.spec.md:1153-1164`).
4. Offline rows remain labeled retained, never current. A current activation
   mismatch, corrupt proof/result, wrong instance/witness, or destructive owner
   transition remains fail-closed. Proof verification keys remain available in
   the trusted application artifact while any same-activation retained record
   can render; a record cannot bootstrap its own key
   (`llp/0157-composition-algebra-and-completeness.spec.md:958-985`).
5. Pending outbox intent still withholds token resume and takes full resync then
   replay; it does not blank an otherwise verified retained display. This is the
   shipped Channel-B rule (`llp/0090-resumable-query-snapshots.rfc.md:898-925`).

Why recommend it: Channel B already limits persistence to the exact
authority-independent, closed-input population and displays its verified rows
offline indefinitely as retained/pending (`llp/0090-resumable-query-snapshots.rfc.md:108-141`,
`llp/0090-resumable-query-snapshots.rfc.md:935-965`). Moving that narrow authority
onto a signed completeness proof preserves the product behavior while making
identity and integrity stronger. It does not manufacture a revocable anonymous
principal whose lease could expire.

Owner obligations for Arm A:

- LLP 0090 names this retention value as the successor expression of its
  `rqsEligible` Channel-B authority and keeps token resume separate until OQ2.
- LLP 0080 adds the value to the closed retention set as a single-table-only,
  authority-independent exception; it does not widen either authenticated
  retention class.
- LLP 0157 adds the value to both closed retention unions and teaches D3/D7 that
  its materialization has `authorizedLeaseHash:null` but still requires proof,
  witness, fence, and trusted activation.
- LLP 0166 admits it in the QMK persistence predicate, pins the generated
  durable/`pinned` registration mapping, and adds its no-lease answer-table row.
- LLP 0053 adds a boundary note that this exact class is not an
  `AuthorizedLease` consumer and does not weaken any auth-scoped rule.

### 7.2 Arm B — a general anonymous lease/retention class (not recommended)

The alternative is for LLP 0053 and LLP 0080 to define a general anonymous
retention authority first, for example an `AnonymousAuthorizedLeaseV1` envelope
plus an `opaque-anonymous-snapshot-v1` retention value. Only after that lands
would `single_table_v1` bind the general class.

This is not a small nullable-principal edit. The current `AuthorizedLease`
requires a `principal_id`, binds a server-resolved principal and authorization
pair, and uses session/provider clamps (`llp/0053-authorization-invalidation.rfc.md:1315-1357`).
Retained/offline reads require its exact binding and 24-hour hard maximum
(`llp/0053-authorization-invalidation.rfc.md:1642-1667`). LLP 0080 correspondingly
requires a server-resolved authenticated principal and explicitly says anonymous
v1 results have no retention class
(`llp/0080-portable-relational-queries-and-projections.rfc.md:380-393`). Its newer
result-transform class inherits that authenticated lease rule
(`llp/0080-portable-relational-queries-and-projections.rfc.md:405-421`).

The losing arm's owner cost is therefore:

- version and review a new lease subject/encoding (not reinterpret v1 bytes);
- define anonymous authority-partition rotation, issuance, verifier custody,
  expiry, rollback, deletion, reconnect, and capability facts;
- amend LLP 0043 storage/lease custody, LLP 0053 fences and retained-boot table,
  LLP 0080's closed set, LLP 0157's retention unions/store record, and LLP 0166's
  persistence predicate/answer table;
- add cross-target wire, schema, corruption, rollback, transition, and offline
  acceptance vectors; and
- decide the unavoidable product conflict: a 24-hour anonymous lease loses
  Channel B's shipped indefinite offline display, while a non-expiring anonymous
  lease abandons the safety invariant that makes it a lease.

That machinery may be justified later for public relational plans that are not
`rqsEligible`, but P4 supplies no such demand. It is a broad authorization
feature to solve a narrow already-proved population and is rejected for this
proposal.

## 8. Staged adoption — prove or fresh-sync

Acceptance changes no existing key or record. Existing single-table plans keep
their old identities until the new class registration is present, and legacy
entries continue under their byte-exact lifecycle and separate budget
(`llp/0166-local-persistent-store.spec.md:908-940`,
`llp/0166-local-persistent-store.spec.md:955-971`). Adoption is connected-only
and follows this sequence:

1. **Preconditions.** The current served function passes §3.1, the target
   advertises the class/proof/store capabilities, the current generated and
   trusted activation artifacts exact-match, and no pending outbox intent
   depends on the predecessor. If pending intent exists, wait for settlement or
   explicit owner-governed discard; never drop it. This carries LLP 0166's
   connected-attempt and pending-intent rule
   (`llp/0166-local-persistent-store.spec.md:1340-1354`).
2. **Derive, do not relabel.** Recompute `SingleTablePlanV1`, node capability,
   `NodePlanHashV1`, `PlanHashV1`, QMK, and its contextual address from the
   current owner artifacts. Validate the legacy record's key, args hash,
   generation, function artifact, version stream, digest kind/content digest,
   rows, and token under the legacy owner's rules. A mismatch or corruption is
   not proof.
3. **Prove arm.** Present the legacy resume token through LLP 0090's unchanged
   ladder. A rung-1 unchanged proof or a rung-2 admitted replay may produce the
   current authoritative whole result. The server then issues the ordinary
   `CompletenessProofV1` over the derived QMK/node/plan and the exact resulting
   bytes. A legacy content digest or token by itself can never stand in for that
   proof. LLP 0166 identifies the unchanged ladder as CurrentAsOf, delta replay,
   then fresh LiveReplace fallback (`llp/0166-local-persistent-store.spec.md:1282-1302`).
4. **Fresh-sync arm.** If identity cannot be proved, the token is stale, the
   ladder falls through, the examined-entry guard refuses proof, or any current
   binding differs, run fresh `single-node.v1` establishment. Install only a
   newly issued proof. If fresh establishment cannot succeed, keep a still-valid
   legacy record under its legacy label and rules; never publish a QMK record.
   A corrupt legacy record is discarded first and the answer is `unknown` until
   fresh establishment succeeds.
5. **One atomic same-domain switch.** Once a valid QMK fragment/proof is ready,
   one LLP 0166 store transaction installs the QMK materialization and removes
   or terminally retires the legacy entry. Before the commit only the legacy
   entry is renderable; after it only the QMK entry is renderable. A crash cannot
   expose both or neither except when corruption required delete-before-fresh.
6. **After adoption.** The legacy token is not treated as a QMK resume
   credential. Re-entry is fresh LLP 0157 establishment in v1. A proof-backed
   QMK resume credential remains the separate LLP 0166 OQ2 amendment with LLP
   0090/0093/0094 (`llp/0166-local-persistent-store.spec.md:1304-1322`).

This is the requested prove-or-fresh-sync interpretation of LLP 0166's staged
rule: migration uses recorded facts only where they prove identity; ambiguity
falls back to fresh sync and never mislabels retained state
(`llp/0166-local-persistent-store.spec.md:1324-1339`). It is narrower and safer
than the lease-family close-predecessor-first protocol because legacy resume and
QMK sections already share one transaction domain; no cross-artifact atomicity
is claimed (`llp/0166-local-persistent-store.spec.md:380-388`,
`llp/0166-local-persistent-store.spec.md:918-940`).

## 9. Required dated amendments

The minimal same-decision landing is exact below. Every row is a dated
**2026-08-03** amendment. “Boundary note” means no owner semantics change beyond
acknowledging the new producer/consumer seam.

| Owner | Required dated amendment if Arm A is accepted |
| --- | --- |
| **LLP 0004 — application data API** | Define `SingleTablePlanV1`; bind it only to derived `rqsEligible` LiveQueries; state the full-document result, declaration-order argument bindings, class-only 1,024 examined-entry refusal, single-only admission, and no change to ordinary Query/LiveQuery APIs. This owner currently pins the v0 one-table structured live shape and explicit LiveQuery declaration (`llp/0004-application-data-api.rfc.md:484-502`). |
| **LLP 0007 — storage portability** | Own the normalization/evaluation contract: exact typed query fields, null/order semantics, existing numeric bounds, new class-only examined-entry counter/refusal, `none.v1` whole-result/no-cursor behavior, and cross-target parity. Its current owner surface is the portable expression, ordering, limit, cursor, and index contract (`llp/0007-storage-portability.spec.md:318-425`). |
| **LLP 0008 — sync/realtime** | Boundary note: the class binding consumes DK-3's additive delivery ceiling; `live_delta` retains honest `live_replace` fallback and ordered/limited results remain replace (`llp/0008-local-first-sync-and-realtime.rfc.md:276-315`). No wire byte changes. |
| **LLP 0043 — offline retention/outbox** | Boundary note: QMK records under the narrow authority remain retained-not-current; pending outbox withholds token resume but not verified retained display. No lease envelope or outbox lifecycle change. LLP 0166 records 0043 as the owner of leases/outbox custody (`llp/0166-local-persistent-store.spec.md:282-286`). |
| **LLP 0053 — authorization invalidation** | Boundary note: `rqs-authority-independent-snapshot-v1` is an exact `rqsEligible` exception with no `AuthorizedLease`; it still consumes current witness/fence/barrier/destructive rules. Auth-scoped retention continues to require the authenticated lease. LLP 0053 remains the disposition/fence owner (`llp/0166-local-persistent-store.spec.md:287-290`). |
| **LLP 0080 — retention-class owner** | Add `rqs-authority-independent-snapshot-v1` to the closed set, limited to `single_table_v1@1` plus the exact predicate; explicitly distinguish it from `opaque-authorized-snapshot-v1` and `result-transform-snapshot-v1`, both still authenticated-lease classes. LLP 0166 names LLP 0080 as retention-class owner (`llp/0166-local-persistent-store.spec.md:300-301`). |
| **LLP 0090 — RQS/Channel-B owner** | Declare that the Channel-B authority travels as the narrow retention value; preserve digest/token/admission semantics for prove-or-fresh adoption; legacy records coexist unchanged until atomic adoption; legacy tokens do not become QMK credentials. Its accepted LLP 0166 boundary currently grandfathers that lifecycle byte-exact and leaves QMK resume future (`llp/0090-resumable-query-snapshots.rfc.md:1100-1115`). |
| **LLP 0091 — token/digest owner** | Boundary note: the exact `mset1`/`seq1` selector is copied into normalized node identity, but token, digest, and wire bytes do not change. The selector and constructions remain LLP 0091's (`llp/0091-rqs-token-and-wire-contract.spec.md:224-286`). |
| **LLP 0092 — served-manifest predicate owner** | Boundary note plus producer projection: the derived `rqsEligible` fact now also selects `single_table_v1@1`; the host emits/recomputes the normalized node and capability record, while authors still cannot assert class membership. The current derived-fact rule is at `llp/0092-rqs-manifest-bundle-and-channel-a-contract.spec.md:135-186`. |
| **LLP 0157 — registry/identity/proof/store owner** | Add the fourth D1 row and `single-node.v1`/`none.v1` assignment; add `rqs-authority-independent-snapshot-v1` to both retention unions; pin the node and plan capability rules, empty boundary vector, result encoding reuse, QMK derivation, no-lease retained-boot checks, and prove-or-fresh migration rule. Update the growth count to 4 classes/3 profiles. The current registries, capability unions, and cursor/result identities are at `llp/0157-composition-algebra-and-completeness.spec.md:240-292`, `llp/0157-composition-algebra-and-completeness.spec.md:352-430`, and `llp/0157-composition-algebra-and-completeness.spec.md:779-892`. |
| **LLP 0166 — local-store/convergence owner** | Close OQ1: add the class to the QMK address-family population; add the narrow retention value to the QMK persistence predicate; map Channel-B durable registrations to `idleTtlClass:"pinned"`; add the no-lease retained-answer row; specify the atomic prove-or-fresh same-domain switch; keep legacy budgets/lifecycle until adoption; keep OQ2 separate. The current persistence/address-family and staged-convergence boundaries are at `llp/0166-local-persistent-store.spec.md:872-940` and `llp/0166-local-persistent-store.spec.md:1280-1381`. |

No new LLP 0093/0094 frame, LLP 0114 provider key, or LLP 0157 identity domain
is required by the semantic class registration. An implementation may not
publish the class until the already-required proof/wire/store conformance gates
can carry these existing records; that is an implementation dependency, not a
reason to invent proposal-time bytes. If owners choose Arm B instead, replace
the LLP 0053/0080/0043 boundary rows above with the normative anonymous-lease
amendments and acceptance matrix listed in §7.2 before the LLP 0157/0166
amendments may land.

## 10. Decision request to the owners

Please record explicit answers to all five questions; silence is not acceptance.

1. **LLP 0004/0007 owners:** Accept `SingleTablePlanV1` as the closed
   normalization of the exact shipped `rqsEligible` predicate, including the
   class-only 1,024 examined-entry guard and whole-result/no-cursor semantics?
2. **LLP 0157 owner:** Accept `single_table_v1@1` as registry class 4 of 6,
   reuse `single-node.v1`, activate existing `none.v1`, keep multi-node admission
   closed, and reuse `established-result-jcs.v1`?
3. **LLP 0080/0090/0053 owners:** Accept recommended Arm A,
   `rqs-authority-independent-snapshot-v1`, with no `AuthorizedLease`, pinned
   offline custody, and every existing proof/fence/barrier/destructive rule;
   or explicitly choose Arm B and commission its broader anonymous-lease work?
4. **LLP 0166 owner:** Accept the connected, pending-intent-safe,
   prove-or-fresh-sync adoption and one-transaction legacy→QMK switch, with no
   relabel-in-place and no use of a legacy token as a QMK resume credential?
5. **All owners:** Accept the same-landing amendment/boundary-note list in §9,
   with semantic acceptance granting no implementation or capability claim?
