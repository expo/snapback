# Round 0 → round 1

Identical harness and 20 trials per flow/configuration. Cells are p50 / p95 ms from server commit to public SDK publication; delta is round-1 minus round-0 p95. Values use nearest rank, three decimals. Shared-host run-to-run variation is included.

## Idle

| Flow | Wasm R0 | Wasm R1 | Δ p95 | Process R0 | Process R1 | Δ p95 |
|---|---:|---:|---:|---:|---:|---:|
| profile | 21.137 / 25.024 | 21.269 / 23.962 | -1.062 | 36.636 / 45.385 | 34.464 / 39.008 | -6.377 |
| reaction-add | 21.377 / 25.871 | 23.964 / 25.916 | +0.045 | 35.645 / 44.975 | 63.423 / 80.995 | +36.020 |
| reaction-replace | 21.501 / 25.669 | 24.534 / 25.629 | -0.040 | 34.316 / 36.870 | 40.257 / 68.505 | +31.635 |
| reaction-remove | 22.120 / 23.745 | 24.187 / 25.589 | +1.844 | 28.782 / 33.039 | 37.884 / 63.884 | +30.845 |
| reply | 53.293 / 57.287 | 60.635 / 74.913 | +17.626 | 67.629 / 72.809 | 80.288 / 91.646 | +18.837 |
| photo | 54.219 / 66.226 | 62.151 / 65.987 | -0.239 | 67.808 / 77.656 | 95.451 / 111.262 | +33.606 |
| feed-image | 27.260 / 35.493 | 28.546 / 34.750 | -0.743 | 54.687 / 75.994 | 61.192 / 81.522 | +5.528 |
| once-photo | 52.470 / 60.820 | 60.673 / 65.802 | +4.982 | 66.565 / 83.178 | 96.293 / 127.304 | +44.126 |

Reaction-add operation counts (trial-wide p50 / p95, not a single watch):

| Tier | Queries R0 → R1 | Before-apply queries R0 → R1 | Asset-home reads R0 → R1 |
|---|---:|---:|---:|
| wasm | 20 / 20 → 40 / 40 | 0 / 0 → 20 / 20 | 0 / 0 → 0 / 0 |
| process | 17 / 20 → 56 / 63 | 0 / 0 → 24 / 32 | 0 / 0 → 0 / 0 |

## Four CPUs and three busy workers

| Flow | Wasm R0 | Wasm R1 | Δ p95 | Process R0 | Process R1 | Δ p95 |
|---|---:|---:|---:|---:|---:|---:|
| profile | 22.610 / 33.701 | 25.434 / 37.326 | +3.625 | 41.031 / 60.594 | 42.133 / 50.360 | -10.234 |
| reaction-add | 28.403 / 36.146 | 29.781 / 35.848 | -0.298 | 44.285 / 47.461 | 93.957 / 115.416 | +67.955 |
| reaction-replace | 23.059 / 37.733 | 28.821 / 37.272 | -0.461 | 41.745 / 49.793 | 92.237 / 101.723 | +51.930 |
| reaction-remove | 24.467 / 31.223 | 25.918 / 32.360 | +1.137 | 39.523 / 47.171 | 87.600 / 96.613 | +49.442 |
| reply | 57.501 / 65.700 | 61.515 / 73.260 | +7.560 | 89.367 / 111.215 | 145.809 / 180.047 | +68.832 |
| photo | 58.841 / 64.119 | 59.694 / 69.136 | +5.017 | 88.043 / 111.088 | 142.876 / 163.936 | +52.848 |
| feed-image | 34.214 / 42.901 | 30.896 / 42.422 | -0.479 | 60.583 / 74.922 | 62.950 / 79.440 | +4.518 |
| once-photo | 57.171 / 65.879 | 62.962 / 71.544 | +5.665 | 95.489 / 118.846 | 149.826 / 174.082 | +55.236 |

Reaction-add operation counts (trial-wide p50 / p95, not a single watch):

| Tier | Queries R0 → R1 | Before-apply queries R0 → R1 | Asset-home reads R0 → R1 |
|---|---:|---:|---:|
| wasm | 20 / 20 → 40 / 43 | 0 / 0 → 20 / 20 | 0 / 0 → 0 / 0 |
| process | 18 / 20 → 64 / 67 | 0 / 0 → 33 / 39 | 0 / 0 → 0 / 0 |
