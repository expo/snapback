All 28 final measurement runs exited 0. The unchanged round-3 methods retain
the 96-CPU host, 125-second mixed read windows, published 0.4.10 client,
23-call cohorts with the first three excluded, and independent SQLite queue
observation. No lane build or test overlapped timing. Other tenants remained
active; zero owned busy processes does not mean a quiet host. Exact binaries
and source hashes are in `round4/custody.json`.

The full mixed outcomes in `round4/MIXED.md` reproduce lease recovery, expiry,
schedule admission/execution, retries and deadlines. Eight small split/paced
cells retain 1,460,558 reads; four paced Following cells retain 657,361.
All 72 abandoned claims were observed, no lease changed unexpectedly, and
every explicit clock extension was exactly 1,000 ms. No consistent small-
fixture latency win is established: at 144 busy, paced p95 was 3.633 ms
versus split 0.917 ms. Small-fixture controls remain in round 3.

| Busy | Small split / paced read p95 ms | Paced with 1,000 Following tasks: read p95 during drain ms | Following drain s |
|---:|---:|---:|---:|
| 0 | 0.716 / 0.716 | 0.751 | 143.037 |
| 48 | 1.983 / 1.481 | 1.348 | 220.737 |
| 96 | 3.326 / 3.354 | 3.041 | 693.048 |
| 144 | 0.917 / 3.633 | 5.318 | 1177.746 |

Synthetic busy processes remained alive throughout the combined drain tail;
reads ended after 125 seconds. All expected schedule boundaries completed,
including twenty in the 144-process cell. This table is not a claim about
read latency after its read window.

The real 6,507-task checkpoint has sixteen fresh restorations: two trials of
each design at 0/96 busy, reversing design order. All DB/WAL manifests and
all eight settled answer hashes agree with round 3. The 952,200 raw probe
samples and full ranks, counts and poll brackets in `round4/DRAIN.md` remain.
Pooled **during-drain read p95**, in milliseconds:

| Busy | Endpoint | Demoted | Ordinary | Split | Paced | Paced vs split |
|---:|---|---:|---:|---:|---:|---:|
| 0 | following500 | 7.408 | 7.246 | 7.248 | 5.606 | -22.7% |
| 0 | following5 | 7.010 | 7.117 | 6.656 | 5.376 | -19.2% |
| 0 | celebrityFollowing | 7.196 | 6.937 | 6.719 | 5.718 | -14.9% |
| 0 | globalSearch | 8.779 | 8.999 | 8.754 | 7.903 | -9.7% |
| 0 | insights | 1.583 | 1.506 | 1.494 | 1.409 | -5.7% |
| 0 | trending | 3.385 | 3.717 | 3.711 | 2.901 | -21.8% |
| 0 | busyPage1 | 2.415 | 2.337 | 2.763 | 2.161 | -21.8% |
| 0 | busyPage50 | 2.707 | 2.619 | 2.562 | 2.008 | -21.6% |
| 96 | following500 | 9.334 | 10.473 | 9.609 | 8.865 | -7.7% |
| 96 | following5 | 8.342 | 9.644 | 8.463 | 8.533 | +0.8% |
| 96 | celebrityFollowing | 8.161 | 10.325 | 8.308 | 8.574 | +3.2% |
| 96 | globalSearch | 10.285 | 12.386 | 10.674 | 11.081 | +3.8% |
| 96 | insights | 3.358 | 3.959 | 3.491 | 3.558 | +1.9% |
| 96 | trending | 5.042 | 5.419 | 5.026 | 5.144 | +2.4% |
| 96 | busyPage1 | 4.324 | 4.755 | 4.383 | 4.283 | -2.3% |
| 96 | busyPage50 | 4.450 | 4.878 | 4.532 | 4.234 | -6.6% |

Drain completion includes startup; two trials are shown separately:

| Busy | Design | Trial 1 s | Trial 2 s |
|---:|---|---:|---:|
| 0 | demoted | 62.368 | 30.391 |
| 0 | ordinary | 67.676 | 30.449 |
| 0 | split | 78.045 | 31.151 |
| 0 | paced | 712.475 | 32.443 |
| 96 | demoted | 145.906 | 113.714 |
| 96 | ordinary | 78.507 | 70.319 |
| 96 | split | 140.144 | 147.438 |
| 96 | paced | 819.789 | 551.717 |

At 96 busy, paced beats ordinary-all p95 on all eight endpoints and split on
three, with five split regressions of 0.8–3.8%. Following-500 improves 7.7%
against split, but drain costs 3.7–5.9 times as long. This is a substantial
throughput tradeoff, not a universal read improvement. At zero owned busy,
paced pooled p95 is lower on all eight endpoints, but its first trial takes
712.475 seconds and its second 32.443. Their host load averages start/end at
144.45/156.61 and 94.35/56.65 respectively. The load-triggered pacing policy
and shared-host variation preclude a quiet-host or causal-isolation claim.
Longer drains also contribute more cohorts and observe intermediate feed
states longer, so pooled ranks weight samples, not trials.

Two disclosed supplemental read-only SQLite snapshots checked long-running
cells (144-process mixed: 307 pending, 5.976 ms; first paced zero-busy real
drain: 425 pending, 76.403 ms). They are retained separately and never used
as latency samples or drain endpoints; their possible interference with
nearby probes is not erased. Darwin timing remains the operator’s work.
