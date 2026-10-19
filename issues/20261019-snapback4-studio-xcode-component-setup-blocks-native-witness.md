# Snapback 4: Studio Xcode component setup blocks the Integration 18 native witness

Status: Open
Date: 2026-10-19
Scope: Mac Studio development infrastructure / 0.4.34 native qualification

Integration 18 used only `ccheever@macstudio-charlie-apt101-a:~/sb4-ws-integ18`.
The host currently reports macOS27.0.1 (26A434), Xcode27.1 (27A9275), rather
than the27.0 listed in the task. No alternate Xcode is installed.

`xcrun simctl list runtimes -j` prints “Install Started” then “Install Failed:
Authorization is required to install the packages” and times out at120 seconds.
Direct simctl also times out. `xcodebuild -checkFirstLaunchStatus` exits69.
`sudo -n -l` exits1 with “a password is required”. No credentials were requested
or printed, and no other publication machine was used.

The fresh XCFramework build, Expo prebuild and CocoaPods installation pass.
An additional generic iOS Simulator Release build reaches Interface Builder's
SplashScreen compilation, then makes no progress for over10 minutes (zero CPU).
The owned xcodebuild and its orphaned ibtool child were terminated after matching
their complete identity twice against the owned derived-data path. This is an
interrupted infrastructure attempt, not a successful Release build. No simulator
boot, Expo app launch or `node witness/expo.mjs` result is claimed.

An authorized administrator must finish the Studio's Xcode component setup.
Then rerun the merged0.4.34 Expo Release build and native witness, retaining
bundle/backend binding and witness output. This is required before claiming
native witness coverage or publication readiness for this integration.

Evidence: `snapback4/reports/integration18/mac-native-prerequisite.json`,
`mac-results.json`; raw logs and scripts under `~/sb4-loop/integ18/`, remote
`~/sb4-ws-integ18/evidence/native-generic/`. The black M5 publication machine
and publication worktrees remain untouched.
