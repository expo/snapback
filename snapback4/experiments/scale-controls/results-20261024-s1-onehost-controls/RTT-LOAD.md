# RTT and released cell-start load

All 36 released starts have zero unrelated processes above one sampled logical CPU. The 23 preceding busy observations are waits, not released cell starts. Full top-process lists, times and wait reasons are in [rtt-load.json](./rtt-load.json). Each RTT boundary contains 100 warm-ups and 1,000 prepared SELECT 1 samples through the selected shared link. No absolute RTT threshold beyond successful capture was newly invented.

| System | Cell | Link | Loadavg 1/5/15 at release | RTT p50 before/after ms | RTT p99 before/after ms |
|---|---|---|---|---:|---:|
| rawpg | W1 | A | 6.83 / 9.90 / 14.69 | 0.570 / 0.619 | 0.621 / 3.649 |
| rawpg | W1 | B | 30.85 / 22.02 / 16.77 | 1.155 / 1.170 | 4.323 / 3.969 |
| rawpg | W2 | A | 32.84 / 29.63 / 22.08 | 0.622 / 0.562 | 3.609 / 0.576 |
| rawpg | W2 | B | 17.22 / 15.41 / 17.11 | 1.095 / 1.078 | 1.139 / 1.146 |
| rawpg | W3 | A | 24.89 / 21.06 / 17.16 | 0.561 / 0.620 | 0.608 / 3.875 |
| rawpg | W3 | B | 17.78 / 16.80 / 15.46 | 1.085 / 1.116 | 1.138 / 1.578 |
| rawpg | W4 | A | 27.70 / 27.94 / 20.20 | 0.591 / 0.601 | 0.634 / 3.917 |
| rawpg | W4 | B | 22.31 / 19.92 / 18.63 | 1.151 / 1.086 | 3.105 / 1.128 |
| rawpg | W5 hot1 | A | 1.19 / 1.43 / 5.60 | 0.575 / 0.565 | 0.604 / 0.585 |
| rawpg | W5 hot1 | B | 4.02 / 3.40 / 5.36 | 1.074 / 1.078 | 1.113 / 1.118 |
| rawpg | W5 same | A | 0.81 / 4.43 / 11.13 | 0.570 / 0.567 | 0.605 / 0.584 |
| rawpg | W5 same | B | 1.22 / 2.12 / 7.81 | 1.080 / 1.085 | 1.130 / 1.126 |
| supabase | W1 | A | 2.74 / 4.00 / 5.08 | 0.562 / 0.576 | 0.632 / 0.592 |
| supabase | W1 | B | 22.11 / 15.89 / 10.01 | 1.095 / 1.144 | 1.136 / 4.311 |
| supabase | W2 | A | 18.41 / 20.64 / 14.50 | 0.572 / 0.562 | 0.625 / 0.584 |
| supabase | W2 | B | 18.57 / 17.24 / 14.76 | 1.093 / 1.089 | 1.144 / 1.137 |
| supabase | W3 | A | 24.88 / 19.38 / 15.75 | 0.562 / 0.564 | 0.578 / 0.582 |
| supabase | W3 | B | 21.61 / 17.02 / 15.24 | 1.070 / 1.070 | 1.121 / 1.089 |
| supabase | W4 | A | 17.23 / 15.33 / 14.41 | 0.563 / 0.563 | 0.586 / 0.592 |
| supabase | W4 | B | 15.56 / 15.40 / 14.65 | 1.097 / 1.097 | 1.148 / 1.137 |
| supabase | W5 hot1 | A | 1.29 / 2.63 / 7.70 | 0.562 / 0.570 | 0.595 / 0.603 |
| supabase | W5 hot1 | B | 6.13 / 6.17 / 7.82 | 1.071 / 1.076 | 1.127 / 1.132 |
| supabase | W5 same | A | 14.28 / 14.57 / 14.41 | 0.574 / 0.563 | 0.618 / 0.596 |
| supabase | W5 same | B | 0.86 / 5.11 / 10.07 | 1.093 / 1.097 | 1.168 / 1.121 |
| convex | W1 | A | 1.21 / 1.21 / 2.28 | 0.571 / 0.569 | 0.619 / 0.601 |
| convex | W1 | B | 27.11 / 17.77 / 9.65 | 1.071 / 1.075 | 1.127 / 1.096 |
| convex | W2 | A | 19.56 / 24.07 / 16.06 | 0.562 / 0.563 | 0.597 / 0.586 |
| convex | W2 | B | 8.22 / 9.57 / 11.64 | 1.078 / 1.073 | 1.145 / 1.091 |
| convex | W3 | A | 7.54 / 6.28 / 8.87 | 0.562 / 0.605 | 0.608 / 3.101 |
| convex | W3 | B | 9.79 / 10.24 / 8.92 | 1.073 / 1.065 | 1.124 / 1.094 |
| convex | W4 | A | 7.24 / 6.26 / 6.86 | 0.563 / 0.614 | 0.600 / 3.893 |
| convex | W4 | B | 14.96 / 14.38 / 13.53 | 1.127 / 1.081 | 4.471 / 1.144 |
| convex | W5 hot1 | A | 1.21 / 3.01 / 7.81 | 0.590 / 0.588 | 0.608 / 0.612 |
| convex | W5 hot1 | B | 26.86 / 19.69 / 13.92 | 1.095 / 1.095 | 1.129 / 1.148 |
| convex | W5 same | A | 4.65 / 12.14 / 14.54 | 0.570 / 0.568 | 0.618 / 0.595 |
| convex | W5 same | B | 1.30 / 4.86 / 10.40 | 1.078 / 1.073 | 1.148 / 1.106 |
