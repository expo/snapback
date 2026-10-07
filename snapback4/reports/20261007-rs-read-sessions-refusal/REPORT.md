# Lane RS — refusal preserves read-session storage

Round-1 follow-up: [remaining refusal paths and concurrent regressions](round1/REPORT.md).
The record below describes the initial `dbfcff9fa3` implementation.

Date: 2026-10-07. Base: `641733250a8e8e35e870af6b9ff62565efd3a10b`.
Branch: `sb4-intent/rs-read-sessions-refusal`. Work and verification stayed in
`/home/ccheever/sb4-intent/lane-rs` on eb1000 (hostname `expose-builder-pixel`).
No other worktree or host was used. Nothing was pushed or published.

## Cause and audit

The reported Darwin fence failure is explained by this exact base-commit path:

1. Native `Device::open` / `open_with` calls `sqlite::open`
   (`snapback4-device/src/native.rs:17–26`, `sqlite.rs:15–24`).
2. That calls `Store::open_shared`, then `Store::open_base`, then `prepare`
   (`snapback4-core/src/store/ownership.rs:34`, `store.rs:154–182,217–262`).
3. `prepare` calls `identity::initialize` before its opening transaction and
   version check. `identity.rs:114` calls `read_sessions::initialize`.
4. `identity/read_sessions.rs:9–17` creates `_read_sessions`, its family index,
   and adds `_session_mint_bindings.scope`, in autocommit mode.
5. Only afterward does `Device::open_store_mode` decode/check the kept backend
   (`device.rs:454–482`), or `call::call` decode an `adopt` request and run
   `adopt_captured` (`call.rs:105–118`, `device.rs:591`). Refusal cannot roll back
   the earlier committed auth DDL.

Server `Store::open → open_with_busy_timeout → open_base` shared the same
`prepare` path before `Engine::new` validated/activated caller source or
`Engine::open_at` decoded the stored backend (`engine/mod.rs:378–459` at base).

The existing [Darwin fence](../../packages/snapback4/test/schema-capabilities.test.mjs)
lines 232–245 first opens the old device successfully with the current engine,
then refuses a future capability. Its table/row snapshot still predates that
current open. Consequently creating `_read_sessions` even at successful native
open would still fail this fence. Its byte snapshot is taken after that open.
The new Linux regression preserves both snapshots from before the current open.

The PostgreSQL equivalent was
`PostgresEngine::open → attach → client.batch_execute(READ_SESSIONS_DDL)`
(`engine/postgres/mod.rs:82–120`, `store.rs:23–26` at the base). The table/index
were committed before the backend recheck, cap installation and contribution
adoption. These later steps can refuse. `create` also committed the namespace
before calling `attach`.

Other pre-refusal writes found in the audit:

- SQLite `prepare` creates the base tables/indexes, drops `_log_row_seq` and
  `_log_row_seq_kind`, adds session-family/job/op/outbox/action columns and
  tables, and removes obsolete `_ops` payload columns (`store.rs:234–289`,
  `identity::initialize`, `engine::actions::initialize`). These preceded even
  the store-version check. `_meta.version` and `_meta.store_id` inserts were
  already inside the opening transaction, but a successful low-level open
  committed them before a later backend/adoption refusal. Server open also
  created `_change_evidence` separately. Native `sqlite::open` created
  `_device_outbox`, `_device_base`, `_device_snapshot` and its index separately.
  Unconditional `PRAGMA journal_mode = WAL` could alter a refused rollback-mode
  database header.
- PostgreSQL open created `_sequences`; attach added `_backend.generation` and
  `through_shortened`, dropped the two obsolete log indexes, and committed
  `_cap_counts` and its rebuilt rows separately from contribution adoption.
  Contribution adoption committed before converting a negative generation to
  `u64`, so that final refusal was also too late. PostgreSQL uses `_backend`
  rather than SQLite's `_meta` for these generation facts.
- SQLite activation's catalog, row/index rebuilds, capability counters, key
  proof and generation metadata were already transactional. They remain so.
  Selected-release attachment had a release check after open/upgrade; that
  check now participates in the preflight and final write transaction too.

These findings go beyond the new table; moving only its `CREATE TABLE` would
leave other refusal paths able to change a legacy store.

## Change

[SQLite read sessions](../../crates/snapback4-core/src/identity/read_sessions.rs)
create their table and family index only in `insert`, in the mint transaction.
The mint-binding scope column is installed in the authorized bound-mint
transaction. Presence checks inspect `sqlite_schema`; an absent read table
contributes no authority and makes cleanup a no-op. Ordinary full sessions still
resolve and log out. SQL errors from malformed storage are propagated.

[Store preparation](../../crates/snapback4-core/src/store.rs) reads existing
version/catalog/identity without upgrading them. Fresh initialization is one
transaction. Existing databases keep their journal mode. Read-only inspection
attachments perform no upgrade. Physical upgrades
run within [activation](../../crates/snapback4-core/src/store/activation.rs), or
`finish_open` after server backend validation. Native
[side tables](../../crates/snapback4-device/src/sqlite.rs) join device
installation. The selected-release expectation is checked again inside the
transaction that can commit upgrades.

[PostgreSQL attach](../../crates/snapback4-core/src/engine/postgres/mod.rs)
owns one transaction from namespace creation/physical upgrade through backend
recheck, cap rebuild, contribution adoption and generation validation. The
shared head is locked before upgrades. Missing columns are checked before
`ALTER TABLE`: even a no-op ALTER would demand an exclusive lock and block a
held reader. The existing authority-fence test also exposed that a read
snapshot's captured watermark was being used as evidence of the writer lock;
the adapter now records that lock separately. Neither a read transaction nor
an optimistic serializable transaction gets revocation authority from a cached
watermark.

The existing wasm codec census's two SQLite-only decoder exceptions follow
`open_at` into its extracted `open_selected_at` helper; their exact source text,
SQLite cfg requirement and one-use checks are unchanged. All 26 census tests
pass. No client or web-device implementation changed. Read credentials remain in a
separate fail-closed table, preserve their absolute caps and principal
generations, and log out by family. SDK read sessions still never refresh or
rotate. Raw HTTP refresh retains the existing cap-limited contract. Reader
requests never install auth schema or acquire new application effects.

## Regression coverage

[Native/SQLite tests](../../crates/snapback4-device/tests/schema_capabilities.rs)
run on Linux and include `sqlite_schema` plus every table and value, followed
by complete database-file byte comparisons, in both WAL and DELETE modes:

- Current native open followed by future-capability refusal, starting without
  the read table or mint scope column.
- Kept, explicit and conditional native opens against an unsupported stored
  backend, with other tables/indexes/columns/metadata also missing.
- Wrong store version, malformed stored server schema, obsolete selected
  release, and late server release-adoption refusal after upgrade work.

[Read-session tests](../../crates/snapback4-core/tests/read_sessions.rs) exercise
missing-table authorization on all resolver paths, absent-token refresh and
logout, full-session logout/revocation without creating the table, first mint,
read-family logout, and malformed-table errors. Existing race tests now assert
that refused narrowing does not even install the table.

[PostgreSQL tests](../../crates/snapback4-core/src/engine/postgres/tests/refusals.rs)
compare all rows, columns/defaults, indexes and constraints after wrong-version,
invalid-schema, changed-backend, negative-generation and failed cap-rebuild
refusals. The changed-backend test drives the actual attach recheck with stale
captured input; it does not rely on scheduling a race. PostgreSQL assertions
cover transactional schema/data state, not physical MVCC/WAL bytes.

Existing migration witnesses now distinguish low-level inspection from accepted
activation: obsolete log indexes and change-evidence storage change only at the
latter boundary. The synthetic pre-binding fixture retains real store metadata
while replacing the legacy session/work tables. The native publication-test
fixture installs its empty backend before exercising side-table operations.
Their assertions about migration, replay, plan reuse and publication are retained.

The final client pool exposed a separate ordering mistake in the existing
`read-only-round4.test.mjs` request recorder. It appended `/auth/logout` only
after `fetch` returned, although raw `signOut` deliberately does not await the
network response. The server probe had already confirmed `E_AUTH`; its response
could beat the logout response, making the subsequent `sent.includes` assertion
false. The recorder now records dispatch before awaiting the response. The
remote-revocation, local-session and no-refresh assertions are unchanged.

## Verification

All Cargo/suite runs use `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.
Cold builds were limited to eight Cargo jobs in this shared host's worktree.
Node: 24.13.1. Dependencies: `bun install --frozen-lockfile`.

PostgreSQL 16.15 was extracted from Ubuntu packages under this worktree's
ignored `target/rs-postgres`, without installing a system service. The tests
used only its private Unix-socket cluster and unique `sb4_eval_*` namespaces.
That exact cluster was stopped after the adapter tests.
The adapter invocation was `cargo test -p snapback4-core --features postgres
--lib engine::postgres::tests -- --include-ignored --nocapture`, with
`SNAPBACK4_EVAL_POSTGRES` pointing only to that cluster.

The ten client read-only files passed 118 tests with one optional prior-binary
skip. That skipped test was then run successfully using the published Linux
0.4.13 binary: the npm tarball was checked against registry SHA-512 integrity,
and `--version` reported 0.4.13. See `previous-published.json` and
`client-downgrade.log.gz`. It proves old-binary refusal and logoutAll surviving
re-upgrade; it is separate from the Darwin 0.2.33 capability fence.
The final rerun includes that binary and passes all 119 tests with no skips.

| Check | Result | Log |
|---|---|---|
| SQLite refusal fence, WAL and DELETE; original capability checks | 6 passed | `sqlite-refusals-final.log.gz` |
| Core identity, read sessions and bound sessions | 17 passed | `identity.log.gz` |
| Store unit/adoption tests | 41 passed | `store.log.gz` |
| Device adoption and legacy capability tests | 18 passed | `device-adoption.log.gz` |
| Server HTTP read-only/adoption/store scope | 150 passed, 3 existing ignores | `server-focused.log.gz` |
| CLI check/adoption | 89 + 15 passed | `check-adoption-final.log.gz` |
| Legacy migration/evidence/replay tests | 17 passed, 1 existing ignore | `legacy-migrations.log.gz` |
| Native device unit tests | 60 passed | `device-unit.log.gz` |
| PostgreSQL adapter, including ignored local-cluster tests | 29 passed | `postgres-final.log.gz` |
| Client read-only files | 118 passed, 1 separately covered prior-binary skip | `client-read-only.log.gz` |
| Final ten client read-only files, with corrected dispatch recorder and published binary | 119 passed, no skips | `client-read-only-final.log.gz` |
| Published 0.4.13 downgrade/re-upgrade | 1 passed | `client-downgrade.log.gz` |
| Wasm codec census | 26 passed | `wasm-codec-census.log.gz` |
| LLP references | 0 errors, 0 unchecked | `ref-check.log.gz` |
| Final full suite | Rust and models passed; one client recorder failure corrected and rerun above | `full-suite.log.gz` |

The first cold full-suite run exposed the read-only inspection attachment,
older fixture assumptions and named codec-census owner described above. Those
were corrected and their affected checks rerun; the complete original output is
retained in `full-suite-initial.log.gz`.

The final `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash
snapback4/scripts/test.sh` completed in **1,508 seconds**. It passed Rust's
308 test binaries / 1,021 executions and doctests, all build/typecheck/fixture
steps, and both serial client-model files (79 tests, with the default 5,000
session histories per tier and 3,000 online-client sequences). The 338 client
files reported 6,598 passes, one failure and 54 labelled skips. The sole failure
was the dispatch recorder described above; after correcting it, all ten
read-only files pass all 119 tests with no skips. The product implementation
did not change after this full run began. This is a full run plus a corrected
affected rerun, not a claim of a single all-green full run. No test was removed,
disabled or given reduced work counts.

Wasm before/after SHA-256:
`a4c6b4a8a7e76d81df9f424899f474863ce23cf232c0e4162861cc1333a3ec83`.
Both builds: 2,135,164 bytes raw, 645,264 bytes gzip; budget 645,564 bytes.
The artifact is byte-identical, not merely within budget.

The actual published 0.2.33 Darwin witness is not executable on Linux. It is
left to the user's mini run; these Linux regressions do not claim that result.

Logs are retained as deterministic `.log.gz` files beside this report.

## Governing context

The scoped `llp-orient` pass used LLP 3000 (Snapback 4 root/fence, linked in `llp/current`),
LLP 2000.000 (design brief, also in `llp/current`), LLP 3000.033 §1.3 and §3 (implemented authority
storage and acceptance), the read-only guide card, and the in-scope `@ref`s for
atomic activation and read snapshots. LLP 3000.033 is implemented and outside
`llp/current`; its storage section is updated in this change. No new design
proposal or corpus hand-off is needed. The append-only journal records the
publication-blocker fix and its verification limits.
