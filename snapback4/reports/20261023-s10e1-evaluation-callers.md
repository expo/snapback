# S10e-1: evaluation callers over the common Engine

Date: 2026-10-23
Branch: `sb4-pg/s10e1`
Base: `addf5750eba0264125da405fb1f246e52ddf19fd`

Ordinary corpus, difftest setup/preludes/replay, Postgres experiment and
commit-path/scale callers now execute common `Engine` policy over Postgres
`AnyStore`. `PostgresEngine` remains compiled and callable as the explicit
comparison oracle. **No executor deletion or complete-parity claim.**

The governing context is LLP 3000 (the Snapback 4 fence, in foundation), LLP
2000.000 (one interpreter and runtime metering), and the current
[store-port RFC §3.4/§9.1](../../llp/3000.009.001.000-the-postgres-store-port.rfc.md#34-one-engine-over-both-stores):
shared semantic policy, exact overlap, named unsupported capabilities, terminal
adapter errors, ordered bounded operations and separate C1 call evidence. This
is the llp-orient context pack for evaluation callers; no app authoring surface
changes. The RFC contains the implementation note and deletion checklist.

## Corpus overlap

All 295 serialized cases were visited by every executor. The supported
intersection has identical recorded full query/mutation outcomes, refusals,
continuations and logical meters; there were **zero trace disagreements**.

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
   [a follow-up ticket](../../issues/20261023-snapback4-store-oracle-fixed-seed-refusal-expectations.md)
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

## Checks and cleanup

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
