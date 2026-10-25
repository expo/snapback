# G7.2 fix round 1

Base: `069520dc2316d1ba3775f7227398e16021b14de3`, branch
`sb4-pg/g72-fix1`, local worktree `/home/ccheever/projects/sb4-land3`.
This resumes the preserved uncommitted implementation after the first run
stopped below its disk floor. Both reviews of the base requested changes.
The governing design is accepted LLP 3000.009.001.000.000.002 revision 4,
particularly §§3.1, 4.2 and 8.1–8.2. No push or history rewrite is performed.

## Fixes and failing-before evidence

The negative results below are retained from the interrupted first run under
`/tmp/g72f1`; the continuation's raw evidence is under `/tmp/g72f1r`. Raw logs
are not committed. The new tests and the final policy are retained in source.

| Item | Change | Pre-fix result |
| --- | --- | --- |
| SQLite feature gate | Gate `program_pipeline` with `feature="sqlite"`, matching `program_batch` and its dependencies | Device and browser configurations fail with E0433 (`committer`) and E0432 (`receipts`); both compile after the gate |
| Successor's own named failure | After drainage, use the predecessor's original terminal result, not the existence of a frozen chain, to decide whether a cascade occurred | `g72_successor_own_23505_after_predecessor_commit_matches_depth_one` fails because valid A receives B's E_STORE; the test runs both depth-one and held-predecessor depth-two routes |
| Successor's own deadline | Keep ordinary per-member recovery when the predecessor committed | `g72_successor_own_expired_member_solo_retries_peer_with_time_left` fails because A receives the shared expired-deadline error despite retaining time |
| Cascade fallthrough, dispatched | The innocent whole-batch retry consumes the group fallback; on a second known failure, drop the named/expired members and retry remaining members alone once | `g72_dispatched_cascade_second_failure_falls_through_to_solo` fails because A receives B's deterministic 23505 |
| Cascade fallthrough, undispatched | Apply that same bounded fallthrough to the pre-final staging path | `g72_undispatched_cascade_second_failure_falls_through_to_solo` fails in the same way |
| Pipeline-aware fill | Postgres depth two dispatches available FIFO members at the first empty mailbox, without predicted-arrival waiting; N≤32 and the 1 ms upper bound remain | `pipeline_fill_starts_available_work_without_waiting_for_the_cap` fails because the old policy waits for more work |

The four pre-fix recovery tests record **0 passed / 4 failed**; the fill
policy test records **0 / 1**. Recovery tests inject a real PostgreSQL 23505
at the named-member boundary on every relevant attempt. They verify A has
one durable receipt, B has none, the head is contiguous, and the final state
matches the serial oracle. Both cascade tests establish the original
predecessor xid is aborted; the dispatched case also establishes the original
successor xid is aborted. The deadline test retains the original member
deadlines and checks the peer with time left survives.

After the whole-batch cascade attempt, an unknown outcome remains terminal;
only known aborts permit solo recovery, and a solo failure never recurses.
The original predecessor outcome remains available even if its own fallback
subsequently commits. The pipeline module gate has no PostgreSQL dependency
in browser/device builds without SQLite.

The fill policy also applies between Postgres depth-two flights, avoiding
repeated collection of all 32 returning clients into a single wave. Depth one
and SQLite retain the existing predicted-arrival policy. An idle arrival never
waits; the collector retains FIFO barriers and its existing target/cap/window.
`BatchStats` now records dispatch counts indexed by outstanding batch count,
including the dispatched batch. These are event samples of unreleased batches,
not a time-weighted server-transaction occupancy distribution.

## Verification

All direct Cargo commands use this worktree's `snapback4/target`,
`CARGO_PROFILE_DEV_DEBUG=line-tables-only`,
`CARGO_PROFILE_TEST_DEBUG=line-tables-only`, `CARGO_INCREMENTAL=0`, and
`-j 24`; scripts inherit `CARGO_BUILD_JOBS=24`. No
`--workspace --all-targets` build is used. PG16 runs in private clusters with
short Unix socket paths. Counts below are direct target summaries, excluding
nested crash-child summaries; ignored tests are not passes.

| Check | Passed / failed / ignored, or build result |
| --- | --- |
| Full core, Postgres feature, 49 direct targets | 1,278 / 0 / 480 |
| Full `snapback4` binary | 608 / 0 / 57 |
| Focused G7.2, including ignored entries | 33 / 0 / 0 |
| Core RT0 ratchet | 4 / 0 / 0 |
| HTTP RT0 ratchet | 9 / 0 / 0 |
| Explicit loopback measurement | 1 / 0 / 0; twelve measured cells |
| Core build without default features | PASS |
| Device build without default features | PASS |
| Native device build | PASS |
| Browser build, `bash scripts/build-wasm.sh` | PASS; 2,415,227 B raw, 738,071 B gzip, under 738,490 B budget |
| `bash scripts/test-postgres.sh`, 36 Rust targets | 847 / 2 / 0; two socket-only TCP qualification refusals |
| Public Postgres serving milestone in that script | PASS; release/recovery/ownership, wire parity and row recounts |
| Final `./ref-check --verbose` | PASS; 569 LLPs, 11,984 references, zero errors or unchecked references |
| `git diff --check` | PASS |

The socket-only cluster cannot qualify two existing TCP witnesses:
`engine::postgres::pipeline::tests::pipeline_on_wire_overlap_precedes_release_and_backend_termination`
and
`engine::postgres::pipeline::tests::pipeline_tcp_nodelay_on_reader_and_synchronous_writer`.
Both explicitly refuse socket-only input, before making their TCP claims.
They remain failures in the complete script's result; they are not counted as
passes or silently skipped. The companion socket-only-refusal witness passes.
The inherited evaluator `40001` stress case passes in this run.

The core and binary summaries exclude their nested subprocess summaries.
The focused suite's two measurement entry guards return without measurement
unless explicitly enabled; the loopback entry is separately enabled above.
The fill-policy witness also passes in the full core suite. All changed code
is covered by these final-source runs. The binary is built before its suite,
so tests using the CLI worker helper have the real helper available.

## Relative loopback measurement

The explicit queue-level harness compares depth one and two with 32
closed-loop clients, a fixed cap of 32, 256 warmup writes and 1,280 measured
writes per cell/depth/repetition. Two repetitions reverse depth order. W4
uses one key per client, W5-exact one shared key, and W5-mix nominal 1% shared
requests. Every cell reconciles all 1,536 writes with durable counters.
The harness excludes HTTP/session ingress and uses the same synchronous
three-flight commit path. `fsync`, `synchronous_commit` and
`full_page_writes` remain on. There is no S1 or publication qualification.

This continuation uses the private PG16 Unix socket `/tmp/g72f1r`, port
55439. The host exposes 96 CPUs; one-minute load at the twelve cell boundaries
is 84.03–84.21. Start load averages are 84.21 / 95.54 / 78.13 and end averages
84.03 / 95.32 / 78.15. The entire measurement test takes 6.74 s, including
fixture setup. The sample is short and the shared host is noisy; only local
relative observations follow. All twelve counter totals are 1,536 and all
three durability settings are `on`.

| Cell | Writes/s d=1 → d=2 | Relative rate | Mean latency ms d=1 → d=2 | Mean N d=1 → d=2 |
| --- | --- | --- | --- | --- |
| W4 | 4,434 → 4,551 | +2.6% | 7.081 → 6.817 | 30.48 → 15.24 |
| W5-exact | 4,531 → 4,803 | +6.0% | 6.917 → 6.579 | 30.48 → 15.42 |
| W5-mix | 4,602 → 4,811 | +4.5% | 6.858 → 6.499 | 31.22 → 15.33 |

Rates divide 2,560 measured writes by summed elapsed time; latency averages
the equal-sized repetitions. Mean N weights the exact batch histogram.

| Cell / depth | Outstanding=0 | Outstanding=1 | Outstanding=2 | Share at 2 |
| --- | --- | --- | --- | --- |
| W4 / 1 | 0 | 84 | 0 | 0.0% |
| W4 / 2 | 0 | 4 | 164 | 97.6% |
| W5-exact / 1 | 0 | 84 | 0 | 0.0% |
| W5-exact / 2 | 0 | 2 | 164 | 98.8% |
| W5-mix / 1 | 0 | 82 | 0 | 0.0% |
| W5-mix / 2 | 0 | 3 | 164 | 98.2% |

These are outstanding-batch counts at dispatch, including the new batch;
zero is consequently empty. Completed-but-unreleased predecessors count.

| Cell / depth | N=1 | N=2–7 | N=8–15 | N=16–23 | N=24–31 | N=32 |
| --- | --- | --- | --- | --- | --- | --- |
| W4 / 1 | 1 | 2 | 1 | 0 | 17 | 63 |
| W4 / 2 | 24 | 32 | 31 | 29 | 52 | 0 |
| W5-exact / 1 | 2 | 1 | 1 | 0 | 13 | 67 |
| W5-exact / 2 | 1 | 13 | 71 | 71 | 10 | 0 |
| W5-mix / 1 | 0 | 2 | 0 | 0 | 5 | 75 |
| W5-mix / 2 | 32 | 53 | 2 | 0 | 80 | 0 |

Depth two overlaps outstanding batches in all measured cells; all members
remain under the 32 cap. The small throughput differences and short sampling
do not establish a general speedup, a link-A/B result, or an S1 rung.


## Process and disk custody

The continuation records PID/birth identities for its private postmaster,
descendants and command roots; the serving script's private-cluster announcement
adds that postmaster to the same ledger. A disk guard checks `/` throughout and
stops owned work below 30 GiB. Only recorded processes may be signalled.
The first run already independently confirmed all of its 317 recorded
PID/birth instances absent before this continuation.

The continuation's evaluation postmaster is PID 394955; the public-serving
postmaster is PID 1137139 under `/tmp/s10d3-serve-63v_t1rt`. Both private
clusters independently return `pg_ctl status` 3 with no `postmaster.pid`.
The public script also reports its successful stop independently.

After all command drivers and the monitor exit, the final audit finds all
**8,732 continuation PID/birth instances absent**, all **317 previous-run
instances absent**, and all **537 explicit public-script PID records absent**.
There are no zombies, live matches or reused PIDs in these ledgers. **PIDs left:
none.** Minimum recorded free disk is **123.83 GiB**, and the final audit sees
**128.77 GiB** free; the 30 GiB guard never fires. No target cleanup is needed.
No push, stash, Git configuration change or unowned signal occurs.
