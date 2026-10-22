# Supabase (PostgREST only) limits ledger

Supabase (PostgREST only) rates are highest tested passing offered/cohort-acknowledgement brackets; completion-window throughput is separately retained in ledger.json. Values are medians of three repetitions. Read the result README caveats.

| Workload / rows / added RTT µs / clients / keys | Supabase (PostgREST only) cohort acks/s (run range) | p50 / p99 / p99.9 ms | worst p99 | next failed offered/s | leading active wait |
|---|---:|---:|---:|---:|---|
| W1 / 1000000 / 0 / 128 / disjoint | 2828 (2828–2828) | 3.15 / 6.74 / 45.51 | 7.63 | 4000 | active:-:- |
| W1 / 1000000 / 500 / 128 / disjoint | 2000 (2000–2000) | 5.53 / 9.31 / 47.91 | 9.40 | 2828 | active:-:- |
| W2 / 1000000 / 0 / 128 / disjoint | 2000 (2000–2000) | 3.83 / 6.87 / 46.17 | 6.94 | 2828 | active:-:- |
| W2 / 1000000 / 500 / 128 / disjoint | 1414 (1414–1414) | 6.11 / 11.29 / 48.66 | 18.61 | 2000 | active:-:- |
| W3 / 1000000 / 0 / 128 / disjoint | 2828 (2828–2828) | 3.52 / 6.57 / 45.74 | 6.79 | 4000 | active:-:- |
| W3 / 1000000 / 500 / 128 / disjoint | 1414 (1414–1414) | 6.60 / 16.40 / 49.94 | 26.21 | 2000 | active:-:- |
| W4 / 1000000 / 0 / 32 / disjoint | 2262 (2262–2262) | 7.68 / 49.38 / 75.63 | 49.84 | 3200 | active:LWLock:WALWrite |
| W4 / 1000000 / 500 / 32 / disjoint | 282 (282–282) | 8.93 / 49.38 / 53.05 | 50.17 | 400 | active:IO:WalSync |
| W5 / 1000000 / 0 / 32 / hot1 | 2262 (2262–2262) | 8.13 / 48.89 / 68.49 | 51.18 | 3200 | active:LWLock:WALWrite |
| W5 / 1000000 / 500 / 32 / hot1 | 1131 (1131–1131) | 13.82 / 49.61 / 60.85 | 50.43 | 1600 | active:LWLock:WALWrite |
| W5 / 1000000 / 0 / 32 / same | 141 (141–141) | 6.94 / 16.18 / 49.74 | 16.70 | 200 | active:IO:WalSync |
| W5 / 1000000 / 500 / 32 / same | 35 (35–35) | 9.64 / 13.20 / 51.31 | 50.46 | 50 | active:IO:WalSync |

## Resource evidence at each passing rate

CPU ms/op are sampled process ticks (sample edges undercount); app includes proxy. SQL counters aggregate all captured role/toplevel rows by queryid before differencing. SQL execution sums include waits and can overlap for nested RPC calls; they are not CPU, request wall time or protocol roundtrip counts. WAL is cluster LSN growth per successful operation including warm-up.

| Workload / rows / added RTT µs / clients / keys | app CPU ms/op | load CPU | SSH CPU | DB CPU | SQL exec ms/op | WAL B/op | SQL calls/op |
|---|---:|---:|---:|---:|---:|---:|---:|
| W1 / 1000000 / 0 / 128 / disjoint | 0.472 | 0.189 | 0.253 | 0.430 | 0.220 | 0.000 | 2.000 |
| W1 / 1000000 / 500 / 128 / disjoint | 1.425 | 0.193 | 0.262 | 0.484 | 0.248 | 0.000 | 2.000 |
| W2 / 1000000 / 0 / 128 / disjoint | 0.619 | 0.225 | 0.277 | 0.626 | 0.294 | 0.000 | 2.000 |
| W2 / 1000000 / 500 / 128 / disjoint | 1.508 | 0.229 | 0.297 | 0.708 | 0.349 | 0.000 | 2.000 |
| W3 / 1000000 / 0 / 128 / disjoint | 0.457 | 0.219 | 0.264 | 0.633 | 0.448 | 0.000 | 2.000 |
| W3 / 1000000 / 500 / 128 / disjoint | 1.430 | 0.227 | 0.275 | 0.840 | 0.704 | 0.000 | 2.000 |
| W4 / 1000000 / 0 / 32 / disjoint | 0.452 | 0.179 | 0.248 | 0.552 | 0.294 | 115.294 | 2.000 |
| W4 / 1000000 / 500 / 32 / disjoint | 1.787 | 0.240 | 0.366 | 0.753 | 0.361 | 115.429 | 2.000 |
| W5 / 1000000 / 0 / 32 / hot1 | 0.448 | 0.179 | 0.249 | 0.542 | 0.288 | 115.339 | 2.000 |
| W5 / 1000000 / 500 / 32 / hot1 | 1.428 | 0.189 | 0.273 | 0.655 | 0.339 | 115.430 | 2.000 |
| W5 / 1000000 / 0 / 32 / same | 0.700 | 0.262 | 0.374 | 1.040 | 0.676 | 119.306 | 2.000 |
| W5 / 1000000 / 500 / 32 / same | 1.962 | 0.343 | 0.419 | 1.324 | 0.632 | 116.411 | 2.000 |
