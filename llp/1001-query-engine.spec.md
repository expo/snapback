# LLP 1001: The query engine — durable store, generations, live subscriptions

**Type:** Spec
**Status:** Draft
**Systems:** `snapback2/crates/snapback2-core` (`store`, `registry`, `live`, `identity`, `successor`, the engine, the IR)
**Author:** Claude Fable 5 (orchestrator) — implementer: codex gpt-5.6-sol, lane A
**Date:** 2026-08-29
**Revised:** 2026-09-05
**Related:** LLP 1000, LLP 1002 (the loop that serves this), LLP 1003 (effects
through the outbox this spec defines), LLP 0329.014.004 §7 (runtime), LLP
0329.014.000 §6 (execution, trace, states), LLP 0329.016 §5.6 (no silent
states), LLP 0331 §"Failure and disclosure semantics" / §"Amendment to
ruling 0" (Draft Research that informed the implemented alignment recorded
here; it is not a governing Snapback2 spec),
`issues/closed/20260830-snapback2-align-rules-with-llp-0331.md`,
`spikes/bounded-programs/REPORT.md` ("Known S1 limits")

## Summary

Spike S1 left an interpreter: one program, one in-memory SQLite transaction,
an authoritative trace and a closure receipt, and a note that "no OCC or
subscription invalidation engine consumes [the trace] yet." This spec turns it
into the query engine Snapback 2 serves from: a **durable store** with a commit
log, a **generation** (schema + certified programs + effect declarations)
loaded from the compiler's project JSON and replaced in place by an additive
successor, **live subscriptions** invalidated from the authoritative trace,
the **identity** primitives the loop's `auth` and personas stand on, the
`channel` kind's admission probes, and the `emit` statement that writes the
transactional **outbox** LLP 1003 drains. Everything here is synchronous,
single-writer, and owned by one process (LLP 1002's owner); JavaScript never
enters this crate (LLP 1000 decision 3).

Implementer and date, as `rules/RULES.md` requires: codex gpt-5.6-sol (xhigh),
lane A, 2026-08-29. Only what runs binds; sections marked *deferred* do not.

## 1. Store (`store.rs`)

```rust
pub struct Store { conn: rusqlite::Connection }
impl Store {
    pub fn open(path: &Path) -> Result<Store, RuntimeError>;   // WAL, busy_timeout 5 s, foreign keys off
    pub fn memory() -> Result<Store, RuntimeError>;            // what Engine::memory used
    pub fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError>;
    pub fn commit_seq(&self) -> Result<u64, RuntimeError>;     // last committed seq, 0 when empty
    pub fn commits_since(&self, seq: u64, limit: usize) -> Result<Vec<CommitRecord>, RuntimeError>;
    pub fn snapshot_to(&self, path: &Path) -> Result<(), RuntimeError>;  // `fork`: rusqlite backup API
    pub fn reset_data(&mut self) -> Result<(), RuntimeError>;  // rows, index_entries, _commits, _outbox; keeps _principals/_credentials/_sessions/_meta
}
```

System tables, all created by `Store::open`/`memory` (idempotent DDL, one
place):

| table | columns | owner |
|---|---|---|
| `rows`, `index_entries` | as S1 | engine |
| `_meta` | `key TEXT PK, value TEXT` — `schema_hash`, `generation`, `created_at`, `store_version`, lazy `id_namespace` and `id_high_water` | store |
| `_commits` | `seq INTEGER PK, at INTEGER, program TEXT, principal TEXT, kind TEXT, by TEXT NULL, touched TEXT(JSON), writes TEXT(JSON), emits INTEGER` — bounded: keep the last 10,000, trimmed on insert | engine |
| `_outbox` | `id TEXT PK, seq INTEGER, effect TEXT, payload TEXT(JSON), state TEXT, attempts INTEGER, next_at INTEGER, last_error TEXT, result TEXT(JSON), created_at INTEGER, updated_at INTEGER` + index on `(state, next_at)` | engine writes, LLP 1003 drains |
| `_principals` | `id TEXT PK, kind TEXT ('user'\|'guest'\|'persona'\|'system'), name TEXT, created_at INTEGER` | identity |
| `_credentials` | `principal TEXT PK, email TEXT UNIQUE, hash TEXT` | identity |
| `_sessions` | `auth_epoch INTEGER PK AUTOINCREMENT, token_digest BLOB UNIQUE CHECK(length=32), principal TEXT, kind TEXT, created_at INTEGER, expires_at INTEGER` | identity |

Tables whose names begin with `_` are engine-owned: the schema may not declare
them (`E_SCHEMA_RESERVED`), programs may not read or write them, and `data`
reads them only through the dedicated verbs.

Application row identity is intrinsic: the serialized row's `id` always equals
its `rows.row_id` storage address. Insert derives the address from the row;
update/replace and both upsert branches reject a mismatch before changing the
row or its index entries. An addressed write never migrates a row to another
identity.

Serving-owner ids come from fixed ranges reserved in `_meta`. On the first
mutation that needs an id, an existing v2 store lazily receives a random
per-store namespace and a high-water mark. The owner commits the next
high-water mark before exposing any id from that range, so rejected
transactions and crashes may leave gaps but cannot make an exposed id
available again after reset or restart. The new namespace-qualified format is
disjoint from the legacy `id-<millis>-<counter>` format. Queries and channel
operations do not reserve ranges.

**Exclusive write ownership** (LLP 0329.021 P2, LLP 0329.022 R1 — folded
2026-08-30). The Snapback 2 owner is the *only* writer of its store. An
external writer advances no commit `seq`, joins no read-set validation, and
applies no maintained-aggregate delta, so a receipt minted over a database
someone else writes is unsound in the silent direction (`Fresh` over rows
that moved). `Store::open` therefore takes the file exclusively
(`PRAGMA locking_mode = EXCLUSIVE` in WAL mode) and stamps `_meta.owner` with
the opening process; a second opener fails with `E_STORE_OWNED` naming the
holder. "Snapback in front of a database another system writes" is not an
integration this engine supports; the honest forms are that system writing
*through* named mutations, or being read-only.

`Engine` keeps its shape (`execute(program, certificate, context)`), but is
constructed over a `Store`: `Engine::new(store, schema)`; `Engine::memory(schema)`
remains as `Engine::new(Store::memory()?, schema)` so the receipt-only client
and the corpus exporter do not change.

## 2. What a commit records

The runner already counts writes per table. It now also records **touched
index keys** — for every inserted, updated, upserted, deleted, or maintained
row, the `(table, index, key)` entries that row had *before* and *after* the
write, for every index of the table:

```rust
pub struct TouchedKey { pub table: String, pub index: String, pub key: Vec<Value>, pub row_id: String }
// A write to a table with no index still emits one TouchedKey { index: "", key: [] } — the
// table-level sentinel `constraint_inputs` overlap matches on (ruling 2026-08-30).
// AuthoritativeTrace gains: pub touched: Vec<TouchedKey>, pub emits: Vec<EmitRecord>
```

`Engine::execute` on a mutation appends one `CommitRecord` to `_commits` in
the same transaction:

```rust
pub struct CommitRecord { pub seq: u64, pub at: i64, pub program: String, pub principal: String,
                          pub kind: String /* "mutation" | "system" | "seed" | "operator" */,
                          pub by: Option<String>,
                          pub touched: Vec<TouchedKey>, pub writes: BTreeMap<String, u64>, pub emits: u64 }
```

Operator mutations (LLP 1016 D1/D6, implemented J1a 2026-09-05) record
`kind: "operator"` and `by`, a validated operator name today and a token id later;
attribution is ledger text and never creates a principal.
Operator reads record their op and attribution in the owner log; they do
not append a commit. Queries record nothing in `_commits`. `seq` is the store's version: every result, receipt,
and delivery carries the `seq` it was computed at.

Certification and runtime containment count physical maintained-target writes,
not merely source statements. An insert or delete applies each declared
maintain once; an update or upsert may remove the old contribution and add the
new contribution, so it reserves two target applications per maintain. The
write ceiling covers direct plus maintained applications, and runtime compares
each table's trace against only the direct and maintained sites that can write
that table.

**The receipt factors three ways** (LLP 0329.021 P4/P5, folded 2026-08-30),
by who may issue each part: `rows` — "I hold these" — is client-issuable;
`absences` and *complete* `ranges` — "no row exists there / this range is
whole" — and `verdicts` — "this principal may see this" — are authority-only.
An absence is also bound to the schema hash under which authority observed it;
a predecessor absence is not authority after a successor. Receipt-only
maintained prediction may apply a delta only when the exact target row is held
or a same-schema authority-issued `byId` absence proves its deterministic id
starts at zero; otherwise the whole local mutation rolls back as
`Partial(["missing-authority"])`.
The engine keeps the containment invariant `receipt ⊆ trace ⊆ certificate`
*asserted*, not merely true by construction: `assert_bounds` checks
`receipt.absences ⊆ trace.absences` beside rows, ranges, and verdicts, with a
negative test (`issues/20260829-bounded-programs-receipt-absences-unvalidated.md`).
Nothing in this crate ever constructs a receipt from anything but a trace.
The receipt-only client may use a hidden `Exists` input only through an exact
verdict match on rule hash, pinned-input digest, principal, and auth epoch. A
held application row is never substitute authorization. A missing or stale
verdict fails closed and makes the replay `Partial { reason:
"missing-authority" }`; negation or disjunction cannot invert that unknown
input into access. A receipt-only mutation that observes the miss rolls back
its entire tentative local transaction before returning `Partial`/`Null`.
Store-authoritative execution continues to resolve and mint the verdict from
durable rows.

Read-site names are certificate identities, not diagnostic labels. Compiler
lowering preserves the first readable inferred name and deterministically
suffixes later collisions within one operation. Raw project JSON that reuses a
site for incompatible point/range, table/index, bound, or provenance shapes is
refused with `E_TRACE_SUBSET`; equal shapes may reuse a site and aggregate its
maximum call count. Certification therefore cannot silently collapse two
reads into a certificate that only one of them can execute.

## 3. Read and write states (no silent states)

`Execution` gains a typed state. A query's state is derived, never guessed:

| state | when |
|---|---|
| `Complete` | every traced range stopped `Exhausted`, no site was cut by a ceiling, and the certificate proves each scanned range's read rule uniform for the running viewer over its scanned prefix; only those certified-uniform ranges may carry complete range or absence claims in a receipt |
| `Capped` | the certificate marks any site capped-only because its rule is not provably uniform over the scanned prefix, or an authoritative-trace range stopped `Limit`; this is one opaque label with no site, stop reason, or take echo |
| `Partial { reason }` | reserved for the client twin (coverage miss); the server never returns it |
| `Denied { rule }` | `RuntimeError::Rule` on a read site, or `RuntimeError::Require { code }` raised inside a query (`rule = code`) — the program refusing is the honest "denied" (review ruling 2026-08-30, M1) |

**Amendment — Ruled by the author 2026-08-30.** `take` counts visible rows
only. A denied candidate consumes the certified examined and rule-probe budgets,
never `take`. A rule may be evaluated once for a range only when the existing
hoist analysis proves every rule input pinned by that range's prefix. When that
hoisted verdict is uniformly false for the viewer, the range halts after the
single determination without fetching or charging the hidden population row by
row, records `Exhausted`, and returns the same complete empty receipt as a
physically empty range. Empty, two-hidden-row, and at-least-examined-ceiling
ranges are therefore viewer-observably identical in that case.

A non-uniform site is capped-only regardless of what its runtime candidates
happen to show. It collects visible rows only until `take`, within the certified
examined/rule-probe budget. If that budget cuts the page, the engine returns the
visible rows found so far and the opaque `Capped` label. A nonempty capped
result page carries `next`, an opaque receipt-time position derived only from
its last returned row, never an examined or hidden position. A `Complete`
result page carries `next: null`. An empty `Capped` page carries `next: null`
and is the terminal drain
state, whether the range was physically exhausted or a hidden run consumed the
budget. Rows beyond a hidden run longer than that budget are unreachable in the
drain; the paved escape is the existing denormalize-the-scope rewrite. There is
no examined/storage-position continuation and no server-held scan state. The
engine may internally distinguish take, ceiling, and exhaustion stops, but the
result label, wire, and receipt may not.

**Certified bound, aligned 2026-09-05.** A hoisted site certifies its computed
reserve (`take + 2` examined and index entries per call); only a program with a
non-uniform site certifies the examined, index-entry, rule-probe, and step
ceilings. The 2026-08-30 implementation keyed the examined substitution on any
non-public read rule, so every membership-gated list certified the ceiling; the
runtime never traced more than the reserve on such a site, and the certificate now
says so (LLP 1017 §1). The scan summary composes the work of its prefix and bounds
with the scan's own reserve instead of overwriting it. A uniform scan's fetch is
clamped to `take + 2` like a public one; the certificate counts traced candidates
and, after this alignment, the fetch is bounded by the same number plus the one
probe row.

An opaque cursor is canonical base64url of the tagged, versioned encoding
`[version, table, index, order, suffix descriptor, suffix values]`. Values keep
their index-column types, including nominal `Id` versus `String`; decode is
size-bounded and must canonically re-encode. Version, table, index, order, and
the exact post-prefix descriptor must match before any scan or the request is
`E_INPUT`. Tokens are not site-bound. `after: c` selects rows following the
position in requested order (`>` ascending, `<` descending). The index is a
total order (ending in `id`, or unique); pageable merge indexes end in intrinsic
`id`. Raw IR retains tuple `after`/`before` as lowering targets. Explicit
`range.gt/gte/lt/lte` bounds remain key-order comparisons.

> ~~A drain always makes visible progress (no starvation).~~
>
> **Amended 2026-08-30 (orchestrator; ratified by the author 2026-08-30):
> no-starvation is scoped to the certified examined budget; an empty Capped
> page is the terminal drain state.**

A query or mutation that returns or writes a count, an emptiness/has-more
branch, or another absence-dependent result from a capped-only site is refused
at certification with the existing `E_STRUCTURAL_COUNT` family. Its pasted
rewrite is to denormalize the authorization scope into the index prefix so the
rule becomes uniform, or to read a maintained aggregate. Hidden rows remain in
the authoritative trace for invalidation and OCC and remain absent from the
receipt. Completeness is still derived from the trace, never the receipt; the
round-2 M2 correctness point survives because `Complete` is now available only
where the certificate makes the trace and receipt agree on the visible range.

> **Superseded history:** ~~`Complete` meant every traced range stopped
> `Exhausted` and no site was cut by a ceiling — including a range whose
> examined rows were all hidden: hidden rows are invisible, never a signal
> (LLP 0329.014.004: results are never functions of invisible-row counts).~~
>
> ~~`Capped { site, take }` meant some *authoritative-trace* range stopped
> `Limit` (the certificate's `completeness: Page | Capped`) — regardless of
> whether the examined rows were visible: hidden rows consumed `take` (spike
> S1 ruling 2), so `Capped` disclosed nothing the page size did not, and
> computing the state from the receipt (which omitted the stop reason when
> hidden rows were examined) would silently drop a later visible row (review
> ruling 2026-08-30, round 2 M2).~~

A query that hits a runtime *value* error (`E_DIV_ZERO`, `E_OVERFLOW`, `E_TYPE`,
`E_FIELD`) is `Err(RuntimeError)`, not a state — the loop serves the refusal
envelope, and a live rerun delivers it as `refused` (`Delivery.execution` is a
`Result`). A `Denied` query keeps its full authoritative trace so the
subscription stays indexed and re-admits when the denying key is touched.

A mutation's outcome is `Committed { seq }` or `Rejected { code, message }`
(`RuntimeError::Require`, `::Rule`, `::Constraint`, `::Input`, and every
SQLite constraint failure — duplicate row id, duplicate outbox id, unique
index — as `E_CONSTRAINT`; table-rule denial is `E_RULE` with family `rule`;
a program execution never surfaces a raw SQL
error except for I/O or corruption); bound overruns (`Steps`, `Fanout`,
`TraceSubset`) are `Rejected` with the family `bound`. The state is a field on `Execution`, and the JSON the loop serves is
the serde form of that field (LLP 1002 §4).

## 4. Generation and runtime (`registry.rs`, `successor.rs`)

**Amendment 2026-09-05 (LLP 1016 D4, J1a):** Removing only the outer
optional wrapper (`T?` → `T`, with the same non-optional `T`) is additive
when every stored row has a non-null value; absence counts as null.
Successor and migration application refuse `E_SUCCESSOR_NARROWING` with
`table`, `column`, `nullRows`, and at most ten sample IDs, atomically keeping
the previous generation and rows. The rewrite pastes the fill-job skeleton
(job grammar follows in J1b; today fill with a declared operator mutation).
A new required column's rewrite is declare `T?`, apply, fill, declare `T`,
apply; `check` remains static and never opens the store.

The compiler (LLP 1002 §3) emits one **project JSON**; the engine turns it
into a generation:

```rust
pub struct EffectDecl { pub name: String, pub grants: Vec<String>, pub source: String, pub then: Option<String> }
pub struct Generation {
    schema: Schema,
    programs: BTreeMap<String, (Program, Certificate)>,   // key = "module.export"
    channel_certificates: BTreeMap<String, ChannelCertificates>,
    effects: BTreeMap<String, EffectDecl>,
}
impl Generation {
    /// Certify every program; report EVERY refusal, never the first (rules/RULES.md):
    /// `Checker::check_all` returns every structural refusal of a program and every ceiling overrun (all bounds are computed first, then compared).
    pub fn certify(project: &ProjectJson, ceilings: Ceilings) -> Result<Generation, Vec<(String, CheckError)>>;
    pub fn hash(&self) -> String; // computed from the certified schema; never stored or settable
    pub fn schema(&self) -> &Schema;
    pub fn programs(&self) -> &BTreeMap<String, (Program, Certificate)>;
    pub fn effects_hash(&self) -> String; // separately derived from private effect declarations
}
pub struct Runtime { store: Store, generation: Generation, subs: Subscriptions }
impl Runtime {
    pub fn open(store: Store, generation: Generation) -> Result<Runtime, SuccessorRefusal>; // recomputes the handed schema hash; mismatch always runs the successor check
    pub fn execute(&mut self, op: &str, context: Context) -> Result<Execution, RuntimeError>; // E_OP_UNKNOWN when op is not in the generation
    pub fn subscribe(&mut self, op: &str, context: Context) -> Result<(SubscriptionId, Execution), RuntimeError>;
    pub fn rerun(&mut self, ids: &[SubscriptionId]) -> Vec<Delivery>; // resolves op + certificate from the active generation
    pub fn apply_successor(&mut self, next: Generation) -> Result<SuccessorReport, SuccessorRefusal>;
    pub fn seed(&mut self, rows: &[(String, Value)]) -> Result<u64, RuntimeError>;  // one commit, kind "seed"
    pub fn generation(&self) -> &Generation;
    pub fn store(&self) -> &Store;
}
```

`Generation` has no public fields, public mutators, stored hash, or
deserialization constructor: certification is its only construction path.
The hash persisted by `Runtime` and compared on reopen is recomputed from the
private certified schema, so caller state cannot opt a changed schema out of
successor admission. Restart-safe effect delivery uses a separate digest
derived from the private certified effect declarations; that token binds
retained effect source and is never consulted to skip successor validation.

**Subscription replan amendment (author-authorized 2026-08-30).** `Runtime`
has no public handle-execution or caller-supplied certificate surface. The
derived policy-successor check subscribes under generation N, installs the
successor, and reruns the subscription by id; its test receipt records the
schema hash observed at subscribe and the successor certificate's schema hash
at rerun, and requires the successor denial/blank result rather than the
predecessor rows. The engine-level certificate invariant remains separate:
the core unit test presents a predecessor certificate to `Engine` under the
successor schema and requires `E_TRACE_SUBSET`.

**Successors.** A successor is *additive* when every existing table keeps its
columns and their types, every existing index keeps its columns, and nothing
is dropped; programs, rules, constraints, maintains, channels, effects, and
new tables/columns/indexes may change freely. Additive successors apply in
place: new indexes are populated from `rows` in the same transaction. Any
added, removed, or changed maintain causes each affected engine-owned target
to be transactionally replaced from all declarations in the next generation;
removal therefore clears the predecessor projection, and group/kind/source
changes cannot retain stale groups. A migration of any projection-relevant
source or target column also rebuilds even when the declaration itself is
unchanged; an exact migration that drops a removed target does not attempt to
recreate it. Target constraints and unique indexes bind both the clear and
rebuild. Rules and programs swap atomically; subscriptions
are re-executed against the new generation (LLP 1002 rebinds them). Anything
else is *destructive* and is **refused with a plan**:

```rust
pub struct SuccessorRefusal { pub code: String /* E_SUCCESSOR_DESTRUCTIVE */, pub plan: MigrationPlan }
pub struct MigrationPlan { pub drops: Vec<Drop> /* Table{name,rows} | Column{table,name} | Index{table,name} | TypeChange{table,column,from,to} */ }
impl Runtime { pub fn apply_migration(&mut self, next: Generation, plan: &MigrationPlan, released_at: i64) -> Result<SuccessorReport, RuntimeError>; }
```

`apply_migration` performs exactly the listed drops (type changes drop the
column's values) and then applies the successor as additive — *with the same
admission checks* (`E_SUCCESSOR_UNIQUE`, `E_SUCCESSOR_COLUMN_REQUIRED`) as the
additive path, in the same transaction, so a refusal rolls the drops back too
(review ruling 2026-08-30, round 2 G1). The admission comparison retains the
predecessor type until retyped stored values have been dropped and validated
against the successor type, including the reserved-principal walk. A required
retyped column therefore refuses rather than installing an absent value; an
optional retyped column may install as `Null`. Never a prompt,
never a silent drop, never a fresh database (LLP 0329.016 §5.4).
The owner passes one sample of its logical mutation clock as `released_at`, so
asset releases caused by every drop age on the same clock as writes and
reclamation (LLP 1006 §9).

**Generation fencing.** The served runtime accepts an operation name and
resolves its program, certificate, and table rules from the one active
generation at execution time. Applying a successor swaps that set atomically
and re-executes existing subscriptions against it; a caller cannot submit a
predecessor `Program` or `Certificate` through the served surface. Any
durable intent whose target survives beyond one execution must bind the
generation and, where it names a replaceable authority row, that row's
immutable identity/incarnation or expected version. A stale predecessor
policy must not authorize after succession, and deleting then recreating the
same `(scope, principal)` key must not retarget an old promote/remove intent.
The named closure proofs are specified in LLP 1002 §7. The canonical served
receipt now passes all three, including remove/recreate replay against the
intrinsic membership-row incarnation; the alignment issue is resolved.

**Seed writes and maintained-target rows are engine-owned** (rulings
2026-08-30). `Runtime::seed` uses a purpose-specific engine entry point whose
system context cannot be constructed by an ordinary caller, and is exempt
from the tables' user rules (never from constraints, unique indexes, or
column validation) — a seed is data the author declared, not a client
intent. Every table schema must declare the compiler-implicit `id: Id` column,
and every write rejects fields outside the table declaration. Seed and
caller-controlled values may not carry the reserved `system` token in the row
id or any nested value, including optional/list/JSON values that could later
be projected into an actor-bearing slot. Likewise:
The target table's `insert`/`update`/`delete` rules bind only non-engine
writers — templates set them to `deny` — and the engine's aggregate writes
are exempt from those rules and never from constraints or unique indexes.
Both authored lowering and raw schema certification validate a maintain as one
closed projection: `by` fields are unique and may not be the reserved `id` or
`value`; `sum.of` is `Int`, `Decimal`, or `Money`; the target has intrinsic
`id`, exactly the type-compatible group columns, and an aggregate `value` that
is `Int` for count or exactly matches the sum source column's type; and one
declaration owns a target. A maintained target may not itself be any maintain's source; transitive
projection chains require recursive amplification/cascade semantics this slice
does not claim. These checks prevent a group field from overwriting aggregate
identity/value and make rebuild ownership unambiguous.
Both runtimes materialize an omitted `Optional` source field as `Null` before
rule evaluation, storage, and maintained grouping, so the same valid authored
row produces the same aggregate key during prediction and authority execution.
A successor rebuild validates the complete projected target against next
uniqueness before mutation, then clears stale rows with delete-applicable
constraints only; uniqueness is not rechecked on a removal that cannot create
a duplicate. The rebuilt inserts bind every next constraint and unique index.
A user mutation writing a maintained target is `Rejected(E_RULE)` by its rule.
Successor rebuilds own exactly the union of target row IDs projected by the
predecessor and successor maintain declarations: they replace or remove those
IDs and preserve every other target row and index entry.

Three rulings from the 2026-08-30 review (M3, M4, M8):

- **Atomic.** `apply_successor` and `apply_migration` run in one transaction
  — drops, index population, aggregate backfill, `_meta` — and any failure
  leaves the old generation active and its data intact.
- **A new unique index is checked.** Populating it over existing rows that
  collide refuses the whole successor with `E_SUCCESSOR_UNIQUE` (table,
  index, up to 10 conflicting keys; rewrite: make it non-unique or fix the
  rows). `SuccessorRefusal` therefore carries `code` and either `plan`
  (destructive) or `conflicts` (unique).
- **A new column on a table with rows must be `Optional`.** Otherwise the
  successor is refused with `E_SUCCESSOR_COLUMN_REQUIRED` (rewrite:
  `t.optional(...)`, or add it while the table is empty). Existing rows keep
  their JSON; an absent optional column reads as `Null`.

**Stored-row admission amendment (author-authorized 2026-08-30).** Row
validation runs only while installing a successor, never while reopening an
already installed generation; there is no validation watermark in `_meta`.
For existing rows it validates only newly declared columns and columns newly
interpreted as `Id`/`Ref` (including nested optional/list forms), applying
both field validation and the reserved-principal walk. An unrelated legacy
undeclared field therefore cannot block a clean additive successor, but a
successor that declares that field refuses with `E_SUCCESSOR_ROW_INVALID`
naming the offending row.

## 5. Live subscriptions (`live.rs`)

```rust
pub type SubscriptionId = u64;
pub struct Subscriptions { /* id → (op, context, last result digest, last seq); key indexes below */ }
pub struct Delivery { pub id: SubscriptionId, pub seq: u64, pub execution: Result<Execution, RuntimeError>, pub changed: bool }
impl Runtime {
    pub fn subscribe(&mut self, op: &str, context: Context) -> Result<(SubscriptionId, Execution), RuntimeError>;
    pub fn unsubscribe(&mut self, id: SubscriptionId);
    /// Which subscriptions a commit touched. Pure; O(touched keys · matching entries).
    pub fn invalidated(&self, commit: &CommitRecord) -> Vec<SubscriptionId>;
    /// Re-execute the named subscriptions once each (coalesced), diff against the last result digest.
    pub fn rerun(&mut self, ids: &[SubscriptionId]) -> Vec<Delivery>;
    pub fn subscriptions(&self) -> Vec<SubscriptionInfo>;   // for `dev --status`, `why`, `trace`
}
```

Indexing comes from the authoritative trace, never the receipt (hidden rows
included, LLP 0329.014.004 §7 "Two traces"):

| trace item | index entry | overlaps a `TouchedKey` when |
|---|---|---|
| `ranges[]` (site, table, index, prefix) | prefix map | same table+index and `touched.key` starts with `prefix` |
| `points[]` and `absences[]` (table, index, key) | exact map | same table+index and `touched.key == key` |
| `rule_inputs[]` (table, index, key) | exact map | same table+index and `touched.key == key` — this is how adding a membership row re-delivers a thread |
| `constraint_inputs[]` | table map | same table |

Conservative by design: a range with `after`/`before`/`range` bounds is
indexed by its prefix alone (a superset), and a rerun that produces the same
`(state, result)` digest is delivered with `changed: false` so the loop can
coalesce — the state is part of the digest, so `Complete` → `Denied` over the
same payload is a change. Every write emits at least one touched entry for its
table even when the table has no index, so `constraint_inputs` overlap works
without assuming `byId` exists (round 2 G2/G3).
`rerun` executes at most once per id per call, in id order, and updates the
subscription's key entries from the fresh trace. Subscriptions live in memory
with the owner; a restart re-subscribes from the clients (LLP 1002).

A `Delivery` for a subscription whose read is now `Denied` (a revoked
membership) is delivered with that state — the client sees `denied`, not a
silent empty page.

## 6. Identity (`identity.rs`)

Authentication is always on (LLP 1000; LLP 0329.016 §5.5). The engine owns
the primitives; the loop owns the routes.

```rust
pub struct PrincipalId(String); // opaque nominal authority subject
pub struct Principal { pub id: PrincipalId, pub kind: String, pub name: Option<String> }
pub struct Session { pub token: String, pub principal: Principal, pub auth_epoch: u64, pub expires_at: i64 }
pub struct SessionAuthority { pub principal: Principal, pub auth_epoch: u64, pub expires_at: i64 }
impl Runtime {
    pub fn signup(&mut self, email: &str, password: &str, now: i64) -> Result<Session, IdentityError>;  // E_AUTH_EMAIL_TAKEN, E_AUTH_PASSWORD_WEAK (< 8 chars)
    pub fn login(&mut self, email: &str, password: &str, now: i64) -> Result<Session, IdentityError>;   // E_AUTH_INVALID (one code for unknown email and wrong password)
    pub fn guest(&mut self, now: i64) -> Result<Session, IdentityError>;                                 // refused E_AUTH_GUESTS_OFF unless the project's auth.guests
    pub fn ensure_persona(&mut self, name: &str, now: i64) -> Result<Principal, IdentityError>;          // stable dev alias; no session side effect
    pub fn persona(&mut self, name: &str, now: i64) -> Result<Session, IdentityError>;                   // fresh finite session for `dev:<name>`
    pub fn authenticate(&self, token: &str, now: i64) -> Result<SessionAuthority, IdentityError>;        // E_AUTH_SESSION
    pub fn logout(&mut self, token: &str, now: i64) -> Result<SessionAuthority, IdentityError>;          // exact live session, else E_AUTH_SESSION
    pub fn expire_sessions(&mut self, now: i64) -> Result<Vec<SessionAuthority>, IdentityError>;         // delete and return every epoch whose exclusive bound has arrived
    pub fn next_session_expiry(&self) -> Result<Option<i64>, IdentityError>;                              // owner polling deadline
    pub fn principals(&self, kind: Option<&str>) -> Result<Vec<Principal>, IdentityError>;
}
```

Password hashing is salted and iterated (argon2id preferred; PBKDF2-HMAC-SHA256
with ≥ 100k iterations acceptable) through one small crate; the hash format is
versioned in the string. Unknown emails and wrong passwords share
`E_AUTH_INVALID`; both paths perform one Argon2id verification outside a
SQLite transaction.

**Author ruling (2026-09-05): remove login throttling entirely for now.**
Successful seed and acceptance logins exhausted the former global and
per-email quotas. Neither successful nor failed logins now consume a quota;
rate limiting is deferred to later work. The bucket code, constants, and
`_auth_throttle` creation/validation are removed. Existing unused throttle
tables do not affect authentication. Password verification and session
issuance/revocation retain their existing semantics.

Tokens are 32 random bytes, base64url. The exact bearer is returned once and
never written to SQLite. `_sessions` stores only
`SHA-256("snapback2-session-token-v1\\0" || bearer_bytes)` as a 32-byte BLOB,
plus principal, kind, creation/expiry times, and an `INTEGER PRIMARY KEY
AUTOINCREMENT` `auth_epoch`. Epoch zero is reserved for trusted system and
development-alias contexts; every persisted session has a positive,
strictly-increasing, never-reused epoch in that store. A session is valid on
`[created_at, expires_at)`; authentication at the expiry instant fails and
expired rows are deleted so clock rollback cannot revive them. Logout verifies
and deletes one exact live epoch; a missing, expired, or already-revoked bearer
is `E_AUTH_SESSION`, not a successful no-op. Multiple sessions for one
principal are independent.

This is a pre-promotion store-format break. `Store::open` accepts only the
canonical digest-only session schema and refuses an older plaintext-token or
unknown hybrid shape before publishing an owner. It does not preserve legacy
bearer continuity or add a compatibility migration; development stores must be
reset. This follows the Snapback2 no-compatibility fence and avoids pretending
that rewriting a live table could erase plaintext from old database copies.

`PrincipalId`
is the nominal authority scalar used by `Context::viewer`; the schema/compiler
surface exposes the same distinction as `t.principal()` / branded
`Principal`. A principal currently serializes through the `Value::Id` wire and
storage representation, but it is not an alias for `Id<profiles>`,
`Id<users>`, or any other application row reference. The type checker rejects
those row-reference values where a principal is required. A program may accept
a target principal argument, while its acting viewer is always supplied by the
verified session rather than caller input.

`principal_kind` remains protected identity metadata (`user`, `guest`,
`persona`, `system`) for diagnostics and compatibility; it grants no rule or
commit authority. The `system` principal exists from `Store::open` and has no
session. Ordinary execution requires the nominal `Actor` type; its private
fields and checked constructors reject the reserved id and kind. The engine's
system-context constructor is private, and only purpose-specific
schedule/effect-`then`/seed entry points can reach it. The reserved token lives
in `snapback2-core/ir-contract.json`, which core and the compiler both consume.
The concrete `Value::Id` encoding is an implementation choice, not a frozen
public wire representation.

Rule typing restores that nominal distinction at both trust boundaries. The
compiler resolves `Field` against the outer table or channel arguments and
checks compatible operands for every `Eq`/`Ne`. For `Exists`, it resolves the
target table and index, requires exact key arity, and checks every key term
against the indexed column. `Viewer` is always `Principal`; only a Principal
field or the reserved `system` principal literal may meet it. A `Ref<T>` may
meet the implicit `T.id` position and no other `Id` or `Principal` axis.
For reciprocal bootstrap rules, the current rule subject's intrinsic
`Id<T>.id` may also satisfy `Ref<T>` for that same table; no other `Id`/`Ref`
coercion is admitted. `Generation::certify` repeats the same structural checks
over raw `ProjectJson`, so bypassing the authored compiler cannot erase the
boundary; violations are sited `E_RULE_INVALID` refusals.

`PrincipalId::new`/string conversion are trusted host, persistence, and test
representation constructors, not authentication evidence. Untrusted served
requests acquire their acting `Context::viewer` only through session
authentication (or the development-only persona boundary); accepting a
Principal-typed target program argument never changes the acting viewer.

Persona aliases are ordinary protected principals with deterministic
`dev:<name>` ids in one development store. Owner startup and
`X-Snapback-As` call `ensure_persona` and create no durable session; the header
is a loopback-development shortcut with `auth_epoch = 0` and is refused by a
served/production owner. `snapback2 persona create` issues a fresh finite
bearer each time for that same principal, so persona session expiry and logout
exercise the ordinary persisted-session path rather than an immortal token.
`Session` and bearer identities use redacted debug formatting; tokens never
appear in receipts, traces, owner status, URLs, app rows, or logs.

## 7. Channels (`schema.channels`)

```rust
pub struct Channel { pub args: BTreeMap<String, ArgType>, pub publish: RuleExpr, pub subscribe: RuleExpr, pub ttl_ms: u32 }
pub struct ChannelVerdict { pub admitted: bool, pub rule_inputs: Vec<RuleInputTrace>, pub points: Vec<PointTrace> }
impl Runtime {
    pub fn channel_admit(&mut self, name: &str, side: ChannelSide, args: &BTreeMap<String, Value>, context: &Context) -> Result<ChannelVerdict, RuntimeError>;
    pub fn channel_touched(&self, commit: &CommitRecord, verdict: &ChannelVerdict) -> bool;   // does this commit overlap the verdict's traced keys
}
```

The admission rule is evaluated over the args as the row (`RuleTerm::Field`
reads an arg), and the verdict *carries its trace* (review ruling 2026-08-30,
M7) so the loop indexes each subscriber by the probe's keys and re-admits on
the commit that touches them — a deleted membership drops the subscriber.
Every lookup performed while deriving a referenced row's visibility is also
an authoritative rule probe. Generation certification emits separate
publish/subscribe rule certificates with transitive probe and step ceilings;
channel admission presents the selected certificate to the runner, which
enforces both ceilings.
No persistence, no receipt, no prediction (LLP 0329.014.000 §8). The fan-out
itself is the loop's (LLP 1002 §4).

**Authorization amendment (2026-08-30).** `RuleExpr::Exists` has no authored
`input_visibility` field, and `rule.exists` has no `hidden` option.
Certification binds each scoped verdict to the complete schema hash plus its
enclosing rule, so any referenced policy replacement changes the verdict and
certificate hashes, including through cyclic rule graphs. Structural
substitution against the active target table's `read` rule alone determines
whether the exact indexed input is readable, as specified in §9; a runtime
policy success cannot reveal an input whose structural proof fails. The server
still evaluates that policy so every transitive `Exists` lookup remains in the
authoritative trace and certificate meter. This gives cyclic rule graphs a
finite one-level disclosure bound while preserving short-circuit `And`/`Or`
ceilings. Both outcomes are deterministic and covered by exact-ceiling core
tests and client-twin successor tests (LLP 0331 §"Failure and disclosure
semantics").

## 8. `emit` and the outbox

IR: `Stmt::Emit { effect: String, payload: Expr }`. The certificate counts it
as a write site `{ table: "_outbox", kind: Emit, max_rows: 1 }` per static
occurrence (times the enclosing loop bound, like any write) and refuses an
`emit` in a query (`E_EMIT_IN_QUERY`) or naming an effect the generation does
not declare (`E_EFFECT_UNKNOWN`, checked at `Generation::certify`). At
runtime the runner consumes one id from the `new_ids` queue (so the client
twin, which treats `Emit` as a no-op *that still consumes the id*, stays
aligned) and inserts an `_outbox` row with `state = 'queued'`, `seq` = the
commit's seq, `attempts = 0`, `next_at = now`. `AuthoritativeTrace.emits`
records `{ id, effect }` for `trace`. Nothing else in this crate knows what
an effect is. Serving mutation and effect-then contexts fill that queue from a
durable range whose high-water mark was committed first; deterministic replay
contexts may instead inject their pinned ids directly.

## 9. Schema additions

### Authorization rule alignment

The core rule algebra has `Field`, `OldField`, `NextField`, `Viewer`, and
`Literal` terms. `Field` reads the candidate row (and therefore the next image
for an update). `OldField` and `NextField` are legal only in a table update
rule. An update rule is evaluated exactly once with both images; it is not an
independent old-row check followed by an independent next-row check. This
makes a transition such as member → admin expressible while binding its scope
and Principal axes across the transition.

`system` is one reserved principal value, not a principal class: the authored
`rule.system()` convenience in LLP 1002 lowers exactly to
`Eq(Viewer, Literal(Id("system")))`. There is no `PrincipalKind` rule
expression. Principal kind may remain protected identity metadata, but rules,
certificates, traces, and commit classification do not grant authority from
it.

`RuleExpr::Exists { table, index, key, provenance }` carries no authored
visibility field. The active target table's read policy determines whether
the exact indexed input may enter the readable row/absence trace or must
remain an authority verdict:

1. `Public` and `Allow` targets are readable.
2. A protected target is readable only when structural substitution proves
   its read rule for the **same exact indexed row**. Each target-row `Field`
   term must be an indexed column supplied by the outer probe key. After
   substitution, `Eq` must be reflexive; every arm of `And` must prove, one
   arm of `Or` may prove, and a self-`Exists` must name the same table/index
   and reduce to the identical outer key. This admits the canonical
   self-readable `(scope, viewer)` membership row without an author flag.
3. `Deny`, `Ne`, `Not`, a different/cross-table probe, a field outside the
   indexed key, or any unsupported shape fails closed to hidden.

The server and client evaluator use the same structural test. Hidden inputs
remain in the authoritative trace for invalidation and OCC, but the client
receives only an authority verdict. There is no `Readable`/`Hidden` IR enum
and no author-controlled escape hatch.

`RuleExpr::Created { table, index, key, provenance }` is a distinct,
insert-rule-only point probe. It is true only when the exact indexed target row
was inserted earlier by the same transaction; finding an indistinguishable
pre-existing row is false. The provenance fact is transaction-local, is always
hidden, and cannot enter a reusable row, absence, or authority receipt. This is
the narrow bootstrap primitive: it lets the creator's first scoped role cite
the conversation row created by that mutation without making ordinary
membership insertion public.

`Schema` gains, all `#[serde(default)]`: `channels: BTreeMap<String, Channel>`,
`auth: Auth { password: bool, guests: bool }`, `effects: Vec<String>` (the
declared effect names; `Generation::certify` checks an `emit` against the
*declarations* in `ProjectJson.effects` — `E_EFFECT_UNKNOWN` — and refuses a
schema name with no declaration — `E_EFFECT_UNDECLARED`; review ruling M5).
`ColumnType` gains `Optional(Box<ColumnType>)` (`{"Optional": <type>}`; absent
or `Null` is valid) and `List { of: Box<ColumnType>, max: u32 }`
(`{"List": {"of": <type>, "max": n}}`; an array of ≤ `max` elements); a `List`
may not be an index column (`E_SCHEMA_INDEX_COLUMN`). Existing corpus JSON
stays valid.

Two more, from the column-type survey
(`issues/20260829-bounded-programs-column-type-survey.md`, folded 2026-08-30),
both representable in today's value model so nothing about storage,
arithmetic, ordering, or the evaluator twin changes:

- `Enum { variants: Vec<String> }` (`{"Enum": {"variants": ["dm","group"]}}`)
  — a `Value::String` constrained to the closed list; any other string is
  `E_INPUT` at write time. Indexable.
- `Decimal { scale: u8 }` (`{"Decimal": {"scale": 2}}`) — a `Value::Int` of
  minor units, i53 underneath; the *scale lives on the type*. The engine
  stores, compares, and adds it as an integer; it is the compiler's job (LLP
  1002 §2) to scale source literals and to refuse mixed-scale arithmetic.
  Indexable, orderable, exact. `Money { currency, scale }` is the same with a
  currency tag for the compiler to check; the engine treats it as `Decimal`.
  Sum maintains may source Decimal or Money, and the target `value` carries
  the same descriptor; the engine's arithmetic is unchanged.
- Dated amendment, 2026-08-30: `Bytes { max }`
  (`{"Bytes": {"max": 4}}`) is a `Value::Bytes(Vec<u8>)` whose required
  `max` is measured in bytes and enforced at insert/update time with the
  existing `E_INPUT` write-refusal family. Its canonical JSON value is the
  tagged lowercase even-length base16 form `{"Bytes":"007f80ff"}`; the
  Rust engine and TypeScript twin reject non-canonical spellings. Bytes are
  indexable in unsigned lexicographic byte order using the existing tagged
  scalar-key style (`5:<lowercase-base16>`); tuple components remain
  unambiguous because each is stored in its own index column. This addition
  bumps the certificate value model once, from `i53-codepoint-v1` to
  `i53-codepoint-bytes-v2`.

`Constraint::Text { field, min, format }` binds every writer after ordinary
column validation. `min` counts Unicode scalar values, matching `t.text(max)`;
`format: Handle` admits only ASCII lowercase letters, digits, and underscore,
and `format: Url` admits an absolute `http://` or `https://` URL with a
non-empty remainder and no whitespace/control characters. Optional text may
be absent/`Null`; when present it is checked identically. Certification
requires a text or optional-text field and refuses `min > max`.

Text columns and `ArgType::Text` refuse C0 control characters other than tab,
newline, and carriage return as `E_INPUT`, naming the code point and the
column or argument. Text maximums continue to count Unicode scalar values.

The implicit `id` column is intrinsic row identity and is immutable without an
authored constraint. Every addressed update or upsert requires the resulting
row's `id` to equal the addressed key before rule evaluation, index mutation,
or insertion; a mismatch is an atomic `E_INPUT` rejection. The authored
`db.update` patch type omits `id`, and the engine repeats the equality check for
raw project JSON. Thus an update cannot strand old/new index entries, and a
missing-row upsert cannot insert under an identity different from its key.

`Constraint::FinalExistsOnInsert { table, index, key }` is an insert-scoped
relational postcondition. For each source row inserted by the execution, its
key terms resolve against that inserted image and the exact indexed target
point must exist after the complete statement body and immediately before
commit. It binds seed/system writers as well as user mutations; a miss rejects
and rolls back the whole transaction. It does not become a perpetual invariant
on later updates or deletes. Certification checks the static target, index,
arity, and term types, includes the point probe in bounds/index custody, and
records its authoritative constraint input. The canonical conversation table
uses it to make a creator-admin membership mandatory at creation.

Still deferred, recorded so they are not re-derived: `Interval { of }` (four
archetypes need it, but it interacts with visibility, retention, and the
deferred `exclusion` constraint), `Duration`, `Set { of, max }`. Floats stay
out (the survey's "why no floats" section is the ruling).

## 10. What binds, and how it is checked

- Certificate output and closure bounds price a known row projection from the
  declared serialized maxima of its selected columns. `Get` and `*` retain the
  table's whole-row maximum; an unresolved field base retains the conservative
  whole-base price. `max_output_bytes` and `max_closure_bytes` bound canonical
  JSON for the result and retained rows, respectively. Text costs
  `4 * max + 16` bytes; JSON costs `max_bytes + 16`; Bytes costs
  `2 * max + 16`.
- `cargo test -p snapback2-core` stays under the 30 s budget; new tests live
  in `tests/{store,live,successor,successor_maintains,identity,outbox,
  certificate_retention,completeness,tier0_authorization}.rs`.
  `tier0_authorization.rs` is the
  single integration-test entry point for the independent modules under
  `tests/rbac_cases/`, avoiding redundant test-binary links without combining
  their fixtures or cases; malformed maintain shapes live in that consolidated
  lane.
- The 106-case shared corpus is regenerated whenever serialization or
  certification changes; the Rust engine and TypeScript evaluator must agree
  on every case.
  It preserves the original semantic inventory while removing authored
  `input_visibility`, and covers old/next updates, `Created`, final-exists,
  intrinsic row ids, maintained writes, text constraints, rule-memo
  invalidation, opaque-capping/completeness (including
  `named-inbox-maintained-complete`), and canonical Bytes values under
  `i53-codepoint-bytes-v2`. Case inventory and outcomes, not obsolete IR bytes,
  are the frozen parity surface.
- Durability: rows, commits, outbox, and sessions survive `Store::open` on the
  same path.
- Invalidation: a commit that touches a traced range prefix, point, absence,
  or rule-input key reruns exactly the overlapping subscriptions; a commit to
  an unrelated prefix reruns none; a rerun with an unchanged result reports
  `changed: false`.
- Authorization alignment: schema/compiler tests prove `rule.system()` is
  the literal equality above and no `PrincipalKind`/authored input-visibility
  shape reaches the IR; engine/evaluator tests cover public, exact
  self-readable, and fail-closed protected probes.
- Disclosure: tests prove that empty and all-hidden prefix-uniform ranges are
  wire-identical `Complete`, that non-uniform ranges are capped-only, that an
  opaque range dominates another cap in a multi-range query, and that the
  unit `Capped` wire shape carries neither `site` nor `take`.
- Security regressions: an authorized membership subscription becomes
  `Denied` at the revoking commit; a subscriber/request retained across a
  policy successor cannot execute the predecessor policy; and a stale grant
  intent cannot affect a remove/recreate successor row. LLP 1002 §7 gives
  these proofs stable receipt names; the canonical served receipt passes all
  three and records the alignment issue's closure evidence.
- Successor: adding a table/index/column/program applies in place with the
  new index populated; dropping a table with rows is refused with a plan
  naming the table and its row count; `apply_migration` with that plan
  succeeds.
- No file over 1,500 lines; no new dependency beyond the password-hash crate
  and `rand` (or `getrandom`) for tokens.

## Deferred (not in this spec, not binding)

OCC across multiple writers (single owner today); the `schedule` and `job`
kinds; Postgres lowering; the broadcast subscription class; result diffs on
the wire (full result per delivery today); retention and `maxOfflineAge`;
per-principal encrypted client stores.

## Author decisions (item 1 remains open)

0. **Resolved — Ruled by the author 2026-08-30.** `take` counts visible rows;
   hidden rows consume only certified examined/rule-probe budgets, and paging
   advances across hidden runs only within that budget. `Capped` is opaque;
   an empty `Capped` page terminates the drain. `Complete` and receipt
   absence claims require certificate-proven prefix uniformity; non-uniform
   sites are capped-only, and completeness-sensitive uses of them are refused
   at check with the `E_STRUCTURAL_COUNT` denormalize-or-maintain rewrite.
   Authoritative tracing, invalidation, and OCC are unchanged.

   **Amended 2026-08-30 (orchestrator; ratified by the author 2026-08-30).** A hoisted
   uniformly false range halts after one rule determination as `Exhausted`.
   Non-uniform rows beyond the certified examined budget are unreachable; no
   continuation may encode examined/storage position and the server holds no
   scan state.

   > **Superseded history:** ~~`Capped` over hidden rows disclosed cardinality.
   > The round-2 ruling computed the state from the authoritative trace, so a
   > page cut at `take` among rows the viewer could not see was `Capped` — which
   > told the viewer that ≥ `take` entries existed in the range. Both reviewers
   > accepted it for that lane (the page size already leaked the same bit under
   > spike S1 ruling 2, and the alternative — `Complete` over an omitted visible
   > row — was a silent state), but grok noted it was a disclosure LLP
   > 0329.014.004 forbade in principle. The author was asked to confirm, or
   > choose the third form: `Capped` without `site`/`take`, or a hidden-row
   > budget separate from `take`. LLP 0331 §"Failure and disclosure semantics"
   > was evidence for the third form.~~
1. The `_commits` retention (10,000 rows) and whether `trace` needs the
   touched keys of older commits.
2. **Resolved — Ruled by the author 2026-08-30.** Neither site nor take is on
   the wire. `Capped` is a single label without a stop reason; a visible-take
   stop and an examined-ceiling stop are viewer-observably identical.

   > **Superseded history:** ~~Whether `Capped` should carry the site name on
   > the wire or only the take.~~
