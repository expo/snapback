# Published runtime's embedded control catalog reports a different, dirty build identity

**Status:** Open
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
