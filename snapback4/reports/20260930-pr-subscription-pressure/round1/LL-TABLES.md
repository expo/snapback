# LL measurements

All latencies are milliseconds. Publication is the receiver observable publication, measured from the server post-SQLite-commit timestamp. Each cell contains 20 trials per flow, 160 total. Zero/three denotes harness load workers on four pinned cores; other lanes shared this host. The final four cells include the new-mount fence, after the first paired matrix.

| Tier / workers | Round 0 maximum flow p95 | Initial round 1 maximum flow p95 | Final round 1 maximum flow p95 | Final timeouts |
|---|---:|---:|---:|---:|
| wasm / 0 | 45.535 | 44.858 | 47.257 | 0 |
| wasm / 3 | 80.605 | 88.977 | 92.070 | 0 |
| process / 0 | 79.111 | 87.150 | 81.163 | 0 |
| process / 3 | 399.202 | 215.261 | 195.408 | 0 |

## wasm / 0 workers

| Flow | Round 0 publication p95 | Final publication p95 | Final React p95 | Round 0 → final server-query median | Round 0 → final asset-home median |
|---|---:|---:|---:|---:|---:|
| profile | 21.606 | 23.044 | 24.744 | 0 → 0 | 0 → 0 |
| reaction-add | 22.362 | 24.581 | 24.681 | 0 → 0 | 0 → 0 |
| reaction-replace | 23.879 | 24.040 | 24.140 | 0 → 0 | 0 → 0 |
| reaction-remove | 24.675 | 24.080 | 24.080 | 0 → 0 | 0 → 0 |
| reply | 45.535 | 42.644 | 44.144 | 6 → 5 | 9 → 9 |
| photo | 42.985 | 47.257 | 48.857 | 6 → 6 | 47 → 47 |
| feed-image | 24.266 | 25.269 | 26.669 | 0 → 0 | 49 → 49 |
| once-photo | 42.430 | 45.351 | 46.851 | 6 → 6 | 30 → 30 |

## wasm / 3 workers

| Flow | Round 0 publication p95 | Final publication p95 | Final React p95 | Round 0 → final server-query median | Round 0 → final asset-home median |
|---|---:|---:|---:|---:|---:|
| profile | 39.725 | 39.431 | 41.931 | 0 → 0 | 0 → 0 |
| reaction-add | 42.798 | 51.479 | 52.079 | 0 → 0 | 0 → 0 |
| reaction-replace | 44.696 | 43.067 | 43.167 | 0 → 0 | 0 → 0 |
| reaction-remove | 43.687 | 44.211 | 44.311 | 0 → 0 | 0 → 0 |
| reply | 80.202 | 82.313 | 84.113 | 5 → 5 | 9 → 9 |
| photo | 79.264 | 84.699 | 86.499 | 6 → 6 | 47 → 47 |
| feed-image | 52.121 | 48.382 | 49.882 | 0 → 0 | 49 → 49 |
| once-photo | 80.605 | 92.070 | 94.170 | 5 → 5 | 30 → 30 |

## process / 0 workers

| Flow | Round 0 publication p95 | Final publication p95 | Final React p95 | Round 0 → final server-query median | Round 0 → final asset-home median |
|---|---:|---:|---:|---:|---:|
| profile | 29.289 | 27.084 | 28.484 | 0 → 0 | 0 → 0 |
| reaction-add | 44.280 | 41.941 | 42.041 | 0 → 0 | 0 → 0 |
| reaction-replace | 37.835 | 38.816 | 38.916 | 0 → 0 | 0 → 0 |
| reaction-remove | 39.317 | 41.299 | 41.399 | 0 → 0 | 0 → 0 |
| reply | 66.938 | 75.903 | 77.103 | 6 → 6 | 9 → 9 |
| photo | 76.899 | 80.256 | 81.656 | 6 → 6 | 47 → 47 |
| feed-image | 56.663 | 53.933 | 55.533 | 0 → 0 | 49 → 49 |
| once-photo | 79.111 | 81.163 | 82.689 | 6 → 6 | 30 → 30 |

## process / 3 workers

| Flow | Round 0 publication p95 | Final publication p95 | Final React p95 | Round 0 → final server-query median | Round 0 → final asset-home median |
|---|---:|---:|---:|---:|---:|
| profile | 90.228 | 47.851 | 49.551 | 0 → 0 | 0 → 0 |
| reaction-add | 203.266 | 92.516 | 93.316 | 0 → 0 | 0 → 0 |
| reaction-replace | 278.216 | 124.997 | 125.097 | 0 → 0 | 0 → 0 |
| reaction-remove | 205.289 | 122.542 | 122.642 | 0 → 0 | 0 → 0 |
| reply | 336.419 | 195.408 | 197.108 | 6 → 5 | 9 → 9 |
| photo | 376.001 | 193.548 | 194.648 | 6 → 6 | 47 → 47 |
| feed-image | 174.768 | 87.187 | 89.487 | 0 → 0 | 49 → 49 |
| once-photo | 399.202 | 194.218 | 195.818 | 6 → 6 | 30 → 30 |

The initial paired matrix and all final traces/summaries are retained. Across all 12 cells: 1920 action trials; 0 timeouts. Stable asset-home medians and no new server-query loop support preservation of the measured LL path. Shared-host latency variation prevents a controlled performance claim.
