# LLP 0123 sealing: Linux-native clean-release seal production (CI-owned)

**Status:** Open (gated capability-completeness, not a code defect)
**Filed:** 2026-08-06
**Area:** packages/snapback-runtime-linux-x64, .eas/workflows/qualified-package-staging.yml
**Depends on:** LLP 0123 package sealing (landed `fc00370d7`)

## What is proven

The LLP 0123 package seal is landed and verified:

- **Darwin, end-to-end (real):** clean release build + `prepare-runtime` produced
  a real `runtime-readiness.json` seal carrying the `runtime-qualify.v1 ok:true`
  verdict; the package test proves seal verdict + framework-drift + binary-drift
  + qualification refusal against the real assembled package.
- **Linux, on a real x86_64 host (`expo-build-1000`, EPYC, at the landed commit
  `a77cc2d3a`):**
  - `bootstrap-ibex-runtime` → exact link + launch + **`runtime-qualify.v1
    ok:true`** (the restricted no-eval handler VM is created on Linux — the
    ABI-coherence the seal exists to protect holds on Linux).
  - `cargo build --release --bin snapback` → 85 MB Linux binary (14m32s).
  - `package.test.mjs` → **1/1** (Linux x64 seal verdict + framework-drift +
    binary-drift + qualification refusal — the seal verify/drift/refusal logic).

## What is not yet proven (this ticket)

The real Linux **prepare-runtime** (producing a real Linux seal end-to-end)
refused with:

```
SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED: native runtime was not built
as a clean release public-package artifact; without PackageCapabilityAttestationV1
the package must retain relation/activity GAPs
```

This is a **pre-existing clean-tree gate** (PackageCapabilityAttestationV1),
not a defect in the sealing code. The build stamped `gitDirty:true` because the
shared build box's checkout carried modified vendor submodule pointers and
untracked demo dirs; a public-package artifact must be built from a pristine
tree. The build stamp is compiled in (build.rs), so a clean proof requires a
clean-tree rebuild, which is exactly the release/CI environment's job.

## Resolution path

Produce the Linux seal on a clean checkout via the release pipeline
(`.eas/workflows/qualified-package-staging.yml`, which SEAL already extended to
carry the header digest + qualification verdict), or a fresh clone on a Linux
x86_64 host:

```sh
# on a clean Linux x86_64 checkout at the sealing commit or later
scripts/bootstrap-ibex-runtime
SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build --release --bin snapback
node packages/snapback-runtime-linux-x64/prepare-runtime.mjs   # must succeed, stamp the verdict
node --test packages/snapback-runtime-linux-x64/package.test.mjs
```

## Acceptance

`prepare-runtime.mjs` on a clean Linux public-package build produces a
`runtime-readiness.json` seal binding the Linux binary + Hermes header/library
digests + a real `runtime-qualify.v1 ok:true` verdict, and the package test
passes against that real produced seal (not only the fixture logic).
