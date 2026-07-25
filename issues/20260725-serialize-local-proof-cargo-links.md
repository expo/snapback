# Serialize canonical local-proof Cargo links

**Status:** In Progress
**Severity:** P1
**Systems:** CI, Build, Native runtime, Acceptance testing
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-25
**Related:** LLP 0010 §CI and Review Gates; GitHub Actions runs 30164619469 and 30166104010
**Marker:** ci, linker, github-actions, linux, local-proof

Two canonical `ubuntu-latest` local-proof runs reached `cargo test` after the
same preceding proof gates passed, then crashed `rust-lld` with signal 7
(`SIGBUS`). The first failure occurred while linking `host_ops_v0`; the second
occurred while linking `egress_ambient_v0`. The changing test target and
repeated linker stack establish a hosted-runner resource/concurrency defect,
not a deterministic test assertion or one corrupt test binary.

The workflow already reclaims unused hosted-image toolchains and requires 20
GiB of initial disk headroom. Cargo can nevertheless link multiple large
Snapback/Ibex integration-test harnesses concurrently on the small hosted
runner, multiplying linker mmap, memory, and temporary-file peaks.

**Done when:**

- Canonical local-proof Cargo work is limited to one build/link unit at a time.
- Workflow source tests pin that resource bound so it cannot drift silently.
- The exact PR head completes the remote canonical local proof.

## Implemented; remote verification pending

The `Verify Snapback local proof` workflow step now sets
`CARGO_BUILD_JOBS=1`. This confines the bound to canonical CI while leaving
developer machines and the portable proof script free to use their available
parallelism. `tests/ci_workflows_v0.mjs` requires the bound.

Keep this ticket open until the replacement PR run completes the canonical
proof without a linker crash.
