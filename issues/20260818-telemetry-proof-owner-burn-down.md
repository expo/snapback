# Burn down the telemetry proof ownership exception

Status: Open

The Phase 1 telemetry proof still combines private services-owned telemetry
state with engine and HTTP composition in the rank-7 `snapback` package.
Moving it directly would widen private service traits into a public harness
surface.

Burn-down target: define a capability-safe telemetry proof port owned by
`snapback-services`, implement the higher-rank composition in
`snapback-tools`, move both proof modules, and delete the named
`telemetry-proof-private-composition` membership exception by 2026-09-15.
