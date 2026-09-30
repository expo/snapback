# LL measurements

All latencies are milliseconds from server post-SQLite-commit to receiver publication or React commit. Each cell has 20 repetitions of eight flows (160 actions), pinned to four cores, with zero or three harness load workers. The same current instrumented server and current devices serve the paired SDK comparison. Host load is recorded in every trace; other work, including this lane’s suite, shared the host. These are live-path checks, not a controlled speedup claim.

The first paired matrix alternates the round-1 SDK (`round1`) and initial round-2 SDK (`final`). The `qualified` matrix follows later queue/terminal fixes. The last matrix (`shipped`, a measurement label only) includes stable terminal-refusal comparison. The later correction that lets a closed facade copy follow existence metadata changes only app-client.ts; this raw-local-client harness does not import or invoke that facade. Its measured paths match the final code.

| Tier / workers | Round 1 max flow p95 | Initial round 2 max flow p95 | Later round 2 max flow p95 | Last round 2 max flow p95 | Last timeouts |
|---|---:|---:|---:|---:|---:|
| wasm / 0 | 47.273 | 49.306 | 47.916 | 49.887 | 0 |
| wasm / 3 | 87.671 | 82.264 | 101.879 | 93.894 | 0 |
| process / 0 | 93.734 | 94.813 | 136.995 | 73.857 | 0 |
| process / 3 | 228.996 | 220.173 | 219.926 | 187.869 | 0 |

## wasm / 0 workers

| Flow | Round 1 publication p95 | Last publication p95 | Last React p95 | Round 1 → last server-query median | Round 1 → last asset-home median |
|---|---:|---:|---:|---:|---:|
| profile | 23.115 | 24.832 | 26.532 | 0 → 0 | 0 → 0 |
| reaction-add | 24.934 | 23.590 | 23.790 | 0 → 0 | 0 → 0 |
| reaction-replace | 21.991 | 23.856 | 24.056 | 0 → 0 | 0 → 0 |
| reaction-remove | 26.133 | 24.396 | 24.496 | 0 → 0 | 0 → 0 |
| reply | 46.240 | 49.498 | 50.998 | 6 → 6 | 9 → 9 |
| photo | 45.837 | 45.951 | 47.351 | 6 → 6 | 47 → 47 |
| feed-image | 26.496 | 25.232 | 26.532 | 0 → 0 | 49 → 49 |
| once-photo | 47.273 | 49.887 | 51.487 | 6 → 6 | 30 → 30 |

## wasm / 3 workers

| Flow | Round 1 publication p95 | Last publication p95 | Last React p95 | Round 1 → last server-query median | Round 1 → last asset-home median |
|---|---:|---:|---:|---:|---:|
| profile | 42.773 | 45.575 | 50.675 | 0 → 0 | 0 → 0 |
| reaction-add | 50.249 | 42.759 | 45.159 | 0 → 0 | 0 → 0 |
| reaction-replace | 50.836 | 44.927 | 45.027 | 0 → 0 | 0 → 0 |
| reaction-remove | 44.332 | 49.356 | 50.856 | 0 → 0 | 0 → 0 |
| reply | 79.758 | 82.979 | 85.879 | 5 → 5 | 9 → 9 |
| photo | 82.651 | 83.172 | 84.972 | 5 → 5 | 47 → 47 |
| feed-image | 48.423 | 51.598 | 53.098 | 0 → 0 | 49 → 49 |
| once-photo | 87.671 | 93.894 | 95.594 | 5 → 5 | 30 → 30 |

## process / 0 workers

| Flow | Round 1 publication p95 | Last publication p95 | Last React p95 | Round 1 → last server-query median | Round 1 → last asset-home median |
|---|---:|---:|---:|---:|---:|
| profile | 34.531 | 21.828 | 23.528 | 0 → 0 | 0 → 0 |
| reaction-add | 45.218 | 50.573 | 50.773 | 0 → 0 | 0 → 0 |
| reaction-replace | 37.274 | 38.245 | 38.445 | 0 → 0 | 0 → 0 |
| reaction-remove | 41.334 | 37.527 | 37.627 | 0 → 0 | 0 → 0 |
| reply | 74.604 | 69.822 | 71.522 | 6 → 6 | 9 → 9 |
| photo | 93.734 | 71.663 | 72.963 | 6 → 6 | 47 → 47 |
| feed-image | 64.597 | 52.141 | 55.015 | 0 → 0 | 49 → 49 |
| once-photo | 83.746 | 73.857 | 75.557 | 6 → 6 | 30 → 30 |

## process / 3 workers

| Flow | Round 1 publication p95 | Last publication p95 | Last React p95 | Round 1 → last server-query median | Round 1 → last asset-home median |
|---|---:|---:|---:|---:|---:|
| profile | 52.662 | 51.873 | 53.973 | 0 → 0 | 0 → 0 |
| reaction-add | 112.472 | 95.047 | 95.147 | 0 → 0 | 0 → 0 |
| reaction-replace | 144.274 | 108.121 | 108.221 | 0 → 0 | 0 → 0 |
| reaction-remove | 144.060 | 99.646 | 99.646 | 0 → 0 | 0 → 0 |
| reply | 203.993 | 175.247 | 177.647 | 5 → 6 | 9 → 9 |
| photo | 214.621 | 167.943 | 169.643 | 6 → 6 | 47 → 47 |
| feed-image | 129.647 | 74.958 | 76.958 | 0 → 0 | 49 → 49 |
| once-photo | 228.996 | 187.869 | 188.769 | 6 → 6 | 30 → 30 |

Across the 16 complete cells: 2560 action trials and 0 timeouts. The incomplete `verified` matrix is excluded: its process/0 run was disrupted by our live SDK rebuild (see FAILURES.md). No harness delays, flow shapes, deadlines or scheduler limits were changed.
