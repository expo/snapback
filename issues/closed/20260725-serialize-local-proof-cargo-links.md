# Serialize canonical local-proof Cargo links

**Status:** Closed
**Severity:** P1
**Systems:** CI, Build, Native runtime, Acceptance testing
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-25
**Resolved:** 2026-07-25 in PR #4 (`984b6a06`)
**Related:** LLP 0010 §CI and Review Gates; GitHub Actions runs 30164619469, 30166104010, 30166978366, 30168090088, 30175505320, and 30176335068
**Marker:** ci, linker, github-actions, linux, local-proof

Three canonical `ubuntu-latest` local-proof runs reached Rust linking after the
same preceding proof gates passed, then crashed `rust-lld` with signal 7
(`SIGBUS`). The first failure occurred while linking `host_ops_v0`; the second
occurred while linking `egress_ambient_v0`. Serializing Cargo delayed but did
not eliminate a third failure while linking the normal `snapback` binary. The
changing target and repeated linker stack establish a hosted-runner
link-resource defect, not one corrupt binary.

Run 30168090088 applied both resource bounds, completed every Rust link, and
executed all 1,306 library tests. Its two assertion failures were independently
corrected on `main`; the absence of another linker crash verifies that the
resource mitigation reaches the intended failure mode. The ticket remains open
until the integrated PR head completes the full canonical proof.

The workflow already reclaims unused hosted-image toolchains and requires 20
GiB of initial disk headroom. Cargo can nevertheless link multiple large
Snapback/Ibex integration-test harnesses concurrently on the small hosted
runner, multiplying linker mmap, memory, and temporary-file peaks.

**Done when:**

- Canonical local-proof Cargo work is limited to one build/link unit at a time
  and omits dev/test debug symbols that the proof does not inspect.
- Workflow source tests pin that resource bound so it cannot drift silently.
- The exact PR head completes the remote canonical local proof.

## Resolution

The `Verify Snapback local proof` workflow step now sets
`CARGO_BUILD_JOBS=1`, `CARGO_PROFILE_DEV_DEBUG=0`, and
`CARGO_PROFILE_TEST_DEBUG=0`. This confines the resource bounds to canonical CI
while leaving developer machines and the portable proof script free to use
their available parallelism and debug symbols. `tests/ci_workflows_v0.mjs`
requires all three bounds.

The exact PR head `d453d6bc` completed canonical local-proof run 30175505320
without a linker crash, after multiple preceding integrated heads had done the
same. PR #4 then merged as `984b6a06`, whose push-triggered canonical proof
30176335068 also passed. All repository-owned post-merge workflows were green.
The resource bounds are therefore both mechanically pinned and verified on the
integrated main commit.
