| Workload (1M messages) | Link | Raw PG (token) | Raw PG (**no token**) | Supabase advocate | Convex advocate* |
|---|---|---:|---:|---:|---:|
| W1 visible message | natural | 22,627 | 22,627 | 2,828 | 1,000 |
| W1 visible message | +0.5 ms | 16,000 | 16,000 | 2,000 | 1,000 |
| W2 newest 20 | natural | 11,313 | 8,000 | 2,000 | 16,000 |
| W2 newest 20 | +0.5 ms | 11,313 | 8,000 | 1,414 | 16,000 |
| W3 32-room inbox | natural | 16,000 | 11,313 | 2,828 | 16,000 |
| W3 32-room inbox | +0.5 ms | 11,313 | 8,000 | 1,414 | 11,313 |
| W4 disjoint counters | natural | 4,525 | 2,262 | 2,262 | 1 |
| W4 disjoint counters | +0.5 ms | 4,525 | 35 | 282 | no pass |
| W5 shared counter, exact | natural | 282 | 200 | 141 | 4 |
| W5 shared counter, exact | +0.5 ms | 282 | 141 | 35 | no pass |
| W5 nominal 1% shared mix | natural | 4,525 | 2,262 | 2,262 | 282 |
| W5 nominal 1% shared mix | +0.5 ms | 4,525 | 3,200 | 1,131 | 400 |
