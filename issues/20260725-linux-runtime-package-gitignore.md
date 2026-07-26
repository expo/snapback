# Linux runtime package artifacts are untracked, dirtying the tree and blocking publish

**Status:** In Progress (2026-07-26; source hygiene fixed, clean-Linux proof pending)
**Severity:** P2
**Systems:** Build, Release, CI, Native runtime
**Author:** Claude (Opus 5), directed by Charlie Cheever
**Date:** 2026-07-25
**Related:** LLP 0041 §runtime-distribution; PR #4 (`984b6a06`);
`packages/snapback-runtime-linux-x64/`, `scripts/verify-local-proof`,
`scripts/snapback-publish.mjs`
**Marker:** build, release, gitignore, linux, local-proof

`packages/snapback-runtime-darwin-arm64/` carries a `.gitignore` containing
`/bin/` and `/Frameworks/` so its `prepare-runtime.mjs` output never enters the
working tree. The new `packages/snapback-runtime-linux-x64/` added in this
tranche has no `.gitignore`, and no root rule covers it:

    $ git check-ignore -v packages/snapback-runtime-linux-x64/bin/snapback \
                          packages/snapback-runtime-linux-x64/lib/libhermesvm.so
    exit=1                      # not ignored

    $ git check-ignore -v packages/snapback-runtime-darwin-arm64/bin/snapback
    packages/snapback-runtime-darwin-arm64/.gitignore:1:/bin/   ...

`prepare-runtime.mjs` writes `bin/snapback` (release binary) and
`lib/libhermesvm.so` into that directory. Three paths now run it:

- `scripts/verify-local-proof` runs it unconditionally on Linux (the new
  `runtime_binary` staging block) so the CLI proofs exercise the packaged
  loader-relative RUNPATH;
- `.github/workflows/linux-runtime-package.yml` runs it directly;
- `npm prepack` runs it during staging.

Consequences:

1. After the canonical local proof on Linux the working tree is dirty with two
   untracked binary artifacts.
2. `scripts/snapback-publish.mjs` gates a real publish on
   `sourceDirty()` = `git status --porcelain`, which counts untracked files. A
   real `--publish` run after the canonical proof on the same machine therefore
   refuses unless the operator passes `--allow-dirty` — which is the flag that
   exists to bypass exactly this safety check.
3. A release binary plus a Hermes shared object are one `git add -A` away from
   being committed.

## Proposed fix

Add `packages/snapback-runtime-linux-x64/.gitignore` containing `/bin/` and
`/lib/`, mirroring the darwin sibling. Confirm with `git check-ignore` and
re-run `scripts/verify-local-proof` on Linux to confirm the tree stays clean.

## Related, lower priority

`scripts/snapback-publish.mjs` requires `--runtime-platforms all` for a real
publish, and its usage text says "Cross-host release assembly supplies explicit
runtime artifact paths to each platform package's prepare script". But the
script has no flag for those paths — it invokes `node prepare-runtime.mjs` with
the ambient environment, so the only way to supply them is by exporting
`SNAPBACK_RUNTIME_LINUX_X64_SOURCE_BINARY` and
`SNAPBACK_RUNTIME_LINUX_X64_HERMES_LIBRARY` out of band. Running
`--publish --runtime-platforms all` on a darwin host without that setup fails
in `stage()` with `SNAPBACK_IBEX_HOST_UNSUPPORTED`. Either document the env
contract in the usage text or add explicit flags.

## Progress (2026-07-26)

The package now mirrors the Darwin package's source hygiene with a
package-local `.gitignore` containing `/bin/` and `/lib/`.
`packages/snapback-runtime-linux-x64/package.test.mjs` pins those exact rules,
so removing or widening the native-output boundary fails the maintained package
test. Local source checks confirm that Git ignores both generated paths while
the package manifest, preparer, package test, and `.gitignore` remain source
files.

The clean-Ubuntu end-to-end gate remains outstanding. This macOS worktree
cannot prove that `scripts/verify-local-proof` prepares the Linux closure and
leaves the tree clean, nor that the packaged binary launches with
`LD_LIBRARY_PATH` absent. Keep this ticket open until the remote Linux workflow
retains that evidence. The lower-priority cross-host publisher flag/usage
question above also remains outside this fix.
