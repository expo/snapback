# Burn down the fork-promotion benchmark ownership exception

Status: Open

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
