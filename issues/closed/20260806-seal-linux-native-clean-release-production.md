# LLP 0123 sealing: Linux-native clean-release seal production (CI-owned)

**Status:** Closed (resolved 2026-08-07)
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

## Resolution (2026-08-07)

Produced the real Linux x64 seal end-to-end on a **pristine** checkout via the
committed wrapper `scripts/build-linux-runtime-release` (landed `378aabd80`).

- **Host:** `expo-build-1000` (AMD EPYC, 96-core, Ubuntu 24.04, cargo 1.96.1,
  node v24.13.1, bun 1.3.14).
- **Checkout:** fresh clone at `~/projects/snapback-seal-20260807`, HEAD
  `06a62a02601a720c83072f4fe4f4c5eff296542c` (pristine;
  `git status --porcelain --untracked-files=all` empty before build and after
  package preparation — the script's own gates enforced both).
- **Bootstrap:** ~2.5 min (prepared sibling `~/projects/ibex` artifacts; no
  Hermes-from-source). Release build: 15m15s
  (`SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build --release`).
- **prepare-runtime.mjs succeeded** — the
  `SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED` refusal is gone because
  the build identity now stamps `gitDirty:false` +
  `buildDistribution:"public-package"`.

Real seal (`packages/snapback-runtime-linux-x64/runtime-readiness.json`,
`snapback.runtime-readiness.v1`, sha256
`671a113160f3be388fdc78680513391ab4447b6228b055a2436515e28ff415e8`):

- binary 89043328 bytes, sha256
  `0d1085b4f80bd25b3f09eba63ba18768eefb76e73b4695b6adfd8f894a5e0024`
- `lib/libhermesvm.so` sha256
  `d1bde2b2912ff3b71a30328813b0b2477ef03c08657dc18fd309854615f35d5d`
- `include/hermes/hermes.h.artifact` sha256
  `4327ff32a1d4b68fabee775055660118fede4deeac7b88ddc6edf587b8b2a354`
- qualification: `snapback.runtime-qualify.v1`,
  probe `restricted-no-eval-handler-vm`, **`ok: true`**, binary identity
  `gitDirty:false` / `release` / `public-package` at the same commit.

Attestation (`snapback.runtime-artifact-attestation.v2`, sha256
`fdc157748be40b364b1c6957eb8a048899198462977a2fd9939870bd12c06aba`) binds the
same three artifact digests + source revision + the `ok:true` qualification
verdict.

**Acceptance met:** `node --test
packages/snapback-runtime-linux-x64/package.test.mjs` against the real
assembled package: **1/1 pass** — "Linux x64 seal verdict + framework-drift +
binary-drift + qualification refusal pass". (One environmental note: the
fresh clone needed `bun install --frozen-lockfile` first — the test imports
`packages/snapback-cli` which resolves `@expo/snapback-client` from workspace
node_modules; install leaves the tree clean.)

Release artifacts + `SNAPBACK_RUNTIME_LINUX_X64_*` export lines are on the
host at `~/snapback-staging/linux-seal-20260807/`; the clean clone at
`~/projects/snapback-seal-20260807` is left in place for future release
builds. Closing.
