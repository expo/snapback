| Workload (1m messages) | Added RTT | Raw PG (32) | First Supabase (10) | Advocate (32 + listener) |
|---|---:|---:|---:|---:|
| W1 visible message | natural | 22,627 | 1,414 | 1,414 |
| W1 visible message | +0.5 ms | 16,000 | 707 | 1,000 |
| W2 newest 20 | natural | 11,313 | 1,414 | 1,414 |
| W2 newest 20 | +0.5 ms | 8,000 | 707 | 1,414 |
| W3 32-room inbox | natural | 8,000 | 1,414 | 2,000 |
| W3 32-room inbox | +0.5 ms | 11,313 | 707 | 1,414 |
| W4 disjoint counters | natural | 2,262 | 800 | 1,600 |
| W4 disjoint counters | +0.5 ms | 4,525 | 282 | 1,600 |
| W5 shared counter | natural | 282 | 141 | 141 |
| W5 shared counter | +0.5 ms | 200 | 200 | 141 |
| W5 1% shared mix | natural | 4,525 | 565 | 1,131 |
| W5 1% shared mix | +0.5 ms | 4,525 | 800 | 1,600 |
