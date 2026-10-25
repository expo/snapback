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


## G7-E rebase 2 — composition with write levers

The input E tip is exactly `ce2a6ce622d4e49bd7241babc84582cc554c4b9a`.
Replayed its three commits from `20a45b73cb` onto the requested immutable
main commit `7e88aa041df5207c5ff95a0982bc16e54543177d` on
`sb4-pg/g7e-land`. The local `sb4-pg/main-7e88` ref had advanced to
`ba886e7be0`; the pinned requested main commit is used rather than moving
that shared ref or incorporating its later changes. The input branch remains
at `ce2a6ce622`.

| Original E commit | Rebased commit |
| --- | --- |
| `28acd08e7a` | `1f70653988` |
| `d155f7a68e` | `5477844260` |
| `ce2a6ce622` | `a1644584ef` |

### Every textual conflict

Both conflicts occurred while replaying the first commit. The other two
commits replayed without conflicts.

| File | Conflict and resolution |
| --- | --- |
| `llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md` | Both sides prepend the `Revised` header. Retain E's durable-reader-release amendment and LEV's attempt-local-plan amendment, plus the shared history. Neither design paragraph is discarded. |
| `snapback4/JOURNAL.md` | Both sides append after G7.2 fix round 1. Retain the entire main tail (LEV ingress, ephemeral refresh, retained plans, reports, qualifications and subsequent main records), then E's full implementation entry. Subsequent E rebase/liveness entries replay unchanged. |

There were no code or RT0 table conflicts. Automatic merges of
`command_batch.rs`, `postgres/group_commit.rs`, `program_pipeline.rs`,
`program_g72_tests.rs`, `program_overlay_tests.rs` and `serve_start.rs` were
reviewed semantically. They retain fresh Full-scope/store/generation checks,
terminal `E_STORE_REPLACED` with HTTP 409, plan inventory through
`prepare_chained`, E certificate/epoch classification before predecessor-abort
classification, grant-before-D lock order, reader holds and three-flight E
batches. The main HTTP RT0 table retains warm keyed-first / narrowed-argument /
one-membership counts 7 / 1 / 7 and the direct batch classes remain 3 flights.

### Composition correction and witnesses

The audit found a semantic overlap despite the clean code merge: the durable
member's authority callback refreshed an ingress hint during staging, before
E's marker result or ordered D release. Durable mutation checks now retain
one candidate, replaced on every attempt, and publish it only from the
released-result continuation. Failed/unknown outcomes evict the old hint;
stale-kind retries take fresh certified discovery. Ephemeral checks retain
their separate final-snapshot behavior. No successful-path SQL flight is added.
The existing authority and pipeline LLPs record the refined lifecycle.

The held-marker HTTP witnesses remove the old hint after both warm requests
queue but before their final authority checks. While data is visible and the
marker is held, neither a hint nor an HTTP reply is published. A confirmed
marker releases replies and the candidate. A planted 23514 after data COMMIT
returns unknown without metadata or a hint; exactly the original two member
updates remain and no committed member reruns. The E four-member and chained
single-successor authority variants retain revocation/expiry/kind/generation,
Full-scope and store-binding refusal coverage. The matching-Read-hint arm now
obtains that hint through a certified query after the failed mutation evicts
its staged candidate.

The E two-slot witness asserts exactly 16 plan builds for 16 members while
both markers are held. Both E cascade-to-solo witnesses inherit LEV's exact
three-build assertion for their three original members. Physical fallbacks
revalidate fully in place and do not reconstruct a closure proof. Plans carry
neither authority nor D evidence. Existing crash, epoch, reader and outcome
witnesses remain in the focused suites.

Raw evidence is under `/tmp/g7er2-checks/` and the cluster ledger
`/tmp/g7er2-checks-clusters.jsonl`; no raw logs are committed. Cargo uses
this worktree's own target, line-tables-only dev/test profiles,
`CARGO_INCREMENTAL=0`, and `-j 6` (also `CARGO_BUILD_JOBS=6` for the script).
The previous own target was removed before rebuilding, as authorized.


### Development and transient observations

The first full-core command stopped at a type-conversion error in the newly
added test-only control observation (`ValueError` needed conversion into
`RuntimeError`). The helper was corrected before qualification continued;
the full core scope is rerun rather than counting this build failure as tests.

The first complete binary run reports **622 passed / 1 failed / 74 ignored**.
`verbs::witness::preparation::tests::stalled_resolver_sigint_is_bounded_journalled_and_drained`
misses its ten-second `descendant.pid` startup assertion. This entire source
file is byte-identical to `7e88aa041d`. An immediate isolated execution of
the same binary passes **1/0** in 1.5 seconds with no remaining recorded PID.
The initial failure is retained; it is unrelated to the E/LEV source delta.
Raw isolated evidence is under `/tmp/g7er2-resolver/`.


The initial four added HTTP E witnesses stopped at fixture setup (**0/4**):
E recovery was enabled before schema installation created `_head`. The fixture
now installs the schema first, enables E before creating readers, then starts
the host. The corrected four witnesses pass **4/0**, including both real marker
outcomes. This changes test setup only; raw corrected evidence is under
`/tmp/g7er2-http-rerun/`.


An attempted bare-binary serial diagnostic repeat overlapped the corrected
HTTP fixture Cargo rebuild, which replaced its executable while it was
running. Its child-executable launches then returned ENOENT: **599/24/74**.
This invocation is retained as an invalid qualification attempt, not treated
as 24 product regressions. The final serial run goes through Cargo after all
source edits stop. Raw diagnostic evidence is `/tmp/g7er2-binary-rerun/`.
The ENOENT failures were:

- `verbs::security::record::tests::a_witness_free_later_run_keeps_failures_and_does_not_promote_synthetic_evidence`
- `verbs::security::record::tests::review_labels_missing_stale_and_incomplete_evidence_and_strict_refuses_only_reachable_intent`
- `verbs::witness::background::tests::witness_passed_outcome_survives_post_driver_compression_failure`
- `verbs::witness::lookup_tests::app_lookup_preserves_safe_simctl_diagnostics`
- `verbs::witness::ownership::tests::partial_ownership_write_is_removed`
- `verbs::witness::preparation::tests::lease_preserves_an_existing_owner_and_releases_on_drop`
- `verbs::witness::preparation::tests::stalled_resolver_sigint_is_bounded_journalled_and_drained`
- `verbs::witness::preparation::tests::stalled_resolver_sigkill_triggers_watchdog_before_recovery`
- `verbs::witness::preparation::tests::stalled_resolver_sigterm_is_bounded_journalled_and_drained`
- `verbs::witness::preparation::tests::stalled_resolver_timeout_is_bounded_journalled_and_drained`
- `verbs::witness::publication::tests::witness_orphan_deletion_does_not_hold_the_publication_lock`
- `verbs::witness::publication::tests::witness_orphan_markers_recover_after_repeated_sigkill_and_retain_then_prune`
- `verbs::witness::publication::tests::witness_orphan_reconciliation_requires_all_leases_and_preserves_changed_identity`
- `verbs::witness::publication::tests::witness_pruning_cannot_delete_through_an_export_during_atomic_publication`
- `verbs::witness::publication::tests::witness_retention_recovers_verified_publication_without_a_later_publisher`
- `verbs::witness::publication::tests::witness_two_wrappers_killed_after_exchange_leave_only_survivors_verified_export`
- `verbs::witness::publication::tests::witness_wait_follows_publication_through_exchange_and_verify_without_an_older_pass`
- `verbs::witness::recovery::tests::abandoned_bulk_and_backend_wait_for_the_run_lease_and_reject_a_reused_pid`
- `verbs::witness::recovery::tests::discovery_of_an_unfinished_leased_export_keeps_maintenance_pending`
- `verbs::witness::recovery::tests::live_wrapper_lease_preserves_export_and_journal_after_driver_exit`
- `verbs::witness::recovery::tests::ownerless_shell_waits_only_for_live_leases_without_becoming_finished_evidence`
- `verbs::witness::recovery::tests::recovery_drains_a_live_preparation_descendant_before_finishing_even_with_a_live_wrapper`
- `verbs::witness::recovery::tests::retention_pins_current_and_pending_swap_generations_before_start_order`
- `verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock`


The final full binary run, after source edits stopped, passes
**623/0/74** (passed/failed/ignored), with `--test-threads 1` through Cargo and
the private evaluation connection. Raw final evidence is
`/tmp/g7er2-binary-final/`. All its recorded subprocesses have exited.


### Rebase 2 final check results

Counts are passed / failed / ignored, summed from the outer Cargo target
summaries so child-process summaries are not double-counted. Focused commands
use `--include-ignored`; the full core/binary commands retain their ordinary
explicit ignores. The failed preliminary commands are recorded above.

| Check | Passed | Failed | Ignored |
| --- | ---: | ---: | ---: |
| Full core, all targets and doctests | 1,309 | 0 | 518 |
| Full `snapback4` binary, final serial run | 623 | 0 | 74 |
| Core E suite, including ignored entries | 34 | 0 | 0 |
| HTTP E/LEV suite, including ignored entries | 4 | 0 | 0 |
| G7.2 suite, including E recovery variants | 40 | 0 | 0 |
| Core plan-reuse lever witnesses | 2 | 0 | 0 |
| Full HTTP RT3b/LEV authority witnesses | 87 | 0 | 0 |
| Core RT0 | 6 | 0 | 0 |
| HTTP RT0 | 10 | 0 | 0 |
| Full `bash scripts/test-postgres.sh`, Rust targets | 816 | 1 | 0 |
| E crash/kill matrix, including live PG revision reuse | 11 | 0 | 0 |

The binary build, SQLite-only feature check, and public serving in S and E pass.
Core RT0 retains three flights per eligible E batch, with marker in the data
COMMIT message, and S/E idle N=1 parity. The unchanged HTTP tables pass with
the ingress saving composed into the warm write rows.

The Postgres script exits 1 only for the declared inherited difftest
`both_stores_all_public_boundaries_and_write_observations`, with
`runtime_refused_unexpected {"E_INPUT": 6}`, plus the inherited stale
`experiments/postgres/Cargo.lock` at its evaluator stage. The latter prevents
that stage from reaching its known `40001` stress case; `40001` is not
observed in this run. No additional final Rust test red appears. The separate
initial resolver-startup failure and invalid concurrent-rebuild diagnostic
remain explicitly recorded above; the final complete binary is green.

`./ref-check --verbose` passes: **569 LLP docs,
12,031 references, zero errors and zero unchecked references**.

### Rebase 2 process custody and disk

All **4 private cluster directories**
independently confirm `pg_ctl status` 3 and no `postmaster.pid`. The final
combined audit includes **13,152 recorded
PID/birth pairs**, crash-child records, both explicit public-serving PID
ledgers and the check drivers. There is no match, including zombies, no live
recorded public-helper PID, and no executing check driver or executable from
this worktree's target. **PIDs left: none.**

At arrival `df -h` reported about 35 GiB available. Removing only this
worktree's authorized old target raised headroom before rebuilding. Across
all build/check monitors the minimum is **62.96 GiB**;
the final audit reports **63.09 GiB**, above the 25 GiB
stop floor. Raw evidence remains outside Git, including
`/tmp/g7er2-final-audit.json`. No push, stash, Git configuration change,
protected PG17/port-55440 or `~/q24` access, or throughput/S1 campaign occurs.

## G7-E fix round 2 — concurrent recovery breaks and certificate timeouts

Pinned input: `f9a870b2626d6b3ff53b5606e7539d445c5a4b9d` on
`sb4-pg/g7e-land`, already rebased on main `7e88aa041d`. These are fixes on
top of that input. Private PG16 only, own target, line-tables-only, cargo
`-j 6`, 25 GiB disk floor. No throughput/S1 campaign or push.

### P1: recovery keeps making progress while ownership remains

The stale-epoch rejection remains mandatory. Drained recovery errors now arm
another current-epoch fenced recovery on idle ticks, using exponential 10, 20,
40, …, 250 ms backoff. The lane clears its transient pause only after recovery
certifies D under the existing grant-before-D locks. It never clears uncertainty
from an old epoch, resurrects a read grant, reruns committed-unconfirmed data,
or treats drainage as durability. Both slots refresh before retrying.

The queue supplies a recovery guard backed by its independent ownership-loss
latch and conservative lease deadline. Loss prevents another attempt; an
already dispatched certificate remains uncancellable. Unacknowledged ticket
drainage/terminal fencing still requires acquisition, and does not arm a
recovery retry. Failed recovery cannot rerun a member while the lane is paused.
Program tasks and solo commands encountered during that pause receive explicit
`OutcomeUnknown`; no queued reply is silently dropped.

Failing-before evidence uses the pinned implementation plus only the test
rendezvous/new assertions:

| Witness | Before | Fixed behavior |
| --- | --- | --- |
| `g7e_concurrent_reader_break_during_recovery_retries_and_admits_writes` | One recovery attempt, then `superseded recovery permanently paused admission; attempts=1` | Reader thread breaks after each of three epoch samples; fourth recovery certifies; G6 uncertainty clears and a real queued mutation succeeds |
| `g7e_recovery_pending_queue_returns_unknown_and_lease_loss_stops_retries` | Queued program returns `Err(Stopped)` | Queued programs and solo receive explicit unknown; ownership-loss latch stops subsequent recovery attempts |

The first witness runs the same `break_history` entry as the reader connection
task, after the recovery sample and before certification, without closing the
writer socket. The second holds recovery while enqueueing waiters. It keeps
superseding attempts until the ownership-loss latch is set, and checks that
later idle ticks start no new attempts.

### P2: certificate transactions disable both local timeouts

The marker sets `synchronous_commit=on`, `statement_timeout=0` and
`lock_timeout=0` after its own BEGIN. Exact certificate command counts include
the two setting tags. Recovery sends all three settings with its COMMIT in the
existing message. Session defaults remain five seconds after the transaction;
no successful-path SQL flight was added.

| Witness | Before | Fixed behavior |
| --- | --- | --- |
| `g7e_marker_commit_wait_exceeds_session_statement_timeout` | Marker trigger observes inherited nonzero certificate timeouts and returns unknown | Asserts all three settings inside deferred COMMIT, waits 5.2 s, then certifies; session timeout restored |
| `g7e_marker_lock_wait_exceeds_session_lock_timeout` | Marker lock wait exceeds inherited 5 s limit and returns unknown | A rendezvoused advisory lock is held for 5.2 s; marker then certifies; session lock timeout restored |
| `g7e_recovery_commit_wait_exceeds_session_statement_timeout` | Deferred recovery COMMIT exceeds inherited 5 s limit and returns unknown | Deferred head trigger waits 5.2 s, checks all settings, and recovery installs D; session timeout restored |

The initial marker-COMMIT sleep alone passed before: that simple-query timer
behavior was not a decisive oracle. The final witness adds the in-transaction
settings assertion and fails before. Recovery's real timeout and the marker's
real lock timeout independently establish the slow-certificate failure.
These are slow COMMIT/lock witnesses, not a throughput experiment or a claim
about physical storage flush latency.

### f9a870b262 hint ordering audit

Reviewed member, chain, solo/barrier, retry, unknown, query, and queue-error
paths. Staging replaces its hint candidate on each attempt. A successful
mutation reaches the continuation only after its own certificate and ordered
release check; a break before that check yields unknown and evicts. A later
break cannot make an already certified/released observation belong to a lost
history. Certified query observations still pass the head-bound reader path.
Hints never authorize; final facts independently validate store, generation,
principal, kind and Full scope. A late failure eviction can remove a newer
certified hint, adding cold discovery work without changing authority.

The audit found one missing boundary: queue errors bypass the result
continuation, so its eviction never ran. The HTTP caller now evicts on that
error too. `g7e_lev_queue_rejection_evicts_warm_hint` fails before with
`queue failure bypassed the continuation and retained its hint`; fixed behavior
returns the ownership refusal without metadata and evicts the warm hint.
Existing held-marker success/unknown HTTP witnesses continue to cover
publication above D and after data COMMIT.

Before-run records remain local under `/tmp/g7ef2-before/` and
`/tmp/g7ef2-before2/`: 34 passed / 3 failed in the first E selection, then
0/1 for queued outcomes, 0/1 for the strengthened marker setting witness,
and 0/1 for the HTTP hint boundary. All six new witnesses fail before.
Both private before clusters confirm stopped with no recorded living PID.

### Requested checks

Full core and the Postgres script run concurrently in separate private PG16
clusters. The script is actually executed once by `/tmp/g7ef2-postgres.py`;
the sequential runner waits for its confirmed cluster cleanup and reuses that
result, after checking the source delta is unchanged. No code edits occur
during either run. Its raw output and custody records stay under
`/tmp/g7ef2-postgres/`; the other checks stay under `/tmp/g7ef2-after/`.
G7.2's two measurement bodies remain disabled (no `SNAPBACK4_G72_MEASURE=1`).

Checks completed 2026-10-26 (pass/fail counts):

| Check | Passed | Failed | Notes |
| --- | ---: | ---: | --- |
| Full core | 1,309 | 0 | 523 ignored; 49 targets |
| Full `snapback4` binary tests | 623 | 0 | 75 ignored |
| E core suite | 39 | 0 | All five new core witnesses included |
| E HTTP suite | 5 | 0 | New queue-error eviction plus held-marker levers |
| G7.2 | 40 | 0 | Measurement bodies disabled |
| Lever core / HTTP | 2 / 87 | 0 / 0 | Retained plans and fresh authority |
| RT0 core / HTTP | 6 / 10 | 0 / 0 | E retains three flights, marker in the final message |
| E crash/kill | 11 | 0 | Zero acknowledged-write loss; lost-history reader withheld; revision reuse |
| Postgres Rust targets | 816 | 1 | 26 targets; inherited `E_INPUT: 6` |

Full binary build, the SQLite-only feature check, and public serving in both
S and E pass. `bash scripts/test-postgres.sh` exits 1 solely for inherited
reds: difftest `stores::both_stores_all_public_boundaries_and_write_observations`
reports six unexpected `E_INPUT` refusals, and the evaluator workspace's stale
`experiments/postgres/Cargo.lock` refuses `--locked` before its known `40001`
stage can execute. No other red appears. Registry cache write/auto-clean
permission warnings are nonfatal.

`./ref-check --verbose`: 569 LLP documents, 12,033 references in 45205 files, **0 errors / 0 unchecked**.

The combined audit checks 12,623 recorded PID/birth pairs, including zombies, both public-helper PID ledgers, and executables under this worktree's target. All 7 private cluster directories confirm stopped (status 3 and no postmaster.pid). Minimum monitored free disk across before and after runs is 59.35 GiB, above the 25 GiB floor. **PIDs left: none.** No throughput campaign, publication or push. Raw records remain in `/tmp/g7ef2-*` and the named private witness directories; none are committed.
