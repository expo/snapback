# jit-config

Setup only: applied jit=off after the relocated PG17 package failed to load libLLVM.so.19.1 during seeding. Removed that incomplete owned fixture database. No measured workload or durability relaxation. All recorded SSH PIDs were stopped.

The cluster is durable PG17.9 on expo-build-450a, ~/sb4scale/pg17, port 55440. Password contents are absent. These records share the main report’s two-host, taskset, SSH/proxy, shared-host, short-window and deferred-advocate-review caveats.
