# G7-E: early lock release with durable output release

Base: G7.2 `069520dc2316d1ba3775f7227398e16021b14de3`, branch `sb4-pg/g7e`,
worktree `/home/ccheever/projects/sb4-rt12f2`. This is a functional qualification
lane on the shared build host, using the worktree's own target, line tables and
Cargo `-j 4`. No throughput campaign, S1 qualification, publication or push.
The disk stop floor is 25 GiB. Raw logs and process records remain under `/tmp`.

## Product change

The explicit store URL setting `commit=early` enables E; omitted or
`commit=synchronous` retains S. Serve and doctor disclose the mode. E retains
G7.2's three flights for eligible program batches. The third message sets the
data transaction's
`synchronous_commit=off`, commits it, begins the marker transaction, explicitly
sets `synchronous_commit=on`, updates exactly one `(token,slot)` marker row and
commits. The fully drained successful message, checked command counts, committed
data xid and absence of cancellation warnings are required for certification.
An update of zero rows or any error after the data COMMIT is unknown and never
reruns that data transaction.

Synchronous writers set `synchronous_commit=on` inside their own transaction,
including barriers, N=1 solo, recovery and ownership acquisition. The marker's
unfenced exception is confined to `_durable`; its contents are never authority.
New tokens insert their own rows, and stale rows are pruned with SKIP LOCKED.
Solo/barrier certificates read their post-write head immediately before COMMIT
in that same message, after application/tail validation. This preserves the idle
N=1 budget; certificate decode errors after COMMIT are unknown too.

D is a public sequence and a separate internal revision, qualified by a recovery
epoch and its attempt floor. Snapshot rows are carried in a private head-bound
envelope and opened under the same release lock as epoch bumps. E reads capture
head/attempt/postmaster inside REPEATABLE READ; ordinary and optimized reads
share this transport. E uses that transaction path rather than independent
statement pipelining. Cache entries only receive certified data; G6 closes before
final dispatch and only installs certified publication. An unknown revokes its
G6 epoch; after fenced D recovery the safe fallback is G5 until a newly acquired
owner grants a new epoch.

A continuity break discards unopened values and fills above D. After drainage,
a fenced synchronous head write installs a fresh attempt and rebuilds D without
advancing revision or public sequence. An E-only idle worker observes connection-loss notification and performs this
recovery without requiring a later write. A stale idle writer is reconnected
after its first failed control probe, with one bounded probe/recovery retry. Readers have a 250 ms bound per snapshot and
fail retryably on expiry or history change. Ready/command completion is consumed
by the pinned driver; its public API exposes affected counts rather than raw
command-tag strings. Error paths use xid status, including a surviving or
reconnected writer after ticket drainage; in-progress/unavailable remains unknown.

## Mechanisms and witnesses

| Mechanism | Positive witness | Failing-before evidence |
| --- | --- | --- |
| Async data commit and same-message marker | A real visible suffix before marker; two slots/fold/FIFO; three-flight ratchets | Switching the data COMMIT back to synchronous makes the PG marker case fail its genuine-lost-suffix assertion (16 survives instead of 8) |
| UPDATE 1 certificate | UPDATE 0 remains unknown, with committed receipts and no rerun | Accepting UPDATE 0 returns an acknowledgement and fails the outcome assertion |
| Explicit synchronous marker | Role/session default off still produces a covering marker | Replacing its on with off trips the WAL flush-position assertion |
| Status-based outcomes | Marker 23514 after data COMMIT and cancellation warnings remain unknown; drained xid probes | Guessing aborted from 23514 instead returns replay acknowledgements and fails the unknown assertion |
| Head-bound row release | Every admitted reader class below; no pending fill install; bounded wait | Removing envelope opening lets the reader-class witness complete before D |
| Reopened physical snapshot | G4a fallback captures a new head after the composed read ends | The regression test initially returned fresh authority facts using the previous snapshot's head; resetting the binding at every BEGIN makes it hold and fail retryably |
| Head-bound CPU hits | G6's exact installed publication opens through D too | Removing publication head validation accepts a future cache entry |
| Epoch attempt floor | Lost snapshot/fill rejects numeric revision reuse; postmaster and late-certificate checks | Removing the attempt floor opens the lost bound value |
| Fenced D rebuild | New attempt with unchanged public/revision heads; live PG restart and new epoch | Omitting the persisted recovery attempt fails the nonce-change assertion; the live PG case also failed before the stale-idle-socket control retry was added |
| Idle recovery | Rebuild without a queued user operation | Disabling the idle recovery dispatch leaves D broken and times out |
| Connection-loss notification | Idle reader socket loss bumps the epoch and wakes recovery | Disabling the reader-driver notification leaves the old epoch unchanged and times out |
| Marker fence exception | No owner RowShareLock while held; takeover and new-token provisioning | Adding an owner lock to the marker fails the held-marker lock assertion |
| Discarded-epoch successor | The upper marker certifies while the lower is held, then both callers remain unknown when the lower fails | Removing the late-success discard releases the queued upper acknowledgement and fails the outcome assertion |
| Synchronous claim barrier | Session default off; deferred COMMIT checks on and holds the payload until D advances | Setting writer transactions off makes the deferred claim reject it; the client correctly redacts the database detail |
| Solo head sampling without an extra flight | The synchronous head shares COMMIT's message; after-COMMIT decode failure is unknown with committed data retained | The idle N=1 test failed before this fusion: S/E 15/16 flights |
| Flush-position assertion | Every qualification/test batch compares its commit-LSN upper bound to WAL flush; planted unflushed sample panics | Removing the assertion makes the expected-panic witness fail |
| Provisional state/fold | Three seeded 192-member held histories vs N=1, known-abort cascade and complete state digest; SQLite retained | The fold/provisional mechanisms retain G7.2's before-fix evidence; E-specific histories and cascade pass |

All 14 fresh mechanism-disabled runs fail at their intended assertion, with
successful compilation; every temporary mutation is restored. Their local
records are `/tmp/sb4-g7e-mutants.json` and the corresponding before-*.log files.
The live restart additionally supplies a real product failure before the
control-probe retry: an idle socket's first I/O discovered closure, and recovery
paused instead of rebuilding D. Reconnecting and repeating only the fenced
control probe/recovery nonce resolves it; data outcomes retain their rules.
The fresh-snapshot regression also failed against the implementation before its
fix (`/tmp/sb4-g7e-before-snapshot-rebind.log`): one logical request can open
multiple physical transactions, and each must acquire its own head binding.
The idle N=1 regression supplies another real before-fix failure, recorded in
`/tmp/sb4-g7e-before-solo-head.log`; the final ratchet checks S/E parity.

The test entry points are the core library's `g7e_` filter with the Postgres
feature and `--include-ignored --test-threads 1`, and
`python3 snapback4/scripts/test-g7e-crash.py PATH_TO_CORE_LIB_TEST_BINARY`.
Both require a private PostgreSQL 16 environment; the matrix creates and cleans
its own additional cluster. The public E suite uses
`SNAPBACK4_TEST_PG_COMMIT_MODE=early python3 snapback4/scripts/test-postgres-serve.py`.

## Reader coverage

| Reader class | Construction / witness |
| --- | --- |
| G4a closure queries | E disables independent execution; snapshot envelope; reader-class and reopened-fallback witnesses |
| Ordinary queries | First snapshot head before data; same envelope; reader-class witness |
| G5 fills and hits | Validation and fill data pass D; pending fill count unchanged while held |
| G6 fills and hits | Actual zero-flight hit first, then counted closure and G5 fallback through D; no hit or fill above D |
| `/changes` | Ledger/change evidence uses the same read transaction; visible snapshot head must be covered |
| Receipts / keyed replay | ReceiptReader and preflight share the snapshot gate; restart verifies all acknowledged keys |
| Sync / `partition::stream` | Its head, log and mutable expansion dependencies share the gated snapshot |
| Outbox / effect claimers | Due/list reads use gated snapshots; an actual fenced claim is held at its deferred COMMIT and returns its payload only after its synchronous barrier advances D |
| SQL reads / SQL inspection | Existing named Postgres inspection refusal; no result transport is admitted |
| `ctx.sql` in actions | Existing Postgres actions profile refusal; no action SQL result is admitted |

Range readers see a contiguous snapshot prefix. D must cover that snapshot's
public head as well as its revision; the test separates those quantities. The
agent-facing deploy guide states that raw SQL clients outside Snapback can see
an unflushed suffix which a PostgreSQL crash later loses.

## Crash qualification

The private matrix SIGKILLs Snapback and PostgreSQL separately at five points:
P1/before final, after tail, before COMMIT, marker after data COMMIT, and after
certificate before caller release. Each begins with eight acknowledgements
recorded and fsynced by the controller. The marker case parks an actual reader
and forbids a successful response. Recovered `_head`, `_commits` and `_ops`
must be a whole-batch prefix, retaining every acknowledged key. A restarted
Snapback helper synchronously rebuilds D before row or receipt output.

The ten boundary cases pass with zero acknowledged-write loss. The PG marker
case loses the visible unacknowledged suffix: 16 receipts before SIGKILL, eight
after recovery, with all eight acknowledgements retained. An additional case keeps Snapback alive across the PG crash: it loses the
visible suffix, rebuilds D, and reuses the lost numeric revision with a different
attempt and payload (counter 24 instead of the lost 16). Its held reader emits
no lost-history rows. Final matrix totals are recorded below.

A physical host power cut is not performed: this is a shared machine with two
other build lanes and the protected PG17 cluster. `/dev/kvm` exists but is inaccessible to this account, and
`qemu-system-x86_64` is absent; there is no usable isolated VM/block-device
power controller in this lane. The private PG SIGKILL case
actually destroys unflushed shared WAL and demonstrates loss of the uncertified
suffix; it is not represented as a storage-device power-loss test.

## Final checks and custody

Cargo uses `-j 4`, this worktree's target and line-tables-only dev/test profiles.
Counts are passed / failed / ignored; direct Cargo target summaries are counted
once, excluding nested helper summaries.

| Check | Result |
| --- | --- |
| Full core with Postgres, 49 direct targets | 1,283 / 0 / 489 |
| Full `snapback4` binary, repeated after head fusion | 608 / 0 / 58 |
| Final E focused suite, including ignored entries | 27 / 0 / 0; 25 asserting tests and two controller-guarded helpers |
| Core RT0, including E idle N=1 and both slots at N=1/8/32 | 6 / 0 / 0; eligible E batches remain three flights; idle S/E is 15/15 |
| HTTP RT0 | 10 / 0 / 0 |
| Complete Postgres script scope plus nine repaired targets | 860 / 1 / 0 across 36 direct Rust targets; only inherited `40001` remains |
| Snapback/PG crash matrix, including live revision reuse | 11 / 0; zero acknowledged-write loss and zero lost-history reader release |
| Mechanism-disabled runs | 14 intended failures / 0 unexpected passes; all mutations restored |
| Reopened-snapshot regression | Fails before fix, passes after fix |
| Idle N=1 regression | S/E 15/16 before fix, 15/15 after fusion |
| Public Postgres serving milestone with `commit=early` | PASS; 12 PASS checkpoints, restart, takeover, changes, sync, replay and evolution |
| SQLite-only `cargo check` | PASS |
| Full shipped CLI build with Postgres | PASS |
| `./ref-check --verbose` | 569 LLPs, 11,988 references, zero errors and zero unchecked references |
| `git diff --check` | PASS |

The full core pass precedes the final E-only CPU-hit, connection-notification,
idle recovery/control-retry, reopened-snapshot and synchronous-head fusion
refinements. The final focused
suite covers those paths; the final requested Postgres/binary/RT0 checks follow
them. No deadline, production hold bound or ratchet budget is relaxed.

Every cluster belongs to this lane or its explicitly launched witness script.
No unowned process is signalled, no stash or Git configuration change occurs,
and raw logs are not committed.

The first complete Postgres-script invocation hit a new test's incorrect import
path and could not compile nine targets. The import was corrected; all nine
exact targets were rerun, including the cold-plan witness alone and the complete
G5/G6 cache family. Their 393 / 0 results combine with the original 467 / 1
over 27 completed targets: 36 direct Rust targets, 860 / 1 / 0 overall.
The only remaining failure is the permitted inherited
`evaluator_concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`,
SQLSTATE `40001` for a concurrent update, also recorded in the G7.2 report.
The 22-test corpus sweep and the evaluator have unchanged semantic inputs and
retain their completed results. Both the default-S public-serving milestone in
the script and the separate E public-serving run pass and stop their clusters.
The later head-fusion change is covered by the 27-entry E suite, refreshed RT0
ratchets and the repeated binary/crash checks; S's commit path is unchanged.

The final SIGKILL matrix is 11 / 0, including live revision reuse, with
`pids_left: []`. The main private PG16 used socket directory
`/tmp/sb4-g7e-pg.bx49dxjg`, port 34533 and recorded postmaster PID 2860334.
It stopped gracefully; independent `pg_ctl status` returned 3 and its PID file
was absent. The process watcher also exited. The final audit checked 12,442
recorded PID/birth instances over 84 record files: zero owned processes left
and zero audit errors. The minimum sampled free space was 44.94 GiB, above the
25 GiB floor; final free space was 46.40 GiB. All private cluster data and raw
records remain outside Git. No PG17/port-55440 or `~/q24` state was changed.

## Rebase onto integrated main (2026-10-25)

The preserved arm-E tip `9c6974b604` is replayed from `069520dc23` onto
`sb4-pg/main-20a4` (`20a45b73cb`), including landed G7.2 `ac3d2ec858`, its
fix round `d5c1e41f13`, FF3, R1 and the 0.4.41 integration. The rebased
implementation is `28acd08e7a`; the original arm-E branch is retained.

Every textual conflict is resolved as follows:

| File | Resolution |
| --- | --- |
| `engine/program_pipeline.rs` | Apply E's D/epoch release and drained xid classification before returning the original predecessor's known-abort witness. A committed but unconfirmed predecessor stays unknown. Retain G7.2's ordinary member recovery and bounded cascade-to-solo fallthrough at both sites. |
| `engine/postgres/store.rs` (two hunks) | Keep E session/snapshot fields and `batch_end`, together with FF3's initialized `activation_relations`. Retain opening relation capture and pre-COMMIT `verify_activation`. |
| `verbs/configured_release.rs` | Doctor JSON includes `commitMode`, `readCacheTier` and warnings. |
| `snapback4-lang/src/guide/deploy.md` | Add E opt-in and raw-SQL visibility disclosure, retaining the complete FF3 activation/OID/final-image and event-trigger boundary guidance. |
| Pipeline RFC | Union both implementation notes and revision history; preserve main's settled G7.0/ruling-8 decision, commissioning order and read-under-write qualification, plus E's three-flight/default-S conditions. |
| Controls RFC | Keep FF3/R1 history and add E's durable reader-release amendment. |
| Scale-limits RFC | Retain acknowledgement-defined durability, per-ack flush witness and concurrent-write read qualification; add E reader/recovery coverage, commit-mode and visibility disclosure. |
| `JOURNAL.md` | Keep both G7.2 fix-round and arm-E entries; append this rebase's record. |

The automatic merges also retain `feature="sqlite"` on `program_pipeline`,
pipeline-aware fill, both `program_cascade_fallback` call sites, and FF3's
`verify_activation`. Five additional E regressions exercise the four fix-round
recovery cases and an unconfirmed predecessor followed by a named successor
member failure. The recovered survivors open actual E row snapshots to witness
that their solo commits advanced D. The unconfirmed-predecessor case counts the
failed member's attempts, forbidding an innocent cascade rerun.

### Rebase verification

All runs use the integrated source and this lane's target, line-tables-only
profiles and `-j 4`. Counts are passed / failed / ignored; nested helper
summaries are excluded. No throughput campaign is run.

| Check | Result |
| --- | --- |
| Full core with Postgres, 49 direct targets | 1,307 / 0 / 516 |
| Full `snapback4` binary | 612 / 0 / 58 |
| E suite, including five new composition regressions | 32 / 0 / 0 |
| G7.2 suite, including ignored entries and E variants | 40 / 0 / 0 |
| Core RT0 | 6 / 0 / 0; E retains three-flight batches and idle S/E 15/15 parity |
| HTTP RT0 | 10 / 0 / 0 |
| E crash/kill matrix and live revision reuse | 11 / 0; zero acknowledged-write loss and no lost-history reader release |
| Complete Postgres script, 26 completed Rust targets | 791 / 1 / 0, plus the inherited evaluator lockfile failure |
| Public serving with S, inside the Postgres script | PASS; 15 PASS checkpoints |
| Separate public serving with `commit=early` | PASS; 15 PASS checkpoints |
| Shipped CLI build with Postgres | PASS |
| Core check without default features | PASS |
| SQLite-only core check | PASS |
| `./ref-check --verbose` | 569 LLPs, 12,021 references, zero errors or unchecked references |
| `git diff --check` | PASS |

The Postgres script's only failed Rust test is
`both_stores_all_public_boundaries_and_write_observations`, with
`runtime_refused_unexpected {"E_INPUT": 6}`. The evaluator cannot execute
because `experiments/postgres/Cargo.lock` is stale under `--locked`; consequently
its known `40001` stress case is not reached. Both observed failures are the
inherited main failures documented in
[the existing ticket](../../../issues/20261025-snapback4-difftest-unexpected-e-input.md).
There are no other final-source failures. The script still completes its
public-serving witness and stops its cluster. Both S and E public runs verify
FF3's event inventory and actual G6 declaration through serve and doctor.

The E suite's count includes two controller-guarded helper entry points; the
other 30 tests assert mechanisms. Two preliminary development runs each report
31 / 1 because the new unknown-predecessor fixture initially installed its
interception before writer-slot admission, then retained it across recovery.
The fixture now qualifies both slots first, waits for the marker's failure and
removes its interception before fenced recovery. Production admission and
recovery correctly refuse that interception. The final 32 / 0 run and complete
137 / 0 program-batch family in the Postgres script cover the corrected fixture.
No product protocol change is needed after the semantic rebase.

The SIGKILL matrix independently reports `pids_left: []`; its PG marker case
loses the visible unacknowledged suffix (16 receipts become eight), retaining
every acknowledged key. The live case reuses the lost revision with a different
attempt and emits no held lost-history reader output.

### Rebase process and disk custody

All six private cluster directories, including both preliminary fixture runs,
independently return `pg_ctl status` 3 and have no `postmaster.pid`. The combined
PID/birth and explicit public-helper ledgers contain no living or zombie matches.
The command runner and separate build/check drivers have exited. **PIDs left:
none.** Raw evidence stays outside Git under `/tmp/g7e-main-*`.

The minimum sampled free space is **34.39 GiB**, above the 25 GiB stop floor.
After the CLI build completed, with no owned compiler active, the lane removed
only its own `snapback4/target/debug/incremental` cache, reclaiming **22.59 GiB**.
Built artifacts were retained. Final free space is about **47.67 GiB**.
No protected PG17/port-55440 or `~/q24` state is touched. The preserved
`sb4-pg/g7e` branch remains at `9c6974b604`; no push, stash or Git configuration
change occurs.

## G7-E fix round 1 — epoch transition and G6 uncertainty

Base: `d155f7a68e`, branch `sb4-pg/g7e-main`. This fixes the P1 from the
Sol review of pre-rebase arm E: a delayed reader-disconnect notification
could restore uncertainty after the committer had already rebuilt D,
leaving a healthy durability epoch with permanently refused writes.

The epoch bump and uncertainty closure now share D's release lock and the
G6 publication write lock. Both acquire grant before D, matching ordinary
G6 commits and CPU hits. A recovery certificate acquires the same locks,
checks its captured epoch, installs D and clears writer uncertainty before
releasing either lock. Recovery from an older epoch cannot clear a newer
break. Old read-grant epoch, publication and deadline are not restored.

The audit also found the inverse two-step update in both pipeline recovery
sites: each cleared `grant.uncertain` after epoch certification had unlocked
D. Both are removed; certification owns that transition. Duplicate E/G6
closure in rollback and lane failure is consolidated. When the engine has
its depth-two placeholder, failure closure finds D in the in-flight slot.
Other flight-resolution and ordinary G6 commit updates already hold the
publication lock; initial ownership installation is startup-only and
publication-locked, and revocation is one-way. No further split recovery
clear remains.

### Deterministic failing-before witnesses

`g7e_delayed_disconnect_closure_cannot_strand_writer_admission` pauses a
notification between its epoch bump and G6 closure, starts real idle fenced
recovery, resumes the notification, then submits a mutation through the real
command queue. On the unfixed code, recovery leaves D healthy and the delayed
closure causes `recovered epoch stranded admission: Err(OwnershipLost)`.
With the fix, recovery waits for the coordinated closure and the subsequent
mutation is admitted and committed.

`g7e_recovery_clears_only_its_own_epoch_uncertainty` rejects a stale recovery
certificate without clearing the newer break, clears uncertainty for the
matching epoch and verifies another break closes it again. The unfixed
certification fails with `matching recovery left writer admission uncertain`.

The before run used unchanged product transitions plus the notification hook
and the two new tests: **31 passed / 2 failed**, with one crash helper filtered.
The private PG16 cluster stopped independently (`pg_ctl status` 3, no
`postmaster.pid`); its recorded PID/birth audit is empty. Raw before/after
evidence stays outside Git under `/tmp/g7ef1-before/` and `/tmp/g7ef1-after/`.

### Fix-round verification and custody

All code checks use this lane's own target, line-tables-only profiles,
`CARGO_INCREMENTAL=0` and cargo `-j 4`. Counts below are passed / failed /
ignored; nested child summaries are excluded.

| Check | Result |
| --- | --- |
| Full core with Postgres, 49 direct targets | 1,308 / 0 / 517 |
| Full `snapback4` binary | 612 / 0 / 58 |
| E suite, including both new regressions | 34 / 0 / 0 |
| G7.2 suite, including ignored entries and E variants | 40 / 0 / 0 |
| Core RT0 | 6 / 0 / 0 |
| HTTP RT0 | 10 / 0 / 0 |
| E crash/kill matrix and live revision reuse | 11 / 0; zero acknowledged loss; no lost-history reader release |
| Full `bash scripts/test-postgres.sh`, 26 Rust targets | 791 / 1 / 0; script exits 1 for inherited reds below |
| Public serving in S and E | Both pass and independently stop their own clusters |
| SQLite-only core feature check | Pass |
| `./ref-check --verbose` | 569 LLPs, 12,022 references, zero errors/unchecked |
| `git diff --check` | Pass |

The only Rust failure is the inherited
`both_stores_all_public_boundaries_and_write_observations`, whose report has
`runtime_refused_unexpected: {"E_INPUT": 6}`. The inherited evaluator
`experiments/postgres/Cargo.lock` also refuses `--locked`, so that stage never
reaches its known `40001`. **No other red appears.** The public-serving
witness inside the otherwise red Postgres script passes; the separate E-mode
witness also passes, including actual G6 declarations in serve/doctor and
FF3's event inventory.

All five private cluster directories (before, after, crash matrix and both
public-serving witnesses) independently return `pg_ctl status` 3 and have no
`postmaster.pid`. The after driver records 8,709 PID/birth pairs and no living
matches. The separate final audit combines before/after and crash ledgers:
**8,851 recorded pairs, no matches including zombies**, and no extant PID in
either explicit public-helper ledger. Both build/check drivers have exited.
Raw custody evidence is `/tmp/g7ef1-final-audit.json`; no raw logs are committed.

Minimum sampled free disk is **34.06 GiB**, above the 25 GiB stop floor;
final free disk is about **34.28 GiB**. No throughput campaign, protected
PG17/port-55440 or `~/q24` access, push, stash or Git configuration change occurs.
