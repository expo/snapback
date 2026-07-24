# LLP 0080 — Portable relational queries and maintained projections

**Type:** RFC
**Status:** Draft
**Systems:** Application data API, Query planning, Storage portability, Live Queries, Authorization, Code generation, Maintained projections, Diagnostics, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-24 (GPT round-1 reconciliation: root access is
index-served with examined-entry bounds; the pagination pipeline, cursor
binding, and `root-window-v1` semantics are normative; join-key equality gets
a portable byte-equality comparator with binary-collation index requirements;
`materializeAll` splits logical rows from a deterministic system-field rule
and requires a full streaming digest; the fan-out proof gets a counted unit,
pre/post-image closure, commit-serialized validation, flat projections, and a
per-source static global bound; relational reads inherit LLP 0053 in full
with default-deny retention and output-table read enforcement; existence
secrecy gets a defined observation boundary; shared mutable public joined
sources feeding owner outputs require an explicit disclosure declaration;
left joins cannot derive owner identity from the omissible side; stale
0074/0075 self-references now name 0080/0081); 2026-07-20 (post-review
reconciliation: bounded shared write ceiling, visibility/limit ordering,
rebuild fencing, and v1 visibility profiles are pinned)
**Related:** LLP 0004, LLP 0007, LLP 0008, LLP 0010, LLP 0011, LLP 0012, LLP 0037, LLP 0051, LLP 0053, LLP 0056, LLP 0063, LLP 0065, LLP 0081

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
join pairs/kind, non-security root filters, and projected fields. Core filters
compare fields against literal constants only — they never reference caller
arguments, so a projection core is evaluable with no caller. A callable
`RelationalQueryPlanV1` adds caller-relative source/output visibility,
argument-referencing filters over the same index-served vocabulary, ordering,
cursor shape, and `take`. A `MaintainedProjectionPlanV1` reuses the core but has
its own materialization rules in §5; it does not inherit a callable window.

The generated artifact adds a versioned `RelationalQueryPlanV1` with:

- one named **root** table and exactly one named **joined** table — a
  single-table query is LLP 0004/0007's existing surface, not a relational
  plan;
- distinct stable aliases for both sources;
- one non-empty conjunction of at most four equality pairs between qualified
  root and joined fields, preserving declaration order;
- join kind `inner` or `left`;
- an explicit projection object whose leaves are literals or qualified source
  fields;
- optional root filters from LLP 0007's existing portable filter vocabulary,
  restricted below to the index-served subset;
- deterministic ordering ending in the root `_id` tie-break; and
- an explicit `take` in `0..=1024`.

A callable plan also names a declared **root access index**, and generation
proves plan/index compatibility statically: for an owner-visible root the
index's leading field is the owner field; root filters are index-served — an
equality prefix over the next index fields plus at most one range on the
following field, with no residual post-index predicate in v1; and the
ordering is the index sequence (after the pinned prefix) ending in the root
`_id` tie-break. A plan whose filters or ordering the index cannot serve
fails generation with `SNAPBACK_RELATIONAL_ROOT_INDEX_REQUIRED` rather than
degrading to a scan. A bounded result is therefore also a bounded root
access: targets may not examine an unbounded region to fill a sparse page,
and the acceptance corpus instruments examined-entry ceilings on large,
sparse, mostly-invisible fixtures.

Every equality pair must compare the same admitted portable type: string,
principal/reference id, JavaScript-safe integer, or boolean. Float, decimal,
bytes, and JSON are not v1 join keys. Join-key equality is pinned per type,
and storage equality must equal join equality exactly: strings compare by
byte equality of their UTF-8 encoding — no Unicode normalization, no case
folding, no locale collation, so NFC and NFD spellings are distinct values;
reference ids compare byte-equal and both operands must declare the same
target table domain, with cross-domain pairs failing generation; integers and
booleans compare exactly; a null in any position never matches. A target's
unique and access indexes over join keys must use a binary collation
(SQLite's `BINARY`; a future Postgres profile must prove its collation or
operator class byte-equivalent) or report a machine-readable capability gap —
an index whose collation folds values the comparator distinguishes cannot
prove cardinality. The joined side must have a declared
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

The callable pipeline is normative and named: plan serialization records
`semantics: 'root-window-v1'`, and every evaluator implements exactly

```text
visible root filter → cursor boundary → root order → take N roots
  → join + joined visibility → projection
```

`take` bounds **consumed authorized roots**, not emitted rows. The root
visibility predicate composes into the logical root filter **before**
ordering and `take`; invisible rows cannot occupy a bounded-result slot. The
root table is then filtered and ordered under LLP 0007 before the join is
materialized. Each equality pair uses the same declared-type and null rules as
ordinary portable filters. A null in any join-key position never matches.
`inner` omits an unmatched or invisible joined row without refilling the page;
`left` emits the authorized root with every joined projection leaf set to
`null`, and codegen rejects a result validator that does not admit those nulls.
Cursor advancement follows the root order key, including roots omitted by an
inner join, so a short page cannot duplicate or skip an admitted root on the
next page. The continuation is issued from the last consumed root even when a
page emits zero rows, so an all-omitted window still makes progress. A page
that consumes fewer than `take` roots is terminal and returns no
continuation; `take: 0` returns an empty page with no continuation and
consumes nothing.

The cursor is opaque and versioned. It binds the app, the plan hash, the
normalized non-cursor arguments, the order schema, and the caller's authority
partition. A malformed cursor, a cursor from another plan or argument set, a
cursor crossing an authority transition, or a cursor whose boundary fails its
order-schema validators is refused with
`SNAPBACK_RELATIONAL_CURSOR_INVALID`, never repositioned. Pagination is not
snapshot-consistent across pages: continuation guarantees no skipped and no
duplicated root among roots whose order keys and visibility are untouched by
concurrent mutations; a concurrently mutated root may move relative to the
boundary, and v1 states that bound rather than claiming stability it cannot
witness.

The unique joined index makes the result cardinality at most the bounded root
cardinality. Any target result containing two joined rows for one key is a
storage-invariant failure, not an arbitrary first-row choice. Ordering
references qualified root scalar (non-JSON) fields in v1, independently of
whether they are projected; ordering by joined
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

An owner-visible output must additionally derive its owner identity from a
guaranteed-present source: the root, or the joined side only under an `inner`
join. A `left` join whose owner field comes from the omissible joined side
could emit a durable output row with a null owner and undefined read
authorization, so that combination fails generation, for callable plans and
maintained projections alike.

A maintained projection whose joined source is a mutable shared source —
`public-read`, or owner rows readable by more roots than their own — couples
callers through the shared `fanOutLimit`: success versus
`SNAPBACK_PROJECTION_FANOUT_EXCEEDED` on a root insert or joined-row mutation
discloses how much of a global reference budget other principals have
consumed, and one authority can exhaust capacity another needs. V1 does not
pretend this flow away: such a plan requires an explicit
`sharedFanOutDisclosure` declaration acknowledging the cross-authority
capacity coupling and reference-count signal, or generation refuses it with
`SNAPBACK_RELATIONAL_DISCLOSURE_REQUIRED`. An immutable/versioned dimension
profile whose joined source changes only through privileged rebuild is the
designed future escape from this ceiling.

Both source predicates execute before projection inside the authoritative query
transaction. An invisible joined row behaves as absent: `inner` omits the root
and `left` returns the authorized root with null joined leaves. The
observation boundary is defined, not optional: across application results,
cursors, refusal codes and statuses, transport behavior, and the ordinary
Agent/inspection surfaces, missing and invisible are indistinguishable. The
trace that records which predicate refused a row is a separately authorized,
scoped, and redacted audit channel, not part of the application or default
inspection surface. The claim is semantic noninterference — equal observable
bytes and codes — not a constant-work timing claim; timing-channel hardening
is future work and is not asserted. This boundary governs missing-versus-
invisible on read paths; the separately declared `sharedFanOutDisclosure`
capacity channel (§3, maintained projections) is a write-path signal outside
this claim, which is exactly why it requires its own declaration.

The complete conservative dependency set includes both source tables, every
filter and join index, and every authorization-backing relation declared by the
visibility profiles. It feeds subscription invalidation and LLP 0053's
unconditional auth-scoped resnapshot rules. It is not itself enforcement;
enforcement is the predicate execution above.

Authority-partition identity remains part of the live-query key. Results,
deduplication, retained rows, and late deliveries never cross an authority
transition even when the relational arguments are byte-identical.

### 4. Live and retained capability

The v1 relational plan is callable and `live-replace` capable. Every
relational read — including a unique lookup that finds no row, whose absence
is a read of the declared index range — registers as a snapshot-bound
`DatabaseCaptured` input under LLP 0053. Owner-visible plans are auth-scoped;
all-`public-read` plans are **not** classified `authorityIndependent` in v1 —
they stay authority-partition-scoped, keeping one conservative delivery rule
for every relational subscription. Live delivery inherits LLP 0053 in full:
obligation-backed shrinking replacement, disposition and acknowledgement
semantics, reconnect/resume resnapshot, denial handling, and protocol gates —
a lost shrinking replacement therefore cannot leave forbidden rows visible,
because the obligation machinery, not best-effort delivery, owns that
guarantee. V1 invalidation
is deliberately table-granular: a commit touching any declared source or
authorization dependency causes an authoritative resnapshot. Relational plans
participate in no proved-disjoint skip path, so LLP 0053's skip convergence
proof is not claimed. Incremental
row-delta delivery is not implied: it requires a separately admitted matcher
that proves both source membership and projected output transitions. Until
then, capability artifacts report `live_replace`, never `live_delta`.

Retention is a closed, default-deny plan capability:
`retention: 'none'` (the default) or `retention: 'opaque-authorized-snapshot-v1'`,
which treats the projected result as an opaque authorized snapshot under
LLP 0053's lease and reconnect rules. No other retention story is admitted in
v1: a profile may not retain and locally re-authorize the dependency closure,
and must not retain unprojected joined rows merely to recompute locally.
Anonymous (`public-read`) results follow the same closed capability; nothing
about public visibility exempts a result from the lease discipline.

### 5. Transactionally maintained projections

`MaintainedProjectionPlanV1` is a `RelationalCoreV1` plus a stable output key
expression, source/output visibility declarations, and publication metadata.
It deliberately has no caller-relative ordering, cursor, or `take`. Its
`materializeAll(core, V)` evaluator runs under internal projection-maintenance
authority, enumerates every root admitted by the non-security root filter,
performs the declared join, and emits rows in canonical output-key order.
Source visibility declarations constrain information flow and the output's read
enforcement; they do not select a caller during maintenance.

The equivalence oracle is split so both halves are decidable.
`materializeAll(core, V)` defines the **logical rows**: the declared
projection leaves plus the output key, from source state at commit version V.
At commit version V, the output table's logical rows in canonical key order
must byte-equal `materializeAll(core, V)`. System fields are defined by a
separate deterministic rule, not by `materializeAll`: an output row's `_id`
derives from a domain-separated digest of the projection's **stored
identity** plus the output key. The stored identity is assigned at first
activation, carries its own activation timestamp, and is revision-stable —
§6's hash comparison detects that a plan changed; it does not re-key rows —
so the same output key owns the same row identity across maintenance,
rebuilds, and plan revisions. The digest maps into LLP 0007's UUIDv7 shape
the way LLP 0081 §3 pins, except the time bits carry the stored identity's
activation timestamp constant rather than a per-migration value, keeping the
mapping key-stable; `_createdAt` is fixed at the row's first materialization;
`_version` and `_updatedAt` come from the maintaining mutation's commit — or,
under an LLP 0081 rebuild, from that RFC's publication constants
(`publicationTimestamp`, publication version) for rows whose logical bytes
changed, with unchanged rows preserving all four fields. Rebuild proof
digests therefore cover logical rows against `materializeAll` and system
fields against this rule, each with explicit parameters — a single
unparameterized byte-equality over both is not claimable and is not claimed.
This retains one shared relational vocabulary and a
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
The affected-key set is closed over the mutation's pre-image and final
buffered post-image: an update that moves a join key contributes the union of
its old and new keys, and each affected output row is evaluated exactly once
against the final transaction snapshot, so repeated writes to one source row
coalesce rather than multiply. The counted unit is a distinct output row
whose bytes change — an affected row whose recomputed logical bytes are
unchanged issues no write and counts nothing, which is decidable because the
mapper is deterministic.
Projection writes count against LLP 0007's complete 1,024-write mutation bound,
including the mutation's direct writes. Each plan declares a static
`fanOutLimit` in `1..=1023`. Before any source write, the runtime uses the root
reverse index to prove both that no joined key would exceed its plan's admitted
reference count and that `direct writes + the sum of distinct output-row writes
across every affected projection` is at most 1,024. The proof is global across
plans, not one independent check per plan, and its reads — the reverse-index
ranges and the active-plan set — are commit dependencies of the mutation:
under the storage transaction's serialization, two concurrent admissions
cannot both observe capacity and both commit past it, and a mutation racing a
plan activation revalidates against the activated set or is refused. A root
insert or join-key change that
would cross a plan limit is refused at admission, so ordinary writes cannot
silently wedge a joined row into permanent un-updatability. Any over-ceiling
operation refuses the whole mutation with `SNAPBACK_PROJECTION_FANOUT_EXCEEDED`
and requires an explicit rebuild/migration. A
mutation either commits source and projection together or commits neither.
There is no after-commit best effort, background repair, or independently
visible projection version in v1. Replay of an already settled mutation cannot
apply projection effects twice.

Plan activation runs under LLP 0081's exclusive barrier and performs the same
proof over existing data and all already active projections. The bound is per
source table in either role: for each table, the worst-case sum of one direct
write plus every active plan's output writes triggered by a single-row
**non-key-moving** mutation of that table — one output row per plan rooted on
it, up to
`fanOutLimit` rows per plan joined to it — must stay within 1,024. Activation
refuses when adding the plan would let any such write exceed that
ceiling, so a table rooted or joined into many plans cannot accumulate an
always-refusing write path that ordinary admission could not have created.
A key-moving update touches the union of pre- and post-image keys and may
therefore exceed what a non-key-moving write proves; it is refused
dynamically by the per-mutation proof and remains expressible as a
delete-then-insert pair of separately bounded mutations — activation
guarantees the non-key-moving path, not atomic key moves at maximum fan-out.

The mapper is deterministic over committed source values. It cannot read wall
time, generate identifiers, perform network I/O, call opaque handlers, or read
tables outside its declared dependency closure. Values such as `updatedAt`
must be supplied by a source mutation's recorded `runtime.now()` result and
stored in the source row.

The output table is ordinary governed schema, but direct application writes to
it are refused. Only its projection owner and the explicit rebuild operation
hold write authority. Reads are enforced symmetrically: the output visibility
declaration binds every read path, so a HostPlan that reads an output table
without composing the output visibility predicate fails generation unless the
function declares system maintenance authority — LLP 0065's floor governs
generated operations, and this rule closes the raw-read locus it does not
cover. V1 projections are flat: a maintained output table may not serve as a
source of any maintained projection — its own or another's — so chains,
diamonds, and cycles are all rejected, and transitive fan-out cannot
accumulate behind the per-mutation proof. A DAG profile with a topological
global bound is future work.

### 6. Rebuild, drift, and recovery

Generation records a canonical plan hash. Activation compares that hash and the
source/output schema hashes with the stored projection identity. A changed plan
does not mutate production data implicitly; it emits a migration/rebuild
requirement consumed by the storage-evolution authority.

V1 rebuild uses LLP 0081's exclusive single-writer barrier. It pins source
commit version V, blocks source writes for the full materialization/publication
window, and proves the new output equals `materializeAll(core, V)` against the V
snapshot. Dual-apply and catch-up rebuilds are future profiles.

Rebuild is deterministic and target-bounded:

1. preflight exact app, target, source schema, output schema, and plan hashes;
2. materialize into a fresh physical output generation in stable key order;
3. validate row count, uniqueness, output validators, and a versioned
   streaming content digest — computed over canonically ordered logical rows
   with domain separation, per LLP 0081's `ContentDigestV1` — against an
   independent `materializeAll(core, V)` evaluation, with system fields
   checked against §5's deterministic rule; sampling never substitutes for
   this full proof in a projection rebuild;
4. atomically publish the new generation at one commit-version boundary; and
5. retain the prior generation until the migration receipt's rollback window
   closes.

A crash before publication leaves the prior generation authoritative. A crash
after publication reopens from the journaled generation identity. Mixed
generations are never query-visible. The migration RFC owns approval,
checkpointing, cleanup, and rollback policy; this RFC owns the projection
invariants it must preserve.

LLP 0080 and LLP 0081 may complete semantic review independently, but their
implementation acceptance transitions are coupled: LLP 0080's rebuild corpus
uses LLP 0081's `RebuildMaintainedProjection` executor, and LLP 0081's
projection step consumes this RFC's split equivalence oracle. The combined
suite carries the stable gate ID `RELATIONAL_MIGRATION_COUPLED_SUITE_V1`, and
neither RFC claims its executable acceptance witness before that suite passes
— restating LLP 0063's conjunction: Step 0 plus accepted 0080/0081 semantics
plus their combined executable witnesses.

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
- `SNAPBACK_RELATIONAL_ROOT_INDEX_REQUIRED`;
- `SNAPBACK_RELATIONAL_CURSOR_INVALID`;
- `SNAPBACK_RELATIONAL_DISCLOSURE_REQUIRED`;
- `SNAPBACK_RELATIONAL_CARDINALITY_UNPROVEN`;
- `SNAPBACK_RELATIONAL_VISIBILITY_REQUIRED`;
- `SNAPBACK_RELATIONAL_VISIBILITY_WIDENING`;
- `SNAPBACK_RELATIONAL_TARGET_UNSUPPORTED`;
- `SNAPBACK_PROJECTION_CYCLE`;
- `SNAPBACK_PROJECTION_FANOUT_EXCEEDED`;
- `SNAPBACK_PROJECTION_DIRECT_WRITE_FORBIDDEN`; and
- `SNAPBACK_PROJECTION_REBUILD_REQUIRED`.

## Acceptance

Acceptance is semantic. This RFC may move to Accepted when its rules are
internally consistent, reconciled with the governing corpus, and reviewed
under LLP 0005; acceptance authorizes implementation and satisfies the
"accepted semantics" half of LLP 0063's Step 5 entry conjunction, but claims
no executable result. Acceptance amends LLP 0004's and LLP 0007's
deferred-work/status sections to point here as the controlling first
relational profile.

A separate implementation-conformance suite — the LLP 0080 half of
`RELATIONAL_MIGRATION_COUPLED_SUITE_V1` — gates `Implemented` status and the
"executable witnesses" half of LLP 0063's Step 5 gate:

- one canonical corpus executes byte-identically through the pure evaluator,
  SQLite, the buffered overlay, the retained/native evaluator, and every
  hosted evaluator enumerated by exact target/profile version in the pinned
  capability manifest; a future Postgres profile joins before it is claimed;
- inner/left joins, compound and null keys, inadmissible/cross-type refusal,
  deliberate below-constraint duplicate injection, ordering, limits, canonical
  result bytes, and read-your-writes have deterministic tests, and the
  comparator corpus includes NFC/NFD spellings, case variants, cross-domain
  reference refusal, integer/boolean exactness, and compound-null keys;
- generation is byte-identical and schema/result drift fails before runtime;
- an instrumented large, sparse, mostly-invisible fixture proves the
  index-served root bound: examined entries stay within the admitted window
  and no target scans to fill a page;
- cross-user negative tests prove root visibility runs before
  ordering/`take`, every joined predicate runs before projection, an invisible
  top-N root consumes no slot, and output visibility cannot widen; tenant
  isolation is app isolation in v1 — LLP 0065 defers tenant profiles, and no
  same-user/multi-tenant claim is made;
- a paired-database fixture differing only by one unauthorized joined row
  proves missing and invisible are byte-indistinguishable across results,
  cursors, codes, and ordinary inspection on every claimed target;
- authenticated and anonymous `public-read` tests prove it grants no write
  authority, retains authority-partition fencing, and cannot launder owner data
  into a public output; owner outputs prove their owner field derives from a
  declared source owner field even when source field names differ, and a
  `left` plan deriving owner identity from the joined side is refused;
- pagination tests prove inner omission may produce a short page without
  refill, an all-omitted window still returns a progressing continuation,
  `take: 0` and end-of-stream behave as pinned, and malformed, cross-plan,
  cross-argument-set, cross-user, stale-authority, and
  order-schema-invalid-boundary cursors are each refused
  with `SNAPBACK_RELATIONAL_CURSOR_INVALID`; concurrent-mutation fixtures
  witness §2's stated bound — no skipped and no duplicated untouched root,
  with boundary movement tolerated for concurrently mutated roots — rather
  than a refusal §2 does not define;
- a two-instance live test proves both dependency tables trigger replacement,
  authority rotation fences predecessor results, and no `live_delta` claim is
  emitted; an obligation-fault test proves a lost shrinking replacement is
  recovered by LLP 0053's machinery rather than leaving forbidden rows
  visible; retention defaults to `none` and
  `opaque-authorized-snapshot-v1` enforces the lease path;
- maintained create/update/delete effects commit atomically with their source,
  idempotent replay applies them once, and an injected failure rolls back both;
- two concurrent admissions racing one remaining unit of fan-out capacity
  cannot both commit; a mutation racing plan activation revalidates or is
  refused; a join-key move counts the union of old and new keys; repeated
  writes to one source row coalesce to one output evaluation; and a chain or
  diamond of projections is refused at generation;
- a raw HostPlan read of an output table without the output visibility
  predicate is refused at generation, and a mutable shared joined source
  feeding an owner output is refused without `sharedFanOutDisclosure`, with
  disclosed-fixture capacity behavior witnessed at 0, 1, 1,023, and 1,024
  references;
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
  callable ordering/`take` and its logical rows byte-equal an independent
  `materializeAll(core, V)` evaluation in canonical output-key order, with
  system fields matching §5's deterministic rule;
- rebuild crash points before and after publication recover one complete
  generation, a source write attempted during rebuild is fenced, and the
  streaming content digest matches an independent `materializeAll(core, V)`
  evaluation under the split oracle;
- Exact/Contract generated result types and Agent inspection consume the
  projected shape without `unknown`, casts, or hidden data-state skips; and
- Partitime or the admitted Step 5 fixture demonstrates both generated helpers,
  records source/glue reduction, and reruns no-Exact-core, authorization,
  package, browser, and native cumulative gates.

Implementation without the same-landing LLP 0004/0007 reconciliation named
above does not open LLP 0063 Step 5.

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
2. Which bounded fields should the separately authorized audit channel retain
   for an invisible joined row while application diagnostics preserve
   existence secrecy?
3. Which target earns the first incremental relational-delta matcher, and what
   measured fan-out threshold justifies it over live replacement?
4. Should projection generation changes always require a shadow rebuild, or can
   a proof-preserving metadata-only change reuse the current generation?
5. Should the immutable/versioned dimension-table profile be the next admitted
   projection profile, retiring most `sharedFanOutDisclosure` uses before they
   spread?
6. What total work and downtime bounds make LLP 0081's exclusive rebuild
   barrier an admitted target profile for large output tables?
