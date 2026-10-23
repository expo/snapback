# Public Postgres deploy can exceed the 45-second witness guard on a shared host

Status: Open
Date: 2026-10-23
Scope: Snapback 4 configured public deploy, expo-build-450a
Related: LLP 3000.009.001.000 §3.4

The initial S10e-1 private runner timed out in the public stage's first
P1-CE Postgres deploy: `snapback4 deploy /tmp/s10d3-serve-h290of70/p1ce-postgres`
exceeded the unchanged 45-second `communicate` guard. The owned cluster was
stopped and independently confirmed. The original run did not record load or
deployment phase timings, so the timeout alone does not identify the cause.

The [P1-CE report](../snapback4/reports/20261023-p1-ce.md#verification-and-public-witness)
also records two 45-second guards at bootstrap and an out-of-profile deploy,
followed by a passing complete public witness. Do not raise the timeout or
convert any timed-out run into a pass.

Fix round 1 adds optional **test-harness-only** observations to
`scripts/test-postgres-serve.py`. Set
`SNAPBACK4_POSTGRES_WITNESS_TIMINGS=/absolute/path/to/timings.jsonl` to record
each command's elapsed time, exit code, `/proc/loadavg` at start/end and once
per second, plus observed deploy filesystem checkpoints: bootstrap intent,
store binding, candidate source and activation pointer. Checkpoints are sampled
every 20 ms and once at exit; they are upper-bound observations, not exact
internal function timings. No shipped binary or command semantics change.

The [S10e-1 report](../snapback4/reports/20261023-s10e1-evaluation-callers.md#fix-round-1--2026-10-23)
records three standalone public runs, host build snapshots, timing evidence and
cleanup. Evidence files live under this lane's
`snapback4/target/s10e1-fix1/public-{1,2,3}.*`, outside `/tmp`; owned fixture trees
and clusters are removed after their exit/PID checks.

### Initial Postgres deploy timings (debug CLI, seconds after spawn)

| Run | 1-minute load, start/end | Intent | Binding | Candidate source | Current pointer | Exit |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 11.47 / 11.28 | 16.561 | 17.518 | 17.558 | 17.702 | 17.735 |
| 2 | 7.34 / 8.39 | 16.554 | 17.798 | 17.859 | 18.005 | 18.026 |
| 3 | 6.75 / 6.57 | 16.249 | 17.019 | 17.059 | 17.202 | 17.220 |

All three initial deploys return success. Host snapshots show concurrent Cargo
builds in other lanes (`sb4-p0-s8` and `sb4-rt12f2`); this lane ran no other
build or test during these standalone stages. The host has 12 available CPUs.

The consistent 16.2–16.6 seconds before bootstrap is a **real slow preflight**,
not evidence that activation itself needs a larger guard. Initial bootstrap,
binding and activation together take another 0.97–1.47 seconds. The first two
program-only redeploys take 0.204 and 0.213 seconds. The same rule-changing
preflight appears before an expected bootstrap-binding failure and again on
recovery; SQLite's initial deploy also pays roughly 16 seconds.

Inference from call order: `verbs/configured_release.rs::deploy` runs
`security::release_loop` before writing the pending bootstrap intent, and
`verbs/security.rs::report` uses a bounded 1,500-work security campaign. This
matches the long pre-bootstrap and pre-candidate intervals and the fast
program-only redeploy. Filesystem observations do not time that function
directly, so this is a root-cause candidate for profiling, not a claimed proof.
The 45-second timeout has not reproduced in these initial deploys, and the
earlier run lacks load evidence: **do not attribute the historical failure to
load alone**. Profile this bounded preflight under the debug witness's build
settings and retain the existing review behavior and 45-second guard.


All **three complete public stages pass**, including both-store P1-CE wire
comparison, bootstrap recovery/refusals, ownership takeover/restart, program
release and P1-MC recount. Each runs 241–243 subprocess commands (HTTP requests
are additional); no command exceeds 18.026 seconds. Maximum command times are
17.768, 18.026 and 17.220 seconds respectively. All owned postmasters, command
children and serving PIDs are confirmed gone; all three scratch trees/clusters
are removed. The report records the exact per-run process and timing summaries.
The historical timeout remains open for profiling; these successful runs do
not explain or erase it.


## 2026-10-23 — P1-EV-2 fix round 1 occurrence

The stock Postgres runner reproduced the same guard at initial P1-CE deploy:
`/tmp/s10d3-serve-hppa948o/p1ce-postgres` exceeded 45 seconds. Both EV-1 and EV-2
public lifecycle/wire witnesses passed earlier in that stage. The timed-out
child was killed/waited by the existing harness, every recorded serving PID is
gone, and the owned PG16 cluster is confirmed stopped (status 3, no pidfile).
The main evaluation cluster is also confirmed stopped. The failed run has no
phase/load timing evidence, so no causal load attribution is made. The command
guard, workload and runner remain unchanged. The
[EV-2 fix-round report](../snapback4/reports/20261023-p1-ev2.md#fix-round-1--2026-10-23)
records the unchanged-bound standalone rerun; raw evidence stays outside Git
under `/tmp/sb4-p1ev2-fix1/`.

The complete standalone rerun passes with the same 45-second guard in 438.89
seconds. All 519 timed subprocess commands complete within 34.111 seconds;
both-store P1-CE, ownership/recovery and S1 recounts pass. The optional timing
observer is unchanged. Its private PG16 cluster is stopped and independently
confirmed; all recorded children are gone. The original timeout remains red
and unexplained, with no causal load claim.
## 2026-10-23 — RT3c, SQLite dormant restoration in the public runner

On expo-build-450b above `d20fbe09b2`, the unchanged stock Postgres script
passed the three-version Postgres release-evolution witness, then timed out at
45 seconds in the SQLite half's `deploy --restore-dormant` (version 3).
The wrapper killed and waited for that command and completed cluster cleanup.
An independent audit found all 93 recorded PIDs absent, `pg_ctl status` 3 and
no `postmaster.pid`. Raw evidence remains outside Git in `/tmp/sb4-rt3c/`
and `/tmp/s10d3-serve-4y38fmlv/`.

The lane's full default core suite was also active, and other host Cargo
processes were observed. This run did not enable the optional phase timings;
concurrency alone does not establish the cause. The RT3c production delta
only extends the request authority kind allowlist; it does not change deploy,
security preflight or dormant restoration. The 45-second guard is unchanged.

The subsequent unchanged standalone public stage passes in full, with the
optional timing observations enabled and no other build/test from this lane
running. All 442 timed commands finish inside the original guard; the maximum
is 17.575 seconds. Both PostgreSQL and SQLite three-version evolution and wire
comparison pass, followed by bootstrap refusal/recovery, change evidence/SDK
sync, ownership restart/takeover and the maintained-total recount. The retry's
465 recorded PIDs are independently absent; its PG16 master has status 3 and
no pid file. Timings remain in `/tmp/sb4-rt3c/public-rerun-timings.jsonl`.
This passing retry does not explain or erase the original SQLite timeout.
