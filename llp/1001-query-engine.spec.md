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
states), `spikes/bounded-programs/REPORT.md` ("Known S1 limits")

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

## 3. Read and write states (no silent states)

`Execution` gains a typed state. A query's state is derived, never guessed:

| state | when |
|---|---|
| `Complete` | every traced range stopped `Exhausted` and no site was cut by a ceiling — including a range whose examined rows were all hidden: hidden rows are invisible, never a signal (LLP 0329.014.004: results are never functions of invisible-row counts) |
| `Capped { site, take }` | some traced range stopped `Limit` (the certificate's `completeness: Page \| Capped`) |
| `Partial { reason }` | reserved for the client twin (coverage miss); the server never returns it |
| `Denied { rule }` | `RuntimeError::Rule` on a read site, or `RuntimeError::Require { code }` raised inside a query (`rule = code`) — the program refusing is the honest "denied" (review ruling 2026-08-30, M1) |

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
    /// Certify every program; report EVERY refusal, never the first (rules/RULES.md).
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
column's values) and then applies the successor as additive. Never a prompt,
never a silent drop, never a fresh database (LLP 0329.016 §5.4).

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
pub struct Delivery { pub id: SubscriptionId, pub seq: u64, pub execution: Execution, pub changed: bool }
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
result digest is delivered with `changed: false` so the loop can coalesce.
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

## 10. What binds, and how it is checked

- `cargo test -p snapback2-core` stays under the 30 s budget; new tests live
  in `tests/{store,live,successor,identity,outbox}.rs`.
- The 75-case corpus and the 7 S1 tests pass unchanged; `export_corpus` output
  is byte-identical (the evaluator twin is LLP 1002's lane, not this one).
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

## Open author decisions

1. The `_commits` retention (10,000 rows) and whether `trace` needs the
   touched keys of older commits.
2. Whether `Capped` should carry the site name on the wire or only the take.
