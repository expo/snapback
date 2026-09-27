# DS: delivery, the server half

**Current result:** [Round 3](ROUND3.md) repairs PostgreSQL adoption and adds
mutation-proven reopen and index-heap coverage. [Round 2](ROUND2.md) records
the unoptimized publisher baseline; [Round 1](ROUND1.md) documents the
fingerprint protocol. The report below is the historical round-0 record;
its interface and open-problem status are superseded.

Date: 2026-09-27. Branch: `sb4-intent/ds-delivery-server`. Base: `3369ae543`.
Implements LLP 3000.022 §§2, 5 and 6. No push or package publication.

Implementation is committed, with an unresolved wasm budget failure. The
budget is unchanged. Device collection, persisted delivery debt and client
queues belong to DC and are not implemented here.

## Commits

- `50792cfa7`: baseline Postgres compilation repair.
- `6091fc4f3`: clause, compiled bindings, card and diagnostics.
- `9636baa99`: manifests, origins, supplemental ledger and receipt-only no-ops.
- `21a575d47`: retain variable-map node reservations until the map drops;
  stop subsequent stamping after supplemental exhaustion.

## File map

All paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-core/src/schema.rs` | Adds and exports compiled delivery bindings. |
| `crates/snapback4-core/src/schema/capabilities.rs` | Serializes the optional top-level `delivery` array through the existing backend schema; old schemas default to no bindings. |
| `crates/snapback4-core/src/schema/delivery.rs` | Binding fields and compact streaming decoder; validates required fields, duplicates and exactly three argument names. |
| `crates/snapback4-lang/src/ast.rs` | Delivery clause AST and optional operation attachment. |
| `crates/snapback4-lang/src/parser.rs` | Shares block-content parsing for continued operation headers. |
| `crates/snapback4-lang/src/parser/programs.rs` | Parses inline and indented delivery clauses; malformed/duplicate clauses get `E_DELIVERY_CLAUSE`. |
| `crates/snapback4-lang/src/bind/delivery.rs` | Checks operation kind, table, required reference/int coordinates, argument types/order, immutability, ordered uniqueness, one reporter per table and durable execution; emits bindings. |
| `crates/snapback4-lang/src/bind/mod.rs` | Runs delivery admission and the durability check. |
| `crates/snapback4-lang/src/bind/intent_views.rs` | Synthesized operations start without delivery clauses. |
| `crates/snapback4-lang/src/diag.rs` | Routes both delivery diagnostics to the receipts card. |
| `crates/snapback4-lang/src/guide.rs` | Adds `reports` and `delivery` card aliases. |
| `crates/snapback4-lang/src/guide/codes.rs` | `E_DELIVERY_CLAUSE` and `RUNS_FULL` explanations and rewrites. |
| `crates/snapback4-lang/src/guide/language.rs` | Documents the new operation-header form. |
| `crates/snapback4-lang/src/guide/receipts.rs` | Adds the clause, refuses the disjoint 65th run, documents success-is-coverage and durable replay. |
| `crates/snapback4/src/verbs.rs` | `snapback4 why reports` returns the contract card. |
| `crates/snapback4-core/src/engine/delivery.rs` | Authorized coordinates, per-field origins, live/peak supplemental heap accounting, survivor walk, deduplication, exact wire envelopes and bounded partial manifests. |
| `crates/snapback4-core/src/value.rs` | Stores a delivery-presence bit in existing native object padding; value equality and answer heap accounting stay unchanged. |
| `crates/snapback4-core/src/value/provenance.rs` | Delivery metadata beside source identity; preserves ordinary provenance through replacement and projection. |
| `crates/snapback4-core/src/engine/provenance.rs` | Automatically stamps authorized tracked sources independent of the provenance request flag; retains the existing opt-in provenance charge. |
| `crates/snapback4-core/src/engine/runner.rs` | Carries field origins through aliases, spread lowering, variables and successive projections; replacements clear origins. |
| `crates/snapback4-core/src/engine/presence.rs` | Records scalar variable origins when binding an evaluated value. |
| `crates/snapback4-core/src/engine/mod.rs` | Query manifests and SQLite receipt-only no-ops at the committed sequence. |
| `crates/snapback4-core/src/engine/local.rs` | Native local-query outcomes leave server manifest fields absent; no device collector added. |
| `crates/snapback4-core/src/engine/receipt.rs` | Persists a private `receiptOnly` marker, restores it on replay and excludes it from public mutation replies. |
| `crates/snapback4-core/src/engine/postgres/mod.rs` | Equivalent manifests and receipt-only transactions on Postgres. |
| `crates/snapback4-core/src/engine/postgres/through.rs` | Supplies the missing `None` adoption-report argument; baseline compilation failure, independent of delivery. |
| `crates/snapback4/src/serve.rs` | Successful `/q/` manifests, `meter.delivery` under dev, and suppression of durable notifications for receipt-only execution/replay. |
| `crates/snapback4-lang/tests/delivery/schema.q` | Shared admitted schema and all projection/call forms under test. |
| `crates/snapback4-lang/tests/delivery_clause.rs` | Four compiler/wire admission tests. |
| `crates/snapback4-lang/tests/delivery.rs` | Eight engine tests described below. |
| `crates/snapback4-lang/tests/guide.rs` | Changes the old silent-success 65th-run assertion to `RUNS_FULL`; surrounding card scenarios remain. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Pins the new diagnostic definitions to the receipts card. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Pins concrete repair text for both codes. |
| `crates/snapback4-core/src/engine/postgres/tests.rs` | Registers the Postgres delivery test module. |
| `crates/snapback4-core/src/engine/postgres/tests/delivery.rs` | Tests manifests and no-op receipt/replay in both Postgres execution modes. |
| `crates/snapback4/src/serve_tests.rs` | Registers HTTP delivery tests; remains at 1,500 lines. |
| `crates/snapback4/tests/serve_delivery/mod.rs` | Tests wire manifests and no wake on receipt/replay, with an ordinary mutation as positive wake control. |
| `JOURNAL.md` | One dated implementation and evidence entry. |
| `reports/20260927-delivery-server/` | This report and retained validation evidence. |

## Forms that compile and run

The shared fixture declares immutable `messages.chat` and `.ordinal`, with
`unique chat, ordinal`. It exercises both spellings:

```quarry
mutation delivered(group: chats, low: int, high: int)
  reports delivery of messages by .chat, .ordinal:
  require low <= high else NOT_A_RUN
  return null
```

```quarry
mutation delivered(group: chats, low: int, high: int) reports delivery of messages by .chat, .ordinal:
  require low <= high else NOT_A_RUN
  return null
```

These fixture bodies isolate platform behavior; a real reporter must record
the claimed coverage, as the complete receipts card does. The compiler cannot
prove that author promise. The schema binding is:

```json
{"delivery":[{"table":"messages","group":"chat","position":"ordinal","mutation":"delivered","args":["group","low","high"]}]}
```

A successive projection preserves stored-field origin:

```quarry
query alias():
  return messages['m1'] {alias: .text} {alias}
```

For an authorized `m1` in `c1` at position 1, `/q/alias` carries:

```json
{"delivery":[{"table":"messages","mutation":"delivered","args":["group","low","high"],"rows":[["c1",1]]}]}
```

`messages['m1'] {text: .text, ordinal: 0} {ordinal}` and
`messages['m1'] {ordinal: .ordinal}` carry no qualifying image. Nested
surviving images qualify independently. A foreign quoted field does not
qualify its outer message. Budget exhaustion retains reserved pairs and adds
`"partial":true`; if an envelope cannot fit the wire form is
`{"delivery":"partial"}`.

The card's disjoint 65th delivery run now returns a failed write whose code is
`RUNS_FULL`. A covered no-op at committed head H returns `state: "sent"`,
`seq: H`, `head: H`; replay returns the recorded success and does not run the
body. Ordinary no-op mutations retain their old sequence advancement.

## Tests and evidence

`delivery_clause.rs`:

1. Inline/continued clause compilation, argument-name order, exact schema
   JSON, round trip, and absence of `delivery` on legacy schemas.
2. Every clause check emits a located diagnostic, a rewrite and a why entry;
   includes duplicate reporters and malformed headers.
3. Ephemeral-only reporters cannot claim durable replay.
4. The binding decoder rejects missing/duplicate fields and wrong arity.

`delivery.rs`:

1. Raw fields, aliases, spread, scalar variables, nested images and dedup;
   excludes empty/replaced/position-only/scalar/count/filtered/denied images,
   foreign-field attribution and successive projections that lose origin;
   independent of the provenance flag and gated on read tables.
2. SQLite no-op retains its receipt at head without growing commits, partition
   log or effects; replay after replacing the body cannot execute that body;
   ordinary no-ops still advance.
3. Output-ledger overflow preserves answer data, complete/cut/capped_at,
   unavailable and ordinary meter; includes the minimal partial form.
4. Two tracked tables with equal coordinates retain separate bindings and
   their actual argument names.
5. Reports that write rows or emit effects still commit.
6. Partial manifests retain rows so far, and filtered candidates release
   their stamping heap.
7. Low steps, heap and examined allowances leave the answer's cuts unchanged;
   the supplemental ledger remains within its own allowance.
8. Authorized `Value::Map` sources are tracked as well as `Value::Row`.

HTTP tests prove manifests need no provenance opt-in, scalar results carry
empty rows, unrelated/denied answers have no manifest, and dev exposes the
supplemental meter. A Condvar test proves both original no-op and replay do
not wake change waiters; an ordinary mutation wakes the same waiter.

The Postgres test uses a private socket-only PostgreSQL 16 instance. It runs
both Serialized and Serializable modes, checks a manifest, snapshots the
head/commit/log/effect tables, checks the bound receipt, removes the program
and verifies successful replay before program lookup.

The whole guide test is required and was run: 86 passed. The focused suite
also passed the 4 clause tests, 7 engine tests before the final Map case was
added, and 3 existing read-through-provenance tests. The full run reported the
Map case failing. Rebuilding with `cargo test --workspace --test delivery --
--nocapture` passed all 8 tests. The failing full-run artifact appears to have
compiled before the final Map handling edit; the only subsequent source edit
was to print the whole outcome on assertion failure. This is counted as my
validation-timing failure, not erased from the full-run result. The final
Postgres test passed in both modes. After the final ledger correction,
`cargo test --workspace --test delivery --test delivery_clause --test guide
--test read_through_provenance` passed 8 + 4 + 86 + 3 tests. Both HTTP tests and
the Postgres test (both modes) were rerun and passed. Changed source files are
at most 1,500 lines; `git diff --check` passes. The reference audit returned
`ref-check: ok — 516 LLP docs, 9604 refs in 27159 files, 0 errors, 0 unchecked`.

The required `scripts/test.sh` run exited 1, with this exact ending:

```text
== 2 failure(s) in 1487 s
   wasm build
   cargo test
```

Every failed gate/test in that run:

| Failure | Attribution | Final status |
|---|---|---|
| `wasm build`: 572,996 gzip bytes against 572,841 | Mine | Open: 155 bytes over the unchanged budget. |
| `cargo test`: `snapback4-lang::delivery::map_backed_authorized_source_images_are_tracked_too` | Mine | Full-run artifact failed; rebuilt workspace target passed all 8 tests, including this one; final focused checks passed after the ledger correction. |

There were no other failed tests or gates, and no baseline/environmental
failures in this full run. The separate baseline Postgres compile repair is
recorded above. All other Rust targets, the complete guide, package and app
typechecks/builds, fixture tests, client tests, and all 78 client model tests
passed. The full suite was not rerun after the final server-only ledger fix;
its affected tests were rerun as recorded above.

Evidence: [full suite](full-suite.log.gz), [final focused tests](focused-tests.txt),
[HTTP](http.txt), [Postgres](postgres.txt), [reference audit](ref-check.txt),
[baseline wasm](wasm-before.txt), [final wasm](wasm-after.txt), and
[replay counterexample](replay-conversion.txt). Toolchain: rustc 1.97.0
(`2d8144b78`, 2026-07-07), Bun 1.3.14, Node v24.13.1. The full run used
`CARGO_BUILD_JOBS=12`; final targeted rebuilds used 4. The private socket-only
Postgres server was stopped after validation.

## Size and open problems

The same host/toolchain measured:

| Artifact | Raw bytes | Gzip bytes |
|---|---:|---:|
| Base `3369ae543` | 1,981,512 | 572,053 |
| DS implementation | 1,985,215 | 572,996 |
| Delta | +3,703 | +943 |

The unchanged gzip budget is 572,841 bytes. DS exceeds it by **155 bytes**.
Reproduce: `cd snapback4 && bash scripts/build-wasm.sh` with the prescribed
Rust/Bun toolchain on PATH. Server-only origin tracking is excluded from
wasm. A streaming binding decoder reduced the growth, but three bounded size
iterations did not bring it under the cap. No authorization, durability,
meter or schema-interface requirement was removed to save bytes. This needs
supervisor integration or a separately reviewed size reduction before landing.

**Replay across conversion to ephemeral is unresolved.** A generation can
reuse `delivered` without its clause and make it write an ephemeral `signals`
table. SQLite's `mutate`, `replay_mutation`, and the HTTP dispatch route
ephemeral operations before durable receipt lookup. Repeating the old bound
write id then executes the new body instead of returning the old delivery
receipt. The reproduced outcome has `replayed: false`, `receipt_only: false`,
`rows_written: 1`, and `tables: ["signals"]`.

Reproduce from `snapback4/`:

```sh
cp reports/20260927-delivery-server/replay-conversion-repro.rs crates/snapback4-lang/tests/delivery_replay_conversion.rs
cargo test -p snapback4-lang --test delivery_replay_conversion -- --nocapture
rm crates/snapback4-lang/tests/delivery_replay_conversion.rs
```

The assertion fails as expected; the reproduction and log are retained here.
This is an existing ephemeral routing rule, now in conflict with the new
delivery replay promise when a name changes execution class. Existing
`serve_ephemeral` tests explicitly pin correlation ids as non-idempotent.
I stopped this case rather than redesign ephemeral replay. The added compiler
check prevents a currently declared reporter from being ephemeral, but cannot
prevent a later generation from dropping its clause. The supervisor needs to
decide custody across that generation transition. Ordinary generation changes
(including removing the program) and unchanged delivery bindings replay
correctly in the new tests.

## Decisions, deviations and scope

- The interface is unchanged: compiled bindings and wire envelopes have the
  specified names, identity and argument order. No generated API addition is
  needed: HTTP manifests are self-describing and the device already consumes
  the compiled schema, as §5 specifies.
- Added an admission restriction for ephemeral-only reporters. Concrete
  counterexample: a declared reporter writes only an ephemeral `signals`
  table. Existing ephemeral dispatch skips durable receipts and executes each
  same-id call again. Such a reporter cannot provide §2.2 or §6's durability.
  `E_DELIVERY_CLAUSE` asks the author to record durable coverage and separate
  ephemeral writes. The compiler still does not prove coverage from the body.
- Native server origin tracking is feature-gated to `sqlite` (also enabled
  by Postgres). Wasm carries the compiled bindings but no server-only ledger.
  DC owns device collection and its metering.
- `meter.delivery` reports supplemental steps, peak live heap and reserved
  output bytes. Metadata uses RAII leases to release filtered candidates.
  Variable-map node charges remain reserved until the map drops because
  removing a name need not free a BTree node. The output allowance has the
  specified 128-byte floor.
- A private receipt marker preserves notification suppression on replay;
  it is not a new mutation-reply field. Existing ordinary replay behavior is
  preserved.
- Fixed a baseline Postgres compiler error: `activate_columns` gained an
  optional adoption-report argument, but the read-through caller lacked it.
  The repair supplies `None` and is isolated in its own commit.
- Existing receipt tests only change the behavior deliberately amended by
  §2.3: the 65th disjoint run refuses instead of claiming success.
- No client queue, device collector, comparative application, SDK-hook
  replacement, version bump, publication or budget increase was attempted.
