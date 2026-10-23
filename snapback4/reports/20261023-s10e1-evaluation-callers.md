# S10e-1: evaluation callers over the common Engine

Date: 2026-10-23
Branch: `sb4-pg/s10e1`
Base: `addf5750eba0264125da405fb1f246e52ddf19fd`
Fix round 1 starts at `e8fe7857e1645a453b1589d53c21afe91861c43e`.

Fix round 2 below supersedes the earlier comparison-gate claims and cleanup
locations. Earlier runs remain historical migration evidence; serialized traces
did not include the two serde-hidden flags, and mismatches did not fail the gate.

Ordinary corpus, difftest setup/preludes/replay, Postgres experiment and
commit-path/scale callers now execute common `Engine` policy over Postgres
`AnyStore`. `PostgresEngine` remains compiled and callable as the explicit
comparison oracle. **No executor deletion or complete-parity claim.**

The governing context is LLP 3000 (the Snapback 4 root and fence), LLP
2000.000 (one interpreter and runtime metering), and the current
[store-port RFC §3.4/§9.1](../../llp/3000.009.001.000-the-postgres-store-port.rfc.md#34-one-engine-over-both-stores):
shared semantic policy, exact overlap, named unsupported capabilities, terminal
adapter errors, ordered bounded operations and separate C1 call evidence. This
is the llp-orient context pack for evaluation callers; no app authoring surface
changes. The RFC contains the implementation note and deletion checklist.

## Corpus overlap

The initial run visited all 295 cases with every executor and reported zero
serialized-trace differences. Its print-only mismatch path and serde-hidden
fields did not establish full typed parity. Fix round 2 replaces that gate;
its results below govern the current comparison claim.

| Executor | Corpus cases | Passed | Unsupported | Skipped | Failed |
|---|---:|---:|---:|---:|---:|
| SQLite Engine | 295 | 210 | 0 | 85 | 0 |
| Common Postgres Engine, prefetch on | 295 | 207 | 0 | 88 | 0 |
| Common Postgres Engine, prefetch off | 295 | 207 | 0 | 88 | 0 |
| Old PostgresEngine, prefetch on | 295 | 207 | 0 | 88 | 0 |
| Old PostgresEngine, prefetch off | 295 | 207 | 0 | 88 | 0 |

The 85 original semantic skips remain: legacy asset record 10, legacy asset
upload 15, legacy delivery 19, legacy nullable point 2, legacy word search 7,
receipt authority 14, receipt coverage 15, receipt replacement 1, shared effect
ID supply 1 and static resource price 1. The three additional Postgres skips
remain the named asset-capability exclusions: `asset-optional-clear`,
`asset-row-delete-mutation`, `asset-video-duration-member`. No skip was removed.

Ordinary corpus runs select SQLite and common Postgres. Set
`SNAPBACK4_CORPUS_OVERLAP=1` for the five-executor matrix. Cases now drop only
the namespace they successfully created, after dropping their engine connection.
A real four-arm ownership smoke verifies the final namespace cleanup path.

`corpus-overlap2.log` records 19 Rust tests passing, including the complete
matrix (1,122.92 seconds). A local temporary shell wrapper reported a parse
error **after** Rust completed, because its file had been edited while the
child ran. Its EXIT trap still stopped the cluster; independent status and PID
checks confirmed shutdown. The final ownership smoke passed with the corrected,
immutable wrapper. The routine private runner separately passed the 295-case
SQLite/common-Postgres target.

The dedicated three-executor overlap also passes on both prefetch settings:
24 writes, 24 identified replays, 48 reads and six refused/rolled-back mutations
per setting. It compares all three stores' final rows, durable receipt bytes
and binding fields, public commit/log order, replies and meters. The existing
experiment fixture separately compares defaults, maintains, rules, effects,
rollback, replay and cursor behavior. All 218 adapter/oracle family tests pass.

## Every observed difference and its disposition

1. **Equal supplied IDs can charge different heap.** The original C1 pair
   returned identical `add` outcomes except heap 1,969/1,979 B. The reduced
   case needs one room, one existing item and a formatted supplied ID. Its ID
   has length 15/capacity 20; moving it versus cloning it charges 1,939/1,929 B.
   The reduced case reproduces with **prefetch on in both engines**. The common
   member moves the context; the retained evaluator clones each attempt.
   Spare ID allocation reaches retained-image charging twice. This is a
   common-engine allocation-sensitive meter bug, not a prefetch result or SQL
   call-count bug. The original and reduced exact assertions remain red;
   [the open ticket](../../issues/20261023-snapback4-unified-postgres-prefetch-add-heap-meter.md)
   preserves the reproduction. No input/output normalization or wider allowance.
2. **Read-through evolution exceeds the common release profile.**
   `activation_is_atomic_and_old_connections_cannot_write_the_new_generation`
   and review scenario `expiry_default` receive explicit
   `E_STORE_UNSUPPORTED`, family `release-activation`, where the old executor
   accepts the schema change. Common Postgres currently admits maintained-column
   evolution only. The migrated assertions stay visible, and the original
   fixtures are retained under explicit `oracle_*` targets: 7/7 and 30/30 pass.
   This support gap must be dispositioned before deletion; no new admission was
   added to either executor.
3. **Two fixed store cases require time publication.** The common profile
   explicitly refuses them. They are recorded as
   `postgres-unsupported:E_STORE_UNSUPPORTED:time-publication`, outside passed.
   Stable typed classification omits transport diagnostics; SQL/setup errors
   retain their complete diagnostic chain. The corpus's pre-existing skips
   remain separate from these difftest unsupported outcomes.
4. **Common mutation calls exceed the old oracle.** Warm identified increments
   make 24 versus 19 driver calls. The five calls are the owner fence, member
   save/release, placement lookup and separate receipt insert/bind work. The
   batched tail remains one CTE exchange. Query counts match; physical totals
   are recorded below and are not logical parity failures or claims that the
   old total call count was preserved. S10e-2 needs an explicit disposition.
5. **Serializable oracle failures still reproduce.** The original contention
   stress case passed once with 96 retries, then reproduced `40001` at its
   mutation unwrap (now line 294; originally line 244). The retained refused-
   receipt Serializable race also reproduced `40001`. Common serial contention
   and both common receipt races pass. No common-engine Serializable claim or
   production retry authority was introduced.
6. **The fixed-seed refusal expectation guard is red.** SQLite and Postgres
   agree, with no store signatures, but the existing guard labels six E_INPUT
   and one E_DIV_ZERO unexpected. Deterministic examples are seed 4's argument
   outside `int 1..1` and seed 15's division by zero. The guard remains exact;
   [a follow-up ticket](../../issues/closed/20261023-snapback4-store-oracle-fixed-seed-refusal-expectations.md)
   records the inputs. Broadening all allowed E_INPUT errors would conceal
   future regressions and was not done. The new unsupported-accounting assertions
   execute before that guard and pass.

The initial reset failure at seed 1 was a **harness adaptation error**, now
fixed: the old evaluator read `_backend`; common opening reads `_generations`.
The harness now prepares the schema through common policy, atomically replaces
both compiled catalogs on its restored empty snapshot, and invokes normal
common opening/activation to refresh derived metadata. Fresh/restored byte
comparison includes seed 1 and passes. A mismatched old-version error-message
assertion was changed to the common engine's typed E_STORE_UNSUPPORTED contract;
the v1/v2 refusal fixture passes. No product behavior was changed for either fix.

## Difftest and C1 evidence

Fixed campaign: seed 0, 32 cases, one worker, both prefetch settings, 254,791
executions, no generator/setup errors and no store signature. Each Postgres arm
records 787 probes: 785 passed and two unsupported. Both prelude modes pass
six probes. SQLite mutation repeat passes 50,263 probes. The campaign exits
nonzero on the refusal expectation guard described above.

The 33-case integration witness (32 seeds plus its extra insertion) separately
records 810 probes per Postgres arm: **808 passed + 2 unsupported**, zero
signatures; each prelude mode passes six. Unsupported is never counted as passed.
The diagnostic rerun confirms the exact stable time-publication key, without
observer EOF text. Two-worker/serial report equivalence and prefetch consumption
witnesses pass. Existing stored/shrunk fixtures were preserved and replay/reset
paths remain covered by the library and smoke targets. Explicit unset and
unreachable database probes both fail before reporting successful work.

| Physical workload | Common PG | Old oracle | Prefetch |
|---|---:|---:|---|
| Warm derived page, eight reachable rows | 20 | 20 | off |
| Warm derived page, eight marked reads | 23 | 23 | on |
| Identified increment, cold paired fixture | 30 | 24 | either |
| Identified increment, warmed paired fixture | 24 | 19 | either |
| Fixture successful add, initial prepares | 34 | 25 | either |
| Fixture refused add, after successful add | 27 | 22 | either |
| Fixture unauthorized revise | 20 | 15 | either |
| Fixture authorized revise | 28 | 23 | either |
| Fixture remove | 28 | 23 | either |
| Fixture unauthorized add | 19 | 14 | either |

Counts include explicit driver calls, cold prepares and transaction control;
they omit implicit rollback on dropped errors and are not packets. The common
32-room inbox retains **8 on / 68 off** warmed calls. Exhaustive comparisons
pass at 7,418 ordinary precharge positions and 19,265 write-loop positions.
Physical speculative work stays inside the original C1 bound; no allowance was
changed. The separate scale capture, with a different prepared-session history,
records 33 cold then 24/24 warm calls and contains the single tail CTE.

The scale sampler now follows the exact common-engine owner tag and excludes
sessions that existed before measured writers opened. The short debug on/off
cells retain every acknowledged increment (70/70 and 66/66), each with 24 calls
per warmed operation and nonempty wait samples. The 20-iteration experiment
also completes its SQLite/Postgres serial concurrency cells. These are workload
and call-count smoke results under shared-host load, **not throughput claims**.
Historical statement-model cells retain their recorded evaluator protocol and
calibration; no historical measurement was relabeled as a common-engine result.

## Evaluation home and S10e-2

`engine/evaluation.rs`, behind `evaluation-support`, owns common-engine
constructors, prefetch, meter precharge and the statistics API. The opaque port
forwards physical configuration and SQLite snapshots. Physical counters live
in `postgres/statistics.rs`, with the old oracle re-export retained. Common
retry count is zero; Serialized is supplied by the common serial committer.

Serializable stays on the retained oracle pending the RFC's evaluation-only
configuration/driver: deterministic context replay, bounded abort retries,
transaction/attempt reset, no positive serving lease, no production Command
retry authority, and ambiguous COMMIT always terminal.

The RFC's exact deletion checklist requires disposition of the differences,
real-Postgres replacement Serializable fixtures, porting remaining family tests,
removal of only duplicate PostgresEngine policy and oracle-only helpers, and
replacement corpus/replay/C1/SQLite/device/absence evidence. Keep the physical
adapter, ownership, prefetch, tail, codecs, family SQL and regression inputs.
**The evidence does not yet authorize deleting the second executor.**

## Initial checks and cleanup (before fix round 1)

| Check | Result |
|---|---|
| `cargo build -p snapback4` | Pass |
| `cargo check -p snapback4-core --no-default-features` | Pass |
| `cargo test -p snapback4-core --no-fail-fast` | Pass: 665 library tests, 44 integration targets, 27 doctests; existing ignores retained |
| Full five-executor corpus | Pass: 19 Rust tests; post-test temporary wrapper error and confirmed cleanup recorded above |
| Final corpus namespace ownership smoke | Pass on common/oracle, on/off |
| Postgres adapter/oracle family target | Pass: 218 tests, including stronger stored evidence and C1 comparison |
| Difftest library / smoke | Pass: 5 / 29 tests |
| Difftest stores | 2 pass; expectation guard red, zero store signatures; stable classifier rerun described above |
| Fixed `run-stores` campaign | All 32 complete; zero signatures/setup errors; nonzero refusal guard |
| Migrated experiment | Device 1/1, key limit 2/2; read-through 6/7 and review 29/30 (release-activation refusals); C1 exhaustive sweeps pass |
| Retained read-through oracle targets | Pass: 7/7 and 30/30 |
| Final focused conformance | 16 pass; two heap regressions and two Serializable oracle cases red; three expensive, previously passed sweeps not repeated |
| Experiment executable, 20 iterations | Pass, including serial SQLite/Postgres concurrency |
| Scale/eval `--features rt5` all-target check and capture/on/off smoke | Pass |
| `bash scripts/test-postgres.sh` | Nonzero: the experiment reds, preliminary compile/assertion/reset errors repaired and rechecked separately, and a 45-second public CLI deploy guard |
| Root `./ref-check` | Pass: 565 LLP docs, 11,772 refs, zero errors/unchecked |
| `git diff --check` | Pass |

No reservation-fixture red appeared in the full core run. The full CLI test
suite (including `web_witness_help_and_invalid_input`) was not added to these
requested checks. The public-stage 45-second timeout remains a recorded red;
no timeout was expanded. The known Serializable red remains on the oracle.

Only the authorized warm `snapback4/target` and six Cargo jobs were used. Source
timestamps refresh shared-workspace identities; pre-existing target artifacts
were not cleaned and no target copy was made. No stash, push or Git config
change. Disk guards never reached 40 GiB free. PostgreSQL 17 on port 55440 and
clusters started by others were untouched.

Logs, reports, call captures and per-run PID identities are under `/tmp/s10e1/`.
The independent `cleanup.json` audit checks 4,237 recorded process identities:
**none living**. All **17 owned clusters** return pg_ctl status 3, with no
postmaster.pid; their data is retained. Later reference/check commands start no
servers. Final PID audit is repeated before handoff.


## Fix round 1 — 2026-10-23

The lead's no-new-red rule governs this round. The cold rebuild uses only this
lane's target, `-j 6` / `CARGO_BUILD_JOBS=6`, with
`CARGO_PROFILE_DEV_DEBUG=line-tables-only` and
`CARGO_PROFILE_TEST_DEBUG=line-tables-only` on every Cargo invocation. The base
probe alone uses a separate scratch target; no object files or target links are
shared. No allowance, retry budget, durability setting or timeout is raised.

### 1. Heap charge: authorized ticket-ignore fallback

`Value::retained_heap` charges `String` and `Id` by `capacity()`, including
nested row images; `Runner::expression_heap` forwards that shared price on
SQLite and both Postgres executors. A change there is not a local prefetch
repair. Existing SQLite pricing tests explicitly pin 256-byte retained
Strings/Ids of length 0/3/100 and a nested String's 128-byte allocation. Both
pins pass in the full core run. This round preserves that meter contract and
uses the lead's allowed fallback: the original and reduced fixtures carry
`#[ignore = "issues/20261023-snapback4-unified-postgres-prefetch-add-heap-meter.md"]`.
Their exact assertions and inputs remain intact; the issue remains open.

The private runner's `--include-ignored` cluster sweep explicitly excludes just
these two ticketed names. Running the issue's reproduction with
`--include-ignored` still executes the original failing assertion. No outcome
normalization, cloning workaround, meter baseline update or wider allowance.
Both RT0 JSON tables are byte-for-byte unchanged.

### 2. Release evolution: named expected-unsupported

The migrated read-through adoption fixture is now
`expected_unsupported_release_activation_read_through_evolution`; the review
fixture is `expected_unsupported_release_activation_expiry_default`. Both assert
`RuntimeError::StoreUnsupported { family: "release-activation" }` exactly.
They verify generation/rows or reads remain unchanged after refusal. The former
also preserves the SQLite positive/negative evolution control and verifies an
old connection still reads the unchanged generation. The latter uses the same
source helper as the original review scenario and tries both default deadlines
and adoption clocks.

These are refusal-contract witnesses: **zero supported evolution passes**,
with two and four named expected-unsupported attempts respectively. Admission of
this family makes them fail loudly. The original `oracle_read_through` and
`oracle_read_through_review` scenarios remain; they are the future conformance
expectations when the family is admitted.

### 3. Fixed-seed guard: base compile blocker, precise classification

An actual detached worktree at `addf5750eb`, with a separate cold target and
private socket cluster, attempted the exact
`both_stores_all_public_boundaries_and_write_observations` test. It could not
execute: E0308 at `store_database.rs:267` and `:270` passes `&AnyStore` to the
old snapshot API expecting `&Store`. The probe therefore supplies **no runtime
proof that this guard was red at base**. Its compile log is retained, and its
cluster, worktree and target were removed immediately afterward.

Although the generator and refusal list are unchanged at base, migration's
snapshot adaptation makes the guard reachable. This round takes responsibility
for the newly reachable red. It classifies only (a) a supplied integer `a`
outside its declared `arg_bound`, with the exact matching `a must be int ...`
diagnostic, and (b) a generated scalar rounded division whose literal/supplied
integer divisor is zero, with the exact division-by-zero diagnostic. There is
no general E_INPUT allowance and no new unsupported exclusion. Negative unit
controls reject a different input diagnostic, an in-range value, an unbounded
argument, and a nonzero divisor. Refusal counters and exact outcome comparisons
remain intact.

### 4. Additional Serializable race

The retained `evaluator_racing_refused_operations_replay_one_receipt_without_advancing_head`
fixture uses the same ignore reason as the original evaluator stress case:
`issues/20260916-snapback4-postgres-serializable-benchmark-failures.md`.
The cluster sweep excludes this additional oracle red, preserving the common
serial receipt race and the existing oracle mismatching-receipt race. The
original evaluator increment/duplicate-operation stress remains enabled, with
its original internal writers and retry budget. No retry implementation changes.


### 5. Public 45-second guard: three standalone runs

All three complete standalone public stages pass, with the existing 45-second
command timeout unchanged. This lane runs no competing build/test during them;
other lanes compile concurrently on this 12-CPU host. First-run snapshots name
`sb4-p0-s8` and `sb4-rt12f2`. Sampled 1-minute load ranges are 7.46–11.47,
6.58–8.39 and 2.45–7.07 across the three stages.

The following are cumulative seconds after spawning each initial P1-CE Postgres
deploy. Filesystem checkpoints are sampled every 20 ms and at exit, so they are
upper-bound observations rather than internal function timers.

| Run | Intent | Binding | Candidate source | Current pointer | Exit | Program-only redeploy |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 16.561 | 17.518 | 17.558 | 17.702 | 17.735 | 0.204 |
| 2 | 16.554 | 17.798 | 17.859 | 18.005 | 18.026 | 0.213 |
| 3 | 16.249 | 17.019 | 17.059 | 17.202 | 17.220 | 0.225 |

Each complete stage executes 241/242/243 recorded subprocess commands, in
addition to HTTP requests. Maximum command times are 17.768/18.026/17.220
seconds. P1-CE's two-store byte comparison, bootstrap recovery/refusals,
ownership takeover/restart, program release and P1-MC recount all pass.
Postmasters 2849950, 2861387 and 2873935 are stopped and confirmed gone, as are
all recorded command and serving PIDs. Each owned scratch tree is removed.

**Finding:** a real, reproducible preflight costs 16.2–16.6 seconds before
bootstrap; load alone does not explain it. Inference from call order: configured
deploy runs `security::release_loop`, whose report uses a 1,500-work campaign,
before creating bootstrap intent. The same cost precedes candidate staging on
recovery and SQLite's initial deploy, while program-only redeploy is fast.
This identifies the preflight for profiling, not a proved internal bottleneck.
The historical 45-second timeout did not reproduce; the old run has no load
snapshot, so its cause remains unresolved. The
[open evidence ticket](../../issues/20261023-snapback4-public-postgres-deploy-45-second-guard.md)
retains both earlier lane reports, phase/load evidence and the profiling scope.
No timeout, security campaign or product command behavior changes.


### Final checks and red-test disposition

| Check | Fix-round-1 result |
|---|---|
| `cargo test -p snapback4-core --no-fail-fast` | Pass: 665 library tests, all 44 integration targets, 27 doctests; existing ignores retained |
| Complete Postgres experiment | Pass: 97 Rust tests; conformance 20 pass/3 ticketed exclusions; device 1, key-limit 2, retained oracles 7/30, migrated targets 7/30 |
| Supported migrated evolution denominator | 6 + 29 supported scenarios; two separate expected-unsupported witnesses, six refusal attempts, zero supported evolution passes |
| Exhaustive C1 cut sweeps | Pass: 7,418 ordinary and 19,265 write-loop positions; no allowance change |
| Postgres adapter/oracle family target | Pass: 218 tests |
| Other stock Postgres stages | Pass: evidence 12, literal 8, ownership 25, handle 1, docs 38, committer 2, maintained members 1, commands 13, four selected HTTP/startup/RT0 targets |
| Standard corpus | Pass: 20 Rust tests; all 295 cases visited per arm, SQLite 210 pass/85 skip, common PG 207 pass/88 skip; no failure or new exclusion |
| Postgres difftest library / stores | Pass: 6 / 3; exact fixed-seed guard, zero signatures and named unsupported accounting pass |
| Focused classifier positive/negative controls | Pass: 1 test |
| `bash scripts/test-postgres.sh` | **Pass, exit 0**, including the final public stage; its known base Serializable stress also passes |
| RT0 Postgres / SQLite | Pass: all 12 warm rows exact on each store; both JSON SHA-256 values match the original table bytes |
| SQLite/memory read-through review fixtures | Pass: 35 tests, including the shared original expiry-default scenario |
| Difftest smoke | Pass: 29 tests |
| Three standalone public stages | Pass: 3/3, unchanged 45-second guard, phase/load evidence above |
| Root `./ref-check` | Pass: 565 LLP docs, 11,773 refs; zero errors/unchecked |
| `git diff --check` | Pass |

**Complete executed red-test list: none.** The sole permitted base stress red,
now named `evaluator_concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`,
passes this run with 65 increments in each mode, no lost updates, zero Serialized
retries and 113 Serializable retries. Its 40001 is documented at base under the
old unprefixed name; the issue stays open and a recurrence still fails the runner.
No retry cap, backoff, durability, workload or assertion changed.

The deliberately excluded reproductions remain outside passed:

| Test | Final disposition | Base relationship |
|---|---|---|
| `prefetch::prefetch_complete_fixture_queries_mutations_and_hidden_rows` | Exact assertion preserved; ticket-ignore | Newly exposed by common-engine migration; the old evaluator's context clone masks spare capacity |
| `prefetch::unified_add_spare_capacity_meter_overlap_regression` | Exact reduced assertion preserved; same ticket-ignore | New regression, absent at base |
| `evaluator_racing_refused_operations_replay_one_receipt_without_advancing_head` | Same Serializable issue ignore as stress; excluded from cluster sweep | Newly named retained copy beside common serial replacement; the original body exists at base, but its base 40001 was not separately established |

The fixed-seed guard is **enabled and passing**, not excluded. The actual base
probe failed compilation, so this report makes no claim that it was a proven
base runtime red. Its precise classification resolution is recorded in the
[closed ticket](../../issues/closed/20261023-snapback4-store-oracle-fixed-seed-refusal-expectations.md).
Release evolution is explicitly unsupported, not a supported conformance pass.
The second executor remains; this round grants no deletion or full parity claim.

### Final cleanup and evidence custody

The final independent audit covers **6,838 recorded PID identities**, including
the earlier lane's 4,237. No recorded PID (including zombies) and no program
executing from this target remains. All **23 owned clusters** (17 previous + six
this round) were stopped and confirmed before removal. Fix-round postmasters
2814097, 2849950, 2861387, 2873935, 2891688 and 3061940 are gone. All corresponding
data/fixture directories, the base worktree/target and old `/tmp/s10e1` scratch
are removed. PostgreSQL 17 on 55440 and all other lanes' clusters are untouched.

Evidence now lives under `snapback4/target/s10e1-fix1/`: `core.log`,
`base-guard.log`, `refusal-classifier.log`, `postgres-all.log`,
`sqlite-rt0-and-fixtures.log`, `public-{1,2,3}.{log,timings.jsonl,host.json,cleanup.json}`,
`public-summary.json`, `postgres-all.public-cleanup.json` and
`final-pid-audit.json`. The previous `/tmp/s10e1` evidence is archived as
`previous-evidence.tgz`; no cluster data is retained there. These are local
review artifacts, not publication evidence.

Cargo emitted shared-registry permission warnings during the cold builds;
no cache repair was attempted, and automatic cache cleanup was disabled for
subsequent commands. The temporary Cargo cache setting was removed. No Git
configuration change, stash, push, baseline update or unrelated deletion.
Disk guards never reached 40 GiB free; final sampled free space is 162 GiB.


## Fix round 2 — 2026-10-23

Starts at `9766d2ffe136f9584e2fef903f16fd81949bbf3f`. Both blind reviews
(`/tmp/s10e1-review-sol.md`, `/tmp/s10e1-review-grok.md`) required changes.
This round changes comparison and evaluation harnesses, preserves the shared
engine's meter and leaves both RT0 tables byte-for-byte unchanged.

### Failing-on-old witnesses

Fault probes temporarily instrumented the existing targets without replacing
their assertions, compiled them once per source revision, and ran the resulting
Rust test binaries. Corpus probes restricted input to
`edge-i53-add-boundary.json` and `named-delete-message.json` (one supported
query and mutation), with all five executors enabled. Each probe altered only
the common Postgres observation. All temporary instrumentation was removed
before qualification. Raw logs and probe drivers stay outside Git under
`/tmp/s10e1-r2/`.

| Item | Witness | Unfixed `9766d2ffe1` | Fixed |
|---|---|---|---|
| 1 | Increment query `heap_bytes` by one | Rust exits 0 despite `DISAGREEMENT`; failure-detection witness fails | Rust exits 101, overlap assertion |
| 1 | Set query `pending_opening` to a sentinel | Rust exits 0; no serialized difference | Rust exits 101, typed overlap assertion |
| 1 | Toggle mutation `receipt_only` | Rust exits 0; no serialized difference | Rust exits 101, typed overlap assertion |
| 2 | Force create `StoreUnsupported { family: "release-activation" }` | Rust exits 0, unsupported bucket | Rust exits 101, conformance failure |
| 2 | Force create structural `E_VIEW_KEY` | Rust exits 0, unsupported bucket | Rust exits 101, conformance failure |
| 3 | Change only replay sequence, heap meter, or receipt-only flag | All three Rust runs exit 0 | All three exit 101 at full outcome equality |
| 3 | Append one query `tables` entry | Rust exits 0 | Rust exits 101 at full query equality |
| 4 | Substitute 12 for warm inbox prefetch-on calls | Runner's old skip selects zero tests and exits 0 | Enabled query fixture exits 101 at the original `<10` bound |
| 5 | Drop a snapshotted `r` table before reused setup | Regression test fails its ten-second receive bound | Passes in 0.72 s, returning `SQLSTATE=42P01` and statement context |
| 6 | Require actual package clean at each manifest handoff | Shell contract witness exits 1: only `touch` is called | Exits 0: exact scoped clean commands for both manifests |

Unmodified control cases pass before and after the corpus fault probes. These
are negative controls: exit 0 on injected differences is the **failed witness**,
not evidence of parity. Corpus now compares typed query/mutation/refusal
observations (including `receipt_only`/`pending_opening`), records overlap
failures separately, and asserts none. The stock runner explicitly sets
`SNAPBACK4_CORPUS_OVERLAP=1`. Conformance totals remain separate from overlap.

The named corpus unsupported-family/count allowlist is empty: this corpus has
zero expected unsupported families on every executor. Only an exact typed
family entry could authorize a future exclusion, and the complete observed map
must equal the declared counts. Other codes/families are failures. Unit
controls also cover time-publication, unknown families, all three formerly
blanketed structural codes, and transport errors.

The explicit oracle uses full `MutationOutcome` equality for first writes,
refusals and identified replays, and full `QueryOutcome` equality for reads.
Receipt checks retain complete stored bytes/bindings, project `receiptOnly`
explicitly, and compare deterministic `at=1000` on all three stores. A small
unit-test-only snapshot accessor keeps raw receipt inspection in the existing
fixture boundary. There is no production receipt API change.

The 32-room query/hidden-row portion has its own cluster-enabled fixture,
separate from the ticketed exact heap mutation reproduction. Both original C1
bounds remain unchanged: prefetch-on `<10`, prefetch-off exactly `68`.
Diagnostic drop now cancels a pending accept, wakes the listener and closes a
saved downstream socket if startup is incomplete; shutdown also retains the
existing upstream cancellation. The forced setup error must return its SQLSTATE
and statement context within ten seconds. Package cleaning replaces source
mtime changes at both workspace handoffs, limited to core/lang/device dev
artifacts in this lane's target directory. A pre-clean handoff actually produced
duplicate `serde_json`/`QueryOutcome` type identities in difftest compilation;
it was a build-artifact error, not a product comparison failure.


### Qualification and remaining reds versus base

The full core command passes (665 library tests, unchanged three library
ignores, all integration targets and 27 doctests). The complete default difftest
command passes. Postgres difftest passes all seven library tests and all three
store integration tests, including exact unsupported accounting. Both RT0
ratchets pass all twelve warm rows exactly; their JSON files are unchanged.

The private sweep re-enables the original retained-evaluator Serializable
stress, and it reproduced `40001` at the unchanged `conformance.rs:294` unwrap
(two concurrent writers), followed by its parent join failure. This is the
existing [Serializable ticket](../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md)
and the same inherited intermittent red recorded earlier in this report. The
stress source is byte-for-byte unchanged from `9766d2ffe1`; it remains a failing test with its original retry budget and inclusion
policy. Common serial concurrency and
receipt races pass. Final sweep totals and cleanup follow below.


The restored 32-room C1 fixture passes at **8/68** calls (on/off), with the
original `<10` and `68` bounds unchanged. Exhaustive query/cut comparison passes
7,418 precharge positions; the write loop passes 19,265 positions with complete
`MutationOutcome` equality. Conformance totals are 20 passed, one inherited
Serializable failure and the same three ticket exclusions. Device (1), key-limit
(2), retained read-through (7) and retained review (30) targets pass.


The full **typed five-way corpus passes**: all 295 cards per executor;
SQLite 210 passed/85 skipped, and each common/oracle Postgres prefetch arm
207 passed/88 skipped. Every arm has zero unsupported and zero conformance
failures, and there are **zero overlap disagreements**. The complete corpus
Rust target passes 22 tests in 714.20 seconds. Thus the strengthened comparison
exposes no additional natural outcome/meter/refusal difference. The unsupported
allowlist remains empty, and no comparison exception or normalization was added.
All 218 Postgres adapter/oracle tests and the additional family/CLI stages pass,
including full replay/query outcomes, receipt-only and deterministic timestamps.
The migrated read-through (7) and review (30) targets also pass.

An additional minimal cancellation probe verifies that setup has reached
`SQLSTATE=42P01` **before** its cleanup timer starts. It compiles the exact old
`pg_diagnostics.rs` (byte-checked against `9766d2ffe1`) and the fixed module in
one local witness. The old observer then hangs in drop until its five-second
watchdog kills recorded PID 331566; the fixed observer returns the SQL error in
0.006 seconds and PID 331741 exits normally. Both PIDs are confirmed absent.
This separates the cleanup hang from fixture setup latency. The permanent
reused-snapshot regression independently passes its ten-second failure bound
(the standalone full test took 0.72 seconds). Probe source, binaries and logs
are local artifacts only, outside the commit.

### Final sweep and cleanup

| Check | Fix-round-2 result |
|---|---|
| Full core, `--no-fail-fast` | Pass: 665 library tests, all 44 integration targets, 27 doctests; 1,663.02 s including rebuild |
| Complete default difftest | Pass: 99 tests; 295.48 s |
| Postgres difftest library/stores | Pass: 7/3 tests both standalone and in the stock runner; exact unsupported maps and refusal guard retained |
| Experiment targets | 97 passed, one inherited Serializable stress failure; same three ticket exclusions |
| Adapter/oracle family | Pass: 218/218, including full replay/read/receipt/timestamp comparisons |
| Other Postgres stages | Pass: evidence 12, literal 8, ownership 25, handle 1, docs 38, committer 2, maintained members 1, commands 13 and four selected CLI witnesses |
| Five-way typed corpus | Pass: 22 Rust tests, 295 cards per executor, zero unsupported/failures/overlap disagreements; 714.20 s |
| Both RT0 ratchets | Pass: every one of the 12 warm rows exact on each store; JSON bytes unchanged |
| Public deploy/serve/scale | Pass with unchanged 45-second command guard; release, identity, ownership, recovery, restart and P1-MC recount witnesses complete |
| Stock `bash scripts/test-postgres.sh` | Exit 1 solely for the unchanged retained-evaluator `40001` stress; every later stage completed; 2,485.89 s |
| Root reference validation | Pass: 565 LLP documents, 11,774 refs, zero errors/unchecked; local `ref-check.log` |

There are **no newly exposed natural overlap disagreements**, no new ticketed
ignore and no new product-test red relative to base's documented intermittent
stress. The same explicit sweep exclusions remain:

- `prefetch_complete_fixture_queries_mutations_and_hidden_rows` (now the
  mutation-only original reproduction) and
  `unified_add_spare_capacity_meter_overlap_regression`, both on the
  [existing heap ticket](../../issues/20261023-snapback4-unified-postgres-prefetch-add-heap-meter.md).
- `evaluator_racing_refused_operations_replay_one_receipt_without_advancing_head`,
  on the existing Serializable ticket. The original increment stress still runs
  and fails this sweep, rather than being newly excluded.

The default core's three library measurement ignores (two native follow-scale
measurements and the paired word-projection allocation sample) and two
integration scale measurements (`m7_to_m8`, `measure_history`) are unchanged.
The new query/C1 fixture has the ordinary private-cluster annotation and executes
in the runner, outside the ticket skip list. Corpus semantic skips remain the
same 85/88. Existing allocation-sensitive heap, release-activation support and
physical 24/19 warm-call differences retain their earlier tickets/dispositions;
none is hidden by a new comparison projection.

Independent cleanup confirms all **three** owned Postgres clusters stopped:
postmasters 4033244, 127514 and 345676 each have `pg_ctl status=3`, no
`postmaster.pid`, and no remaining postmaster process. None of 2,156 recorded
process identities remains alive; all 251 public witness PID records and both
minimal cleanup-probe PIDs are absent. PostgreSQL 17/55440 was untouched. The
private data directories are retained only as local inspection artifacts:
`/tmp/s10e1-r2/pg`, `/tmp/sb4-pg-eval.BqlfQG` and
`/tmp/s10d3-serve-fruqjug2`. All disk-audit samples remained above the 40 GiB
stop threshold on `/home`; the local audit JSON records its sampled free space.

Evidence is local under `/tmp/s10e1-r2/`: qualification logs/JSON, old/fixed
fault-probe logs and drivers, `cleanup-probe.json`, cluster PID snapshots,
`final-pid-audit.json` and `ref-check.log`. No raw log is committed. Every Cargo
invocation exports the lane's absolute target and line-table-only dev/test
profiles; direct test commands use `-j 4`, and the stock runner inherits
`CARGO_BUILD_JOBS=4`. Scoped package cleans stay inside this target. No stash,
push, Git configuration change, executor deletion, meter change or RT0 baseline
change occurred.
