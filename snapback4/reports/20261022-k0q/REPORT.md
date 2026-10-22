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


## K0-Q fix round 1

Implementation commits: `c1163d0c3b`, `7183074287`, `e7b957fad6`,
`0de2e163dc`, `eaa3a60098`, `e888877fb5`. All use the requested identities and footer.

Starting point: `02292e57365df4886b885d416f70727a4ac6e5a1`, on
`sb4-pg/k0q`, after the lead's integration onto S10d-3 `eeb79ebc7c`.
No push or stash; the other lane's worktree and target were untouched. Cargo
uses this lane's `snapback4/target`, ten jobs, and the brief's 20 GiB disk floor.

### Review dispositions and witnesses

| Item | Change | Regression evidence |
|---|---|---|
| 1. Queue-result panic and refused post-commit follow-ups | `Writer::call` returns `Result<T, Refusal>`. Auth config, asset ceiling, adoption, worker supervision, staging and maintenance handle it. Action/effect/route wakes, maintenance wakes and memory-sync publication run inside their original command. Route verification ticket insertion wakes its condition variable directly. | `writer_call_returns_ownership_loss_and_every_client_gets_the_same_response`; `admitted_notification_finishes_even_when_ownership_is_lost_before_wake` commits a session, latches ownership loss while the command is held, and still receives the committed result and wake. |
| 2. Unbounded waits | Control admission expires after **100 ms**, allowing a short scheduling burst. HTTP durable admission remains immediate. All acknowledgement waits expire after **30 s**, allowing the existing 25-second polls plus scheduling allowance. Expiry never cancels or retries admitted SQL; it reports unknown outcome. Effect/action steps no longer enqueue a second notification on Full. Clock serialization also uses 100 ms admission; its maintenance pause stays owned by the request, so a late admitted body cannot reinstall it after timeout. | `control_admission_has_a_deadline_and_does_not_execute_refused_work`; `acknowledgement_deadline_reports_unknown_without_cancelling_admitted_work`; overloaded effect-step HTTP request returns 503 while the writer remains held. `clock_timeout_releases_maintenance_when_admitted_advance_finishes_late` reproduced the real 30-second pause leak and passes after repair; `occupied_clock_admission_returns_overload_without_advancing_time` returns 503 while the clock gate remains held. |
| 3. View-once overload | With per-asset/principal delivery custody retained, commit the view reservation before releasing bytes. A refused or unknown reservation sends no bytes; transport failure after a confirmed reservation conservatively consumes the view. | `view_once_record_survives_mailbox_overload_before_delivery_custody_is_released` fills the mailbox before the first byte release, confirms the first fetch succeeds, the saturated second fetch is 503, and a second fetch after draining is 410 `E_ASSET_VIEWED`. |
| 4. Status and outcome consistency | Queue overload is **503 / E_RATE_LIMIT / limit**, retryable, with `Retry-After: 1`; ownership loss is **409 / E_STORE_OWNERSHIP**, not retryable; stopped/disconnected or timed-out acknowledgements are **500 / E_COMMIT_OUTCOME_UNKNOWN**, not retryable. The existing unknown-outcome type now also covers SQLite worker acknowledgement loss. Common JSON status selection runs before generation stamping; tuple errors use the same mapping. | Three refusal tests compare **complete JSON bodies**, statuses, retryability and Retry-After across `/m/add`, `/auth/login`, `/assets/missing`, `/changes` and `/auth/config`. Disconnection drops an admitted acknowledgement without a panic. |
| 5. Independent lease watchdog | Queue and public S10d-3 serving share `LeaseDeadline`. Authority expires at renewal SQL start + lease duration − **min(50 ms, lease / 4)**. Watchdogs sleep for min(10 ms, the remaining deadline); admission and queued execution also check expiry. A renewal COMMIT cannot block the watchdog or revive expired authority. | `renewal_commit_stall_expires_admission_and_queued_replies_independently` holds the renewal in deferred-trigger COMMIT, then receives ownership refusals for queued acknowledgement and new admission before unblocking it. Existing independent-renewal and unknown-COMMIT witnesses remain green. |
| 6. Startup lease leak | A release guard spans validation, initial renewal and thread installation. Failure retains cleanup custody. `engine/postgres/ownership.rs` only gains `lease_duration()`; release SQL and holder/token logic are untouched. | `failed_queue_lease_installation_releases_the_acquired_claim` injects renewal failure, checks explicit `lease_until = -infinity`, and immediately acquires from a standby. |
| 7. Refused bulk turn looks idle | Remove `QueueResult for bool`; bulk work returns `Result<bool, RuntimeError>`. Refusal logs through background diagnostics, preserves the due scheduler and takes a bounded retry pause. Only `Ok(false)` is idle. | Existing bulk/clock maintenance tests compile against the explicit result and pass in the CLI suite; queue overload tests prove refused bodies do not run. |
| 8. Writer-level and independent-progress witnesses | Writer ownership is tested through serving, including an HTTP answer. Ephemeral authentication, receipt checks and reader checkout now use detached readers, retaining hub serialization and generation checks; memory fixtures keep their explicit queue fallback. | `detached_reads_and_ephemeral_finish_while_the_writer_and_a_mutation_are_blocked` requires a query and ephemeral mutation to return before releasing a held writer. This test initially failed on the old queue-dependent ephemeral admission and passed after the fix. Existing 48-submitter and concurrent HTTP receipt/order witnesses remain. |

A held change poll that already emitted HTTP 200 heartbeat headers cannot change
its status later; its final typed body still carries any later refusal. The
four-door status witnesses exercise refusals before streaming begins. Ordinary
ephemeral rate-limit refusals keep their existing auth-family behavior; only
queue overload uses the new uniform limit-family admission mapping.

The affected LLP audit updates the committer RFC's existing §9 note and single
Revised line, the ephemeral RFC's mutex/reader claim, and the root LLP's old
post-send-only view consumption wording. The guide describes the actual bounded
waits, refusal statuses, unknown outcomes and conservative view reservation.
The journal receives an append-only dated entry. No new LLP or raised guard
allowance is introduced.

Serving entry modules are now below 1,500 lines: auth config lives in the auth
module, argument refusal rendering with head helpers, and the memory publication
and duplicate-id witnesses with the other committer serving tests. These moves
preserve the original behavior. Focused progress assertions check actual query
data, a successful ephemeral outcome, and the committed durable outcome.



### Fix-round qualification

All commands use this lane's target and ten compiler jobs. The first full core,
CLI and device runs used four outer test cases; the complete Postgres command
and final full CLI repeat used one outer case. Internal writer concurrency,
workloads, retry budgets, test timeout guards and durability settings were unchanged.
Checks span the implementation checkpoints: the full core/device runs precede
the final deadline-sleep and layout follow-ups; the complete Postgres run and
full CLI repeat cover code checkpoint `eaa3a60098`. The later clock-only
follow-up is qualified separately below. No new blind-review
verdict is claimed.

| Check from the brief | Result |
|---|---|
| `cargo build -p snapback4` | Pass, including final default rebuild |
| Core `--no-default-features` check | Pass |
| Device web `wasm32-unknown-unknown` check | Pass |
| Full core suite | **1,074 passed / 0 failed / 5 ignored** (46 targets) |
| Full CLI initial run | 1,411 passed / 2 failed / 17 ignored; details below |
| Full CLI complete repeat | **Exit 101: 1,412 passed / 1 failed / 17 ignored** (58 targets); exact isolated and subsequent full lifecycle target pass |
| Full device suite | **1,573 passed / 0 failed / 4 ignored** (104 targets) |
| Committer ratchet, store-port ratchet, opener census | **16 passed / 0 failed**; no allowances changed |
| Default compiled handle guard | Pass; Postgres compiled guard also passes in full script |
| Guide | **127 passed / 0 failed** on repeat |
| Wasm codec census | **27 passed / 0 failed** |
| `bash scripts/test-postgres.sh` | **Exit 0**, complete script, including public S10d-3 serving |
| Queue deadline/ownership faults | Default **5 passed**; full real-Postgres group **10 passed** |
| Final clock-only follow-up | **14 maintenance + 10 committer + 29 lifecycle + 16 guard cases passed**; default build and Postgres test typecheck pass |
| Root `./ref-check` | Pass; final post-report receipt linked below |
| `git diff --check` | Pass |

The complete Postgres script passed **58 evaluator + 209 common adapter + 22
ownership + 1 compiled guard + 38 doctest + 2 member + 10 queue + 1 internal
HTTP + 1 startup cleanup + 19 corpus** cases, then its public CLI campaign.
The four-writer evaluator retained 65 increments per mode, no lost updates,
zero serialized retries and 87 serializable retries. Existing named corpus
exclusions remain outside the supported claim. The public campaign confirms
that terminal ownership loss closes its listener. Its process-exit policy is
preserved; the queue separately refuses with typed ownership errors and has the
new blocked-renewal-COMMIT deadline witness.

The first CLI run's authority-gap fixture expected file-backed ephemeral
admission to queue behind the writer. That failure reproduced alone before the
fixture was adapted to park at detached reader checkout. The expiry, revocation,
adoption, no-write and no-new-commit assertions remain. Its isolated repaired
run passed. The initial guide run was 126/1: its defining-fact witness still
expected the old Postgres-COMMIT-only sentence. It reproduced alone; updating
that one expected sentence to include admitted acknowledgement loss retained
all code-definition assertions, and the complete 127-case repeat passed.

The initial CLI run also failed the fixture-free command's unchanged five-second
wall-clock guard. An unchanged isolated run passed, then another failed. Private
exit-0 timing samples of the fixed CLI took 7.218 s without a live server and
6.837 / 15.324 s with a live server while device compilation was active. This
shows that total campaign time is a poor proxy for SQLite writer waiting; it
does not establish baseline attribution or prove the absence of every possible
store wait. The retained pre-K0-Q executable failed private HTTP preparation in
this diagnostic and is excluded from the timing comparison. See the open
[timing issue](../../../issues/20261022-snapback4-run-admission-fixture-free-timing-guard.md)
and [timing receipt](./fix1-fixture-timing.json). No guard was weakened.

The unchanged five-second admission guard passed in the complete repeat. The
repeat remained red for `sqlite_replay_survives_counter_split_and_an_offline_cli_backfill`:
a concurrent request during adoption received **503 / E_GENERATION**, while the
fixture requires every response to be 200. Its exact unchanged isolated rerun
passed in 1.41 seconds. A subsequent full lifecycle target passed all 29 cases.
This does not resolve the race or establish baseline attribution; the
[adoption issue, now closed by fix round 2](../../../issues/closed/20261022-snapback4-concurrent-adoption-generation-refusal.md)
retains the response, missing door attribution and follow-up. No clean full CLI
repeat is claimed.

[Check commands, statuses, counts and source provenance](./fix1-checks.json)
retain initial reds and repeats. Unabridged transcripts and isolated attempts
remain in `/tmp/sb4-k0q-fix1/` on expo-build-450a. Focused serving also passes
all eight new/affected witnesses; its filter includes two relocated existing
witnesses in the final layout. No product assertion, matcher or stress budget
was relaxed.

### Clock deadline follow-up

After the complete repeat, an additional real-deadline witness reproduced a
maintenance leak: a clock command held behind the writer returned unknown
outcome at 30 seconds, its request guard cleared the pause, and the late body
then installed a pause with no owner left to release it. The old source failed
this test after 30.01 seconds. Commit `e888877fb5` moves pause acquisition before
queue admission into the request guard's lifetime; admitted clock work still
advances time after timeout, without reacquiring the abandoned pause. Clock
serialization now refuses after the same 100 ms admission window, using the
canonical 503/retryable/Retry-After overload response.

Final affected checks pass: **14 maintenance**, **10 committer serving**,
**29 lifecycle** and **16 guard/census** cases, the default build, and
Postgres-feature test typechecking. The new HTTP tests require the actual
unknown-outcome answer, subsequent 1,000 ms clock advance and cleared maintenance
pause, plus refusal before acquiring an occupied clock gate with no time change.
The receipt's two source-file SHA-256 values match the committed blobs at
`e888877fb5c1eb159c56c85621350c582a77159a`.
[Reproduction and final affected-check receipt](./fix1-clock-followup.json).

The complete CLI/Postgres runs and W4 samples remain bound to `eaa3a60098`.
This later delta changes clock-control admission and pause lifetime only; its
scoped repeats qualify that final content. It does not change mutation hot-path
inputs, SQL, lease arithmetic, receipts or the benchmark workload. Existing
test assertions, ceilings, retry budgets and timeout guards remain unchanged.

### Fix-round local W4 samples

Adjacent fresh samples use the retained harness and unchanged reduced fixture:
32 disjoint writers through real `serve`, local SQLite WAL/FULL, 160 warm-ups
plus three 1,600-operation trials. No other build or test from this lane ran
alongside them. Values are medians of the three trial statistics, rather than
pooled latency percentiles.

| Run | ops/s | p50 ms | p99 ms |
|---|---:|---:|---:|
| Retained baseline, freshly sampled | 97.03 | 328.11 | 357.49 |
| Fixed binary, adjacent sample | 95.32 | 334.72 | 355.21 |

Observed changes are **-1.76%** throughput,
**+6.60 ms** p50 and
**-2.28 ms** p99. This is a small local debug-build
sample with one durable commit per member; it does not establish a production
SLO or resolve small performance differences. Both durable counter totals are
independently checked at **4,960**.

The baseline is cached pre-K0-Q executable SHA-256
`17b57a6eefb1081e59fb945c135cbce5d11aef6f29bb61de508bf24654ef03da`, freshly sampled rather than freshly rebuilt from current
main. The measured fixed binary is the default build at `eaa3a60098`,
SHA-256 `eeb8c55cf248f00e064370234cd489fcf9f8481ac8746f59c7f78f99ab871788`.
[Baseline sample](./before-fix1.json), [fixed sample](./after-fix1.json),
[computed medians and identities](./fix1-measurements.json).

### Fix-round cleanup and delivery

All **three** clusters created for this fix round are independently confirmed
stopped: focused queue faults, the full evaluator and public S10d-3 serving.
Each returns `pg_ctl status = 3` with no `postmaster.pid`. All **11**
recorded public-serving, diagnostic and W4 process PIDs are absent. Both W4
harnesses confirm every owned process stopped. Cleanup uses exact owned paths
and recorded PIDs.

Observed disk space never crossed the 20 GiB stop floor; the lowest observed
reading was about 28.9 GiB. During the cold full suites, 54 completed CLI test
executables (about 18.14 GiB) and 43 completed passing core test executables
(about 14.99 GiB) were removed from this lane's target. Source, logs and retained
baseline bytes were preserved; the final CLI repeat rebuilt missing targets.
During that repeat, another 23 completed passing executables (about 7.45 GiB)
were removed to keep shared-host disk headroom, preserving its active target,
the CLI binary and guard executables.
[Cleanup and artifact-removal receipts](./fix1-cleanup.json).

The committer RFC has one Revised line prefixed with this fix round; its §9
note, governing LLP claims, guide and append-only journal describe the final
behavior. Final [root reference validation](./fix1-ref-check.txt) passes after
the report update. Work remains local on `sb4-pg/k0q`; no push or stash.


## K0-Q fix round 2 — stopped at the unchanged RT0 ratchet

**Incomplete / unqualified checkpoint: `96b7f976e8`.** The explicit instruction
was to stop and report if K0-Q changed a ratchet count. SQLite RT0 measured
`keyed_first = 0` against the unchanged table's **87**. No table was edited.
The required full qualification, Postgres ratchet and issue closure are not
claimed. Work stops here pending the counter-attribution integration.

### Rebase and conflicts

Fetched `sb4-pg/main-mirror` and rebased fifteen commits from `b78ab8f2b2` onto
`2281138019`. The former tip became **`f7d33edb32`**. The complete
[original-to-rebased hash map](./fix2-rebase-map.json) preserves every subject.
An initial identity error left the first replay staged; committing it with its
original author/message and the supplied committer identity resumed the rebase.

Conflicts and resolutions:

- `serve_maintenance.rs`: retained main's DX6 drain/held-boundary controls,
  effective clock floor, staging session preservation and pause semantics;
  integrated them with the owned command signatures, typed errors and queued
  report calls. Both sets of tests remain. The final checkpoint repairs the
  adjacent test-function boundary introduced during resolution.
- `serve_tests.rs`: kept both RT0 and committer test modules.
- The committer RFC: kept a single Revised line with every entry, plus RT0's
  sibling Related link; prepended `K0-Q fix round 2` to the revision history.
- `JOURNAL.md`: retained both append-only sides. Main-mirror's complete journal
  remains an exact prefix of the final journal.
- `tests/serve_postgres/mod.rs`: retained the current public-host description;
  its owned seed and tests remain intact.
- `scripts/test-postgres.sh`: retained both maintained-member and queue stages,
  the renamed queue selector, RT0 Postgres, and all newer public-serving stages.

The S10d-3 holder-bound release / known-rollback fix merged without conflict.
Its release predicate remains intact. RT5's worktree and processes were untouched.

### Requested changes and evidence

| Item | Checkpoint change | Test / status |
|---|---|---|
| 1 | Removed the 30-second Reply timeout. Admission remains immediate/100 ms; lease loss still drains not-started work. Shared start marker distinguishes `Stopped` → retryable `E_COMMITTER_STOPPED` (not applied) from worker death after start → non-retryable unknown. | Cross-door before-start witness passed in the 12-case intermediate run. Added real 31-second queued/started and clock witnesses plus disconnect classification; these remain unrun after the stop. |
| 2 | Post-advance maintenance/report refusals become non-retryable `E_CLOCK_REPORT_INCOMPLETE`, HTTP 500, no Retry-After, carrying advancedMs/reportIncomplete. | Deterministic advance-then-fill-mailbox test passed in the intermediate run; a 0ms drain keeps offset at 1,000ms. Repeating an original relative 1s request intentionally adds another second: no idempotency key exists, so the response forbids that retry. |
| 3 | Unknown mint fences the original worker revision with the same compare-exchange used by failed retirement; only known pre-execution refusals retry without fencing. | Intermediate unknown-mint witness passed: orphan token refused, replacement at next revision accepted, repeated fencing increments only once. |
| 4 | Source watcher keeps watching after refusal, retries overload/stopped non-admission, and remembers an unknown source digest across stored-generation changes. This covers both an outer queue error and an inner ambiguous adoption COMMIT. | Added deterministic overload/later-edit watcher witness; final source unverified. |
| 5 | /q/ discards E_GENERATION readers, reopens behind adoption at most twice and rechecks authority after that wait; foreign activation remains refused. | Added exact after-COMMIT/before-replacement pause witness requiring 200/data/new generation and a foreign-activation control. Neither ran before the stop; lifecycle full run remains unrun. Adoption issue deliberately stays open. |
| 6 | Filed the SDK unknown-outcome issue with Reviewer A's injected-envelope scenario, unresolved-intent/receipt reconciliation and no unkeyed automatic replay requirements. | [Open issue](../../../issues/20261022-snapback4-sdk-unknown-commit-outcome.md). No SDK source changed. |
| 7 | Documented late-renewal availability tradeoff without changing lease behavior; stopped-before-execution explicitly says not applied. | Documentation only; final reference/guide checks remain unrun. |

Response header/reply helpers moved into the existing `serve_head.rs` so merged
`serve.rs` stays below 1,500 lines. These helpers retain their original behavior.
Guide definitions and the prior stale-loan LLP explanation follow the new
semantics. No test expectation, budget, ratchet table or runtime SQL was relaxed.

### Stop evidence and remaining verification

The completed command was:

```sh
cargo test -p snapback4 --bin snapback4 round_trip -j 6
```

It returned **101**: one pass, one failure, one ignored Postgres case. The warm
ledger includes keyed_first/replay_hit/unkeyed_increment/one_membership **0**,
while detached W1/W2 retain **31** each. The failed assertion reports
`sqlite keyed_first: table 87, measured 0: lower the table`.
**That suggestion was not followed.** [Actual output](./fix2-rt0-stop.txt).

`core/src/round_trips.rs` uses thread-local `ACTIVE` attribution and explicitly
states that a future cross-thread committer must transfer it. The serving request
opens that scope; `Writer::command` transfers latency/trace/refusal evidence but
not round-trip scope. Durable work therefore runs without ACTIVE on the worker.
This explains the zero; it does **not** establish any SQL count improvement or
prove that correctly attributed counts match. The next integration step is to
transfer request counter attribution through the worker and measure again,
without adjusting either table. Per instruction, that step is not attempted here.

The redundant requested full-scope invocation (`cargo test -p snapback4
round_trip -j 6`) was still compiling integration targets when the completed
binary-only failure became visible. It received SIGINT at the verified owned
Cargo PID **404513**; its runner **404498** exited without starting later stages.

A prior focused command passed **12/12**, including the clock overload, mint,
pre-execution disconnect, cross-door ownership/overload, view-once reservation,
continuation custody and concurrent read/ephemeral/receipt witnesses. This used
an intermediate source state: final watcher/authority/handoff changes are **not
qualified** by that result. [Focused output](./fix2-focused.txt).

Initial compilation attempts caught test visibility/constructor issues; these
were corrected before the successful focused run and/or the RT0 compile. The
latest full-scope compilation was interrupted, so it supplies no final build
claim. `git diff --check` passes. No final full core/CLI/device suite, lifecycle
replay, build/no-default/wasm, ratchet/census/guard, guide/codec, Postgres script,
Postgres RT0, fresh W4 measurement or ref-check is claimed. Prior-round receipts
remain historical only. [Machine-readable status](./fix2-checks.json).

### Custody

Six compiler jobs, this lane's assigned target only, incremental disabled.
Unused incremental artifacts were removed from this target before the planned
long suites; lowest observed disk availability was 43G, above the 20 GB rule.
Both ratchet tables are byte-identical to `2281138019`; digests are in the status
receipt. No PostgreSQL cluster was started. Final /proc checks show no lane target
executable, check runner, or recorded Cargo PID alive. Owned PIDs left: **none**.
No push, stash, clone, sub-agent or remote build. Changes are preserved as a local
checkpoint rather than reported as completed qualification.


## K0-Q fix round 2 — completed after explicit RT0 attribution transfer

This continuation supersedes the incomplete qualification status at checkpoints
`96b7f976e8` / `92b659297a`; their RT0 failure and stop evidence remain above.
The base remains main-mirror `2281138019`, with rebased prior tip `f7d33edb32`.
No additional rebase, push or stash was performed. The existing rebase map and
conflict resolutions remain authoritative: both journal sides, one RFC Revised
line with all entries, DX6 staging clock/floor/session behavior inside owned
commands, both test modules and every Postgres script stage, and S10d-3's
holder-bound release/known rollback fix.

Attribution implementation: `3d842b63f4`; adoption timing repair: `aeb62378f7`; refusal explanations and clock assertions: `2ddab22685`; guide fact pins: `40f4811534`; Postgres observation fixture: `adeb2c1924`. The production command/body/queue shapes
are unchanged. Under `cfg(any(test, feature = "test-support"))`, `Scope` owns an
`Arc` of two atomic counters and its submitting-thread installation. Its
cloneable handle can be explicitly installed on another thread. Guards refuse
nesting and are bound to their installing thread; drop clears attribution on
normal return and unwind. `Queue::work` captures the submitter's current handle
at submission, and `Command::execute_on` installs it only around that body's
execution and synchronous continuation. The next command starts without that
scope. Unscoped maintenance and background threads do not inherit attribution;
the Postgres lease-renewal connection and its SQL remain unchanged and uncounted.
The ordinary CLI has zero `round_trips` / `trace_round_trips` symbols in
`nm --defined-only`, checked before and after full qualification.

The new regression creates a command before beginning the request scope, submits
inside it, then proves the worker counts reach the submitting scope. It checks
an unscoped next command, a new request's independent counts, and unwind cleanup.
Two scope tests cover cross-thread totals/background exclusion and nesting
refusal without losing the outer scope. Existing ordering/exactly-once and
reader/ephemeral progress witnesses remain unchanged.

The final-source adoption selector initially failed both new witnesses, and each
failure reproduced alone. The foreign-activation path exposed a `TimedReader`
whose thread-local latency span was created on the committer and dropped on the
request thread, underflowing its depth. The deterministic handoff fixture also
waited for two waiting commands even though its counter excludes the running
adoption. `aeb62378f7` returns only reader data across the queue, creates the span
on the consuming request thread, and waits for the one blocked query. All 14
affected query cases then pass (one existing ignore); the full CLI exercises the
repaired source again. A first compile attempt needed an explicit Result error
type; it was corrected before the passing witness run. The original reds,
isolated reproductions and repair receipt are retained in
[fix2-adoption-followup.json](./fix2-adoption-followup.json). The clock witness's
harness time is 31.06 seconds; its runner wall time includes the pause for this
repair, after that child had completed.

Governing context and affected-scope doc audit: LLP 3000.009.001.000.000 §§3.1,
3.4, 3.7 and 9 retain the worker-owned engine, single-member transaction
boundaries and continuation-before-acknowledgement contract; LLP
3000.009.001.000.001 §5 retains exact request-class ratchets and the ordinary
binary's instrumentation exclusion. The K0-Q implementation note and RT0 note
each record attribution transfer. The current refusal guide and its defining
facts retain real-result waiting, before-start/not-applied versus after-start
unknown outcomes, and non-retryable incomplete clock reports. No new allowance,
budget, SQL, protected ownership-adapter edit or client source change was made.

| Round-2 item | Result and evidence |
| --- | --- |
| 1. Admitted acknowledgement | No acknowledgement deadline; immediate/100 ms admission and ownership bounds retained. The real 31-second queue witness holds both running and queued commands, receives no early result, then receives 7 and 11. The clock witness also waits 31 seconds and advances exactly once. Before-start disconnect is not-applied `E_COMMITTER_STOPPED`; after-start death is genuine `E_COMMIT_OUTCOME_UNKNOWN`. |
| 2. Clock after advance | Full-mailbox report witness gets non-retryable HTTP 500 `E_CLOCK_REPORT_INCOMPLETE`, `advancedMs: 1000`, no `Retry-After`. Recovery with `0ms` leaves offset at 1000. Repeating the original relative duration deliberately adds another second: this door has no idempotency key, so the response forbids that retry and instructs inspection/drain instead. |
| 3. Worker mint | Unknown outcomes fence `worker_revision` exactly once before replacement; known not-applied refusals preserve the revision. Witness rejects the orphan bearer and accepts the replacement. |
| 4. Source watcher | Overload is retried without exiting; the deterministic witness adopts the pending source and a later edit. Both outer acknowledgement unknown and inner ambiguous adoption COMMIT remember the source digest without replay; later edits remain eligible. |
| 5. Adoption read handoff | Deterministic after-COMMIT/before-reader-replacement pause yields HTTP 200, correct row and new generation. Genuine foreign activation still yields `E_GENERATION`. Full lifecycle, including the original 1600-row/62-edge replay assertions, passes; the adoption ticket is closed with its resolution. |
| 6. SDK unknown outcome | Open filesystem ticket records Reviewer A's SDK reproduction, unresolved-intent custody, receipt reconciliation and prohibition on unkeyed auto-replay. Client implementation remains outside the lane. |
| 7. Renewal/disconnect wording | Accepted availability tradeoff remains documented: renewal COMMIT followed by failed `renewed()` drops without release, never reviving expired authority. Before-start disconnect explicitly says not applied. |

The complete CLI pass at `aeb62378f7` is **1,422 passed / 11 failed /
19 ignored**. Every failure was rerun alone before repairs. `2ddab22685` gives
both new runtime codes dedicated explanations and guide routing, and updates the
interrupted-clock fixture to require the incomplete-report envelope while
retaining its original interruption cause, pause, clock and queued-work checks.
The full CLI unit-binary repeat is **535 passed / 0 failed / 9 ignored**; the
exact `why` integration passes all **405 codes with zero fallback sections**.
Those affected repeats repair all three lane-owned failures.

The clock socket-timeout and security-refutation failures pass unchanged in
isolation. Six cases remain reproducible: four direct-engine residency/timeline
fixtures disagree with derived source reservations (new
[issue](../../../issues/20261022-snapback4-residency-timeline-reservation-fixtures.md));
the unchanged five-second run-admission guard fails again (existing
[issue](../../../issues/20261022-snapback4-run-admission-fixture-free-timing-guard.md)
appended); and supplied baseline `web_witness_help_and_invalid_input` still
misses `E_INPUT` on stderr. The other supplied toolchain/TypeScript baselines
pass. No guard was relaxed, and no baseline runtime attribution is claimed for
the reservation cases. The direct timeline failures do not involve the serving
queue. This is a completed full CLI pass plus affected repairs, **not a clean
full-CLI claim**. Details and exact isolated commands are in
[fix2-final-checks.json](./fix2-final-checks.json) and
[fix2-cli-followup.json](./fix2-cli-followup.json).

Full device qualification is **1,565 passed / 8 failed / 4 ignored**. All eight
exact isolated reruns reproduce the same reservation disagreement in
`readauth::outcomes::{bridge_publish,bridge_repost,recipe_post,recipe_repost}` on
memory and SQLite; the shared fixture ticket includes them. They fail in direct
engine construction before a serving command is submitted. Every other device
target passes. No validator, fixture schema or test bound was relaxed.

The first guide pass is 126/1 and its exact isolated failure reproduces: the
new runtime codes were absent from the manually reviewed defining/recovery fact
matrices. `40f4811534` adds both codes' semantic facts while retaining every
registry/duplicate/paragraph/recovery assertion. The complete guide repeat is
**127/0**. See [fix2-guide-followup.json](./fix2-guide-followup.json).

Both warm RT0 tables match **exactly**, all twelve rows on each store. Neither
JSON table changed from `2281138019`; cold/first-use observations are diagnostic,
not warm table rows. The concise first qualification receipt is
[fix2-attribution-rt0.txt](./fix2-attribution-rt0.txt); the full-scope SQLite repeat
and Postgres-script repeat also pass.

| Request class | SQLite statements | Postgres flights |
| --- | ---: | ---: |
| action_session_w1 | 39 | 29 |
| keyed_first | 87 | 77 |
| narrowed_argument | 46 | 26 |
| one_membership | 80 | 58 |
| rate_limited | 0 | 0 |
| replay_hit | 40 | 30 |
| unauthenticated | 0 | 0 |
| unkeyed_increment | 79 | 57 |
| unknown_operation | 46 | 26 |
| unknown_token | 5 | 5 |
| w1_point | 31 | 23 |
| w2_newest20 | 31 | 23 |

The first full Postgres script did **not** run five core unit-test stages: a
retired `Reply::wait_timeout` call prevented their shared test target from
compiling. The earlier main-store-pass claim was incorrect. `adeb2c1924` keeps
the fixture's 50 ms observation on a separate test receiver around real-result
waiting, with its original ownership, unlock and cleanup assertions. No
production timeout API returns. The full Postgres-feature test tree type-checks,
and the complete script repeat now runs every stage: **376 Rust passes / one
evaluator concurrency failure**. The five formerly blocked stages pass **218,
25, 2, 1 and 12** cases; the compiled handle guard and 38 doctests also pass.
HTTP, startup release, RT0, the corpus and public serving (including P1-MC)
pass. The exact unchanged evaluator concurrency rerun passes both modes with
65 durable increments each, no lost updates and 0/89 total retries. The
[existing evaluator issue](../../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md)
is appended; no clean-full-Postgres-script claim is made. See
[fix2-postgres-followup.json](./fix2-postgres-followup.json).

The temporary runner's Cargo-only failure mapper stopped after the initial
shell stage. Its real failed status and trace remain recorded; an explicit
evaluator rerun and every remaining check completed. This affected orchestration,
not product behavior. The corrected complete-script repeat also remains red
only on that evaluator fixture.

| Required check | Final evidence |
| --- | --- |
| Ordinary CLI build | Pass, repeated after restoring main-workspace artifacts and by the corrected Postgres script |
| Ordinary instrumentation exclusion | Zero `round_trips` / `trace_round_trips` defined symbols before qualification and after both final builds |
| Core no-default check | Pass |
| Wasm device no-default/web check | Pass |
| Full core | 1,085 passed / 0 failed / 5 ignored; 27 doctests included |
| Full CLI | 1,422 passed / 11 failed / 19 ignored; all exact isolated reruns retained; lane repairs pass full unit binary 535/0 and exact why 1/0; six unrelated/provided-baseline cases remain reproducible |
| Full lifecycle within CLI | 29/0, including concurrent replay/backfill; adoption issue closed |
| Full device | 1,565 passed / 8 failed / 4 ignored; every failure reproduces reservation/schema disagreement alone |
| Committer/store-port/handle censuses | 16/0, final repeat after the last fixture repair; no allowances changed |
| Compiled handle guards | Default and Postgres 1/0 each; core doctests 27 and Postgres 38 |
| Release feature guards | Both exact diagnostic refusals pass |
| Guide | Initial 126/1 and isolated red retained; final complete repeat 127/0 |
| Wasm codec census | 27/0 |
| SQLite RT0 full-scope command | Pass, 12 exact rows, parser round-trip case also passes; Postgres witness deliberately ignored in this command |
| Complete Postgres script repeat | 376 Rust passes / one evaluator failure; all five core stages, HTTP/corpus/RT0/public serving execute and pass; exact evaluator rerun passes |
| `./ref-check` | Pass; final post-record repeat recorded below |
| Whitespace | `git diff --check` passes |

Fresh local W4: **95.30 → 95.55 ops/s**,
**332.38 → 332.69 ms p50**, and
**438.69 → 463.91 ms p99** (median of three 1,600-operation
trials; 32 disjoint writers, 160 warm-up writes, SQLite WAL/FULL). Both durable
totals are **4,960**. Throughput changes +0.26%,
p50 +0.09%, and p99 +5.75%.
No throughput lift or unchanged-tail claim is made. These are busy-host local
probes, not a promotion result.

The first two cached-baseline attempts returned HTTP 503 and yielded no valid
sample set; both failures remain in the ledger. A third fresh-fixture probe
completed, using a diagnostic-only copy that logs an HTTPError body before
rethrowing; no error branch fired on that successful run. Workload, assertions,
limits and retry behavior were unchanged. The successful fixed probe ran before
that successful baseline sample. The baseline is a fresh execution of the
retained pre-K0-Q binary, not a current-main rebuild. Binary hashes, all trials,
failed sample identities and counter totals are in
[fix2-measurements.json](./fix2-measurements.json),
[before-fix2.json](./before-fix2.json) and [after-fix2.json](./after-fix2.json).

All five owned Postgres data directories independently return `pg_ctl status`
**3** with no `postmaster.pid`, including the evaluator cluster restarted for
the exact isolated case. All **97 recorded PIDs** are absent, with no zombies,
no executable under this lane's target or cached baseline, and no task runner
left. The lowest sampled free space is **23.31 GiB**
(above the 20 GB stop rule). Only completed executables in this lane's target
were reclaimed; active and not-yet-run targets were retained. Cleanup receipts
and both table digests are in [fix2-final-cleanup.json](./fix2-final-cleanup.json).
RT5 was untouched. Six build jobs, no push, no stash. **PIDs left: none.**

Final post-record `./ref-check`: **565 LLP documents, 11,757 references, zero errors and zero unchecked**. Final whitespace and independent PID/cluster/table-digest repeats pass.
