# LLP 0065 — Generated data-pattern soundness and declaration floor

**Type:** RFC
**Status:** Draft
**Systems:** Schema authoring, Code generation, Declarative data tier, Authorization, Query visibility, Generated operations, Diagnostics
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-24 (dual-family round-1 reconciliation: semantic acceptance
decoupled from implementation receipts; public existence secrecy collapsed by
default with owner-partitioned uniqueness; principal admission pinned to the
canonical user subject; generated queries classified callable/`live_replace`
with full LLP 0053 inheritance and no retention claim; list and pagination
ordering totalized with an `_id` tie-break and a versioned cursor contract;
update/delete lowered to the LLP 0051 conditional plan; authority-bearing
tables ineligible; ceiling traversal total and default-deny); 2026-07-20
(clarify that this RFC's owner-only floor governs standard generated patterns;
LLP 0080 separately owns an explicit query-only public-read profile)
**Related:** LLP 0004, LLP 0007, LLP 0008, LLP 0009, LLP 0037, LLP 0051, LLP 0053, LLP 0055, LLP 0056, LLP 0063, LLP 0080, LLP 0081

## Summary

Snapback may derive validators, result types, read/write ceilings, and common
operation structure only from closed declarations whose meaning is complete.
It must never infer authorization requirements, row visibility, tenant
boundaries, or authority creation from table shape, index shape, observed
executions, naming conventions, or read/write sets.

The first standard-pattern profile is deliberately narrow: schema-derived
owner-scoped CRUD, owner-scoped unique lookup, and owner-scoped keyset pages.
Every generated entry requires an explicit owner-visibility declaration,
requires an authenticated principal that projects the canonical user subject,
executes the owner predicate as part of every read, and re-checks ownership
transactionally before update or delete. Trusted time and identifiers may be
selected as explicit defaults backed by the existing `runtime.now` and
`runtime.id` value expressions. Client argument schemas omit those fields and
reject additional properties.

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
reachable read and write as its conservative ceiling. That computation is a
total recursive traversal of the closed plan vocabulary and is default-deny:
an unrecognized node, operator, or call target fails generation rather than
being skipped, so a future plan-vocabulary extension cannot silently escape
the ceiling. Generation tests assert the exact expected ceiling for each
helper constructor; the runtime subset check is enforcement, not the
completeness proof. For opaque JavaScript, WASM, dynamic import, or any
analysis with an unresolved branch/call target, the author retains an explicit
declaration, and a handler without a proven-complete ceiling remains
ineligible for live or retained capability under LLP 0053. The runtime checks
observed operations are a subset of the admitted ceiling and fails closed on
mismatch. Authorization, invalidation, and receipt routing consume the
ceiling, never a branch-specific observation.

### 2. The v1 visibility floor

Every standard generated operation must name a visibility profile. Omission
fails with `SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED` before artifacts
are written.

The only v1 **standard-pattern** profile defined here is:

```js
visibility: { kind: 'owner', field: 'ownerId' }
```

Its stable profile identifier is `owner.v1`. The named field must be a
required string or principal field. This declaration has four effects, all
mandatory:

- generated functions require authenticated authority;
- every generated query executes `field == ctx.auth.userId` in its query plan;
- the generated read summary also carries `authScopeField` for invalidation
  and disjointness facts, but that metadata is not treated as enforcement;
- update and delete first read the row and execute an in-transaction owner
  guard before the write.

**Principal admission.** "Authenticated authority" means a principal that
projects the canonical user subject under LLP 0055's effective-principal
rules: a signed-in user, or a delegated agent whose authority resolves to the
delegating user's subject. Anonymous, sealed service, system, and admin
principals do not satisfy `owner.v1` and are refused with
`SNAPBACK_STANDARD_PATTERN_PRINCIPAL_UNSUPPORTED`; a future profile may admit
them explicitly. Ownership equality is exact string equality between the
declared owner field and that canonical subject. The v1 owner profile is
scoped to one application authority domain: cross-tenant isolation is app
isolation, and a composite tenant-plus-owner profile is future work with its
own semantics and negative cases.

**Mutation lowering.** Generated update and delete lower to a server-evaluated
conditional plan — read, owner guard, then write — whose steps share one
authoritative transaction and commit validation under LLP 0051's conditional
mutation model. The guard consumes the transaction's own read, never a
client-supplied baseline. On acceptance, LLP 0004's and LLP 0007's
unconditional-HostPlan descriptions gain a same-landing pointer to this
lowering.

The owner field is absent from client-authored create/update arguments. Create
sets it from `ctx.auth.userId`; update cannot transfer ownership.

**Existence secrecy.** Missing and invisible rows use distinct stable codes in
the server's structured trace, but the public boundary collapses them by
default: generated get returns an empty result, and generated update and
delete return one indistinguishable refusal — the same status, code
(`SNAPBACK_ROW_NOT_FOUND`), and body shape — whether the row is absent or
another owner's. Delete does not report whether a row existed. A target that
distinguishes them publicly must carry an explicit per-target disclosure
declaration; distinction is never a default. This mirrors LLP 0080 §3's
invisible-equals-absent rule, so the generated and relational surfaces share
one secrecy posture. Uniqueness is existence disclosure by conflict: a
client-observable unique constraint consumed by generated create or update
must either include the owner field (owner-partitioned) or carry an explicit
disclosure declaration naming what the conflict reveals; otherwise generation
refuses the table.

Public, role-based, membership-based, and tenant-based standard patterns are
future profiles. They require their own explicit semantics and negative
acceptance cases; a generator must not approximate them with the owner profile.
LLP 0080's explicitly declared, query-only `public-read` relation profile is a
separate authority: it neither creates a public CRUD pattern nor weakens this
RFC's owner-only standard-operation floor. Owner-visible relational outputs
under LLP 0080 consume this profile, so that path additionally requires this
RFC's acceptance.

The floor is per-operation, not a table invariant: a handwritten function on
the same table may legitimately transfer ownership or read publicly, because
enforcement is predicate execution per operation. A table-level visibility
contract is a possible follow-on, not part of v1.

### 3. Common pattern contracts

Every helper and profile carries a stable versioned identifier — `owner.v1`,
`owned-crud.v1`, `owned-unique-lookup.v1`, `owned-keyset-pages.v1` — recorded
in generated artifacts.

**Table eligibility.** Mutating helpers refuse tables that carry membership,
permission-backing, or authority-creating declarations under LLP 0055/0056:
generic CRUD over an authority-bearing table would launder authority creation
past its provenance and effect-site gates. Generation fails with
`SNAPBACK_STANDARD_PATTERN_TABLE_INELIGIBLE` until a dedicated
authority-creating profile exists.

`defineOwnedCrud` derives argument validators from one installed table
builder and emits list/get/create/update/delete definitions. Callers explicitly
name every exported function, operation names must be distinct, and the
document-id argument must not collide with a schema field. Immutable fields and
trusted create/update defaults are explicit options. Trusted defaults cannot
name the owner field, and update defaults cannot name immutable fields. Updates
are complete-field updates for the mutable v1 field set; partial-patch omission
semantics are not guessed. Optimistic concurrency is not claimed: a complete-
field update is last-write-wins within its transaction's read-set validation,
and no version precondition exists in v1. Every helper's top-level options
object is closed; misspelled or future options fail rather than being ignored.

The generated list requires a declared index whose leading field is the owner
field; without one, generation fails with
`SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED` rather than emitting an
unindexed owner scan. List results order by the declared index sequence and
always end with the root `_id` tie-break, making ordering total and
deterministic across targets, and are bounded by an explicit `take` within
LLP 0007's application-query limit.

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
boundary. The continuation cursor is opaque and versioned: it binds the plan
identifier, direction, and the exact unique boundary values. A malformed
cursor, a cursor issued by a different plan, or a cursor whose bound owner
does not match the caller is refused with
`SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID`, never silently repositioned.
Keyset continuation guarantees no skipped and no duplicated row among rows
untouched by concurrent mutations; a row whose cursor field is concurrently
mutated may move relative to the page boundary, and v1 states that bound
rather than hiding it. Authors whose natural cursor is not unique must declare
a unique continuation key or accept that v1 cannot express their pagination;
codegen must not silently synthesize offset pagination. The cursor field is
required and explicit; v1 does not pretend the system `_id` field is
author-indexable.

Trusted defaults accept only `now` and `id`, mapped to the existing
`RuntimeNow` and `RuntimeId` expressions. `now` requires a JavaScript-safe
integer field holding milliseconds; float timestamp fields are not admitted.
`id` is admitted only for a plain required string field, never a principal or
foreign-table ID, and neither default may set the owner field.
The corresponding properties are omitted from operation argument schemas,
whose `additionalProperties: false` rule prevents client forgery.

### 4. Capability and LLP 0053 composition

V1 generated queries are callable and `live_replace`-capable only. Deriving
`authScopeField` from the mandatory visibility declaration is declaration
passthrough, not inference: the author declared the security meaning of the
owner field once, and codegen copies that declaration into the read summary.

Live behavior inherits LLP 0053 unconditionally: authority-partition identity
in the live-query key, complete captured read summaries, conservative
resnapshot on any dependency commit, obligation-backed auth-scoped
replacement, and no proved-disjoint skip claim. Generated queries claim no
retained/offline capability in v1: retention requires LLP 0053's lease rules
plus the LLP 0008 L4-style `authScopeField` convergence fixture, and is a
future profile, not a default. Capability artifacts record exactly these
facts, and a target that cannot honor them reports a machine-readable gap
before invocation.

Generated functions inherit LLP 0004's stable `{appId}:{exportedName}`
identity and rename semantics, and their manifests pass LLP 0037's
schema/manifest drift gate. Each helper's public DTOs — argument and result
schemas and refusal codes — are part of its versioned contract.

### 5. Generated artifacts and diagnostics

Generation remains deterministic and fails before replacing the prior output
tree. Stable authoring diagnostics include:

- `SNAPBACK_STANDARD_PATTERN_TABLE_UNBOUND`;
- `SNAPBACK_STANDARD_PATTERN_TABLE_INELIGIBLE`;
- `SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED`;
- `SNAPBACK_STANDARD_PATTERN_UNIQUE_INDEX_REQUIRED`;
- `SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED`;
- `SNAPBACK_STANDARD_PATTERN_PAGINATION_INDEX_REQUIRED`; and
- `SNAPBACK_STANDARD_PATTERN_INVALID` for closed-vocabulary violations.

Stable runtime codes on the generated surface include
`SNAPBACK_STANDARD_PATTERN_PRINCIPAL_UNSUPPORTED`,
`SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID`, the collapsed public
`SNAPBACK_ROW_NOT_FOUND` (with `SNAPBACK_ROW_NOT_VISIBLE` confined to the
server's structured trace), and `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION` where
a disclosure declaration admits it.

Generated function references and operation schemas remain the public client
surface. The standard-pattern helper itself is package code, not a runtime
dependency of the server or browser bundle.

### 6. Acceptance

Acceptance is semantic. This RFC may move to Accepted when its rules are
internally consistent, reconciled with the governing corpus, and reviewed
under LLP 0005; acceptance authorizes implementation and opens LLP 0063's
entry gate for standard-pattern work, but claims no executable result.
Acceptance amends LLP 0004/0007 with the same-landing conditional-lowering
pointer named in §2.

A separate implementation-conformance suite gates `Implemented` status and
LLP 0063's `STEP5.DECLARATION_REDUCTION` claim:

- generation from one table declaration produces byte-identical artifacts on
  rerun and inferred argument/result types compile;
- omission or misspelling of visibility fails before output, and the named
  negative generation cases — ineligible authority-bearing table, missing
  list/unique/pagination index, wrong pagination index shape, open options
  object — each fail with their stable code;
- cross-user reads, unique lookups, updates, and deletes cannot observe or
  mutate another owner's row in the real server, and the public refusal for a
  missing row is byte-indistinguishable from the refusal for another owner's
  row on get, update, and delete across every claimed adapter;
- a cross-owner unique conflict discloses nothing without a disclosure
  declaration, witnessed on an owner-partitioned and a declared-disclosure
  fixture;
- a client-supplied owner field is rejected on create and on update;
- a generated operation and a handwritten equivalent produce identical auth
  requirements, refusal codes, and read summaries (posture parity);
- trusted `now`/`id` fields reject client-supplied values and use recorded host
  answers under replay;
- non-user principals — anonymous, sealed service, admin — are refused with
  `SNAPBACK_STANDARD_PATTERN_PRINCIPAL_UNSUPPORTED`, and a delegated agent
  resolves to the delegating user's subject;
- concurrent owner transfer and delete race the conditional guard in both
  commit orders without a lost or misattributed write;
- a duplicate-order-key corpus returns byte-identical list and page results
  across the pure evaluator and SQLite, pagination skips and duplicates no
  untouched row, and malformed, cross-plan, and cross-owner cursors are
  refused;
- the generated read/write ceiling is checked against every observed HostPlan
  operation, generation tests assert each constructor's exact expected
  ceiling, and a fault test exercises an out-of-ceiling operation;
- a live generated query resnapshots on a dependency commit under LLP 0053's
  conservative rules and claims no skip or `live_delta`;
- every claimed pattern has an executable receipt, and the Step 5 Partitime
  receipt (or the admitted Step 5 fixture) proves the frozen
  backend-declaration reduction without relaxing its threshold — this receipt
  is a pre-entry witness consumed by LLP 0063's gate, produced after semantic
  acceptance, and does not gate acceptance itself; and
- the no-Exact-core and package-artifact gates rerun.

The current implementation in `packages/snapback-codegen/standard-patterns.*`
is an implementation candidate and unit-level witness. While this RFC is
Draft, it does not satisfy LLP 0063's Step 5 entry gate or promote
`STEP5.DECLARATION_REDUCTION`. Where this revision pins semantics the
candidate does not yet meet — the collapsed public refusal, the list index
requirement, integer `now` fields, principal refusal — the RFC governs and
the candidate must move.

## Open questions

1. Should a follow-on pagination profile generate an explicit compound
   `(cursor, _id)` continuation for naturally non-unique sort keys, reusing
   LLP 0080 §2's rule that opaque cursors may carry boundary keys the
   projection does not expose?
2. Should public standard read patterns share this RFC after a separate
   existence-leak review, or get a smaller follow-on authority?
3. Which static analyzer and source language can prove complete conservative
   ceilings for non-HostPlan handlers without turning undecidability into an
   optimistic fallback?
4. Which client-observable constraint classes, if any, should be admissible
   under an explicit disclosure declaration rather than owner partitioning —
   and should any target class forbid disclosure declarations outright?
5. When a retained/offline profile for generated queries is admitted, does it
   inherit LLP 0053's lease and convergence machinery wholesale, or does the
   generated case justify a narrower fixture?
