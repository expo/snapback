# P0-S8: close the SQLite store boundary

Base: `ce6c0d87da` on `sb4-pg/p0-s8`. One worker, local worktree only;
no sub-agents, clone, remote commands, stash, push or Postgres implementation.
Exact-base failure comparisons used a separate local detached worktree,
removed after validation. The other lane's worktree was untouched.

## Added and moved files

- Added core adapter modules: `store/device.rs`, `store/evaluation.rs`,
  `store/test_support.rs` and `store/private_fs_tests.rs`.
- Moved device `sqlite_residency.rs` and `sqlite_residency_tests.rs` to core
  `store/device_residency.rs` and `store/device_residency_tests.rs`.
- Updated typed metadata call sites, consumer manifests and raw fixtures,
  inspection/clock policy, the ratchet, the governing LLP and JOURNAL.
  This report is the new slice record.

## Metadata and handle custody

Host production and the two upload-engine identity reads use the S6 named
families: identity, generation, release, native digest, environment, clock,
worker status and development flags. Replay writes schedule boundary and shape
through the existing jobs family in its original transaction, with digest
calculation still after the boundary write. Doctor retains the same parsing of
malformed schedule values. Keys, text values, ownership checks and errors stay
unchanged. No generic key argument is added to a server metadata trait.

`Store::conn/meta/set_meta` and `Tx::conn/meta/set_meta` are crate-private
(`Tx::meta` already was). Worker ledger placement receives only a database path;
admission sets contention timeout through a named operation. Neither returns a
connection. Existing engine outbox/reset extraction had already removed the
`verbs.rs` and reset matches listed in the production allowance.

`store/device.rs` implements the independent native DeviceStore/DeviceTx
contract: side tables, replica metadata, replacement loading, outbox, base
images and staged images. `snapback4-device/src/sqlite.rs` contains typed
forwarding only. Its metadata operations are the named device-metadata API,
with the independent device contract's existing dynamic keys, not aliases for
server `Store::meta/set_meta`. `sqlite_residency.rs` and its interruption test
move from the device crate to `store/device_residency{,_tests}.rs`. Trigger SQL,
legacy temporary caches, cache-version checks, meters and statement order stay
intact. Installation still initializes side tables, reads adoption identity,
installs counters and calls device reset at the same transaction boundaries.

`store/test_support.rs` exposes explicitly named `test_support_conn`,
`test_support_meta` and `test_support_set_meta` hooks only with `test-support`.
Consumers select it in dev-dependencies; raw examples declare their feature
requirement. Host fixture/lock/corruption calls and sibling integration fixtures
use those names. Assertions and SQL are retained. The ratchet still counts the
renamed raw handle calls, so the feature does not hide test access from the
census. No normal dependency enables `test-support`. The host and native device no
longer declare a production rusqlite dependency; direct fixture imports are
dev-dependencies.

The standalone differential evaluator also used raw handles in normal source.
Its physical row read and snapshot capture/restore move into typed
`store/evaluation.rs` operations behind a separate `evaluation-support` feature.
The evaluator owns error-chain formatting through the original callback and
receives no connection. This feature is enabled only by the evaluator's normal
dependency; it does not expose the raw test-support hooks. Its store-identity
read uses S6's typed family.

The private-filesystem POSIX-lock witness moves, unchanged, into
`store/private_fs_tests.rs`, still lexically a child of `private_fs` so it tests
private helpers. The raw SQLite fixture belongs beside the adapter. Its prior
`cfg(all(test, unix))` was conservatively counted as production. The matcher
specifically excludes bare `rusqlite::Error` / `postgres::Error` types, with a
comment and regression coverage; constructors and all other driver paths still
count. No production allowlist exception is retained.

## S7 review carry-overs

`inspection.rs` owns maintained-private error classification and duplicate
output-name policy. The adapter calls policy after the original read-only
check, at the wrapped preparation point, and before boolean inference, in the
original order. Authorizer denials retain precedence over private-name
classification. The error codes/messages and case folding are unchanged.
`internal()` has one definition shared by view construction and host catalog
policy. A regression case pins both preparation callbacks before boolean
inference and the original-statement duplicate-name refusal.

`dev_clock_store.rs` returns `RuntimeError::Store` for missing length/touched
fields from a callback record, rather than panicking. Normal and oversized
records keep their prior branches and messages.

## Ratchet

Cargo regeneration passes: production allowances **11 → 0**, tests
**95 → 95**, combined **106 → 95**. The production allowlist contains only
its header. There are no surviving production exceptions.

An exact-base census using the base matcher and the six listed source files
finds **7 actual production matches**: two driver Error types, three raw
filesystem-test lines, worker path and admission timeout. The reset (1) and
`verbs.rs` (3) allowance entries were already stale. The standalone final
matcher/census tests pass, with zero production sites and 95 test sites. The
required Cargo regeneration passes all five tests; the normal suite run is
recorded below.

## Validation

- Final ordinary `cargo build -p snapback4` passes, as do the separately
  building extraction/fixture commits.
- Complete corrected `cargo test -p snapback4-core --no-fail-fast` passes:
  459 unit tests, three existing unit ignores, every integration target and
  all 17 doctests. Existing integration ignores retain their normal status.
- Complete `cargo test -p snapback4 --no-fail-fast` passes every target,
  including 494 enabled binary tests, the normal ratchet, SQL inspection,
  the large initializer/residency case and web witness. Five binary tests
  retain their existing ignored status.
- Required `cargo clippy -p snapback4-core -p snapback4 --tests` fails with
  `clippy::while_immutable_condition` in `engine/read.rs:780` and
  `clippy::never_loop` in `engine/row_views.rs:1010` on the exact untouched
  base `ce6c0d87daf0f8ac6ca136e46cb19932fcee6daa`, in a separate local
  detached worktree. Current and base diagnostic message/code/file signatures
  and counts are identical: no new warnings. No source suppression is added.
  A supplemental pass allowing only those two lints exposes three
  `clippy::not_unsafe_ptr_arg_deref` failures at device `ffi.rs:100,112,120`;
  the identical base command reproduces all three, with identical full
  diagnostic signatures and counts again.
  Finally, the same scope with command-line `--cap-lints warn` passes on both
  current and base: all 1,458 diagnostic signatures/counts match, with no new
  lints across the unblocked targets. This does not turn the required command
  green or change any source lint setting.
- `cargo check --workspace --tests --features snapback4-difftest/postgres
  --keep-going` passes, including every sibling fixture and the evaluator API.
- Device persistence checks pass: **540 tests across seven targets** (`--lib`,
  `background_durability`, `device`, `recorded_coverage`, `residency`,
  `retained_release`, `sqlite_bulk`), with no failures or ignores.
- The existing evaluator regression
  `sqlite_restore_matches_fresh_and_restores_a_committed_write` passes with
  `--features postgres --lib`. It uses SQLite only and verifies restoration
  after committed writes and refusal/budget variants.
- A compile probe against the final ordinary (no test-support) core artifact rejects
  all six generic Store/Tx methods with E0624, and all six named test-support
  methods with E0599.
- A changed-scope source literal comparison finds all 505 original SQL literal
  spellings retained. New SQL in regression cases is additional coverage.
- `./ref-check --verbose` passes (564 LLP docs, zero errors or unchecked refs).
- Fresh-tree host prerequisites are installed from the lockfile. The ordinary
  wasm build passes at 727,113 gzip bytes within the unchanged 727,513 budget,
  and the JavaScript package build passes. These supply TypeScript and the
  compiled client required by three host tests; neither generated output nor
  dependency installation changes tracked files.
- Initial verification caught raw Python indentation, a test-only Project
  helper name and remaining sibling-fixture metadata calls. These migration
  mistakes are repaired; the lock-witness script is verbatim. Affected checks
  are rerun after each fix.
- S8 runs one Cargo command at a time with `CARGO_INCREMENTAL=0`, six build
  jobs and six test threads.

The required checks are complete, with only the exact-base-reproduced Clippy
failures above. No functional uncertainty remains. No Postgres implementation
was added, `scripts/test.sh` was not run, and nothing was pushed.

## P0-S8 fix round 1 — 2026-10-21

Rebased the four lane commits onto fetched `origin/sb4-pg/main-mirror`
`8cc2a5c737`. The resulting sequence is `f89bbe904b`, `06d8bb5262`,
`b2ec2b5b90`, `916516fdfb`. Conflicts and resolutions:

- RFC: union the revision history into one `Revised` line and retain both
  lanes' body additions, including all Postgres family and §9.1 records.
- JOURNAL: preserve both append-only histories, main first and S8 afterward.
- `store/jobs.rs`: retain main's mutable jobs contract and SQLite inspection
  methods; replay's typed setters delegate to `write_schedule_shape` and
  `write_schedule_boundary`, preserving the caller's transaction and order.
- Production store-port allowance: take the per-file minimum (the empty
  list), then regenerate. All Postgres adapter SQL remains on main's version.
  The rebased ordinary binary builds, and the final production census is zero;
  no newly landed production connection or generic metadata access survives
  outside the adapters.

Review item 1: keep the independent DeviceStore/DeviceTx implementation on
Store/Tx; introducing separate borrowed store and transaction wrapper types
would also change the installation/open-recovery callbacks and device trait
implementation. The required tool boundary covers every public native-device
adapter method, device installation variants (which also take arbitrary
metadata maps), the physical replacement loader, raw fixture hooks, and
DeviceStore/DeviceTx's generic trait spellings. Every public device adapter
method names `snapback4-device::sqlite` as its intended caller. Raw-method
matching scans each workspace crate's `src`, with only the device crate and
adapters exempt. Dot calls, UFCS, method references, raw identifiers, multiline spellings,
comments/literals, unrelated device-policy names and a second consumer crate
are pinned by `raw_device_and_fixture_access_cannot_reopen_the_host_port`.
`every_public_device_adapter_method_is_covered` refuses a newly exposed device
or fixture method missing from the matcher. Explicit device methods count as production even inside a consumer test
module. Both actual production access and its allowance must be zero even
when regeneration permits test increases.

The production allowance remains **0**. Test allowances are **95 → 106**:
five existing shared-job fixture setters, four existing owner fixture metadata
lines, and two existing SQL-catalog fixture metadata lines are newly counted.
`test_cases.rs` is the jobs family's explicitly `cfg(test)` external module;
that exact filename now joins the ratchet's test-file classification. The
initial regeneration correctly refused the newly counted test lines; after
reviewing them, a test-only raise regenerated the census. No raw access site
was added to production by this fix.

Review item 2: `test-support` plus disabled debug assertions is a compile
error in the core, including release/production/wasm profiles. A search of
repository `scripts/`, Snapback 4 `scripts/`, and CI workflows found no release
test path with the feature; the Rust suite uses the ordinary test profile and
the release evaluator uses only `evaluation-support`. No narrower exception
is needed. `scripts/check-test-support-guard.sh` runs the review's exact host
release/feature combination and requires the explicit refusal diagnostic;
an unrelated build failure cannot pass. The existing release guard invokes
this check before its web-policy check.

Review item 3: `savepoint`, `release`, and `rollback_to` validate
`[a-z_][a-z0-9_]*` before SQL, activation-cache clearing, or change tracking.
Invalid names return `RuntimeError::Store` with an internal-error message.
The two new `rows` integration tests cover valid boundary spellings and all
three invalid controls, including an UPDATE-shaped injection, quotes, NUL,
Unicode, comments, spaces and invalid initial characters. They check metadata
immediately after each refusal and prove the held savepoint, outer writer and
persisted metadata remain intact.

### Fix-round validation

All Cargo commands use four jobs, `CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=line-tables-only` and
`CARGO_PROFILE_TEST_DEBUG=line-tables-only`, one Cargo command at a time.
Runtime tests use four threads; the device suite additionally uses its normal
32 MiB test stack (`RUST_MIN_STACK=33554432`).

- `cargo test -p snapback4-core`: **pass**, 917 tests across 45 targets,
  five existing ignores, including all 17 doctests. Both new `rows` cases,
  `savepoint_controls_refuse_injection_without_changing_the_transaction` and
  `savepoint_controls_accept_lowercase_ascii_identifiers`, pass.
- `cargo test -p snapback4 --no-fail-fast`: **pass**, 1,376 tests across
  69 targets, 15 existing ignores. All listed baseline cases pass in this run:
  `w11r1c_toolchain_why_explains_node_start_failure_too`,
  `farm2_typescript_7_is_refused_by_version_not_crashed_on`,
  `web_witness_help_and_invalid_input`, and
  `stalled_resolver_sigint_is_bounded_journalled_and_drained`. No other failure.
- `cargo test -p snapback4-device`: **pass**, 1,569 tests across 103 targets,
  four existing ignores. This includes the complete memory/SQLite paired-world,
  admission/outbox/settlement, persistence, acquisition and sequence matrices.
- `bash scripts/check-test-support-guard.sh`: **pass**. The release host with
  explicit `snapback4-core/test-support` fails with the required core guard
  diagnostic; the script exits successfully only after observing that refusal.
- Store-port regeneration with `SNAPBACK4_RATCHET_UPDATE=1`: **pass**, with
  **0 production / 106 test sites**. The final regeneration needs no raise.
  The production header now says `production`, reflecting the policy that an
  explicit device call remains a production violation even in a consumer test.
- Final ordinary `cargo test -p snapback4 --test store_port_ratchet --test
  committer_ratchet`: **pass**, all seven store-port and three committer tests.
  The shared lexer also normalizes raw identifiers, so `r#set_device_meta`
  and raw UFCS spellings cannot bypass the matcher. No committer allowance
  changes; its inherited 49 named publication sites still pass.
- Final ordinary `cargo build -p snapback4`: **pass**; this builds the normal
  dependency graph after the explicit release-feature refusal.
- Final `./ref-check --verbose` from the repository root: **pass**, 564 LLP
  documents, zero errors and zero unchecked references. There is no
  `snapback4/ref-check`; the root command is the repository checker.
- `git diff --check` and both release scripts' `bash -n`: **pass**.

The lowest observed `df -h /home` reading was **28 GB free**, above the
15 GB stop threshold. No other worktree, git configuration, stash, remote
machine, push or publication was touched. `scripts/test.sh` and Clippy were
not rerun in this fix round; all checks specifically requested for the round
are complete and pass. Logs are under the ignored `snapback4/target/`:
`p0-s8-fix-core.log`, `p0-s8-fix-host.log`, `p0-s8-fix-device.log`,
`p0-s8-fix-test-support-guard.log`, `p0-s8-fix-ratchets-regenerate.log`,
`p0-s8-fix-ratchets-final.log`, `p0-s8-fix-build-final.log`, and
`p0-s8-fix-ref-check.log`.
