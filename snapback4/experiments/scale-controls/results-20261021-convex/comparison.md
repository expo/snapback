# Convex/PG beside raw PG and Supabase advocate

Highest tested passing offered operations/s; all three repetitions meet the same SLO/error/counter criteria. Historical controls were measured earlier, not rerun. Convex uses its default caches and own OCC. Pool caps match; Convex background work shares its cap. These are short-window shared-host observations, not product ceilings.

## Predeclared fixed-budget comparison

Reads: 128 clients, pool/concurrent-query cap 32. Writes: 32 clients, pool/concurrent-mutation cap 32. Supabase adds its listener.

| Workload / keys / rows / added RTT µs / clients | Raw PG | Supabase advocate | Convex/PG |
|---|---:|---:|---:|
| W1 / disjoint / 1000000 / 0 / 128 | 22,627 | 1,414 | 707 |
| W1 / disjoint / 1000000 / 500 / 128 | 16,000 | 1,000 | 707 |
| W2 / disjoint / 1000000 / 0 / 128 | 11,313 | 1,414 | 707 |
| W2 / disjoint / 1000000 / 500 / 128 | 8,000 | 1,414 | 707 |
| W3 / disjoint / 1000000 / 0 / 128 | 8,000 | 2,000 | 707 |
| W3 / disjoint / 1000000 / 500 / 128 | 11,313 | 1,414 | 707 |
| W4 / disjoint / 1000000 / 0 / 32 | 2,262 | 1,600 | 4 |
| W4 / disjoint / 1000000 / 500 / 32 | 4,525 | 1,600 | 282 |
| W5 / same / 1000000 / 0 / 32 | 282 | 141 | 3 |
| W5 / same / 1000000 / 500 / 32 | 200 | 141 | 6 |
| W5 / hot1 / 1000000 / 0 / 32 | 4,525 | 1,131 | 1 |
| W5 / hot1 / 1000000 / 500 / 32 | 4,525 | 1,600 | 400 |

## Every Convex cell

Supabase-advocate did not run the 100k read cells; those entries are absent. Latencies/resources at each system’s own passing rate are in the linked source ledgers and do not isolate per-request overhead.

| Workload / keys / rows / added RTT µs / clients | Raw PG | Supabase advocate | Convex/PG |
|---|---:|---:|---:|
| W1 / disjoint / 100000 / 0 / 128 | 22,627 | — | 707 |
| W1 / disjoint / 100000 / 500 / 128 | 11,313 | — | 707 |
| W1 / disjoint / 1000000 / 0 / 128 | 22,627 | 1,414 | 707 |
| W1 / disjoint / 1000000 / 500 / 128 | 16,000 | 1,000 | 707 |
| W2 / disjoint / 100000 / 0 / 128 | 11,313 | — | 707 |
| W2 / disjoint / 100000 / 500 / 128 | 11,313 | — | 707 |
| W2 / disjoint / 1000000 / 0 / 128 | 11,313 | 1,414 | 707 |
| W2 / disjoint / 1000000 / 500 / 128 | 8,000 | 1,414 | 707 |
| W3 / disjoint / 100000 / 0 / 128 | 16,000 | — | 707 |
| W3 / disjoint / 100000 / 500 / 128 | 11,313 | — | 707 |
| W3 / disjoint / 1000000 / 0 / 128 | 8,000 | 2,000 | 707 |
| W3 / disjoint / 1000000 / 500 / 128 | 11,313 | 1,414 | 707 |
| W4 / disjoint / 1000000 / 0 / 1 | 282 | 50 | 17 |
| W4 / disjoint / 1000000 / 0 / 2 | 282 | 141 | 25 |
| W4 / disjoint / 1000000 / 0 / 4 | 565 | 141 | 12 |
| W4 / disjoint / 1000000 / 0 / 8 | 800 | 565 | 50 |
| W4 / disjoint / 1000000 / 0 / 16 | 2,262 | 1,131 | 8 |
| W4 / disjoint / 1000000 / 0 / 32 | 2,262 | 1,600 | 4 |
| W4 / disjoint / 1000000 / 0 / 64 | 4,525 | 3,200 | 141 |
| W4 / disjoint / 1000000 / 0 / 128 | 9,050 | 2,262 | 800 |
| W4 / disjoint / 1000000 / 0 / 256 | 18,101 | 3,200 | 800 |
| W4 / disjoint / 1000000 / 500 / 1 | 200 | 70 | no pass |
| W4 / disjoint / 1000000 / 500 / 2 | 282 | 50 | no pass |
| W4 / disjoint / 1000000 / 500 / 4 | 565 | 200 | no pass |
| W4 / disjoint / 1000000 / 500 / 8 | 1,131 | 200 | 70 |
| W4 / disjoint / 1000000 / 500 / 16 | 2,262 | 400 | 141 |
| W4 / disjoint / 1000000 / 500 / 32 | 4,525 | 1,600 | 282 |
| W4 / disjoint / 1000000 / 500 / 64 | 6,400 | 2,262 | 565 |
| W4 / disjoint / 1000000 / 500 / 128 | 12,800 | 2,262 | 565 |
| W4 / disjoint / 1000000 / 500 / 256 | 18,101 | 1,131 | 565 |
| W5 / hot1 / 1000000 / 0 / 1 | 282 | 12 | 12 |
| W5 / hot1 / 1000000 / 0 / 2 | 282 | 141 | 25 |
| W5 / hot1 / 1000000 / 0 / 4 | 400 | 400 | 4 |
| W5 / hot1 / 1000000 / 0 / 8 | 1,131 | 400 | 1 |
| W5 / hot1 / 1000000 / 0 / 16 | 2,262 | 800 | 50 |
| W5 / hot1 / 1000000 / 0 / 32 | 4,525 | 1,131 | 1 |
| W5 / hot1 / 1000000 / 0 / 64 | 4,525 | 400 | 400 |
| W5 / hot1 / 1000000 / 0 / 128 | 6,400 | 2,262 | 800 |
| W5 / hot1 / 1000000 / 0 / 256 | 12,800 | 2,262 | 800 |
| W5 / hot1 / 1000000 / 500 / 1 | 200 | 8 | no pass |
| W5 / hot1 / 1000000 / 500 / 2 | 282 | 17 | no pass |
| W5 / hot1 / 1000000 / 500 / 4 | 565 | 282 | no pass |
| W5 / hot1 / 1000000 / 500 / 8 | 1,131 | 400 | 50 |
| W5 / hot1 / 1000000 / 500 / 16 | 2,262 | 800 | 200 |
| W5 / hot1 / 1000000 / 500 / 32 | 4,525 | 1,600 | 400 |
| W5 / hot1 / 1000000 / 500 / 64 | 9,050 | 1,131 | 565 |
| W5 / hot1 / 1000000 / 500 / 128 | 12,800 | 800 | 565 |
| W5 / hot1 / 1000000 / 500 / 256 | 12,800 | 3,200 | 282 |
| W5 / same / 1000000 / 0 / 1 | 282 | 35 | 6 |
| W5 / same / 1000000 / 0 / 2 | 282 | 70 | 6 |
| W5 / same / 1000000 / 0 / 4 | 100 | 141 | 8 |
| W5 / same / 1000000 / 0 / 8 | 282 | 141 | 4 |
| W5 / same / 1000000 / 0 / 16 | 141 | 141 | 12 |
| W5 / same / 1000000 / 0 / 32 | 282 | 141 | 3 |
| W5 / same / 1000000 / 0 / 64 | 200 | 200 | 8 |
| W5 / same / 1000000 / 0 / 128 | 141 | 100 | 8 |
| W5 / same / 1000000 / 0 / 256 | 282 | 35 | 12 |
| W5 / same / 1000000 / 500 / 1 | 200 | 50 | no pass |
| W5 / same / 1000000 / 500 / 2 | 282 | 25 | no pass |
| W5 / same / 1000000 / 500 / 4 | 282 | 50 | no pass |
| W5 / same / 1000000 / 500 / 8 | 282 | 100 | 12 |
| W5 / same / 1000000 / 500 / 16 | 282 | 70 | 6 |
| W5 / same / 1000000 / 500 / 32 | 200 | 141 | 6 |
| W5 / same / 1000000 / 500 / 64 | 282 | 141 | 12 |
| W5 / same / 1000000 / 500 / 128 | 200 | 100 | 12 |
| W5 / same / 1000000 / 500 / 256 | 282 | 100 | 8 |
