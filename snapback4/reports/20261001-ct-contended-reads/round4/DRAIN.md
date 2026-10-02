# Real calibration backlog while builder probes run

Two fresh reversed-order trials per design/load. Identical stopped 6,507-task checkpoint including WAL. 23 calls/cohort, first three excluded from ranks. Responses must end before the last positive backlog observation.

| Busy | Endpoint | Demoted p50 / p95 ms (n) | Ordinary p50 / p95 ms (n) | Split p50 / p95 ms (n) | Paced p50 / p95 ms (n) | Paced vs split p95 |
|---:|---|---:|---:|---:|---:|---:|
| 0 | following500 | 4.102 / 7.408 (3060) | 3.668 / 7.246 (3419) | 3.632 / 7.248 (3860) | 3.108 / 5.606 (28484) | -22.7% |
| 0 | following5 | 3.756 / 7.010 (3060) | 3.336 / 7.117 (3400) | 3.365 / 6.656 (3860) | 3.035 / 5.376 (28480) | -19.2% |
| 0 | celebrityFollowing | 3.847 / 7.196 (3050) | 3.335 / 6.937 (3400) | 3.305 / 6.719 (3860) | 3.034 / 5.718 (28480) | -14.9% |
| 0 | globalSearch | 5.332 / 8.779 (3020) | 4.909 / 8.999 (3380) | 4.950 / 8.754 (3848) | 4.623 / 7.903 (28474) | -9.7% |
| 0 | insights | 0.995 / 1.583 (3020) | 0.915 / 1.506 (3380) | 0.901 / 1.494 (3840) | 0.853 / 1.409 (28460) | -5.7% |
| 0 | trending | 1.776 / 3.385 (3020) | 1.597 / 3.717 (3380) | 1.578 / 3.711 (3833) | 1.537 / 2.901 (28460) | -21.8% |
| 0 | busyPage1 | 1.359 / 2.415 (3020) | 1.251 / 2.337 (3380) | 1.237 / 2.763 (3820) | 1.178 / 2.161 (28460) | -21.8% |
| 0 | busyPage50 | 1.413 / 2.707 (3020) | 1.267 / 2.619 (3380) | 1.252 / 2.562 (3820) | 1.191 / 2.008 (28460) | -21.6% |
| 96 | following500 | 3.555 / 9.334 (8260) | 4.070 / 10.473 (3920) | 3.554 / 9.609 (9040) | 3.382 / 8.865 (43340) | -7.7% |
| 96 | following5 | 3.341 / 8.342 (8243) | 3.906 / 9.644 (3920) | 3.329 / 8.463 (9040) | 3.214 / 8.533 (43340) | +0.8% |
| 96 | celebrityFollowing | 3.301 / 8.161 (8240) | 3.784 / 10.325 (3911) | 3.210 / 8.308 (9040) | 3.169 / 8.574 (43320) | +3.2% |
| 96 | globalSearch | 4.944 / 10.285 (8228) | 6.846 / 12.386 (3880) | 4.966 / 10.674 (9040) | 4.978 / 11.081 (43320) | +3.8% |
| 96 | insights | 0.848 / 3.358 (8220) | 0.895 / 3.959 (3880) | 0.846 / 3.491 (9035) | 0.854 / 3.558 (43301) | +1.9% |
| 96 | trending | 1.542 / 5.042 (8220) | 1.787 / 5.419 (3880) | 1.527 / 5.026 (9018) | 1.545 / 5.144 (43300) | +2.4% |
| 96 | busyPage1 | 1.182 / 4.324 (8220) | 1.332 / 4.755 (3880) | 1.184 / 4.383 (9000) | 1.185 / 4.283 (43300) | -2.3% |
| 96 | busyPage50 | 1.203 / 4.450 (8220) | 1.355 / 4.878 (3880) | 1.206 / 4.532 (9000) | 1.203 / 4.234 (43300) | -6.6% |

## Drain completion

Completion includes server startup. Poll uncertainty brackets the final positive/first-empty observation. Host load is the one-minute OS average, including other tenants. Per-trial Following-500 p95 uses the same during-drain selection as the pooled table.

| Busy | Design | Trial | Tasks | Following-500 p95 ms | Completion s | Ready-to-empty s | Poll uncertainty ms | Host load start / end |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 0 | demoted | 1 | 6507 | 8.291 | 62.368 | 62.209 | 174 | 188.60 / 200.48 |
| 0 | demoted | 2 | 6507 | 5.019 | 30.391 | 30.290 | 146 | 20.59 / 14.61 |
| 0 | ordinary | 1 | 6507 | 8.138 | 67.676 | 67.515 | 180 | 195.25 / 162.59 |
| 0 | ordinary | 2 | 6507 | 4.792 | 30.449 | 30.348 | 146 | 30.87 / 21.95 |
| 0 | split | 1 | 6507 | 8.046 | 78.045 | 77.897 | 184 | 160.67 / 145.88 |
| 0 | split | 2 | 6507 | 4.873 | 31.151 | 31.048 | 146 | 53.15 / 32.95 |
| 0 | paced | 1 | 6507 | 5.638 | 712.475 | 712.321 | 172 | 144.45 / 156.61 |
| 0 | paced | 2 | 6507 | 4.894 | 32.443 | 32.365 | 144 | 94.35 / 56.65 |
| 96 | demoted | 1 | 6507 | 9.611 | 145.906 | 145.740 | 236 | 93.85 / 102.13 |
| 96 | demoted | 2 | 6507 | 8.782 | 113.714 | 113.587 | 190 | 13.60 / 88.92 |
| 96 | ordinary | 1 | 6507 | 10.319 | 78.507 | 78.325 | 236 | 93.89 / 100.83 |
| 96 | ordinary | 2 | 6507 | 10.591 | 70.319 | 70.140 | 167 | 86.79 / 96.79 |
| 96 | split | 1 | 6507 | 9.454 | 140.144 | 139.945 | 238 | 95.66 / 101.90 |
| 96 | split | 2 | 6507 | 9.653 | 147.438 | 147.252 | 235 | 94.35 / 100.96 |
| 96 | paced | 1 | 6507 | 8.786 | 819.789 | 819.590 | 239 | 166.67 / 102.65 |
| 96 | paced | 2 | 6507 | 9.033 | 551.717 | 551.541 | 235 | 93.44 / 100.42 |

All 952,200 sampled answers are retained. All eight settled endpoint hashes agree across every design, load and trial and with round 3. Every pristine DB/WAL manifest agrees, including round 3. During-drain answers may evolve. Pooled ranks weight samples, not trials; longer drains contribute more cohorts. Shared-host measurements do not establish causal isolation or Mac timing.
