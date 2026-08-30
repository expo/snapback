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
states), LLP 0331 §"Failure and disclosure semantics" / §"Amendment to
ruling 0" (Draft Research that informed the implemented alignment recorded
here; it is not a governing Snapback2 spec),
`issues/20260830-snapback2-align-rules-with-llp-0331.md`,
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
    pub fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError>;
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
| `Complete` | no non-uniform range was scanned, no visible uniform range stopped `Limit`, and no supposedly uniform range mixed visible and hidden rows. For a prefix-uniform range, a physically empty range and an all-hidden range both produce the same empty `Complete` result. |
| `Capped { site: None, take: None }` | **opaque cap:** any authoritative-trace range has a read policy that is not structurally uniform over its pinned index prefix, regardless of whether that range stopped `Exhausted` or `Limit` and regardless of how many rows were visible. A mixed visible/hidden result under a purported uniform proof also fails closed to this form. One opaque range dominates every otherwise disclosable cap in the query. |
| `Capped { site: Some(site), take: Some(take) }` | **ordinary visible cap:** every traced range is prefix-uniform and a range containing visible rows stopped `Limit`. The first such site's certificate metadata may be disclosed. `site` and `take` appear together or neither appears. |
| `Partial { reason }` | reserved for the client twin (coverage miss); the server never returns it |
| `Denied { rule }` | `RuntimeError::Rule` on a read site, or `RuntimeError::Require { code }` raised inside a query (`rule = code`) — the program refusing is the honest "denied" (review ruling 2026-08-30, M1) |

Prefix uniformity is a structural proof over the active schema. The index
prefix must pin every subject-row field consulted by the table's read rule,
including fields used to form an indexed rule probe; `viewer` and literals
are fixed for the execution. If the proof cannot establish that all rows in
the prefix receive one verdict, it is non-uniform. The engine derives state
from the authoritative trace and this proof, never from the closure receipt.
The wire's opaque form still carries the ordinary query `data` and `seq`, but
omits both `site` and `take`, so neither exhaustion nor the location/size of a
protected scan becomes an existence oracle. This is the implemented
Snapback2 decision; LLP 0331 supplied research evidence but does not govern
it.

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
    pub hash: String,                                   // digest of the project JSON
    pub schema: Schema,
    pub programs: BTreeMap<String, (Program, Certificate)>,   // key = "module.export"
    pub effects: BTreeMap<String, EffectDecl>,
}
impl Generation {
    /// Certify every program; report EVERY refusal, never the first (rules/RULES.md):
    /// `Checker::check_all` returns every structural refusal of a program and every ceiling overrun (all bounds are computed first, then compared).
    pub fn certify(project: &ProjectJson, ceilings: Ceilings) -> Result<Generation, Vec<(String, CheckError)>>;
}
pub struct Runtime { store: Store, generation: Generation, subs: Subscriptions }
impl Runtime {
    pub fn open(store: Store, generation: Generation) -> Result<Runtime, SuccessorRefusal>; // applies gen to an empty or same-hash store; else runs the successor check
    pub fn execute(&mut self, op: &str, context: Context) -> Result<Execution, RuntimeError>; // E_OP_UNKNOWN when op is not in the generation
    pub fn apply_successor(&mut self, next: Generation) -> Result<SuccessorReport, SuccessorRefusal>;
    pub fn seed(&mut self, rows: &[(String, Value)]) -> Result<u64, RuntimeError>;  // one commit, kind "seed"
    pub fn generation(&self) -> &Generation;
    pub fn store(&self) -> &Store;
}
```

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
(review ruling 2026-08-30, round 2 G1). Never a prompt,
never a silent drop, never a fresh database (LLP 0329.016 §5.4).

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
The named closure proofs are specified in LLP 1002 §7; until both pass, the
alignment issue remains open and the durable grant-handle part is not claimed.

**Seed writes and maintained-target rows are engine-owned** (rulings
2026-08-30). `Runtime::seed` writes as the `system` principal and is exempt
from the tables' user rules (never from constraints, unique indexes, or
column validation) — a seed is data the author declared, not a client
intent. Likewise:
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
(`user`, `guest`, `persona`, `system`), which rules test with
`principal.kind`. The `system` principal exists from `Store::open` and has no
session; `Context::system()` constructs its context for schedules, `then`
mutations (LLP 1003), and seeds.

## 7. Channels (`schema.channels`)

```rust
pub struct Channel { pub args: BTreeMap<String, ArgType>, pub publish: RuleExpr, pub subscribe: RuleExpr, pub ttl_ms: u32 }
pub struct ChannelVerdict { pub admitted: bool, pub rule_inputs: Vec<RuleInputTrace>, pub points: Vec<PointTrace> }
impl Runtime {
    pub fn channel_admit(&mut self, name: &str, side: ChannelSide, args: &BTreeMap<String, Value>, context: &Context) -> Result<ChannelVerdict, RuntimeError>;
    pub fn channel_touched(&self, commit: &CommitRecord, verdict: &ChannelVerdict) -> bool;   // does this commit overlap the verdict's traced keys
}
```

One rule probe per admission, evaluated over the args as the row (`RuleTerm::Field`
reads an arg), and the verdict *carries its trace* (review ruling 2026-08-30,
M7) so the loop indexes each subscriber by the probe's keys and re-admits on
the commit that touches them — a deleted membership drops the subscriber.
No persistence, no receipt, no prediction (LLP 0329.014.000 §8). The fan-out
itself is the loop's (LLP 1002 §4).

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

### Authorization rule alignment

The core rule algebra has only `Field`, `Viewer`, and `Literal` terms.
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

Deferred, recorded so they are not re-derived: `Bytes { max }` (needs a value
variant and a canonical encoding shared with the twin — a value-model version
bump), `Interval { of }` (four archetypes need it, but it interacts with
visibility, retention, and the deferred `exclusion` constraint), `Duration`,
`Set { of, max }`. Floats stay out (the survey's "why no floats" section is
the ruling).

## 10. What binds, and how it is checked

- `cargo test -p snapback2-core` stays under the 30 s budget; new tests live
  in `tests/{store,live,successor,identity,outbox,rbac_adversarial}.rs`.
- The 76 corpus filenames, case names, and expected semantic results remain
  unchanged, and the Rust engine/evaluator twin pass all 76. Regeneration is
  intentionally not byte-identical: it removes the legacy serialized
  `input_visibility` field now that visibility is structurally derived. The
  case inventory and outcomes, not obsolete IR bytes, are the frozen parity
  surface (the evaluator twin is LLP 1002's lane, not this one).
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
- Disclosure: tests distinguish prefix-uniform visible caps from opaque
  non-uniform caps, prove that empty and all-hidden uniform prefixes are
  wire-identical `Complete`, prove an opaque range dominates a visible cap in
  a multi-range query, and validate that `site`/`take` appear as a pair.
- Security regressions: an authorized membership subscription becomes
  `Denied` at the revoking commit; a subscriber/request retained across a
  policy successor cannot execute the predecessor policy; and a stale grant
  intent cannot affect a remove/recreate successor row. LLP 1002 §7 gives
  these proofs stable receipt names. The issue may not close while any is
  absent.
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

## Open author decisions

0. The `_commits` retention (10,000 rows) and whether `trace` needs the
   touched keys of older commits.
1. Whether an ordinary visible `Capped` result should continue carrying both
   site and take. Opaque caps carry neither; that disclosure decision is
   settled above.
