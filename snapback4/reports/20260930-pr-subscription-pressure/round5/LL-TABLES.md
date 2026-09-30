# Final LL comparison

Merged pre-fix SDK `56571c0274` → final round-5 SDK after the quiet-poll repair,
sharing the same merged native instrumented server and wasm/process device.
The original fixture, page, flow assertions and timeouts are unchanged.
`ll-measure.mjs` only adds SDK and original-fixture path selection. Twenty runs
of eight flows per cell: 1,280 comparison actions, zero timeouts. Both versions
use viewed-media retention, CPU affinity 0–3, zero or three synthetic workers.
The baseline overlapped the full Rust suite; final cells overlapped affected
checks and other host sessions. These separate batches are not randomized or
matched for ambient host load. Higher process p95 and additional server work
are retained; this is not a no-regression or causal speedup claim.

All timings are milliseconds. Work columns are per-action p50; full p50/p95/max
for every stage/count are in summary JSON. Raw traces are losslessly compressed;
the original LL summarizer accepts `.json.gz`. Final files use `ll-qualified-*`;
`ll-fixed-*` and LL-PREQUIET-TABLES.md preserve the initial 640-action result.

## wasm, 0 load workers

| Flow | Publication p50 before → after | Publication p95 before → after | React p95 before → after | Device queries before → after | Server queries before → after | Asset-home reads before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| profile | 42.841 → 21.119 | 61.669 → 26.58 | 67.069 → 28.364 | 3 → 4 | 0 → 2 | 0 → 0 |
| reaction-add | 58.271 → 22.242 | 104.445 → 30.24 | 104.745 → 30.24 | 56 → 42 | 0 → 2 | 0 → 0 |
| reaction-replace | 55.743 → 21.744 | 98.38 → 29.336 | 98.78 → 29.436 | 53 → 42 | 0 → 2 | 0 → 0 |
| reaction-remove | 56.856 → 22.967 | 94.421 → 27.803 | 94.721 → 27.903 | 58 → 42 | 0 → 2 | 0 → 0 |
| reply | 113.942 → 46.371 | 147.433 → 55.173 | 150.833 → 57.373 | 69 → 49 | 6 → 6 | 9 → 9 |
| photo | 113.145 → 46.682 | 137.63 → 57.594 | 141.03 → 59.794 | 66 → 49 | 5 → 6 | 47 → 47 |
| feed-image | 57.228 → 21.228 | 87.529 → 27.456 | 91.829 → 29.456 | 3 → 4 | 0 → 2 | 49 → 49 |
| once-photo | 105.845 → 47.757 | 135.97 → 56.459 | 138.87 → 58.859 | 64 → 49 | 5 → 6 | 30 → 30 |

## wasm, 3 load workers

| Flow | Publication p50 before → after | Publication p95 before → after | React p95 before → after | Device queries before → after | Server queries before → after | Asset-home reads before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| profile | 33.191 → 34.456 | 45.957 → 43.487 | 48.957 → 48.887 | 2 → 4 | 0 → 2 | 0 → 0 |
| reaction-add | 41.849 → 37.675 | 49.117 → 45.339 | 52.217 → 45.539 | 46 → 42 | 0 → 2 | 0 → 0 |
| reaction-replace | 39.641 → 39.723 | 68.551 → 59.187 | 68.751 → 59.387 | 46 → 43 | 0 → 2 | 0 → 0 |
| reaction-remove | 42.132 → 38.608 | 58.764 → 48.282 | 58.864 → 48.712 | 44 → 42 | 0 → 2 | 0 → 0 |
| reply | 78.229 → 81.012 | 97.769 → 96.887 | 99.969 → 98.587 | 60 → 60 | 5 → 5 | 9 → 8 |
| photo | 78.53 → 79.371 | 107.387 → 100.015 | 110.864 → 101.415 | 64 → 56 | 5 → 6 | 47 → 44 |
| feed-image | 39.828 → 38.421 | 56.292 → 49.756 | 58.992 → 56.731 | 2 → 4 | 0 → 2 | 49 → 47 |
| once-photo | 77.386 → 79.237 | 105.93 → 93.083 | 107.53 → 95.383 | 61 → 55 | 5 → 5 | 30 → 28 |

## process, 0 load workers

| Flow | Publication p50 before → after | Publication p95 before → after | React p95 before → after | Device queries before → after | Server queries before → after | Asset-home reads before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| profile | 19.348 → 22.305 | 22.976 → 36.305 | 24.171 → 38.128 | 2 → 4 | 0 → 2 | 0 → 0 |
| reaction-add | 32.884 → 35.525 | 41.542 → 44.633 | 41.642 → 44.833 | 38 → 41 | 0 → 0 | 0 → 0 |
| reaction-replace | 34.337 → 35.567 | 38.438 → 52.245 | 38.538 → 52.345 | 37 → 42 | 0 → 0 | 0 → 0 |
| reaction-remove | 33.97 → 38.384 | 40.534 → 45.145 | 40.734 → 45.345 | 42 → 50 | 0 → 2 | 0 → 0 |
| reply | 59.405 → 64.149 | 69.482 → 82.432 | 71.766 → 83.832 | 70 → 75 | 6 → 6 | 9 → 9 |
| photo | 65.875 → 67.958 | 78.957 → 89.732 | 80.757 → 91.217 | 69 → 71 | 6 → 6 | 47 → 47 |
| feed-image | 35.611 → 34.284 | 42.064 → 43.818 | 43.664 → 46.418 | 2 → 4 | 0 → 2 | 49 → 49 |
| once-photo | 68.276 → 71.051 | 84.884 → 152.416 | 86.367 → 155.816 | 74 → 74 | 6 → 6 | 30 → 30 |

## process, 3 load workers

| Flow | Publication p50 before → after | Publication p95 before → after | React p95 before → after | Device queries before → after | Server queries before → after | Asset-home reads before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| profile | 35.845 → 39.399 | 46.943 → 47.671 | 48.936 → 48.771 | 2 → 4 | 0 → 0 | 0 → 0 |
| reaction-add | 66.765 → 75.636 | 87.098 → 99.921 | 88.298 → 100.321 | 40 → 45 | 0 → 1 | 0 → 0 |
| reaction-replace | 72.865 → 94.671 | 117.044 → 123.606 | 117.544 → 123.606 | 55 → 56 | 0 → 2 | 0 → 0 |
| reaction-remove | 74.994 → 107.955 | 108.808 → 134.295 | 108.808 → 134.395 | 47 → 62 | 0 → 2 | 0 → 0 |
| reply | 143.683 → 134.765 | 170.204 → 199.789 | 172.004 → 201.189 | 88 → 81 | 6 → 5 | 9 → 9 |
| photo | 146.065 → 144.098 | 168.468 → 250.326 | 170.968 → 251.826 | 82 → 86 | 6 → 6 | 47 → 47 |
| feed-image | 57.83 → 53.794 | 72.868 → 73.696 | 74.368 → 76.089 | 3 → 5 | 0 → 2 | 49 → 49 |
| once-photo | 140.026 → 154.534 | 172.674 → 205.501 | 175.074 → 206.801 | 80 → 86 | 6 → 6 | 30 → 30 |

