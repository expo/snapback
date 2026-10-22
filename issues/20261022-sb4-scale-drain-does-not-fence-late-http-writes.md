# Scale harness drain does not establish quiescence for late HTTP writes

Status: Open
Date: 2026-10-22
Scope: Snapback 4 scale experiment, S1-PG2; no confirmed product corruption
Related: LLP 3000.009.001.002 §6; results-20261022-snapback-postgres-2

Two native service-authorized identity writes cross the serving FIFO after
load, followed by stable counter snapshots. These witnesses do not establish
that every admitted HTTP mutation has reached and left that FIFO. The final
cross-trial audit finds eight additional counter increments in four gaps:

| Previous trial / next trial | Gap | Previous after / next before |
|---|---:|---:|
| Natural W5 same, 100/s r0 / r1 | 2 | 11849 / 11851 |
| Delayed W4, 400/s r2 / 200/s r0 | 4 | 31678 / 31682 |
| Delayed W5 hot1, 3200/s r2 / 1600/s r0 | 1 | 40336 / 40337 |
| Delayed W5 hot1, 800/s r1 / r2 | 1 | 41350 / 41351 |

Every adjacent trial already fails latency/errors/unknown outcomes. The final
counter sum is 46072 and reconciles exactly after including these gaps. No
aggregate acknowledgement deficit or maintained-total/recount mismatch appears.
These are unkeyed operations: the counts cannot identify which request supplied
an increment, or detect a compensating lost/extra pair. No product patch here.

Reproduce from the archived S1-PG2 campaign (see its ARCHIVE.md), or launch the
full native campaign detached with `setsid nohup` as in scale-controls/README.md.
Use the unchanged app, C=32, 10 s warm-up / 20 s measurement and the same rate
ladder. For a small diagnostic, retain the native seed and run the 100/s natural
W5-same repetitions, recording each before/after counter image and the next
before image. Check other cluster activity first; record PIDs and stop only
owned processes. This is timing-sensitive; the retained capture is the witness,
not a guaranteed deterministic eight-increment reproduction. No HTTP error code
identifies spillover; overloaded requests include explicit 503 admissions and
request deadline/error outcomes.

Follow-up: define a drain/fence that covers admitted HTTP work, or qualify the
cell with a separately witnessed quiescent end. Investigate requests not yet
queued at the engine; the present capture does not assign individual requests.
Do not silently add operation IDs, change the measured request class, retry
timed mutations or discard late increments. The reporter now exposes gaps and
checks that both adjacent trials were already unqualified; individual snapshot
interval rates are diagnostics, not fully isolated cohort throughput.
