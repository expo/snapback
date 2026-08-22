# LLP 0235: Field masking — class M

**Type:** Spec
**Status:** Accepted
**Systems:** Auth, Security/authorization, Storage, Live queries, Code generation, Client integration, Testing
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-12
**Revised:** 2026-08-22 (accepted by author ruling as the governing class-M
design; implementation is scheduled after LLP 0294 W6 closes; the
split-sensitive-fields workaround remains the only shipped pattern until then)
**Revised:** 2026-08-12 (round-2 adversarial-review response: relation-atom lineage, constraint outcomes, field-keyed writeback, snapshot-only disclosure evaluation, target-version certification, carrier accuracy, and editorial closure)
**Related:** LLP 0007, LLP 0012, LLP 0053, LLP 0080, LLP 0110, LLP 0170, LLP 0173, LLP 0230, LLP 0231

## Summary

Class M is conditional field disclosure without conditional row existence. A
row remains present and keeps its shape; each field is either disclosed with the
row or replaced by `null` under a declared condition. Pointing-room is the
normative case: every vote remains in the tally, while `votes.value` is visible
only when its `rounds` row is revealed or the caller owns the vote.

This is not projection redaction with a better rule. SurrealDB shipped the
closest existing feature and published six advisories bypassing it. The raw
value escaped through filters, aliases and functions, an indexed count, error
text, patch relocation, indexed ordering, and graph traversals. In the indexed
ordering case the field was correctly returned as `null`; an optimizer chose an
index walk in hidden-value order first. Several channels arose below the
authored-query surface, including the planner-selected indexed count and indexed
ordering paths. The rule was correct and the plan leaked
(LLP 0230#54--masking-side-channels-the-empirical-record).

This Spec therefore pins one indivisible contract:

1. a closed, one-hop masking grammar nested beside the shipped visibility union
   in one table-policy carrier;
2. null substitution only at projection and handler-read seams;
3. generate-time noninterference over every logical position;
4. activation-time certification of every physical plan a target may execute;
5. a field-addition fence on every table; and
6. obligation-backed replacement for every disclosed-to-masked transition.

A target, plan class, expression, or optimizer path outside that contract is
refused. Class M never falls back to post-evaluation, handler self-enforcement,
online-only execution, or mask-at-reference semantics.

## Motivation and security property

Null substitution is necessary for pointing-room: suppressing an unrevealed
vote row would disclose participation through missing rows and counts. But
projection masking alone is empirically not a security boundary. SQL Server and
Oracle both document inference through predicates and ordering; Snowflake closes
the channel by masking at every reference and accepts silently wrong filters and
joins. Class M instead preserves row shape and refuses every plan whose result
could depend on a hidden value
(LLP 0230#53--dynamic-data-masking-four-vendors-two-designs;
LLP 0230#55--null-substitution-row-suppression-and-refusal).
Across the systems surveyed there, none combines null substitution with
generate-time refusal of interfering positions, and none combines a
cross-table condition language with a field locus. Those are bounded negative
claims over LLP 0230's survey, not claims about every database.

For query `Q`, principal `p`, table row `r`, and masked field `f`, let two
database states differ only in the stored value of `r.f`, with the disclosure
condition false for `p` in both states. Class M requires the complete observable
result of `Q` to be identical in both states. Observables include:

- row membership, order, count, grouping, pagination and cursors;
- every projected or derived value;
- success, refusal code, public details, diagnostic and log text;
- write outcome and returned before/after state; and
- client-visible live wake, delivery kind, delivery timing class, and
  invalidation disposition.

The property protects the value, not the declaration's existence. A static
refusal may name the table, field, plan position, and required condition. It
must not include runtime operands, sampled values, selectivity, index contents,
or relationship-row contents.

## 1. One policy IR and a closed grammar

Class M **wraps and nests** `TableVisibilityV1`; it does not structurally extend
that deny-unknown-fields enum and is not a second policy system. The `rows`
member holds the existing Rust-owned closed union unchanged
(`crates/snapback/src/manifest.rs:1256-1276`), while `relations` and `fields` are siblings in one
versioned table-policy carrier at the existing `.visibility(...)` locus. Class R
still decides whether the row exists before class M decides which cells are
disclosed. Reads and the deferred write sibling consume that one carrier, so
this shape preserves LLP 0231 D1/D6's one locus and one IR without pretending
the two expression languages have the same Rust shape.

The shipped direct-plan carrier is not yet sufficient. Codegen copies only a
restricted table policy and omits `tableVisibility` for `public-read` tables
(`packages/snapback-codegen/index.mjs:2888-2893`); activation likewise compares
only policies for which `is_restricted()` is true
(`crates/snapback/src/local.rs:27405-27425`). Class M requires field treatments on every table,
public tables included. Its versioned plan carrier must therefore carry the
complete schema-derived table policy for public and restricted tables alike,
and activation must compare that complete class-R/M carrier before storage
lowers row visibility (`crates/snapback/src/storage.rs:9475-9489`). Historical omission of a
public row predicate may remain a legacy plan encoding, but such a plan is not
class-M activatable.

### 1.1 Authoring grammar

The normative abstract grammar is:

```text
table-policy       ::= {
  rows: row-visibility,
  relations?: relation-decl[0..8],
  fields: { field-name: field-treatment } // exact schema-field key set
}

field-treatment    ::= { kind: "disclosed-with-row" }
                     | { kind: "masked", discloseWhen: condition }

condition          ::= atom
                     | { allOf: condition[2..8] }
                     | { anyOf: condition[2..8] }

atom               ::= { eq: [operand, operand] }
operand            ::= { row: field-name }
                     | { principal: "userId" }
                     | { related: [relation-name, related-field-name] }
                     | { literal: scalar }

relation-decl      ::= {
  name: identifier,
  table: table-name,
  localField: required-Id-field,
  relatedField: "_id",
  cardinality: "zero-or-one",
  via: "primary" | unique-index-name
}
scalar             ::= null | boolean | string | finite safe integer
```

Concrete authoring uses object form and the existing `.visibility(...)` locus:

```js
.visibility({
  rows: { kind: 'public-read' },
  relations: [{
    name: 'round',
    table: 'rounds',
    localField: 'roundId',
    relatedField: '_id',
    cardinality: 'zero-or-one',
    via: 'primary',
  }],
  fields: {
    roundId: { kind: 'disclosed-with-row' },
    roomId: { kind: 'disclosed-with-row' },
    userId: { kind: 'disclosed-with-row' },
    value: {
      kind: 'masked',
      discloseWhen: {
        anyOf: [
          { eq: [{ related: ['round', 'revealed'] }, { literal: true }] },
          { eq: [{ row: 'userId' }, { principal: 'userId' }] },
        ],
      },
    },
  },
})
```

`rows` accepts exactly the shipped class-R variants. A legacy
`.visibility({ kind: ... })` declaration is the row half only and is incomplete
under the field-addition fence; migration must add `fields` before the fence is
enabled. A table has at most eight relation declarations. A condition has at
most 32 nodes and depth four, including its root. `allOf` and `anyOf` each have
2–8 children. Children retain authored order in the source projection but are
canonicalized by structural digest in executable IR.

The grammar admits only equality because the v1 proof below is an equality-atom
subsumption check. It admits no field-to-field relation join chosen at runtime:
each related row is a declared, one-hop, zero-or-one lookup from a required
`Id<T>` local field to the related row's `_id`, backed by the related table's
primary unique identity or a named declared unique index. The generated plan
carries the exact lookup and index. A missing related row makes every atom that
reads it false; it does not throw and cannot change public error text. V1
requires the related table's class-R policy to be `public-read`; a restricted
related row is `SNAPBACK_FIELD_MASK_RELATED_POLICY_UNSUPPORTED`. A related
field's own class-M mask is likewise not traversed. This keeps relation
availability out of the disclosure implication rather than unsoundly treating
an unreadable related row as proof.

Class M deliberately has a policy-condition AST rather than reusing a
`FilterExpr` fragment. `FilterExpr` is selection syntax with `Eq`, `In`, and
ordered comparisons (`crates/snapback/src/manifest.rs:8901-8916`) over a broader query-value
vocabulary; class M needs sealed principal and declared-relation operands while
excluding query arguments, ranges, and other ambient expression forms. Reusing
the query type would couple future query-operator growth to disclosure authority.
The two syntaxes do converge into one internal canonical equality-atom type for
§2.1, but only after source provenance and relation-path identity are proved.
Thus the vocabulary is separate while the checker and policy carrier remain
single.

The principal vocabulary is exactly sealed `ctx.auth.userId`; anonymous is
`null`. No roles array, session ID, provider, delegation projection, clock,
runtime ID, argument, binding, ambient state, function call, membership helper,
quantifier, collection traversal, nested relation, negation, inequality,
arithmetic, string operation, aggregate, computed expression, or arbitrary JS
is admitted in v1. Class R may still contain its existing declaration-bound
membership leaves; class M does not add a second membership spelling.

`literal` must typecheck against the other operand. `row` and `related` must
name scalar schema fields; JSON, structured, asset, vector, and optional fields
are refused in v1. Every referenced field other than the field being masked
must be `disclosed-with-row` on its own table. The masked field may appear in
its own condition only as the exact owner equality
`{ eq: [{ row: f }, { principal: 'userId' }] }` when `f` is a required
principal/string field; all other self-dependence is refused. This exception
does not disclose `f` as a value: it only compares it inside the policy
evaluator. A masked field's effective read type is its stored type unioned with
`null`; its write type is unchanged.

### 1.2 Stable refusals

The following codes are normative. Their public messages and details name only
static declaration, schema and plan-position facts.

| Code | Refusal |
| --- | --- |
| `SNAPBACK_FIELD_TREATMENT_REQUIRED` | A schema field has no exact treatment. |
| `SNAPBACK_FIELD_TREATMENT_UNKNOWN` | A treatment names no schema field. |
| `SNAPBACK_FIELD_MASK_CONDITION_INVALID` | The condition is out of grammar, over depth/node/arm limits, ill-typed, or self-dependent outside the exception. |
| `SNAPBACK_FIELD_MASK_RELATION_INVALID` | A relation is duplicate, unbounded, non-unique, optional, mistyped, recursive, or names an unknown table/field/index. |
| `SNAPBACK_FIELD_MASK_RELATED_POLICY_UNSUPPORTED` | The related lookup would cross class M or another unsupported policy path. |
| `SNAPBACK_FIELD_MASK_CONSTRAINT_UNSAFE` | A unique constraint, or a future foreign-key/check constraint, can make its outcome depend on a masked field without disclosure-condition dominance. |
| `SNAPBACK_FIELD_MASK_INTERFERENCE` | A logical plan observes a possibly masked field in a prohibited position. |
| `SNAPBACK_FIELD_MASK_PLAN_UNCERTIFIED` | The target cannot certify every physical plan/operator path for class M. |
| `SNAPBACK_FIELD_MASK_RUNTIME_FAILED` | A class-M evaluation or target execution failed; public text is operand-free. |
| `SNAPBACK_FIELD_MASK_HANDLER_QUERY_OPAQUE` | A JS handler can construct a class-M query whose field positions cannot be extracted as a closed template. |
| `SNAPBACK_FIELD_MASK_HANDLER_WRITEBACK_INVALID` | A patch or replacement addresses a field masked for this caller and row without explicit authorized write intent, or loses redacted provenance. |
| `SNAPBACK_FIELD_MASK_VIEW_VERSION_UNAVAILABLE` | A client/target cannot separate principal-visible revision from raw source/commit versions. |
| `SNAPBACK_FIELD_MASK_REMASK_DELIVERY_REQUIRED` | A live surface cannot provide the obligation-backed replacement required by a possible disclosed-to-masked transition. |

`SNAPBACK_FIELD_MASK_INTERFERENCE` details contain exactly `table`, `field`,
`position` and the canonical required condition. `SNAPBACK_FIELD_MASK_PLAN_UNCERTIFIED`
adds target, plan-class and operator identifiers. Neither carries runtime
operands, values, selectivity or engine text.

Unknown future grammar nodes, plan operators, optimizer features, field types,
or target capabilities map to `SNAPBACK_FIELD_MASK_CONDITION_INVALID` or
`SNAPBACK_FIELD_MASK_PLAN_UNCERTIFIED`; they never become implicitly safe.

## 2. Decidable noninterference

### 2.1 Conservative entailment, not general implication

This Spec replaces LLP 0231's informal “entails” with **canonical branch
subsumption**. It is sound for the closed grammar and intentionally incomplete.

Normalize a condition `D` to disjunctive branches, where each branch is a set of
canonical equality atoms. `D` expansion may produce at most 64 branches;
exceeding that limit is `SNAPBACK_FIELD_MASK_CONDITION_INVALID`. Normalize the
plan's composed row-selection predicate `P` the same way where possible, with
the symmetric limit of 64 satisfiable branches. Exceeding `P`'s limit makes the
proof unavailable and every raw observing position refuses with
`SNAPBACK_FIELD_MASK_INTERFERENCE`. Class-R membership leaves and any predicate
node without a class-M equality-atom representation are opaque atoms: they can
narrow a branch but cannot discharge a disclosure atom. Only an
already-normalized opaque leaf in a conjunction gets that treatment. An opaque
disjunction, negation, callback or other compound makes the composed predicate
unnormalizable, so every raw observing position is refused. The shipped
`FilterOp::In` is an opaque disjunction in v1 and is never expanded into
equalities, even for a small literal list.

A plan predicate over a related table canonicalizes to
`{ related: [relation-name, related-field-name] }` **only when** its provenance
proves the exact declared relation lookup for the same source row as the masked
field occurrence. The source alias must be that row; the join path must be
exactly the declaration's `localField → related._id` equality; the related table
and `via` identity/index must match; and the predicate must read the named field
from that joined row. The canonical atom carries the source-row lineage and
relation-declaration digest, not merely the related table and field spelling.
Every predicate reached through another join key, alias, source row, index, or
path is opaque: it may narrow `P`, but can never discharge a related disclosure
atom. In particular, joining `votes` to `rounds` on `roomId` and filtering that
joined row's `revealed` field cannot prove the declared
`votes.roundId → rounds._id` reveal arm. This rule applies to the arbitrary
one-to-four equality pairs admitted by `RelationalQueryPlan`; syntactic equality
of `rounds.revealed == true` is insufficient
(`crates/snapback/src/manifest.rs:7662-7715`).

For disclosure condition `D` with branches `D1..Dn` and composed selection
predicate `P` with satisfiable branches `P1..Pm`, generation proves disclosure
exactly when, for every `Pi`, some `Dj` is a subset of `Pi`. In other words, each
possible selected branch contains every atom of at least one disclosure branch.
Canonical identical atoms only; no transitivity, algebra, schema constraint,
foreign-key fact, index property, role implication, or runtime value is used.
Unsatisfiable-branch elimination is limited to contradictory equality literals
on one canonical operand. If normalization or the subset proof is unavailable,
the result is “not proved” and the observing position is refused.

Examples:

- `filter userId == principal` proves the owner arm of pointing-room's mask.
- `filter round.revealed == true` proves the reveal arm only when that related
  atom is part of the composed plan, not merely because the relation exists.
- `filter roomId == arg(roomId)` proves neither arm.
- `owner OR revealed` as a selection predicate proves disclosure; `owner OR
  roomId == X` does not, because its second branch has no disclosure branch.
- A membership policy plus `userId == principal` proves the owner arm; the
  membership atom itself contributes no proof.

The check is attached to each field occurrence and each plan position, not once
to a query. A field may be projected masked while another occurrence is allowed
under a locally stronger branch only if the target plan IR retains and certifies
that branch-specific dominance. V1 has no such regional dominance proof, so the
single composed row-selection predicate must discharge every raw occurrence.

### 2.2 Logical plan position audit

Every plan class exposes a versioned field-use inventory. Generation walks it
after row-policy composition and before code emission. A new operator does not
generate until it declares every field it reads under one of the positions
below and the class-M verifier handles that position.

| # | Position | Class-M rule |
| ---: | --- | --- |
| 1 | Projection | Return the stored value when the condition is true; otherwise return `null`. Proven-disclosed projections may return raw. |
| 2 | Filter, including implicit predicates and cursor boundaries | Raw use requires branch subsumption. Otherwise refuse. A mask never silently changes membership. |
| 3 | Ordering, tie-breaks and index-order walks | Raw use requires branch subsumption. Otherwise refuse the authored order and every order-delivering access path. |
| 4 | Join keys | Raw use on either side requires branch subsumption for that source row. Otherwise refuse; v1 offers no joinable mask. |
| 5 | Grouping/cohort/bucket keys | Raw use requires branch subsumption. Otherwise refuse. |
| 6 | Aggregate inputs, `COUNT`, result count and pagination totals | Raw-field aggregates require branch subsumption. Row count over a query that merely projects a masked field is allowed because null substitution preserves rows; no aggregate or fast path may inspect the masked field. |
| 7 | Index selection, statistics and fast paths | A target certificate must prove selection and execution are independent of possibly masked values, or all such candidates are disabled. No indexed-count shortcut is admitted. |
| 8 | Errors, diagnostics, constraints and logs | Success versus refusal, refusal type, and every public byte are independent of a hidden value. Constraint probes may not observe a masked field without disclosure-condition dominance. No operand echo, sampled value, selectivity, constraint value, SQL/engine text, or relation contents cross the boundary. Unexpected engine errors map to one constant class-M diagnostic with server-private detail redacted. |
| 9 | Derived/aliased/unwrapped expressions | Provenance follows the source field through renaming and expressions. Any raw input requires branch subsumption; otherwise refuse. An alias never changes treatment. |
| 10 | Write-path reads, return-before/after, copy/move and read-modify-write | Provenance follows the stored field through all names. Raw use requires branch subsumption or a separately authorized explicit write operation. Any ordinary patch naming a field currently masked for this caller and row refuses; v1 has no patch `copy`/`move` or arbitrary field relocation spelling. |
| 11 | Traversal and relationship edges | Only declared one-hop policy lookups are admitted. Application joins, bounded children, search, vector, history, snapshots and maintained projections require their own complete field-use inventory and target certificate; absence means refusal. |
| 12 | JS handler input | Masking happens in the `ctx.db` host seam before serialization to JS. The handler never receives a hidden stored value. Every handler `query` and `get` reapplies class R/M; there is no raw-read option. |
| 13 | Live invalidation and delivery timing | A masked-field-only write must not emit a client-observable delivery when the viewer's projected row and every other observable are unchanged. Any possible disclosed-to-masked transition uses obligation-backed `live_replace`. Unknown matcher classification also replaces; it never skips negatively. |

Cardinality is explicit because “masked value” does not mean “masked row.” A
query returning the same rows may count them and paginate them normally. It may
not filter, group, order, aggregate, pick an index, or choose a fast path based
on hidden values. Row suppression is not a class-M fallback. The current
`ctx.db.patch` spelling accepts an object of values rather than a patch-operation
language (`crates/snapback/src/runtime.rs:1732-1745`); adding copy/move later would be a new
position-10 operator and would default to refusal.

Constraints are an outcome channel, not merely an error-text channel. A unique
constraint whose key contains a masked field, and any future foreign-key or
check constraint that reads one, requires a versioned constraint-outcome
certificate. For each candidate row whose participation can change success
versus refusal, the constraint's complete lookup/evaluation predicate `P` must
branch-subsume that field's disclosure condition `D` under §2.1. Equality on the
masked key itself contributes no disclosure proof; only non-masked key facts and
sealed authority facts may establish dominance. If any write plan lacks that
proof, generation refuses the constraint with
`SNAPBACK_FIELD_MASK_CONSTRAINT_UNSAFE`. A bare unique index over `votes.value`
therefore refuses, while a future scoped key is admissible only if every
conflicting row is proved disclosed to the caller before the conflict outcome is
observable. The shipped `.index(..., { unique: true })` is author-declarable
(`packages/snapback-codegen/define.mjs:855-863`), and the current SQLite mapper
adds the raw engine message as public `error` detail
(`crates/snapback/src/storage.rs:13821-13846`); that detail and the current unguarded outcome are
not class-M conforming.

**Version/time carriers are positions too.** Raw row `_version`, `_updatedAt`,
query snapshot/commit version, captured dependency versions and obligation data
floors can reveal that a hidden-only write occurred. Class M separates them:

- `_id` and `_createdAt` are disclosed-with-row because a value-only update
  changes neither.
- `_version` and `_updatedAt` are mask-coupled metadata: when any application
  field in the row is masked for the principal, both project as `null` to the
  client and JS. When every field is disclosed, the raw values may project.
- Raw row/source/commit versions remain host-private for snapshots, OCC,
  matcher capture and LLP 0053 obligation floors. They never enter handler
  values, client rows, cursors, public errors or opaque tokens whose bytes are
  refreshed by a hidden-only write.
- A class-M result exposes a principal- and query-instance-scoped
  `viewRevision`, not the raw app commit version. It advances exactly when that
  principal's observable result or policy-program identity changes. A
  hidden-only write leaves it unchanged. Reconnect may resnapshot internally
  without advancing it when the visible result is byte-identical.

The server currently returns the pinned database's current version in an Ibex
query output (`crates/snapback/src/runtime.rs:662-668`), so that carrier is not yet conforming
for class M. Until the client and target negotiate the view-revision carrier,
admission fails with `SNAPBACK_FIELD_MASK_VIEW_VERSION_UNAVAILABLE`.

The current plan space already demonstrates why the inventory is per class.
`QueryPlan` contains filters, `membership_filters`, order, limit and an index
hint (`crates/snapback/src/manifest.rs:8604-8638`). The membership predicates are especially
relevant to §2.1 because they add an opaque narrowing node to the composed
selection predicate. Relational plans add join keys, two source
visibility lists, projection, ordering and two access indexes
(`crates/snapback/src/manifest.rs:7662-7715`). Bounded-children adds a relationship lookup,
order, take and two projections (`crates/snapback/src/manifest.rs:7717-7755`). None inherits a
class-M claim merely because single-table queries are certified.

### 2.3 The optimizer is inside the security boundary

The logical audit is necessary and insufficient. The SurrealDB ordering and
count failures were introduced after authoring. Class M therefore activates on
a target only when that target supplies a **physical-plan certificate** bound to
the exact schema hash, function/plan hash, target implementation version,
optimizer configuration and relevant statistics/schema generation.

The certificate enumerates every physical operator and access path the target
may choose and records, for each field, the position inventory above. It must
prove one of:

1. every raw occurrence is dominated by a certified disclosure predicate;
2. the only raw occurrence is the typed `MaskProject(field, condition)`
   declassifier, whose sole output is the terminal client/handler cell and
   which cannot feed membership, order, count or another operator; or
3. the candidate path is disabled for this plan.

`MaskProject` is the one operator permitted to read an undisclosed stored value:
it emits that value when the condition is true and `null` otherwise. Its raw
input and condition result never enter generic expression evaluation, target
diagnostics or plan selection. This is mask-at-projection with a fenced
declassifier, not Snowflake-style mask-at-reference.

Certification happens after target planning and before activation. Runtime
replanning outside the certified set is disabled. A statistics, index,
optimizer-version or configuration change that can alter the set invalidates
the certificate; the old plan cannot continue while a new certificate is
pending. A target that proves it has no mutable planner statistics records that
fact instead of inventing a statistics activation source.

The certificate binds an exact executable target fingerprint, including the
Snapback executor/certificate format and the linked database-engine version.
At every process boot and before a bundle may activate or serve class-M work,
the host recomputes and compares that fingerprint. A mismatch fails class-M
activation closed with `SNAPBACK_FIELD_MASK_PLAN_UNCERTIFIED` until the plans
are recertified; ordinary process or binary upgrade is therefore itself an
effective invalidation source rather than an event the surrounding application
must remember to emit. The fingerprint is immutable for the serving process; a
target that cannot guarantee that must recheck before each class-M execution.
Schema-cookie reprepare or any other target-selected replan still may not escape
the certified operator set.

Targets without a stable explain/plan-lock facility must use a class-M-specific
conservative executor whose access path is selected by Snapback, not by the
database optimizer.

On the current SQLite path, `validate_query_index` verifies only that an authored
index name exists (`crates/snapback/src/storage.rs:9267-9297`), while `build_query_sql` emits SQL
and lets SQLite choose execution (`crates/snapback/src/storage.rs:9300-9333`). Ordering is then
lowered directly over the raw field (`crates/snapback/src/storage.rs:9525-9547`). These paths do
not constitute a class-M certificate. An implementation must add the physical
fence at this storage/target seam; a codegen-only authored-AST check is
non-conforming.

Activation re-runs both the logical walker and the physical certificate check.
The existing activation preflight already compares a direct plan's exact
schema-derived class-R policy (`crates/snapback/src/local.rs:27405-27425`) and validates filter
and order field references (`crates/snapback/src/local.rs:27461-27497`). Class M extends that
preflight rather than trusting generated artifacts alone.

## 3. JS handlers and `ctx.db`

Handlers are opaque: their declared `reads` list is dependency information, not
result provenance (LLP 0170#2-the-universal-result-rule-lacks-provenance). A
handler therefore cannot prove noninterference and cannot receive a raw value
under an author assertion.

Every `ctx.db.query(table)` and `ctx.db.get(table, id)` returns a **handler
view**. Class R first removes unauthorized rows. Class M then replaces every
undisclosed field value with a host-only redacted sentinel. The JS projection of
that sentinel is `null`, matching the client projection, but the host retains
field provenance and original-presence metadata outside JS. System fields keep
their declared treatment; no stored field is silently omitted. Related-row
condition lookups execute in the host against the invocation's pinned persisted
snapshot and enter the captured dependency set. They never read the buffered
write overlay. The current host seam dispatches `db.query` and `db.get` before
serializing their results to JS (`crates/snapback/src/runtime.rs:1623-1701`,
`crates/snapback/src/runtime.rs:1703-1714`); that is the required masking locus.

This is a deliberate exception to ordinary handler read-your-writes. The row
query/get result may include the existing buffered overlay, but every class-M
disclosure condition is evaluated from the pre-write persisted snapshot. A
buffered `rounds.revealed: false → true` therefore does not disclose vote values
inside that mutation; only a later invocation pinned after commit can observe
the reveal. If the mutation calls `ctx.refuse()`, it cannot return values gained
from a policy fact that rolls back with the write. Conversely, a legitimate
reveal followed by a read in the same mutation receives the stale masked form.
That cost is normative until the D6 write/egress sibling defines an atomic
declassification operation; class M alone does not infer write authority or
make a speculative overlay an authorization fact. If the source row or a
condition input exists only in the overlay, it establishes no disclosure arm.
The existing runtime applies buffered writes before returning `db.query` and
`db.get` rows (`crates/snapback/src/runtime.rs:1641-1690`, `crates/snapback/src/runtime.rs:1711-1714`), so an
implementation must keep condition evaluation explicitly outside that merge.

Masking after a handler-authored database filter would still be too late.
Codegen therefore extracts every `ctx.db.query` over a class-M table as a closed
plan template, walks its filter/order/index/limit positions under §2, and fails
generation with `SNAPBACK_FIELD_MASK_HANDLER_QUERY_OPAQUE` if table or field
selection is dynamic or the locally reachable call graph cannot bound every
template. `ctx.db.get` is admitted only as an `_id` point read of one declared
table. The host seam compares every reached plan with an extracted, physically
certified template before storage executes it. A mismatch or dynamic bypass is
the same operand-free refusal; it never runs the query and masks afterward.
This host check is defense in depth for opaque control flow, not a runtime
fallback for a plan generation accepted without a template.

The handler may use visible values normally. A `null` is not evidence that the
stored value was null: class M deliberately makes the two client-observationally
equivalent. The API provides no `isMasked`, raw-value, reveal-condition, or
conditional-timing probe.

### 3.1 Read-modify-write

Masking must not turn a read-modify-write into destructive nulling. The fence is
keyed to the field, caller and source row, not to an operation being labeled
replacement-style.

- `ctx.db.patch(table, id, patch)` preserves every omitted field. If the patch
  names a field whose disclosure condition is false for this caller on the
  pinned source row, the ordinary patch refuses with
  `SNAPBACK_FIELD_MASK_HANDLER_WRITEBACK_INVALID` unless it carries a distinct
  explicit write intent independently authorized by the D6 sibling. The value
  is irrelevant to this fence: literal `null`, a non-null literal, and
  `{ ...handlerView }` all address the masked field and all refuse through the
  current arbitrary-object patch API. An explicit null in a future authorized
  write operation is a real write, never a redacted-sentinel interpretation.
- A future replacement/put operation accepts handler-view rows only through a
  provenance-carrying host object. A redacted sentinel means **preserve the
  stored field**, not “write null.” JSON serialization, spread, clone, aliasing,
  or moving the JS-visible `null` loses that provenance and therefore cannot be
  used for replacement without the same explicit authorized write intent.
- Patch/copy/move operations cannot address the hidden source value. The host
  keys treatment to `(source table, source field, row identity, principal)`,
  never to the output property name or operation style.

Today `ctx.db.patch` reads the stored row, overlays only the authored patch, and
buffers the patch (`crates/snapback/src/runtime.rs:1732-1745`); this supports preserve-on-
omission but does not yet carry the explicit intent needed to write a field
masked from the handler. This Spec does not grant write authority.
Insert/update/delete, post-update checks and egress remain the one-IR write
sibling required by LLP 0231 §D6.

### 3.2 Composition with the protected-query profile

The protected-query allowlist already admits captured `db.query`/`db.get` and
rejects unclassified host operations (`crates/snapback/src/runtime.rs:1577-1615`). Class-M
condition reads and relation lookups are `DatabaseCaptured`: they share the
invocation's pinned snapshot, appear in the captured read/dependency witness,
and are replayed identically on rerun. No new mutable host-input class is added.
Actions use their existing host locking policy, but their `ctx.db` reads receive
the same class-R/M handler view; “action” is not a raw-data authority
(`crates/snapback/src/storage.rs:6013-6029`).

## 4. Field addition fails closed

For every application table, `fields` must have exactly the schema's stored
field key set. Generated system fields are governed by a versioned platform
treatment table and cannot be reclassified by the app. V1 declares `_id` and
`_createdAt` disclosed-with-row and `_version` / `_updatedAt` mask-coupled as
§2.2 specifies; codegen already adds those four fields to JS result-row
descriptors (`packages/snapback-codegen/index.mjs:7521-7537`). A future system
field fails activation until the platform table classifies it. A new schema
field with
no `{ kind: 'disclosed-with-row' }` or `{ kind: 'masked', ... }` entry fails
generation with `SNAPBACK_FIELD_TREATMENT_REQUIRED`, even on public tables and
even when no current query projects it. An extra treatment fails with
`SNAPBACK_FIELD_TREATMENT_UNKNOWN`.

Migration is explicit:

1. Codegen first reports every missing treatment with reviewer-gated,
   non-machine-applicable edits.
2. The author chooses disclosed-with-row or supplies a valid mask. Existing
   `fieldBoundary:` residuals may be cited as migration evidence but are not
   converted automatically.
3. Generation validates the whole policy and every affected logical/physical
   plan before producing an activatable bundle.
4. D2's field fence activates only when all tables are complete. There is no
   table-by-table runtime mode in which an omitted new field becomes public.

This is a permanent authoring cost: every added stored field needs one security
decision. It is deliberately not inferred from optionality, validator type,
name, syncability, an existing public row policy, or query selection.

## 5. Re-masking, invalidation and activation

Class M distinguishes **policy facts** from **policy programs**.

### 5.1 Policy-fact changes

A write to a field read by a disclosure condition is an ordinary data-plane
change. The relation lookup and condition enter the query's captured dependency
set, so the matcher wakes conservatively. For pointing-room,
`rounds.revealed` is a declared dependency of `votes.value`.

For each current row and principal, re-evaluation classifies the field
transition:

- masked → masked with no other observable change: no client delivery;
- masked → disclosed: a positive update, best-effort delivery is allowed;
- disclosed → disclosed: ordinary update semantics;
- disclosed → masked: a security-negative transition. It produces a
  potentially shrinking auth-scoped `live_replace`, never a best-effort update
  or field delta.

The last case rides LLP 0053's delivery obligation: quarantine immediately,
replace from a snapshot at or after the causing commit, and acknowledge only
after the replacement is atomically applied. LLP 0053 already specifies every
auth-scoped `live_replace` as obligation-backed because a replace may shrink
(LLP 0053#negative-deltas-are-obligations-positive-deltas-are-best-effort).
`SNAPBACK_FIELD_MASK_REMASK_DELIVERY_REQUIRED` refuses live admission when that
carrier is unavailable.

The dangerous concrete pointing-room direction is `rounds.revealed: true →
false`. Every non-owner who currently holds a vote value must hide it before
any subsequent render/read and receive an obligation-backed replacement whose
cell is `null`. Dropping that delivery may never strand the disclosed value.
The shipped demo only writes `false → true`
(`demos/pointing-room/snapback/functions.mjs:150-162`), so it does not prove this
direction.

Invalidation timing is part of noninterference. A write only to a value that
stays masked for a principal cannot produce a principal-visible frame, row
reorder, count change, cursor change, error, or distinct delivery kind. Internal
work may occur; its externally observable schedule must be coalesced with the
ordinary heartbeat/poll envelope and must not encode the hidden value or which
masked row changed.

### 5.2 Policy-program changes

Editing a mask, field treatment, relation declaration, or target physical-plan
certificate is authorization metadata, not a row delta. The new schema,
functions and authorization metadata stage and validate as one bundle, then
atomically activate as LLP 0053 event 2
(LLP 0053#the-authorization-event-universe-closed). Affected live and retained
results quarantine and fresh-snapshot under the new activation identity. No
incremental diff compares output produced under the old policy with output
under the new one.

Any program edit that can narrow disclosure — disclosed-with-row → masked,
broader condition → narrower condition, relation retargeting, or physical-plan
certificate narrowing — is treated as potentially re-masking every affected
field. Activation succeeds only when the obligation protocol is available.
A widening edit still fresh-replaces because the plan/program identity changed;
it is not falsely presented as an ordinary positive field delta.

## 6. Review projection

Extend LLP 0173's consumer-committed authorization review surface with one
`fieldPolicies` section per table and one `maskedFieldUses` section per
operation. Canonical JSON is authority; human rendering derives from it.

For each table the projection records:

- every field and exact treatment;
- the canonical disclosure-condition AST and source span;
- every relation's table, local field, related field, cardinality and index;
- policy-fact dependency fields; and
- whether migration still carries an interim residual.

For each operation it records:

- the effective table row policy and field treatments;
- every occurrence of a masked field by the 13 position labels;
- `masked` or `proved-disclosed` for each generated occurrence; a refused
  occurrence appears in the structured generation diagnostic because failed
  generation publishes no review artifact;
- the canonical plan branches and the specific disclosure branch subsumed,
  without runtime values;
- target physical-certificate identity and disabled fast paths; and
- live delivery class, including `obligation-backed-live-replace` where
  re-masking is possible, plus the view-revision carrier and every withheld raw
  version/time field.

Opaque JS computations remain labeled opaque. The projection may state that
the handler received a masked view; it may not claim to explain what the handler
computed. No `safe` or waiver verdict is inferred. The current interim is only a
codegen summary: `fieldBoundary` is copied into the function manifest and
generation summary (`packages/snapback-codegen/index.mjs:3573-3578`,
`packages/snapback-codegen/index.mjs:8419-8426`), and pointing-room's committed
artifact lists one residual
(`demos/pointing-room/snapback/generated/artifacts.json:543-575`).
That is migration input, not the final projection.

## 7. Pointing-room, expressed

The real schema stores `rounds.revealed` on `rounds` and `votes.userId` /
`votes.value` on `votes` (`demos/pointing-room/snapback/schema.mjs:21-48`). The
declaration in §1.1 is therefore cross-table, disjunctive and field-level
without adding a second policy vocabulary.

The complete target table declarations for the current schema are:

```js
rooms: defineTable({
  name: v.string(),
  ownerId: v.principal(),
}).visibility({
  rows: { kind: 'public-read' },
  fields: {
    name: { kind: 'disclosed-with-row' },
    ownerId: { kind: 'disclosed-with-row' },
  },
}),

rounds: defineTable({
  roomId: v.id('rooms'),
  topic: v.string(),
  sequence: v.integer(),
  revealed: v.boolean(),
}).visibility({
  rows: { kind: 'public-read' },
  fields: {
    roomId: { kind: 'disclosed-with-row' },
    topic: { kind: 'disclosed-with-row' },
    sequence: { kind: 'disclosed-with-row' },
    revealed: { kind: 'disclosed-with-row' },
  },
}),

votes: defineTable({
  roundId: v.id('rounds'),
  roomId: v.id('rooms'),
  userId: v.principal(),
  value: voteValue,
}).visibility({
  rows: { kind: 'public-read' },
  relations: [{
    name: 'round',
    table: 'rounds',
    localField: 'roundId',
    relatedField: '_id',
    cardinality: 'zero-or-one',
    via: 'primary',
  }],
  fields: {
    roundId: { kind: 'disclosed-with-row' },
    roomId: { kind: 'disclosed-with-row' },
    userId: { kind: 'disclosed-with-row' },
    value: {
      kind: 'masked',
      discloseWhen: {
        anyOf: [
          { eq: [{ related: ['round', 'revealed'] }, { literal: true }] },
          { eq: [{ row: 'userId' }, { principal: 'userId' }] },
        ],
      },
    },
  },
}),
```

The existing `.sync()` and index calls remain in their current chains. The
`voteValue` placeholder above is exactly the current seven-literal validator;
it is abbreviated only to keep the security declaration visible. `public-read`
is the row-layer choice: function-level `auth: 'authenticated'` remains an
independent invocation gate
(`demos/pointing-room/snapback/functions.mjs:20-39`,
`demos/pointing-room/snapback/functions.mjs:81-165`).

The existing handler implements the same truth table manually:

```js
value: round.revealed || vote.userId === ctx.auth.userId
  ? vote.value
  : null
```

(`demos/pointing-room/snapback/functions.mjs:64-77`). Under class M the
handler's vote read already contains the masked `value`, so `liveTally` no
longer owns this ternary. Its row-shaping code may pass `vote.value` through.

For Ada's vote `13` and Grace as the other principal:

| State | Ada sees | Grace sees | Row/count |
| --- | --- | --- | --- |
| `revealed = false` | Ada's `value: "13"` | Ada's `value: null` | Same vote row and count for both. |
| `revealed = true` | Ada's `value: "13"` | Ada's `value: "13"` | Same vote row and count for both. |
| `true → false` | Ada retains `"13"` by owner arm | Grace immediately quarantines, then receives `null` by obligated replace | No missing row or best-effort re-mask. |

The current acceptance already mints two distinct principals with `asUser`,
asserts the owner sees `13`, captures the non-owner's raw snapshot containing
`"value":null` and not `"value":"13"`, then observes the revealed value in a
WebSocket frame
(`demos/pointing-room/tests/acceptance/disclosure-invariant.mjs:112-142`,
`demos/pointing-room/tests/acceptance/disclosure-invariant.mjs:163-203`,
`demos/pointing-room/tests/acceptance/disclosure-invariant.mjs:222-247`). Class-M
acceptance retains those checks and adds:

1. generated declaration and review-projection golden tests;
2. the same owner/non-owner/reveal trace without a handler ternary;
3. identity switching on one query definition: Ada, Grace, then Ada again;
4. `true → false` re-masking with a deliberately dropped first frame, proving
   obligation re-fire and no render/read of `13` while quarantined; acceptance
   must add an authenticated `unrevealRound` mutation because the current demo
   has only `revealRound`'s `false → true` write;
5. a hidden-value-only update proving no non-owner frame or timing-class change;
6. filter, order, join, group, aggregate/count, alias/derive, writeback and
   traversal refusal fixtures;
7. optimizer adversaries: a tempting `value` index, indexed order, indexed
   count, changed statistics and a replanning attempt all remain refused or on
   a certified value-oblivious path; and
8. constant, operand-free error bytes for two different hidden values.

## 8. `fieldBoundary:` retirement

`fieldBoundary:` is a handler-enforced residual, not class M. Pointing-room
declares it today (`demos/pointing-room/snapback/functions.mjs:37-53`); codegen
validates only that its named fields exist in the result contract
(`packages/snapback-codegen/index.mjs:4230-4241`), and the runtime manifest says
it carries no noninterference guarantee (`crates/snapback/src/manifest.rs:7353-7361`).

Retirement is staged and fail-closed:

1. Codegen matches each residual field to a table field only when provenance is
   structural and unambiguous. Pointing-room is migrated by an authored mapping,
   not by parsing its English `condition`.
2. The author installs the class-M declaration, exact field treatments and
   relation. The generated projection shows both the residual and class M as
   `migration-overlap`; class M is the enforcement authority.
3. The complete acceptance list in §7 passes on every supported target, and a
   mutation test deletes the handler ternary while preserving results.
4. Generated artifacts contain no `fieldBoundary` for the operation, the class-M
   physical certificate is active, and the review projection contains the
   equivalent canonical mask.
5. After the corpus-wide residual count is zero and generation rejects new
   `fieldBoundary:` declarations with a migration pointer, the manifest member,
   validation code, summary count and prose-string grammar are removed together.

Keeping the English residual beside class M indefinitely is not defense in
depth: it creates two apparent policy loci whose drift cannot be compared.

## Costs, stated plainly

- Every new field on every table requires a declaration. Public tables pay the
  cost too.
- The grammar is small: one-hop unique relations and equality only. Common
  inequalities, roles, time windows, computed policy functions and nested
  traversals are refused.
- Branch-subsumption rejects some logically safe plans because it deliberately
  ignores transitivity and schema constraints.
- Every plan class and target optimizer needs a versioned field-use inventory
  and physical certificate. SQLite cannot claim class M from its current
  existence-only index validation.
- Related-row policy reads add lookup and invalidation work. Conservative
  `live_replace` on possible re-masking is more expensive than a field delta.
- JS receives `null` for both stored null and hidden data and cannot distinguish
  them. Replacement writes require provenance-aware host support.
- A class-M client cannot use raw row/app versions for optimistic concurrency
  or cache freshness. It needs the view-revision protocol while the host keeps
  raw OCC witnesses private.
- Null substitution preserves participation, row membership and counts by
  design. Applications needing those facts hidden need class R row suppression,
  not class M.

## Alternatives

### A1 — row splitting or suppression

Store the secret in an owner-only/revealed child row, or suppress the vote until
reveal. This removes the cell-value channel and simplifies handlers.

Against: pointing-room needs every vote row present; suppression changes the
participant list, count and pagination. Row splitting can work when the public
shell and secret payload have genuinely different lifecycles, but it changes
the data model and still needs an explicit reveal join/invalidation story.

### A2 — refusal at every reference

Remove masked fields from generated filter/order/join/aggregate surfaces, as
SQL column privileges and Hasura's per-role schema shape suggest. This is the
strongest and simplest default and class M adopts it for non-entailed positions.

An open prior-art fact remains: the surveyed Hasura pages did not verify whether
an unselectable column is also absent from `where` and `order_by`. This Spec does
not assume it is. Snapback's generated surface and plan walker must prove their
own exclusion (LLP 0230#52--sql-column-privileges-the-standard-and-what-it-is-not;
LLP 0230#58--what-this-tier-says-about-llp-0231s-class-m-envelope).

### A3 — mask at every reference

Snowflake closes inference by feeding the masked representation into filters,
joins, order and grouping.

Against: a legitimate filter or join silently returns the wrong rows. Class M
chooses a loud generation refusal over a successful query with changed meaning.

### A4 — keep `fieldBoundary:` forever

It is already declared, projected in the codegen summary, and backed by an
identity-switching test.

Against: the handler sees raw data, the English condition is not executable,
the optimizer and `ctx.db` positions are unchecked, and omission cannot be
detected because JS is opaque. It documents the hole without closing it.

## Sirens — attractive and wrong

### S1 — inspect only the authored query

**Why it looks right:** codegen owns the AST and can reject explicit
`orderBy('value')` or `where('value', ...)` cheaply.

**Why it leaks:** SurrealDB's indexed count and indexed ordering paths were
planner choices. The author did not write “walk the hidden-value index and
return its order.” The physical target check in §2.3 is load-bearing.

### S2 — null it immediately before serialization

**Why it looks right:** clients and handlers never see the raw cell in their
final return value.

**Why it leaks:** filtering, ordering, functions, aliases, counts, errors,
traversals and patch relocation can already have observed it. This is the common
shape behind the six SurrealDB advisories.

### S3 — allow equality-preserving hashes

**Why it looks right:** joins and duplicate detection keep working while the
literal value is hidden.

**Why it leaks:** equality classes are information. BigQuery documents
deterministic hashing as intentionally joinable. V1 has no declared equality-
channel disclosure and refuses it rather than treating it as free utility.

### S4 — trust the handler to preserve a masked value on writeback

**Why it looks right:** the handler can spread the row and patch it back.

**Why it leaks or destroys:** JS sees `null`, not provenance. Treating that as a
write destroys the secret; attaching a boolean `masked` property creates a
probe and is lost through alias/copy. Preservation belongs in the host object
and write operation.

## Acceptance

Class M is not implemented or claimable until all of the following pass:

1. The authoring grammar, depth/node/branch bounds, type rules, exact relation
   shape and every stable refusal code have generated and Rust-manifest golden
   fixtures; unknown variants fail closed.
2. Every schema table has an exact field-treatment map. Adding one field to a
   public, owner and masked table independently fails generation until declared.
3. Every current query/relationship/write plan class publishes a complete
   field-use inventory or is refused for class M. Adding an unclassified plan
   operator makes the exhaustiveness test fail.
4. Each supported target certifies exact physical operators, optimizer
   configuration and executable target fingerprint. Indexed `ORDER BY`, indexed
   count, statistics-driven path change and runtime replanning adversaries cannot
   introduce a raw observation. Booting with a different database-engine or
   executor version rejects class-M activation until recertified.
5. The 13 position families in §2.2 each have a negative fixture and, where the
   branch-subsumption escape applies, a positive and near-miss fixture. The
   relation near-miss joins `votes` to `rounds` on `roomId` and proves it cannot
   discharge the declared `roundId → _id` relation atom.
6. Errors for different hidden operands have byte-identical public code,
   message and details. A unique index directly over a masked field refuses with
   `SNAPBACK_FIELD_MASK_CONSTRAINT_UNSAFE`; every admitted constraint has
   outcome-independence fixtures. Server-private logs pass the existing
   redaction policy and contain no raw operand from a class-M evaluation failure.
7. JS `query` and `get` receive `null` for hidden values before handler code can
   run. Patch omission preserves the stored value; an ordinary patch containing
   `{ ...maskedRow }` or explicitly naming the masked field refuses without
   distinct authorized intent. Buffering a reveal and then reading in the same
   mutation stays masked; refusing that mutation leaks no value. A committed
   reveal becomes visible only to a later invocation.
8. A hidden-only write changes no projected `_version`, `_updatedAt`, public
   cursor/token or `viewRevision`; raw source versions still advance internally
   and discharge the correct later obligation.
9. Pointing-room passes every §7 test under two real session principals,
   including identity switching and `true → false` re-masking with dropped
   delivery. The fixture adds the missing authenticated un-reveal mutation; row
   membership and count remain stable throughout.
10. A hidden-value-only change produces no non-owner client observable,
   including wake/frame/delivery-kind differences; a reveal-condition change
   always wakes and re-evaluates the related lookup.
11. Policy-program changes and physical-certificate changes activate through
    LLP 0053 event 2 and fresh replacement; no old-policy delta is admitted.
12. `generated/authorization-review.json` (or LLP 0173's final named artifact)
    carries the §6 facts deterministically and stale generation fails.
13. `fieldBoundary:` is removed from pointing-room only after equivalent class-M
    enforcement and tests pass without the handler ternary. The residual cannot
    be newly authored after corpus-wide retirement.

## Open questions

1. **Physical certification substrate.** SQLite has no plan-lock or stable
   explain contract suitable for this authorization boundary. The expected v1
   answer is therefore a Snapback-owned conservative executor, using SQLite's
   conservative access-path levers (`INDEXED BY`, `NOT INDEXED`, and unary `+`
   where useful) rather than accepting optimizer freedom. A prepared-bytecode
   certificate remains admissible only if implementation proves a stable closed
   operator contract. This is an implementation blocker, not permission to ship
   an authored-AST-only check.
2. **Restricted related rows.** V1 admits only a `public-read` related table and
   refuses crossing its class M. Is a future declaration allowed to use a
   separately named restricted/internal policy fact without making it
   application-readable? That would need a sound way to compose the related
   row policy into branch subsumption plus one-IR write/egress and review
   semantics.
3. **Stored null versus hidden null.** Client equivalence is intentional. Do
   generated types need documentation-only metadata that a field is maskable,
   without a runtime `isMasked` oracle?
4. **Beyond equality.** A richer fragment may add ordered comparisons only with
   a decidable implication procedure and new optimizer fixtures. It must not
   widen the v1 parser by accepting arbitrary expressions first.
5. **Aggregate APIs.** The current core `QueryPlan` has no grouping/aggregate
   nodes (`crates/snapback/src/manifest.rs:8604-8638`), but other/future surfaces do. Should a
   separate aggregate plan class support only count-over-row-membership while
   refusing every masked-field input, or wait for a broader provenance model?
6. **Exact timing proof.** What test harness and deployment envelope are strong
   enough to claim that hidden-value-only mutations do not create a remote
   timing oracle? Until answered, class M claims content/event noninterference
   under the coalesced delivery envelope, not constant-time database execution.
7. **View-revision encoding.** The semantic rule is pinned in §2.2. The exact
   wire scalar, persistence and resume encoding must compose with LLP 0012 and
   LLP 0053 without exposing the raw composite witness to class-M clients.

## Status

Draft. This document specifies the class-M contract; it does not claim the
current runtime implements it. The current pointing-room boundary remains the
declared, handler-enforced `fieldBoundary:` residual until the Acceptance gate
passes.

## Revision history

- 2026-08-12 — first revision (Draft); final self-review added the explicit
  relation `via` grammar and completed the pointing-room `rounds`/`votes` policy
  pair.
- 2026-08-12 — round-2 adversarial-review response. Related-plan atoms now
  require exact source-row/relation-path lineage; constraint outcomes are
  noninterference positions with a stable unsafe-constraint refusal; ordinary
  patch writeback is field-keyed; disclosure conditions use the pinned
  persisted snapshot rather than buffered writes; physical certificates fail
  closed on target-version mismatch; the class-M carrier relationship and
  public-table consequence are stated accurately; and M/N editorial findings
  are closed without weakening LLP 0231's three-part envelope.
