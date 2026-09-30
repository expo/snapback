# LL live-path measurements

Twenty repetitions of eight unchanged flows per cell, four pinned CPUs, viewed-media retention. The before column is the prior round’s final measurement; the after column is this round on merged main. Host load, SDK/server versions and timing differ, so this is not a paired causal speedup comparison. Zero workers means no harness busy workers, not an idle host. The instrumented server binary is the same retained measurement binary used in round 2 (hash in LL-FINAL-INPUTS.json); the production process device is rebuilt from the merge.

| Tier / workers | Round 2 maximum flow p95 | Round 3 maximum flow p95 | Round 3 timeouts |
|---|---:|---:|---:|
| wasm / 0 | 49.887 | 65.596 | 0 |
| wasm / 3 | 93.894 | 94.052 | 0 |
| process / 0 | 73.857 | 102.222 | 0 |
| process / 3 | 187.869 | 324.631 | 0 |

## wasm / 0 workers

Host load averages at completion: [33.26, 16.74, 14.61]

| Flow | Before publication p95 | After publication p95 | After React p95 | Server queries p50, before → after | Asset-home reads p50, before → after |
|---|---:|---:|---:|---:|---:|
| profile | 24.832 | 29.931 | 32.231 | 0 → 0 | 0 → 0 |
| reaction-add | 23.590 | 33.418 | 33.618 | 0 → 0 | 0 → 0 |
| reaction-replace | 23.856 | 34.130 | 34.230 | 0 → 0 | 0 → 0 |
| reaction-remove | 24.396 | 33.513 | 33.613 | 0 → 0 | 0 → 0 |
| reply | 49.498 | 63.394 | 65.894 | 6 → 6 | 9 → 9 |
| photo | 45.951 | 65.596 | 67.096 | 6 → 6 | 47 → 47 |
| feed-image | 25.232 | 34.452 | 35.752 | 0 → 0 | 49 → 49 |
| once-photo | 49.887 | 62.522 | 64.122 | 6 → 6 | 30 → 30 |

## wasm / 3 workers

Host load averages at completion: [30.05, 17.64, 14.99]

| Flow | Before publication p95 | After publication p95 | After React p95 | Server queries p50, before → after | Asset-home reads p50, before → after |
|---|---:|---:|---:|---:|---:|
| profile | 45.575 | 43.430 | 45.530 | 0 → 0 | 0 → 0 |
| reaction-add | 42.759 | 47.128 | 47.328 | 0 → 0 | 0 → 0 |
| reaction-replace | 44.927 | 41.663 | 41.963 | 0 → 0 | 0 → 0 |
| reaction-remove | 49.356 | 43.871 | 43.971 | 0 → 0 | 0 → 0 |
| reply | 82.979 | 88.457 | 92.357 | 5 → 6 | 9 → 9 |
| photo | 83.172 | 82.054 | 83.554 | 5 → 6 | 47 → 46 |
| feed-image | 51.598 | 48.493 | 50.629 | 0 → 0 | 49 → 49 |
| once-photo | 93.894 | 94.052 | 95.735 | 5 → 6 | 30 → 30 |

## process / 0 workers

Host load averages at completion: [17.02, 16.29, 14.71]

| Flow | Before publication p95 | After publication p95 | After React p95 | Server queries p50, before → after | Asset-home reads p50, before → after |
|---|---:|---:|---:|---:|---:|
| profile | 21.828 | 27.248 | 28.948 | 0 → 0 | 0 → 0 |
| reaction-add | 50.573 | 52.940 | 53.340 | 0 → 0 | 0 → 0 |
| reaction-replace | 38.245 | 55.301 | 55.401 | 0 → 0 | 0 → 0 |
| reaction-remove | 37.527 | 58.394 | 58.494 | 0 → 0 | 0 → 0 |
| reply | 69.822 | 101.618 | 103.118 | 6 → 6 | 9 → 9 |
| photo | 71.663 | 96.180 | 97.580 | 6 → 6 | 47 → 47 |
| feed-image | 52.141 | 44.565 | 46.825 | 0 → 0 | 49 → 49 |
| once-photo | 73.857 | 102.222 | 104.022 | 6 → 6 | 30 → 30 |

## process / 3 workers

Host load averages at completion: [37.58, 25.42, 18.26]

| Flow | Before publication p95 | After publication p95 | After React p95 | Server queries p50, before → after | Asset-home reads p50, before → after |
|---|---:|---:|---:|---:|---:|
| profile | 51.873 | 78.819 | 81.019 | 0 → 0 | 0 → 0 |
| reaction-add | 95.047 | 134.317 | 134.617 | 0 → 0 | 0 → 0 |
| reaction-replace | 108.121 | 127.665 | 127.865 | 0 → 0 | 0 → 0 |
| reaction-remove | 99.646 | 139.684 | 139.884 | 0 → 0 | 0 → 0 |
| reply | 175.247 | 324.631 | 326.031 | 6 → 6 | 9 → 9 |
| photo | 167.943 | 318.518 | 323.318 | 6 → 6 | 47 → 47 |
| feed-image | 74.958 | 67.559 | 70.467 | 0 → 0 | 49 → 49 |
| once-photo | 187.869 | 269.929 | 272.329 | 6 → 6 | 30 → 30 |

640 completed actions, zero timeouts. Raw stage traces and summary JSON are retained beside this table. No count, timeout, delay, flow or work limit was changed.

## Isolated loaded-process SDK control

The same current production device and retained instrumented server serve four alternating cells. Round-2 SDK files are transpiled from commit `1a602df58d` in a separate tree; the full suite’s SDK is never replaced. Every cell uses 20 repetitions of all eight flows and three busy workers on CPUs 0–3.

| Cell | SDK | Maximum publication p95 | Timeouts | Host load at completion |
|---|---|---:|---:|---|
| 0 | round2 | 173.673 | 0 | [10.83, 18.44, 16.73] |
| 1 | final | 204.450 | 0 | [15.14, 17.45, 16.49] |
| 2 | round2 | 193.992 | 0 | [17.6, 17.63, 16.63] |
| 3 | final | 244.176 | 0 | [14.8, 16.97, 16.5] |

These 640 additional actions also complete without timeout. Both final samples are below 300 ms, and both are slower than their preceding round-2 samples; the historical 324.631-ms final sample remains part of the result. This is evidence of a regression to investigate; shared-host variability prevents precise causal attribution. Metadata reads with a pending cut are the explicit conservative cost of the repair. Query/home counters and every raw trace are retained.

Artifact boundary: the full suite rebuilt the process binary with the shortened embedded guide after the initial LL manifest was captured. Executable SDK/device logic did not change, but the native binary hash did. The alternating control runs after that rebuild, on the same rebuilt device throughout; `LL-CONTROL-INPUTS.json` records its bytes. The original manifest is preserved, not rewritten.

## Detached-only final candidate

The watermark read is now limited to resuming detached owners; a successful check consumes that detach marker. Mounted rereads retain their prior path. This candidate was measured in the isolated SDK tree while the full suite kept its original inputs. Final installation matches these SDK/device bytes (`FINAL-LL-CONSISTENCY.json`).

| Tier / workers | Round 2 maximum flow p95 | Detached-only maximum flow p95 | Timeouts |
|---|---:|---:|---:|
| wasm / 0 | 49.887 | 70.583 | 0 |
| wasm / 3 | 93.894 | 93.483 | 0 |
| process / 0 | 73.857 | 127.581 | 0 |
| process / 3 | 187.869 | 179.059 | 0 |

### wasm / 0 workers

Host load at completion: [16.46, 15.64, 16.11]

| Flow | Before publication p95 | Final publication p95 | Final React p95 | Server queries p50, before → final | Asset-home reads p50, before → final |
|---|---:|---:|---:|---:|---:|
| profile | 24.832 | 22.251 | 23.951 | 0 → 0 | 0 → 0 |
| reaction-add | 23.590 | 45.948 | 46.311 | 0 → 0 | 0 → 0 |
| reaction-replace | 23.856 | 30.089 | 30.289 | 0 → 0 | 0 → 0 |
| reaction-remove | 24.396 | 26.180 | 26.380 | 0 → 0 | 0 → 0 |
| reply | 49.498 | 57.456 | 58.856 | 6 → 6 | 9 → 9 |
| photo | 45.951 | 62.722 | 65.122 | 6 → 5 | 47 → 47 |
| feed-image | 25.232 | 27.412 | 29.212 | 0 → 0 | 49 → 49 |
| once-photo | 49.887 | 70.583 | 72.283 | 6 → 6 | 30 → 30 |

### wasm / 3 workers

Host load at completion: [13.8, 15.05, 15.9]

| Flow | Before publication p95 | Final publication p95 | Final React p95 | Server queries p50, before → final | Asset-home reads p50, before → final |
|---|---:|---:|---:|---:|---:|
| profile | 45.575 | 40.979 | 42.662 | 0 → 0 | 0 → 0 |
| reaction-add | 42.759 | 45.022 | 45.222 | 0 → 0 | 0 → 0 |
| reaction-replace | 44.927 | 43.253 | 43.791 | 0 → 0 | 0 → 0 |
| reaction-remove | 49.356 | 47.262 | 47.806 | 0 → 0 | 0 → 0 |
| reply | 82.979 | 93.483 | 95.183 | 5 → 6 | 9 → 9 |
| photo | 83.172 | 84.348 | 86.248 | 5 → 6 | 47 → 47 |
| feed-image | 51.598 | 54.027 | 57.927 | 0 → 0 | 49 → 49 |
| once-photo | 93.894 | 86.041 | 87.941 | 5 → 5 | 30 → 30 |

### process / 0 workers

Host load at completion: [10.33, 13.86, 15.43]

| Flow | Before publication p95 | Final publication p95 | Final React p95 | Server queries p50, before → final | Asset-home reads p50, before → final |
|---|---:|---:|---:|---:|---:|
| profile | 21.828 | 23.469 | 24.969 | 0 → 0 | 0 → 0 |
| reaction-add | 50.573 | 51.951 | 52.151 | 0 → 0 | 0 → 0 |
| reaction-replace | 38.245 | 40.321 | 40.521 | 0 → 0 | 0 → 0 |
| reaction-remove | 37.527 | 37.649 | 37.749 | 0 → 0 | 0 → 0 |
| reply | 69.822 | 75.279 | 76.779 | 6 → 6 | 9 → 9 |
| photo | 71.663 | 127.581 | 129.481 | 6 → 6 | 47 → 47 |
| feed-image | 52.141 | 47.498 | 49.098 | 0 → 0 | 49 → 49 |
| once-photo | 73.857 | 77.405 | 79.205 | 6 → 6 | 30 → 30 |

### process / 3 workers

Host load at completion: [10.49, 12.96, 14.98]

| Flow | Before publication p95 | Final publication p95 | Final React p95 | Server queries p50, before → final | Asset-home reads p50, before → final |
|---|---:|---:|---:|---:|---:|
| profile | 51.873 | 42.592 | 44.092 | 0 → 0 | 0 → 0 |
| reaction-add | 95.047 | 105.780 | 106.280 | 0 → 0 | 0 → 0 |
| reaction-replace | 108.121 | 110.048 | 110.048 | 0 → 0 | 0 → 0 |
| reaction-remove | 99.646 | 97.762 | 97.962 | 0 → 0 | 0 → 0 |
| reply | 175.247 | 169.634 | 171.222 | 6 → 6 | 9 → 9 |
| photo | 167.943 | 179.059 | 181.759 | 6 → 6 | 47 → 47 |
| feed-image | 74.958 | 65.346 | 66.846 | 0 → 0 | 49 → 49 |
| once-photo | 187.869 | 173.597 | 175.297 | 6 → 6 | 30 → 30 |

Final candidate: 640 actions, zero timeouts. A preceding detached-only loaded-process check completed another 160 actions at 188.642 ms maximum flow p95. All 2,080 actions across this round’s thirteen cells completed without timeout; all results, including the slower broader-check candidate, are retained. Shared-host timing remains a limitation. The final path removes the extra metadata read entirely for ordinary mounted changes rather than using these samples to claim a universal latency guarantee.
