# LLP 1001: The query engine — durable store, generations, live subscriptions

**Type:** Spec
**Status:** Draft
**Systems:** `snapback2/crates/snapback2-core` (`store`, `registry`, `live`, `identity`, `successor`, the engine, the IR)
**Author:** Claude Fable 5 (orchestrator) — implementer: codex gpt-5.6-sol, lane A
**Date:** 2026-08-29
**Revised:** 2026-09-09 (guarded update conflicts and non-disclosing if-absent inserts; implementer GPT-6 Astra); 2026-09-08 (plain connected value read and consistent count-first repairs, LLP 1011 one spelling); 2026-09-07 (indexed prefix selection and direct owner subscription dispatch); 2026-09-07 (public Count paired absence proofs and admission reserve; implementer Codex); 2026-09-07 (canonical sparse aggregates and shared maintained-row lifecycle); 2026-09-07 (LLP 1018.000: persistent query IDs, context-aware batches and incremental dependency membership); 2026-09-07 (surviving-row uniqueness checked against each actual rebuild); 2026-09-07 (schema-owned maintained address widths/references and scoped successor reindex); 2026-09-07 (native v5 search/text integration preserving count-backed caps and ad hoc admission); 2026-09-07 (count-backed cap probes); 2026-09-06 (fixed complete local-runtime measurement roots: 66,000-byte ceiling, 64,000 target); 2026-09-06 (generation-owned policy hashes, pooled merge seeks and bounded shared templates); 2026-09-06 (measured full-entry search trade: 50,000-byte ceiling, 48,000 target); 2026-09-06 (session-delegated Unicode/search foundation and downstream contracts); 2026-09-06 (conditional result-page provenance and branch-scoped cursor validation); 2026-09-05 (Clique L12 — §3 receipt-only null invariant and §5.1 `connected`); 2026-09-05 (Clique L9 — bounded ASCII words builtin and constructed-text boundary); 2026-09-05 (Clique L10 — lazy merge, receipt retention and global local-pagination cursor rule); 2026-09-05 (Clique L8b — nested point-read shapes preserve page state; early exits preserve capped taint); 2026-09-05 (Clique L8a — prefix-local self-probe and decided-disjunction visibility proofs); 2026-09-05 (Clique L3 — honest bound refusals and patch-sensitive cap metering; LLP 1016 J2 — §1's system tables gain `_jobs` and `_timers`; LLP 1017 §1, then §2 and §3)
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
| `_jobs` | `id TEXT PK, name, source NULL, program_hash, generation, args TEXT(JSON), state ('queued'\|'running'\|'parked'\|'done'\|'cancelled'), sweep, upper_key NULL, cursor NULL, chunks, rows_written TEXT(JSON), enqueued_by, created_at, updated_at, finished_at NULL, last_error NULL` — LLP 1016 D2/D3, amendment 2026-09-05 (J1b) | engine writes, the writer's background turn drives |
| `_timers` | `id TEXT PK, schedule TEXT, row_id TEXT NULL, at INTEGER, period_start INTEGER NULL, generation TEXT` + index on `(at, id)` — maintained with the row like an index; LLP 1016 D5, amendment 2026-09-05 (J2). `_commits` gains `kind = 'schedule'` and a `schedule TEXT(JSON)` firing column | engine writes, the writer's background turn fires |

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
maximum call count, except that a result-page site must also satisfy §3's
unique-occurrence proof. Certification therefore cannot silently collapse two
reads into a certificate that only one of them can execute.

## 3. Read and write states (no silent states)

`Execution` gains a typed state. A query's state is derived, never guessed:

| state | when |
|---|---|
| `Complete` | every traced range stopped `Exhausted`, no site was cut by a ceiling, and the certificate proves each scanned range's read rule uniform for the running viewer over its scanned prefix; only those certified-uniform ranges may carry complete range or absence claims in a receipt |
| `Capped` | the certificate marks any site capped-only because its rule is not provably uniform over the scanned prefix, or an authoritative-trace range stopped `Limit`; this is one opaque label with no site, stop reason, or take echo |
| `Partial { reason }` | reserved for the client twin (coverage miss); the server never returns it |
| `Denied { rule }` | `RuntimeError::Rule` on a read site, or `RuntimeError::Require { code }` raised inside a query (`rule = code`) — the program refusing is the honest "denied" (review ruling 2026-08-30, M1) |

A local receipt-only re-execution with missing authority yields `Null`, never
a computed partial value, in both the Rust engine and TypeScript evaluator.
This holds for ordinary durable reads and mixed durable/`connected` results;
the partial state records the missing authority separately.

**Amendment — Ruled by the author 2026-08-30.** `take` counts visible rows
only. A denied candidate consumes the certified examined and rule-probe budgets,
never `take`. A rule may be evaluated once for a range only when the existing
hoist analysis proves every rule input pinned by that range's prefix, or the
prefix proves the rule true as below. When a runtime-determined
hoisted verdict is uniformly false for the viewer, the range halts after the
single determination without fetching or charging the hidden population row by
row, records `Exhausted`, and returns the same complete empty receipt as a
physically empty range. Empty, two-hidden-row, and at-least-examined-ceiling
ranges are therefore viewer-observably identical in that case.

**Prefix-local truth (Clique L8a, 2026-09-05).** A scan also proves its read
rule true when an `exists` on the scanned table addresses that row's own full
unique key: each key term is its corresponding row field, or `viewer`/a
literal equal to the expression pinning that column in the scan prefix.
Every key column must be nonoptional. An `or` is uniformly true when any arm
is so decided: this self-probe, `allow`/`public`, or equality of a row field
to `viewer`/a literal pinned to that same value. Merely pinning one arm does
not suffice; the existing all-rule-fields-pinned proof remains sufficient
for uniformity with a runtime verdict. The certificate records `decided_true`
on the read site and reserves zero rule probes there; the engine and twin
skip that site's rule evaluation without rewriting the table policy. Point
reads still check visibility, including after membership revocation. Private DM rules `.recipient = viewer or .sender = viewer` therefore admit
counts under either viewer-pinned index and sender-pinned fanout. An arbitrary
principal argument is not a viewer-equality witness (regression 2026-09-09). Write
fan-out still requires the unchanged covering-cap proof (LLP 1017 §3).

A non-uniform site is capped-only regardless of what its runtime candidates
happen to show. Shaping a page with nested, rule-authorized point reads does not
change its state; a hidden nested row yields `null`.
The page collects visible rows only until `take`, within the certified
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

Local pagination has one rule for all queries: if `ClientStore::reexecute`
reports `Partial` after a coverage miss or local deletion, clear `next`.
A cursor requires covered replay; this rule is not specific to merge.
The certifier derives a page site for each return through branch-local aliases
and one-to-one shapes (LLP 1011 §B1). A result-page site must identify one
occurrence, counting nested point keys, scan prefixes and bounds, merge sources,
and lane setup as well as direct reads; identical expressions can execute with
different bindings. Malformed prefixes return typed diagnostics alongside the
structural refusals, without panicking during suffix derivation.
Execution selects the actual return, never the last auxiliary scan. An unexecuted
merge does not count as an unfinished union; non-page returns have no continuation.

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

**Lazy merge (Clique L10, implemented by GPT-6 Astra, 2026-09-05).**
`Expr::Merge` owns its bounded lane discovery and scans. Evaluate and normalize
runtime prefixes and bounds before opening a logical stream for each distinct key.
Uniform lanes whose index ends in intrinsic id use the connection's bounded
statement cache for one-row seeks; other lanes keep an ordinary live cursor.
A heap compares lane heads by the common post-prefix suffix; emit the winning
row, deduplicate intrinsic ids on emission, and advance only that stream. Stop
at the page plus two lookahead rows. Uniform lanes certify at most L heads + N
advances + 2 lookahead per merge call, plus discovery and shaped point reads;
non-uniform lanes retain the conservative per-lane reserve and opaque capped
semantics. The trace charges actual stepped candidates and heap work under
`steps`. The merge summary records the lane maximum and uniformity. Retention
prices L retained heads, the emitted N rows, two lookahead rows, and each
discovery page at its declared take plus its retained halo. It does not price
a concatenated L×N union. `MergeTrace` keeps
its shape: observed deduplicated union length (bounded by N+2) and the last
returned suffix. All streams must exhaust with union length at most N for
`complete`; an unfinished stream or truncated discovery makes the result
`capped`. The twin uses the same heap over held ordered streams. Cursor encoding,
`after`, and authorization on every new page are unchanged.

**Feed execution refinement (GPT-6 Astra, 2026-09-06).** One optional initial
SQL template is shared across the merge. It retains no equality-prefix encodings,
checks equality of evaluated after/before/range bounds, and falls back to strict
seek for differing bounds, refills or storage refusal. Its complete retained
capacity fits both one fixed-work unit of the existing merge heap reserve and
the inline storage saved by borrowing the actual lane descriptors. Borrowed
bounds are preflighted before cloning. This is accounted storage within the
existing calibrated heap model, not a whole-process allocator bound.

Runtime owns the policy-hash cache for its certified schema generation; reuse
cannot cross a successor or accept caller-supplied hashes. Independent trace
and receipt membership indexes preserve each collection's first disclosed row
image and rollback behavior. Heap entries address retained rows by index,
avoiding transient copies without changing ordering or evidence. Certificate,
trace, receipt, authority, result and opaque-cursor semantics remain unchanged.
The integrated core bytes match the tested candidate; first full curves and
byte-exact output comparisons are retained in the feed evidence record.

**Bound refusals (Clique L3, 2026-09-05).** Each exceeded meter gets its own
line: examined entries, index entries, rule probes, steps, heap bytes, output
bytes, or closure bytes. Products list all contributing terms, largest first,
with their source: ranges include `take + 2` and calls, merges include every
lane and the lane-discovery scan, cap probes include calls and the named cap,
and rule probes include their multiplicity. Output and closure name the
nested collection bounds and selected field widths (closure explains peak
retention, including intermediate collections). Branches explain the arm that
sets each meter's maximum. A dominant merge requires a structural repair:
smaller lane bound, smaller page, two reads (two snapshots), or a maintained
feed. A dominant cap names the cap and a chunk size that fits the breached
meter with other reserves unchanged, or says no positive chunk fits. Nested
population scans keep the `maintain.count/sum` advice. Byte repairs name the
widest nested collection and the fields carrying its bytes; they never paste
`return null;` or replace the requested result with an unrelated collection.
Non-uniform budget reserves name the uniform-prefix repair, not a rule-probe
reduction. `E_BOUND`/`E_STEPS` rewrites are core-authored; the Quarry handoff
must preserve them rather than overwrite them with a `.q` declaration.

An opaque cursor is canonical base64url of the tagged, versioned encoding
`[version, table, index, order, suffix descriptor, suffix values]`. Values keep
their index-column types, including nominal `Id` versus `String`; decode is
size-bounded and must canonically re-encode. Version, table, index, order, and
the exact post-prefix descriptor must match before the selected page or its
merge lane discovery opens, including empty discovery, or the request is
`E_INPUT`. Canonical argument decoding happens before execution; unselected
branches do not constrain the cursor scope. Tokens are not site-bound. `after: c` selects rows following the
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
at certification with the existing `E_STRUCTURAL_COUNT` family. This includes
a page collected in a capped loop that any `break` or `continue` can truncate — every
early exit in a capped loop taints that loop's collectors, whatever its condition,
because the flow analysis cannot see that a condition such as a nested read being
`null` depends on hidden rows (a coarse rule on purpose; collecting only
capped-dependent control would re-admit the null-guard break). Its pasted
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

### Guarded writes

Implemented 2026-09-09 by GPT-6 Astra, on the author's smaller-items commission.
`update table[key] { patch } if predicate` binds `.` to the readable current
row. It evaluates the unique key once, requires a readable row and a true
predicate before evaluating/writing the patch, and retains ordinary update
rules and constraints. The typed IR `Check { condition, current: Read }`
reserves the condition, a bounded conflict read, and that row's output size.
A false check aborts all tentative writes and produces
`{ state: "rejected", reason: "conflict", code: "E_CONFLICT", current }`.
`current` is re-read **after rollback**, under the request actor's read rule:
an absent or unreadable row is `null`. Temporary grants and tentative row
changes therefore cannot enter this result. Plain and replay responses use
the same shape; replay records the entire terminal result. An explicit
conditional conflict retains this more useful result when trace OCC also
notices the moved row. The twin rejects a known false predicate and rolls
back; it never invents an authoritative current-row payload.

`insert table { fields } if absent` is `InsertIfAbsent { table, row, result }`
in IR. It validates the candidate and its insert rule, then checks every
unique key without a visible application read. A conflict is a committed
no-op yielding `null`; success yields the newly inserted row, with ordinary
constraints, maintained writes, and insert postconditions. It never returns
or grants custody of the conflicting row. The certificate keeps the insert
write bound, prices its result binding, and marks the potential target
conditional; covering-cap fanout and query-write refusals still apply.
Receipt-only execution needs authoritative point-absence coverage
for unmatched unique keys; a held duplicate decides the no-op even when an
earlier key lacked absence coverage. The primitive owns these proof checks;
missing coverage is partial and rolls back,
not evidence of absence. The four write corpus cases exercise creation,
collision, missing authority, and conditional rejection in Rust and the twin.

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
A successor rebuild validates each target's surviving rows together with its
exact replacement projection against next uniqueness, before clearing that
target. This check runs inside the installation transaction after preceding
rebuilds and migration drops, using the same projection passed to mutation.
Only the union of predecessor/successor-owned IDs is excluded from the old
rows; migration preserves predecessor ownership before dropping sources.
Collisions refuse `E_SUCCESSOR_UNIQUE` through additive installation, explicit
migration, and changed-schema reopening, rolling back earlier work in the
transaction. Stale rows are cleared with delete-applicable constraints only;
uniqueness is not rechecked on a removal that cannot create a duplicate.
The rebuilt inserts bind every next constraint and unique index.
A user mutation writing a maintained target is `Rejected(E_RULE)` by its rule.
Successor rebuilds own exactly the union of target row IDs projected by the
predecessor and successor maintain declarations: they replace or remove those
IDs and preserve every other target row and index entry.

Engine-owned maintained count and sum targets use one canonical sparse
representation: the target row exists exactly when its aggregate value is nonzero. A nonempty
sum whose contributions cancel to zero therefore has no physical target row;
the scalar aggregate surface continues to return zero for that absent address,
while direct target-row visibility observes absence. One source row change
combines its old and new contributions by group before touching a target, so a
same-group update cannot transiently delete and recreate the row. A zero
transition uses the ordinary engine-owned delete lifecycle, and a nonzero
transition uses the ordinary insert/update lifecycle: constraints, indexes
(including search), touched keys, created-row bookkeeping, timers, write
accounting, and rollback all remain in the source transaction. Clean successor
rebuild omits zero-valued projections by the same rule. Row schedules declared
on maintained targets are certified as maintained write amplification and are
created, replaced, or removed with those target rows.

This semantic change advances the evaluator identity to
`bounded-spike-rust-search-text-refinements-5`; v4 held operations are not
admitted by a v5 client or native engine. Native stores persist that evaluator
identity separately from the schema hash. The first v5 open of an installed
v4-era store transactionally removes zero-valued maintained rows whose ids
exactly reproduce their grouping tuples, using the ordinary delete lifecycle,
then records v5. This one-time target scan does not rebuild from source and
preserves legacy ordinary-id rows outside the engine projection. Successor
uniqueness checks omit zero-valued replacement rows, although their exact ids
remain owned for removal.

A physical miss on a public/Allow Count target's full unique grouping index
with valid scalar typed keys can acquire two independent facts for offline
insertion: its empty group
extent, represented by the existing empty ascending unbounded exhausted range
receipt, and a canonical primary-ID absence proved by a separate actual
`byId` lookup. Ordinary survivors make those addresses inequivalent. Keep the
original point trace for OCC and live invalidation; the derived range must
match that declared physical miss and exact scope, current policy hash, empty
shape and a separately traced primary miss. Receipt-only evaluation cannot
mint either additional fact from a partial local store. Invalid key domains
and JSON/compound grouping descriptors omit the optional pair: wire erasure
and schema retagging must preserve the exact native lookup address. Group-key
validation is schema-aware: a Ref to a maintained target uses that target's
canonical address domain, including valid addresses beyond ordinary ID bounds.

Certification reserves the extra lookup steps, primary-index/constraint
dependency and paired receipt bytes through sequential and branch composition.
The group lookup and fallback can examine at most one row together. A
schema-sized byte reserve is checked against the actual serialized proof pair;
if it is too small, omit both optional proofs and preserve the original query
result. Under the current validated finite key domains and fixed policy hash,
the schema-sized reserve covers the pair; boundary tests include the maximum
ordinary identity and a valid long maintained Ref. The actual-size comparison
remains defensive. An over-domain identity is a domain-rejection witness, not
a reachable serialized-pair overflow witness. This does
not impose new ID limits. Public projection still exports only primary-index
absence tuples; the group fact uses existing range custody. A stale cached zero
alone does not authorize insertion. Protected targets and ordinary/sum tables
gain no such proof. No new wire field or point-query completeness rule follows.

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

### Maintained addresses

Implemented by Codex GPT-6 Astra (xhigh), native integration R2, 2026-09-07.
A maintained target's intrinsic address remains the canonical tagged JSON of
its ordered grouping tuple, with omitted optional fields materialized as Null.
It is still serialized as an Id; no hash, truncation, remapping or wire-version
change is introduced. Ordinary user/actor/NewId/untyped Id values retain the
144 canonical tagged byte allowance. A generated intrinsic address may exceed
that allowance only in the maintained target's schema-owned slot, where the
engine validates the declared source group types and exact canonical address;
a retained row must also reproduce that address from its group fields.
Legacy non-projected target rows with ordinary ids retain their existing domain.

A schema-targeted Ref to a maintained target, including Optional/List nesting,
uses that target's address domain. Returned addresses therefore remain usable
as typed byId arguments and stored references. Ref admission validates the
referenced schema and canonical tuple, never only a tag, and creates no read or
write authority. Untyped Id/Scalar/JSON slots do not acquire this exception.
Row pools retain exact row/address equality and first-image/reference custody;
native and TypeScript typed/wire admission carry the current schema explicitly.
Structural delivery decode does not grant address authority: row preparation,
held byId/absence keys and executed cursor suffixes validate the current target
and exact canonical tuple. Optional/List recursion preserves the declared Ref
target; ordinary actor, untyped Id, Scalar and JSON slots keep the 144-byte rule.
The cursor encoding, descriptor binding and 4,096 decoded-byte ceiling remain.

The target's intrinsic width is derived from the declared tagged group widths:
tuple brackets, one separator allowance per element, then nine Id-wrapper bytes
plus at most twice the tuple bytes for another JSON escape. It is at least the
ordinary 144 allowance. Ref widths follow their target; Optional/List preserve
that width recursively. Row/projection, retained-row, point/range/halo reference,
and search suffix-buffer prices consume these same bounds. Ordinary reads that
consume expanded maintained domains also price the complete receipt row pool,
row/id envelopes, issuing keys/arguments and transitive rule authority. Reducing
a read to Exists or a scalar does not release its disclosed first image. Enum widths include
canonical escaping. Saturating arithmetic leaves the existing byte ceilings in
force. A cyclic maintained-reference domain has no finite declared width and
refuses with the existing E_BOUND only in programs that must price that domain;
unrelated bounded programs and the schema itself remain admissible. Very wide
positions remain subject to the existing cursor ceiling; it is not raised.

Successor stored-row admission keeps unrelated undeclared legacy fields
uninterpreted, including their identity widths. Reindex validates its actual
ordinary component columns, WordPrefixes source fields, and intrinsic id before
writing that row's index entries. Exact predecessor-owned projection IDs slated
for rebuild are excluded from this surviving-row pass; their replacements use
normal aggregate write/index/constraint admission in the same transaction.
Surviving non-projected rows are still checked. Declaring the legacy field still subjects it
to ordinary field/reserved-principal validation. All index changes, maintained
rebuilds and generation metadata remain in the same rollback transaction.
Count-backed cap addresses, one-row reserves, proven absences and N fallback do
not change; successor caps still count base rows.

This correction retains the v5 value identity and uses the evaluator v5
boundary recorded above. The coordinated
TypeScript evaluator/client uses shared typed and wire validators for this same
domain, including absent buckets and immutable first-image custody. Exact native
Ref/Optional/List roundtrip/refusal fixtures and combined-graph owner replays
provide affected parity evidence. Compiler descendants and size/resource gates
remain separate obligations before whole-package clearance.

## 5. Live subscriptions (`live.rs`)

```rust
pub type SubscriptionId = u64;
pub struct Subscriptions { /* id → (op, context, last result digest, last seq); key indexes below */ }
pub struct Delivery { pub id: SubscriptionId, pub seq: u64, pub execution: Result<Execution, RuntimeError>, pub changed: bool }
impl Runtime {
    pub fn subscribe(&mut self, op: &str, context: Context) -> Result<(SubscriptionId, Execution), RuntimeError>;
    pub fn unsubscribe(&mut self, id: SubscriptionId);
    /// Pure exact-key lookup and conservative prefix-group matching.
    pub fn invalidated(&self, commit: &CommitRecord) -> Vec<SubscriptionId>;
    /// Re-execute the named subscriptions once each (coalesced), diff against the last result digest.
    pub fn rerun(&mut self, ids: &[SubscriptionId]) -> Vec<Delivery>;
    /// Refresh context and execution in the same persistent subscription slot.
    pub fn rerun_with_contexts(&mut self, entries: &[(SubscriptionId, Context)]) -> Vec<Delivery>;
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
`rerun` executes at most once per id per call, in id order. The context-aware
batch keeps each `SubscriptionId`; the last context supplied for a repeated id
wins. The owner samples one clock for the batch and refreshes `now` and
`read_time` without unsubscribing and subscribing again. It still derives
ordinary and offline frames from the full execution and compares frame digests;
a terminal delivery removes the owner entry and detaches its runtime slot once.
The owner stores that core ID as the live-map key for the slot lifetime. Commit
and connected invalidation vectors dispatch directly by ID, without rebuilding
a reverse map or scanning unrelated live clients.

Trace dependencies are normalized sets. A successful execution, including a
denied or partial result, replaces only the old/new set difference. Point,
absence, and rule-input keys share exact membership; constraints use table
membership. Each `(table, index)` owns a trie of canonical typed scalar prefix
components. Nodes refcount fully scalar terminal memberships and all subtree
memberships. Ordinary scalar touches visit ancestor terminals; search scope
touches visit ancestor terminals and the exact scope's subtree. WordPrefix
terms stop at their preceding scalar node and participate only in subtree
membership; invalidation does not compare or normalize their text. A scope
longer than that scalar prefix does not select those terms. Distinct terms from
one subscription share refcounted membership, so removing one leaves the other
attached. Empty nodes and index buckets are pruned. Selection visits the touched
paths and matching buckets rather than all distinct prefixes; ordered map lookup
and output deduplication costs still depend on their collection sizes.

A runtime error has no replacement authoritative trace: retain the old
dependencies for a later retry while remembering the latest context and error
digest. Core callers can retry that slot; the owner's terminal transport path
detaches it. Subscriptions live in memory with the owner; a restart
re-subscribes from the clients (LLP 1002). This implements the persistent-query
move in LLP 1018.000; no leaf-read cache is introduced.

A `Delivery` for a subscription whose read is now `Denied` (a revoked
membership) is delivered with that state — the client sees `denied`, not a
silent empty page.

### 5.1 Connected

Implementer: GPT-6 Astra, Clique lane L12, 2026-09-05. `connected` is a
read-only virtual table keyed by principal: queries and mutations read
`connected[p]` for the int count of that principal's live connections, or
`exists connected[p]` for presence. Compiler and native key repairs teach
the count first: `connected[viewer]` or `exists connected[p]` with `p: principal`. It has no rules of its own; programs are its only surface, and
the app author chooses what to expose. The owner's live registry of
authenticated SSE connections is the source of truth: a connection counts
from identity establishment until its stream closes. A silent partition is
observed when the next write fails; this makes no numeric detection-latency
claim. Each read charges one certificate probe and traces a touched key on
virtual table `_connected`, keyed by principal. Connect/close invalidates
live queries reading that principal, coalesced on the owner's background turn
at a one-second interval. The registry is consulted inside the owner's
transaction turn, with one consistent snapshot per program run; connections
opening or closing mid-turn become visible on the next turn. The twin cannot
know connections: a program reading `connected` answers `hydrating` offline
and is never predicted, never a fabricated false/zero labelled `stale`.
Such query envelopes carry `connected: true` and are never cached or answered
conditionally: registry changes can share a durable commit sequence, and this
fact must survive a failed program-custody fetch.
Session revocation removes the connection when the existing revocation path
cuts its stream. This is not another channel kind or a subscriber-set
broadcast, and says nothing about foreground activity or delivery guarantees.

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
pub struct Channel { pub args: BTreeMap<String, ArgType>, pub value: BTreeMap<String, ArgType>, pub publish: RuleExpr, pub subscribe: RuleExpr, pub ttl_ms: u32 }
pub struct ChannelVerdict { pub admitted: bool, pub rule_inputs: Vec<RuleInputTrace>, pub points: Vec<PointTrace> }
impl Runtime {
    pub fn channel_admit(&mut self, name: &str, side: ChannelSide, args: &BTreeMap<String, Value>, context: &Context) -> Result<ChannelVerdict, RuntimeError>;
    pub fn channel_value(&self, name: &str, value: BTreeMap<String, Value>) -> Result<BTreeMap<String, Value>, RuntimeError>;
    pub fn channel_touched(commit: &CommitRecord, verdict: &ChannelVerdict) -> bool;   // does this commit overlap the verdict's traced keys
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
The channel is a typed latest-state resource (LLP 1001.000). `value` declares
one nonempty closed record, validated using ordinary argument types with
optional-field normalization. Value descriptors exclude assets, bytes and
cursors recursively. Generation admission checks descriptors and requires an
integer TTL of 1–30 seconds. The owner retains one value per subscribed
connection, its exact principal/session epoch, and its publish verdict;
commit-triggered revocation removes values whose publish authority disappears
and closes children whose subscribe authority disappears. All affected checks
finish before another room snapshot is selected.

The owner sends complete replacement snapshots, including an immediate empty
snapshot for an empty room. Each live handle has an owner-minted public key and
private lease; authenticated set/clear commands bind the exact normalized
scope, name and session and carry increasing version watermarks. TTL expiry
uses monotonic time, preserves the live handle, and removes its value. Reset,
succession and disconnect close the lease. Successors send `E_CHANNEL_RESET`
and clients reconnect for fresh state. The bounds and complete wire/client
contract are LLP 1001.000. No persistence, receipt, prediction, query language
or replay is added; the fanout itself remains the loop's (LLP 1002 §4).

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

`Constraint::Cap { by, max }` holds each grouping tuple at `max` rows. One
index-compatible grouping key treats omitted optional columns as `null` for
inserts, group-moving updates, and successor counting. Every writer, including
product seeds, checks it. A count maintain over the same source and exact
ordered grouping key makes the check a deterministic maintained-target `byId`
read and reserves one examined row, one index entry, and five steps per call;
otherwise inserts/upserts reserve `max` examined rows and index entries per cap
per call. Receipt-only execution may use a held row or authoritative absence
but never invents zero. Updates reserve only caps whose grouping
columns their patch may write (unknown shapes stay conservative); execution
charges actual probes. Only programs still carrying a cap probe exclude
non-uniform scans for this reservation rule (LLP 1017 §2.4).
Seed programs reserve the work but set examined/index-entry/step ceilings to
`u64::MAX`, like write rows. Every successor cap is checked against base rows
after migration drops; excess groups refuse `E_SUCCESSOR_CAP` with bounded
`cap_conflicts` and a repair plan (LLP 1017 §2).

A mutation page loop covers its selected range only with a cap over all pinned
grouping columns, a uniform rule, a literal bound at least the cap, no cursor or
key range, and no non-uniform range scan anywhere in the mutation. Identity
bindings and row shapes preserve page origin; transformations and merges do not
prove coverage. Admitted loops mark their read site `complete: true`; execution
asserts fetch capacity (including rule-probe capacity) of at least `take + 2`,
rejecting a budget cut atomically with `E_TRACE_SUBSET`. Certification otherwise
refuses `E_STRUCTURAL_FANOUT`; queries and non-page domains retain their existing
bounds, and a job's `chunk` body — certified as a synthetic mutation under the
checker's job-chunk mode — is exempt because the job driver is its represented
continuation (LLP 1017 §3; LLP 1016 D1).

Text columns and `ArgType::Text` refuse C0 control characters other than tab,
newline, and carriage return as `E_INPUT`, naming the code point and the
column or argument. Text maximums continue to count Unicode scalar values.

Native v5 argument Text additionally admits `min` and `format` recursively
through optional/list types, before execution, channel authorization, or job
enqueue. Zero minimum and absent format retain the canonical unrefined shape;
positive minimum and explicit format participate in certificate identity.

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

### Pure builtins

The public `words(text)` value function and `Builtin::Words` were retired in
the 2026-09-07 direct-compiler cutover. Unicode word normalization remains
engine-owned behind `wordPrefixes` indexes and their typed search descriptors;
applications cannot materialize its internal word list. `tokens` remains the
separate mention extractor.

### Unicode search foundation

**Decision and scope, 2026-09-06.** The user explicitly delegated implementation
choices in the current session. Codex accepted engine-maintained `wordPrefixes`
plus the persistent indexed held-row twin, with Exact 2 deferred until search
qualifies on React web and Expo. The complete local-runtime ceiling is 66,000 bytes gzip,
with 64,000 the optimization target; 1M steps, 4 MiB closure, 8 MiB heap and
1 MiB output remain. This is a current session decision, not an earlier author
ruling. **Implementer:** Codex gpt-6-astra at xhigh, named
`clique-search-foundation` lane, 2026-09-06; engine/compiler/twin lanes follow.
The foundation supplies shared Unicode and logical-key primitives. At the time
of this decision, `words()` and `Index.columns` remained active and
`wordPrefixes` was not yet accepted Quarry. The 2026-09-07 cutover completed
that migration: Quarry declares `wordPrefixes(field)`, schema IR uses typed
components, and the public Words value surface is gone.

The pinned contract is `u17-nfc-scf-nfc-wsp-p`: Unicode 17.0.0
`NFC(simpleFold(NFC(text)))`, C/S case-fold mappings only, boundaries at
`White_Space ∪ General_Category P*`, accents preserved. Symbols are tokens;
underscores, apostrophes and hyphens separate them. No host ICU, locale casing,
Unicode-property regex, or new Unicode crate. Shared official UCD inputs carry
their exact hashes; Cargo's new, narrowly approved `snapback2-core/build.rs`
and the existing package build create ignored table artifacts ahead of time.
This one build integration is the session exception recorded in RULES; it is
not a new gate, registry, service or runtime generator.

Each optional indexed text field normalizes independently; null contributes
nothing. Output words deduplicate in first-occurrence order; query validation
counts occurrences **before** deduplication, so `foo foo` is invalid, zero
tokens mean no matches, and one token supplies the key. Query bound Q is
independent of indexed field bounds: a decomposed query exceeding a source
column's raw maximum remains valid within its own Q. No prefix truncation.
Invalid Unicode scalar strings, including JS unpaired surrogates, refuse.
Low-level NFC remains total over valid scalars for conformance. Search inputs
and wire source descriptors also obey the existing Text domain: C0 controls
except TAB/LF/CR refuse. That existing restriction makes each source scalar
occupy at most four JSON bytes; a descriptor reserves `4Q+63`, independently
of indexed field maxima. Official Unicode tables and normalization do not
silently redefine the language's Text admission rule.

The finite UCD facts establish `U = 4 × sum(declared scalar maxima)`: canonical
full decomposition expands by at most four and C/S folds do not increase NFD
length. Stable counting passes by combining class and starter segment give
linear ordering and explicit scratch rather than quadratic mark insertion.
Official normalization identities, all C/S folds and these finite bounds are
executable foundation tests. Internal index construction carries U with
W ≤ `floor(U/2)+1`, per-element bytes `4U+16`, and whole-list bytes
`4U+17W+2`; dividing an element width by W is unsound.

The frozen index contracts distinguish ordinary `Column` components from
`WordPrefixes { fields, contract }`, scalar expressions from bounded
`WordPrefix { source, contract, source_max }` expressions, and ordinary Value
atoms from an engine-owned logical atom:

```json
{"WordPrefix":{"contract":"u17-nfc-scf-nfc-wsp-p","source":"…"}}
```

That descriptor is not an application Value or physical trie id. Equality and
prefix containment compare its exact normalized meaning, not raw source JSON.
Scan preflight, stream deduplication, trace/receipt containment, coverage maps,
drained-prefix inference and local cursor comparisons use the same API. A
complete ordinary source scope covers any search term; a complete search-term
range never implies the entire source scope. Validators may remain bound to
original arguments. Only foundation types/helpers are introduced now; replacing
active schema/IR fields and their hashes belongs to coherent integration.

The reusable entry points are core `unicode::{SearchNormalizer,
normalize_search, search_words, search_field_words, search_query_token}` and
`search_key::{prepare_index_atom, decode_index_atom, index_keys_equal,
index_key_starts_with, compare_scalar_atoms}`; evaluator `unicode.ts` and
`search-key.ts` expose the corresponding camel-case functions. Prepared
`LogicalIndexAtom` values carry comparison meaning only and never replace the
source descriptor on the wire. `NormalizedWordPrefix` keeps empty distinct
from every token, and scalar suffix ordering refuses a derived atom. Native
postings, certificate ledgers, authoring acceptance, receipt validators and
held indexes must integrate these APIs together in the subsequent lanes.
`decode_index_atom` consumes canonical tagged JSON, using the existing cursor
read/re-encode convention to reject duplicate members and alternate encodings;
`prepare_index_atom` validates parsed descriptors. Canonical wire encoding does
not canonicalize source text: equivalent spellings still compare by prepared
meaning. `word_prefix_wire_max(Q)` exposes the source descriptor byte bound.

The normalizer uses u32 positions, so its implementation ceiling is
`MAX_SEARCH_SOURCE_SCALARS = 0x3fffffff`; resource certification gives usable
operations much smaller bounds. With the pinned decomposition depth three,
`normalization_step_bound(Q)` is `166Q + 1028 + ceil(Q/32)` logical pass work.
`normalization_scratch_bytes(Q)` is `96Q + 3108 + 24 ceil(Q/32)`, covering typed
buffers and the shared UTF-16 chunk-conversion model; input, returned strings
and immutable tables are separate. These helpers describe normalization only:
search wrappers additionally validate Text in two scalar passes and tokenize /
deduplicate, and native index maintenance adds its own ledger. A reused
normalizer's scratch uses the largest input processed during its lifetime, not
a later smaller Q. This model does not claim a measured VM/process heap peak;
full search heap qualification still includes runtime/table/store overhead.

**Native integration record, 2026-09-07.** Implementer: Codex GPT-6 Astra
(xhigh), `clique-native-v5-integration` lane. The native engine now uses
`Index.components`, `Scalar`/`WordPrefix` scan positions and logical `IndexAtom`
receipts under value identity `i53-codepoint-bytes-unicode-search-text-refinements-v5`
and evaluator `bounded-spike-rust-search-text-refinements-5`. Held source
descriptors are rederived under their certified Q and dependency custody;
a tag alone is never trusted. Ordinary points, scalar suffixes and bounds retain
their roles. This reconciles the implemented v5 engine onto current native
source; compatible compiler, evaluator and client delivery remain coordinated
dependencies, with no package or search performance claim from this record.

Count-backed caps retain the exact source/ordered-group count maintain match,
deterministic point address, one-row reserve, proven-absence requirement and
constraint trace. Unbacked caps retain N probes; successor admission still
counts base rows. The same transaction maintains counts and search postings and
rolls both back on refusal. LLP 1016 D6's single live-generation ad hoc admission
and post-admission clock callback remain. Timed query delivery uses one validated
safe-integer read time in both the envelope and validator, including an unvisited
timed branch; untimed validators retain their prior shape.

**Downstream obligations, not current capability claims.** One nonunique derived
component must be equality-bound after ordinary scopes and before ordinary
ordering suffixes. It cannot supply a unique/point/write/cap key, range position,
or authorization fact about its source field. Exact `(parent,scalar)` trie
postings are native source-write maintenance; ordinary suffixes end in intrinsic
id. Cheap `L+K+2` merge requires a single lane-invariant normalized term and
coalesced disjoint ordinary scopes, not uniform authorization alone. Scope-range
touches invalidate deeper search ranges without serializing expanded prefixes.
Successors stay atomic; no incomplete index is exposed. Points and verdicts
retain current OCC comparison; ranges re-execute and are never snapshot-compared.

Receipt integration must enforce identity widths, pool halos as row references,
retain secondary suffixes without duplicate prefixes, price every serialized
source descriptor and authority/reference record, and prove actual whole
media-bearing schemas under 4 MiB. Derived work contributes named step/scratch
terms: do not confuse it with scan-entry/application-row counts or multiply all
new scalar work by the legacy 32-bytes-per-step heap estimate. The persistent
twin/held-state and local cursor contract is LLP 1012 §"Indexed held search".

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
- The shared corpus (`snapback2/corpus/manifest.json`) is regenerated whenever serialization or
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
