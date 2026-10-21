# All 60 cells beside the original controls

Highest tested passing offered ops/s; every repetition must pass. Raw PG and advocate query pools match: 32 for reads, C for writes. Advocate additionally has one schema-cache listener. First Supabase uses pool 10 throughout and is historical context, not a matched-budget baseline.

| Workload / keys / added RTT µs / clients | Raw PG | First Supabase (pool 10) | Advocate (pool 32 or C) |
|---|---:|---:|---:|
| W1 / disjoint / 0 / 128 | 22,627 | 1,414 | 1,414 |
| W1 / disjoint / 500 / 128 | 16,000 | 707 | 1,000 |
| W2 / disjoint / 0 / 128 | 11,313 | 1,414 | 1,414 |
| W2 / disjoint / 500 / 128 | 8,000 | 707 | 1,414 |
| W3 / disjoint / 0 / 128 | 8,000 | 1,414 | 2,000 |
| W3 / disjoint / 500 / 128 | 11,313 | 707 | 1,414 |
| W4 / disjoint / 0 / 1 | 282 | 100 | 50 |
| W4 / disjoint / 0 / 2 | 282 | 200 | 141 |
| W4 / disjoint / 0 / 4 | 565 | 282 | 141 |
| W4 / disjoint / 0 / 8 | 800 | 565 | 565 |
| W4 / disjoint / 0 / 16 | 2,262 | 800 | 1,131 |
| W4 / disjoint / 0 / 32 | 2,262 | 800 | 1,600 |
| W4 / disjoint / 0 / 64 | 4,525 | 800 | 3,200 |
| W4 / disjoint / 0 / 128 | 9,050 | 565 | 2,262 |
| W4 / disjoint / 0 / 256 | 18,101 | 565 | 3,200 |
| W4 / disjoint / 500 / 1 | 200 | 100 | 70 |
| W4 / disjoint / 500 / 2 | 282 | 100 | 50 |
| W4 / disjoint / 500 / 4 | 565 | 100 | 200 |
| W4 / disjoint / 500 / 8 | 1,131 | 282 | 200 |
| W4 / disjoint / 500 / 16 | 2,262 | 282 | 400 |
| W4 / disjoint / 500 / 32 | 4,525 | 282 | 1,600 |
| W4 / disjoint / 500 / 64 | 6,400 | 565 | 2,262 |
| W4 / disjoint / 500 / 128 | 12,800 | 565 | 2,262 |
| W4 / disjoint / 500 / 256 | 18,101 | 565 | 1,131 |
| W5 / hot1 / 0 / 1 | 282 | 70 | 12 |
| W5 / hot1 / 0 / 2 | 282 | 200 | 141 |
| W5 / hot1 / 0 / 4 | 400 | 282 | 400 |
| W5 / hot1 / 0 / 8 | 1,131 | 565 | 400 |
| W5 / hot1 / 0 / 16 | 2,262 | 800 | 800 |
| W5 / hot1 / 0 / 32 | 4,525 | 565 | 1,131 |
| W5 / hot1 / 0 / 64 | 4,525 | 565 | 400 |
| W5 / hot1 / 0 / 128 | 6,400 | 565 | 2,262 |
| W5 / hot1 / 0 / 256 | 12,800 | 800 | 2,262 |
| W5 / hot1 / 500 / 1 | 200 | 100 | 8 |
| W5 / hot1 / 500 / 2 | 282 | 100 | 17 |
| W5 / hot1 / 500 / 4 | 565 | 282 | 282 |
| W5 / hot1 / 500 / 8 | 1,131 | 282 | 400 |
| W5 / hot1 / 500 / 16 | 2,262 | 565 | 800 |
| W5 / hot1 / 500 / 32 | 4,525 | 800 | 1,600 |
| W5 / hot1 / 500 / 64 | 9,050 | 565 | 1,131 |
| W5 / hot1 / 500 / 128 | 12,800 | 565 | 800 |
| W5 / hot1 / 500 / 256 | 12,800 | 565 | 3,200 |
| W5 / same / 0 / 1 | 282 | 100 | 35 |
| W5 / same / 0 / 2 | 282 | 141 | 70 |
| W5 / same / 0 / 4 | 100 | 141 | 141 |
| W5 / same / 0 / 8 | 282 | 141 | 141 |
| W5 / same / 0 / 16 | 141 | 70 | 141 |
| W5 / same / 0 / 32 | 282 | 141 | 141 |
| W5 / same / 0 / 64 | 200 | 141 | 200 |
| W5 / same / 0 / 128 | 141 | 100 | 100 |
| W5 / same / 0 / 256 | 282 | 141 | 35 |
| W5 / same / 500 / 1 | 200 | 70 | 50 |
| W5 / same / 500 / 2 | 282 | 100 | 25 |
| W5 / same / 500 / 4 | 282 | 100 | 50 |
| W5 / same / 500 / 8 | 282 | 100 | 100 |
| W5 / same / 500 / 16 | 282 | 141 | 70 |
| W5 / same / 500 / 32 | 200 | 200 | 141 |
| W5 / same / 500 / 64 | 282 | 200 | 141 |
| W5 / same / 500 / 128 | 200 | 200 | 100 |
| W5 / same / 500 / 256 | 282 | 200 | 100 |
