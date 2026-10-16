# EXPOPIN — Expo SDK 57 on Xcode 27.1

Date: 2026-10-16. Branch: `sb4-w13-expopin`, base `6faa0fb9cd`.
No Snapback version bump, push or publication. Candidate packages retain 0.4.29;
Integration 14 owns the 0.4.30 release. Native build/witness source: `d21839d9d7`; final patch-writer followup: `2cd9965ef6` (same emitted shell bytes, tested separately on Linux and Mac).

## Resolution

Move the reference application and every generated Expo manifest (plain, chat,
social) to Expo **57.0.30** / expo-modules-core **57.0.23**, keeping React Native
**0.86.3** and React **19.2.3**. Pin the matching Babel preset **57.0.16** and
fingerprint **0.20.14**; native development dependency core is exact, and its
Expo peer is `>=57.0.30 <58`. Update the independent Snapback 4 Bun lock.
The Rust-generated manifests inherit the reference app; the social generator
uses the same manifest, not another toolchain pin.

The patch upgrade builds cleanly with default Expo precompiled modules on
Xcode 27.1. A 27.1→27.0 control reproduces the upstream JSI cache bug even on
these new pins. The shared published config plugin now adds `xcodebuild -version`
to the upstream source/Swift cache hash during iOS prebuild. The patched script
itself remains an upstream hash input ([pinned source, lines 71–81](./upstream-jsi-cache-source.txt)); adding Xcode identity also changes the hashed data. Pre-patch slices are invalidated once. Repeated prebuild
is idempotent; a missing/nonunique expected anchor refuses before a build.
The patch writer atomically replaces the project script while preserving its mode: the Linux installed script has two hardlinks, and in-place truncation would mutate Bun's cached inode. A hardlinked-alias regression requires the shared original to remain unchanged. Neither Swift/C++ interop mode nor native module APIs are changed. Keep the
scene lifecycle in this same plugin for all three starter families.

The bounded native adapter accepts matching Xcode/iOS simulator SDK 27.0 or
27.1 pairs and still refuses other pairs. Its exact phase allowlist admits the
SDK 57.0.30 npm-nested Constants manifest script; custom appended script text
still refuses. Installed-product Xcode/SDK provenance was already present and
is preserved, separately from selected-host preparation metadata.

Docs: `guide witness`, native package README, published client operations,
generated toolchain README, LLP 3000.030 §13 amendment, append-only journal,
and a 0.4.30 `guide changes` entry. Historical 57.0.22/timing records stay intact.

## Upstream research

`npm-metadata.json` retains the queried registry versions, dist-tags, core
publication timestamps, Expo's selected dependency ranges and RN tags.
At lookup: Expo sdk-57=57.0.30, latest=58.0.12; core sdk-57=57.0.23,
latest=58.0.20; JSI sdk-57=57.1.2, latest=58.0.14; RN 0.86-stable=0.86.3,
latest=0.88.0. SDK 58 was released on October 15; it entails an RN major-line
migration and is not needed for this repair or claimed qualified here.

Read the npm contents and SDK 57 core/JSI changelogs, plus:

- https://github.com/expo/expo/issues/50365 — same-Swift/different-SDK stale JSI slice; closed for missing reproduction, not a published cache-key fix.
- https://github.com/expo/expo/pull/50354 — stabilizes checkout paths in JSI compilation caching; does not add Xcode/SDK identity to SDK 57.1.2's hash.
- https://github.com/expo/expo/issues/46664 — SDK 57 scene lifecycle context (our existing shared scene plugin remains).
- https://expo.dev/changelog/sdk-58 — SDK 58 release notes.
- https://raw.githubusercontent.com/expo/expo/sdk-57/packages/expo-modules-core/CHANGELOG.md

The SDK 57.1.2 package still hashes only the Swift version for toolchain identity.
Its changelog describes earlier compiler fixes, including Xcode 26 compatibility;
it does not announce the SDK-switch repair. We therefore retain the smallest
local cache-identity workaround together with the latest SDK 57 maintenance pin.

## Upstream issue text (prepared, not posted)

Title: ExpoModulesJSI cache needs Xcode build / SDK identity when switching Xcode 27.0 and 27.1

On Apple silicon, Xcode 27.0 (27A266a) and 27.1 (27A9275) report the same Swift
6.4 compiler tags, but have different iOS SDKs. With Expo 57.0.30,
expo-modules-core 57.0.23, expo-modules-jsi 57.1.2 and RN 0.86.3, a clean 27.1
Release build succeeds. Reusing that dependency/native tree under 27.0 fails
with `cannot find type '__ObjC::expo' in scope` in the JSI textual interface;
ExpoModulesCore then fails to import. This matches #50365, now on released Xcode.

Reproduce with a stock SDK 57 app and native dependencies: install, prebuild iOS,
then run `expo run:ios --configuration Release --device generic --no-bundler`
with `DEVELOPER_DIR` selecting 27.1, switch it to 27.0 and repeat. Preserve
node_modules between builds. Both our default-precompiled and prior source-mode
observations point at the incompatible JSI slice, not the application's Rust module.

Expected: switching SDKs rebuilds the JSI slice automatically. Actual: the hash
can reuse it because Swift's version string has not changed. Adding
`echo "XCODE_VERSION=$(xcodebuild -version)"` next to `TOOLCHAIN_VERSION` in
`compute_hash()` makes the 27.0 build succeed and the return to 27.1 rebuild
successfully. The script remains in SOURCE_FILES; retain that source invalidation.
A platform-specific SDK build/path identity could further refine the upstream key.
No upstream message or issue was sent in this workstream.

## Verification

Mac: scratch clone `~/projects/snapback-ws-expopin`; generated consumers and Node 24.13.1 under `~/projects/snapback-ws-expopin-tools`. `/Applications/Xcode.app` is 27.1/27A9275. The older Xcode is selected read-only with DEVELOPER_DIR. No publication worktree is used or modified. The owned iOS 27.1 simulator was removed after completion.

| Check | Result |
| --- | --- |
| Updated reference Release, default precompiled Expo modules, Xcode 27.1 | Passed, zero errors |
| Initial installed publication witness on 27.1 | Offline + restart passed, 27.920 s total |
| Reuse unpatched 27.1 JSI slice under 27.0 | Reproduced upstream import failure |
| Patched prebuild, Release on 27.0 | Passed, zero errors |
| 27.0-produced app on iOS 27.1 runtime | Offline + restart passed, 28.442 s; receipts 27A266a / SDK 27.0 |
| Return patched dependency tree to 27.1 | Release passed, zero errors |
| Final fresh-install reference witness on 27.1 | Offline + restart passed, 32.254 s; receipts 27A9275 / SDK 27.1 |
| Fresh plain `init --expo` | Install/check/typecheck/web export passed; own Release preparation 108.937 s, complete three-segment smoke 128.084 s |
| Fresh `new social --template social` | Install/check/typecheck/web export passed; own Release preparation 198.398 s, complete three-segment smoke 223.792 s |
| Native link/install verification | Built/installed executable SHA-256 equal; built/linked Rust archive SHA-256 equal |
| Mac package, preparation and witness tests, final fixture | 30/30 passed (including real hardlink, mode, idempotence and actual upstream hash function) |
| Linux affected Expo/preparation tests | 24 passed, 1 macOS-only skip; final focused scene/preparation tests 16/16 |
| Rust init | Initial 49/50; obsolete expected Babel pin corrected, affected rerun 1/1 passes |
| Full guide target | 125/125 passed |
| Full client seeded models | 81/81 passed |
| Docs budget | 320/320 README lines; named self-containment test passes |
| ref-check | 548 LLPs, zero errors/unchecked |
| Root Bun/hoist setup | Passed |
| Initial consumer-only qualification at d21839d9d7 | 12 frontend proofs, 6 starter proofs, Ubuntu 24.04 (292.520 s) and Alpine (451.621 s) passed |
| Canonical 398-file pool terminal result | 398/398 processed; 7,511 pass / 1 fail / 56 skip. Sole failure: obsolete scene VM mock; corrected full-file rerun 8/8 passes. No additional failures. The original pool exit remains failed. |
| Final consumer-only qualification at 2cd9965ef6 | Passed: 12 frontend proofs, 6 starters, Ubuntu 24.04 284.167 s / Alpine 395.601 s |

`consumer-only` deliberately runs no complete test.sh and emits no publication receipt; its record states `publicationQualified: false`. The new pack is prepared through `publish.mjs --prepare-client`, not an ad-hoc client pack. The final client tarball is byte-identical to the earlier candidate; the Expo tarball changes only for the safe patch writer. The final consumer proof binds both exact package integrities and the production Linux binary. No version is bumped and nothing is published. The sole diff-check diagnostic is an extra EOF blank line in the verbatim final Muse response; it is preserved as requested, with no source-code whitespace issue.

Native source proof and the final writer-only followup are distinguished above. The replacement writes precisely the same upstream shell transformation already built in both Xcodes; the final regression normalizes a private copy and exercises that actual writer with a hardlinked cache alias on both OSes. No native compiler input or runtime API changes in the followup. No new timing qualification, warm export-cache audit, SDK 58 or physical-device claim is made.

## Attempts and inherited checks

All attempts are retained separately; no failed record is relabeled green.

- The first fresh-clone bundling attempt preceded generated chat API creation; generate the API, then the reference build passes.
- An unsupported iPhone 17 / iOS 27.1 simulator pairing refused; this runtime supports iPhone Duo. Only the owned Duo simulator was subsequently used.
- The original updated dependency tree reproduces the 27.0 SDK-switch failure. The cache-key repair resolves it, including the return to 27.1.
- The first bounded plain preparation refuses the changed Constants phase before compilation. Only its measured hash is then admitted; the custom-script rejection regression remains.
- The first Mac cache-hash test used an empty Bash array, incompatible with Bash 3 under nounset; its real-source fixture is corrected. The final writer test also strips our own prior patch from a copied script so it must actually exercise the patch writer on every host.
- A witness invocation refused a busy owned simulator lease; after the starter finished, a return witness's restart completed its scenario but timed out stopping an owned process. A fresh install after reboot passes both segments. Both failures remain in evidence.
- The final canonical pool catches a legacy scene VM mock lacking `withDangerousMod`. Production hooks and real prebuild already pass. Update only that registration mock (retain real Node builtins); isolated witness tests pass 8/8. The original pool record remains a failure rather than being relabeled.
- The initial recursive client run includes five fixture leaves beyond the canonical set (403/403 files; three failed). Two imports lack the generated event-slot trace: run its Rust producer (2/2 pass), then both files pass 48/48. A route fixture times out under contention and passes isolated 13/13. The final run uses the canonical flat 398-file discovery, unchanged test counts/guards, and 12 pool slots before isolated timer files. Full seeded models keep their complete counts.
- `--prefer-offline` initially uses stale npm abbreviated metadata and refuses the real Babel 57.0.16 pin. `npm view` and a private fresh-cache install confirm it exists. Requalification uses an isolated cache with prefer-online; no shared cache is deleted or registry pin downgraded.
- Repo-root caps reports 13 inherited violations (96 current documents vs 59, 216 oversized source files vs baseline 204); this stream adds no LLP number/current link or oversized source. Inventories reports missing generated Snapback 1 demo and Exact/Contract leaves. Root setup was performed first. These unrelated fences and corpus repairs are not reported green or silently changed.

The initial native stage rebuilt the Rust xcframework with Xcode 27.1. Both Xcode apps subsequently link that same archive. Final scoped Cargo verification uses the requested no-incremental/no-debug profiles. Linux wasm remains 2,353,736 B raw / 716,714 B gzip against 717,214; no budget is raised.

## Review and disposition

The canonical pool has terminated; its one obsolete mock is corrected and its full eight-case rerun passes. Final independent reviews are **READY**: [Codex round 2](../../../llp/reviews/3000.030-expopin-r2.codex.md) and [Muse round 3](../../../llp/reviews/3000.030-expopin-r3.muse.md). Both inspect the terminal pool and corrected-file evidence; the retained pool exit is never relabeled. Earlier raw review replies and provenance are retained under llp/reviews. The test-only followup `526e4042ce` fixes the legacy scene VM mock; its isolated rerun passes 8/8 and changes no published artifact bytes. The [ticket is resolved](../../../issues/closed/20261016-snapback4-expo-sdk-57-does-not-build-on-xcode-27.1.md). Integration 14 owns versioning, integration qualification and publication. Historical 0.4.29 scripts selecting the older Xcode are records; the tested commands use current `/Applications/Xcode.app` and require no 27.0 publication override.


## Reproduction commands

Use the pinned Node 24.13.1 and the workstream's scratch checkout. The reference
backend API must exist before Metro bundling:

```sh
cd ~/projects/snapback-ws-expopin/snapback4
(cd apps/chat && ../../target/debug/snapback4 check)
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
(cd apps/chat-expo && CI=1 EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:44442 node ../../node_modules/expo/bin/cli run:ios --configuration Release --device generic --no-bundler --output ../../target/expo-release)
EXPOPIN_UDID=$(xcrun simctl create sb4-expopin-recheck com.apple.CoreSimulator.SimDeviceType.iPhone-Duo com.apple.CoreSimulator.SimRuntime.iOS-27-1)
xcrun simctl boot "$EXPOPIN_UDID"
xcrun simctl bootstatus "$EXPOPIN_UDID" -b
xcrun simctl install "$EXPOPIN_UDID" target/expo-release/Snapback4chat.app
WITNESS_UDID="$EXPOPIN_UDID" WITNESS_PORT=44442 WITNESS_ARTIFACTS="$PWD/target/expopin-recheck" node witness/expo.mjs
xcrun simctl shutdown "$EXPOPIN_UDID"
xcrun simctl delete "$EXPOPIN_UDID"
```

For the SDK-switch control, select
`DEVELOPER_DIR=$HOME/Applications/Xcode-27.0.app/Contents/Developer`, run iOS
prebuild and the same Release command with a separate output directory, then
return to `/Applications/Xcode.app`. Do not modify either Xcode installation.
The owned simulator from this report is deleted; its historical UDID cannot be reused.

Fresh consumers install the prepared local client and Expo tarballs, with the
matching platform package, then run `check`, `npm run typecheck`,
`expo export -p web`, and the current CLI's
`witness ios --build . --smoke --udid <owned-udid> --artifacts <fresh-directory>`.
For private preparation, consumer manifest versions are ordinary 0.4.29 strings;
the installed lock retains the candidate tarball paths and integrities. This is
a locally staged candidate, not the different published registry bytes at that version.

```sh
cd snapback4
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/publish.mjs --prepare-client
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.excludesFile GIT_CONFIG_VALUE_0=/tmp/expopin-git-ignore npm_config_cache=$PWD/target/expopin-npm-cache npm_config_prefer_online=true CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/qualify-linux.mjs --client target/publication/client-0.4.29/snapback4-0.4.29.tgz --expo target/publication/client-0.4.29/snapback4-expo-0.4.29.tgz --out target/expopin-linux-consumer-qualified --consumer-only
```

The process-local excludes file only hides the client tests' generated
`.social-*` and `.rg-matrix-*` scratch directories during concurrent proof;
it hides no maintained source. Choose fresh output directories and preparation
stages for a new run; existing source-bound stages are intentionally not overwritten.
The full `scripts/test.sh` was never invoked.
