# Burn down the telemetry proof ownership exception

Status: Open

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
