# LLP 0074 — Portable relational queries and maintained projections

**Type:** RFC
**Status:** Draft
**Systems:** Application data API, Query planning, Storage portability, Live Queries, Authorization, Code generation, Maintained projections, Diagnostics, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-20 (post-review reconciliation: bounded shared write
ceiling, visibility/limit ordering, rebuild fencing, and v1 visibility profiles
are pinned)
**Related:** LLP 0004, LLP 0007, LLP 0008, LLP 0010, LLP 0011, LLP 0012, LLP 0037, LLP 0051, LLP 0053, LLP 0056, LLP 0063, LLP 0065, LLP 0075

## Summary

Snapback's first portable relational profile is a closed, generated plan for
bounded two-source equi-joins and transactionally maintained projections. Their
shared relational core is validated before publication, evaluated with one
value model on every target, exposes a complete conservative read/write ceiling,
and carries explicit visibility for every source and output. It never falls back
to raw SQL, an unbounded scan, a client-side join, or post-query authorization
filtering.

The first profile deliberately excludes arbitrary SQL, recursive queries,
aggregates, many-to-many fan-out, and asynchronous materialized views. Those
features need their own admitted profiles. This narrow profile is sufficient to
make ordinary relation lookup and denormalized read models concise without
quietly choosing SQLite semantics or weakening authorization.

This RFC is LLP 0063 Workstream 6's query/projection entry prerequisite. Its
existence does not open that gate: it must be accepted and its acceptance suite
must pass before generated joins or maintained projections can satisfy
`STEP5.DECLARATION_REDUCTION`.

## Motivation

LLP 0004 intentionally keeps the first application API single-table and defers
joins, relation traversal, aggregation, and query planning. LLP 0007 pins the
portable scalar, ordering, limit, cursor, and transaction rules but likewise
does not define a relational plan. Generating a helper before defining that
boundary would make one target's SQL behavior the de facto contract.

The tempting shortcuts are unsafe:

- joining in browser code can expose source rows the caller may not observe and
  cannot provide a truthful server read set;
- authoring SQL fragments loses the shared evaluator used by retained/native
  clients and Cloudflare targets;
- maintaining a derived table after commit creates visible source/projection
  skew and ambiguous replay; and
- deriving output visibility from field names or a source read set repeats the
  inference failure LLP 0065 forbids.

The relational boundary therefore has to be closed data, authorization-aware,
bounded, deterministic, and executable inside the source transaction.

## Design

### 1. Closed relational plan

Generation first normalizes a `RelationalCoreV1`: source tables and aliases,
join pairs/kind, non-security root filters, and projected fields. A callable
`RelationalQueryPlanV1` adds caller-relative source/output visibility, ordering,
cursor shape, and `take`. A `MaintainedProjectionPlanV1` reuses the core but has
its own materialization rules in §5; it does not inherit a callable window.

The generated artifact adds a versioned `RelationalQueryPlanV1` with:

- one named **root** table and at most one named **joined** table;
- distinct stable aliases for both sources;
- one non-empty conjunction of at most four equality pairs between qualified
  root and joined fields, preserving declaration order;
- join kind `inner` or `left`;
- an explicit projection object whose leaves are literals or qualified source
  fields;
- optional root filters from LLP 0007's existing portable filter vocabulary;
- deterministic ordering ending in the root `_id` tie-break; and
- an explicit `take` in `0..=1024`.

Every equality pair must compare the same admitted portable type: string,
principal/reference id, JavaScript-safe integer, or boolean. Float, decimal,
bytes, and JSON are not v1 join keys. The joined side must have a declared
unique index whose complete ordered key is exactly the joined-field sequence;
the root operands have the same arity and order. A non-unique `many` relation is
outside v1 because it changes
result cardinality, cursor identity, fan-out bounds, and retained-delta
semantics. Authors may query the child table directly or maintain a bounded
projection until a later profile admits it.

A maintained projection additionally requires a declared root reverse index
(not necessarily unique) whose leading fields are exactly the root join-field
sequence.
That index is the bounded lookup and admission proof for joined-source fan-out;
targets may not discover affected roots through a table scan.

Unknown properties, aliases, tables, fields, operators, join kinds, and
expressions fail generation. The plan admits no function callback, SQL text,
dynamic property access, target-specific collation, ambient time, randomness,
network access, or action call.

### 2. Portable evaluation semantics

The root visibility predicate composes into the logical root filter **before**
ordering and `take`; invisible rows cannot occupy a bounded-result slot. The
root table is then filtered and ordered under LLP 0007 before the join is
materialized. Each equality pair uses the same declared-type and null rules as
ordinary portable filters. A null in any join-key position never matches.
`inner` omits an unmatched or invisible joined row without refilling the page;
`left` emits the authorized root with every joined projection leaf set to
`null`, and codegen rejects a result validator that does not admit those nulls.
Cursor advancement follows the root order key, including roots omitted by an
inner join, so a short page cannot duplicate or skip an admitted root on the
next page.

The unique joined index makes the result cardinality at most the bounded root
cardinality. Any target result containing two joined rows for one key is a
storage-invariant failure, not an arbitrary first-row choice. Ordering is over
projected non-JSON scalar fields backed by root fields in v1; ordering by joined
fields and projecting JSON leaves are deferred because they would require
join-before-limit planning or a new canonical value encoding. Result bytes use
LLP 0051's canonical JSON-transport representation and retain the projection
declaration's field order.

The opaque cursor may carry root boundary keys, including the `_id` tie-break,
that the application projection does not expose. Ordering fields therefore need
not become result fields merely to preserve pagination identity.

The pure evaluator, SQLite, the buffered read-your-writes overlay, the
retained/native evaluator, and every currently claimed hosted target consume the
same normalized plan. A future Postgres profile must pass the same corpus before
it is claimed. A target that cannot execute the plan reports a machine-readable
capability gap before invocation. No target may silently materialize an
unbounded source and finish the join in memory.

### 3. Visibility and authority

Every source names an explicit visibility declaration accepted by its governing
authorization profile. V1 admits LLP 0065's owner profile and the query-only
`public-read` profile defined here. `public-read` means the source predicate is
true for authenticated and anonymous callers, has no authorization-backing
relation, and grants no generated write authority. It is not a default: every
source and output still declares it explicitly. Public subscriptions continue
to use a provider-issued authority partition, including an anonymous partition,
and the partition rolls on every authority transition under LLP 0063 even when
the visible bytes would be equal. The output also names its visibility
declaration.
Omission fails with `SNAPBACK_RELATIONAL_VISIBILITY_REQUIRED`; table shape,
field names, indexes, and read ceilings infer none of these facts.

Output visibility must be provably no broader than every contributing source:
public output requires all-public sources; owner output may consume public
sources plus owner sources bound to the same explicit authority subject
`ctx.auth.userId`; their physical field names may differ. An owner-visible
output must project its owner field directly from one of those source owner
fields, never from a literal or arbitrary leaf, and codegen proves every other
owner source resolves to the same subject. Any other combination is unproved
and fails generation—v1 has no declassification or visibility-widening escape
hatch.

For a maintained projection, "same subject" is a static row relation, not a
hypothetical caller: every contributing owner field must connect through the
declared join equalities to the source field projected as output owner. A core
that could combine rows owned by different principals fails generation before
`materializeAll`; system maintenance authority never substitutes for that
equality proof.

Both source predicates execute before projection inside the authoritative query
transaction. An invisible joined row behaves as absent: `inner` omits the root
and `left` returns the authorized root with null joined leaves. This rule avoids
an existence side channel while retaining normal left-join behavior. A target
may collapse missing and invisible diagnostics at its public boundary, but the
server's structured trace records which predicate refused the row.

The complete conservative dependency set includes both source tables, every
filter and join index, and every authorization-backing relation declared by the
visibility profiles. It feeds subscription invalidation and LLP 0053's
unconditional auth-scoped resnapshot rules. It is not itself enforcement;
enforcement is the predicate execution above.

Authority-partition identity remains part of the live-query key. Results,
deduplication, retained rows, and late deliveries never cross an authority
transition even when the relational arguments are byte-identical.

### 4. Live and retained capability

The v1 relational plan is callable and `live-replace` capable. V1 invalidation
is deliberately table-granular: a commit touching any declared source or
authorization dependency causes an authoritative resnapshot. Relational plans
participate in no proved-disjoint skip path, so LLP 0053's skip convergence
proof is not claimed. Incremental
row-delta delivery is not implied: it requires a separately admitted matcher
that proves both source membership and projected output transitions. Until
then, capability artifacts report `live_replace`, never `live_delta`.

Offline retention is likewise explicit. A profile may retain the projected
result only when it can retain and re-authorize the complete dependency closure,
or when it treats the projection as an opaque authorized snapshot subject to
LLP 0053's lease and reconnect rules. It must not retain unprojected joined rows
merely to recompute locally.

### 5. Transactionally maintained projections

`MaintainedProjectionPlanV1` is a `RelationalCoreV1` plus a stable output key
expression, source/output visibility declarations, and publication metadata.
It deliberately has no caller-relative ordering, cursor, or `take`. Its
`materializeAll(core, V)` evaluator runs under internal projection-maintenance
authority, enumerates every root admitted by the non-security root filter,
performs the declared join, and emits rows in canonical output-key order.
Source visibility declarations constrain information flow and the output's read
enforcement; they do not select a caller during maintenance. At commit version
V, the output table in canonical key order must byte-equal
`materializeAll(core, V)`. This retains one shared relational vocabulary and a
strong equivalence oracle without turning a durable table into a caller-relative
top-N cache. The plan declares:

- source and output tables;
- source visibility and output visibility separately;
- the root-to-output key expression;
- the complete source dependency set;
- create/update/delete behavior for the output row; and
- a versioned rebuild recipe.

Every source mutation computes the bounded set of affected projection keys and
updates the output in the **same storage transaction and commit version**.
Projection writes count against LLP 0007's complete 1,024-write mutation bound,
including the mutation's direct writes. Each plan declares a static
`fanOutLimit` in `1..=1023`. Before any source write, the runtime uses the root
reverse index to prove both that no joined key would exceed its plan's admitted
reference count and that `direct writes + the sum of distinct output-row writes
across every affected projection` is at most 1,024. The proof is global across
plans, not one independent check per plan. A root insert or join-key change that
would cross a plan limit is refused at admission, so ordinary writes cannot
silently wedge a joined row into permanent un-updatability. Any over-ceiling
operation refuses the whole mutation with `SNAPBACK_PROJECTION_FANOUT_EXCEEDED`
and requires an explicit rebuild/migration. A
mutation either commits source and projection together or commits neither.
There is no after-commit best effort, background repair, or independently
visible projection version in v1. Replay of an already settled mutation cannot
apply projection effects twice.

Plan activation performs the same proof over existing data and all already
active projections sharing each joined source. It refuses activation when any
joined key would make one direct joined-row write plus summed output writes
exceed 1,024. Adding a plan therefore cannot create a cross-plan update wedge
that ordinary admission could not have created.

The mapper is deterministic over committed source values. It cannot read wall
time, generate identifiers, perform network I/O, call opaque handlers, or read
tables outside its declared dependency closure. Values such as `updatedAt`
must be supplied by a source mutation's recorded `runtime.now()` result and
stored in the source row.

The output table is ordinary governed schema, but direct application writes to
it are refused. Only its projection owner and the explicit rebuild operation
hold write authority. Cycles between maintained projections and a projection
reading its own output are rejected.

### 6. Rebuild, drift, and recovery

Generation records a canonical plan hash. Activation compares that hash and the
source/output schema hashes with the stored projection identity. A changed plan
does not mutate production data implicitly; it emits a migration/rebuild
requirement consumed by the storage-evolution authority.

V1 rebuild uses LLP 0075's exclusive single-writer barrier. It pins source
commit version V, blocks source writes for the full materialization/publication
window, and proves the new output equals `materializeAll(core, V)` against the V
snapshot. Dual-apply and catch-up rebuilds are future profiles.

Rebuild is deterministic and target-bounded:

1. preflight exact app, target, source schema, output schema, and plan hashes;
2. materialize into a fresh physical output generation in stable key order;
3. validate row count, uniqueness, output validators, and a canonical content
   digest against an independent `materializeAll(core, V)` evaluation;
4. atomically publish the new generation at one commit-version boundary; and
5. retain the prior generation until the migration receipt's rollback window
   closes.

A crash before publication leaves the prior generation authoritative. A crash
after publication reopens from the journaled generation identity. Mixed
generations are never query-visible. The migration RFC owns approval,
checkpointing, cleanup, and rollback policy; this RFC owns the projection
invariants it must preserve.

LLP 0074 and LLP 0075 may complete semantic review independently, but their
implementation acceptance transitions are coupled: 0074's rebuild corpus uses
0075's executor and 0075's projection step uses this equivalence oracle. Neither
claims its executable acceptance witness before the combined suite passes.

### 7. Generated authoring surface

The first helpers are `defineRelationalQuery` and
`defineMaintainedProjection`. They validate against installed table builders
and produce ordinary function/schema artifacts; the helper packages are not
runtime dependencies of browser or server bundles.

Codegen emits:

- exact argument and result validators/types;
- the normalized closed plan and its hash;
- target capability requirements;
- conservative read/write and authorization dependency ceilings;
- the generated query or projection references; and
- an inspection explanation naming source rows, visibility decisions, join
  lookup, projection generation, and resnapshot reason.

Stable diagnostics include:

- `SNAPBACK_RELATIONAL_PLAN_INVALID`;
- `SNAPBACK_RELATIONAL_INDEX_REQUIRED`;
- `SNAPBACK_RELATIONAL_CARDINALITY_UNPROVEN`;
- `SNAPBACK_RELATIONAL_VISIBILITY_REQUIRED`;
- `SNAPBACK_RELATIONAL_VISIBILITY_WIDENING`;
- `SNAPBACK_RELATIONAL_TARGET_UNSUPPORTED`;
- `SNAPBACK_PROJECTION_CYCLE`;
- `SNAPBACK_PROJECTION_FANOUT_EXCEEDED`;
- `SNAPBACK_PROJECTION_DIRECT_WRITE_FORBIDDEN`; and
- `SNAPBACK_PROJECTION_REBUILD_REQUIRED`.

## Acceptance

Before this RFC may move to Accepted:

- one canonical corpus executes byte-identically through the pure evaluator,
  SQLite, the buffered overlay, the retained/native evaluator, and every
  currently claimed hosted evaluator; a future Postgres profile joins before it
  is claimed;
- inner/left joins, compound and null keys, inadmissible/cross-type refusal,
  duplicate unique corruption, ordering, limits, canonical result bytes, and
  read-your-writes have deterministic tests;
- generation is byte-identical and schema/result drift fails before runtime;
- cross-user and cross-tenant negative tests prove root visibility runs before
  ordering/`take`, every joined predicate runs before projection, an invisible
  top-N root consumes no slot, output visibility cannot widen, and invisible
  joined rows leak no existence fact;
- authenticated and anonymous `public-read` tests prove it grants no write
  authority, retains authority-partition fencing, and cannot launder owner data
  into a public output; owner outputs prove their owner field derives from a
  declared source owner field even when source field names differ;
- pagination tests prove inner omission may produce a short page without refill
  and that the next root cursor duplicates or skips no admitted row;
- a two-instance live test proves both dependency tables trigger replacement,
  authority rotation fences predecessor results, and no `live_delta` claim is
  emitted;
- maintained create/update/delete effects commit atomically with their source,
  idempotent replay applies them once, and an injected failure rolls back both;
- with `fanOutLimit: 1023`, a one-write joined-row update referenced by 1,023
  roots produces exactly 1,024 total writes and succeeds, while admitting a
  1,024th root refuses before any write; a pre-activation 1,024-reference corpus
  refuses activation rather than leaving the joined-row update wedged;
- two projections whose individual fan-outs fit but whose summed output writes
  plus direct writes exceed 1,024 refuse before mutation;
- activating a second plan over existing data performs the same summed proof
  and refuses before publication when the shared joined-key ceiling would be
  exceeded;
- a projection over more than 1,024 total roots proves materialization ignores
  callable ordering/`take` and byte-equals an independent
  `materializeAll(core, V)` evaluation in canonical output-key order;
- rebuild crash points before and after publication recover one complete
  generation, a source write attempted during rebuild is fenced, and the
  content digest matches an independent `materializeAll(core, V)` evaluation;
- Exact/Contract generated result types and Agent inspection consume the
  projected shape without `unknown`, casts, or hidden data-state skips; and
- Partitime or the admitted Step 5 fixture demonstrates both generated helpers,
  records source/glue reduction, and reruns no-Exact-core, authorization,
  package, browser, and native cumulative gates.

Acceptance amends LLP 0004's and LLP 0007's deferred-work/status sections to
point here as the controlling first relational profile. Implementation without
that same-landing reconciliation does not open LLP 0063 Step 5.

## Non-goals

- arbitrary SQL or user-authored query planners;
- non-equality, recursive, many-to-many, or unbounded joins;
- aggregation, windows, grouping, or full-text search;
- asynchronously or eventually maintained projections;
- incremental join deltas;
- inferring authorization or visibility from relation metadata; and
- an online projection-migration protocol, which belongs to the storage-
  evolution RFC.

## Open questions

1. Should the next profile admit a bounded one-to-many relation by requiring a
   per-parent limit and compound unique cursor, or should that remain a direct
   child query plus client composition?
2. Which bounded fields should the already-distinct admin trace retain for an
   invisible joined row while application diagnostics preserve existence
   secrecy?
3. Which target earns the first incremental relational-delta matcher, and what
   measured fan-out threshold justifies it over live replacement?
4. Should projection generation changes always require a shadow rebuild, or can
   a proof-preserving metadata-only change reuse the current generation?
