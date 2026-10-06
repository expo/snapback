# Native pilot environment

Unscored Phase 2, LLP 0201.000. M1–M6 and M8 retain all web obligations;
M7 is excluded. Web first-green is acceptance suite plus required implemented
choreography, with retained coverage and receipts. M6 scale replay remains on
its own clock. M8 web convergence must be measured separately from native.

The native CONTRACT.md overlay adds native IDs, passive helper wiring, fixtures,
Release app and raw read-only oracle mapping before the first edit. Use native/ui
instead of the old web kit. Keep web receipt version 0.3.8-m8 and native receipt
version 0.4.0-native.1. Scored admission, O4 and overall scores stay disabled.

Operator machine: Apartment mini only; dedicated simulator
3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B. No builder simulator operations.
Xcode 27.0 / 27A266a, Node 24.18.0, Expo 57.0.22, RN 0.86.3.
The builder has a private CODEX_HOME and TMPDIR. For the serial authoring window,
the operator temporarily disables Xcode's nested SwiftPM manifest sandbox,
which macOS cannot apply inside the inherited builder sandbox. The outer file
restrictions remain in force for every build and child. The original Xcode
preference is recorded and restored after the builder and its children end.
Git configuration and native tool metadata are readable; CocoaPods, Expo and
Convex CLI state are writable. Default Xcode DerivedData is writable for new
builds. The operator records its listing before authoring and moves newly
created directories into private runtime after all builder processes end.
Existing project products, simulator app data, the reference, driver and other
lane remain inaccessible. No simulator boot is needed for a Release build:
`-sdk iphonesimulator -destination 'generic/platform=iOS Simulator'` suffices.
No hosted backend or networking substitution for an owned local foreground
process. Normal Alice UI authentication and browser Bob are required.
