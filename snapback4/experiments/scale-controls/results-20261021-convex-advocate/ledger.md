# Convex/PG (self-hosted) limits ledger

Convex/PG (self-hosted) rates are highest tested passing offered/cohort-acknowledgement brackets; completion-window throughput is separately retained in ledger.json. Values are medians of three repetitions. Read the result README caveats.

| Workload / rows / added RTT µs / clients / keys | Convex/PG (self-hosted) cohort acks/s (run range) | p50 / p99 / p99.9 ms | worst p99 | next failed offered/s | leading active wait |
|---|---:|---:|---:|---:|---|
| W1 / 1000000 / 0 / 128 / disjoint | 1000 (1000–1000) | 9.08 / 21.64 / 51.97 | 23.89 | 1414 | active:-:- |
| W1 / 1000000 / 500 / 128 / disjoint | 1000 (1000–1000) | 18.24 / 38.96 / 62.26 | 39.58 | 1414 | active:-:- |
| W2 / 1000000 / 0 / 128 / disjoint | 16000 (16000–16000) | 0.50 / 8.95 / 17.73 | 9.12 | 22627 | active:-:- |
| W2 / 1000000 / 500 / 128 / disjoint | 16000 (16000–16000) | 0.51 / 16.53 / 36.60 | 18.04 | 22627 | no active sample |
| W3 / 1000000 / 0 / 128 / disjoint | 16000 (16000–16000) | 0.47 / 7.92 / 18.66 | 36.01 | 22627 | active:-:- |
| W3 / 1000000 / 500 / 128 / disjoint | 11313 (11313–11313) | 0.44 / 2.59 / 8.63 | 3.07 | 16000 | no active sample |
| W4 / 1000000 / 0 / 32 / disjoint | 1 (1–1) | 55.71 / 61.93 / 61.93 | 63.01 | 3 | active:-:- |
| W4 / 1000000 / 500 / 32 / disjoint | no passing rate | — | — | — | — |
| W5 / 1000000 / 0 / 32 / hot1 | 282 (282–282) | 59.87 / 83.36 / 105.51 | 91.36 | 400 | active:-:- |
| W5 / 1000000 / 500 / 32 / hot1 | 400 (400–400) | 64.32 / 86.25 / 104.27 | 89.19 | 565 | active:-:- |
| W5 / 1000000 / 0 / 32 / same | 4 (4–4) | 59.24 / 78.12 / 78.12 | 99.29 | 6 | active:IO:WalSync |
| W5 / 1000000 / 500 / 32 / same | no passing rate | — | — | — | — |
| W5 / 1000000 / 0 / 32 / sharded | 141 (141–141) | 60.75 / 78.45 / 104.01 | 92.08 | 200 | active:-:- |
| W5 / 1000000 / 500 / 32 / sharded | 35 (35–35) | 65.08 / 82.77 / 108.66 | 85.52 | 50 | active:-:- |

## Resource evidence at each passing rate

CPU ms/op are sampled process ticks (sample edges undercount); app includes proxy. SQL counters aggregate all captured role/toplevel rows by queryid before differencing. SQL execution sums include waits and can overlap for nested RPC calls; they are not CPU, request wall time or protocol roundtrip counts. WAL is cluster LSN growth per successful operation including warm-up.

| Workload / rows / added RTT µs / clients / keys | app CPU ms/op | load CPU | SSH CPU | DB CPU | SQL exec ms/op | WAL B/op | SQL calls/op |
|---|---:|---:|---:|---:|---:|---:|---:|
| W1 / 1000000 / 0 / 128 / disjoint | 4.713 | 0.227 | 0.196 | 4.055 | 3.531 | 81.093 | 2.146 |
| W1 / 1000000 / 500 / 128 / disjoint | 5.382 | 0.229 | 0.210 | 3.117 | 2.479 | 328.385 | 2.249 |
| W2 / 1000000 / 0 / 128 / disjoint | 0.337 | 0.184 | 0.001 | 0.190 | 0.192 | 15.927 | 0.011 |
| W2 / 1000000 / 500 / 128 / disjoint | 0.338 | 0.185 | 0.000 | 0.001 | 0.000 | 0.000 | 0.001 |
| W3 / 1000000 / 0 / 128 / disjoint | 0.327 | 0.176 | 0.001 | 0.180 | 0.179 | 29.192 | 0.017 |
| W3 / 1000000 / 500 / 128 / disjoint | 0.308 | 0.215 | 0.000 | 0.001 | 0.000 | 0.000 | 0.001 |
| W4 / 1000000 / 0 / 32 / disjoint | 9.333 | 0.333 | 2.667 | 35.667 | 25.349 | 9453.600 | 24.000 |
| W5 / 1000000 / 0 / 32 / hot1 | 5.775 | 0.249 | 0.522 | 5.735 | 5.703 | 2989.551 | 6.801 |
| W5 / 1000000 / 500 / 32 / hot1 | 6.027 | 0.225 | 0.396 | 11.178 | 10.922 | 3339.605 | 5.714 |
| W5 / 1000000 / 0 / 32 / same | 9.583 | 0.500 | 1.083 | 6.667 | 3.465 | 3499.800 | 11.917 |
| W5 / 1000000 / 0 / 32 / sharded | 9.144 | 0.272 | 0.955 | 22.272 | 21.108 | 5506.141 | 11.366 |
| W5 / 1000000 / 500 / 32 / sharded | 17.400 | 0.362 | 2.105 | 44.781 | 43.217 | 20471.352 | 22.282 |
