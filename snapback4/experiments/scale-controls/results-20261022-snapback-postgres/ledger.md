| Workload | Link | Snapback PG | Raw PG token | Raw PG no token | Supabase advocate | Convex/PG advocate | Snapback SQLite (natural only) |
|---|---|---|---:|---:|---:|---:|---:|
| W1 visible message | natural | blocked | 22,627 | 22,627 | 2,828 | 1,000 | 2,828 |
| W1 visible message | +0.5 ms | blocked | 16,000 | 16,000 | 2,000 | 1,000 | 2,828 |
| W2 newest 20 | natural | blocked | 11,313 | 8,000 | 2,000 | 16,000 | 5,656 |
| W2 newest 20 | +0.5 ms | blocked | 11,313 | 8,000 | 1,414 | 16,000 | 5,656 |
| W3 32-room inbox | natural | blocked | 16,000 | 11,313 | 2,828 | 16,000 | 2,828 |
| W3 32-room inbox | +0.5 ms | blocked | 11,313 | 8,000 | 1,414 | 11,313 | 2,828 |
| W4 disjoint counters | natural | blocked | 4,525 | 2,262 | 2,262 | 1 | 100 |
| W4 disjoint counters | +0.5 ms | blocked | 4,525 | 35 | 282 | no pass | 100 |
| W5 shared counter, exact | natural | blocked | 282 | 200 | 141 | 4 | 100 |
| W5 shared counter, exact | +0.5 ms | blocked | 282 | 141 | 35 | no pass | 100 |
| W5 nominal 1% shared mix | natural | blocked | 4,525 | 2,262 | 2,262 | 282 | 100 |
| W5 nominal 1% shared mix | +0.5 ms | blocked | 4,525 | 3,200 | 1,131 | 400 | 100 |
