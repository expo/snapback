# Raw PG limits ledger

Raw PG rates are highest tested passing offered/cohort-acknowledgement brackets; completion-window throughput is separately retained in ledger.json. Values are medians of three repetitions. Read the result README caveats.

| Workload / rows / added RTT µs / clients / keys | Raw PG cohort acks/s (run range) | p50 / p99 / p99.9 ms | worst p99 | next failed offered/s | leading active wait |
|---|---:|---:|---:|---:|---|
| W1 / 1000000 / 0 / 128 / disjoint | 22627 (22627–22627) | 1.10 / 15.16 / 40.93 | 19.94 | 32000 | active:Client:ClientRead |
| W1 / 1000000 / 500 / 128 / disjoint | 16000 (16000–16000) | 1.65 / 9.69 / 37.29 | 15.15 | 22627 | active:Client:ClientRead |
| W2 / 1000000 / 0 / 128 / disjoint | 8000 (8000–8000) | 1.20 / 3.86 / 31.69 | 4.79 | 11313 | active:-:- |
| W2 / 1000000 / 500 / 128 / disjoint | 8000 (8000–8000) | 1.86 / 4.68 / 9.80 | 5.94 | 11313 | active:-:- |
| W3 / 1000000 / 0 / 128 / disjoint | 11313 (11313–11313) | 1.27 / 4.61 / 12.11 | 4.96 | 16000 | active:-:- |
| W3 / 1000000 / 500 / 128 / disjoint | 8000 (8000–8000) | 2.18 / 7.12 / 12.06 | 8.22 | 11313 | active:-:- |
| W4 / 1000000 / 0 / 32 / disjoint | 2262 (2262–2262) | 5.21 / 21.92 / 52.69 | 22.04 | 3200 | active:LWLock:WALWrite |
| W4 / 1000000 / 500 / 32 / disjoint | 35 (35–35) | 6.35 / 15.22 / 49.48 | 47.25 | 50 | active:IO:WalSync |
| W5 / 1000000 / 0 / 32 / hot1 | 2262 (2262–2262) | 8.41 / 19.71 / 37.52 | 21.20 | 3200 | active:LWLock:WALWrite |
| W5 / 1000000 / 500 / 32 / hot1 | 3200 (3200–3200) | 8.70 / 28.20 / 44.86 | 42.43 | 4525 | active:LWLock:WALWrite |
| W5 / 1000000 / 0 / 32 / same | 200 (200–200) | 3.64 / 9.73 / 14.00 | 10.58 | 282 | active:IO:WalSync |
| W5 / 1000000 / 500 / 32 / same | 141 (141–141) | 5.91 / 10.28 / 13.76 | 12.50 | 200 | active:IO:WalSync |

## Resource evidence at each passing rate

CPU ms/op are sampled process ticks (sample edges undercount); app includes proxy. SQL counters aggregate all captured role/toplevel rows by queryid before differencing. SQL execution sums include waits and can overlap for nested RPC calls; they are not CPU, request wall time or protocol roundtrip counts. WAL is cluster LSN growth per successful operation including warm-up.

| Workload / rows / added RTT µs / clients / keys | app CPU ms/op | load CPU | SSH CPU | DB CPU | SQL exec ms/op | WAL B/op | SQL calls/op |
|---|---:|---:|---:|---:|---:|---:|---:|
| W1 / 1000000 / 0 / 128 / disjoint | 0.070 | 0.091 | 0.067 | 0.072 | 0.023 | 0.000 | 1.000 |
| W1 / 1000000 / 500 / 128 / disjoint | 0.253 | 0.117 | 0.068 | 0.072 | 0.022 | 0.000 | 1.000 |
| W2 / 1000000 / 0 / 128 / disjoint | 0.142 | 0.201 | 0.085 | 0.197 | 0.138 | 0.000 | 1.000 |
| W2 / 1000000 / 500 / 128 / disjoint | 0.371 | 0.199 | 0.089 | 0.222 | 0.180 | 0.000 | 1.000 |
| W3 / 1000000 / 0 / 128 / disjoint | 0.118 | 0.180 | 0.074 | 0.302 | 0.232 | 0.000 | 1.000 |
| W3 / 1000000 / 500 / 128 / disjoint | 0.353 | 0.195 | 0.077 | 0.371 | 0.404 | 0.000 | 1.000 |
| W4 / 1000000 / 0 / 32 / disjoint | 0.106 | 0.189 | 0.088 | 0.181 | 0.030 | 118.251 | 1.000 |
| W4 / 1000000 / 500 / 32 / disjoint | 0.467 | 0.333 | 0.143 | 0.629 | 0.063 | 137.417 | 1.000 |
| W5 / 1000000 / 0 / 32 / hot1 | 0.110 | 0.190 | 0.093 | 0.195 | 0.033 | 118.415 | 1.000 |
| W5 / 1000000 / 500 / 32 / hot1 | 0.350 | 0.178 | 0.089 | 0.190 | 0.036 | 119.216 | 1.000 |
| W5 / 1000000 / 0 / 32 / same | 0.123 | 0.243 | 0.097 | 0.255 | 0.214 | 120.933 | 1.000 |
| W5 / 1000000 / 500 / 32 / same | 0.426 | 0.255 | 0.104 | 0.303 | 0.203 | 122.629 | 1.000 |
