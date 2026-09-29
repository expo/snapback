# Per-query SQLite cache and syscall measurements

Cells are mean cache hits / cache misses / pread64 calls per actual server query. Three warmups per operation precede the one traced round; switching probes can evict previously warmed pages. Each original batch has ten queries; queued 16 MiB includes an additional SDK read and retains it. There was no OS-cache flush.

## small

| Probe | 10% | 50% | Full |
| --- | ---: | ---: | ---: |
| busyHistory | 166.0 / 87.0 / 87.0 | 183.0 / 114.0 / 114.0 | 188.0 / 109.0 / 109.0 |
| following500 | 1337.0 / 964.0 / 964.0 | 1443.0 / 1288.0 / 1288.0 | 1436.0 / 1295.0 / 1295.0 |
| following5 | 1083.0 / 822.0 / 822.0 | 1275.0 / 1092.0 / 1092.0 | 1194.0 / 1067.0 / 1067.0 |
| celebrityFollower | 1060.0 / 856.0 / 856.0 | 1274.0 / 1047.0 / 1047.0 | 1202.0 / 1059.0 / 1059.0 |
| search100 | 3023.0 / 1360.0 / 1360.0 | 3464.0 / 1725.0 / 1725.0 | 3245.0 / 1944.0 / 1944.0 |
| insights | 181.0 / 49.0 / 49.0 | 227.0 / 64.0 / 64.0 | 223.0 / 68.0 / 68.0 |
| trending | 582.0 / 211.0 / 211.0 | 682.0 / 279.0 / 279.0 | 679.0 / 302.0 / 302.0 |

## default

| Probe | 10% | 50% | Full |
| --- | ---: | ---: | ---: |
| busyHistory | 246.8 / 6.2 / 6.2 | 288.7 / 8.3 / 8.3 | 288.0 / 9.0 / 9.0 |
| following500 | 2269.7 / 31.3 / 31.3 | 2690.2 / 40.8 / 40.8 | 2686.9 / 44.1 / 44.1 |
| following5 | 1891.0 / 14.0 / 14.0 | 2348.0 / 19.0 / 19.0 | 2238.5 / 22.5 / 22.5 |
| celebrityFollower | 1905.5 / 10.5 / 10.5 | 2306.8 / 14.2 / 14.2 | 2244.5 / 16.5 / 16.5 |
| search100 | 4354.3 / 28.7 / 28.7 | 5154.4 / 34.6 / 34.6 | 5151.6 / 37.4 / 37.4 |
| insights | 226.7 / 3.3 / 3.3 | 286.8 / 4.2 / 4.2 | 286.5 / 4.5 / 4.5 |
| trending | 787.8 / 5.2 / 5.2 | 950.5 / 10.5 / 10.5 | 968.1 / 12.9 / 12.9 |

## 16m

| Probe | 10% | 50% | Full |
| --- | ---: | ---: | ---: |
| busyHistory | 246.8 / 6.2 / 6.2 | 288.7 / 8.3 / 8.3 | 288.0 / 9.0 / 9.0 |
| following500 | 2269.7 / 31.3 / 31.3 | 2690.2 / 40.8 / 40.8 | 2686.9 / 44.1 / 44.1 |
| following5 | 1891.0 / 14.0 / 14.0 | 2348.0 / 19.0 / 19.0 | 2239.3 / 21.7 / 21.7 |
| celebrityFollower | 1906.0 / 10.0 / 10.0 | 2308.3 / 12.7 / 12.7 | 2246.0 / 15.0 / 15.0 |
| search100 | 4359.3 / 23.7 / 23.7 | 5160.9 / 28.1 / 28.1 | 5158.9 / 30.1 / 30.1 |
| insights | 226.8 / 3.2 / 3.2 | 287.4 / 3.6 / 3.6 | 287.2 / 3.8 / 3.8 |
| trending | 789.8 / 3.2 / 3.2 | 956.6 / 4.4 / 4.4 | 974.2 / 6.8 / 6.8 |

## 256m

| Probe | 10% | 50% | Full |
| --- | ---: | ---: | ---: |
| busyHistory | 246.8 / 6.2 / 6.2 | 288.7 / 8.3 / 8.3 | 288.0 / 9.0 / 9.0 |
| following500 | 2269.7 / 31.3 / 31.3 | 2690.2 / 40.8 / 40.8 | 2686.9 / 44.1 / 44.1 |
| following5 | 1891.0 / 14.0 / 14.0 | 2348.0 / 19.0 / 19.0 | 2239.3 / 21.7 / 21.7 |
| celebrityFollower | 1906.0 / 10.0 / 10.0 | 2308.3 / 12.7 / 12.7 | 2246.0 / 15.0 / 15.0 |
| search100 | 4359.3 / 23.7 / 23.7 | 5160.9 / 28.1 / 28.1 | 5158.9 / 30.1 / 30.1 |
| insights | 226.8 / 3.2 / 3.2 | 287.4 / 3.6 / 3.6 | 287.2 / 3.8 / 3.8 |
| trending | 789.8 / 3.2 / 3.2 | 956.6 / 4.4 / 4.4 | 974.2 / 6.8 / 6.8 |

## mmap

| Probe | 10% | 50% | Full |
| --- | ---: | ---: | ---: |
| busyHistory | 6.0 / 0.0 / 0.0 | 2.0 / 0.0 / 0.0 | 66.1 / 1.9 / 1.9 |
| following500 | 6.0 / 0.0 / 0.0 | 2.0 / 0.0 / 0.0 | 497.9 / 3.1 / 3.1 |
| following5 | 6.0 / 0.0 / 0.0 | 2.0 / 0.0 / 0.0 | 384.9 / 2.1 / 2.1 |
| celebrityFollower | 6.0 / 0.0 / 0.0 | 2.0 / 0.0 / 0.0 | 388.5 / 2.5 / 2.5 |
| search100 | 6.0 / 0.0 / 0.0 | 2.0 / 0.0 / 0.0 | 474.7 / 7.3 / 7.3 |
| insights | 6.0 / 0.0 / 0.0 | 2.0 / 0.0 / 0.0 | 33.7 / 0.3 / 0.3 |
| trending | 6.0 / 0.0 / 0.0 | 2.0 / 0.0 / 0.0 | 183.0 / 0.0 / 0.0 |

## both

| Probe | 10% | 50% | Full |
| --- | ---: | ---: | ---: |
| busyHistory | 6.0 / 0.0 / 0.0 | 2.0 / 0.0 / 0.0 | 66.1 / 1.9 / 1.9 |
| following500 | 6.0 / 0.0 / 0.0 | 2.0 / 0.0 / 0.0 | 497.9 / 3.1 / 3.1 |
| following5 | 6.0 / 0.0 / 0.0 | 2.0 / 0.0 / 0.0 | 384.9 / 2.1 / 2.1 |
| celebrityFollower | 6.0 / 0.0 / 0.0 | 2.0 / 0.0 / 0.0 | 388.5 / 2.5 / 2.5 |
| search100 | 6.0 / 0.0 / 0.0 | 2.0 / 0.0 / 0.0 | 474.7 / 7.3 / 7.3 |
| insights | 6.0 / 0.0 / 0.0 | 2.0 / 0.0 / 0.0 | 33.7 / 0.3 / 0.3 |
| trending | 6.0 / 0.0 / 0.0 | 2.0 / 0.0 / 0.0 | 183.0 / 0.0 / 0.0 |

## While the same retained 50% backlog drains

| Probe | Default misses / pread | 16 MiB misses / pread | Mmap misses / pread |
| --- | ---: | ---: | ---: |
| busyHistory | 81.0 / 81.0 | 81.6 / 81.6 | 0.8 / 0.8 |
| following500 | 233.1 / 233.1 | 333.3 / 333.3 | 3.6 / 3.6 |
| following5 | 228.6 / 228.6 | 142.5 / 142.5 | 0.4 / 0.4 |
| celebrityFollower | 273.1 / 273.1 | 284.6 / 284.6 | 0.2 / 0.2 |
| search100 | 244.2 / 244.2 | 174.0 / 174.0 | 0.0 / 0.0 |
| insights | 42.4 / 42.4 | 54.2 / 54.2 | 0.3 / 0.3 |
| trending | 122.0 / 122.0 | 123.8 / 123.8 | 0.0 / 0.0 |

The configurations share the initial pending snapshot. Delivery proceeds during each run, so the precise committed position differs. This experiment establishes the syscall mechanism, not a paired latency speedup. Mmap was requested at 8 GiB; the bundled SQLite clamps it to 2,147,418,112 B.

| Queued configuration | Query count | File-lock busy results | Busy-sleep ms | Queries overlapping checkpoint lock | Max per-query futex ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| default | 70 | 0 | 0.000 | 22 | 0.201 |
| 16m | 71 | 0 | 0.000 | 20 | 1.024 |
| mmap | 70 | 0 | 0.000 | 18 | 0.188 |

Per-read file-lock call time, futex call time, busy sleep, and checkpoint-lock overlap are in evidence/physical.json.gz. Overlap is not time waiting for a checkpoint; CPU descheduling and shared I/O pressure remain inseparable here. Kernel call durations include tracer overhead. No checkpoint executes on a detached read connection.
