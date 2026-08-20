# Burn down the fork-promotion benchmark ownership exception

Status: Closed (2026-08-19)

The fork-promotion recorder's database work now consumes only the lower-owned
`snapback-engine::bench_support` contention harness and the safe
`snapback-services` benchmark port. The remaining root-package coupling is its
report provenance: `SNAPBACK_BUILD_GIT_COMMIT` and `SNAPBACK_BUILD_GIT_DIRTY`
are emitted by `crates/snapback/build.rs`, while the destination package does
not yet reproduce that exact build-identity contract. Moving the binary alone
would silently change benchmark identity.

Burn-down target: move the recorder to the manifest's planned `snapback-tools`
path, port the exact build-identity stamping into that package, preserve the
report schema, and delete the named
`fork-promotion-benchmark-composition` membership exception by 2026-09-15.

## Resolution

Moved `snapback-fork-promotion-bench` unchanged apart from its crate-qualified
engine support import into rank-7 `snapback-tools`. Its artifact structs,
serde names, schema version, constants, baseline binding, and validation logic
are byte-for-byte preserved by the path move. Database operations continue to
flow only through `snapback-engine::bench_support` and the lower services port.

The recorder inherits the one shared `snapback-tools` build-identity stamp
ported for the telemetry move. A same-tree probe compared the facade and tools
build-script outputs and matched both values exactly:
`SNAPBACK_BUILD_GIT_COMMIT=ec5f308fec76fdb1f892a2aedd8635c890841994`
and `SNAPBACK_BUILD_GIT_DIRTY=true`. The final membership assignment was
removed from both confinement artifacts; no allowed workspace dependency was
added or widened.
