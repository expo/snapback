# Snapback 4: an Expo app built with Xcode 27 (iOS 27 SDK) traps at launch for missing UIScene lifecycle adoption

**Opened:** 2026-09-30, rehearsing the publication kit's native half on the Apartment 101 M5 Pro mini (Xcode 27.0, iOS 27.0 simulator runtime)
**Severity:** High for any host on Xcode 27: `snapback4 witness ios --build` and the publication kit's native half cannot pass there; not a defect on Xcode 26.6 hosts (the black M5 and the office M1), which is where every published witness has run
**Area:** `snapback4/apps/chat-expo` (the witness app), the `snapback4-expo` scaffold and `snapback4 init --expo` template (iOS project configuration), `snapback4 witness ios --build`, the publication kit (`native.sh`)
**Status:** Closed — lifecycle repair verified on Xcode 27 (2026-10-02); Xcode 26.6 supervisor verification remains unexecuted

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


## X27R reconciliation, 2026-10-02

Local commits `a94c527e1c` and `d7c8c35a59` retain the already published
`snapback4-expo/plugin` on Expo 57.0.22 and add it to `apps/chat-expo`.
The plain scaffold inherits it exactly once; social uses the same entry.
The export and plugin behavior are preserved. LLP 3000.030 §13 records why
the upstream 57.0.23/build-properties alternative was not substituted for
existing pinned consumers. No client/engine or dependency versions changed.

On the dedicated iPhone 17e, Xcode 27A266a / SDK and runtime 27.0:

- The unchanged reference Release product reproduced NoSceneLifecycleAdoption.
- The repaired reference Release product passed offline and restart scenarios,
  including queued writes surviving process termination and settling in order.
- Both fresh generated starters passed `npm run native:smoke`, with all three
  lifecycle segments passing (171.820 s plain, 223.500 s social).
- The same reference chat source, packaged as an inventoried standalone npm app,
  passed `witness ios --build . --smoke` in 114.850 s. The existing adapter
  still rejects the repository Bun workspace; no workspace support is claimed.
- The new named diagnostic identified the actual baseline crash. Producing
  Xcode/SDK fields and matching-crash tests are retained from the unmerged lane.
- The two exact generated dSYM script forms for npm's nested Expo packages
  are admitted; changed/custom scripts remain refused.

No Xcode 26.6 execution is claimed. The supervisor command in
`~/x27r-evidence/verify-xcode26.sh` asserts version 26.6 before building,
then drives the reference scenarios and both generated starters on that
host's dedicated simulator. The complete report is `~/x27r.final.md`.
All raw logs, crash reports, videos and builds are outside git under
`~/x27r-evidence/`; that report indexes each file's SHA-256 and summary.
Passing native manifest SHA-256 values:

- `reference-scenarios/offline-ios-run.json`: `57f3206eb423d02ef43bbd181eb40ae3ce6c878c16180c7f390111ccc2b2ccba`
- `reference-scenarios/restart-ios-run.json`: `381eaaf778812e720c04b734fd7d64658ee830be48be3d715dc6640a56d37791`
- `plain-smoke/smoke-ios-run.json`: `5507082248af00f7bfb573ee757cdc16699958f791dccfa04bd3943548e2bbb6`
- `social-smoke/smoke-ios-run.json`: `880d584408598622125334fe3448098ba5308f4532552022c3c6322dea62f469`
- `chat-build-smoke-2/smoke-ios-run.json`: `a3be6f937c4bb3b1340b1b7ddf9a6976c74ad2b66326495150dd13b048d0f971`

Affected Rust, JS, guide and wasm-budget checks pass. The required complete
suite ran once and reports `== 2 failure(s) in 2601 s`: two replay startup
log assertions and the known browser replacement fixture's SQLite lock error.
The unchanged replay target passed all 22 tests in one isolated follow-up;
the complete-suite red is preserved. Follow-ups live in
`issues/20261002-snapback4-replay-startup-log-observation.md` and
`issues/20261002-snapback4-browser-replacement-fixture-lock-cleanup.md`.
This closure records the demonstrated Xcode 27 lifecycle repair, not a
green complete suite, repository-workspace build-adapter support, or
Xcode 26.6 qualification.
