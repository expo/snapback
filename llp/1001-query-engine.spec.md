# LLP 1001: The query engine — durable store, generations, live subscriptions

**Type:** Spec
**Status:** Draft
**Systems:** `snapback2/crates/snapback2-core` (`store`, `registry`, `live`, `identity`, `successor`, the engine, the IR)
**Author:** Claude Fable 5 (orchestrator) — implementer: codex gpt-5.6-sol, lane A
**Date:** 2026-08-29
**Revised:** 2026-08-30
**Related:** LLP 1000, LLP 1002 (the loop that serves this), LLP 1003 (effects
through the outbox this spec defines), LLP 0329.014.004 §7 (runtime), LLP
0329.014.000 §6 (execution, trace, states), LLP 0329.016 §5.6 (no silent
states), LLP 0331 (the authorization and account model this engine's §6/§7 realize — one rule locus, a reserved `system` principal named in table rules; its rulings on the kind term, rule-input visibility, and disclosure are the closed follow-up `issues/closed/20260830-snapback2-align-rules-with-llp-0331.md`), `spikes/bounded-programs/REPORT.md` ("Known S1 limits")

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
| `_meta` | `key TEXT PK, value TEXT` — `schema_hash`, `generation`, `created_at`, `store_version` | store |
| `_commits` | `seq INTEGER PK, at INTEGER, program TEXT, principal TEXT, kind TEXT, touched TEXT(JSON), writes TEXT(JSON), emits INTEGER` — bounded: keep the last 10,000, trimmed on insert | engine |
| `_outbox` | `id TEXT PK, seq INTEGER, effect TEXT, payload TEXT(JSON), state TEXT, attempts INTEGER, next_at INTEGER, last_error TEXT, result TEXT(JSON), created_at INTEGER, updated_at INTEGER` + index on `(state, next_at)` | engine writes, LLP 1003 drains |
| `_principals` | `id TEXT PK, kind TEXT ('user'\|'guest'\|'persona'\|'system'), name TEXT, created_at INTEGER` | identity |
| `_credentials` | `principal TEXT PK, email TEXT UNIQUE, hash TEXT` | identity |
| `_sessions` | `token TEXT PK, principal TEXT, kind TEXT, created_at INTEGER, expires_at INTEGER` | identity |

Tables whose names begin with `_` are engine-owned: the schema may not declare
them (`E_SCHEMA_RESERVED`), programs may not read or write them, and `data`
reads them only through the dedicated verbs.

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
                          pub kind: String /* "mutation" | "system" | "seed" */,
                          pub touched: Vec<TouchedKey>, pub writes: BTreeMap<String, u64>, pub emits: u64 }
```

Queries record nothing. `seq` is the store's version: every result, receipt,
and delivery carries the `seq` it was computed at.

**The receipt factors three ways** (LLP 0329.021 P4/P5, folded 2026-08-30),
by who may issue each part: `rows` — "I hold these" — is client-issuable;
`absences` and *complete* `ranges` — "no row exists there / this range is
whole" — and `verdicts` — "this principal may see this" — are authority-only.
The engine keeps the containment invariant `receipt ⊆ trace ⊆ certificate`
*asserted*, not merely true by construction: `assert_bounds` checks
`receipt.absences ⊆ trace.absences` beside rows, ranges, and verdicts, with a
negative test (`issues/20260829-bounded-programs-receipt-absences-unvalidated.md`).
Nothing in this crate ever constructs a receipt from anything but a trace.

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
visible rows found so far and the opaque `Capped` label; `after` remains derived
only from the last visible row. An empty `Capped` page is the terminal drain
state, whether the range was physically exhausted or a hidden run consumed the
budget. Rows beyond a hidden run longer than that budget are unreachable in the
drain; the paved escape is the existing denormalize-the-scope rewrite. There is
no examined/storage-position continuation and no server-held scan state. The
engine may internally distinguish take, ceiling, and exhaustion stops, but the
result label, wire, and receipt may not.

> ~~A drain always makes visible progress (no starvation).~~
>
> **Amended 2026-08-30 (orchestrator, pending author ratification):
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
index — as `E_CONSTRAINT`; a program execution never surfaces a raw SQL
error except for I/O or corruption); bound overruns (`Steps`, `Fanout`,
`TraceSubset`) are `Rejected` with the family `bound`. The state is a field on `Execution`, and the JSON the loop serves is
the serde form of that field (LLP 1002 §4).

## 4. Generation and runtime (`registry.rs`, `successor.rs`)

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
place: new indexes are populated from `rows` in the same transaction; new
maintained aggregates are backfilled; rules and programs swap atomically;
subscriptions are re-executed against the new generation (LLP 1002 rebinds
them). Anything else is *destructive* and is **refused with a plan**:

```rust
pub struct SuccessorRefusal { pub code: String /* E_SUCCESSOR_DESTRUCTIVE */, pub plan: MigrationPlan }
pub struct MigrationPlan { pub drops: Vec<Drop> /* Table{name,rows} | Column{table,name} | Index{table,name} | TypeChange{table,column,from,to} */ }
impl Runtime { pub fn apply_migration(&mut self, next: Generation, plan: &MigrationPlan) -> Result<SuccessorReport, RuntimeError>; }
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
A user mutation writing a maintained target is `Rejected` by its rule.

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
membership) is delivered with that state — the client sees `refused`, not a
silent empty page.

## 6. Identity (`identity.rs`)

Authentication is always on (LLP 1000; LLP 0329.016 §5.5). The engine owns
the primitives; the loop owns the routes.

```rust
pub struct Principal { pub id: String, pub kind: String, pub name: Option<String> }
pub struct Session { pub token: String, pub principal: Principal, pub expires_at: i64 }
impl Runtime {
    pub fn signup(&mut self, email: &str, password: &str, now: i64) -> Result<Session, IdentityError>;  // E_AUTH_EMAIL_TAKEN, E_AUTH_PASSWORD_WEAK (< 8 chars)
    pub fn login(&mut self, email: &str, password: &str, now: i64) -> Result<Session, IdentityError>;   // E_AUTH_INVALID (one code for unknown email and wrong password)
    pub fn guest(&mut self, now: i64) -> Result<Session, IdentityError>;                                 // refused E_AUTH_GUESTS_OFF unless the project's auth.guests
    pub fn persona(&mut self, name: &str, now: i64) -> Result<Session, IdentityError>;                  // dev only: principal id `dev:<name>`, created on first use, stable token
    pub fn authenticate(&self, token: &str, now: i64) -> Result<Principal, IdentityError>;              // E_AUTH_SESSION
    pub fn logout(&mut self, token: &str) -> Result<(), IdentityError>;
    pub fn principals(&self, kind: Option<&str>) -> Result<Vec<Principal>, IdentityError>;
}
```

Password hashing is salted and iterated (argon2id preferred; PBKDF2-HMAC-SHA256
with ≥ 100k iterations acceptable) through one small crate; the hash format is
versioned in the string. Tokens are 32 random bytes, base64url. The principal
id is the `viewer` every program sees; `principal_kind` is the row's kind
(`user`, `guest`, `persona`, `system`) and remains identity metadata, not a
rule term. Ordinary contexts require the nominal `Actor` type; its private
fields and checked constructors reject the reserved id and kind. The `system`
principal exists from `Store::open` under the one core-owned reserved id and
has no session; the system-context constructor is private to the engine, and
only purpose-specific schedule/effect-`then`/seed machinery can reach it. The
reserved wire token lives in `snapback2-core/ir-contract.json`; both core and
the compiler consume that contract. In authored rules, `rule.system()` lowers
to `Eq(Viewer, Literal(Id(system)))`; there is no `PrincipalKind` rule
expression (authorization amendment, 2026-08-30, LLP 0331 ruling 0 as
amended).

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
certificate hashes, including through cyclic rule graphs. Evaluation derives
disclosure for the running viewer: a found probe
row is readable only when that viewer passes the referenced table's `read`
rule, while a denied/private probe is represented by a scoped verdict. Public
absences remain readable; private absences remain non-enumerating. A referenced
read rule's `Exists` lookups are traced and metered; visibility mode does not
recursively derive disclosure for those nested inputs, which gives cycles a
finite one-level bound while preserving short-circuit `And`/`Or` ceilings.
Both outcomes are deterministic and covered by exact-ceiling core tests and
client-twin successor tests (LLP 0331 §"Failure and disclosure semantics").

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
an effect is.

## 9. Schema additions

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

Still deferred, recorded so they are not re-derived: `Interval { of }` (four
archetypes need it, but it interacts with visibility, retention, and the
deferred `exclusion` constraint), `Duration`, `Set { of, max }`. Floats stay
out (the survey's "why no floats" section is the ruling).

## 10. What binds, and how it is checked

- `cargo test -p snapback2-core` stays under the 30 s budget; new tests live
  in `tests/{store,live,successor,identity,outbox,completeness}.rs`.
- The 81-case corpus is regenerated by `export_corpus` whenever the current
  serialization changes; the Rust engine and TypeScript evaluator must agree
  on all 81 cases. The 2026-08-30 authorization regeneration removes the stale
  authored `input_visibility` projection. The capped-over-hidden amendment
  explicitly removes the non-uniform `inbox.memberships` range extent from the
  two inbox receipts (both twins now expect that site partial) and records a
  certified-uniform empty `thread.messages` range after revocation. The added
  `named-inbox-maintained-complete` case keeps the maintained-aggregate inbox
  route complete by making its viewer rule uniform over the scanned prefix. The
  Bytes regeneration adds four cases and bumps every frozen certificate to
  `i53-codepoint-bytes-v2`. The complete deterministic `check --ir --json`
  response for the manifest's 81 programs is 76,357 bytes, SHA-256
  `371d5fabe2514f5e175ec2b59e0b85060930766d041af8cf62c3a3e5fe43c73f`.
- Durability: rows, commits, outbox, and sessions survive `Store::open` on the
  same path.
- Invalidation: a commit that touches a traced range prefix, point, absence,
  or rule-input key reruns exactly the overlapping subscriptions; a commit to
  an unrelated prefix reruns none; a rerun with an unchanged result reports
  `changed: false`.
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

   **Amended 2026-08-30 (orchestrator, pending author ratification).** A hoisted
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
