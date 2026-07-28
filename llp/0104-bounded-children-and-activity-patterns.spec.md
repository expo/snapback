# LLP 0104 — Bounded children and activity patterns

**Type:** Spec
**Status:** Review
**Systems:** Application data API, Relational queries, Mutations, Code generation, Authorization, Live Queries, Storage portability, Contract/Exact, Diagnostics, Testing, Demo apps
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-27
**Revised:** 2026-07-28 (unreviewed post-round correction: device-bound
qualification, schema-identical activation, provisional observation, and
code-owned experimental maturity). 2026-07-28 (LLP 0108 corrective reconciliation: isolated
qualification data, complete use protocol, self-expiring family epochs, and
candidate-ledger lineage). 2026-07-28 (post-bakeoff round-2 reconciliation: registered
qualification transport and durable budgets, source-owned local publication,
hosted claim-family semantics, and capability-only revocation). 2026-07-28 (post-bakeoff round-1 reconciliation: isolated
qualification generations, signed publication carriers, target-applicable
corpus rows, and explicit create-owner refusal). 2026-07-28 (first-publication execution plan: existing-owner-only,
current-source generation, session product proof, and exact served-hosted
corpus). 2026-07-28 (schema-admission reconciliation: ordinary-table and
owner-field eligibility, exact provenance types, unique projection/order
axes, and direct bounded relation binding). 2026-07-28 (direct-artifact reconciliation: reconstructs the
existing-owner plan, provenance, and quantitative ceiling at Rust admission;
reserves create-owner until its own implementation corpus; and closes dynamic
runtime-id overclaim). 2026-07-28 (adversarial implementation reconciliation: exact-one
sealed outer result; portable scalar projections with stored-null optionals;
transaction-local active-incarnation assertions before every non-scope
read/write; protected insert stamping; dedicated Review capability
requirements/GAPs; and last-good publication refusal). 2026-07-27 (round-3 author reconciliation: exact LLP 0101-only
result dependency; retained relation-incarnation lifecycle; `sbbc1`
purpose-derived XChaCha cursor; discriminator result; total authority mapping;
canonical client-mutation-identity digest; source/no-op closure; and an honest
unpublished Review gate). 2026-07-27 (round-2 author reconciliation: protected relation
incarnation registry and automatic stamping; exact LLP 0101 dependency;
encrypted cursors with parent-version binding; canonical authority provenance;
mode-indexed effects, no-op refusal, projection/uniqueness closure, and
first-publication evidence gate). 2026-07-27 (round-1 Fable reconciliation: removes fictional range
reads, inherits the exact LLP 0043 settlement identity/codes, makes the
committed bakeoff/comparator/codegen fixtures explicit, covers public-read,
pins order/projection types and gate order, and closes relationship,
delegation, result-contract, quantitative ceiling, live-first-page, and
capability dependencies). 2026-07-27 (super-refine round-1 Codex reconciliation: narrows
children to ascending persisted execution and one-row envelopes; closes table/
scope/source authorization, incarnation/cursor/live semantics, quantitative
point-operation ceilings, settlement lifecycle, delegated provenance, result
dependency, client/capability claims, and clean Signal Desk prerequisites).
2026-07-27 (entered the author-invoked super-refine loop; initial focused
specification)
**Related:** LLP 0004, LLP 0007, LLP 0010, LLP 0012, LLP 0037, LLP 0043, LLP 0051, LLP 0053, LLP 0055, LLP 0058, LLP 0061, LLP 0065, LLP 0080, LLP 0094, LLP 0100, LLP 0101, issue `20260727-relation-and-activity-patterns`

## Summary

This Spec proposes two narrow, generated profiles:

- `bounded-children.v1` reads one explicitly authorized parent and one bounded,
  index-served page of children; and
- `write-with-activity.v1` executes a closed primary mutation and appends one
  provenance-bearing activity row in the same transaction.

Both profiles are closed data, not handler callbacks. They produce exact
arguments, results, conservative dependency/effect ceilings, capability facts,
and inspection explanations. They never infer visibility, authority,
relationship meaning, provenance, idempotency, or transaction scope from table
or field names.

This document is a proposed focused amendment to two Implemented authorities,
not a restatement of them. LLP 0080 continues to govern portable relational
value semantics, visibility noninterference, cursors, target parity, and live
authorization. LLP 0065 continues to govern generated fact classes, the
standard-pattern visibility floor, closed-plan traversal, and
`EffectCeilingV1`. This Spec only admits the one-to-many and activity shapes
those documents intentionally left out.

## Motivation

LLP 0080 admits one-to-one bounded joins and deliberately excludes a non-unique
joined side because cardinality, cursor identity, fan-out, and retained/live
semantics were not yet defined. Its first open question asks whether a
per-parent bound and compound cursor are sufficient to admit the common
one-to-many case. This Spec answers yes for one parent per invocation and an
exact child index.

LLP 0065 makes generated CRUD sound, but it does not express the common
application transaction:

1. authorize a parent or source row;
2. insert, patch, or delete application data;
3. optionally touch the parent;
4. append an audit/activity row; and
5. return one exact result, idempotently.

Signal Desk repeats both gaps. Its incident screen separately queries tasks,
comments, and activity by `incidentId`; its mutations manually coordinate the
incident, task or comment, and activity rows. The code is correct because a JS
mutation is atomic, but the relationship, activity provenance, result, and
effect ceiling are not one closed reviewable declaration.

The goal is not to hide these steps. The generated plan must make them easier to
author and more explicit to inspect.

## Amendments and authority relationships

This Spec has no normative effect while in Review. Moving it to Accepted requires
same-landing dated amendments:

1. **LLP 0080 amendment.** Its §1 exclusion of a non-unique `many` side gains a
   pointer to `bounded-children.v1` as the sole admitted one-to-many carve-out,
   and Open Question 1 is marked answered. `RelationalQueryPlanV1`,
   `root-window-v1`, and maintained projections do not change.
2. **LLP 0065 amendment.** Its standard-pattern registry gains
   `write-with-activity.v1`. Its fact classes, `owner.v1` principal admission,
   authority-bearing-table refusal, exact DTO rule, and total
   `EffectCeilingV1` traversal remain controlling.
3. **LLP 0004 and LLP 0007 amendments.** Their generated-query and conditional
   mutation sections point to these two profiles. The existing 1,024 result and
   write bounds, implicit scan-order-only `_id` index suffix, commit-version
   model, and atomicity rules are unchanged.
4. **LLP 0051 relationship.** `WriteWithActivityPlanV1` composes the closed
   mutation/value-expression vocabulary and recorded runtime answers. It does
   not add an opaque execution tier or weaken the IR boundary.
5. **LLP 0053 relationship.** Bounded child subscriptions inherit its
   authority partitions, captured dependencies, replacement obligations, and
   reconnect behavior. This Spec admits no independent retention or
   authorization-invalidation mechanism.
6. **LLP 0037 relationship.** Rust types remain the source of truth for the
   shared plan, ceiling, capability, and DTO artifact schemas. JavaScript
   authoring builders compile to those shapes.

Acceptance does not make either capability implemented. Positive stable
capability claims require the executable suite in this document.

## 1. Bounded parent/child query profile

### 1.1 Closed plan

The normalized manifest shape is `BoundedChildrenQueryPlanV1`, identified by
`profile: "bounded-children.v1"`. One invocation names exactly:

- one parent table and its typed document-id argument;
- one parent visibility declaration admitted by LLP 0080;
- an explicit flat parent projection;
- one child table;
- one schema-required, nonoptional child foreign-key field whose declared ID
  domain is the parent table;
- one schema-required, nonoptional child parent-incarnation field set only from the selected
  parent's host `(createdAt, creationVersion)` token;
- `childVisibility: { kind: "through-parent.v1" }`;
- one named child index;
- one non-empty ordered list of ascending child scalar fields;
- one explicit `take` in `0..=1024`;
- one explicit flat child projection; and
- `parentDeletion: "hide-orphans.v1"`.

There is no general join predicate. Child membership is exact typed equality
between the selected parent `_id` and the declared child foreign key. V1
admits no additional child filter, second child collection, aggregate,
grouping, callback, SQL fragment, dynamic expression, offset, or child-specific
visibility predicate.

`through-parent.v1` is an explicit security declaration, not an inference from
the foreign key. It means a child is observable through this operation exactly
when its referenced parent is observable. A child table needing independent
row visibility is outside v1 and fails generation rather than being filtered
after the page bound.

The parent visibility may be LLP 0065's `owner.v1` or LLP 0080's query-only
`public-read`. Output visibility is exactly the parent visibility; v1 provides
no declassification or widening declaration. `public-read` still grants no
write authority.

Parent and child must be ordinary application tables. Membership,
permission-backing, protected/system, maintained-projection output, retired,
or independently authority-bearing tables are rejected unless a later profile
supplies a mechanical visibility proof. Activation rechecks eligibility after
schema/projection changes; it is not inferred from field names.

`ParentIncarnationV1` is the framework-owned immutable string
`sbpi1.<base64url-no-pad(JCS({createdAt,creationVersion}))>`, where both members
are the parent's authoritative host fields at creation. It is generated once,
never accepted from a client argument, and copied into every child/profile row.
The child index compares its UTF-8 bytes for exact equality.

### 1.2 Exact index and work bound

The named child index must have declared fields exactly:

```text
[childForeignKey, childParentIncarnation, ...declaredOrderFields]
```

in the same order as the plan. Each order field is ascending,
schema-required/non-null, and must appear in the child projection (so a clear
authenticated cursor discloses no omitted value). The admitted order types are
string under binary UTF-8 order, table-scoped ID under canonical ID-byte order,
JavaScript-safe integer under mathematical integer order, and boolean under
`false < true`. Float, principal, bytes, JSON, optional/null, object, and array
order fields refuse. The exact index is declared ascending and every target
must use a forward scan; reverse scanning or a `desc` builder is outside v1.
The framework-generated ascending `_id` suffix from LLP 0007 totalizes
the order and is scan-order-only; it does not make the declared index unique.
Repeated order values are therefore valid and deterministic.

A wider, differently ordered, missing, non-portable, or target-incompatible
index declaration fails generation. Physical missing/drifted index state fails
atomic schema activation or invocation admission while retaining the previous
installed generation; offline codegen does not claim to inspect a target
catalog. V1 never selects an index by convention, adds descending metadata, or
scans/sorts the child table.

For an authorized parent, the persisted SQLite/adapter evaluator examines at
most `take + 1` entries in
the exact foreign-key range. The extra entry determines whether a continuation
exists and is not returned. `take: 0` examines no child entry and returns no
continuation. Bounds count physical range entries, not merely projected rows;
there is no post-index predicate that could hide unbounded work.

V1 is unavailable inside the buffered read-your-writes overlay because that
lane must overfetch around pending deletes/moves and cannot satisfy this
physical bound. A handler requiring relation-after-write uses explicit point
operations or a later buffered profile with separate persisted/touched/pending
costs. Capability inspection reports `persisted-online`, not universal
evaluator parity.

### 1.3 Evaluation and existence secrecy

Every admitted persisted evaluator follows this normative pipeline in one
authoritative snapshot:

```text
LLP 0058/0065 target → credential → grant-scope → authentication
  → principal/profile-class admission gates
  → validate parent-id and non-cursor argument shape
  → point-read parent
  → apply parent visibility
  → if visible: validate cursor
  → exact child range + cursor boundary + order
  → examine at most take + 1
  → project parent and children
```

Parent authorization happens before child lookup, result limiting, cursor
construction, or ordinary inspection facts. The raw decoder treats optional
`cursor` as an opaque deferred member until this point; generated TypeScript
still exposes `string | undefined`. An absent parent and an invisible parent
therefore produce the same public one-row query payload even when raw cursor
bytes are malformed:

```json
[{"parent":null,"children":[],"continuation":null}]
```

They also produce the same status, code, transport behavior, live initial
state, and ordinary inspection explanation. The internal structured trace may
distinguish `SNAPBACK_PARENT_NOT_FOUND` from
`SNAPBACK_PARENT_NOT_VISIBLE`, but only through LLP 0080's separately
authorized, scoped, and redacted audit channel.

Cursor validation occurs only after the parent is visible. Consequently an
absent and an invisible parent remain indistinguishable even when the caller
supplies a malformed cursor. A visible parent with a malformed cursor is
refused with `SNAPBACK_BOUNDED_CHILDREN_CURSOR_INVALID`.

For a visible parent the existing query wire carries exactly one computed
record row:

```ts
readonly [{
  parent: ParentProjection;
  children: ChildProjection[];
  continuation: string | null;
}]
```

This preserves the current `{version, rows}` and live-replacement protocols;
generated convenience code may unwrap `rows[0]`, but manifests, React stores,
query groups, and Contract see the exact one-row tuple. LLP 0101's
`results.records` representation validates the sealed absent/visible union.
Projection leaves use LLP 0080's flat portable result-value set: string,
boolean, JavaScript-safe integer, finite real, principal, table-scoped ID, and
their stored-null optional representation. JSON, object, array, and opaque
leaves refuse. Parent and child projections are explicit and closed; codegen does not
invent fields. The continuation is present as a string exactly when the
lookahead proves another child may remain.

### 1.4 Cursor, concurrency, and deletion

The opaque versioned cursor binds:

- the application authority domain, deployment/database, and stream identity;
- the normalized plan hash and exported function identity;
- the parent ID and incarnation `(createdAt, creationVersion)`;
- the order schema and complete boundary values, including child `_id`;
- the caller's authority partition.

`take` is plan-fixed and already bound by the normalized plan hash; it is not
duplicated as an independently decoded cursor member.

Cross-app, cross-deployment, cross-plan, cross-parent, cross-authority,
malformed, or schema-invalid cursors are refused, never repositioned.
Parent updates that change its current authorization/projection version restart
continuation; delete/recreate cannot revive old children/cursors because the
new incarnation differs. Orphan child rows remain physically stored but are
not reachable under a successor incarnation unless a later explicit migration
rewrites their relationship.

Pagination is not snapshot-consistent across calls. It guarantees no skip or
duplicate for children whose foreign key and order key are unchanged. A
concurrent insert after the boundary may appear on the next page; one before
the boundary may not. A concurrently moved or deleted child may move or
disappear. The profile states this bound and does not claim a frozen snapshot.

`hide-orphans.v1` is the only parent-deletion policy. This query profile never
cascades or deletes data. Once a parent is deleted, its former children are
unreachable through the generated operation and a continuation returns the
same sealed absent-parent result as a fresh call. Referential actions and
orphan cleanup require an explicit mutation or migration profile.

### 1.5 Live and retained classification

The generated query is callable and its **first page only** is `live_replace`
capable. A subscribe/resume request must omit `cursor`; a cursor-bearing
one-shot invocation remains callable, while a cursor-bearing subscribe/resume
refuses with `SNAPBACK_BOUNDED_CHILDREN_LIVE_CURSOR_UNSUPPORTED` before
storage work. Its captured
dependencies are:

- the parent point read, including absence;
- the child index range after the parent becomes visible;
- both table schemas and the child index; and
- every authorization-backing relation named by parent visibility.

Parent or child commits conservatively resnapshot the query. An authority
transition changes the live key and fences predecessor delivery. An absent
parent becoming visible, a visible parent becoming invisible or deleted, and
children entering or leaving the range all produce authoritative replacement.

V1 claims neither `live_delta` nor proved-disjoint invalidation. It defaults to
`retention: "none"`. A future retained or incremental profile must define
bounded parent/child membership transitions and pass LLP 0053's corresponding
convergence and lease gates.

## 2. Closed write-plus-activity profile

### 2.1 Plan shape

The normalized manifest shape is `WriteWithActivityPlanV1`, identified by
`profile: "write-with-activity.v1"`. It contains:

- exact business-argument validators;
- a visibility scope in one of the modes below;
- a closed LLP 0051 primary mutation plan;
- an explicit source-row identity binding;
- exactly one activity insert;
- an explicit provenance-field mapping;
- an explicit activity payload mapping;
- `idempotency: { kind: "client-mutation.v1" }`;
- one closed result expression and exact result validator; and
- the complete generated `WriteWithActivityEffectCeilingV1`.

The visibility scope is one of:

- `existing-owner.v1`: point-read an existing scope row and apply LLP 0065
  `owner.v1` before any primary source read or write; or
- `create-owner.v1`: the primary plan creates the scope row and must set its
  declared owner field from the canonical effective user subject.

`existing-owner.v1` collapses missing and invisible scope rows to LLP 0065's
public `SNAPBACK_ROW_NOT_FOUND` outcome before evaluating the primary plan.
`create-owner.v1` accepts no client-authored owner value.

For `create-owner.v1`, the scope and source are the same sole inserted row; its
ID is a recorded runtime answer, its owner field is a required LLP 0065
string/principal field set from the effective subject, and its
`ParentIncarnationV1` is derived from the committed host creation fields.
Another source effect is not admitted in that mode.

The primary plan is a point-operation subset of LLP 0051. It may use at most
eight total relationship point reads, counting each generated
`AssertCurrentRelation` and the selected `Get`/`Patch`/`Delete` row access,
sixteen authored `Guard`/`Let` steps, one actual source effect
(`Insert`, `Patch`, or `Delete`), one optional scope-row `Patch`, recorded
`runtime.id`/`runtime.now` answers, and the closed `ValueExpr` vocabulary. It
admits no range read, `DeleteWhere`, `InsertEach`, set-oriented step, or other
new LLP 0051 vocabulary. A plan that needs those constructs remains in the
explicit handler tier and does not claim this profile.

Every non-scope row read or written by the plan must have schema-required
`scopeForeignKey` and `scopeIncarnation` fields declared by this plan. A point
read or patch guards that both equal the selected scope ID and current
`(createdAt, creationVersion)` token before exposing or changing the row; an
insert sets both from the authorized scope and accepts neither from business
arguments. The optional scope patch targets the already authorized scope row.
No read or write may escape that relationship proof.

The plan may not write the activity table, return independently, call an
action, perform network I/O, invoke an opaque handler, or escape the closed plan
vocabulary. The helper owns the one activity insert and final return. Scope and
source may be the same table for `create-owner.v1`; source and activity, or
scope and activity, must be distinct.

The author identifies one source row affected by the plan:

```ts
source: {
  table: "tasks",
  id: binding("taskId"),
}
```

The binding must be typed as an ID for the named source table, must be defined
on every successful path, and must be the row targeted by the plan's sole
source `Insert`, `Patch`, or `Delete`. Codegen does not infer the event subject
from the first or last write, and a merely read row cannot be declared as the
source.

### 2.2 Visibility and activity information flow

The activity table and its visibility are explicit. V1 admits only:

```ts
activityVisibility: {
  kind: "through-scope.v1",
  scopeField: "incidentId",
  scopeIncarnationField: "incidentIncarnation",
}
```

The named `scopeField` must be a required ID targeting the scope table and is
also the provenance `scopeId` field; two distinct fields are not admitted.
`scopeIncarnationField` is required and stores the selected scope's
`(createdAt, creationVersion)` token. Both are framework-set and cannot overlap
business payload mappings. Reading activity through a separately declared
bounded-child operation then uses those same relationship fields and that
reading operation's own parent visibility. The write profile grants no read
authority and cannot make a later public-read declaration safe by itself.

The scope, source, and activity tables may not be membership,
permission-backing, authority-creating, or maintained-projection output tables.
A dedicated authority-changing or projection-maintenance profile is required
for those effects.

No activity update or delete authority is generated. The pattern grants one
append inside this transaction only. Other application functions remain
governed by their own explicit declarations; the activity table name itself
has no security meaning.

### 2.3 Provenance mapping

The author must map each semantic provenance slot to a required activity-table
field:

- `scopeId`: typed ID of the authorization scope;
- `sourceTable`: literal installed-table name;
- `sourceId`: the declared source-row identity;
- `operation`: stable exported function identity;
- `effectiveSubject`: canonical effective-user subject under which authority
  was evaluated;
- `actualActor`: the canonical human/service/agent actor that submitted the
  invocation;
- `actorKind`: the closed `human | agent` actor class; service principals are
  represented as `agent`, and bare `service` refuses;
- `grant`: optional canonical delegation/grant identity, present exactly when
  the authority descriptor carries one; the mapped activity property is
  schema-required and nullable, storing null when absent;
- `occurredAt`: the recorded `runtime.now` answer; and
- `mutation`: a domain-separated, non-credential digest of the durable
  settlement identity.

`scopeId` must map to the same field as `activityVisibility.scopeField`.
Field names are otherwise author-selected and schema-checked. None is inferred from names
such as `actorId`, `kind`, or `createdAt`. Provenance fields cannot be
overridden by business arguments or activity payload mappings.

The activity payload is a separate closed map of literals, arguments, bound
rows, and pinned `ValueExpr` results—for example an explicit event `kind` and
bounded human-readable `detail`. Every value is validated against the installed
activity schema. Unknown, overlapping, optional-but-unpopulated, or
type-incompatible mappings fail generation.

The effective subject and actual actor may differ under delegation; collapsing
them into one `actor` field refuses generation. The activity row ID comes from
a recorded `runtime.id` answer. The activity
insert and its ID are part of replay evidence, not ambient re-execution.

### 2.4 Idempotency and replay

Every invocation uses the durable client-mutation settlement path. Generated
web, React Native, and Expo clients use the LLP 0043 mutation queue as the
owner of persisted `clientMutationId`; this profile does not claim a second
offline store. Direct protocol callers must supply both `clientMutationId` and
the mandatory `authorityDescriptor` in the LLP 0094 mutation envelope. They
are transport metadata, not forgeable business arguments.

Settlement identity is exactly the implemented LLP 0043
`ClientMutationIdentity`: ID, function identity, auth fingerprint, authority
instance ID, and input fingerprint. The input fingerprint covers canonical
args, `readSet`, and `ctxLedger`; this profile does not replace it with an
args-only digest. The normalized activity plan and LLP 0101
`ExpectedOperationV1`/result-contract tuple are retained as settlement evidence
and as the validator for the original result, but the plan hash is not a
duplicate-refusal identity member.

The first successful invocation atomically stores its exact result and
settlement evidence with the application commit. An exact duplicate returns
the retained result bytes without re-running the primary plan, generating a new
runtime answer, or appending another activity row. Concurrent duplicates admit
at most one commit. An exact retry after a deployment or plan-hash change still
returns the originally retained, originally validated bytes, making a
response-lost commit discoverable without running either plan.

Function/payload/input-fingerprint reuse keeps the existing
`SNAPBACK_CLIENT_MUTATION_ID_REUSED` outcome; authority mismatch keeps
`SNAPBACK_AUTH_STALE_RESULT` and its discard-or-re-record guidance. A changed
plan hash with otherwise identical settlement identity is not a mismatch
because replay executes nothing. A failed or rolled-back attempt stores no
successful settlement and may be retried under LLP 0051's recorded-answer
rules. Authenticated acknowledgement and admin recovery purge retain LLP
0043's refuse-don't-evict lifecycle; activity rows are ordinary durable product
data and are not removed by settlement acknowledgement.

### 2.5 Result and effect ceiling

The author declares one LLP 0101 `results.document(...)` or
`results.value(...)` result contract over one closed scalar/record expression.
It may reference the source ID, activity ID, primary-plan bindings, and recorded
runtime answers. The Rust-owned contract, validator, JSON Schema, and
TypeScript type are one authority. The generated result must not degrade to
`unknown`; this profile cannot be advertised until the target implements LLP
0101 result validation and retained-validator replay.

The result is not published or retained as successful until the transaction
commits. The activity row is ordinary committed data and carries the same
application commit version as every source/scope write. The mutation result's
transport receipt names that version under the existing protocol; the result
expression does not synthesize it before commit.

Codegen totally traverses the primary plan, scope guard, activity insert,
provenance/payload mappings, result expression, authorization dependencies, and
settlement host operation into `WriteWithActivityEffectCeilingV1`, a closed
quantitative refinement of LLP 0065's ceiling. It records exactly:

- one scope point read and zero or one scope patch;
- zero through eight relationship-guarded point reads;
- exactly one source insert/patch/delete;
- exactly one activity insert;
- one or two `runtime.id` answers (activity plus an inserted source), exactly
  one `runtime.now`, and no other runtime answers;
- one settlement lookup and at most one successful settlement write; and
- the union of scope/source/activity table dependencies and authorization
  facts.

There are no range effects. The maximum application write count is three
(source, optional scope, activity), safely inside LLP 0007's unchanged 1,024
global ceiling. Every count is visible in inspection and encoded into the
normalized plan hash.

The runtime checks observed effects are a subset of the ceiling. Exceeding the
ceiling, failing any guard, failing result validation, or failing the activity
insert rolls back source, scope, activity, commit version, and successful
settlement together. There is no after-commit hook, best-effort activity, or
second visible version.

## 3. Generated authoring and client surface

The proposed JavaScript helpers are:

```ts
export const incidentTasks = defineBoundedChildrenQuery({
  parent: {
    table: incidents,
    idArg: "incidentId",
    visibility: owner("commanderId"),
    select: { id: "_id", title: "title", updatedAt: "updatedAt" },
  },
  children: {
    table: tasks,
    foreignKey: "incidentId",
    parentIncarnation: "incidentIncarnation",
    visibility: throughParent(),
    index: "by_incident_position",
    order: [asc("position")],
    select: {
      id: "_id",
      body: "body",
      completed: "completed",
      position: "position",
    },
  },
  take: 100,
  parentDeletion: "hide-orphans.v1",
});
```

The generated arguments are exactly `{ incidentId, cursor? }`, and the
generated result is the sealed parent/page union from §1.3.

```ts
export const addTask = defineWriteWithActivity({
  args: {
    incidentId: v.id("incidents"),
    body: v.string(),
  },
  scope: existingOwner({
    table: incidents,
    id: arg("incidentId"),
    visibility: owner("commanderId"),
  }),
  primary: mutationPlan(/* closed, inspectable steps */),
  source: { table: tasks, id: binding("taskId") },
  activity: {
    table: activity,
    visibility: throughScope({
      scopeField: "incidentId",
      scopeIncarnationField: "incidentIncarnation",
    }),
    provenance: {
      scopeId: "incidentId",
      sourceTable: "sourceTable",
      sourceId: "sourceId",
      operation: "operation",
      effectiveSubject: "effectiveSubject",
      actualActor: "actualActor",
      actorKind: "actorKind",
      grant: "grantId",
      occurredAt: "createdAt",
      mutation: "mutationDigest",
    },
    values: {
      kind: literal("task.added"),
      detail: arg("body"),
    },
  },
  idempotency: clientMutation(),
  result: results.value(record({
    taskId: binding("taskId"),
    activityId: binding("activityId"),
  })),
});
```

These examples are illustrative builder spellings. The Rust-owned normalized
plan and artifact schemas, not helper implementation details, are normative.

Codegen emits:

- generated function references with exact Args and Result phantom types;
- operation argument and result JSON Schemas;
- normalized plans and hashes;
- complete read/write/authorization/effect ceilings;
- capability requirements and target support/GAP facts;
- provider and Contract descriptors with the exact result and live class;
- cursor metadata for bounded child pages;
- idempotency and provenance facts for activity mutations; and
- concise inspection explanations listing the ordered query pipeline or
  atomic mutation steps.

Inspection may name tables, indexes, projections, mappings, bounds, and reasons
for replacement. It must not reveal an invisible parent, child values,
business arguments, activity detail, client mutation IDs, or the hidden
missing-versus-invisible trace distinction.

## 4. Portability and capability publication

The pure evaluator, persisted SQLite executor, and every hosted target claiming
either profile consume the same normalized Rust-owned plan and canonical
corpus. The buffered read-your-writes overlay is an explicit GAP for
`bounded-children.v1`; client arms may call the online executor but do not
execute either profile locally.

A target may publish:

- `bounded_children_v1`;
- `write_activity_v1`; or
- neither, with a structured GAP.

`write_activity_v1` additionally reports exact dependencies on
`result_contract_v1` and the LLP 0043 durable client-mutation settlement
profile. Missing or incompatible dependencies make
the capability unavailable rather than degraded.

Support is per target/profile version and initially `experimental`. It becomes
`stable` only in the same landing that records every applicable executable
witness below. A target that cannot provide exact index work bounds, sealed
authorization behavior, one-version atomicity, durable idempotency, or exact
result/effect artifacts refuses before invocation. It may not fall back to a
table scan, client-side grouping, opaque JS handler, post-commit activity hook,
or multi-transaction emulation.

SQLite and future Postgres/Cloudflare implementations may use different
physical plans only when instrumented evidence proves the same value,
ordering, work-bound, transaction, and replay contract.

## 5. Diagnostics

Generation is deterministic and preserves the prior known-good output tree on
failure. Stable authoring diagnostics include:

- `SNAPBACK_BOUNDED_CHILDREN_PLAN_INVALID`;
- `SNAPBACK_BOUNDED_CHILDREN_VISIBILITY_REQUIRED`;
- `SNAPBACK_BOUNDED_CHILDREN_INDEX_REQUIRED`;
- `SNAPBACK_BOUNDED_CHILDREN_ORDER_INVALID`;
- `SNAPBACK_BOUNDED_CHILDREN_BOUND_INVALID`;
- `SNAPBACK_BOUNDED_CHILDREN_TARGET_UNSUPPORTED`;
- `SNAPBACK_ACTIVITY_PATTERN_INVALID`;
- `SNAPBACK_ACTIVITY_TABLE_INELIGIBLE`;
- `SNAPBACK_ACTIVITY_VISIBILITY_REQUIRED`;
- `SNAPBACK_ACTIVITY_PROVENANCE_REQUIRED`;
- `SNAPBACK_ACTIVITY_IDEMPOTENCY_REQUIRED`;
- `SNAPBACK_ACTIVITY_RESULT_INVALID`; and
- `SNAPBACK_ACTIVITY_EFFECT_CEILING_EXCEEDED`.

Stable public runtime diagnostics include:

- `SNAPBACK_BOUNDED_CHILDREN_CURSOR_INVALID`;
- `SNAPBACK_BOUNDED_CHILDREN_LIVE_CURSOR_UNSUPPORTED`;
- inherited `SNAPBACK_ROW_NOT_FOUND` for collapsed missing/invisible mutation
  scope;
- inherited `SNAPBACK_CLIENT_MUTATION_ID_REUSED` and
  `SNAPBACK_AUTH_STALE_RESULT`; and
- the existing structured conflict/result/effect refusal classes inherited
  from LLP 0051 and LLP 0065.

`SNAPBACK_PARENT_NOT_FOUND` and `SNAPBACK_PARENT_NOT_VISIBLE` are
audit-channel-only distinctions. Public diagnostics must not contain row
values, activity payloads, raw client mutation IDs, or visibility-predicate
outcomes.

`VISIBILITY_REQUIRED` fires only when the parent visibility or the exact
`through-parent.v1` child declaration is missing. An authored child predicate,
declassification/output-visibility member, or unsupported visibility kind is a
general `PLAN_INVALID`; there is no separate widening diagnostic because v1
has no widening state. `SNAPBACK_ACTIVITY_EFFECT_CEILING_EXCEEDED` is the
generation/activation refusal for an authored maximum outside the closed
profile; a runtime observation outside an installed ceiling uses LLP 0065's
existing effect refusal and rolls back.

## 6. Implementation sequence

1. Run the LLP 0005 review loop required by the issue, reconcile this text, and
   land the dated LLP 0080/0065/0004/0007 amendments named above before
   semantic acceptance.
2. Add Rust-owned plan, provenance, idempotency, result, ceiling, capability,
   and public-inspection types; regenerate committed schemas and install drift
   tests.
3. Add the pure canonical evaluators and corpora first, including ordering,
   cursor, secrecy, replay, and exact ceiling vectors.
4. Add codegen builders, closed-plan validation, generated refs, operation
   schemas, provider/Contract projection, artifact summaries, and
   preserve-prior-output failure tests.
5. Implement the SQLite query executor and transactional mutation/settlement
   path with examined-entry and commit-version instrumentation; then add
   first-page live integration while publishing the buffered GAP.
6. Add each hosted executor only after it passes the same corpus. Publish GAPs
   for targets not yet conformant.
7. Migrate Signal Desk, update its diary and guide-gap ticket if necessary,
   update the relevant Guide pages and capability index, and run the full
   acceptance suite.
8. Run the LLP-maintain corpus audit and promote capability/status claims only
   when their receipts are committed.

## 7. Signal Desk proving use

Signal Desk is the required first product fixture. The same implementation
landing first imports the working-copy `demos/backend-bakeoff` and Diary 0022
into this repository, so every witness below is runnable from a clean checkout.
The comparator-acceptance-kit and codegen-review-surface tickets are committed
prerequisites, not assumed future machinery:

- incident → tasks uses `defineBoundedChildrenQuery` with
  `by_incident_position`;
- incident → comments uses it with `by_incident_created`;
- incident → activity uses it with ascending `by_incident_sort_key`;
- the all-row feeds and adapter-side grouping used only to compensate for the
  missing relation surface are removed where the shared product contract
  permits;
- at least `addTask` uses `defineWriteWithActivity`, including incident
  authorization/touch, task insert, activity append, exact
  `{ taskId, activityId }` result, and durable idempotency; and
- the schema gains explicit owner/relationship/incarnation/provenance fields
  required by the profiles rather than relying on `commanderId`, `actorId`, or
  `incidentId` naming conventions.

The migration must retain the comparison's evidence: native cross-client
replacement, primary/activity atomicity, rollback on injected failure, precise
generated types, and inspectable ceilings. The diary records declaration/glue
reduction separately from any auth/schema work the stronger profile requires.

## 8. Executable acceptance

Semantic acceptance requires a completed LLP 0005 review and the named
same-landing amendments. `Implemented` and stable capability claims require one
machine-readable conformance report mapping every item below to a test and
every claimed target/profile version.

### 8.1 Bounded children

- A shared corpus produces byte-identical projected results and continuations
  through the pure evaluator, SQLite, and every claimed hosted evaluator;
  buffered inspection reports its structured GAP.
- Missing parent, invisible parent, and each paired database differing only by
  an unauthorized parent produce byte-identical public result, code, status,
  transport, live initial state, and ordinary inspection output, including
  with a malformed cursor.
- Cross-owner calls cannot observe parent or child bytes. Parent visibility is
  evaluated before any child index read, limit, continuation, or ordinary
  inspection fact, as proved by instrumented operation order.
- Anonymous and authenticated `public-read` fixtures return the same authorized
  parent/children, confer no mutation authority, bind cursors to their exact
  anonymous/authenticated authority partitions, and fence a partition change.
  An absent public parent returns the sealed absent result; public-read has no
  invisible-parent branch.
- Missing, wider, misordered, wrong-domain, non-binary, and non-portable child
  index declarations fail generation with the stable index/order diagnostic
  while preserving the prior generated tree; an unapplied/drifted physical
  index fails activation or invocation admission while retaining the prior
  installed generation.
- Large duplicate-order-key and sparse-parent corpora prove deterministic
  `_id` totalization and at most `take + 1` examined child entries; `take: 0`,
  `take: 1`, `take: 1024`, and 1,025 children cover the boundaries.
- Pagination refuses malformed, cross-app, cross-deployment, cross-plan,
  cross-parent, cross-authority, and invalid-boundary cursors. Concurrent
  insert, delete, and order-key movement witness exactly §1.4's guarantees and
  no stronger snapshot claim.
- Parent deletion leaves child rows physically untouched, makes fresh and
  continued reads return the sealed absent-parent result, and cannot expose an
  orphan through the helper.
- A two-instance live test proves parent create/update/delete and child
  insert/update/delete trigger authoritative replacement, authority rotation
  fences predecessor delivery, a cursor-bearing subscribe refuses before
  storage, and artifacts claim first-page `live_replace` but neither
  `live_delta` nor retention.
- Generated API, provider, Contract, and operation schemas agree on exact args,
  parent/child projections, nullable sealed parent, children array, and
  continuation without casts or `unknown`.

### 8.2 Write plus activity

- One create-scope fixture and one existing-scope fixture produce the exact
  normalized plan, provenance mapping, result schema, and
  `WriteWithActivityEffectCeilingV1` expected by golden artifacts.
- Cross-owner, missing-scope, client-owner-forgery, authority-bearing-table,
  projection-output-table, missing provenance, overlapping mapping, unbound
  source identity, activity-table primary write, independent return, and
  out-of-ceiling cases fail with their specified public or authoring outcome.
- On success, source/scope/activity rows share one commit version and
  subscribers observe one changeset. The activity row carries the exact scope,
  scope incarnation, source table/id, operation, effective subject, actual
  actor/kind, optional grant, recorded time, and settlement digest. Delegation
  fixtures prove actual actor and effective subject are not collapsed.
- Fault injection before the primary write, between primary writes, before the
  activity insert, during activity validation, after activity insert, during
  result validation, and before commit leaves no source, scope, activity,
  version, or successful-settlement residue.
- Sequential and concurrent replay of one exact client mutation commits once,
  appends one activity row, consumes recorded ID/time answers once, and returns
  byte-identical retained results. Existing payload/function and authority
  mismatches retain their LLP 0043 codes; an exact retry across a plan-hash
  deployment returns the original result without executing.
- Exact ceiling tests cover 1/8 point-read boundaries, source insert/patch/
  delete, optional scope patch, the mandatory activity insert, 1/2 runtime-ID
  answers, settlement operations, and the maximum three application writes;
  every observed read/write/host operation is a subset of the generated
  ceiling.
- Result fixtures cover scalar and record expressions, source/activity IDs,
  result validation before publication, provider/Contract/generated-ref type
  agreement, and durable replay without caller-selected generics.
- The canonical mutation corpus passes every claimed executor; unsupported
  targets publish a structured GAP rather than a positive capability or
  fallback execution.
- Anonymous, bare-service, delegated-agent, and ordinary-user callers cover
  inherited principal admission on both profiles. `write-with-activity.v1`
  remains online-only and every supported first-party client obtains
  `clientMutationId` from the LLP 0043 queue owner.

### 8.3 Product and documentation

- The committed Signal Desk fixture uses all three bounded child relations and at least one
  write-plus-activity flow described in §7, deletes the superseded manual glue,
  and passes its native comparison acceptance suite.
- The Signal Desk diary records what became easier, what explicit security or
  provenance declarations cost, and the comparison against its prior Snapback,
  Convex, and Supabase implementations.
- The Guide documents both helpers, their index/visibility/idempotency
  requirements, cursor and deletion semantics, diagnostics, target GAPs, and
  generated types with CI-verified snippets.
- Capability and codegen summaries report relation count, per-parent bounds,
  live class, activity patterns, exact/degraded result counts, and direct
  remediation links.
- `./ref-check --verbose`, Guide checks, schema drift tests, package tests,
  native tests, the installed comparator acceptance kit, codegen review-surface
  proof, and the LLP-maintain pre-demo audit are green from a clean checkout.

## Non-goals

- arbitrary one-to-many joins, multiple parents per invocation, nested
  relation trees, many-to-many traversal, aggregates, or client-side joins;
- independently visible children or post-limit authorization filtering;
- offset pagination, frozen cross-page snapshots, retained child collections,
  or incremental relation deltas;
- referential constraints, cascade deletion, or orphan cleanup;
- generic event sourcing, mutable audit logs, activity analytics, outbox
  delivery, or cross-service side effects;
- inferred actors, event kinds, source rows, visibility, or transaction
  boundaries;
- opaque JS/WASM callbacks inside either plan; and
- claiming target portability from a shared type alone without executable
  corpus evidence.

## Open questions

1. After v1 evidence, should a child profile admit independent owner visibility
   by requiring an authorization-serving compound index before the order
   fields, or remain through-parent-only?
2. Should a later multi-parent profile return one independently bounded page
   per parent, or require separate generated invocations to keep work and cursor
   identity obvious?
3. Does activity provenance eventually warrant a framework-owned system
   envelope instead of explicit application-table fields, and how would that
   remain exportable?
4. Which measured Signal Desk mutation, if any, needs a primary-plan construct
   beyond LLP 0051's closed vocabulary rather than staying in the explicit
   handler tier?

## Final author reconciliation after round 2

This section is normative where it conflicts with earlier text.

### Protected relation incarnation and stamping

`ParentIncarnationV1` is not derived from a nonexistent host creation-version
field. Local SQLite owns the protected registry:

```text
_snapback_relation_incarnations_v1(
  table_name TEXT,
  row_id TEXT,
  incarnation TEXT,
  active INTEGER,
  PRIMARY KEY(table_name, row_id, incarnation)
)
```

`incarnation` is a host-minted canonical UUIDv7. Every insert into a table
named as a bounded-children parent creates one active incarnation in the same
transaction; delete marks it inactive; reusing the application id creates a
new incarnation. Patch preserves it. Restore preserves the carried active
registry transactionally; legacy import/backfill must create one incarnation
per current parent before the capability can activate.

The child schema declares a framework-owned
`relationIncarnationOf {foreignKeyField, parentTable}` field. It is not an
application argument or projected writable field. Every central write path,
including plans, JS handlers, seed, import, migration, and buffered execution,
looks up the current parent and overwrites this protected field whenever the
foreign key is inserted or changed. Direct attempts to supply or patch it
refuse. Deletes need no stamp. Capability activation refuses unless every
writer passes the shared stamping corpus and every existing child has exactly
the current parent's incarnation. Adopting an existing relation therefore
requires an explicit reviewed backfill migration; no row is silently blessed.

This is the same-lifecycle amendment to LLP 0007/0037 required by the profile.
It closes delete/recreate isolation without overloading `_version`,
`_createdAt`, or an application `createdAt` field.

### Cursor and result closure

LLP 0101 now exists in this corpus. The profile consumes its final-author
result-contract slice: the bounded-children row is a computed record, the
activity result is its exact document/value contract, and no new
ExpectedOperation carrier or cross-deployment settlement evidence is added.
Existing LLP 0043 settlement identity, caps, replay, ACK, and purge remain
unchanged.

The bounded-children projection must include the child `_id` plus every order
field. The continuation is an AEAD-protected `sbbc1` credential using the
shared cursor keyring custody but its own mutually prefix-free registry entry,
1,024-byte wire cap, 14-day maximum age, and the standard mint-failure refusal.
Its plaintext additionally binds the current parent `_version`; any parent
patch, policy/projection change, restore, or incarnation change returns the
single restart diagnostic. Top-level `QueryOutput.cursor` is absent for this
profile because first-page live replacement must carry `continuation` inside
the one computed row. The live-envelope authority gains the explicit
computed-record row carve-out; it does not require a row-level durable `_id`.

Ordering compares each scalar under LLP 0051 canonical value order and then
the child `_id` by its exact UTF-8 byte sequence. Cross-language golden vectors
own the encoding.

### Authority, provenance, and uniqueness

Provenance is derived only from server-prepared `ResolvedAppAuthority` after
credential/grant admission:

- `effectiveUserId` is the canonical effective principal;
- `actorUserId` is the actual actor principal;
- `actorKind` is exactly LLP 0055's closed `human | agent` set;
- `grantId` is present exactly when the resolved actor carries one; and
- direct human, delegated agent, and admitted dev-impersonation mappings are
  explicit, while bare/autonomous service authority refuses this profile.

No authority fact is accepted from the transport descriptor or arguments.
Activity/source tables must scope every client-observable unique constraint by
the same `(scopeId, relationIncarnation)` prefix, or name a separately reviewed
disclosure. The default profile admits only the partitioned form; paired-store
tests prove that another scope's conflicting value cannot be observed.

The activity mutation digest is lowercase SHA-256 over:

```text
UTF8("snapback:write-with-activity:v1\n") || RFC8785_JCS({
  profile, operation, sourceTable, sourceId, activityTable,
  effectiveUserId, actorUserId, actorKind, grantId
})
```

with JSON null for absent `grantId`.

### Total effect formulas

The admitted modes have separate closed ceilings:

- `create-owner.v1`: zero scope reads/patches, zero relationship-guarded
  auxiliary reads, exactly one created source row, exactly one activity row,
  and the fixed host/projection bookkeeping;
- `existing-owner.v1`: exactly one visible scope point read; zero or one
  relationship-guarded scope patch; zero through eight guarded auxiliary point
  reads, counting the implicit reads of every patch/delete; exactly one
  changed source row; exactly one activity row; and fixed bookkeeping.

Create mode admits no pre-existing relationship read. Existing-source patch
must be nonempty; patch/delete first performs a relationship-guarded point read
and refuses if missing; execution verifies the declared source table, id,
operation, and exactly one changed row before activity insertion. A no-op or
missing source rolls back and appends no activity or settlement.

Piggyback acknowledgement remains LLP 0043's separate bounded transaction and
is reported outside this profile's atomic effect receipt. Tables participating
anywhere in an active maintained projection—root, join source, or output—are
ineligible until a later profile totalizes that fan-out. The conformance
manifest tests both formulas at every minimum/maximum, ACK-success followed by
primary refusal, and every no-op/missing path.

### First-publication gate

Neither experimental nor stable positive capability may be published until
the committed Signal Desk fixture, exact LLP 0101 result contracts, comparator
kit, codegen review-surface proof, Guide/diary, clean package install, paired
authorization stores, cursor disclosure tests, relation backfill/restore
tests, projection exclusions, uniqueness tests, and complete effect corpus all
pass without skips. Targets missing any witness report a structured GAP and
do not advertise the profile.

## Final author reconciliation after round 3

This section is normative where it conflicts with any earlier section,
including the round-2 reconciliation.

### Result and settlement dependency

There is no `ExpectedOperationV1` dependency, carrier, capability, or replay
axis. Both profiles consume LLP 0101's frozen `result_contract_v1` validator
and hash. Write replay remains exactly LLP 0043's durable
`ClientMutationIdentity`, retained result bytes, result-contract hash,
65,536-byte admission boundary, ACK, purge, and garbage-collection lifecycle.
The conformance matrix must cover 65,536/65,537, frozen-validator replay,
activity survival after ACK/purge, and the documented loss of replay after
purge; it may report zero skipped cases only when publishing a capability.

The bounded result is a one-row discriminator union:

```ts
type BoundedChildrenRow<P, C> =
  | { kind: "absent"; parent: null; children: readonly []; continuation: null }
  | {
      kind: "visible";
      parent: P;
      children: readonly C[];
      continuation: string | null;
    };
```

Rust validates this same refinement before publication. Missing and invisible
parents return byte-identical `absent` rows, including when a malformed cursor
was supplied; only a visible parent can reach cursor validation.

### Relation registry lifecycle

For each `(table_name, row_id)` there are zero or one active registry rows.
Deleting a parent marks its active row inactive but retains that row as
historical orphan identity; delete performs no cascade, restrict, or other
referential action. Recreating the application id mints a new active UUIDv7.
Activation and restore validate both directions: every current parent has
exactly one active registry row, and every participating child stamp equals
the active registry row of a physically present parent. Legacy or dangling
rows require an explicit backfill/reconciliation; activation never silently
adopts them.

Every central writer—plan, inline/JS buffered commit, seed, migration, import,
and restore—uses the same protected stamping boundary. An insert or
foreign-key move to a missing or inactive parent refuses with the one stable
public `SNAPBACK_RELATION_PARENT_UNAVAILABLE` outcome. Direct insert or patch
of the stamp refuses with
`SNAPBACK_RELATION_INCARNATION_WRITE_PROTECTED`. Fixtures cover missing,
inactive, dangling, delete/recreate, buffered-pending, restore, and backfill
states.

### `sbbc1` cursor protocol and restart precedence

The bounded cursor is:

```text
sbbc1 "." BASE64URL_NO_PAD(
  nonce[24] || XChaCha20Poly1305(
    HKDF-SHA256(resumeRoot, "snapback:bounded-children-cursor:xchacha20:v1",
                keyGeneration),
    nonce,
    plaintext,
    aad
  )
)
```

Its maximum wire length is 1,024 bytes. The nonce is freshly random for every
mint. AAD is a length-framed purpose, app, database, and target-profile tuple.
Plaintext is a closed, unknown-field-denying record containing format and key
generation, app/database/target, authorization stream/restore epoch, function
and normalized plan hash, parent id/incarnation/current `_version`, authority
partition, complete order-field identity, boundary values, child `_id`,
issuance, and expiry. The maximum age is 14 days, no longer than retired
resume-root verification custody. Key retirement outside that overlap makes a
cursor invalid; mint failure refuses the page rather than falsely reporting a
terminal page.

After parent visibility succeeds, the runtime resolves the current registry
incarnation, then decrypts and validates. Cryptographically valid credentials
whose stream/restore epoch, parent incarnation, or parent `_version` changed
return `SNAPBACK_BOUNDED_CHILDREN_PARENT_RESTART_REQUIRED`. Cross-app,
database, target, function, plan, parent id, authority partition, order schema,
malformed, expired, retired-key, or boundary-type failures collapse to
`SNAPBACK_BOUNDED_CHILDREN_CURSOR_INVALID`. Parent restart takes precedence
only after a credential has authenticated for the current app/database/target;
unauthenticated bytes never choose a more specific outcome.

The executor uses the exact index range and lexicographic
`(order fields..., _id)` keyset. It fetches at most `take + 1`; `take: 0`
performs no child read and returns no continuation. Only cursor-free first
pages are live, at `live_replace` granularity. Cursor-bearing subscribe/resume
refuses before storage; no `live_delta`, retained collection, or proved-
disjoint invalidation is claimed.

### Source effect, provenance, and digest

`scope`, `source`, and `activity` are distinct identities even when a future
mode allows scope and source to share a table. The declaration names one exact
source operation (`insert | patch | delete`), and execution verifies exactly
one matching changed row before the activity insert. A patch is an effect only
when its final stored application fields differ exactly; empty and
storage-equal patches, missing patch/delete targets, and a mismatched
operation roll back with `SNAPBACK_ACTIVITY_SOURCE_EFFECT_REQUIRED`. The
activity row is never appended for an asserted no-op.

Authority provenance is total and fail-closed:

- admitted session authority maps effective and actual user to the session
  user, actor kind `human`, and null grant;
- admitted delegated service authority requires an effective user, maps the
  service actor as actual actor, actor kind `agent`, and its admitted grant;
- anonymous, admin bypass, system, autonomous/bare service, and
  dev-impersonation authority refuse with
  `SNAPBACK_ACTIVITY_AUTHORITY_UNPROVENANCED`.

No transport or application argument may supply those facts.

The activity mutation digest is provenance-only SHA-256 over:

```text
UTF8("snapback:client-mutation-identity:v1\n") ||
RFC8785_JCS({
  authFingerprint,
  authorityInstanceId,
  clientMutationId,
  function,
  inputFingerprint
})
```

The server constructs that exact identity after authority admission. The
cleartext client mutation id and fingerprints are not copied to activity.
Invoking this profile without an LLP 0043 client mutation identity refuses
with `SNAPBACK_ACTIVITY_CLIENT_MUTATION_REQUIRED`.

Generated effect receipts report application effects separately from framework
settlement/authorization bookkeeping. They include the exact scope reads and
patches, auxiliary point reads (including implicit patch/delete reads), one
source effect, one activity insert, runtime ids/time, settlement lookup/write,
and the maximum application writes for the selected mode. Tables that
participate anywhere in an active maintained projection are ineligible, and
every client-observable unique index on source or activity begins with the
declared `(scope id, relation incarnation)` partition.

### Round-3 disposition and dissent

The reviewers converged on the contracts above but did not authorize a
capability claim from type/code presence alone. The implemented landing may
ship protected relation stamping, the local persisted executor, AEAD cursor,
closed activity plan, exact operation assertion, and generated result/effect
artifacts while this document remains **Review**.

The remaining dissent is evidence, not semantics: the complete paired-store
noninterference corpus, restore/backfill vectors, cross-language cursor golden
vectors, all fault-injection cuts, 65,536/65,537 retained-result matrix,
first-party queue-owner coverage, hosted target corpus, and full Signal Desk
product migration must all be committed and green before either positive
capability appears. Until then capability manifests and the Guide capability
index report structured GAPs; no experimental shortcut is permitted.

## Implemented landing evidence — 2026-07-27

The local implementation described by this Spec is present and its
repository-scoped gates are green. This evidence does not change the Review
status or publish either capability:

- `node packages/snapback-codegen/relation-activity-authoring.test.mjs`
  proves the exact relation marker/index plan, generated active-incarnation
  assertions for every non-scope operation, protected insert stamping, source
  assertion, activity append, exact-one sealed LLP 0101 result, quantitative
  effect formula, and transactional refusal against both Review capability
  GAPs;
- `node packages/snapback-codegen/provider-introspection.test.mjs` proves the
  literal/array/union result refinements used by the bounded discriminator;
- `cargo test --lib
  storage::guarded_commit_tests::relation_incarnation_is_protected_and_delete_recreate_isolated
  -- --exact` proves central stamping, direct-write refusal, uniform
  missing/inactive-parent refusal, and delete/recreate isolation;
- `cargo test --lib
  storage::guarded_commit_tests::write_with_activity_source_assertion_is_atomic_and_replay_safe
  -- --exact` proves one commit version, exact replay, storage-equal no-op
  refusal, rollback, and absence of a retained settlement on refusal;
- `cargo test --lib
  bounded_children_cursor::tests::cursor_round_trip_tamper_and_purpose_binding
  -- --exact` proves the AEAD round trip, tamper refusal, and purpose binding;
- `cargo test --lib
  server::tests::s5_d10_all_emitted_diagnostics_have_reviewed_http_status
  -- --exact` proves every new public refusal is deliberately classified;
- `cargo check --tests` is green; and
- Signal Desk keeps the three bounded collection declarations and two closed
  activity declarations as the required first-party Review fixture. Because
  both declarations now carry dedicated unsupported target requirements,
  ordinary codegen refuses publication and preserves its last-good generated
  tree until this Spec's publication gate is accepted.

Signal Desk's browser product path continues to use its explicit JS activity
mutation because the shared demo persona is not backend-specific session
custody. The direct acceptance path now exercises the closed activity plan
with a real session. Delegated authority and a first-party durable queue owner
were publication-evidence gates, not missing local executor paths; the
repository-local matrix below now closes the queue-owner row while the hosted
and product-path gates remain.

## Repository-local publication matrix extension — 2026-07-27

The machine-readable receipt at
`tests/conformance/relation-activity-publication-v1.receipt.json` now closes the
remaining non-hosted evidence rows without changing the publication boundary:

- paired authorization stores differing only in an unauthorized parent's
  bytes return byte-identical visible and absent payloads; a unique index
  scoped by `(parent id, relation incarnation)` admits the same business key
  in another scope and refuses a duplicate in the same scope;
- activation now validates the registry lifecycle in both directions. The
  executable matrix covers seed, buffered insert and foreign-key move, reset,
  backup/restore preservation, missing-registry refusal, an explicit
  migration-privileged parent/child backfill, and dangling-active refusal;
- one fixed-nonce `sbbc1` vector is reproduced independently by Rust and Node,
  including HKDF, length-framed AAD, XChaCha20-Poly1305, exact body bytes, and
  integer/binary-UTF-8/boolean/`_id` boundary ordering;
- the persisted executor covers malformed, cross-function, cross-parent,
  cross-authority-partition, and cross-database cursors, concurrent inserts on
  both sides of a boundary, delete and order-key movement, parent-version
  restart, parent deletion, cursor-bearing live refusal, and child/parent
  `live_replace` with no delta claim;
- source/activity execution now has explicit rollback witnesses before the
  source, after the source, before the activity insert, after the activity
  insert, before commit, during activity validation, and during result
  construction;
- the retained output boundary admits exactly 65,536 serialized bytes and
  rolls back source, activity, version, and settlement at 65,537. Exact replay,
  authenticated ACK, administrative purge, activity survival, and the
  documented loss of replay after reclamation are one executable lifecycle;
  and
- Node exercises the shared LLP 0043 queue as the non-caller-selected mutation
  identity owner for the web, React Native, and Expo first-party arms.

The receipt deliberately records publication as **blocked** and both capability
facts remain false. The residual gates are the hosted target corpus, full
Signal Desk product-path adoption, and author acceptance (or an explicit
decision to narrow the public profile).

## Adversarial closure evidence — 2026-07-28

This reconciliation closes four implementation gaps without accepting the
Spec:

- `bounded-children.v1` carries `rows: { minItems: 1, maxItems: 1 }` from the
  Rust-owned result contract through the shared JavaScript validator,
  provider/operation descriptors, generated API types, provider types, and
  Contract metadata. Zero or two rows fail at the runtime result boundary;
  generated TypeScript exposes `readonly [Row]`.
- The row is a discriminator-sealed union. `absent` fixes `parent`,
  `children`, and `continuation` to `null`/empty; `visible` carries the bounded
  projections. Leaves are `_id` or LLP 0104 portable scalars only. Stored
  optionals remain present `null | Scalar` keys.
- `write-with-activity.v1` requires one explicit relationship declaration for
  every non-scope primary table. Inserts cannot author either protected
  relationship field. Before each selected `Get`, `Patch`, or `Delete`, the
  generated `AssertCurrentRelation` executes inside the commit transaction
  and proves the row foreign key and protected stamp equal the selected scope
  and its *current* active registry incarnation. Missing, cross-scope, and
  stale-orphan rows all answer `SNAPBACK_ROW_NOT_FOUND`; delete/recreate with
  the same parent id cannot revive a historical child for patch or deletion.
- Function requirements now name `bounded_children_v1` and
  `write_activity_v1`. Both registry entries are Proposed, unsupported by all
  committed targets, and emitted as structured GAPs. A generation attempt
  preserves the last-good graph rather than laundering either Review profile
  into a positive capability claim.
- Rust admission reconstructs the generated `existing-owner.v1` prefix,
  source operation, relationship assertions, final provenance-bearing append,
  Guard/Let bound, return-expression class, and every quantitative effect
  count. A direct artifact cannot add a scope insert/delete/read, move the
  source assertion, submit an empty source patch, alias protected incarnation
  storage with provenance, forge activity actor fields, or understate its
  reads and writes while retaining the profile discriminator.
- `runtime.id` remains host-owned by the source/activity insert allocations.
  Authoring and direct artifacts reject an additional `RuntimeId` expression
  in primary values, guards, lets, activity payloads, or results; repeated
  `runtime.now` references continue to name the transaction's one recorded
  answer. The existing insert-versus-patch/delete formula is therefore exact.
- The `create-owner.v1` discriminator remains reserved rather than being
  accepted by a generic direct manifest. The first publication candidate is
  explicitly `existing-owner.v1`; create-owner requires a generated evaluator
  and its own corpus before admission can turn positive.
- Authoring and Rust activation both bind the bounded parent/child foreign
  key, protected incarnation, order fields, index boundary, and projected
  boundary leaves to ordinary non-permission-backing tables. Projection output
  names and order fields are unique, and maintained-projection outputs cannot
  be smuggled into the profile by a direct manifest.
- Write/activity activation proves the scope owner is a required
  string/principal, every scope/source/relation/activity table is ordinary and
  not a maintained-projection output, and each mapped provenance field has its
  semantic storage type. In particular the scope is an exact typed ID, subject
  fields are string/principal, occurrence time is integer, and the optional
  grant carrier remains string-typed.
- Runtime profile shape implies its function-level capability requirements:
  a bounded-child artifact must be a `LiveQuery` carrying both
  `bounded_children_v1` and `live_subscriptions`, while write/activity carries
  `write_activity_v1`. The plan-local discriminator cannot launder an omitted
  function requirement past target gating. The same implication check covers
  the established search and relational host profiles.
- The specialized write/activity expression walk rejects not only extra
  `RuntimeId` allocation but also authoritative-only membership expressions
  in steps and returns. Membership reads require a separately modeled
  authorization profile and cannot hide outside this profile's quantitative
  relationship-read formula.

## First-publication execution plan — 2026-07-28

This section is normative where it narrows the implementation sequence above.
It records the post-bakeoff audit plan and does not itself publish either
capability.

The first publication contains exactly:

- `bounded-children.v1` as the cursor-free-first-page `LiveQuery` profile; and
- `write-with-activity.v1` in `existing-owner.v1` mode only.

`create-owner.v1` remains a reserved, rejected discriminator. No codegen,
manifest, capability, Guide, or receipt may describe it as supported until a
separate generated evaluator and corpus exist.

Publication is one atomic repository generation:

1. the direct-artifact admission suite proves the plan-implied function
   capabilities, exact-one sealed result, nominal relation/index/projection
   binding, current-incarnation authorization, ordinary-table eligibility,
   provenance storage types, required insert coverage, total effect formula,
   and refusal of runtime-id or authoritative membership escapes;
2. Signal Desk generates from source with the current binary—never from its
   pre-hardening last-good manifest—and all three bounded collections plus the
   existing-owner activity mutation appear in the installed graph;
3. a session-authenticated Signal Desk product flow creates one task through
   the generated activity mutation, observes the bounded task and activity
   replacements, proves exact replay, and proves rollback. The shared
   development-persona comparison may remain a separately labeled
   authentication nonclaim, but it cannot substitute for this session path;
4. the target-neutral relation/activity receipt passes on the local persisted
   executor and on the exact immutable Fly release that will advertise the
   hosted target. The hosted row invokes the public origin and reopens served
   capability/function/schema identities; running the local corpus inside a
   remote-shaped harness is insufficient;
5. generated API/provider/Contract artifacts, Guide snippets, capability
   index, diary, and comparison receipt are regenerated together; and
6. a clean package install and current-source comparator pass before
   `bounded_children_v1` or `write_activity_v1` enters a target support set.

The initial maturity is `experimental`, with the required acknowledgment and
the complete receipt digest retained by inspection. Stable promotion remains a
later decision. A missing local, session-product, hosted, package, or generated
artifact row keeps both capabilities false and preserves the previous
known-good graph. This coupled publication avoids a state where stale Signal
Desk bytes are made parseable by hand while the code generator still refuses
the target honestly.

## Post-bakeoff round-1 reconciliation — 2026-07-28

This section is normative where it tightens the first-publication execution
plan. It resolves the qualification/publication cycle without letting an
unqualified capability appear to ordinary callers.

### Candidate generation and atomic promotion

Codegen emits the candidate graph from current source into a separate,
content-addressed `QualificationGenerationV1`; it never overwrites the active
or last-good graph. The generation binds the complete schema/function/provider
artifacts, normalized plan hashes, exact executor binary and image digests,
source SHA, and the two candidate capability ids. It is not returned by normal
inspection, capability discovery, function lookup, or generated clients.

The target admits that generation only with a short-lived, one-use
`QualificationGrantV1` signed by the standing supervisor. The grant is bound
to the exact target/control generation, candidate digest, image digest,
acceptance principal and session, public origin, allowed function ids, maximum
invocations, and expiry. It grants no general target support: ordinary callers
still receive the structured capability GAP, and a grant cannot address any
active or different candidate graph. Qualification uses the identical parser,
authorization gate, transaction executor, storage, and response serializer
that promotion will use. Tests prove candidate functions are undiscoverable
and not invokable without the exact grant.

After every mandatory row passes, the supervisor may commit one signed
`CapabilityPublicationV1` into the target control head. The Rust-owned carrier
contains:

- target binding generation/digest and control-head generation;
- source SHA, target and supervisor image digests, candidate-generation digest,
  package-publication ledger digest, and qualification-receipt digest;
- exactly `bounded_children_v1` and `write_activity_v1`, profile versions,
  `experimental` maturity, and the required acknowledgment; and
- the promoted active-generation digest.

The target reports a GAP unless the carrier signature, binding, running image,
active graph, package ledger, and every digest match. A single control-head CAS
promotes the candidate graph and both capability facts together; no
intermediate state exposes one profile or the candidate slot. Failure deletes
or quarantines only the candidate and leaves the active graph and prior
control head unchanged.

The qualification receipt is complete before the CAS and is the evidence
authority named by the carrier. A post-CAS `CapabilityPublicationReceiptV1`
then reopens the carrier and proves the public capability/inspection response
matches it. If that observation fails, the supervisor revokes the carrier by a
new control-head CAS and the target returns to GAP. This observation receipt
does not retroactively qualify the candidate, so there is no evidence cycle.
Local/package targets use the same carrier shape with the source-committed
qualification receipt and exact local binary digest.

### Conformance applicability

Every `RelationActivityConformanceRowV1` declares exactly one applicability
class:

- `pureEvaluator`;
- `localPersisted`; or
- `servedHosted`.

Receipts report zero skipped rows inside every class required by the target;
"zero skips" never means that a served target exposes the local fault injector.
The complete injection/interruption matrix, paired authorization stores,
retired-key clock cases, and synthetic 14-day expiry remain mandatory
`pureEvaluator` or `localPersisted` rows and are bound to the served executor
through the exact source/binary/image digest.

The `servedHosted` class contains, at minimum:

- session-authenticated and hosted-authenticated invocation of both generated
  operations through the public origin;
- byte-exact sealed absent/visible relation results;
- first page plus cursor continuation and cursor-after-restart refusal;
- duplicate mutation replay returning the retained result bytes;
- exact activity provenance fields and source/scope incarnation;
- accepted live first-page subscribe and refused cursor-bearing subscribe; and
- reopened capability, function, schema, active-generation, and image
  identities equal to the qualification receipt.

No fault-injection or qualification route remains enabled after promotion. The
post-CAS receipt proves the grant expired or was consumed, the candidate slot
is no longer separately addressable, and the ordinary public origin refuses
qualification headers.

### First-publication conflict resolution

All six publication steps run against one immutable candidate generation;
step 6 gates its CAS promotion and repository commit, not its isolated
qualification. The earlier positive `create-owner.v1` acceptance row is
superseded for this publication. The corpus instead requires positive
`existing-owner.v1` coverage and direct/codegen/runtime rejection vectors for
every `create-owner.v1` spelling. A future evaluator and corpus must amend this
Spec before create-owner becomes positive.

The session product proof is the experimental gate. Its diary and receipt
must name the development-persona authentication nonclaim and the narrowing
from the earlier full-product wording; stable promotion still requires the
complete Signal Desk product path with no such nonclaim. Superseded vocabulary
elsewhere in this living document is non-controlling under the dated
amendments and will be consolidated after first publication without changing
the executable gates.

## Post-bakeoff round-2 reconciliation — 2026-07-28

This section closes the remaining qualification, local-authority, carrier, and
revocation semantics. LLP 0108 and LLP 0094 register the addendum-owned
transport and gate integration; Accepted LLP 0058 is context only.

### Registered qualification invocation

`QualificationGrantV1` is a canonical-JCS, supervisor-Ed25519-signed carrier
with compact form `sqg1.<key-id>.<payload-b64url>.<signature-b64url>`, at most
8,192 bytes. Its closed payload binds grant id, target binding/control head,
candidate-generation digest, predecessor active-generation digest, acceptance
subject/session, public origin, allowed function ids, HTTP/connection/
subscription/frame budgets, issuance, expiry of at most ten minutes, and a
random activation nonce. The existing sender proof covers the exact compact
grant and `QualificationUseV1` nonce so neither can be moved across requests.

The registered routes are exactly:

- `POST /connection/open`, whose closed DTO gains optional
  `qualificationGrant` and `qualificationUse` members;
- `POST /query/{name}` and `POST /mutation/{name}`, which carry
  `Snapback-Qualification-Grant` and `Snapback-Qualification-Use` headers; and
- `POST /live/{name}/subscribe`, reached through a connection whose token is
  already bound to the activated grant. WebSocket/live frames carry the
  existing connection token and never a free-floating qualification token.

No other route accepts either member/header. Unknown versions, oversize
carriers, missing paired members, or qualification input on an active/ordinary
function refuse before evaluation.

The target keeps a durable qualification journal keyed by grant id. First use
atomically changes `unused → active` and binds the exact connection/session.
Every HTTP invocation, connection, subscription, and admitted frame reserves a
monotone use index and unique use nonce before `PreparedInvocation`; success,
authorization refusal, handler failure, disconnect, and timeout all consume
the reserved budget. Concurrent duplicate reservation loses the CAS. Crash
replay of the same use nonce returns the retained result or refusal and never
consumes twice. Mutations additionally use the existing settlement replay.
Expiry closes subscriptions and changes the grant to `consumed`; no budget is
refunded.

Every route first constructs ordinary `PreparedAuthority`. The registered
function gate then creates a `QualificationAuthorityV1` refinement inside
`PreparedInvocation` only when the authenticated subject/session, candidate
generation, function id, route, use reservation, and grant all match. It
satisfies only the two named candidate function requirements for that hidden
generation; it does not mutate target capability discovery, the active
generation, or an ordinary function's admission. Functionless connection
paths consume `PreparedAuthority` plus the validated qualification session and
cannot fabricate a function. Every route remains in LLP 0058's one composed
gate registry.

The pre-CAS receipt names `candidateGeneration` and separately records
`predecessorActiveGeneration`; it never calls the candidate active. Negative
tests cover absent/ordinary callers, stale or cross-session connections,
wrong origin/subject/function/route/generation, replayed use nonce, concurrent
activation, exhausted budgets, expiry, crash replay, and a grant presented
after promotion.

### Local and packaged publication authority

Local targets do not pretend to have a hosted supervisor/control head. They use
a distinct canonical `LocalCapabilityPublicationV1` committed as tracked source
and compiled with `include_bytes!` behind a private Rust constructor. It binds
the exact qualification receipt, executor/schema source digests, local target
profile, package closure when present, and the two atomic capability ids. The
code-owned target registry derives positive local support only when the
embedded carrier parses, its compiled digest matches, all private
implementation-registration facts are true, and the loaded graph has the
bound artifact identities. A generated/direct artifact cannot supply or
replace the carrier.

For contributor source builds, the trust root is the reviewed source commit
and build-provenance digest; revocation is a later source commit that removes
the carrier, followed by process restart. For public runtime packages, a
canonical `PackageCapabilityAttestationV1` is signed by the release Ed25519
key embedded in the loader and additionally binds the binary SHA-256, target
triple, tarball/post-promotion-ledger digest, source SHA, and embedded local
carrier digest. Startup mismatch reports GAP and leaves the loaded/last-good
graph unchanged.

There is no runtime local CAS or replayable sidecar. Rollback is an explicit
compatible executable/package rollback with its own carrier; it cannot be
triggered by a failed observation. Tampered embedded bytes, another binary or
target triple, stale graph, old package closure, unknown signing key, rollback
incompatibility, and candidate-artifact substitution are mandatory negatives.

### Hosted union carrier and revocation

For the hosted target, LLP 0105's union `CapabilityPublicationV1` controls.
`bounded_children_v1` and `write_activity_v1` are one atomic relation/activity
claim family: they share the candidate generation and qualification receipt
and always change publication state together. Hosted ephemeral and migration
are separate families. Per-entry independence applies between those three
families during later validation or revocation; the first publication still
requires all four claims and every receipt in LLP 0105.

The target does not download npm to verify the carrier. Its image contains the
0041 candidate/post-promotion ledger lineage digest in signed release
provenance, and carrier validation compares against that local immutable fact.

Post-CAS observation has a hard 120-second window. Timeout or failed
observation causes a new control-head CAS that withdraws only the affected
capability claim family. The promoted generation remains active, but its
functions immediately refuse through their function-level capability
requirements. Generation demotion is a separate, journaled, compatibility-
checked rollback and is never an automatic consequence of capability
revocation. This rule is identical in LLP 0105.

## LLP 0108 corrective reconciliation — 2026-07-28

LLP 0108 supersedes this document's incomplete qualification-use, data, and
post-CAS carrier details. The candidate grant remains a refinement of ordinary
`PreparedAuthority`, but `QualificationUseV1` is the complete signed carrier
defined there—not only a nonce. Its durable journal has
`unused|reserved|terminal|expired`, exact retained replay, per-operation and
egress ceilings, a closed diagnostic matrix, and the ordinary-auth-first
ordering. All implementations and acceptance fixtures consume that definition.

Candidate DDL, indexes, queries, mutation writes, outbox entries, live state,
and journals execute only against LLP 0108's verified disposable restore.
They never share the production database or stream incarnation. Promotion
copies no candidate-created data or schema into production. The supervisor
re-proves the production schema, durable head, active graph, candidate graph,
image, and ledgers immediately before CAS; drift requires a fresh restore and
complete qualification. Failed qualification destroys or quarantines only the
isolated destination with a closed cleanup receipt.

The release image embeds the immutable candidate-ledger digest. The carrier
supplies the final publication ledger only as a signed extension whose
`previousLedgerSha256` equals that embedded digest; a carrier-supplied
post-promotion digest alone is never self-authenticating.

Every hosted claim family uses LLP 0108's `familyEpoch` and an expiring
`provisional` carrier. Target-side expiry at no more than 120 seconds is the
safety cut even if supervisor withdrawal CAS fails. Epoch is rechecked at
admission and every operation-specific effect/serialization boundary listed
there. Expiry or withdrawal withholds the relation/activity pair and makes its
functions refuse; it does not roll back the active graph or production data.
The final CAS changes only the verified runtime support fact. Code-owned
maturity is `experimental` in the publishing binary; no external CAS can
rewrite it.

## Unreviewed post-round correction — 2026-07-28

This section applies the terminal dispositions in LLP 0108's corrective review
journal. It has not received a further independent review. The document
remains Review and both capability facts remain false until the complete
executable receipt passes.

`QualificationGrantV1` expires at most ten minutes after issue and binds the
acceptance-device Ed25519 key id and fingerprint, its current revocation
generation, subject/session, target, generation, functions, operation budgets,
and audience. The client-signed `QualificationUseV1` field matrix and
replay/crash semantics are exactly LLP 0108's later correction.
`liveSubscribe` inherits the grant from its connection but carries its own
use-only HTTP header or socket-frame member; it cannot carry or replace a
grant. The client does not sign a server-assigned subscription id. Reservation
atomically assigns and retains that id.

The first publication admits only a candidate whose required physical schema,
indexes, and source schema digest already equal production. Any production
DDL/backfill is a separately approved ordinary migration completed before the
qualification backup; no isolated-database schema object is transferred during
promotion. A candidate that requires different physical schema is ineligible
for this release.

Capability maturity is a code-owned static fact. This release compiles
`bounded_children_v1` and `write_activity_v1` as `experimental`; the ordinary
target support predicate remains false without an applicable verified family
fact. A provisional family fact activates the graph and support only for the
receipt-bound observation principal through the public origin, and self-expires
within 120 seconds. A distinct finalization CAS opens support to ordinary
clients that acknowledge the experimental ids. Crash, timeout, failed
observation, or failed finalization leaves general support false. No CAS
rewrites the code-owned maturity registry.

Local/package publication remains separately gated by the source-embedded
attestation described above. It cannot use hosted provisional authority, and
its positive support stays false until its own complete reviewed carrier and
receipt are committed.
