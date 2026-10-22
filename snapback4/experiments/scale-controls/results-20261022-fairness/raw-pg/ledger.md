# Raw PG limits ledger

Raw PG rates are highest tested passing offered/cohort-acknowledgement brackets; completion-window throughput is separately retained in ledger.json. Values are medians of three repetitions. Read the result README caveats.

| Workload / rows / added RTT µs / clients / keys | Raw PG cohort acks/s (run range) | p50 / p99 / p99.9 ms | worst p99 | next failed offered/s | leading active wait |
|---|---:|---:|---:|---:|---|
| W1 / 1000000 / 0 / 128 / disjoint | 22627 (22627–22627) | 1.11 / 12.62 / 38.76 | 12.96 | 32000 | active:Client:ClientRead |
| W1 / 1000000 / 500 / 128 / disjoint | 16000 (16000–16000) | 1.74 / 12.21 / 37.65 | 13.39 | 22627 | active:Client:ClientRead |
| W2 / 1000000 / 0 / 128 / disjoint | 11313 (11313–11313) | 1.73 / 10.22 / 21.59 | 10.26 | 16000 | active:-:- |
| W2 / 1000000 / 500 / 128 / disjoint | 11313 (11313–11313) | 2.36 / 10.40 / 24.33 | 11.26 | 16000 | active:-:- |
| W3 / 1000000 / 0 / 128 / disjoint | 16000 (16000–16000) | 2.00 / 13.99 / 27.39 | 24.22 | 22627 | active:-:- |
| W3 / 1000000 / 500 / 128 / disjoint | 11313 (11313–11313) | 2.03 / 7.06 / 19.25 | 8.22 | 16000 | active:-:- |
| W4 / 1000000 / 0 / 32 / disjoint | 4525 (4525–4525) | 5.17 / 17.99 / 41.25 | 56.13 | 6400 | active:LWLock:WALWrite |
| W4 / 1000000 / 500 / 32 / disjoint | 4525 (4525–4525) | 5.74 / 57.64 / 106.10 | 77.99 | 6400 | active:LWLock:WALWrite |
| W5 / 1000000 / 0 / 32 / hot1 | 4525 (4525–4525) | 5.19 / 16.35 / 41.58 | 66.95 | 6400 | active:LWLock:WALWrite |
| W5 / 1000000 / 500 / 32 / hot1 | 4525 (4525–4525) | 5.75 / 63.93 / 105.12 | 91.23 | 6400 | active:LWLock:WALWrite |
| W5 / 1000000 / 0 / 32 / same | 282 (282–282) | 3.56 / 4.85 / 7.61 | 5.57 | 400 | active:IO:WalSync |
| W5 / 1000000 / 500 / 32 / same | 282 (282–282) | 4.21 / 30.21 / 144.44 | 41.75 | 400 | active:IO:WalSync |

## Resource evidence at each passing rate

CPU ms/op are sampled process ticks (sample edges undercount); app includes proxy. SQL counters aggregate all captured role/toplevel rows by queryid before differencing. SQL execution sums include waits and can overlap for nested RPC calls; they are not CPU, request wall time or protocol roundtrip counts. WAL is cluster LSN growth per successful operation including warm-up.

| Workload / rows / added RTT µs / clients / keys | app CPU ms/op | load CPU | SSH CPU | DB CPU | SQL exec ms/op | WAL B/op | SQL calls/op |
|---|---:|---:|---:|---:|---:|---:|---:|
| W1 / 1000000 / 0 / 128 / disjoint | 0.077 | 0.092 | 0.067 | 0.071 | 0.022 | 0.000 | 1.000 |
| W1 / 1000000 / 500 / 128 / disjoint | 0.254 | 0.117 | 0.069 | 0.069 | 0.021 | 0.000 | 1.000 |
| W2 / 1000000 / 0 / 128 / disjoint | 0.137 | 0.179 | 0.085 | 0.246 | 0.245 | 0.000 | 1.000 |
| W2 / 1000000 / 500 / 128 / disjoint | 0.331 | 0.172 | 0.088 | 0.195 | 0.137 | 0.000 | 1.000 |
| W3 / 1000000 / 0 / 128 / disjoint | 0.115 | 0.135 | 0.075 | 0.315 | 0.268 | 0.000 | 1.000 |
| W3 / 1000000 / 500 / 128 / disjoint | 0.327 | 0.174 | 0.077 | 0.294 | 0.221 | 0.000 | 1.000 |
| W4 / 1000000 / 0 / 32 / disjoint | 0.108 | 0.164 | 0.067 | 0.169 | 0.030 | 125.287 | 1.000 |
| W4 / 1000000 / 500 / 32 / disjoint | 0.331 | 0.164 | 0.069 | 0.172 | 0.031 | 118.647 | 1.000 |
| W5 / 1000000 / 0 / 32 / hot1 | 0.109 | 0.164 | 0.067 | 0.171 | 0.031 | 118.567 | 1.000 |
| W5 / 1000000 / 500 / 32 / hot1 | 0.333 | 0.164 | 0.069 | 0.173 | 0.032 | 119.018 | 1.000 |
| W5 / 1000000 / 0 / 32 / same | 0.136 | 0.241 | 0.097 | 0.232 | 0.064 | 115.574 | 1.000 |
| W5 / 1000000 / 500 / 32 / same | 0.427 | 0.239 | 0.102 | 0.243 | 0.543 | 118.375 | 1.000 |
