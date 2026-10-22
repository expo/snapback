| Stage, ms/request | 100/s mean / p50 / p99 | 141/s mean / p50 / p99 | 200/s mean / p50 / p99 |
|---|---:|---:|---:|
| Session resolution, exclusive of queue | 0.217 / 0.210 / 0.341 | 0.270 / 0.271 / 0.362 | 0.243 / 0.242 / 0.345 |
| Engine mutex queue (all acquisitions) | 32.037 / 0.032 / 389.891 | 257.569 / 259.352 / 312.669 | 257.870 / 259.606 / 289.375 |
| Program and final obligations | 0.163 / 0.170 / 0.236 | 0.155 / 0.161 / 0.242 | 0.138 / 0.127 / 0.230 |
| Engine prelude / tail / transaction setup | 0.087 / 0.086 / 0.137 | 0.088 / 0.090 / 0.138 | 0.079 / 0.074 / 0.134 |
| Physical COMMIT (includes flush/checkpoint) | 8.554 / 7.811 / 16.119 | 7.989 / 7.800 / 15.873 | 7.888 / 7.720 / 15.415 |
| After commit through response write | 0.181 / 0.183 / 0.264 | 0.173 / 0.180 / 0.268 | 0.159 / 0.158 / 0.252 |
| Request parsing / preflight / other | 0.062 / 0.060 / 0.096 | 0.074 / 0.073 / 0.107 | 0.067 / 0.066 / 0.099 |
| Accepted through response | 41.335 / 9.801 / 400.251 | 266.352 / 268.070 / 323.385 | 266.473 / 268.091 / 298.552 |
| Flush syscalls (subset of COMMIT) | 8.481 / 7.742 / 15.847 | 7.918 / 7.728 / 15.691 | 7.826 / 7.662 / 15.305 |
| Request thread CPU | 0.864 / 0.864 / 1.221 | 0.936 / 0.957 / 1.231 | 0.842 / 0.826 / 1.176 |
