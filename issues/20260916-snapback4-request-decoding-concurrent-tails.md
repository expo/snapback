# Snapback 4: request decoding leaves concurrent point and replay tails unresolved

Status: Open — periphery performance follow-up
Owner: Snapback 4 performance lane
Priority: P2
Date: 2026-09-16 (UTC)

The adopted host copy removal has repeated serial JSON latency/throughput
gains and lower large-argument RSS observations, but the fixed 0.2.23 native
Linux A/B also measures the following regressions. These are unresolved
observations, not established noise or proof of their cause.

| Case | Metric | Baseline → candidate | Paired outcome |
|---|---|---:|---|
| Point C32 | p95 median | 17.865 → 24.800 ms (+38.82%) | worse in 2/3 |
| Point C32 | rate median | 4,557.1 → 4,178.5 requests/s (-8.31%) | worse in 2/3 |
| Replay C8 | p99 median | 9.593 → 10.104 ms (+5.33%) | worse in 3/3 |
| Replay C8 | maximum median | 9.702 → 10.243 ms (+5.57%) | worse in 3/3 |
| Synthetic skipped branch C1 | maximum median | 8.841 → 10.516 ms (+18.94%) | worse in 3/3 |
| Post-large point C8, trial 1 | p99 | 1.475 → 7.107 ms (+381.99%) | individual loss |
| Same trial/case | maximum | 1.887 → 7.287 ms (+286.07%) | individual loss |

Point C32 loses all six case-median metrics. Post-point trial-1 rate also
falls 8.73%. The complete result retains every 35 median and 126 paired
metric loss (elapsed and rate are counted separately). All 64,512 timed
requests, 4,032 warmups, ordinary-auth/full-row/write/replay assertions and
original process cleanup passed; both frozen calculators' first results
reconcile. Fixed source is `1bf70d0e9db8031c284064bb8d093d77d9ce574e`, with
only the host override `8f12b805…`; formal complete is `751f4556…`.

Use the [full record](../benchmarks/runs/snapback4-public-catalog-20260913/README.md)
and its [original data](../benchmarks/runs/snapback4-public-catalog-20260913/request-metadata-0223-v1.jsonl).
The fresh processes run cases in fixed order, ordinary bodies serialize
inside latency and echo bodies are prebuilt. Exact oracles follow each
request timer but remain in elapsed rates and can delay overlapping Node
continuations. Post-large probes have 32 warmups; they do not measure the
immediate next response. Reported HWM is not a validated continuous peak.

Next, distinguish server request work, connection/client scheduling and
allocation/collection around the affected cases, keeping the full original
losses and controls. Preserve this original result when running new
diagnostics. Keep existing ceilings and fresh authority checks; the closed
worker/sync-pool efforts remain closed. Any changed instrument or new runtime
round needs a distinct frozen identity and complete original outcome.

Close after reviewed comparable evidence resolves these tails or records a
concrete measured disposition explaining the remaining limitation. Lower
aggregate median counts alone do not close the ticket.
