| Read cell | G5 query-hit share | G6 query-hit share | SQLite statements/ack † | App CPU µs/ack |
|---|---:|---:|---:|---:|
| W1 | 0% | 0% | 5.01 | 221.54 |
| W2 | 0% | 0% | 5.02 | 386.96 |
| W3 | 0% | 0% | 132.08 | 1,261.32 |

| Write cell · offered/s | Mean N † | Fsyncs/write † | Statements/member, all / writer † | App CPU µs/ack | Diagnostic p99 ms † |
|---|---:|---:|---:|---:|---:|
| W4 · 1,131 | 15.23 | 0.0674 | 15.65 / 15.65 | 472.15 | 800.06 |
| W5 exact · 1,131 | 16.06 | 0.0637 | 18.62 / 18.62 | 517.29 | 972.55 |
| W5 nominal 1% mix · 1,131 | 15.20 | 0.0676 | 15.69 / 15.68 | 475.42 | 112.33 |

† Separate instrumented observation at the same offered rate, one 10 s + 20 s repetition; not a capacity-trial measurement. CPU comes from all three uninstrumented selected trials. Statements/ack include transaction controls, authentication, failed-request work and ordinary background work. Mean N uses acknowledgements divided by WAL-synced writer COMMITs; counter equality is required. Checkpoint/database/directory flushes are included in fsyncs/write. See [diagnostic aggregates](./diagnostic.json) and [method](./METHOD.md). Cache lookup hit rate is undefined (zero eligible lookups); effective query-hit share is 0%.
