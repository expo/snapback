# Final acceptance binary reused a stale dirty build-script stamp

**Status:** Closed — fixed forward 2026-08-06
**Opened:** 2026-08-06
**Systems:** CI, Native runtime identity, Acceptance harness
**Related:** LLP 0010, LLP 0031, GitHub Actions run `31142327486`, PR #18

## Failure

The final binary build and restricted-VM readiness gate passed, but seven later
acceptance rows rejected `target/debug/snapback` as an unpinned binary. Its
compiled health identity reported the exact merge commit with `gitDirty: true`
while the runtime-input-scoped checkout was clean. Each demo then attempted the
honest source fallback and independently hit the 90-second Linux link timeout,
creating the apparent seven-row cascade.

## Attribution

The final acceptance rebuild sequence landed in `702f82f5bd`. It reused the
root package's incremental build-script output after the earlier coded
bootstrap and restored Cargo cache, even though
`stamp_snapback_build_identity` had established the final clean deterministic
stamp. Cargo recompiled the binary target but retained the stale root
build-script environment output. Readiness qualifies loader and VM behavior;
it does not turn a dirty identity into a clean one, so the harness correctly
refused reuse.

## Resolution

Immediately before the final acceptance build, the proof now removes only the
root `snapback` package artifacts with `cargo clean -p snapback`, preserving all
dependency and vendored-Ibex artifacts. The following locked build must replay
`build.rs` under the final commit/dirty environment before the digest-bound
readiness receipt is issued. Provenance checks and source fallbacks remain
strict; no binary-identity bypass was added.
