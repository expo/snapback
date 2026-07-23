# LLP 0065 — Generated data-pattern soundness and declaration floor

**Type:** RFC
**Status:** Draft
**Systems:** Schema authoring, Code generation, Declarative data tier, Authorization, Query visibility, Generated operations, Diagnostics
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-23 (apply the independent Claude-family review: refuse
permission-backing and membership tables at generation, keep v1 generated
queries non-retainable until the LLP 0053 convergence fixture exists, pin
bounded list semantics, collapse missing/invisible mutation rows at the
generated public boundary, refuse empty updates, and state the owner profile's
cross-tenant scope); 2026-07-20 (clarify that this RFC's owner-only floor
governs standard generated patterns; LLP 0074 separately owns an explicit
query-only public-read profile)
**Related:** LLP 0004, LLP 0007, LLP 0009, LLP 0037, LLP 0051, LLP 0053, LLP 0056, LLP 0063, LLP 0074

## Summary

Snapback may derive validators, result types, read/write ceilings, and common
operation structure only from closed declarations whose meaning is complete.
It must never infer authorization requirements, row visibility, tenant
boundaries, or authority creation from table shape, index shape, observed
executions, naming conventions, or read/write sets.

The first standard-pattern profile is deliberately narrow: schema-derived
owner-scoped CRUD, owner-scoped unique lookup, and owner-scoped keyset pages.
Every generated entry requires an explicit owner-visibility declaration,
requires authenticated authority, executes the owner predicate as part of
every read, and re-checks ownership transactionally before update or delete.
Trusted time and identifiers may be selected as explicit defaults backed by
the existing `runtime.now` and `runtime.id` value expressions. Client argument
schemas omit those fields and reject additional properties.

This RFC does not authorize joins, maintained projections, migration plans,
or compatibility execution. LLP 0063's separate query/projection and
storage-evolution RFC prerequisites continue to gate those features.

## Motivation

LLP 0063 Workstream 6 asks Snapback to remove repetitive declarations without
weakening its generated facts. That goal has two characteristic failure
modes:

1. an ergonomic generator guesses that a field named `ownerId`, `userId`, or
   `tenantId` is a security boundary; or
2. static or runtime observations are treated as complete authority even
   though they covered only one branch.

Both are unsound. A read/write set bounds database effects; it does not prove
who may observe a row. An observed execution is a lower bound on effects, not
a ceiling. A unique index proves a storage invariant; it does not prove an
authorization predicate. The generation boundary therefore needs its own
ratified rules before Step 5 can claim declaration reduction.

## Design

### 1. Fact classes

Codegen classifies every generated fact into one of three classes:

- **Schema-derived:** validator and TypeScript shapes; table/index names;
  uniqueness; closed HostPlan read/write ceilings; deterministic result shapes
  where the return form is declared.
- **Explicit security declarations:** function auth requirement, row
  visibility, membership predicates, authority creation, permission-backing
  tables, configuration grants, and any future tenant boundary. These are
  never inferred.
- **Runtime evidence:** observed reads, writes, settlements, receipts, and
  delivery facts. These may prove that an execution stayed inside a declared
  ceiling, but may never widen the ceiling or create authority.

For a closed HostPlan, codegen may compute the union of every statically
reachable read and write as its conservative ceiling. For opaque JavaScript,
WASM, dynamic import, or any analysis with an unresolved branch/call target,
the author retains an explicit declaration. The runtime checks observed
operations are a subset of the admitted ceiling and fails closed on mismatch.
Authorization, invalidation, and receipt routing consume the ceiling, never a
branch-specific observation.

### 2. The v1 visibility floor

Every standard generated operation must name a visibility profile. Omission
fails with `SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED` before artifacts
are written.

The only v1 **standard-pattern** profile defined here is:

```js
visibility: { kind: 'owner', field: 'ownerId' }
```

The named field must be a required string or principal field. This declaration
has four effects, all mandatory:

- generated functions require authenticated authority;
- every generated query executes `field == ctx.auth.userId` in its query plan;
- the generated read summary also carries `authScopeField` for invalidation
  and disjointness facts, but that metadata is not treated as enforcement;
- update and delete first read the row and execute an in-transaction owner
  guard before the write.

The owner field is absent from client-authored create/update arguments. Create
sets it from `ctx.auth.userId`; update cannot transfer ownership. Missing rows
and invisible rows are collapsed to `SNAPBACK_ROW_NOT_VISIBLE` by generated
update/delete plans. This is the safe default at the authenticated public
operation boundary: callers cannot use document IDs as an existence oracle.
Lower storage and diagnostic layers may retain a more precise internal cause,
but this v1 profile exposes no opt-out.

The v1 generated queries are intentionally **non-retainable**. Their
`authScopeField` is within LLP 0053's shipped `userId`-scoped refinement
because the scope value is exactly `ctx.auth.userId`, regardless of the
application field's name. A future retained profile must attach and execute
LLP 0053's matcher-versus-full-requery convergence fixture for every generated
query before setting `retainable: true`; metadata alone cannot promote it.

Standard patterns are refused on any table declared with `.membership()` or
`.permissionBacking()`, using
`SNAPBACK_STANDARD_PATTERN_PERMISSION_BACKING_REFUSED`. Membership transition
policy and host-filled provenance stay under LLP 0056, and a hand-authored
permission-backing table cannot acquire a self-service grant channel through
generic owner CRUD.

Public, role-based, membership-based, and tenant-based standard patterns are
future profiles. They require their own explicit semantics and negative
acceptance cases; a generator must not approximate them with the owner profile.
LLP 0074's explicitly declared, query-only `public-read` relation profile is a
separate authority: it neither creates a public CRUD pattern nor weakens this
RFC's owner-only standard-operation floor.

### 3. Common pattern contracts

`defineOwnedCrud` derives argument validators from one installed table
builder and emits list/get/create/update/delete definitions. Callers explicitly
name every exported function, operation names must be distinct, and the
document-id argument must not collide with a schema field. Immutable fields and
trusted create/update defaults are explicit options. Trusted defaults cannot
name the owner field, and update defaults cannot name immutable fields. Updates
are complete-field updates for the mutable v1 field set; partial-patch omission
semantics are not guessed. Every helper's top-level options object is closed;
misspelled or future options fail rather than being ignored.

The generated list is a bounded prefix, not an all-rows claim. Its default
order is `_createdAt` and its default limit is 100; authors may select a
portable schema scalar or system field and a limit from 1 through 1,024.
LLP 0007's ascending `_id` tie-break makes every order total. JSON/object
ordering is refused. Reaching the limit does not carry an implicit
`hasMore`; callers that need completeness beyond the bound use the explicit
keyset pattern. Mutable order fields are permitted deliberately, so authors
accept membership movement at the bounded edge. An update with neither a
mutable field nor a trusted update default is refused rather than generating
an empty patch.

`defineOwnedUniqueLookup` requires a declared unique index containing the owner
field. It returns a definition map keyed by the required operation name,
derives arguments from the remaining indexed fields, executes the owner
predicate, and limits the result to one row. A merely conventionally unique
index is refused.

`defineOwnedKeysetPages` emits separate first/next functions. The declared
index must be unique with exactly `[visibilityField, cursorField]` in that
order. Merely containing those fields is insufficient: a third index field
could make the compound index unique while leaving duplicate cursors inside
one owner's partition, and the strict continuation filter would then skip
rows. The next page uses a strict ordered comparison over the exact unique
boundary. Authors whose natural cursor is not unique must declare a unique
continuation key or accept that v1 cannot express their pagination; codegen
must not silently synthesize offset pagination. The cursor field is required
and explicit; v1 does not pretend the system `_id` field is author-indexable.

Trusted defaults accept only `now` and `id`, mapped to the existing
`RuntimeNow` and `RuntimeId` expressions. Their schema field type must match;
`id` is admitted only for a plain required string field, never a principal or
foreign-table ID, and neither default may set the owner field.
The corresponding properties are omitted from operation argument schemas,
whose `additionalProperties: false` rule prevents client forgery.

### 4. Generated artifacts and diagnostics

Generation remains deterministic and fails before replacing the prior output
tree. Stable authoring diagnostics include:

- `SNAPBACK_STANDARD_PATTERN_TABLE_UNBOUND`;
- `SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED`;
- `SNAPBACK_STANDARD_PATTERN_UNIQUE_INDEX_REQUIRED`;
- `SNAPBACK_STANDARD_PATTERN_PAGINATION_INDEX_REQUIRED`;
- `SNAPBACK_STANDARD_PATTERN_PERMISSION_BACKING_REFUSED`; and
- `SNAPBACK_STANDARD_PATTERN_INVALID` for closed-vocabulary violations.

Generated function references and operation schemas remain the public client
surface. The standard-pattern helper itself is package code, not a runtime
dependency of the server or browser bundle.

### 5. Acceptance

Before this RFC may move to Accepted:

- generation from one table declaration produces byte-identical artifacts on
  rerun and inferred argument/result types compile;
- omission or misspelling of visibility fails before output;
- membership and permission-backing tables fail before output with the stable
  standard-pattern refusal;
- cross-user reads, unique lookups, updates, and deletes cannot observe or
  mutate another owner's row in the real server;
- generated mutation calls expose the same refusal for missing and invisible
  rows, preventing an existence oracle;
- generated v1 queries remain non-retainable; any later retained profile must
  run LLP 0053's convergence fixture for every `authScopeField` query;
- list ordering, limit bounds, `_id` total-order tie-break, JSON refusal, and
  bounded-prefix semantics are executable;
- an update with neither mutable fields nor trusted update defaults is refused;
- trusted `now`/`id` fields reject client-supplied values and use recorded host
  answers under replay;
- the generated read/write ceiling is checked against every observed HostPlan
  operation, with a fault test for an out-of-ceiling operation;
- every claimed pattern has an executable receipt, and the Step 5 Partitime
  receipt proves the frozen backend-declaration reduction without relaxing its
  threshold; and
- the no-Exact-core and package-artifact gates rerun.

The owner profile has no independent tenant axis: its authority partition is
the authenticated user. For this profile, the required cross-tenant negative
case therefore reduces to the cross-user case above. A future tenant profile
must add a distinct tenant declaration and distinct negative fixtures rather
than claiming coverage from this reduction.

The current implementation in `packages/snapback-codegen/standard-patterns.*`
is an implementation candidate and unit-level witness. While this RFC is
Draft, it does not satisfy LLP 0063's Step 5 entry gate or promote
`STEP5.DECLARATION_REDUCTION`.

### Independent review disposition — 2026-07-23

The Claude-family review at
`llp/reviews/0065-generated-data-pattern-soundness.fable.md` returned
not-ready with findings C1–C6. This revision applies all six without changing
the RFC lifecycle state: C1 is the permission-backing refusal; C2 is the
explicit non-retainable/convergence posture; C3 pins list semantics; C4
collapses the public existence oracle; C5 pins trusted-default types and
refuses empty updates; C6 states why the owner profile's tenant-negative case
is the cross-user case. Acceptance remains the author's decision.

## Open questions

1. Should a follow-on pagination profile generate an explicit compound
   `(cursor, _id)` continuation for naturally non-unique sort keys?
2. Should public standard read patterns share this RFC after a separate
   existence-leak review, or get a smaller follow-on authority?
3. Which static analyzer and source language can prove complete conservative
   ceilings for non-HostPlan handlers without turning undecidability into an
   optimistic fallback?
4. A future trusted/admin-only profile may consider exposing distinct
   missing/invisible causes, but the v1 generated public surface has no opt-out.
