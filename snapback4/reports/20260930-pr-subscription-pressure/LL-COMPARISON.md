# LL before/after measurements

Milliseconds, nearest-rank p50/p95; 20 samples per flow per cell. Both loads use four permitted CPUs (0–3); load 3 adds three owned busy workers. All original stage and work-count distributions remain in the summary JSONs.

| Tier / busy workers | Flow | Before publication p50/p95 | After publication p50/p95 | Before queries p50/p95 | After queries p50/p95 | Before/after asset-home p95 |
|---|---|---:|---:|---:|---:|---:|
| wasm / 0 | profile | 15.326/24.369 | 16.449/22.473 | 2/2 | 2/2 | 0/0 |
| wasm / 0 | reaction-add | 20.346/27.798 | 19.696/26.198 | 40/40 | 40/40 | 0/0 |
| wasm / 0 | reaction-replace | 18.858/22.592 | 18.019/22.796 | 40/40 | 40/40 | 0/0 |
| wasm / 0 | reaction-remove | 20.417/23.444 | 19.488/23.405 | 40/40 | 40/40 | 0/0 |
| wasm / 0 | reply | 35.978/45.891 | 39.341/44.821 | 48/55 | 49/54 | 18/18 |
| wasm / 0 | photo | 36.329/46.964 | 36.744/42.619 | 49/55 | 49/54 | 92/92 |
| wasm / 0 | feed-image | 21.814/26.661 | 20.889/25.664 | 2/2 | 2/2 | 94/94 |
| wasm / 0 | once-photo | 37.7/46.814 | 37.095/45.042 | 49/55 | 49/55 | 57/57 |
| wasm / 3 | profile | 29.629/38.418 | 37.143/43.309 | 2/4 | 2/4 | 0/0 |
| wasm / 3 | reaction-add | 40.508/54.992 | 36.91/45.484 | 40/48 | 40/48 | 0/0 |
| wasm / 3 | reaction-replace | 35.364/47.737 | 37.538/43.844 | 40/49 | 41/52 | 0/0 |
| wasm / 3 | reaction-remove | 39.221/50.979 | 38.974/45.983 | 48/55 | 41/60 | 0/0 |
| wasm / 3 | reply | 71.813/84.135 | 73.874/100.604 | 59/67 | 65/75 | 18/18 |
| wasm / 3 | photo | 72.547/94.598 | 69.093/86.1 | 61/70 | 65/67 | 92/92 |
| wasm / 3 | feed-image | 39.788/56.28 | 40.459/49.774 | 2/4 | 2/3 | 94/94 |
| wasm / 3 | once-photo | 78.993/91.063 | 71.048/86.582 | 61/71 | 61/69 | 57/57 |
| process / 0 | profile | 21.793/27.356 | 24.596/39.148 | 2/2 | 2/3 | 0/0 |
| process / 0 | reaction-add | 36.526/42.854 | 39.068/45.256 | 39/43 | 39/44 | 0/0 |
| process / 0 | reaction-replace | 34.318/36.817 | 35.423/40.452 | 40/44 | 35/45 | 0/0 |
| process / 0 | reaction-remove | 36.979/40.79 | 39.459/64.567 | 39/47 | 42/60 | 0/0 |
| process / 0 | reply | 65.965/78.52 | 67.763/95.519 | 75/80 | 71/80 | 18/18 |
| process / 0 | photo | 65.478/77.266 | 66.177/87.331 | 72/76 | 71/77 | 92/92 |
| process / 0 | feed-image | 36.264/51.508 | 40.009/62.271 | 2/3 | 3/3 | 94/94 |
| process / 0 | once-photo | 69.135/74.539 | 72.84/83.662 | 73/76 | 73/76 | 57/57 |
| process / 3 | profile | 39.875/48.821 | 57.05/82.504 | 2/3 | 3/4 | 0/0 |
| process / 3 | reaction-add | 79.102/93.214 | 132.816/208.086 | 40/48 | 43/60 | 0/0 |
| process / 3 | reaction-replace | 77.861/105.218 | 133.572/220.231 | 53/68 | 50/62 | 0/0 |
| process / 3 | reaction-remove | 94.338/123.699 | 138.5/218.344 | 55/66 | 57/68 | 0/0 |
| process / 3 | reply | 175.073/218.916 | 258.984/358.139 | 83/96 | 87/105 | 17/18 |
| process / 3 | photo | 162.08/187.651 | 242.725/317.972 | 84/106 | 88/111 | 92/92 |
| process / 3 | feed-image | 65.684/79.327 | 110.213/148.451 | 3/3 | 3/4 | 94/94 |
| process / 3 | once-photo | 172.367/190.49 | 253.555/313.927 | 89/97 | 91/101 | 57/57 |

## Alternating process contention controls

Same CPU 0–3 and three busy workers. Product source was untouched; seven compiled modules were swapped from the recorded main or fixed build, restored in finally. Every run retains 20 samples for each of eight flows. These are additional measurements, not replacements for the original comparison.

| Run | Host load (1/5/15 min) | Maximum publication p95 | Timeouts |
|---|---|---:|---:|
| main | [78.15, 83.34, 69.57] | 236 ms | 0 |
| fixed | [137.13, 110.29, 81.88] | 472.833 ms | 0 |
| main2 | [87.03, 101.54, 82.09] | 249.785 ms | 0 |
| fixed2 | [65.95, 90.79, 80.07] | 220.074 ms | 0 |

Final adjacent pair, per-flow publication and logical device-query counts:

| Flow | Main p50/p95 ms | Fixed p50/p95 ms | Main queries p50/p95 | Fixed queries p50/p95 | Main/fixed home reads p95 |
|---|---:|---:|---:|---:|---:|
| profile | 50.77/73.571 | 40.33/51.165 | 3/4 | 2/3 | 0/0 |
| reaction-add | 104.226/151.494 | 82.03/116.073 | 43/57 | 40/46 | 0/0 |
| reaction-replace | 114.171/161.655 | 83.74/114.274 | 54/70 | 54/61 | 0/0 |
| reaction-remove | 115.371/168.15 | 91.509/147.372 | 54/64 | 52/69 | 0/0 |
| reply | 205.066/249.785 | 173.547/192.914 | 84/104 | 86/95 | 18/18 |
| photo | 197.165/222.702 | 174.469/220.074 | 85/105 | 84/117 | 92/92 |
| feed-image | 82.365/118.669 | 61.841/83.371 | 3/4 | 3/3 | 94/94 |
| once-photo | 199.02/240.277 | 179.2/214.499 | 86/97 | 84/95 | 57/57 |
