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
methods with the same SQL and order under the experiment's pre-existing
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

## Fix round 1 and rebase — 2026-10-21

Rebased the four lane commits onto `4575a14e95` from
`origin/sb4-pg/main-mirror`, using the requested committer identity throughout.
The resulting commits are `62e07b3127`, `fe3d38ccc0`, `cb3bc43b96`, and
`ab3830965f`, in the original order. No push or stash. The reviewer worktree
was not accessed.

Actual conflicts were `JOURNAL.md`, engine `activation.rs` and `mod.rs`, the
store-port RFC's Revised header, and the standalone experiment's `main.rs`.
The journal keeps both histories; the RFC keeps main's complete revision
history plus S10a in one Revised line. Engine activation keeps main's
pre-writer release validation, shared release-event policy and opening-marker
reads, with the neutral metadata/transaction handles. Enum family dispatch now
forwards main's two new activation reads and the release-history reader and
transaction methods. Dormant records use main's neutral home, and obsolete
SQLite release-event bridges were removed. Main's explicit unknown change
evidence is retained.

The experiment uses main's `Store::use_full_synchronous()` and
`Store::sqlite_version()` methods; the duplicate evaluation methods were
removed. The per-file minimums of both store-port allowances match the rebased
files: zero production sites and 95 fixture sites before regeneration.

The census now reads both complete crate source trees for import/export and
type-alias declarations, including `lib.rs`. It flattens grouped imports and
follows renamed concrete types through aliases. Only the existing canonical
`pub use store::Store` export is allowed; additional concrete exports from the
adapters also count. Exact `RuntimeError::Store` and `wasmi::Store` exemptions
refuse shadowing imports; generic `Error::Store`, `Error::Tx` and `Self::`
exemptions are gone. The host's private run-admission wrapper variant is named
`Runtime`, preserving its payload, Display text and retry behavior. Regression
fixtures flag the review's module rename and renamed public export, grouped
imports, crate aliases, type aliases and a hidden adapter alias exported under
another name. Test-only fields/variants stop at their own delimiter rather than swallowing
the following production impl; regression fixtures cover nested generic field
types, visibility and const comparisons. Filename filtering follows explicit test filename conventions,
so production names such as `contests.rs` remain in scope. This remains a
conservative lexical guard, without a claim to resolve arbitrary generated Rust.

The member-facade source guard complements the existing compiled negative
surface test. It checks private fields and return types in MemberTx impls throughout the
core source tree, including the forwarding macro's declarations. Mutation
fixtures prove that `pub`, `pub(crate)` and `pub(super)` fields and arbitrary
getters returning borrowed neutral or SQLite handles fail the guard.

Read-only census snapshots (no checkout changes):

| Source and matcher | Count / files |
| --- | ---: |
| Rebased main `4575a14e95`, original spelling matcher | 123 / 37 |
| Rebased S10a before fixes, original spelling matcher | 0 / 0 |
| Rebased main, strengthened tokens/declarations matcher | 143 / 39 |
| Fixed S10a, strengthened matcher | 0 / 0 |

The strengthened count includes import/export declarations beyond the original
engine/host roots, so its nonzero total is a different measure. Both review
bypasses are exercised as failing fixtures; the production zero has no raise
allowance.

The broader facade walk also exposed an inherited lexer skip bug: a
`#[cfg(test)]` field could consume the following production impl. Test fields
and enum variants now stop at their own delimiters, preserving subsequent
production tokens. Fixtures cover private/crate-visible fields, nested generic
commas, const-generic comparisons, function-pointer types, variants and
test-only const comparisons. The facade walk covers the
complete core source tree, so another implementation file cannot hide a getter.
The isolated facade rerun and all 14 ratchet/census tests pass.

The full 127-test guide suite found missing hand-reviewed definition/action
pins for main's `E_STORE_UNSUPPORTED` and `E_STORE_GENERATION`, plus absent local
client outputs. The two pins now quote the existing `why` definitions and
recovery boundaries. The failing guide cases were rerun individually. Frozen
Bun installation, the repository wasm build and the full client build restore
the generated local assets; no lockfile or generated output is committed.
The final guide suite passes **127/127**, and the codec census passes **27/27**
again against the generated asset tree. The additional wasm build passes at
**2,403,594 raw / 733,810 gzip bytes**, within the unchanged **734,193-byte**
budget. All Cargo commands use the lane-owned target and ten jobs; the wasm
script uses its existing size profile.

Final fix-round qualification:

| Check | Result |
| --- | --- |
| `cargo build -p snapback4` | Pass |
| Core `--no-default-features` check | Pass |
| Device web/wasm `--no-default-features --features web --target wasm32-unknown-unknown` check | Pass |
| Full core suite and doctests | **1,037 passed / 0 failed / 5 ignored** |
| Full host suite | **1,404 passed / 0 failed / 15 ignored** |
| Full device suite | **1,573 passed / 0 failed / 4 ignored** |
| Ratchets and census, final source | **14 passed**, concrete census **0/0**, committer **49/11**, store-port **0 production / 95 fixture sites** |
| Full guide suite | **127 passed / 0 failed** |
| Wasm codec census | **27 passed / 0 failed** |
| `scripts/test-postgres.sh` | **58 experiment + 188 family + 19 corpus tests passed**; existing named corpus exclusions retained |

All three supplied host baseline failures pass in this run:
`w11r1c_toolchain_why_explains_node_start_failure_too`,
`farm2_typescript_7_is_refused_by_version_not_crashed_on`, and
`web_witness_help_and_invalid_input`. No other host failure required an
isolated rerun. The transient facade failure and the two guide failures were
rerun alone and corrected; final complete affected checks pass. Initial
compilation attempts exposed the missing rebase forwarders, the stale report
record path and a test-only error-variant reference; these were corrected
before the qualified full runs above.

The only private cluster created in this fix round was
`/tmp/sb4-pg-eval.50psnR`. The script stopped it and confirmed status 3/no
postmaster.pid; an independent post-script `pg_ctl status` check again returns
**3**, with **no postmaster.pid**. Its data is retained for inspection. No
existing cluster was stopped.

Final root `./ref-check` passes: **564 LLP documents / 11,631 references /
0 errors / 0 unchecked**. `git diff --check` passes. The fix remains local,
with the requested author/committer identity and co-author trailer.
