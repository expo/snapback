# Linux runtime CI builds a release binary without its source-custody readiness receipt

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** Linux runtime, Packaging, Runtime readiness, CI
**Date:** 2026-08-15
**Governing:** LLP 0010 §Native Runtime Bootstrap; LLP 0041 §Runtime distribution; LLP 0123 §Package seal landing
**Related:** `.github/workflows/linux-runtime-package.yml`,
`packages/snapback-cli/runtime-readiness.mjs`,
`packages/snapback-runtime-linux-x64/package.test.mjs`

## Problem

The `linux-runtime-package` workflow at `main`
`a93a11235f94ac40077c8f8f3c6d420f40a9bde7`
([run](https://github.com/expo/snapback/actions/runs/31918029849)) builds the
`public-package` release binary and successfully prepares the staged Linux
runtime package, but its package test then resolves the linked CLI through the
source-checkout custody path and refuses:

```text
SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID
no persisted runtime readiness receipt exists for
target/release/snapback; the binary has not been handler-VM qualified since it
was built
```

The sequence is internally inconsistent:

1. `scripts/bootstrap-ibex-runtime` qualifies the debug checkout binary.
2. The workflow builds a new `target/release/snapback` with
   `SNAPBACK_BUILD_DISTRIBUTION=public-package`.
3. `prepare-runtime.mjs` qualifies and seals the copied final package layout.
4. `package.test.mjs` also exercises source-checkout runtime resolution, whose
   LLP 0010 contract correctly requires the distinct sibling receipt
   `target/release/snapback.runtime-readiness.json`.

The package-owned seal and source-checkout sibling receipt are separate custody
records under LLP 0123. A valid package seal must not be copied or treated as a
substitute for a missing source receipt.

## Desired outcome

Make the workflow and test custody explicit. If the test intentionally
exercises source-checkout resolution, qualify the exact release binary and
issue/reopen its sibling receipt after the release build and before that
resolution. If the test intends to exercise installed-package resolution, make
it consume the staged sealed package instead and retain a separate negative and
positive test for source resolution. Do not weaken `resolveSourceCheckoutRuntime`
or permit receipt-free source binaries.

## Acceptance

- A clean Linux x64 workflow run passes `linux-runtime-package` through package
  preparation, package tests, packing, cold install, and evidence upload.
- Every source-checkout resolution of `target/release/snapback` first verifies
  a digest-coherent sibling `snapback.runtime-readiness.v1` receipt issued
  after that exact build.
- Installed-package resolution continues to reopen the package-owned seal and
  never accepts a source-custody receipt in its place.
- Missing, stale, rebuilt-binary, and Hermes-drift receipts still fail with
  `SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` and the existing narrow repair
  command.
- The workflow retains loader-relative qualification with `LD_LIBRARY_PATH`
  absent for the final package layout.

## Fix landed, awaiting CI verification (2026-08-15)

Chose Desired outcome (a): the Linux workflow now issues and immediately
reopens the ordinary sibling source-custody receipt for the exact freshly built
`target/release/snapback` before package preparation or tests. It first stages
the exact bootstrapped Hermes library at `target/lib/libhermesvm.so`, so that
qualification uses the release binary's `$ORIGIN/../lib` loader path with
`LD_LIBRARY_PATH` absent. This preserves the LLP 0010 linked-source contract
instead of bypassing an intentional source resolution exercise. Package
preparation still copies the binary into its final loader-relative layout,
qualifies that distinct layout with `LD_LIBRARY_PATH` scrubbed, and issues the
separate package-owned seal required by LLP 0123.

Files changed:

- `.github/workflows/linux-runtime-package.yml` splits release build, source
  qualification/reopening, and sealed-package preparation/testing into ordered
  steps.
- `packages/snapback-runtime-linux-x64/package.test.mjs` now names both custody
  assertions explicitly: the repository-linked CLI selects the receipted
  release binary, while an installed-CLI topology selects the staged package
  only after reopening its package seal.
- `tests/ci_workflows_v0.mjs` pins build → source-receipt issue → source-receipt
  verify → package preparation → package test ordering and the exact release
  binary/issuer.
- This ticket records the custody choice, local evidence, and remaining Linux
  CI proof without closing ahead of that proof.

Verified locally on macOS:

- `bun run test` in `packages/snapback-runtime-linux-x64`: passed the
  cross-platform synthetic ELF portability, attestation v3, seal, and
  non-destructive staged-assembly suite. The final native Linux payload block
  was darwin-inapplicable because no prepared Linux `bin/snapback` or
  `lib/libhermesvm.so` was present.
- `node --test tests/runtime_readiness_receipt_v0.mjs`: 8/8 passed, including
  absent, malformed, unqualified, stale/rebuilt-binary, and Hermes-drift
  refusal coverage under `SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID`, plus the
  narrow live-qualification issuance command.
- `node tests/ci_workflows_v0.mjs`: passed.
- PyYAML parsed `.github/workflows/linux-runtime-package.yml` as a 13-step
  workflow.
- `./ref-check --verbose`: passed with 0 errors and 0 unchecked references.

Deferred to the next clean Linux x64 CI run: executing the new source
qualification/reopening step against the real public-package release ELF,
exercising both source and package resolution with real Hermes bytes, packing
the closure, cold installation/doctor/dev proof, and evidence upload. The
ticket remains open until that workflow completes.

## Resolution (2026-08-15)

Fix landed at `68eee7986` (workflow qualifies the exact
`SNAPBACK_BUILD_DISTRIBUTION=public-package` release binary and issues/reopens
its sibling source-custody receipt via the existing
`runtime-readiness.mjs issue`/`verify` entry points before package
preparation; `package.test.mjs` exercises source-checkout and
installed-package resolution as separate custody paths;
`ci_workflows_v0` pins the build → loader closure → receipt issue → verify →
prepare/test ordering).

CI proof: dispatch run
[31924683184](https://github.com/expo/snapback/actions/runs/31924683184)
(branch `ci/linux-receipt-proof-20260815`, pinned at `1c05bba66`) advanced
through release build, qualification, receipt issue+verify, package
preparation, package tests, and packing with no
`SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` — the refusal this ticket is about is
gone. The run then failed in a later suite on a distinct, pre-existing defect
(stale committed comparator receipt), filed separately as
`issues/20260815-comparator-receipt-stale-generated-digests.md` per the
LLP 0189 distinct-signature rule.
