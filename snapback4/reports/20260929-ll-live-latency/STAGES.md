# Stage distributions

Each cell is p50 / p95 in milliseconds, except work counts. Nearest-rank percentiles; 20 trials per flow. All 2,240 trials completed without timeout. These stages overlap: a whole server answer can finish before local apply, yielding negative apply-to-evaluation or publication-to-fetch intervals. Do not sum independent percentiles. The raw UNIX-millisecond timestamps and sample maxima remain in the compressed traces and summary JSON. See REPORT.md for instrumentation boundaries and scope.

## baseline-process-4cpu

Device: process; media: undefined; available CPUs: 4; busy workers: undefined.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 6.6 / 9.5 | — | 2.1 / 3.1 | 7.4 / 12.0 | 3.2 / 4.0 | 1.5 / 1.9 | 1.6 / 2.5 |
| reaction-add | 6.3 / 9.9 | — | 2.3 / 2.9 | 15.5 / 19.0 | 3.9 / 4.3 | 1.3 / 1.7 | 1.7 / 1.8 |
| reaction-replace | 6.5 / 7.6 | — | 2.0 / 2.7 | 16.0 / 19.2 | 3.8 / 4.4 | 1.3 / 1.5 | 1.6 / 1.8 |
| reaction-remove | 5.9 / 8.2 | — | 2.2 / 3.0 | 15.8 / 17.9 | 3.5 / 4.6 | 1.2 / 1.4 | 1.6 / 1.9 |
| reply | 5.8 / 7.5 | — | 2.0 / 2.9 | 17.6 / 20.1 | 4.5 / 7.6 | 2.9 / 4.9 | 2.1 / 3.0 |
| photo | 640.7 / 658.7 | 624.9 / 641.6 | 2.6 / 3.4 | 18.8 / 23.9 | 4.3 / 7.1 | 3.5 / 5.1 | 2.3 / 3.1 |
| feed-image | 624.6 / 664.0 | 607.8 / 645.3 | 2.6 / 3.7 | 10.0 / 18.8 | 3.3 / 4.6 | 1.6 / 2.5 | 1.8 / 2.7 |
| once-photo | 624.2 / 664.0 | 609.5 / 653.4 | 2.4 / 3.6 | 20.0 / 25.1 | 6.0 / 8.5 | 3.3 / 6.4 | 2.4 / 3.3 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 4.6 / 5.1 | 0.1 / 0.1 | 1.3 / 1.7 | 21.3 / 27.5 | 22.5 / 28.6 | — |
| reaction-add | 5.5 / 6.2 | 0.0 / 0.1 | 0.2 / 0.3 | 30.6 / 34.6 | 30.8 / 35.0 | — |
| reaction-replace | 5.3 / 6.1 | 0.0 / 0.2 | 0.2 / 0.3 | 30.7 / 34.1 | 30.9 / 34.3 | — |
| reaction-remove | 5.1 / 5.8 | 0.0 / 0.1 | 0.2 / 0.3 | 30.4 / 31.8 | 30.6 / 32.1 | — |
| reply | 19.9 / 24.5 | 6.9 / 8.7 | 1.4 / 1.7 | 56.8 / 65.2 | 58.0 / 66.5 | 58.0 / 66.5 |
| photo | 20.4 / 31.4 | 7.9 / 13.1 | 1.4 / 1.7 | 62.4 / 80.0 | 63.5 / 81.3 | — |
| feed-image | 9.4 / 12.5 | 0.0 / 0.1 | 1.4 / 3.1 | 30.4 / 41.3 | 32.3 / 42.6 | — |
| once-photo | 20.1 / 25.4 | 8.3 / 12.9 | 1.4 / 1.7 | 64.3 / 75.1 | 65.6 / 76.2 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 1.8 / 2.1 | 7.4 / 9.3 | 9.1 / 14.0 | 72.9 / 96.0 |
| feed-image | 1.7 / 3.3 | 5.1 / 6.5 | 6.1 / 8.2 | 38.3 / 51.9 |
| once-photo | 1.9 / 2.2 | 12.2 / 16.4 | 14.2 / 17.7 | 79.6 / 92.2 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 2.0 / 2.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-add | 40.0 / 40.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-replace | 40.0 / 40.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-remove | 40.0 / 40.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reply | 52.0 / 58.0 | 23.0 / 23.0 | 0.0 / 0.0 | 6.0 / 6.0 |
| photo | 54.0 / 63.0 | 23.0 / 24.0 | 0.0 / 0.0 | 6.0 / 6.0 |
| feed-image | 2.0 / 2.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 1.0 |
| once-photo | 55.0 / 62.0 | 23.0 / 27.0 | 0.0 / 0.0 | 6.0 / 6.0 |

## baseline-process-loaded

Device: process; media: undefined; available CPUs: 4; busy workers: 3.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 7.8 / 13.2 | — | 4.3 / 10.3 | 13.4 / 20.5 | 6.4 / 8.8 | 2.7 / 6.0 | 2.3 / 5.4 |
| reaction-add | 8.8 / 11.7 | — | 4.6 / 6.9 | 35.2 / 43.5 | 7.2 / 10.5 | 6.1 / 11.5 | 6.3 / 10.2 |
| reaction-replace | 8.4 / 11.8 | — | 4.3 / 7.3 | 36.0 / 41.6 | 7.7 / 11.0 | 6.7 / 9.7 | 6.4 / 11.5 |
| reaction-remove | 7.3 / 11.1 | — | 3.4 / 6.4 | 32.0 / 37.0 | 6.6 / 9.7 | 4.8 / 8.2 | 6.2 / 8.8 |
| reply | 7.9 / 11.0 | — | 4.3 / 7.0 | 38.3 / 43.9 | 9.2 / 18.5 | 12.1 / 17.3 | 8.5 / 12.9 |
| photo | 619.3 / 687.0 | 603.8 / 673.6 | 3.5 / 6.7 | 37.0 / 44.9 | 10.4 / 15.1 | 12.7 / 17.4 | 7.7 / 10.2 |
| feed-image | 636.1 / 686.7 | 617.4 / 655.9 | 3.9 / 8.1 | 15.0 / 19.8 | 6.3 / 7.9 | 2.3 / 5.2 | 4.2 / 6.2 |
| once-photo | 621.7 / 680.5 | 604.5 / 660.7 | 3.9 / 8.8 | 38.1 / 44.7 | 11.1 / 18.4 | 10.0 / 16.6 | 10.2 / 16.1 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 7.8 / 12.2 | 0.1 / 0.1 | 1.4 / 2.6 | 38.1 / 50.2 | 40.7 / 51.6 | — |
| reaction-add | 28.9 / 40.5 | 0.0 / 0.1 | 0.1 / 0.7 | 87.8 / 103.3 | 87.9 / 103.4 | — |
| reaction-replace | 25.6 / 37.7 | 0.0 / 0.1 | 0.1 / 0.7 | 89.4 / 99.2 | 89.5 / 99.4 | — |
| reaction-remove | 27.2 / 42.9 | 0.0 / 0.1 | 0.1 / 0.9 | 82.9 / 97.8 | 83.6 / 97.9 | — |
| reply | 59.6 / 75.6 | 13.9 / 23.4 | 1.6 / 3.0 | 147.3 / 171.2 | 149.1 / 172.8 | 149.1 / 172.8 |
| photo | 63.8 / 78.3 | 13.7 / 24.0 | 1.5 / 2.0 | 155.7 / 163.9 | 157.3 / 165.5 | — |
| feed-image | 13.4 / 16.8 | 0.0 / 0.1 | 1.6 / 4.7 | 45.1 / 51.0 | 47.6 / 54.8 | — |
| once-photo | 61.7 / 92.7 | 13.8 / 32.7 | 1.6 / 3.3 | 152.9 / 181.9 | 154.4 / 183.5 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 2.2 / 3.1 | 13.4 / 17.1 | 16.6 / 22.7 | 174.3 / 188.5 |
| feed-image | 1.7 / 4.8 | 12.4 / 17.4 | 15.1 / 22.0 | 60.2 / 73.7 |
| once-photo | 2.1 / 3.8 | 26.7 / 30.5 | 30.3 / 41.6 | 186.5 / 219.0 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 2.0 / 3.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 1.0 |
| reaction-add | 63.0 / 66.0 | 33.0 / 36.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-replace | 62.0 / 65.0 | 35.0 / 37.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-remove | 63.0 / 66.0 | 32.0 / 36.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reply | 76.0 / 81.0 | 35.0 / 41.0 | 0.0 / 0.0 | 6.0 / 6.0 |
| photo | 76.0 / 76.0 | 35.0 / 38.0 | 0.0 / 0.0 | 5.0 / 6.0 |
| feed-image | 2.0 / 3.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 1.0 |
| once-photo | 76.0 / 80.0 | 36.0 / 41.0 | 0.0 / 0.0 | 6.0 / 6.0 |

## baseline-process

Device: process; media: undefined; available CPUs: 96; busy workers: undefined.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 8.2 / 13.0 | — | 3.0 / 4.1 | 10.6 / 19.0 | 4.4 / 5.2 | 2.2 / 4.1 | 2.8 / 4.6 |
| reaction-add | 9.6 / 12.5 | — | 2.6 / 3.7 | 24.4 / 29.4 | 5.7 / 6.7 | 2.2 / 3.4 | 3.3 / 4.9 |
| reaction-replace | 9.7 / 11.6 | — | 2.3 / 3.5 | 23.4 / 27.6 | 6.1 / 6.8 | 2.1 / 2.3 | 2.6 / 3.5 |
| reaction-remove | 8.9 / 10.9 | — | 2.4 / 6.0 | 22.9 / 26.9 | 5.1 / 7.5 | 1.9 / 2.8 | 2.3 / 3.7 |
| reply | 8.8 / 10.4 | — | 2.2 / 3.2 | 25.7 / 29.8 | 7.6 / 9.7 | 3.0 / 6.0 | 2.7 / 3.6 |
| photo | 820.5 / 903.9 | 798.3 / 878.7 | 3.2 / 4.1 | 27.8 / 28.6 | 7.2 / 9.1 | 3.7 / 5.7 | 3.4 / 3.7 |
| feed-image | 816.4 / 866.7 | 798.8 / 846.0 | 3.1 / 4.2 | 13.7 / 18.0 | 5.1 / 7.9 | 2.3 / 2.7 | 2.9 / 3.1 |
| once-photo | 821.5 / 880.5 | 797.4 / 860.3 | 3.0 / 4.2 | 27.7 / 34.1 | 7.2 / 9.2 | 4.1 / 7.2 | 3.3 / 4.3 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 8.0 / 13.3 | 0.1 / 0.1 | 2.8 / 3.6 | 34.3 / 43.8 | 37.1 / 46.1 | — |
| reaction-add | 25.7 / 33.0 | 0.0 / 0.1 | 0.2 / 0.3 | 68.2 / 76.9 | 68.5 / 77.1 | — |
| reaction-replace | 5.5 / 25.5 | 0.0 / 0.1 | 0.2 / 0.3 | 42.1 / 62.7 | 42.3 / 63.0 | — |
| reaction-remove | 4.6 / 24.3 | 0.0 / 0.2 | 0.3 / 0.3 | 41.2 / 63.2 | 41.5 / 63.4 | — |
| reply | 34.3 / 40.8 | 7.8 / 13.6 | 1.7 / 2.6 | 84.6 / 92.9 | 86.8 / 95.2 | 86.8 / 95.2 |
| photo | 46.9 / 58.6 | 8.2 / 14.5 | 2.3 / 2.6 | 102.1 / 110.6 | 104.6 / 113.1 | — |
| feed-image | 15.1 / 19.4 | 0.1 / 0.1 | 3.1 / 3.6 | 44.2 / 50.1 | 47.4 / 53.7 | — |
| once-photo | 44.9 / 58.4 | 7.3 / 14.4 | 2.3 / 3.1 | 100.0 / 116.6 | 101.7 / 119.1 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 3.0 / 3.5 | 11.8 / 14.4 | 17.7 / 19.4 | 121.9 / 132.4 |
| feed-image | 3.3 / 4.0 | 10.7 / 13.3 | 13.0 / 20.5 | 59.4 / 72.5 |
| once-photo | 3.1 / 4.1 | 18.0 / 21.5 | 21.1 / 24.9 | 122.2 / 142.0 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 2.0 / 3.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 1.0 |
| reaction-add | 57.0 / 65.0 | 24.0 / 28.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-replace | 41.0 / 62.0 | 23.0 / 36.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-remove | 46.0 / 61.0 | 28.0 / 40.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reply | 69.0 / 78.0 | 27.0 / 35.0 | 0.0 / 0.0 | 6.0 / 6.0 |
| photo | 70.0 / 71.0 | 26.0 / 27.0 | 0.0 / 0.0 | 5.0 / 6.0 |
| feed-image | 2.0 / 3.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 1.0 |
| once-photo | 70.0 / 72.0 | 26.0 / 28.0 | 0.0 / 0.0 | 6.0 / 6.0 |

## baseline-process-viewed-loaded

Device: process; media: viewed; available CPUs: 4; busy workers: 3.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 8.1 / 13.9 | — | 5.4 / 6.7 | 14.0 / 19.5 | 5.8 / 7.8 | 1.9 / 4.7 | 2.4 / 7.7 |
| reaction-add | 8.0 / 11.4 | — | 4.6 / 6.9 | 33.2 / 43.1 | 7.9 / 9.2 | 5.2 / 10.4 | 7.0 / 9.7 |
| reaction-replace | 9.0 / 11.9 | — | 4.8 / 7.6 | 33.1 / 40.5 | 8.6 / 13.0 | 5.1 / 10.6 | 6.7 / 13.3 |
| reaction-remove | 7.5 / 11.0 | — | 4.8 / 9.0 | 32.3 / 39.7 | 6.3 / 8.1 | 4.3 / 10.8 | 5.0 / 12.5 |
| reply | 7.8 / 11.7 | — | 4.6 / 8.9 | 35.2 / 43.4 | 10.3 / 14.9 | 9.9 / 14.1 | 9.3 / 16.6 |
| photo | 657.3 / 716.7 | 635.5 / 689.3 | 4.8 / 9.3 | 38.9 / 45.1 | 9.8 / 14.7 | 11.4 / 15.3 | 8.5 / 12.1 |
| feed-image | 629.1 / 674.7 | 612.1 / 658.3 | 3.5 / 7.4 | 16.4 / 20.8 | 5.2 / 9.2 | 1.9 / 5.6 | 2.4 / 6.5 |
| once-photo | 631.3 / 685.1 | 616.2 / 668.9 | 5.2 / 7.9 | 40.9 / 46.8 | 11.1 / 19.6 | 12.5 / 18.9 | 9.5 / 14.1 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 33.4 / 55.9 | 0.0 / 0.1 | 1.5 / 2.7 | 66.9 / 87.4 | 68.4 / 88.9 | — |
| reaction-add | 66.7 / 105.8 | 0.0 / 0.1 | 0.3 / 1.1 | 138.7 / 163.5 | 138.9 / 163.8 | — |
| reaction-replace | 64.4 / 106.3 | 0.0 / 0.1 | 0.2 / 0.4 | 124.7 / 173.6 | 124.8 / 173.7 | — |
| reaction-remove | 60.8 / 110.8 | 0.0 / 0.1 | 0.2 / 0.6 | 105.5 / 164.6 | 105.8 / 164.9 | — |
| reply | 46.5 / 64.4 | 13.8 / 26.9 | 1.7 / 2.7 | 135.7 / 163.0 | 138.1 / 164.0 | 138.1 / 164.0 |
| photo | 49.2 / 66.4 | 16.0 / 26.9 | 1.7 / 2.6 | 136.9 / 171.1 | 138.6 / 172.5 | — |
| feed-image | 39.8 / 66.9 | 0.0 / 0.1 | 1.5 / 2.6 | 72.5 / 98.9 | 73.7 / 101.5 | — |
| once-photo | 53.1 / 72.4 | 14.4 / 25.0 | 1.6 / 3.1 | 149.9 / 190.4 | 151.4 / 192.0 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 123.4 / 152.1 | 100.0 / 123.5 | 105.6 / 126.3 | 356.8 / 405.9 |
| feed-image | 27.0 / 48.1 | 94.2 / 121.8 | 97.5 / 124.5 | 199.3 / 272.9 |
| once-photo | 123.2 / 159.3 | 16.4 / 29.8 | 21.6 / 33.8 | 293.5 / 357.3 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 3.0 / 3.0 | 1.0 / 1.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reaction-add | 74.0 / 85.0 | 32.0 / 36.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reaction-replace | 73.0 / 82.0 | 32.0 / 39.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reaction-remove | 66.0 / 83.0 | 28.0 / 36.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reply | 76.0 / 94.0 | 35.0 / 38.0 | 18.0 / 34.0 | 4.0 / 6.0 |
| photo | 99.0 / 128.0 | 37.0 / 70.0 | 56.0 / 110.0 | 8.0 / 8.0 |
| feed-image | 3.0 / 3.0 | 1.0 / 1.0 | 59.0 / 113.0 | 0.0 / 0.0 |
| once-photo | 96.0 / 97.0 | 35.0 / 41.0 | 40.0 / 76.0 | 6.0 / 6.0 |

## baseline-process-viewed

Device: process; media: viewed; available CPUs: 96; busy workers: 0.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 8.6 / 10.4 | — | 2.9 / 4.7 | 12.0 / 14.3 | 4.6 / 5.9 | 2.6 / 5.0 | 3.2 / 15.5 |
| reaction-add | 9.8 / 10.8 | — | 2.7 / 3.5 | 26.0 / 29.7 | 5.4 / 6.7 | 2.4 / 3.4 | 3.6 / 4.9 |
| reaction-replace | 10.2 / 11.2 | — | 2.7 / 3.9 | 24.2 / 26.5 | 5.1 / 6.7 | 2.1 / 3.1 | 2.8 / 3.7 |
| reaction-remove | 9.4 / 10.4 | — | 2.7 / 3.7 | 23.1 / 26.1 | 4.9 / 6.4 | 2.1 / 2.4 | 2.6 / 3.6 |
| reply | 8.8 / 9.9 | — | 3.1 / 3.9 | 27.5 / 30.5 | 7.1 / 7.8 | 4.6 / 6.1 | 3.2 / 4.7 |
| photo | 804.4 / 864.8 | 787.5 / 840.6 | 3.1 / 4.2 | 28.8 / 39.6 | 7.3 / 8.9 | 4.5 / 5.8 | 3.4 / 4.2 |
| feed-image | 827.7 / 851.1 | 803.4 / 830.1 | 2.9 / 4.1 | 13.7 / 17.2 | 4.9 / 6.8 | 2.4 / 2.8 | 2.9 / 3.5 |
| once-photo | 835.8 / 862.5 | 815.6 / 842.6 | 2.9 / 4.5 | 27.9 / 33.2 | 7.1 / 9.7 | 4.4 / 7.7 | 3.3 / 5.8 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 41.5 / 75.3 | 0.1 / 0.2 | 3.2 / 4.0 | 65.2 / 109.2 | 66.7 / 113.5 | — |
| reaction-add | 60.7 / 102.8 | 0.1 / 0.2 | 0.3 / 0.5 | 104.7 / 141.6 | 104.8 / 142.0 | — |
| reaction-replace | 53.2 / 99.9 | 0.1 / 0.1 | 0.3 / 0.4 | 91.4 / 138.8 | 91.7 / 139.1 | — |
| reaction-remove | 56.9 / 100.4 | 0.0 / 0.1 | 0.3 / 0.4 | 89.4 / 137.7 | 89.7 / 138.1 | — |
| reply | 35.4 / 44.1 | 4.4 / 13.6 | 3.4 / 4.0 | 88.0 / 95.5 | 91.4 / 99.5 | 91.4 / 99.5 |
| photo | 41.3 / 47.4 | 4.9 / 15.7 | 3.2 / 3.8 | 95.4 / 106.9 | 98.7 / 109.2 | — |
| feed-image | 47.4 / 91.1 | 0.1 / 0.1 | 2.8 / 3.7 | 80.7 / 119.5 | 84.0 / 123.2 | — |
| once-photo | 38.0 / 43.8 | 5.3 / 18.7 | 3.2 / 3.8 | 93.5 / 104.3 | 96.5 / 106.7 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 84.9 / 144.6 | 154.4 / 216.6 | 157.8 / 220.8 | 341.2 / 472.0 |
| feed-image | 39.1 / 76.7 | 179.5 / 220.8 | 182.1 / 222.9 | 300.6 / 425.8 |
| once-photo | 85.3 / 158.0 | 17.3 / 18.8 | 19.7 / 21.3 | 194.3 / 276.4 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 3.0 / 4.0 | 1.0 / 1.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reaction-add | 63.0 / 83.0 | 26.0 / 28.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reaction-replace | 61.0 / 83.0 | 23.0 / 27.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reaction-remove | 62.0 / 82.0 | 22.0 / 26.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reply | 72.0 / 92.0 | 26.0 / 30.0 | 18.0 / 28.0 | 6.0 / 6.0 |
| photo | 89.0 / 125.0 | 27.0 / 60.0 | 56.0 / 118.0 | 6.0 / 8.0 |
| feed-image | 3.0 / 4.0 | 1.0 / 1.0 | 59.0 / 113.0 | 0.0 / 0.0 |
| once-photo | 89.0 / 94.0 | 27.0 / 30.0 | 40.0 / 76.0 | 6.0 / 6.0 |

## baseline-wasm-4cpu

Device: wasm; media: undefined; available CPUs: 4; busy workers: undefined.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 6.6 / 8.1 | — | 2.5 / 3.2 | 3.5 / 5.0 | 3.4 / 4.5 | 0.6 / 1.3 | 1.6 / 2.4 |
| reaction-add | 6.3 / 9.8 | — | 2.2 / 2.8 | 3.9 / 5.1 | 4.1 / 5.7 | 0.5 / 1.1 | 1.5 / 2.4 |
| reaction-replace | 6.9 / 8.7 | — | 2.2 / 2.8 | 4.1 / 6.1 | 4.4 / 5.3 | 0.5 / 1.1 | 1.3 / 1.9 |
| reaction-remove | 6.2 / 7.3 | — | 2.2 / 3.1 | 3.8 / 5.6 | 4.0 / 5.1 | 0.6 / 1.2 | 1.5 / 2.4 |
| reply | 6.7 / 7.4 | — | 2.2 / 3.0 | 5.2 / 6.4 | 5.8 / 7.6 | 1.1 / 1.8 | 2.5 / 3.9 |
| photo | 21.8 / 58.9 | 6.0 / 9.9 | 2.3 / 3.2 | 5.3 / 8.1 | 5.4 / 7.2 | 1.1 / 3.1 | 2.6 / 3.6 |
| feed-image | 16.2 / 21.2 | 5.5 / 7.3 | 2.4 / 3.1 | 3.4 / 4.4 | 3.5 / 4.6 | 0.6 / 1.7 | 1.6 / 3.2 |
| once-photo | 15.0 / 18.6 | 5.2 / 6.0 | 2.3 / 2.8 | 5.2 / 8.5 | 5.7 / 7.5 | 0.8 / 1.7 | 2.4 / 5.6 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 1.2 / 1.8 | 0.0 / 0.1 | 1.4 / 1.7 | 13.5 / 15.5 | 14.9 / 17.8 | — |
| reaction-add | 1.3 / 1.8 | 0.2 / 0.3 | 0.2 / 0.3 | 14.6 / 15.9 | 14.8 / 16.1 | — |
| reaction-replace | 1.2 / 2.0 | 0.2 / 0.4 | 0.2 / 0.3 | 14.3 / 17.3 | 14.6 / 17.5 | — |
| reaction-remove | 1.3 / 1.6 | 0.2 / 0.3 | 0.2 / 0.3 | 14.3 / 16.5 | 14.5 / 16.6 | — |
| reply | 13.1 / 16.7 | 0.5 / 2.5 | 1.5 / 1.9 | 31.7 / 37.7 | 32.7 / 39.5 | 32.7 / 40.8 |
| photo | 12.5 / 15.4 | 0.6 / 1.0 | 1.3 / 1.6 | 31.0 / 35.1 | 32.6 / 36.6 | — |
| feed-image | 4.2 / 4.7 | 0.0 / 0.1 | 1.2 / 1.5 | 15.9 / 19.2 | 17.1 / 20.2 | — |
| once-photo | 13.0 / 14.8 | 0.6 / 1.0 | 1.3 / 1.6 | 30.6 / 35.6 | 31.7 / 37.1 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 1.8 / 2.5 | 6.4 / 7.7 | 8.9 / 10.9 | 42.1 / 46.4 |
| feed-image | 1.4 / 1.9 | 5.2 / 6.3 | 6.1 / 7.7 | 23.7 / 27.9 |
| once-photo | 1.8 / 2.1 | 11.9 / 14.5 | 13.1 / 15.8 | 45.9 / 52.0 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 2.0 / 2.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-add | 40.0 / 40.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-replace | 40.0 / 40.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-remove | 40.0 / 40.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reply | 48.0 / 49.0 | 23.0 / 23.0 | 0.0 / 0.0 | 5.0 / 6.0 |
| photo | 48.0 / 49.0 | 23.0 / 23.0 | 0.0 / 0.0 | 5.0 / 6.0 |
| feed-image | 2.0 / 2.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| once-photo | 48.0 / 49.0 | 23.0 / 23.0 | 0.0 / 0.0 | 5.0 / 6.0 |

## baseline-wasm-loaded

Device: wasm; media: undefined; available CPUs: 4; busy workers: 3.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 8.3 / 16.1 | — | 5.5 / 7.5 | 5.5 / 10.2 | 7.2 / 10.8 | 1.1 / 2.7 | 2.7 / 5.1 |
| reaction-add | 11.0 / 16.4 | — | 4.4 / 7.8 | 8.4 / 12.9 | 7.1 / 12.4 | 0.6 / 3.3 | 2.0 / 4.2 |
| reaction-replace | 10.2 / 15.2 | — | 5.3 / 7.4 | 7.7 / 13.3 | 8.0 / 10.6 | 1.3 / 5.5 | 2.4 / 4.8 |
| reaction-remove | 9.6 / 12.6 | — | 5.3 / 6.7 | 7.9 / 12.8 | 7.2 / 13.2 | 0.8 / 4.1 | 2.7 / 7.6 |
| reply | 9.0 / 11.2 | — | 4.7 / 7.7 | 10.6 / 15.6 | 11.5 / 15.2 | 1.2 / 5.9 | 3.1 / 5.4 |
| photo | 24.3 / 27.9 | 8.8 / 11.3 | 4.3 / 6.9 | 11.3 / 15.5 | 12.4 / 21.1 | 1.6 / 11.1 | 3.7 / 8.7 |
| feed-image | 22.9 / 32.1 | 8.8 / 12.0 | 5.0 / 10.5 | 7.5 / 11.6 | 5.7 / 9.9 | 0.7 / 3.3 | 2.4 / 6.3 |
| once-photo | 22.7 / 27.9 | 9.0 / 13.7 | 5.0 / 6.5 | 9.7 / 12.5 | 13.5 / 19.6 | 1.9 / 4.9 | 3.7 / 6.0 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 1.7 / 4.5 | 0.1 / 1.0 | 1.6 / 5.8 | 25.5 / 33.3 | 28.5 / 36.9 | — |
| reaction-add | 1.7 / 4.1 | 0.3 / 2.0 | 0.2 / 1.4 | 27.9 / 36.6 | 28.7 / 36.8 | — |
| reaction-replace | 2.1 / 5.0 | 0.3 / 2.1 | 0.2 / 1.6 | 28.9 / 37.0 | 29.1 / 37.2 | — |
| reaction-remove | 2.2 / 3.9 | 0.3 / 2.0 | 0.2 / 1.6 | 26.9 / 41.0 | 28.1 / 41.2 | — |
| reply | 25.1 / 34.6 | 1.0 / 4.0 | 1.5 / 2.0 | 58.3 / 74.6 | 59.6 / 76.7 | 59.6 / 79.2 |
| photo | 23.9 / 30.4 | 1.1 / 2.9 | 1.5 / 4.1 | 59.3 / 75.2 | 60.9 / 76.6 | — |
| feed-image | 5.2 / 8.3 | 0.0 / 0.4 | 2.3 / 6.2 | 30.4 / 36.6 | 33.6 / 40.5 | — |
| once-photo | 23.8 / 31.8 | 1.0 / 3.3 | 1.4 / 3.8 | 58.5 / 73.8 | 61.0 / 74.8 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 1.9 / 4.6 | 13.1 / 21.1 | 17.3 / 29.8 | 78.7 / 102.2 |
| feed-image | 2.4 / 6.3 | 10.3 / 12.3 | 12.5 / 15.2 | 47.3 / 53.1 |
| once-photo | 2.1 / 4.5 | 24.2 / 29.3 | 28.0 / 34.7 | 89.4 / 104.5 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 2.0 / 2.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-add | 40.0 / 48.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-replace | 40.0 / 48.0 | 20.0 / 22.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-remove | 40.0 / 48.0 | 20.0 / 28.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reply | 48.0 / 61.0 | 23.0 / 29.0 | 0.0 / 0.0 | 5.0 / 6.0 |
| photo | 54.0 / 71.0 | 23.0 / 35.0 | 0.0 / 0.0 | 5.0 / 6.0 |
| feed-image | 2.0 / 2.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| once-photo | 53.0 / 66.0 | 23.0 / 29.0 | 0.0 / 0.0 | 5.0 / 6.0 |

## baseline-wasm

Device: wasm; media: undefined; available CPUs: 96; busy workers: undefined.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 8.9 / 12.3 | — | 2.9 / 3.8 | 6.2 / 8.5 | 5.2 / 6.5 | 1.0 / 1.5 | 3.2 / 4.0 |
| reaction-add | 8.8 / 18.0 | — | 3.1 / 4.8 | 7.6 / 9.3 | 5.5 / 7.7 | 1.1 / 1.2 | 2.8 / 3.8 |
| reaction-replace | 9.8 / 10.5 | — | 2.7 / 4.0 | 7.7 / 9.2 | 5.9 / 7.2 | 1.1 / 1.3 | 3.2 / 3.8 |
| reaction-remove | 8.7 / 9.9 | — | 3.4 / 4.1 | 7.1 / 8.2 | 5.7 / 7.0 | 1.1 / 1.3 | 3.0 / 4.2 |
| reply | 9.6 / 12.2 | — | 2.9 / 3.9 | 10.1 / 12.4 | 10.9 / 13.2 | 1.6 / 2.5 | 3.3 / 5.5 |
| photo | 28.3 / 75.5 | 6.9 / 10.0 | 3.0 / 3.7 | 10.2 / 14.3 | 11.0 / 13.6 | 1.8 / 2.2 | 3.2 / 4.1 |
| feed-image | 25.5 / 28.5 | 7.2 / 11.4 | 2.9 / 4.1 | 6.7 / 10.4 | 5.1 / 6.6 | 1.0 / 1.7 | 3.3 / 4.0 |
| once-photo | 26.0 / 29.4 | 7.2 / 8.2 | 2.8 / 4.1 | 10.4 / 11.2 | 11.4 / 12.0 | 1.8 / 2.5 | 3.4 / 3.8 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 2.4 / 4.0 | 0.0 / 0.1 | 3.1 / 3.7 | 21.7 / 24.1 | 25.2 / 27.7 | — |
| reaction-add | 2.6 / 3.3 | 0.6 / 0.8 | 0.3 / 0.4 | 24.0 / 26.9 | 24.2 / 27.3 | — |
| reaction-replace | 2.7 / 3.3 | 0.6 / 0.8 | 0.3 / 0.4 | 23.9 / 27.0 | 24.3 / 27.3 | — |
| reaction-remove | 2.6 / 3.0 | 0.6 / 0.8 | 0.3 / 0.4 | 23.1 / 26.6 | 23.4 / 26.8 | — |
| reply | 27.4 / 30.9 | 1.4 / 3.5 | 2.3 / 2.7 | 58.9 / 64.5 | 61.2 / 67.7 | 61.2 / 70.8 |
| photo | 28.0 / 31.8 | 1.5 / 1.9 | 2.3 / 2.6 | 58.4 / 73.4 | 61.2 / 75.7 | — |
| feed-image | 8.7 / 9.9 | 0.0 / 0.1 | 2.9 / 3.6 | 27.9 / 31.7 | 30.7 / 34.3 | — |
| once-photo | 28.7 / 31.0 | 1.5 / 2.1 | 2.4 / 2.7 | 60.7 / 64.5 | 63.1 / 66.9 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 3.1 / 3.6 | 12.1 / 13.9 | 15.6 / 18.0 | 77.1 / 93.4 |
| feed-image | 3.2 / 3.8 | 10.3 / 11.9 | 12.4 / 14.1 | 43.8 / 47.2 |
| once-photo | 3.3 / 3.6 | 20.0 / 24.5 | 21.7 / 26.8 | 86.1 / 92.4 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 2.0 / 2.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-add | 40.0 / 40.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-replace | 40.0 / 40.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-remove | 40.0 / 40.0 | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reply | 50.0 / 55.0 | 23.0 / 23.0 | 0.0 / 0.0 | 6.0 / 6.0 |
| photo | 50.0 / 55.0 | 23.0 / 23.0 | 0.0 / 0.0 | 6.0 / 6.0 |
| feed-image | 2.0 / 2.0 | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| once-photo | 52.0 / 55.0 | 23.0 / 23.0 | 0.0 / 0.0 | 6.0 / 6.0 |

## baseline-wasm-viewed-loaded

Device: wasm; media: viewed; available CPUs: 4; busy workers: 3.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 8.9 / 19.1 | — | 4.3 / 7.8 | 5.4 / 9.3 | 5.5 / 10.4 | 1.2 / 4.4 | 2.5 / 5.4 |
| reaction-add | 8.8 / 11.4 | — | 4.8 / 7.6 | 7.0 / 11.3 | 8.8 / 14.1 | 0.9 / 2.2 | 2.1 / 6.8 |
| reaction-replace | 8.6 / 11.9 | — | 4.3 / 5.7 | 8.1 / 12.7 | 7.5 / 11.1 | 0.7 / 3.1 | 2.6 / 4.9 |
| reaction-remove | 8.2 / 10.4 | — | 3.9 / 6.5 | 7.9 / 9.5 | 7.1 / 11.2 | 1.0 / 8.3 | 2.9 / 4.5 |
| reply | 9.0 / 12.8 | — | 5.0 / 7.9 | 10.8 / 16.2 | 11.4 / 21.2 | 1.6 / 5.0 | 4.0 / 6.7 |
| photo | 24.2 / 28.2 | 9.5 / 10.4 | 4.0 / 9.4 | 11.6 / 19.8 | 13.4 / 18.0 | 1.4 / 4.1 | 4.0 / 10.5 |
| feed-image | 22.7 / 25.3 | 9.0 / 11.3 | 4.1 / 8.0 | 5.4 / 9.9 | 7.3 / 11.6 | 0.9 / 3.9 | 2.6 / 6.1 |
| once-photo | 23.1 / 28.7 | 8.1 / 13.0 | 4.4 / 9.0 | 10.0 / 18.9 | 13.0 / 19.1 | 0.9 / 9.2 | 3.2 / 7.3 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 5.1 / 11.1 | 0.0 / 0.4 | 1.6 / 6.1 | 27.3 / 35.1 | 30.2 / 37.1 | — |
| reaction-add | 3.8 / 9.5 | 0.3 / 1.6 | 0.2 / 0.9 | 31.7 / 43.2 | 31.8 / 43.4 | — |
| reaction-replace | 4.1 / 7.9 | 0.3 / 1.6 | 0.2 / 3.5 | 28.8 / 36.8 | 30.0 / 37.1 | — |
| reaction-remove | 4.5 / 9.2 | 0.3 / 1.1 | 0.2 / 2.8 | 30.0 / 34.9 | 31.5 / 35.3 | — |
| reply | 21.2 / 35.0 | 1.5 / 11.9 | 1.4 / 3.3 | 59.5 / 78.1 | 60.9 / 80.8 | 60.9 / 80.8 |
| photo | 22.2 / 30.7 | 2.6 / 11.3 | 1.5 / 2.5 | 64.0 / 77.7 | 65.5 / 79.2 | — |
| feed-image | 8.9 / 13.1 | 0.1 / 3.9 | 1.8 / 4.8 | 33.4 / 41.1 | 36.1 / 44.5 | — |
| once-photo | 20.8 / 37.2 | 1.7 / 14.8 | 1.5 / 2.0 | 62.4 / 77.5 | 63.9 / 79.3 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 5.3 / 10.3 | 54.9 / 67.3 | 58.4 / 72.9 | 132.2 / 144.6 |
| feed-image | 5.4 / 7.8 | 49.2 / 60.3 | 52.3 / 64.5 | 92.2 / 104.0 |
| once-photo | 5.3 / 10.0 | 19.4 / 38.0 | 21.7 / 47.4 | 92.1 / 124.0 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 2.0 / 2.0 | 1.0 / 1.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reaction-add | 40.0 / 56.0 | 20.0 / 28.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reaction-replace | 40.0 / 45.0 | 20.0 / 20.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reaction-remove | 40.0 / 48.0 | 20.0 / 20.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reply | 54.0 / 68.0 | 23.0 / 29.0 | 18.0 / 36.0 | 5.0 / 6.0 |
| photo | 54.0 / 67.0 | 24.0 / 29.0 | 56.0 / 110.0 | 5.0 / 6.0 |
| feed-image | 2.0 / 3.0 | 1.0 / 1.0 | 59.0 / 113.0 | 0.0 / 0.0 |
| once-photo | 54.0 / 75.0 | 23.0 / 36.0 | 40.0 / 76.0 | 5.0 / 6.0 |

## baseline-wasm-viewed

Device: wasm; media: viewed; available CPUs: 96; busy workers: 0.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 9.4 / 11.6 | — | 2.8 / 4.2 | 5.8 / 8.8 | 5.0 / 6.7 | 1.1 / 1.4 | 2.7 / 3.8 |
| reaction-add | 10.2 / 11.9 | — | 2.8 / 3.8 | 7.4 / 9.5 | 5.9 / 7.2 | 1.1 / 1.9 | 3.0 / 3.9 |
| reaction-replace | 10.3 / 11.5 | — | 2.9 / 4.2 | 8.0 / 9.7 | 5.6 / 7.3 | 1.2 / 1.4 | 3.0 / 4.3 |
| reaction-remove | 9.8 / 10.8 | — | 3.1 / 3.7 | 7.6 / 10.2 | 5.7 / 6.7 | 1.1 / 1.9 | 2.8 / 3.6 |
| reply | 9.9 / 12.2 | — | 2.8 / 3.5 | 10.7 / 15.1 | 11.5 / 13.6 | 1.8 / 2.2 | 3.5 / 5.0 |
| photo | 29.2 / 33.2 | 7.6 / 9.8 | 2.9 / 4.1 | 10.5 / 13.4 | 11.0 / 13.1 | 1.7 / 2.4 | 3.6 / 4.1 |
| feed-image | 27.7 / 31.8 | 7.7 / 8.6 | 2.6 / 3.9 | 6.5 / 9.3 | 5.4 / 6.7 | 1.0 / 1.6 | 3.1 / 4.3 |
| once-photo | 27.6 / 30.7 | 7.9 / 8.5 | 2.7 / 4.0 | 10.3 / 14.2 | 11.0 / 14.7 | 1.6 / 2.1 | 3.5 / 4.2 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 5.1 / 9.6 | 0.0 / 0.2 | 2.7 / 3.7 | 22.7 / 31.9 | 25.4 / 35.6 | — |
| reaction-add | 6.3 / 9.0 | 0.6 / 0.7 | 0.3 / 0.4 | 28.0 / 32.4 | 28.3 / 32.7 | — |
| reaction-replace | 6.3 / 9.7 | 0.6 / 0.7 | 0.3 / 0.4 | 28.1 / 33.0 | 28.5 / 33.3 | — |
| reaction-remove | 6.0 / 10.3 | 0.6 / 0.7 | 0.3 / 0.4 | 27.0 / 33.5 | 27.4 / 33.9 | — |
| reply | 17.4 / 28.4 | 12.6 / 15.8 | 1.9 / 2.6 | 61.4 / 83.8 | 63.2 / 84.9 | 63.2 / 84.9 |
| photo | 17.9 / 28.7 | 12.9 / 15.7 | 2.1 / 2.7 | 62.2 / 66.2 | 63.9 / 68.7 | — |
| feed-image | 11.9 / 16.7 | 0.1 / 0.2 | 2.9 / 3.5 | 31.4 / 39.7 | 34.4 / 43.2 | — |
| once-photo | 18.4 / 27.3 | 12.5 / 15.0 | 2.3 / 2.7 | 61.2 / 67.7 | 63.4 / 70.4 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 6.3 / 10.6 | 52.8 / 76.1 | 54.7 / 78.3 | 127.0 / 148.9 |
| feed-image | 6.8 / 10.4 | 66.4 / 92.6 | 75.0 / 94.7 | 109.1 / 140.4 |
| once-photo | 7.6 / 11.0 | 17.0 / 19.5 | 19.2 / 21.7 | 87.3 / 95.6 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 2.0 / 2.0 | 1.0 / 1.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reaction-add | 40.0 / 40.0 | 20.0 / 20.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reaction-replace | 40.0 / 40.0 | 20.0 / 20.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reaction-remove | 40.0 / 40.0 | 20.0 / 20.0 | 18.0 / 36.0 | 0.0 / 0.0 |
| reply | 54.0 / 55.0 | 23.0 / 23.0 | 18.0 / 36.0 | 6.0 / 6.0 |
| photo | 54.0 / 55.0 | 23.0 / 23.0 | 56.0 / 110.0 | 6.0 / 6.0 |
| feed-image | 2.0 / 2.0 | 1.0 / 1.0 | 59.0 / 113.0 | 0.0 / 0.0 |
| once-photo | 54.0 / 55.0 | 23.0 / 23.0 | 40.0 / 76.0 | 6.0 / 6.0 |

## final-process-viewed-loaded

Device: process; media: viewed; available CPUs: 4; busy workers: 3.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 7.4 / 10.4 | — | 4.8 / 8.4 | 13.7 / 17.8 | 5.8 / 8.2 | 2.3 / 8.2 | 2.4 / 5.6 |
| reaction-add | 8.1 / 11.2 | — | 4.9 / 6.9 | 15.4 / 19.5 | 6.0 / 9.8 | 2.9 / 5.3 | 3.0 / 5.4 |
| reaction-replace | 10.1 / 18.5 | — | 3.9 / 7.2 | 11.8 / 19.8 | 6.7 / 8.9 | 2.3 / 5.9 | 3.4 / 5.8 |
| reaction-remove | 9.2 / 11.5 | — | 4.3 / 6.4 | 11.1 / 17.5 | 6.0 / 7.7 | 2.9 / 8.0 | 2.6 / 5.8 |
| reply | 8.4 / 12.1 | — | 4.4 / 7.7 | 19.8 / 23.4 | 8.0 / 12.8 | 5.7 / 10.4 | 5.4 / 8.1 |
| photo | 620.0 / 798.5 | 604.3 / 784.9 | 4.5 / 6.4 | 21.5 / 24.9 | 9.5 / 13.7 | 5.3 / 9.5 | 4.9 / 11.8 |
| feed-image | 612.6 / 664.4 | 595.5 / 653.5 | 4.3 / 7.0 | 13.0 / 17.7 | 6.2 / 9.9 | 2.2 / 4.8 | 3.0 / 5.5 |
| once-photo | 608.4 / 667.9 | 594.4 / 642.0 | 4.9 / 6.8 | 21.6 / 26.4 | 7.1 / 13.7 | 5.7 / 9.2 | 5.4 / 16.2 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 9.9 / 13.7 | 0.0 / 0.1 | 1.6 / 3.1 | 41.0 / 60.6 | 42.7 / 61.7 | — |
| reaction-add | 10.9 / 13.4 | 0.0 / 0.1 | 0.2 / 0.8 | 44.3 / 47.5 | 44.6 / 48.0 | — |
| reaction-replace | 10.8 / 17.5 | 0.0 / 0.1 | 0.2 / 1.2 | 41.7 / 49.8 | 42.0 / 49.9 | — |
| reaction-remove | 12.0 / 14.5 | 0.0 / 0.1 | 0.2 / 1.1 | 39.5 / 47.2 | 39.8 / 47.8 | — |
| reply | 31.8 / 46.2 | 10.4 / 28.5 | 1.7 / 2.1 | 89.4 / 111.2 | 91.1 / 112.9 | 91.0 / 115.5 |
| photo | 28.7 / 44.0 | 10.3 / 32.2 | 1.6 / 3.0 | 88.0 / 111.1 | 89.7 / 115.6 | — |
| feed-image | 28.7 / 39.0 | 0.0 / 0.1 | 1.6 / 5.0 | 60.6 / 74.9 | 62.2 / 76.5 | — |
| once-photo | 31.9 / 38.6 | 12.4 / 35.2 | 1.6 / 4.9 | 95.5 / 118.8 | 98.1 / 119.7 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 93.0 / 132.0 | 107.0 / 125.5 | 110.1 / 129.9 | 283.3 / 362.8 |
| feed-image | 31.2 / 56.7 | 99.9 / 122.6 | 103.9 / 126.4 | 196.2 / 263.0 |
| once-photo | 96.3 / 144.8 | 15.9 / 28.6 | 19.0 / 33.5 | 210.4 / 271.5 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-add | 18.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-replace | 18.0 / 22.0 | 0.0 / 3.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-remove | 18.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reply | 28.0 / 28.0 | 2.0 / 2.0 | 9.0 / 18.0 | 6.0 / 6.0 |
| photo | 28.0 / 28.0 | 2.0 / 2.0 | 47.0 / 92.0 | 6.0 / 7.0 |
| feed-image | 1.0 / 1.0 | 0.0 / 0.0 | 49.0 / 94.0 | 0.0 / 0.0 |
| once-photo | 28.0 / 28.0 | 2.0 / 2.0 | 30.0 / 57.0 | 6.0 / 6.0 |

## final-process-viewed

Device: process; media: viewed; available CPUs: 96; busy workers: 0.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 9.1 / 10.4 | — | 2.8 / 4.1 | 12.3 / 18.4 | 4.6 / 6.1 | 3.0 / 3.4 | 3.5 / 4.3 |
| reaction-add | 9.9 / 10.8 | — | 2.2 / 3.2 | 10.4 / 12.2 | 5.7 / 6.6 | 3.0 / 4.0 | 3.6 / 4.7 |
| reaction-replace | 9.8 / 10.9 | — | 2.4 / 3.4 | 8.7 / 9.7 | 5.4 / 6.7 | 2.7 / 3.3 | 3.3 / 4.0 |
| reaction-remove | 8.6 / 10.9 | — | 2.2 / 3.5 | 7.6 / 9.0 | 4.9 / 6.8 | 2.3 / 2.6 | 2.8 / 3.2 |
| reply | 8.6 / 10.4 | — | 2.1 / 3.0 | 15.8 / 19.7 | 6.4 / 7.6 | 3.1 / 3.7 | 3.2 / 3.5 |
| photo | 750.2 / 821.4 | 731.5 / 801.0 | 2.9 / 3.8 | 18.1 / 24.5 | 6.1 / 7.3 | 3.2 / 3.7 | 3.4 / 4.3 |
| feed-image | 776.9 / 851.4 | 756.7 / 825.4 | 3.2 / 4.0 | 10.2 / 11.4 | 4.7 / 7.0 | 2.5 / 2.9 | 3.1 / 3.4 |
| once-photo | 781.4 / 799.1 | 758.6 / 780.4 | 2.7 / 4.0 | 18.1 / 26.7 | 6.6 / 7.5 | 2.4 / 3.5 | 3.3 / 3.6 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 9.4 / 12.5 | 0.1 / 0.1 | 2.9 / 3.8 | 36.6 / 45.4 | 40.0 / 47.8 | — |
| reaction-add | 10.5 / 13.9 | 0.1 / 0.1 | 0.3 / 0.3 | 35.6 / 45.0 | 35.9 / 45.5 | — |
| reaction-replace | 9.9 / 12.9 | 0.1 / 0.2 | 0.3 / 0.4 | 34.3 / 36.9 | 34.6 / 37.1 | — |
| reaction-remove | 8.5 / 9.6 | 0.1 / 0.1 | 0.3 / 0.4 | 28.8 / 33.0 | 29.1 / 33.2 | — |
| reply | 26.4 / 29.3 | 5.9 / 19.6 | 3.3 / 4.0 | 67.6 / 72.8 | 70.0 / 76.1 | 70.0 / 76.2 |
| photo | 26.2 / 30.1 | 6.2 / 16.9 | 3.2 / 3.9 | 67.8 / 77.7 | 71.5 / 80.4 | — |
| feed-image | 29.1 / 48.4 | 0.0 / 0.1 | 3.0 / 3.7 | 54.7 / 76.0 | 57.7 / 79.4 | — |
| once-photo | 24.6 / 27.7 | 5.6 / 19.8 | 3.0 / 3.7 | 66.6 / 83.2 | 70.4 / 86.9 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 77.5 / 129.3 | 174.3 / 235.8 | 177.3 / 237.8 | 315.2 / 421.3 |
| feed-image | 36.3 / 74.2 | 160.8 / 226.1 | 162.9 / 228.4 | 252.2 / 371.5 |
| once-photo | 59.2 / 143.1 | 16.6 / 19.6 | 18.9 / 22.4 | 143.2 / 236.1 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-add | 17.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-replace | 17.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-remove | 15.0 / 20.0 | 0.0 / 3.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reply | 28.0 / 31.0 | 2.0 / 5.0 | 9.0 / 18.0 | 6.0 / 6.0 |
| photo | 28.0 / 28.0 | 2.0 / 2.0 | 47.0 / 92.0 | 6.0 / 8.0 |
| feed-image | 1.0 / 1.0 | 0.0 / 0.0 | 49.0 / 94.0 | 0.0 / 0.0 |
| once-photo | 28.0 / 28.0 | 2.0 / 2.0 | 30.0 / 57.0 | 6.0 / 6.0 |

## final-wasm-viewed-loaded

Device: wasm; media: viewed; available CPUs: 4; busy workers: 3.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 9.4 / 17.2 | — | 4.5 / 8.8 | 5.6 / 8.8 | 5.9 / 11.2 | 1.0 / 3.3 | 2.9 / 6.1 |
| reaction-add | 9.4 / 12.0 | — | 3.4 / 7.4 | 7.1 / 10.4 | 8.0 / 12.2 | 0.9 / 4.3 | 3.0 / 7.3 |
| reaction-replace | 9.6 / 12.1 | — | 4.2 / 6.7 | 5.7 / 9.1 | 6.7 / 10.3 | 1.0 / 3.8 | 2.4 / 4.7 |
| reaction-remove | 8.6 / 13.2 | — | 4.7 / 6.8 | 5.8 / 10.7 | 7.3 / 9.6 | 0.7 / 1.9 | 2.2 / 5.2 |
| reply | 9.7 / 13.3 | — | 4.6 / 7.5 | 8.9 / 15.8 | 10.1 / 15.2 | 1.5 / 4.8 | 3.8 / 8.4 |
| photo | 25.5 / 35.3 | 9.4 / 14.6 | 5.1 / 8.6 | 10.2 / 12.6 | 10.2 / 14.9 | 1.2 / 6.9 | 3.7 / 15.4 |
| feed-image | 23.4 / 30.6 | 10.0 / 18.9 | 4.7 / 6.7 | 6.6 / 10.7 | 6.9 / 10.0 | 0.9 / 3.9 | 3.2 / 6.6 |
| once-photo | 24.8 / 35.1 | 9.9 / 13.4 | 5.0 / 7.0 | 10.1 / 16.4 | 10.9 / 17.2 | 1.6 / 3.6 | 3.3 / 6.8 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 2.0 / 3.7 | 0.0 / 0.3 | 1.5 / 3.2 | 22.6 / 33.7 | 25.0 / 35.5 | — |
| reaction-add | 2.4 / 3.7 | 0.3 / 1.8 | 0.3 / 1.8 | 28.4 / 36.1 | 29.5 / 36.4 | — |
| reaction-replace | 2.5 / 5.1 | 0.3 / 1.1 | 0.2 / 1.4 | 23.1 / 37.7 | 23.8 / 37.9 | — |
| reaction-remove | 1.9 / 3.8 | 0.3 / 1.9 | 0.2 / 1.5 | 24.5 / 31.2 | 24.9 / 31.4 | — |
| reply | 21.4 / 30.2 | 1.4 / 12.4 | 1.5 / 3.7 | 57.5 / 65.7 | 59.2 / 67.2 | 59.1 / 67.2 |
| photo | 22.7 / 31.5 | 3.2 / 13.4 | 1.6 / 3.2 | 58.8 / 64.1 | 60.6 / 65.7 | — |
| feed-image | 8.8 / 13.9 | 0.0 / 0.4 | 2.1 / 4.6 | 34.2 / 42.9 | 36.0 / 45.7 | — |
| once-photo | 21.1 / 34.1 | 2.3 / 10.1 | 1.4 / 1.9 | 57.2 / 65.9 | 58.8 / 67.6 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 5.3 / 10.2 | 60.4 / 93.0 | 64.5 / 102.5 | 129.9 / 155.1 |
| feed-image | 4.8 / 7.1 | 50.3 / 60.7 | 52.9 / 63.3 | 92.4 / 107.1 |
| once-photo | 5.9 / 11.5 | 22.5 / 33.0 | 25.6 / 36.1 | 87.6 / 102.8 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-add | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-replace | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-remove | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reply | 27.0 / 28.0 | 2.0 / 2.0 | 9.0 / 18.0 | 5.0 / 6.0 |
| photo | 27.0 / 28.0 | 2.0 / 2.0 | 47.0 / 92.0 | 5.0 / 6.0 |
| feed-image | 1.0 / 1.0 | 0.0 / 0.0 | 49.0 / 94.0 | 0.0 / 0.0 |
| once-photo | 27.0 / 28.0 | 2.0 / 2.0 | 30.0 / 57.0 | 5.0 / 6.0 |

## final-wasm-viewed

Device: wasm; media: viewed; available CPUs: 96; busy workers: 0.

| Flow | Call→commit | Upload | Commit→changes | Changes→sync request | Sync HTTP | Response→apply start | Apply |
|---|---:|---:|---:|---:|---:|---:|---:|
| profile | 9.6 / 12.6 | — | 2.7 / 3.9 | 6.2 / 7.8 | 5.3 / 6.6 | 1.1 / 1.9 | 3.2 / 4.2 |
| reaction-add | 9.7 / 10.9 | — | 2.8 / 4.1 | 4.9 / 5.9 | 5.9 / 6.8 | 1.1 / 1.8 | 2.9 / 4.4 |
| reaction-replace | 9.9 / 11.5 | — | 3.0 / 3.6 | 4.7 / 5.9 | 5.8 / 9.3 | 1.1 / 1.3 | 2.9 / 3.8 |
| reaction-remove | 9.3 / 10.6 | — | 3.1 / 4.3 | 4.6 / 6.0 | 6.0 / 7.0 | 1.1 / 1.3 | 3.2 / 3.8 |
| reply | 9.8 / 12.4 | — | 2.7 / 3.6 | 8.6 / 10.4 | 6.0 / 7.5 | 1.1 / 1.5 | 3.7 / 4.7 |
| photo | 29.1 / 82.5 | 7.9 / 11.6 | 3.2 / 4.4 | 9.0 / 10.7 | 6.2 / 7.7 | 1.1 / 1.5 | 3.8 / 5.7 |
| feed-image | 26.9 / 29.6 | 8.0 / 8.8 | 2.7 / 4.9 | 5.1 / 7.2 | 4.7 / 6.4 | 1.0 / 1.6 | 2.9 / 4.0 |
| once-photo | 26.3 / 30.1 | 7.5 / 9.2 | 2.7 / 4.3 | 8.6 / 10.6 | 6.6 / 7.3 | 1.2 / 1.7 | 3.6 / 4.8 |

| Flow | Apply→evaluation | Evaluation→publication | Publication→React | Commit→publication | Commit→React | Commit→quote |
|---|---:|---:|---:|---:|---:|---:|
| profile | 2.6 / 2.9 | 0.0 / 0.1 | 2.8 / 3.6 | 21.1 / 25.0 | 24.2 / 28.4 | — |
| reaction-add | 3.0 / 3.9 | 0.6 / 1.0 | 0.3 / 0.4 | 21.4 / 25.9 | 21.7 / 26.2 | — |
| reaction-replace | 2.9 / 4.0 | 0.6 / 0.8 | 0.3 / 0.4 | 21.5 / 25.7 | 21.8 / 26.0 | — |
| reaction-remove | 2.8 / 3.4 | 0.6 / 0.8 | 0.3 / 0.4 | 22.1 / 23.7 | 22.4 / 23.9 | — |
| reply | 26.4 / 33.1 | 1.2 / 17.0 | 2.4 / 2.7 | 53.3 / 57.3 | 55.9 / 59.5 | 55.8 / 59.7 |
| photo | 22.4 / 35.4 | 4.7 / 15.0 | 2.3 / 3.0 | 54.2 / 66.2 | 57.3 / 68.7 | — |
| feed-image | 9.8 / 13.7 | 0.1 / 0.2 | 2.7 / 3.7 | 27.3 / 35.5 | 30.1 / 38.8 | — |
| once-photo | 18.5 / 29.5 | 4.6 / 14.9 | 2.1 / 2.6 | 52.5 / 60.8 | 54.3 / 62.5 | — |

| Flow | Publication→asset request | Request→handle | Request→ready | Commit→ready |
|---|---:|---:|---:|---:|
| photo | 7.6 / 11.2 | 55.8 / 82.8 | 58.8 / 84.7 | 126.1 / 147.0 |
| feed-image | 7.2 / 11.1 | 67.3 / 80.4 | 68.8 / 83.8 | 103.2 / 128.0 |
| once-photo | 7.5 / 9.7 | 16.8 / 21.8 | 20.1 / 23.6 | 79.7 / 88.0 |

Device and HTTP operation counts (p50 / p95, not milliseconds):

| Flow | Device queries | Queries before apply | Asset home reads | Server queries |
|---|---:|---:|---:|---:|
| profile | 1.0 / 1.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-add | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-replace | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reaction-remove | 20.0 / 20.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| reply | 27.0 / 27.0 | 2.0 / 2.0 | 9.0 / 18.0 | 5.0 / 5.0 |
| photo | 27.0 / 28.0 | 2.0 / 2.0 | 47.0 / 92.0 | 5.0 / 6.0 |
| feed-image | 1.0 / 1.0 | 0.0 / 0.0 | 49.0 / 94.0 | 0.0 / 0.0 |
| once-photo | 27.0 / 28.0 | 2.0 / 2.0 | 30.0 / 57.0 | 5.0 / 6.0 |
