# K0-Q — owned commands and the serving committer

## Scope and constraints

This lane changes the concurrency structure of the unified serving engine.
The member facade, store adapters, transaction boundaries and receipt format
remain the reference protocol. No `engine/postgres/` or `store_owner*` file is
changed. Governing context: LLP 3000 §7; LLP 3000.009.001.000.000 §§3.1,
3.4, 3.6–3.7, 7 and the K0a–K0d implementation notes; the SQLite diagnosis
under `experiments/scale-controls/results-20261022-snapback-sqlite-diagnosis/`.
These constraints require one writer, owned admission inputs, fresh authority
checks at execution, and acknowledgement after the member continuation.
Batching, optimistic execution, and a persistent internal revision format remain
future work. The existing committer RFC and append-only journal are updated;
no new LLP or gate is introduced. Orientation hand-off: none.

## Original implementation and evidence

The following records retain the original, pre-rebase source identities. The
S10d-2 rebase and its fresh qualification are recorded below.

Original code commits, in order:

1. `40162c1c0b04c486ea2b546446136a64a6039d41` — owned commands and queue.
2. `a61df85636a987b53a7390c9fee086b2720a5931` — serving integration,
   context transfer and concurrency tests.
3. `2f3815f7fee550ab1d0d706149eda14fa3bbbfc5` — unambiguous command/error
   spellings for the unchanged source censuses, with no new allowances.

`Command<T>` owns a `Send + 'static` body; the worker supplies `&mut Engine`.
`Queue` owns the engine and its named thread, a 128-command FIFO mailbox and
one-shot typed result channels. Accepted commands complete even when the caller
loses its receiver. Panics unwind transaction guards and return to the submitter;
the worker remains available. There is no automatic retry or batching.

The serving `Writer` handle replaces production `FairMutex<Engine>` access.
Requests own their operation/context/admission inputs and wait for results.
Credentials are resolved again on the worker, including a fresh authority sample;
KDF work and socket/file I/O stay outside it. Detached reads retain their pool and
schema epochs. Ephemeral programs retain their hub lock and detached durable
snapshot; only memory-only fixtures need the worker fallback. Host activation,
maintenance and remaining serving accesses also cross owned command boundaries.

The unchanged member driver owns each physical COMMIT and runs its engine
continuation before command acknowledgement. Mutation wake publication occurs
on the worker. Generation, developer evidence and timing/trace state cross back
to the request; CPU totals include the worker's actual thread CPU. A full mailbox
refuses HTTP durable submissions and maintenance turns with the existing 503,
E_RATE_LIMIT/limit/retryable refusal and Retry-After: 1. Fixed host control and
inspection calls wait for space in the same bounded mailbox.

## Concurrency evidence

- 48 concurrent queue submitters: explicit member continuations observe COMMIT
  through an independent reader, execute in durable order on one worker, and
  precede acknowledgement.
- Capacity-one mailbox: rejected work never executes; accepted work survives a
  dropped reply receiver; transaction unwind does not lose the worker.
- Concurrent HTTP writers race duplicate operation ids while independent reads
  and ephemeral writes progress. Public sequences, exactly-once receipts and
  replay privacy are checked.
- A deliberately full serving mailbox returns the existing HTTP overload
  refusal and Retry-After, without applying the rejected mutation.

## Local W4 measurement

All four runs use the actual `serve` process, SQLite WAL/FULL on local disk,
32 disjoint counter owners and pre-minted bearer sessions. This is a reduced
W4 fixture (32 counters and one room), 160 warm-up operations followed by three
closed-loop trials of 1,600 operations, without mutation ids. No Cargo build or
suite ran alongside measurement. Each run's independently checked durable total
is **4,960**, and every recorded server stopped.

The table gives the median of each run's three trial statistics, not a pooled
latency percentile:

| Run | ops/s | p50 ms | p99 ms |
|---|---:|---:|---:|
| before | 96.96 | 329.14 | 349.96 |
| after | 95.14 | 335.26 | 362.41 |
| before-repeat | 95.77 | 333.38 | 357.54 |
| after-repeat | 97.39 | 327.13 | 351.33 |

The first pair's throughput moved -1.88%; the immediately adjacent repeat pair
moved +1.69%. The latency differences also reversed. This small local check finds
no consistent regression or throughput lift. It does not resolve a cost of a few percent
or establish an SLO; the flush-per-member ceiling remains. Batching is still
needed to change it.

The before executable was copied from this worktree's existing `target/debug`
path before edits, with checkout at `e7d33f738d4d4adc22a060ee58ce295e8711efbc`;
it was not independently rebuilt for this comparison. The after executable is
the development-profile `cargo build -p snapback4 -j 10` output at code commit
`2f3815f7fee550ab1d0d706149eda14fa3bbbfc5`. This quick comparison against cached baseline bytes does not prove a fresh
build from the base commit or qualify the scale-host 1M-message campaign.

Binary SHA-256:

- Before and before-repeat: `17b57a6eefb1081e59fb945c135cbce5d11aef6f29bb61de508bf24654ef03da`.
- After and after-repeat: `a48c3d229a35a3e3d10dd1587a481e07ab6b4e3a1565815230ba0af0abc2a30f`.

Raw trials and counter/shutdown receipts: [before](./before.json),
[after](./after.json), [before repeat](./before-repeat.json),
[after repeat](./after-repeat.json). The [retained harness](./w4.py) uses the same measurement logic, resolving the
repository root relative to itself.
From `snapback4/`, reproduce with
`python3 reports/20261022-k0q/w4.py /absolute/path/to/binary new-label`;
labels must be unused. [Host metadata](./host.json) records the toolchain.

## Original verification

All Cargo invocations use only this worktree's `snapback4/target`, with ten
compiler jobs. The host reports `expose-builder-nothing`, rustc 1.97.0 and
Node 24.13.1. `/home` remained above the 20 GB stop threshold.

| Check (from `snapback4/`, unless stated) | Result |
|---|---|
| `cargo build -p snapback4 -j 10` | Pass, including final measurement build |
| `cargo check -p snapback4-core --no-default-features -j 10` | Pass |
| `cargo check -p snapback4-device --no-default-features --features web --target wasm32-unknown-unknown -j 10` | Pass |
| `cargo test -p snapback4-core --no-fail-fast -j 10` | Pass, including integration tests and doctests |
| `cargo test -p snapback4 --no-fail-fast -j 10` | Pass, full suite with `RUST_TEST_THREADS=4` |
| `cargo test -p snapback4-device --no-fail-fast -j 10` | Pass |
| `committer_ratchet`, `store_port_ratchet`, `store_handle_census` | Pass, including final repeat; 10 files / 47 durable opener sites |
| `cargo test -p snapback4-core --test store_handle_traits -j 10` | Pass |
| Core doctests (compiled borrow/member/handle guards) | Pass, latest default suite 27 and Postgres suite 38 |
| `cargo test -p snapback4-lang --test guide -j 10` | Pass, 127 tests |
| `cd packages/snapback4 && node --test test/wasm-codec-census.test.mjs` | Pass, 27 tests |
| Requested Postgres script, PG 16 tool/library paths and `/tmp` | Pass |
| Root `./ref-check` | Pass, 564 LLPs / 11,696 references / zero errors or unchecked |

The Postgres script exercised experiment conformance, 209 engine adapter tests,
the compiled handle guard, 38 doctests, two committer cases, the internal HTTP
host witness, and the 19-case unified corpus. Its sole private cluster was
`/tmp/sb4-pg-eval.RhMiDk`. Both script cleanup and an independent `pg_ctl status`
confirmed status 3 and no `postmaster.pid`. No evaluation cluster remains running.

Verification history matters here. An early CLI run was discarded because a
parallel development-profile build replaced the executable used by test-profile
integration tests. The subsequent stable-binary full run passed all integration
targets, including the three supplied baseline cases, but four HTTP unit tests
hit the shared three-second socket timeout under default test concurrency. Each
passed alone with unchanged bounds. The complete repeated suite passed with
four test cases at a time, including 514 unit tests and every integration target. No product code or timeout bound
was changed for these reruns.

The source censuses retain zero concrete handle/driver escapes, the original
member facade and compiled borrow guards, and the unchanged 10-file / 47-site
remaining durable-opener inventory. No guard, allowance or protected ownership
file was relaxed. [Command/status receipts](./checks.json) include the successful
full CLI rerun and the isolated cases.

[Final cleanup check](./cleanup.json): every recorded benchmark PID is gone;
the owned Postgres cluster again reports stopped. No process-name cleanup was used.


## Rebase onto S10d-2

The requested mirror fetched as `8f909dc73438d09f2166f1fd1b538df2d23b5cf8`,
including `49153622a9`. The hostname resolves to the existing origin IP,
`100.65.137.99`. Its first SSH attempt refused the unknown hostname key;
the successful fetch used `HostKeyAlias=100.65.137.99` with strict checking
against that existing known-host identity. No key verification was disabled.
`git rebase FETCH_HEAD` replayed the same four lane commits:

| Original | Rebased | Purpose |
|---|---|---|
| `40162c1c0b` | `2615282aa5` | Owned commands and bounded queue |
| `a61df85636` | `d3cf3d4b90` | Serving integration and concurrency tests |
| `2f3815f7fe` | `a9d0a9d877` | Census-compatible spellings |
| `11d8380c64` | `ba122012f9` | Original qualification and W4 evidence |

`aba2a824b67d6b111586403e4ebb3103c1b32806` adds the ownership integration,
the three real-Postgres queue witnesses, and the corresponding RFC/journal
updates. Committer, author and Co-Authored-By footer retain the requested
identities. Nothing was pushed or stashed.

Conflicts:

- `snapback4/JOURNAL.md`: retained both S10d-2 entries and their qualification
  follow-ups unchanged, then K0-Q's entry. The integration entry is appended last.
- `snapback4/crates/snapback4/src/dev_worker.rs`: retained S10d-2's
  `worker_ledger_path(None)` helper inside K0-Q's `shared.engine.attempt`
  command. This preserves SQLite's identity-derived adjacent filename and
  Postgres's explicit missing-state refusal, while avoiding a request-side
  engine guard. The old SQLite path derivation was not restored.

The fetched S10d-2 RFC/report explicitly leave public Postgres StoreConfig,
release/bootstrap/listener integration and lease cadence to S10d-3. They
provide the acquired-token factory and independent lease primitives, rather
than an already wired public Postgres host. This integration installs those
primitives in the queue and the existing internal Postgres HTTP host; it
makes no public Postgres serving, worker, HA or publication claim.

`17132be1dbf91d8c8a30068452615a5252c4a598` renames the ticket transition from `begin` to
`start_execution`, preserving synchronization while keeping the existing
lexical durable-opener census unambiguous. Its matcher and allowances are
unchanged. The stock Postgres script also repeats all six queue cases, including
the three SQLite witnesses, on this final source.

`07d53b5258` moves the Postgres database-control and fault tests under
`store/`, where adapter test fixtures belong. The queue's Rust module and test
names and shared-port product calls are unchanged; the store-port guard and
both production/test allowances remain unchanged.

### Ownership and outcome behavior

The internal HTTP witness bootstraps, acquires positive token 1, reopens via
`open_postgres_owned`, and installs lease renewal before opening its listener.
Renewal runs on the lease's own connection and a separate named thread;
queue load and a blocked writer COMMIT do not delay it. Shutdown drains
accepted commands before releasing the lease.

Admission and command start share a small registry. Failed renewal latches
ownership loss, stops admission, and immediately returns
`SubmitError::OwnershipLost` to every waiting acknowledgement. Serving maps
it to `E_STORE_OWNERSHIP`, preserving the typed RuntimeError when needed.
Queued bodies later drain without executing. A capacity-blocked control caller
also observes loss without waiting for the active writer. The registry holds
only refusal callbacks; it adds no second command queue or retry policy.

An already running command retains its actual outcome. S10d-2's first
Postgres writer lock and token check remain unchanged and fence writes after
takeover. Physical COMMIT retains zero statement/lock timeouts and is never
cancelled by queue or lease-loss handling. `CommitOutcomeUnknown` crosses
the typed reply unchanged, with no success continuation, retry or overload
conversion. No Postgres adapter or store_owner implementation file changed.

Three new private-Postgres witnesses run in the stock Postgres script:

- Kill precisely the recorded renewal backend, acquire token 2, and refuse
  sixteen queued mutations plus one capacity-blocked caller while the active
  command stays paused. No queued body runs; reopening finds zero rows,
  public commits or receipts. New submissions refuse too.
- Fill the queue while a deferred trigger blocks COMMIT. Observe database
  time beyond the initial lease with a renewed deadline and a refused standby;
  verify both COMMIT timeouts are zero, then release the barrier and obtain
  ordered commits 1 and 2. The lease is released only after queue shutdown.
- Observe the writer blocked in COMMIT, terminate that exact backend, and
  receive `RuntimeError::CommitOutcomeUnknown` through the submitted command.
  Its code, non-refusal classification and disabled retry remain intact;
  the persisted head remains zero in this interrupted-commit case.

The affected LLP audit follows LLP 3000.009.001.000.000 §§3.1, 3.4, 3.7 and 7,
and LLP 3000.009.001.000 §§3.4, 5.1, 5.2 and 5.4.1. The committer's existing
§9 note and single Revised line are updated. No new LLP, guard allowance or
public capability claim is introduced. Orientation hand-off: none.


## Fresh rebase qualification

All Cargo builds used only this lane's `snapback4/target` and ten compiler
jobs. Full core and CLI binaries were compiled at `aba2a824b6`; the subsequent
changes name the admission transition unambiguously and move fault fixtures
inside the store test boundary. Final affected queue/census checks, device,
guide, codec, Postgres script, and measurement build cover `07d53b5258`.
No `engine/postgres/` or `store_owner*` implementation changed in this lane.

| Requested check | Fresh result |
|---|---|
| `cargo build -p snapback4 -j 10` | Pass, including final measurement build |
| Core `--no-default-features` | Pass |
| Device web / wasm32 `--no-default-features --features web` | Pass |
| Full core `--no-fail-fast` | **1,072 passed / 0 failed / 5 ignored**, including 27 doctests |
| Full CLI `--no-fail-fast` | **1,405 passed / 2 census failures / 15 ignored**; all product cases and all three supplied baselines pass; repairs and final scoped repeats below |
| Full device `--no-fail-fast` | **1,573 passed / 0 failed / 4 ignored** |
| Committer/store-port ratchets and handle census | Final **16 / 0 failed**; **10 files / 47 durable-opener sites**, no raised allowances |
| Default compiled handle guard | Pass; Postgres compiled guard also passes in script |
| Guide | **127 / 0 failed** |
| Wasm codec census | **27 / 0 failed** |
| Requested Postgres script | Final complete repeat **exit 0**; initial inherited evaluator failure and exact isolated pass retained below |
| Final queue witnesses | Default SQLite **3 / 0**; final Postgres-feature group **6 / 0** in both full script attempts |
| Root `./ref-check` | Pass — **564 LLPs / 11,708 refs / 0 errors / 0 unchecked** ([receipt](./rebase-ref-check.txt)) |
| `git diff --check` | Pass |

The CLI run's two failed guards were rerun alone. The committer guard passed
after renaming the admission ticket's non-database `begin` to `start_execution`.
The store-port guard reproduced its new PostgreSQL driver import above the
port; the fault tests moved under `store/`. All sixteen guard/census cases
then passed on the final source. No matcher, exemption, allowance, product
expectation or timeout was relaxed. This is a repaired full-run result plus
successful affected repeats, **not a claimed clean full CLI repeat**.
The healthy SQLite queue cases, all six Postgres-feature queue cases, and
all Postgres adapter/member/HTTP/corpus checks repeat after the repairs.

The first complete Postgres command exited 1 only because the retained
evaluator's existing four-writer serializable case exhausted its 32-retry
budget with SQLSTATE `40001` at `tests/conformance.rs:244`. That exact test
and signature are already tracked in the
[open serialization ticket](../../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md).
The unchanged failing binary was retained (SHA-256
`658114e6198ec1b11412f5421a012f2b08bdad489f8ffd4a116a1b7f59bbef7b`).
Running its exact case alone passed: **65 increments in each mode**, zero
serialized retries and **95** serializable retries. Its private cluster was
stopped and independently confirmed.

A single complete script repeat with `RUST_TEST_THREADS=1` passed. The initial
script used four outer test cases at a time. The test's internal **four writers**,
operations, retry limit, backoff, timeouts and durability policy stayed unchanged.
The repeat retained 65 increments per mode with zero serialized and **69**
serializable retries. It passed **58 evaluator + 209 common adapter + 21
ownership + 1 handle guard + 38 doctest + 2 member + 6 queue + 1 HTTP + 19
corpus** cases. Existing named corpus exclusions remain outside the supported
claim. The stress ticket stays open; these passes do not establish a root cause.

The final queue group runs the existing three SQLite witnesses and the three
new Postgres witnesses: all pending callers refused during ownership loss,
renewal during a full queue and blocked COMMIT, and typed unknown COMMIT outcome
at the submitter. Both full Postgres attempts passed this group and all 21
S10d-2 ownership cases on the final source.

Compilation preflights also corrected test-only imports, outcome-field spelling
and fixture-constructor visibility before the passing focused runs. Those
initial attempts and all unabridged transcripts remain under
`/tmp/sb4-k0q-rebase/`. [Command/status and source receipts](./rebase-checks.json)
retain the initial reds, isolated attempts, final affected passes and complete
Postgres repeat. All observed disk readings stayed above the 20 GiB stop rule.
During the cold device build, 57 completed CLI integration-test executables
(16.28 GiB) were removed from this lane's target; their logs and source remained
available. The retained baseline executable was preserved.

## Fresh local W4 samples

The retained harness and reduced fixture are the same as the original check:
32 disjoint writers through real `serve`, SQLite WAL/FULL on local disk,
160 warm-ups plus three 1,600-operation trials. No Cargo build or suite ran
alongside these measurements. Each statistic below is the median of its three
trial statistics, not a pooled latency percentile.

| Run, in execution order | ops/s | p50 ms | p99 ms |
|---|---:|---:|---:|
| Rebuilt binary, first sample | 95.24 | 335.23 | 366.79 |
| Retained baseline, freshly sampled | 98.44 | 324.07 | 350.17 |
| Rebuilt binary, adjacent repeat | 97.08 | 328.67 | 347.50 |

The adjacent pair moves throughput **-1.38%**, p50 **+4.61 ms** and p99
**-2.68 ms**. This small local check shows no throughput lift and no material
latency regression; it cannot resolve a cost of a few percent. The one-flush-per-
member ceiling remains. Every independently checked durable total is **4,960**.

The baseline is the original retained cached executable, SHA-256
`17b57a6eefb1081e59fb945c135cbce5d11aef6f29bb61de508bf24654ef03da`;
it was not freshly built from main. Both rebuilt samples use the final default
`cargo build` output at `07d53b5258`, SHA-256
`85030b54b488af5f743e46558f38956b21552b337bf238bf9cea7e54891e83c7`.
These reduced debug-build samples do not qualify the production 1M-message
campaign or a write SLO.

Raw results: [first rebuilt sample](./after-rebase.json),
[fresh baseline sample](./before-rebase.json),
[adjacent rebuilt repeat](./after-rebase-repeat.json).
[Computed medians](./rebase-measurements.json) retain the binary identities.

## Rebase cleanup and delivery

All **five** clusters started for this rebase are stopped and independently
rechecked with `pg_ctl status = 3` and no `postmaster.pid`: both focused clusters,
the initial full-script cluster, the isolated evaluator cluster, and the final
full-script cluster. All **six** recorded benchmark server PIDs are absent;
every harness also confirms its owned processes stopped. No process-name
cleanup was used. [Final cleanup receipts](./rebase-cleanup.json).

The branch remains `sb4-pg/k0q`, based on `8f909dc734`; identities and footers
remain as requested. No push or stash. Public Postgres configuration and
release/startup policy remain S10d-3; the leased internal host and queue are
qualified here. The committer note and append-only journal record the integration
and guard repairs. The existing serialization ticket gains these observations
without changing its open state.
