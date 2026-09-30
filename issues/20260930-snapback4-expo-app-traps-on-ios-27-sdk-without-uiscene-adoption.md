# Snapback 4: an Expo app built with Xcode 27 (iOS 27 SDK) traps at launch for missing UIScene lifecycle adoption

**Opened:** 2026-09-30, rehearsing the publication kit's native half on the Apartment 101 M5 Pro mini (Xcode 27.0, iOS 27.0 simulator runtime)
**Severity:** High for any host on Xcode 27: `snapback4 witness ios --build` and the publication kit's native half cannot pass there; not a defect on Xcode 26.6 hosts (the black M5 and the office M1), which is where every published witness has run
**Area:** `snapback4/apps/chat-expo` (the witness app), the `snapback4-expo` scaffold and `snapback4 init --expo` template (iOS project configuration), `snapback4 witness ios --build`, the publication kit (`native.sh`)
**Status:** Open; owner is whoever next touches the Expo scaffold or the native witness (lanes NP/NS ran on this mini and their smoke also exits 1)

## What happens

`apps/chat-expo` built with `expo run:ios --configuration Release` under Xcode 27.0 installs and launches on an iOS 27.0 simulator, then dies in under a second with `EXC_BREAKPOINT (SIGTRAP)`, "Trace/BPT trap: 5", before the witness receives its priming receipt (`E_WITNESS_APP: owned app exited or was replaced while awaiting its receipt`). The crash report's faulting thread:

```
UIKitCore ___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke
libdispatch.dylib _dispatch_client_callout
libdispatch.dylib _dispatch_once_callout
UIKitCore -[UIApplication workspace:didCreateScene:withTransitionContext:completion:]
UIKitCore -[UIApplicationSceneClientAgent scene:didInitializeWithEvent:completion:]
FrontBoardServices __95-[FBSScene _callOutQueue_didCreateWithTransitionContext:…]
```

UIKit on the iOS 27 SDK evaluates scene-lifecycle adoption at scene creation and traps when the app still uses the application-delegate-only lifecycle. The same app built on Xcode 26.6 (iOS 26.5 SDK) runs; every passing witness record in `snapback4/reports/` came from a 26.x host. A manual `xcrun simctl launch` on the mini reproduces the exit within six seconds. Crash report: `~/Library/Logs/DiagnosticReports/Snapback4chat-2026-09-30-005903.ips` on the mini.

## Consequences

- The publication kit's native half (`native.sh`: xcframework, Expo release build, simulator install, witness) must run on an Xcode 26.x host until this is fixed. The mini stays a dry-run and test host (its full suite passes under the pinned Node 24; its builds are three to five times faster than the M1's).
- A builder on a current Xcode will hit this the moment it tries the native proof, which the calibration already scores as unverified.

## Fix

Adopt the UIScene lifecycle in the Expo scaffold and the witness app (a `UISceneDelegate` with `UIApplicationSceneManifest` in `Info.plist`), or pin the scaffold's Expo SDK to a version that does, then re-qualify `witness ios --build` on both Xcode 26.6 and 27.0 and record both in the witness receipts (`runtime`, Xcode build). Until then, `witness ios --build` should refuse with a named diagnostic on an iOS 27 SDK rather than reporting a generic `E_WITNESS_APP`, and the kit's `native.sh` should assert `xcodebuild -version` is 26.x.
