# capture-smoke

Validation only: W4, four writers, 100 offered requests/s, nominal 0.5 ms added RTT, one 0.4 s measured window after 0.1 s warm-up. The counter delta equals all 50 acknowledged writes. Confirms wait, CPU and SQL snapshot capture. No ceiling claim.

The cluster is durable PG17.9 on expo-build-450a, ~/sb4scale/pg17, port 55440. Password contents are absent. These records share the main report’s two-host, taskset, SSH/proxy, shared-host, short-window and deferred-advocate-review caveats.
