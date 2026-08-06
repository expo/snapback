# The attested Hermes bundle is deleted by a static-archive gate Snapback does not need

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Progress:** Not started
**Severity:** P2
**Systems:** Developer experience, Runtime
**Author:** Claude (Opus 5), building demos/eas-payments
**Date:** 2026-08-06
**Related:** scripts/bootstrap-ibex-runtime, vendor/ibex/scripts/build-hermes.sh, vendor/ibex/scripts/download-hermes.sh, LLP 0010, LLP 0018, diaries/0066-eas-payments-engine-slice.diary.md

On a macOS machine with only Xcode Command Line Tools,
`scripts/bootstrap-ibex-runtime` cannot produce a runtime, even with an
authenticated `gh` that can download the attested prebuilt bundle.

## What happens

1. `download-hermes.sh` downloads
   `hermes-macos-arm64-e639a7bad8bf-debug-...-oapple.tar.gz`, verifies its
   GitHub build provenance, verifies the checksum, verifies the patched
   `ex_hermes_vm_current_package_id` export, and installs it into the build
   cache. All of this succeeds.
2. `build-hermes.sh` then evaluates its cache-hit condition, which requires
   **both** `hermesvm.xcframework/` and `macos-static/`. The published bundle
   has no `macos-static/`, so the condition fails.
3. The next branch reads:

   ```
   if [ -d "$VERSION_CACHE/hermesvm.xcframework" ]; then
       echo "[!] Cached Hermes bundle predates the static-stub archive set; rebuilding it"
       rm -rf "$VERSION_CACHE"
   fi
   ```

   The freshly verified bundle is deleted.
4. The source build then fails: it configures `iphoneos`, `iphonesimulator`,
   and `macosx` and finishes with `xcodebuild -create-xcframework`, all of
   which need full Xcode. With Command Line Tools only, the `iphoneos`
   configure dies at `ld: library 'System' not found`.
5. Bootstrap exits `SNAPBACK_IBEX_HERMES_DOWNLOAD_FAILED`, naming both causes
   correctly.

## Why this is wrong for Snapback specifically

Snapback links the **dynamic** `hermesvm.framework` (`build.rs` emits the
`LC_RPATH`). The bootstrap's own completeness check, `has_darwin_artifacts`,
requires exactly `hermes-headers/hermes/hermes.h`,
`hermes-headers/jsi/jsi.h`, a macOS `hermesvm.framework`, and `hermesc`. It
never looks at `macos-static/`.

So the published bundle **is** complete for this repository. The gate that
rejects it belongs to a different Ibex consumer (static/SFE linking). The
result is that Snapback's supported no-Xcode path is closed by a requirement
Snapback does not have.

## Workaround used (not committed)

Stage the attested bundle into a prepared-peer layout and use the bootstrap's
own supported `SNAPBACK_IBEX_CHECKOUT` path. Every verification the vendored
downloader performs was reproduced on the staged copy: `gh attestation verify`
with the same `--repo`, `--signer-workflow`, `--source-ref`, and
`--deny-self-hosted-runners`; the release checksum sidecar; the patched-engine
export; a runnable `hermesc`; and the profile receipt binding the reviewed
source cache key. No fence was lowered and nothing was committed — but a
contributor should not have to reconstruct this.

## Candidate fixes

1. **Publish `macos-static/` in the Apple bundle** so the existing cache-hit
   path accepts it. Correct upstream fix; needs an `expo/ibex` release change.
2. **Split the cache-hit condition** so a bundle without `macos-static/`
   installs the dynamic framework, headers, and `hermesc`, and only consumers
   that need static archives treat its absence as a miss. Keeps the attested
   bundle usable for every consumer that does not link statically.
3. **Let `bootstrap-ibex-runtime` install a verified bundle directly**, rather
   than delegating to `build-hermes.sh`'s cache-hit path, since it already
   knows the exact artifact set Snapback requires.

(2) or (3) unblocks macOS contributors without an `expo/ibex` release. (1) is
the durable fix.

## Adjacent friction found on the same clean machine

- `packages/snapback-codegen` needs `acorn`; without `bun install` the failure
  is a bare Node `ERR_MODULE_NOT_FOUND` that does not mention `bun`.
- `bun install --frozen-lockfile` fails against the committed `bun.lock` on
  this checkout, and a plain `bun install` rewrites ~900 lines of it. A
  first-time contributor following the obvious path lands unrelated lockfile
  churn in their first PR.
