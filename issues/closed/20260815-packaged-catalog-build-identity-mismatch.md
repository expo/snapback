# Published runtime's embedded control catalog reports a different, dirty build identity

**Status:** Closed
**Opened:** 2026-08-15 · **Severity:** P3 · **Area:** Packaging / control catalog
**Found by:** the password clean-install proof
(`issues/closed/20260809-password-credential-auth.md`), against published
`@expo/snapback-runtime-darwin-arm64@0.1.22`.

The packaged binary's own launch stamp says `gitCommit 272bea745bb0…,
gitDirty: false, buildProfile: release`, but its embedded control catalog
reports `buildIdentity { sourceCommit: b94fef6d8…, dirty: true }` — the
catalog appears to have been generated from a different, dirty checkout at
packaging time. The binary behaved correctly throughout the proof; this is a
provenance-honesty defect in the published artifact, not an observed
behavioral one. The catalog's build identity should be minted from the same
qualified source state as the binary, or the ceremony should refuse the
mismatch.

## Resolution (2026-08-25)

The generated catalog carried the ambient checkout identity captured when
`scripts/generate-control-catalog.mjs` last wrote the checked-in JSON, while
the runtime executable was stamped independently by its package-local Rust
build script. `snapback-kernel` embedded that checked-in JSON byte-for-byte,
and package manufacture verified the executable and seal without comparing
the embedded catalog identity to the executable identity.

`snapback-kernel` now produces the embedded catalog in its build script and
stamps that copy with the commit and dirty state returned by the same shared
build-identity probe used for the executable. The checked-in catalog remains
the compiler-run snapshot, including `generatedAtCommit`, while its embedded
`buildIdentity` is bound to the enclosing binary. Runtime package preparation
and publication tarball qualification inspect `controls list --json` and
refuse a mismatch with
`SNAPBACK_RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH` before sealing, swapping,
or publishing the artifact.

The packaging refusal test was confirmed fail-first: before the ceremony
check, the mismatched fixture failed with `Missing expected exception`. With
the fix, the script and package test selection passes 58/58, including the
mismatch refusal and preservation of the prior sealed package; the kernel
control-catalog selection passes 3/3. A rebuilt binary reported matching
`2bf6a81e7662d169cee72ea6eed42b49a97c9c84` / `dirty:true` identities for its
launch stamp and embedded catalog during implementation. The final clean
commit identity is recorded in the lane report.
