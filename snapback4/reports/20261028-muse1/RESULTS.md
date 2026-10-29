# MUSE1 complete-session measurements

Exact provider totals; all fixed draws retained. `branch` is the rejected opt-in-only candidate; `compact` is the rejected compact-default candidate; `optin` is the explicit-choice fallback. Both candidates include integrated .48 TOK5/GEN1.

| Model | Idea | Phase | Calls | Input tokens | Wall min |
|---|---:|---|---:|---:|---:|
| muse | 019 | v46 | 102 | 9,506,799 | 16.81 |
| muse | 019 | v47 | 150 | 21,142,866 | 37.87 |
| muse | 019 | branch | 120 | 13,756,002 | 17.61 |
| muse | 019 | compact | 93 | 9,630,048 | 20.19 |
| muse | 019 | optin | 83 | 8,434,396 | 17.87 |
| muse | 032 | v46 | 83 | 8,014,586 | 15.82 |
| muse | 032 | v47 | 93 | 11,237,971 | 16.60 |
| muse | 032 | branch | 77 | 7,054,408 | 12.99 |
| muse | 032 | compact | 118 | 12,882,917 | 29.75 |
| muse | 032 | optin | 102 | 12,387,592 | 21.85 |
| muse | 026 | v46 | 147 | 19,174,721 | 28.97 |
| muse | 026 | v47 | 118 | 16,453,649 | 21.83 |
| muse | 026 | branch | 118 | 14,316,173 | 27.55 |
| muse | 026 | compact | 95 | 10,124,442 | 16.43 |
| muse | 026 | optin | 83 | 7,527,288 | 12.52 |
| muse | 035 | v46 | 90 | 8,479,885 | 12.66 |
| muse | 035 | v47 | 117 | 16,461,744 | 25.04 |
| muse | 035 | branch | 119 | 12,595,509 | 20.35 |
| muse | 035 | compact | 124 | 15,529,104 | 24.09 |
| muse | 035 | optin | 83 | 7,793,820 | 15.52 |
| codex | 001 | v46 | 40 | 2,528,911 | 11.67 |
| codex | 001 | v47 | 35 | 2,093,185 | 11.12 |
| codex | 001 | branch | 40 | 2,879,383 | 12.50 |
| codex | 001 | compact | 33 | 1,675,163 | 9.71 |
| codex | 001 | optin | 55 | 3,923,611 | 13.35 |
| codex | 014 | v46 | 43 | 2,265,122 | 11.34 |
| codex | 014 | v47 | 34 | 2,360,925 | 10.36 |
| codex | 014 | branch | 41 | 2,558,415 | 13.19 |
| codex | 014 | compact | 39 | 2,408,528 | 11.91 |
| codex | 014 | optin | 37 | 1,834,244 | 7.71 |

| Model | Phase | N | Median calls | Median input | Median wall min |
|---|---|---:|---:|---:|---:|---:|
| muse | v46 | 4 | 96 | 8,993,342 | 16.31 |
| muse | v47 | 4 | 117.5 | 16,457,696 | 23.43 |
| muse | branch | 4 | 118.5 | 13,175,756 | 18.98 |
| muse | compact | 4 | 106.5 | 11,503,680 | 22.14 |
| muse | optin | 4 | 83 | 8,114,108 | 16.69 |
| codex | v46 | 2 | 41.5 | 2,397,016 | 11.51 |
| codex | v47 | 2 | 34.5 | 2,227,055 | 10.74 |
| codex | branch | 2 | 40.5 | 2,718,899 | 12.85 |
| codex | compact | 2 | 36 | 2,041,846 | 10.81 |
| codex | optin | 2 | 46 | 2,878,928 | 10.53 |

muse versus v46: 4/4 after draws completed.
- calls: median totals 83.0 / 96.0 = 0.8646; median paired ratio 0.8680; individual paired ratios 019=0.8137, 026=0.5646, 032=1.2289, 035=0.9222; median-total bar PASS.
- input: median totals 8,114,108.0 / 8,993,342.0 = 0.9022; median paired ratio 0.9031; individual paired ratios 019=0.8872, 026=0.3926, 032=1.5456, 035=0.9191; median-total bar PASS.

codex versus v47: 2/2 after draws completed.
- calls: median totals 46.0 / 34.5 = 1.3333; median paired ratio 1.3298; individual paired ratios 001=1.5714, 014=1.0882; median-total bar MISS.
- input: median totals 2,878,927.5 / 2,227,055.0 = 1.2927; median paired ratio 1.3257; individual paired ratios 001=1.8745, 014=0.7769; median-total bar MISS.
