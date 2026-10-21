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
