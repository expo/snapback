# Snapback 4: the pinned Expo SDK (57.0.22) does not build on Xcode 27.1 / iOS 27.1 SDK

**Status:** Open
**Date:** 2026-10-16
**Scope:** Snapback 4 `apps/chat-expo` Expo native witness, `snapback4-expo` qualification, Expo starters
**Owner:** Unassigned

## Observation

On the black M5, `/Applications/Xcode.app` updated itself from Xcode 27.0 (27A266a)
to **Xcode 27.1 (27A9275)** on 2026-10-15 20:30 PDT. The 0.4.29 publication's Expo
native witness then failed at the Release build of `apps/chat-expo`
(`expo run:ios --configuration Release --device generic`, Expo **57.0.22**,
expo-modules-core **57.0.18**, React Native **0.86.3**):

With Expo's default precompiled modules (`EXPO_USE_PRECOMPILED_MODULES=1` from the
generated Podfile):

```
❌  failed to build module 'ExpoModulesCore'; this SDK is not supported by the compiler (the SDK is built with 'Apple Swift version 6.3.1 (swiftlang-6.3.1.1.2 clang-2100.0.123.102)', while this compiler is 'Apple Swift version 6.4 (swiftlang-6.4.0.34.1 clang-2100.3.34.1)')
❌  cannot find type '__ObjC::expo' in scope
❌  failed to build module 'ExpoModulesJSI' for importation due to the errors above; the textual interface may be broken by project issues or a compiler bug
   └─[app]/XCFrameworkIntermediates/ExpoModulesCore/ExpoModulesCore.framework/Modules/ExpoModulesCore.swiftmodule/arm64-apple-ios-simulator.private.swiftinterface:13:19
› 15 error(s)
CommandError: Failed to build iOS project. "xcodebuild" exited with error code 65.
```

With Expo modules built from source (`EXPO_USE_PRECOMPILED_MODULES=0`, regenerated
`ios/`):

```
❌  cannot find type '__ObjC::expo' in scope
❌  failed to build module 'ExpoModulesJSI' for importation due to the errors above; the textual interface may be broken by project issues or a compiler bug
   └─node_modules/expo-modules-core/ios/Core/Arguments/AnyArgument.swift:3:8
› 4 error(s)
```

The same project builds and the witness passes with Xcode 27.0 (27A266a), copied
from `macstudio-charlie-apt101-a` to `~/Applications/Xcode-27.0.app` and selected
with `DEVELOPER_DIR` for the 0.4.29 witness. Both Xcodes report the same Swift
compiler string (`swiftlang-6.4.0.34.1 clang-2100.3.34.1`), so the failure follows
the 27.1 SDK / Clang module headers: the `__ObjC::expo` C++-interop lookup in
`ExpoModulesJSI` breaks there whether the modules are precompiled or built from source.

Our own native archive (`scripts/build-xcframework.sh`, Rust static libraries) builds
on 27.1, and an app built with 27.0 links and runs it (0.4.29 `native-link-verification`).

Evidence: `snapback4/reports/20261015-publication-0.4.29/` —
`attempt-3-expo-release-build.log`, `attempt-4-expo-release-build.log`,
`native-attempt3-xcode271-expo/`, `native-xcode271.sh`, `native-xcode270.sh`, and
`../20261015-expo-0.4.29/qualified.json` → `toolchainProvenance`.

## Impact

Any Expo developer on Xcode 27.1 with Expo SDK 57.0.22 cannot build iOS, independent
of Snapback. Our publication qualification currently depends on keeping Xcode 27.0
beside 27.1 on the publication host.

## Needed for 0.4.30

Move the workspace/app/starter Expo pin to an Expo SDK 57 patch (or the next SDK)
whose `expo-modules-core`/`ExpoModulesJSI` and precompiled XCFrameworks build with
the Xcode 27.1 SDK; update `bun.lock` and the starter templates; then qualify the
Expo witness with `/Applications/Xcode.app` 27.1 (and keep a 27.0 run if older Xcode
support is claimed). Drop the `~/Applications/Xcode-27.0.app` override from the
publication kit once 27.1 passes.
