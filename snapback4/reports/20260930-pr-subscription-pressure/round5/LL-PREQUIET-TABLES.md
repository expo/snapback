# Paired LL measurements

Merged pre-fix SDK `56571c0274` → pre-quiet-fix round-5 SDK, sharing the same merged
native instrumented server and wasm/process device. The original fixture, page,
flow assertions and timeouts are unchanged. `ll-measure.mjs` only adds SDK and
original-fixture path selection. Twenty runs of each of eight flows per cell;
1,280 actions total, zero timeouts. Both versions use viewed-media retention.
CPU affinity 0–3; load 0 or three workers. The full Rust suite and other sessions
share the host, so zero synthetic load is not idle. These are paired batches,
not randomized samples or a universal causal speed/latency bound. Higher samples
are retained. Raw traces are losslessly compressed; the original LL summarizer
accepts their `.json.gz` paths.

All timing columns are milliseconds. Work columns are per-action p50; full
p50/p95/max distributions for every stage/count are in the summary JSON files.

## wasm, 0 load workers

| Flow | Publication p50 before → after | Publication p95 before → after | React p95 before → after | Device queries before → after | Server queries before → after | Asset-home reads before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| profile | 42.841 → 24.136 | 61.669 → 29.883 | 67.069 → 31.783 | 3 → 4 | 0 → 2 | 0 → 0 |
| reaction-add | 58.271 → 23.376 | 104.445 → 31.449 | 104.745 → 31.649 | 56 → 42 | 0 → 2 | 0 → 0 |
| reaction-replace | 55.743 → 24.945 | 98.38 → 31.754 | 98.78 → 31.854 | 53 → 42 | 0 → 2 | 0 → 0 |
| reaction-remove | 56.856 → 27.137 | 94.421 → 29.763 | 94.721 → 29.963 | 58 → 42 | 0 → 2 | 0 → 0 |
| reply | 113.942 → 50.773 | 147.433 → 70.862 | 150.833 → 73.562 | 69 → 49 | 6 → 5 | 9 → 9 |
| photo | 113.145 → 54.164 | 137.63 → 69.83 | 141.03 → 71.53 | 66 → 55 | 5 → 6 | 47 → 46 |
| feed-image | 57.228 → 25.08 | 87.529 → 31.648 | 91.829 → 37.248 | 3 → 4 | 0 → 2 | 49 → 49 |
| once-photo | 105.845 → 51.475 | 135.97 → 64.315 | 138.87 → 66.315 | 64 → 49 | 5 → 5 | 30 → 30 |

## wasm, 3 load workers

| Flow | Publication p50 before → after | Publication p95 before → after | React p95 before → after | Device queries before → after | Server queries before → after | Asset-home reads before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| profile | 33.191 → 43.12 | 45.957 → 51.873 | 48.957 → 53.273 | 2 → 4 | 0 → 2 | 0 → 0 |
| reaction-add | 41.849 → 40.903 | 49.117 → 47.424 | 52.217 → 47.624 | 46 → 50 | 0 → 2 | 0 → 0 |
| reaction-replace | 39.641 → 38.618 | 68.551 → 52.604 | 68.751 → 52.704 | 46 → 42 | 0 → 2 | 0 → 0 |
| reaction-remove | 42.132 → 42.421 | 58.764 → 47.867 | 58.864 → 48.167 | 44 → 42 | 0 → 2 | 0 → 0 |
| reply | 78.229 → 81.348 | 97.769 → 102.311 | 99.969 → 104.211 | 60 → 65 | 5 → 6 | 9 → 9 |
| photo | 78.53 → 86.111 | 107.387 → 96.632 | 110.864 → 98.232 | 64 → 66 | 5 → 6 | 47 → 48 |
| feed-image | 39.828 → 42.035 | 56.292 → 57.44 | 58.992 → 59.34 | 2 → 5 | 0 → 2 | 49 → 49 |
| once-photo | 77.386 → 85.487 | 105.93 → 99.639 | 107.53 → 102.253 | 61 → 66 | 5 → 6 | 30 → 30 |

## process, 0 load workers

| Flow | Publication p50 before → after | Publication p95 before → after | React p95 before → after | Device queries before → after | Server queries before → after | Asset-home reads before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| profile | 19.348 → 22.526 | 22.976 → 28.23 | 24.171 → 29.13 | 2 → 4 | 0 → 2 | 0 → 0 |
| reaction-add | 32.884 → 34.237 | 41.542 → 41.047 | 41.642 → 41.247 | 38 → 41 | 0 → 1 | 0 → 0 |
| reaction-replace | 34.337 → 35.388 | 38.438 → 46.897 | 38.538 → 46.997 | 37 → 46 | 0 → 1 | 0 → 0 |
| reaction-remove | 33.97 → 40.663 | 40.534 → 46.21 | 40.734 → 46.31 | 42 → 52 | 0 → 2 | 0 → 0 |
| reply | 59.405 → 52.178 | 69.482 → 90.992 | 71.766 → 92.192 | 70 → 76 | 6 → 6 | 9 → 9 |
| photo | 65.875 → 57.09 | 78.957 → 90.648 | 80.757 → 91.948 | 69 → 72 | 6 → 6 | 47 → 47 |
| feed-image | 35.611 → 34.773 | 42.064 → 44.121 | 43.664 → 45.721 | 2 → 4 | 0 → 2 | 49 → 49 |
| once-photo | 68.276 → 61.762 | 84.884 → 89.266 | 86.367 → 90.166 | 74 → 74 | 6 → 6 | 30 → 30 |

## process, 3 load workers

| Flow | Publication p50 before → after | Publication p95 before → after | React p95 before → after | Device queries before → after | Server queries before → after | Asset-home reads before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| profile | 35.845 → 41.643 | 46.943 → 47.366 | 48.936 → 48.266 | 2 → 4 | 0 → 0 | 0 → 0 |
| reaction-add | 66.765 → 79.244 | 87.098 → 124.712 | 88.298 → 124.912 | 40 → 51 | 0 → 0 | 0 → 0 |
| reaction-replace | 72.865 → 91.206 | 117.044 → 135.636 | 117.544 → 135.736 | 55 → 57 | 0 → 2 | 0 → 0 |
| reaction-remove | 74.994 → 99.737 | 108.808 → 129.251 | 108.808 → 129.651 | 47 → 62 | 0 → 2 | 0 → 0 |
| reply | 143.683 → 146.973 | 170.204 → 191.289 | 172.004 → 192.489 | 88 → 83 | 6 → 5 | 9 → 9 |
| photo | 146.065 → 139.016 | 168.468 → 224.782 | 170.968 → 227.682 | 82 → 81 | 6 → 6 | 47 → 47 |
| feed-image | 57.83 → 61.956 | 72.868 → 70.076 | 74.368 → 71.806 | 3 → 5 | 0 → 2 | 49 → 49 |
| once-photo | 140.026 → 142.434 | 172.674 → 201.107 | 175.074 → 203.007 | 80 → 82 | 6 → 6 | 30 → 30 |

