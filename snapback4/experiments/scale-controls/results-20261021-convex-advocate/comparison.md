# Convex/PG beside raw PG and Supabase advocate

Highest tested passing offered operations/s; all three repetitions meet the same SLO/error/counter criteria. Historical controls were measured earlier, not rerun. Convex uses its default caches and own OCC. Pool caps match; Convex background work shares its cap. The labelled W5 `sharded` row is not a headline: its mutation returns one shard’s count, and `chat:count` still returns the exact total in one query. These are shared-host observations, not product ceilings.

## Predeclared fixed-budget comparison

Reads: 128 clients, pool/concurrent-query cap 32. Writes: 32 clients, pool/concurrent-mutation cap 32. Supabase adds its listener.

| Workload / keys / rows / added RTT µs / clients | Raw PG | Supabase advocate | Convex/PG |
|---|---:|---:|---:|
| W1 / disjoint / 1000000 / 0 / 128 | 22,627 | 1,414 | 1,000 |
| W1 / disjoint / 1000000 / 500 / 128 | 16,000 | 1,000 | 1,000 |
| W2 / disjoint / 1000000 / 0 / 128 | 11,313 | 1,414 | 16,000 |
| W2 / disjoint / 1000000 / 500 / 128 | 8,000 | 1,414 | 16,000 |
| W3 / disjoint / 1000000 / 0 / 128 | 8,000 | 2,000 | 16,000 |
| W3 / disjoint / 1000000 / 500 / 128 | 11,313 | 1,414 | 11,313 |
| W4 / disjoint / 1000000 / 0 / 32 | 2,262 | 1,600 | 1 |
| W4 / disjoint / 1000000 / 500 / 32 | 4,525 | 1,600 | no pass |
| W5 / same / 1000000 / 0 / 32 | 282 | 141 | 4 |
| W5 / same / 1000000 / 500 / 32 | 200 | 141 | no pass |
| W5 / hot1 / 1000000 / 0 / 32 | 4,525 | 1,131 | 282 |
| W5 / hot1 / 1000000 / 500 / 32 | 4,525 | 1,600 | 400 |
| W5 / sharded / 1000000 / 0 / 32 | — | — | 141 |
| W5 / sharded / 1000000 / 500 / 32 | — | — | 35 |

## Every Convex cell

Supabase-advocate did not run the 100k read cells; those entries are absent. Latencies/resources at each system’s own passing rate are in the linked source ledgers and do not isolate per-request overhead.

| Workload / keys / rows / added RTT µs / clients | Raw PG | Supabase advocate | Convex/PG |
|---|---:|---:|---:|
| W1 / disjoint / 1000000 / 0 / 128 | 22,627 | 1,414 | 1,000 |
| W1 / disjoint / 1000000 / 500 / 128 | 16,000 | 1,000 | 1,000 |
| W2 / disjoint / 1000000 / 0 / 128 | 11,313 | 1,414 | 16,000 |
| W2 / disjoint / 1000000 / 500 / 128 | 8,000 | 1,414 | 16,000 |
| W3 / disjoint / 1000000 / 0 / 128 | 8,000 | 2,000 | 16,000 |
| W3 / disjoint / 1000000 / 500 / 128 | 11,313 | 1,414 | 11,313 |
| W4 / disjoint / 1000000 / 0 / 32 | 2,262 | 1,600 | 1 |
| W4 / disjoint / 1000000 / 500 / 32 | 4,525 | 1,600 | no pass |
| W5 / hot1 / 1000000 / 0 / 32 | 4,525 | 1,131 | 282 |
| W5 / hot1 / 1000000 / 500 / 32 | 4,525 | 1,600 | 400 |
| W5 / same / 1000000 / 0 / 32 | 282 | 141 | 4 |
| W5 / same / 1000000 / 500 / 32 | 200 | 141 | no pass |
| W5 / sharded / 1000000 / 0 / 32 | — | — | 141 |
| W5 / sharded / 1000000 / 500 / 32 | — | — | 35 |
