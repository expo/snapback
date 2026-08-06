# Darwin runtime seal names a framework symlink npm does not install

**Status:** Closed
**Filed:** 2026-08-06
**Resolved:** 2026-08-06
**Systems:** Darwin runtime package, Runtime readiness, npm publication,
Cold-install proof
**Governing:** LLP 0123 §Package seal landing

## Defect

The Darwin runtime package was sealed before `npm pack` with this artifact:

```text
Frameworks/hermesvm.framework/hermesvm
```

That path was a framework convenience symlink resolving to
`Versions/1/hermesvm`. npm did not preserve the symlink. A fresh install
contained only the real versioned runtime and `Info.plist`, so
`verifyRuntimePackageSeal` classified every installed Darwin package as
`SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID`, reason `framework-drift`, before the
CLI could return its runtime binary.

The staged cold-install harness already installs materialized npm tarballs and
would have refused at its packaged-doctor step. It did not protect this landing
because it was not rerun after the new seal was added; the publish dry run only
sealed the pre-pack source layout and did not reopen the serialized package.

## Root cause

The receipt chose a conventional framework alias instead of the artifact the
runtime actually loads. `otool -L target/release/snapback` records:

```text
@rpath/hermesvm.framework/Versions/1/hermesvm
```

`otool -l` records `@loader_path/../Frameworks` as the package-relative
`LC_RPATH`. The real `Versions/1/hermesvm` file is therefore the loader contract
and the npm-delivered artifact. The missing top-level symlink was not a dyld
load failure; it was receipt-path drift.

## Resolution

- Darwin package production stages only the real `Versions/1` framework tree,
  matching the symlink-less npm install layout before qualification runs.
- Seal production and consumption both bind
  `Frameworks/hermesvm.framework/Versions/1/hermesvm`; bytes and SHA-256 remain
  those of the same physical Hermes binary.
- Runtime-readiness, CLI-package, and Darwin-package tests prove that removing
  the pre-pack convenience symlink stays coherent while changing the versioned
  runtime still refuses as `framework-drift`.
- `snapback-publish.mjs` extracts each runtime `npm pack` tarball and reopens
  its package seal, preventing a pre-pack-only path from reaching a ledger.
- The staged cold-install path remains tarball/materialized-install based; no
  path-directory install or symlink-preserving extraction bypass was present.

## Verification

Verified on 2026-08-06:

- focused runtime-readiness, CLI-package, and Darwin-package tests pass;
- `node scripts/snapback-publish.mjs --runtime-platforms host` produces the
  full dry-run closure and reopens the extracted Darwin tarball seal;
- a fresh `npm install` of those eight tarballs contains only the versioned
  framework files, and the installed receipt names the same versioned runtime;
- with `DYLD_FRAMEWORK_PATH` and `DYLD_LIBRARY_PATH` removed, the installed
  CLI's `snapback dev x/snapback --no-watch` reaches `generated-and-loaded`,
  listens on `127.0.0.1:4287`, and reports the installed Darwin runtime as its
  selected binary; and
- `./ref-check --verbose` passes.
