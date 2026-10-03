# Every sampled unit-suite attempt

All complete whole-suite runs use the default 96 libtest slots in one process, except the explicitly serial run. Four existing tests are ignored. The two timing controls select only two tests. No test is retried inside a recorded run.

| Run | Entry soft | Passed | Failed | Ignored | Seconds | Sampled peak fds | Validity / result |
|---|---:|---:|---:|---:|---:|---:|---|
| [baseline-1024](baseline-1024.log) | 1024 | 229 | 5 | 4 | 7.925 | 956 | exit 101 |
| [baseline-4096](baseline-4096.log) | 4096 | 234 | 0 | 4 | 7.127 | 1197 | pass |
| [baseline-serial](baseline-serial.log) | 1024 | 234 | 0 | 4 | 31.307 | 249 | pass |
| [baseline-loaded-1](baseline-loaded-1.log) | 4096 | 234 | 0 | 4 | 9.007 | 822 | pass |
| [baseline-loaded-2](baseline-loaded-2.log) | 4096 | 234 | 0 | 4 | 6.908 | 912 | pass |
| [baseline-loaded-3](baseline-loaded-3.log) | 4096 | 234 | 0 | 4 | 6.565 | 949 | pass |
| [baseline-loaded-4](baseline-loaded-4.log) | 4096 | 233 | 1 | 4 | 6.976 | 777 | exit 101 |
| [baseline-loaded-5](baseline-loaded-5.log) | 4096 | 233 | 1 | 4 | 6.886 | 1123 | exit 101 |
| [final-1024-1](final-1024-1.log) | 1024 | 237 | 0 | 4 | 9.091 | 790 | pass |
| [final-1024-2](final-1024-2.log) | 1024 | 236 | 1 | 4 | 8.419 | 876 | exit 101 |
| [final-1024-3](final-1024-3.log) | 1024 | 237 | 0 | 4 | 7.628 | 726 | pass |
| [final-1024-4](final-1024-4.log) | 1024 | 234 | 3 | 4 | 24.316 | 676 | exit 101 |
| [final-1024-5](final-1024-5.log) | 1024 | 237 | 0 | 4 | 21.469 | 544 | pass |
| [final-256-1](final-256-1.log) | 256 | 237 | 0 | 4 | 18.805 | 640 | pass |
| [final-256-2](final-256-2.log) | 256 | 237 | 0 | 4 | 15.867 | 664 | pass |
| [final-256-3](final-256-3.log) | 256 | 237 | 0 | 4 | 22.046 | 706 | pass |
| [final-256-4](final-256-4.log) | 256 | 237 | 0 | 4 | 11.049 | 711 | pass |
| [final-256-5](final-256-5.log) | 256 | 233 | 4 | 4 | 6.708 | 814 | invalid: executable rebuilt during run; exit 101 |
| [verified-1024-1](verified-1024-1.log) | 1024 | 237 | 0 | 4 | 6.353 | 716 | pass |
| [verified-1024-2](verified-1024-2.log) | 1024 | 237 | 0 | 4 | 6.581 | 774 | pass |
| [verified-1024-3](verified-1024-3.log) | 1024 | 237 | 0 | 4 | 6.819 | 920 | pass |
| [verified-1024-4](verified-1024-4.log) | 1024 | 237 | 0 | 4 | 6.752 | 988 | pass |
| [verified-1024-5](verified-1024-5.log) | 1024 | 236 | 1 | 4 | 6.728 | 794 | exit 101 |
| [verified-256-1](verified-256-1.log) | 256 | 236 | 1 | 4 | 6.723 | 927 | exit 101 |
| [verified-256-2](verified-256-2.log) | 256 | 237 | 0 | 4 | 8.913 | 861 | pass |
| [verified-256-3](verified-256-3.log) | 256 | 237 | 0 | 4 | 6.632 | 719 | pass |
| [verified-256-4](verified-256-4.log) | 256 | 236 | 1 | 4 | 7.226 | 837 | exit 101 |
| [verified-256-5](verified-256-5.log) | 256 | 237 | 0 | 4 | 7.381 | 763 | pass |
| [baseline-timing-controls](baseline-timing-controls.log) | 4096 | 2 | 0 | 0 | 1.090 | 30 | pass |
| [final-timing-controls](final-timing-controls.log) | 1024 | 2 | 0 | 0 | 1.082 | 28 | pass |
| [baseline-load-1](baseline-load-1.log) | 4096 | 230 | 4 | 4 | 63.706 | 943 | invalid baseline location; exit 101 |
| [baseline-load-2](baseline-load-2.log) | 4096 | — | — | — | 17.256 | 1013 | invalid baseline location; exit -9 |

The `final-*` prefix was chosen before the exploratory batch finished; it does not imply every attempt qualified. `verified-*` runs use an immutable copy under `target/debug/deps/`, after Cargo finished, so self-spawning tests resolve the companion CLI and their own executable correctly. The binary unit behavior is unchanged by the subsequent correction moving production-only initialization past missing-argument checks. The full suite recompiles that final source.

Initial baseline unit SHA-256: `434da54e2965781bf3583d909c521e24005f37346eb941a6764811ce9d8f7edf`.
Repeated final unit SHA-256: `918b025daa1cf2cd39c551c23a08b5137fcabe6d64d5a72cd7e307a69eed7453`.
The profiler originally hashed the path after execution. That hash is not trustworthy for the invalid concurrent-rebuild attempt (`final-256-5`); later measurements hash before launch.

## Final source, after the complete suite

The final direct matrix uses an immutable copy of the exact full-suite unit
executable (`target/debug/deps/fdl-commit-unit`), SHA-256
`04d8f011227990c199aa015890135628c55ffebd6619427012d8ec9a32baa3db`.
It includes the production startup-log placement correction. All three failed
runs below failed only the baseline witness-lock test. No EMFILE.

| Run | Entry soft | Passed | Failed | Ignored | Seconds | Sampled peak fds |
|---|---:|---:|---:|---:|---:|---:|
| [commit-1024-1](commit-1024-1.log) | 1024 | 237 | 0 | 4 | 6.729 | 812 |
| [commit-1024-2](commit-1024-2.log) | 1024 | 236 | 1 | 4 | 6.580 | 956 |
| [commit-1024-3](commit-1024-3.log) | 1024 | 237 | 0 | 4 | 6.581 | 826 |
| [commit-1024-4](commit-1024-4.log) | 1024 | 237 | 0 | 4 | 6.638 | 755 |
| [commit-1024-5](commit-1024-5.log) | 1024 | 237 | 0 | 4 | 6.620 | 860 |
| [commit-256-1](commit-256-1.log) | 256 | 237 | 0 | 4 | 7.373 | 795 |
| [commit-256-2](commit-256-2.log) | 256 | 236 | 1 | 4 | 7.219 | 715 |
| [commit-256-3](commit-256-3.log) | 256 | 237 | 0 | 4 | 7.131 | 925 |
| [commit-256-4](commit-256-4.log) | 256 | 236 | 1 | 4 | 6.767 | 825 |
| [commit-256-5](commit-256-5.log) | 256 | 237 | 0 | 4 | 6.525 | 810 |
