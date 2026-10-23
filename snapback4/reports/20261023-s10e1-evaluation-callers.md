# S10e-1: evaluation callers over the common Engine

Date: 2026-10-23
Branch: sb4-pg/s10e1
Base: addf5750eba0264125da405fb1f246e52ddf19fd

The implementation retains PostgresEngine as a comparison oracle. Evidence is
collected in `/tmp/s10e1/` on expo-build-450a, using the authorized warm target,
six Cargo jobs and owned PostgreSQL 16 socket-only clusters. PostgreSQL 17 on
port 55440 is outside this work. No target copy, stash, push or Git configuration
change is part of the lane.

The governing context is LLP 3000 (the Snapback 4 fence), LLP 2000.000 (one
interpreter and runtime metering), and LLP 3000.009.001.000 §3.4/§9.1 (shared
semantic policy, exact overlap, named unsupported capabilities, terminal adapter
errors, bounded ordering and independent C1 call evidence). The root LLP 3000
is in foundation; the store-port RFC is in current. This is an llp-orient context
pack scoped to evaluation callers; no app authoring surface changes.

Build and no-default core check have passed. Full overlap and qualification
results are recorded below when their owned-cluster runs complete.
