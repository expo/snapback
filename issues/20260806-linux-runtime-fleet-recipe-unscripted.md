# Linux-x64 release runtime: fleet-host recipe lives only in prose

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 4
**Confidence:** 5
**Systems:** Packaging, Deployment
**Date:** 2026-08-06
**Related:** LLP 0041 (`llp/0041-packaged-dev-loop.rfc.md` ~1122-1130 — the
only record of the 0.1.8 recipe), `.eas/workflows/qualified-package-staging.yml`
(lines 47-82, the canonical committed twin),
`issues/20260803-linux-hermes-release-carrier-gap.md` (why the Hermes leg
is the dominant cost)

## Summary

Producing the `snapback-runtime-linux-x64` release inputs (`snapback` ELF,
`libhermesvm.so`, `snapback.runtime-artifact-attestation.v1`) on a fleet
host has no committed script — the recipe must be reconstructed each time
from the EAS workflow YAML plus LLP 0041 prose. The 0.1.9 promotion
(2026-08-06) reconstructed it again, by hand, via an agent.

## Ask

Commit a `scripts/build-linux-runtime-release` (or similar) wrapper that
runs the bootstrap → link-smoke → `SNAPBACK_BUILD_DISTRIBUTION=public-package
cargo build --release` → `prepare-runtime.mjs` → clean-tree check →
`build-identity` → attestation mint sequence and emits the three artifacts
plus their sha256s, so a fleet build is one command and the attestation
gates cannot be skipped by accident. `tests/ci_workflows_v0.mjs:394-397`
pins the four `SNAPBACK_RUNTIME_LINUX_X64_*` env-var names the consumer
side expects.
