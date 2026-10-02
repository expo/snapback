# Round-2 corrected combined results

All cells use 125 real-clock seconds of reads plus ongoing writes, supervised effects, expiry, fixed-lease abandonment and minute jobs. Slow effects are emitted after the advance. Timings are nearest-rank percentiles over every successful continuous read, with no sample dropping.

| Variant | Busy | Reads | p50 / p95 ms | Abandoned observed / expected | Job boundaries | Lease recovery max ms | Physical expiry max ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| before | 0 | 223110 | 0.530 / 0.701 | 6 / 6 | 2 | 4633 | 1075 |
| before | 48 | 241276 | 0.531 / 0.631 | 6 / 6 | 3 | 3565 | 1070 |
| before | 96 | 60107 | 1.981 / 4.199 | 6 / 6 | 2 | 4739 | 1084 |
| before | 144 | 51338 | 2.188 / 4.616 | 6 / 6 | 2 | 4449 | 1102 |
| restored | 0 | 231018 | 0.462 / 0.718 | 6 / 6 | 2 | 4601 | 1075 |
| restored | 48 | 328104 | 0.345 / 0.506 | 6 / 6 | 2 | 3171 | 1118 |
| restored | 96 | 149827 | 0.494 / 3.425 | 6 / 6 | 2 | 5072 | 1142 |
| restored | 144 | 164606 | 0.479 / 3.185 | 6 / 6 | 3 | 4586 | 1149 |
| demoted | 0 | 195704 | 0.604 / 0.722 | 6 / 6 | 2 | 4787 | 1104 |
| demoted | 48 | 335697 | 0.349 / 0.415 | 6 / 6 | 2 | 3288 | 1083 |
| demoted | 96 | 184455 | 0.471 / 2.163 | 6 / 6 | 2 | 4664 | 1112 |
| demoted | 144 | 160002 | 0.474 / 3.440 | 6 / 6 | 2 | 3551 | 1099 |

## Maintenance-priority comparison

Only maintenance priority differs between these candidates; this is the small expiry/maintenance fixture, not the eight calibration endpoints.

| Busy | Restored p50 / p95 ms | Demoted p50 / p95 ms | Restored vs demoted p50 / p95 |
|---:|---:|---:|---:|
| 0 | 0.462 / 0.718 | 0.604 / 0.722 | 0.766× / 0.994× |
| 48 | 0.345 / 0.506 | 0.349 / 0.415 | 0.986× / 1.219× |
| 96 | 0.494 / 3.425 | 0.471 / 2.163 | 1.049× / 1.583× |
| 144 | 0.479 / 3.185 | 0.474 / 3.440 | 1.012× / 0.926× |

## Observed maintenance commits

| Variant | Busy | Work | Commits |
|---|---:|---|---:|
| before | 0 | job / pulse | 2 |
| before | 0 | sweep / expire | 120 |
| before | 48 | job / pulse | 3 |
| before | 48 | sweep / expire | 120 |
| before | 96 | job / pulse | 2 |
| before | 96 | sweep / expire | 118 |
| before | 144 | job / pulse | 2 |
| before | 144 | sweep / expire | 117 |
| restored | 0 | job / pulse | 2 |
| restored | 0 | sweep / expire | 119 |
| restored | 48 | job / pulse | 2 |
| restored | 48 | sweep / expire | 121 |
| restored | 96 | job / pulse | 2 |
| restored | 96 | sweep / expire | 118 |
| restored | 144 | job / pulse | 3 |
| restored | 144 | sweep / expire | 119 |
| demoted | 0 | job / pulse | 2 |
| demoted | 0 | sweep / expire | 119 |
| demoted | 48 | job / pulse | 2 |
| demoted | 48 | sweep / expire | 120 |
| demoted | 96 | job / pulse | 2 |
| demoted | 96 | sweep / expire | 119 |
| demoted | 144 | job / pulse | 2 |
| demoted | 144 | sweep / expire | 119 |
