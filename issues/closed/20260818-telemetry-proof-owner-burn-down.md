# Burn down the telemetry proof ownership exception

Status: Closed (2026-08-19)

The Phase 1 telemetry proof's storage measurements now run through an
observation-only `snapback-services` port; buffers, SQLite connections,
transactions, and maintenance primitives stay confined. The remaining rank-7
orchestrator still composes engine application calls, server HTTP routing,
facade build identity, and the committed facade-relative baseline. Moving it
to background services would create upward engine/server dependencies.

Burn-down target: move the higher-rank orchestration and binary to
`snapback-tools`, port the exact build stamping and baseline path there, then
delete the named `telemetry-proof-private-composition` membership exception by
2026-09-15.

## Resolution

Moved both the Phase 1 orchestration module and
`snapback-telemetry-bench` into rank-7 `snapback-tools`. The orchestrator now
composes only downward dependencies: engine-owned `LocalSnapback`, the
services-owned observation port, types-owned fixture/request carriers, and a
feature-gated server-owned HTTP exercise port that does not expose Axum
primitives. The baseline remains the same repository-relative
`tests/acceptance/telemetry-phase1-benchmark-baseline.v1.json` carrier.

`snapback-tools/build.rs` now emits the same runtime-input-scoped
`SNAPBACK_BUILD_GIT_COMMIT` and `SNAPBACK_BUILD_GIT_DIRTY` contract as the
facade build script. A same-tree before/after probe produced
`ec5f308fec76fdb1f892a2aedd8635c890841994` and `true` from both scripts. The
proof driver now builds/tests the tools package separately from the facade
server binary. The two obsolete membership assignments were removed from both
confinement artifacts without widening a workspace dependency.
