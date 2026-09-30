# LL measurements

Unchanged viewed-media harness, 20 repetitions of eight flows, four CPUs (0–3).
Before is the final round-3 measurement; after is this round during the shared-host
suite workload. Zero workers means no harness load workers, not an idle host.
These are successful live-path measurements, not a causal latency comparison.

| Tier / workers | Round 3 maximum flow p95 | Round 4 maximum flow p95 | Timeouts |
| --- | ---: | ---: | ---: |
| wasm / 0 | 70.583 | 95.269 | 0 |
| wasm / 3 | 93.483 | 107.138 | 0 |
| process / 0 | 127.581 | 71.543 | 0 |
| process / 3 | 179.059 | 172.251 | 0 |

## wasm, 0 workers

Host load at completion: [36.39, 17.72, 9.66].

| Flow | Before publication p95 | After publication p95 | After React p95 | Device queries p50 before → after | Server queries p50 before → after | Asset-home reads p50 before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| profile | 22.251 | 41.249 | 46.449 | 2 → 2 | 0 → 0 | 0 → 0 |
| reaction-add | 45.948 | 49.896 | 50.096 | 40 → 40 | 0 → 0 | 0 → 0 |
| reaction-replace | 30.089 | 41.987 | 43.162 | 40 → 40 | 0 → 0 | 0 → 0 |
| reaction-remove | 26.18 | 48.149 | 48.349 | 40 → 40 | 0 → 0 | 0 → 0 |
| reply | 57.456 | 95.269 | 96.769 | 49 → 55 | 6 → 6 | 9 → 9 |
| photo | 62.722 | 80.067 | 81.067 | 49 → 53 | 5 → 6 | 47 → 47 |
| feed-image | 27.412 | 42.789 | 44.489 | 2 → 2 | 0 → 0 | 49 → 49 |
| once-photo | 70.583 | 74.328 | 76.928 | 49 → 53 | 6 → 5 | 30 → 30 |

## wasm, 3 workers

Host load at completion: [32.97, 18.76, 10.27].

| Flow | Before publication p95 | After publication p95 | After React p95 | Device queries p50 before → after | Server queries p50 before → after | Asset-home reads p50 before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| profile | 40.979 | 40.37 | 46.07 | 2 → 2 | 0 → 0 | 0 → 0 |
| reaction-add | 45.022 | 51.257 | 51.357 | 40 → 40 | 0 → 0 | 0 → 0 |
| reaction-replace | 43.253 | 64.801 | 65.101 | 41 → 42 | 0 → 0 | 0 → 0 |
| reaction-remove | 47.262 | 55.419 | 55.519 | 40 → 45 | 0 → 0 | 0 → 0 |
| reply | 93.483 | 97.906 | 99.406 | 59 → 59 | 6 → 6 | 9 → 9 |
| photo | 84.348 | 87.425 | 89.025 | 63 → 56 | 6 → 5 | 47 → 47 |
| feed-image | 54.027 | 51.186 | 52.586 | 2 → 2 | 0 → 0 | 49 → 49 |
| once-photo | 86.041 | 107.138 | 108.738 | 61 → 65 | 5 → 5 | 30 → 30 |

## process, 0 workers

Host load at completion: [15.58, 16.55, 10.09].

| Flow | Before publication p95 | After publication p95 | After React p95 | Device queries p50 before → after | Server queries p50 before → after | Asset-home reads p50 before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| profile | 23.469 | 27.112 | 28.212 | 2 → 2 | 0 → 0 | 0 → 0 |
| reaction-add | 51.951 | 37.396 | 37.496 | 38 → 40 | 0 → 0 | 0 → 0 |
| reaction-replace | 40.321 | 36.517 | 36.717 | 40 → 38 | 0 → 0 | 0 → 0 |
| reaction-remove | 37.649 | 38.322 | 38.422 | 40 → 39 | 0 → 0 | 0 → 0 |
| reply | 75.279 | 70.677 | 72.477 | 68 → 69 | 6 → 6 | 9 → 9 |
| photo | 127.581 | 71.543 | 72.843 | 70 → 70 | 6 → 6 | 47 → 47 |
| feed-image | 47.498 | 40.723 | 43.623 | 2 → 2 | 0 → 0 | 49 → 49 |
| once-photo | 77.405 | 68.357 | 69.557 | 71 → 70 | 6 → 6 | 30 → 30 |

## process, 3 workers

Host load at completion: [12.86, 15.4, 10.18].

| Flow | Before publication p95 | After publication p95 | After React p95 | Device queries p50 before → after | Server queries p50 before → after | Asset-home reads p50 before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| profile | 42.592 | 46.16 | 47.36 | 2 → 2 | 0 → 0 | 0 → 0 |
| reaction-add | 105.78 | 90.776 | 91.076 | 40 → 40 | 0 → 0 | 0 → 0 |
| reaction-replace | 110.048 | 109.849 | 109.949 | 50 → 52 | 0 → 0 | 0 → 0 |
| reaction-remove | 97.762 | 96.269 | 96.469 | 49 → 52 | 0 → 0 | 0 → 0 |
| reply | 169.634 | 164.868 | 166.568 | 82 → 86 | 6 → 6 | 9 → 9 |
| photo | 179.059 | 166.521 | 168.521 | 84 → 81 | 6 → 6 | 47 → 47 |
| feed-image | 65.346 | 65.745 | 67.345 | 3 → 3 | 0 → 0 | 49 → 49 |
| once-photo | 173.597 | 172.251 | 173.351 | 83 → 85 | 6 → 6 | 30 → 30 |
