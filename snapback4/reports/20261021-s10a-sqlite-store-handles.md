# S10a — SQLite-only server store handles

2026-10-21. Lane `sb4-pg/s10a`, base `8beeb79c52`, local worktree
`/home/ccheever/projects/sb4-s10a` on expo-build-450a. One worker; no
sub-agents, additional worktrees, remote commands, stash or push.

The governing scope is [store-port RFC §3.4](../../llp/3000.009.001.000-the-postgres-store-port.rfc.md#34-one-engine-over-both-stores),
including its revision-2 disposition, and the
[S10 census](20261021-s10-engine-census.md). K0c's restricted member facade
and the committer RFC §3.7 remain in force.

`store_port::AnyStore` owns `Sqlite(store::Store)`; `AnyTx<'store>` owns
`Sqlite(store::Tx<'store>)`. `ReadSnapshot` owns an `AnyTx` opened through
the original deferred read path. `AnyPreparation` wraps the pre-upgrade
release check; `AnyInspection` owns the inspection session. The preparation connection keeps
its original adapter-only visibility; conversion is implemented inside the
SQLite adapter. Opening metadata,
adoption reports, inspection rows and time-opening records have neutral
homes. Step facades borrow `AnyTx`. Engine constructors accept
`Into<AnyStore>` for concrete SQLite fixtures and immediately convert it;
`Engine` itself remains concrete.

Owning handle dereference bridges and `WriteStore` are temporary S10a
adapter bridges. The latter lets adapter-internal reset/witness producers
keep their existing opener while returning `AnyTx`; it routes no new producer
through K0. The six authority reads use scoped callbacks with the same
success rollback/error-drop behavior. Explicit family implementations preserve
all `Rows` and `PartitionRows` overrides. Activation/release/free-function
bridges retain the original solo transaction and continuation order.

`MemberTx` borrows `AnyTx`, keeps explicit narrow forwarding, and gains no
dereference, owning handle, raw connection or physical transaction control.
The driver resets evidence through `begin_member_evidence` at the original
point before the member savepoint. Its negative surface fixture checks both
neutral and concrete SQLite borrow escapes.

The new census counts production `Store`/`Tx` tokens using the existing Rust
lexer, excluding test items/files, the Postgres adapter, error variants and
`wasmi::Store`. A read-only `git show` run using this matcher reproduces:

| Scope | Base tokens/files | S10a tokens/files |
| --- | ---: | ---: |
| Engine | 79 / 16 | 0 / 0 |
| Host | 44 / 21 | 0 / 0 |
| Total | 123 / 37 | 0 / 0 |

The target/allowance is zero, with no raise override. The existing committer
ratchet now recognizes `with_authority_snapshot`, preserving the outstanding
K0 opener count rather than hiding these reads. The device crate and the
Postgres evaluator/adapters are unchanged. Five inherited raw SQLite
calibration probes in the standalone experiment now call typed evaluation
methods with the same SQL and order; its manifest enables the existing
`evaluation-support` feature.
The experiment lockfile drops one stale direct device-to-rusqlite dependency
edge to match its existing manifests; no dependency version changes.
The concrete public SQLite re-export remains for devices and fixtures.
S10b's absent-evidence correction and remaining semantic extraction are
intentionally outside this change.

Building commits: `875ab4a310` (handles/bridges), `22287eeabe` (engine),
`49bb3d4ebf` (host/identity). Each passed the binary build before commit.
The final census/qualification commit includes test-fixture conversions.

All Cargo builds use only this worktree's `snapback4/target`, ten jobs,
`CARGO_INCREMENTAL=0`, and line-tables-only dev/test debug information.
Disk space is checked throughout and before each qualification stage; it
remains above the 20 GB stop threshold. The pinned Node is v24.13.1.

Validation:

| Check | Result |
| --- | --- |
| `cargo build -p snapback4` | Pass; normal binary rebuilt after all test runs |
| Core `--no-default-features` check | Pass |
| Device web/wasm `--no-default-features --features web --target wasm32-unknown-unknown` check | Pass |
| Full core suite, including corpus and doctests | **1,024 passed / 0 failed / 5 ignored** |
| Full host suite | **1,398 passed / 3 failed / 15 ignored**; only the supplied baseline failures below |
| Full device suite | **1,573 passed / 0 failed / 4 ignored** |
| Both existing ratchets and new concrete-handle census | **12 tests passed**; concrete handles **0/0**, store-port **0 production / 95 fixture sites**, committer **49 sites in 11 files** |
| Guide `every_emitted_code_is_explained` | **1 passed** (126 other guide tests filtered by the requested command) |
| `wasm-codec-census.test.mjs` | **27 passed** |
| Simulator suite | **749 passed / 0 failed / 7 ignored** |
| Differential suite, with the locally built Lean oracle | **99 passed / 0 failed / 0 ignored** |
| `scripts/test-postgres.sh` | **Pass**: 58 standalone experiment tests, 161 landed-family tests, 19 corpus tests; existing named exclusions retained |
| Root `./ref-check` | Pass; zero errors and zero unchecked references |

Host failures are exactly the supplied baselines:

- `w11r1c_toolchain_why_explains_node_start_failure_too`
- `farm2_typescript_7_is_refused_by_version_not_crashed_on`
- `web_witness_help_and_invalid_input`

Both supplied load-sensitive fixtures passed in the full host run:
`stalled_resolver_sigint_is_bounded_journalled_and_drained` and
`stopping_admission_flushes_console_entries_that_cannot_expire`. No isolated
rerun or flake classification was needed. Test constructors now convert to
neutral handles where they exercise host identity APIs; native SQLite
ownership probes retain the concrete `open_shared` factory. The owning read
snapshot forwards both consuming `commit` and `rollback` close operations.

Qualification exposed two inherited setup gaps. The standalone experiment's
`--locked` run refused its obsolete direct device/rusqlite lock edge; the
refresh changes only that one line. Standalone differential tests reuse device
corruption fixtures but lacked the core's debug `test-support` feature. The
feature is now enabled only in differential dev-dependencies, matching the
other fixture consumers. The local Lean 4.34.1 toolchain was already installed
but absent from PATH; its no-dependency oracle was built in this worktree
without cache downloads. The initial failures are followed by qualified reruns;
no production/default feature or Postgres algorithm changes.

All three private clusters created during qualification were stopped by the
script and independently rechecked: `ENdXgz`, `vWi1M4`, and `Pv3PWh`, each
under `/tmp/sb4-pg-eval.*`, each with `pg_ctl status = 3` and no
`postmaster.pid`. No existing cluster was stopped. The final complete script
run exits zero. The two earlier runs exposed the stale lock edge and old raw
SQLite probes; their family/corpus stages still ran before cleanup.

The standalone Cargo workspace and main workspace share the lane-required
local target directory. A transient duplicate-crate metadata conflict was
resolved by rebuilding only this worktree's shared library artifacts, then
running the complete differential suite sequentially from the main workspace.
No oracle outcome was normalized or skipped to resolve that failure.
