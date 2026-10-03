| Case | Plain export:ios | Social export:ios | Outcome |
| --- | ---: | ---: | --- |
| cold | 170.134 s | 243.806 s | exit 0, three segments pass |
| warm1 | 19.527 s | 23.349 s | exit 0, three segments pass |
| warm2 | 17.795 s | 24.404 s | exit 0, three segments pass |
| warm3 | 18.320 s | 23.283 s | exit 0, three segments pass |
| warm4 | 17.888 s | 24.876 s | exit 0, three segments pass |
| warm5 | 17.776 s | 23.870 s | exit 0, three segments pass |
| native-change | 97.638 s | 160.679 s | exit 0, three segments pass |
| startup-throw | 13.683 s | 15.234 s | exit 1, expected |
| missing-runtime | 3.134 s | 3.800 s | exit 0, native skipped |
| opt-out | 2.957 s | 3.575 s | exit 0, opted out |
| **Five-run warm median** | **17.888 s** | **23.870 s** | All five distinct bundles loaded |
{"plain":{"warmMedianMs":17888,"nativeWarmMedianMs":15138},"social":{"warmMedianMs":23870,"nativeWarmMedianMs":19969}}
