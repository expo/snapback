# Stage distributions

Each cell is p50 / p95 in milliseconds, except work counts. Nearest-rank percentiles; 20 trials per flow. All 640 trials completed without timeout. These stages overlap: a whole server answer can finish before local apply, yielding negative apply-to-evaluation or publication-to-fetch intervals. Do not sum independent percentiles. The raw UNIX-millisecond timestamps and sample maxima remain in the compressed traces and summary JSON. See REPORT.md for instrumentation boundaries and scope.

## final-process-viewed-loaded

Device: process; media: viewed; available CPUs: 4; busy workers: 3.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 7.7 / 12.7 | — | 5.0 / 7.9 | 15.5 / 18.5 | 6.2 / 8.0 | 2.6 / 7.5 | 2.4 / 12.8 |
| reaction-add | 8.6 / 13.0 | — | 5.2 / 8.1 | 34.3 / 46.0 | 7.6 / 10.6 | 6.7 / 13.8 | 7.1 / 17.3 |
| reaction-replace | 8.1 / 14.9 | — | 4.0 / 6.6 | 36.3 / 41.8 | 8.1 / 11.0 | 5.6 / 8.9 | 6.3 / 11.1 |
| reaction-remove | 7.7 / 10.5 | — | 3.8 / 6.3 | 34.3 / 40.4 | 7.3 / 9.7 | 5.9 / 11.0 | 5.9 / 10.8 |
| reply | 9.2 / 13.6 | — | 4.6 / 8.1 | 40.0 / 46.0 | 8.7 / 13.5 | 11.6 / 17.4 | 11.2 / 17.4 |
| photo | 636.0 / 814.8 | 620.4 / 796.8 | 4.8 / 6.7 | 37.8 / 47.0 | 10.4 / 17.5 | 12.3 / 16.3 | 9.1 / 12.8 |
| feed-image | 627.1 / 691.9 | 612.5 / 674.6 | 4.6 / 6.3 | 15.0 / 20.7 | 6.4 / 9.0 | 3.1 / 7.2 | 2.4 / 6.4 |
| once-photo | 622.2 / 780.5 | 608.2 / 765.1 | 4.9 / 7.9 | 37.8 / 45.8 | 10.5 / 16.8 | 12.0 / 16.9 | 10.2 / 17.0 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 8.7 / 14.0 | 0.0 / 0.1 | 1.7 / 4.5 | 42.1 / 50.4 | 44.3 / 51.4 | — |
| reaction-add | 27.0 / 46.3 | 0.0 / 0.1 | 0.2 / 0.9 | 94.0 / 115.4 | 94.5 / 116.1 | — |
| reaction-replace | 28.4 / 40.3 | 0.0 / 0.1 | 0.2 / 0.7 | 92.2 / 101.7 | 92.4 / 102.0 | — |
| reaction-remove | 25.1 / 40.5 | 0.0 / 0.1 | 0.1 / 0.4 | 87.6 / 96.6 | 87.7 / 96.7 | — |
| reply | 54.8 / 72.4 | 18.4 / 28.2 | 1.7 / 2.4 | 145.8 / 180.0 | 149.0 / 181.5 | 149.0 / 181.5 |
| photo | 50.1 / 69.1 | 16.0 / 30.0 | 1.6 / 2.1 | 142.9 / 163.9 | 145.3 / 166.0 | — |
| feed-image | 31.4 / 43.6 | 0.0 / 0.1 | 1.5 / 3.5 | 63.0 / 79.4 | 64.3 / 81.3 | — |
| once-photo | 52.9 / 64.3 | 15.6 / 30.5 | 1.7 / 3.2 | 149.8 / 174.1 | 151.2 / 175.9 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 86.2 / 148.4 | 112.4 / 138.5 | 115.3 / 149.2 | 366.9 / 410.3 |
| feed-image | 30.7 / 51.9 | 102.6 / 122.0 | 106.2 / 126.2 | 203.3 / 258.7 |
| once-photo | 104.0 / 153.5 | 16.1 / 25.1 | 19.1 / 28.6 | 279.7 / 318.2 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 2.0 / 3.0 | 1.0 / 2.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-add | 64.0 / 67.0 | 33.0 / 39.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-replace | 61.0 / 68.0 | 34.0 / 39.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-remove | 62.0 / 67.0 | 32.0 / 36.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reply | 94.0 / 97.0 | 35.0 / 49.0 | 9.0 / 18.0 | 6.0 / 6.0 |
| photo | 95.0 / 97.0 | 35.0 / 41.0 | 47.0 / 92.0 | 6.0 / 7.0 |
| feed-image | 3.0 / 3.0 | 1.0 / 1.0 | 49.0 / 94.0 | 0.0 / 0.0 |
| once-photo | 96.0 / 97.0 | 36.0 / 41.0 | 30.0 / 57.0 | 6.0 / 6.0 |

## final-process-viewed

Device: process; media: viewed; available CPUs: 96; busy workers: 0.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 8.3 / 14.6 | — | 3.0 / 3.9 | 11.9 / 13.7 | 4.4 / 5.7 | 2.6 / 4.7 | 3.1 / 7.5 |
| reaction-add | 9.7 / 14.4 | — | 2.4 / 4.0 | 24.8 / 34.2 | 5.2 / 7.1 | 2.2 / 6.8 | 3.4 / 7.4 |
| reaction-replace | 9.7 / 10.8 | — | 2.4 / 3.8 | 22.7 / 25.4 | 5.1 / 6.6 | 2.0 / 2.5 | 2.4 / 4.0 |
| reaction-remove | 8.8 / 10.5 | — | 2.7 / 6.4 | 21.8 / 35.6 | 5.0 / 6.2 | 2.0 / 4.1 | 2.3 / 2.9 |
| reply | 8.3 / 10.0 | — | 2.1 / 3.6 | 24.7 / 27.3 | 6.9 / 9.3 | 3.3 / 5.2 | 2.7 / 3.3 |
| photo | 783.0 / 877.7 | 765.0 / 850.8 | 3.2 / 4.5 | 26.5 / 33.2 | 7.5 / 9.6 | 4.3 / 6.9 | 3.2 / 6.1 |
| feed-image | 784.1 / 826.1 | 766.3 / 808.4 | 2.7 / 3.7 | 12.5 / 23.8 | 4.6 / 7.7 | 2.2 / 2.6 | 2.8 / 3.0 |
| once-photo | 791.2 / 839.6 | 770.3 / 807.7 | 3.1 / 4.1 | 27.9 / 38.1 | 7.5 / 9.7 | 3.9 / 5.4 | 3.2 / 3.9 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 9.0 / 9.8 | 0.1 / 0.1 | 2.8 / 3.6 | 34.5 / 39.0 | 37.2 / 42.1 | — |
| reaction-add | 12.2 / 29.8 | 0.1 / 0.1 | 0.2 / 0.4 | 63.4 / 81.0 | 63.6 / 81.2 | — |
| reaction-replace | 5.6 / 28.2 | 0.0 / 0.1 | 0.2 / 0.4 | 40.3 / 68.5 | 40.5 / 68.7 | — |
| reaction-remove | 5.1 / 12.0 | 0.0 / 0.1 | 0.3 / 0.4 | 37.9 / 63.9 | 38.1 / 64.1 | — |
| reply | 32.1 / 39.0 | 5.5 / 15.3 | 2.1 / 3.7 | 80.3 / 91.6 | 83.8 / 93.7 | 83.8 / 93.7 |
| photo | 40.2 / 49.5 | 5.9 / 18.2 | 3.1 / 3.5 | 95.5 / 111.3 | 97.8 / 114.7 | — |
| feed-image | 34.6 / 52.8 | 0.1 / 0.2 | 2.7 / 3.6 | 61.2 / 81.5 | 64.4 / 85.3 | — |
| once-photo | 40.2 / 47.6 | 8.4 / 23.5 | 3.2 / 3.7 | 96.3 / 127.3 | 99.8 / 129.7 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 52.5 / 107.1 | 134.8 / 201.1 | 137.0 / 205.6 | 292.7 / 415.8 |
| feed-image | 31.2 / 75.4 | 167.1 / 219.7 | 169.1 / 222.3 | 269.2 / 371.8 |
| once-photo | 62.8 / 120.0 | 16.2 / 19.9 | 18.4 / 22.8 | 174.4 / 237.1 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 2.0 / 3.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-add | 56.0 / 63.0 | 24.0 / 32.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-replace | 40.0 / 64.0 | 22.0 / 35.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-remove | 44.0 / 70.0 | 27.0 / 44.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reply | 72.0 / 84.0 | 25.0 / 36.0 | 9.0 / 18.0 | 6.0 / 6.0 |
| photo | 72.0 / 91.0 | 25.0 / 29.0 | 47.0 / 92.0 | 6.0 / 6.0 |
| feed-image | 3.0 / 3.0 | 1.0 / 1.0 | 49.0 / 94.0 | 0.0 / 0.0 |
| once-photo | 73.0 / 90.0 | 25.0 / 28.0 | 30.0 / 57.0 | 6.0 / 6.0 |

## final-wasm-viewed-loaded

Device: wasm; media: viewed; available CPUs: 4; busy workers: 3.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 10.2 / 18.3 | — | 3.9 / 8.5 | 6.3 / 14.5 | 7.9 / 9.2 | 1.0 / 2.3 | 2.6 / 4.3 |
| reaction-add | 9.6 / 13.0 | — | 5.0 / 7.0 | 9.0 / 13.5 | 8.6 / 14.2 | 0.7 / 2.1 | 2.8 / 7.3 |
| reaction-replace | 9.8 / 13.6 | — | 5.1 / 6.2 | 7.9 / 12.3 | 7.4 / 11.8 | 0.8 / 3.4 | 2.6 / 5.3 |
| reaction-remove | 7.8 / 9.5 | — | 4.8 / 6.8 | 7.5 / 11.3 | 7.6 / 10.8 | 0.7 / 1.6 | 2.3 / 4.8 |
| reply | 8.4 / 13.1 | — | 4.8 / 8.7 | 10.4 / 14.7 | 12.5 / 17.9 | 1.1 / 4.8 | 2.9 / 6.0 |
| photo | 22.1 / 28.0 | 8.4 / 9.9 | 4.8 / 9.0 | 9.9 / 16.3 | 10.3 / 15.7 | 1.6 / 4.4 | 2.8 / 8.4 |
| feed-image | 22.6 / 28.2 | 8.2 / 11.0 | 4.3 / 8.1 | 7.3 / 11.3 | 6.3 / 10.0 | 1.1 / 3.0 | 2.3 / 4.8 |
| once-photo | 23.6 / 30.3 | 9.3 / 11.8 | 5.3 / 7.2 | 12.0 / 16.4 | 13.0 / 17.4 | 1.6 / 5.6 | 3.7 / 9.8 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 2.0 / 5.4 | 0.0 / 1.8 | 1.7 / 6.8 | 25.4 / 37.3 | 28.7 / 42.3 | — |
| reaction-add | 2.4 / 3.8 | 0.3 / 0.4 | 0.2 / 0.7 | 29.8 / 35.8 | 30.2 / 36.0 | — |
| reaction-replace | 2.3 / 6.5 | 0.3 / 1.6 | 0.2 / 2.7 | 28.8 / 37.3 | 29.7 / 39.9 | — |
| reaction-remove | 1.9 / 4.2 | 0.3 / 3.3 | 0.2 / 1.2 | 25.9 / 32.4 | 26.2 / 32.5 | — |
| reply | 21.7 / 40.4 | 2.4 / 12.6 | 1.4 / 1.8 | 61.5 / 73.3 | 62.8 / 74.6 | 62.8 / 74.6 |
| photo | 19.3 / 33.1 | 2.6 / 15.1 | 1.4 / 3.7 | 59.7 / 69.1 | 61.2 / 72.6 | — |
| feed-image | 9.0 / 10.4 | 0.0 / 0.3 | 2.0 / 5.6 | 30.9 / 42.4 | 32.8 / 48.0 | — |
| once-photo | 20.4 / 28.8 | 2.8 / 13.5 | 1.5 / 1.8 | 63.0 / 71.5 | 64.5 / 72.7 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 6.2 / 9.8 | 56.6 / 72.2 | 60.4 / 75.8 | 126.5 / 144.4 |
| feed-image | 5.5 / 12.6 | 49.9 / 69.7 | 53.0 / 72.5 | 91.6 / 114.2 |
| once-photo | 5.7 / 7.8 | 21.1 / 32.9 | 24.7 / 36.6 | 92.5 / 109.4 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 2.0 / 2.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-add | 40.0 / 43.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-replace | 40.0 / 48.0 | 20.0 / 23.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-remove | 40.0 / 40.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reply | 54.0 / 67.0 | 23.0 / 29.0 | 9.0 / 18.0 | 5.0 / 6.0 |
| photo | 54.0 / 61.0 | 23.0 / 29.0 | 47.0 / 92.0 | 5.0 / 6.0 |
| feed-image | 2.0 / 3.0 | 1.0 / 1.0 | 49.0 / 94.0 | 0.0 / 0.0 |
| once-photo | 54.0 / 67.0 | 23.0 / 29.0 | 30.0 / 57.0 | 5.0 / 6.0 |

## final-wasm-viewed

Device: wasm; media: viewed; available CPUs: 96; busy workers: 0.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 9.4 / 11.8 | — | 3.0 / 4.6 | 5.8 / 7.1 | 5.6 / 6.5 | 1.0 / 1.8 | 3.2 / 3.7 |
| reaction-add | 9.8 / 12.2 | — | 2.6 / 3.7 | 7.1 / 7.9 | 6.3 / 7.2 | 1.0 / 1.3 | 2.9 / 3.7 |
| reaction-replace | 9.8 / 11.1 | — | 3.0 / 3.9 | 7.6 / 8.4 | 5.9 / 6.8 | 1.1 / 1.3 | 3.2 / 3.8 |
| reaction-remove | 9.3 / 11.2 | — | 3.1 / 4.1 | 7.4 / 8.2 | 5.9 / 7.1 | 1.1 / 1.5 | 3.0 / 4.0 |
| reply | 9.5 / 12.5 | — | 2.8 / 4.3 | 10.0 / 12.2 | 11.0 / 12.2 | 1.4 / 2.0 | 3.7 / 4.5 |
| photo | 28.8 / 75.5 | 7.7 / 9.7 | 3.3 / 4.0 | 10.3 / 10.9 | 11.2 / 12.8 | 1.5 / 2.4 | 3.5 / 4.2 |
| feed-image | 27.4 / 31.2 | 7.6 / 9.0 | 2.5 / 4.0 | 6.3 / 7.4 | 5.9 / 6.6 | 1.0 / 1.2 | 3.1 / 4.1 |
| once-photo | 27.6 / 30.8 | 7.7 / 8.3 | 3.4 / 4.2 | 10.2 / 11.4 | 11.1 / 11.8 | 1.5 / 2.0 | 3.5 / 4.2 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 2.3 / 3.2 | 0.0 / 0.2 | 2.6 / 3.5 | 21.3 / 24.0 | 24.0 / 27.5 | — |
| reaction-add | 2.6 / 3.2 | 0.6 / 0.7 | 0.3 / 0.4 | 24.0 / 25.9 | 24.4 / 26.4 | — |
| reaction-replace | 2.8 / 3.3 | 0.6 / 0.7 | 0.3 / 0.4 | 24.5 / 25.6 | 24.8 / 26.0 | — |
| reaction-remove | 2.6 / 3.1 | 0.6 / 0.7 | 0.3 / 0.3 | 24.2 / 25.6 | 24.5 / 25.9 | — |
| reply | 25.5 / 31.2 | 4.3 / 16.3 | 2.3 / 2.8 | 60.6 / 74.9 | 63.1 / 76.4 | 63.1 / 76.4 |
| photo | 17.2 / 30.5 | 5.4 / 16.8 | 2.2 / 2.6 | 62.2 / 66.0 | 64.4 / 68.6 | — |
| feed-image | 9.7 / 13.3 | 0.0 / 0.1 | 2.8 / 3.6 | 28.5 / 34.8 | 31.2 / 38.1 | — |
| once-photo | 25.3 / 29.4 | 4.4 / 14.0 | 2.1 / 2.6 | 60.7 / 65.8 | 62.9 / 68.1 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 8.4 / 12.5 | 55.9 / 75.1 | 57.9 / 76.9 | 129.4 / 144.4 |
| feed-image | 6.9 / 10.8 | 68.8 / 79.7 | 72.6 / 83.4 | 109.3 / 123.8 |
| once-photo | 8.8 / 12.2 | 15.0 / 20.0 | 17.1 / 21.9 | 87.7 / 94.3 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 2.0 / 2.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-add | 40.0 / 40.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-replace | 40.0 / 40.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-remove | 40.0 / 40.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reply | 55.0 / 55.0 | 23.0 / 23.0 | 9.0 / 18.0 | 6.0 / 6.0 |
| photo | 55.0 / 55.0 | 23.0 / 23.0 | 47.0 / 92.0 | 6.0 / 6.0 |
| feed-image | 2.0 / 2.0 | 1.0 / 1.0 | 49.0 / 94.0 | 0.0 / 0.0 |
| once-photo | 55.0 / 55.0 | 23.0 / 23.0 | 30.0 / 57.0 | 6.0 / 6.0 |
