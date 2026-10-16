# Wave 14 REG evidence

Base: 4ef9f77fb3 (0.4.30). Candidate version remains 0.4.30 in this lane;
integration owns 0.4.31. No push or publication performed.

## Native Expo floor

On macstudio-charlie-apt101-a, inside ~/sb4-ws-reg only: reference chat app
with Expo 57.0.22, a direct expo-modules-core 57.0.23 pin, React 19.2.3 and
RN 0.86.3. Native source was the base commit. The candidate peer range was
widened in that scratch workspace for dependency resolution. Built the Rust
xcframework with production profiles, generated chat API, and built iOS Release
using Xcode 27.0 (27A266a), iOS simulator SDK 27.0. The JSI plugin applied
without source-mode flags. Build succeeded with zero errors. Installed the app
on a newly created, owned iPhone 17 Pro simulator. The published witness ran
both offline and restart segments, and both passed (31.183 seconds total).
The simulator was shut down and deleted by the driver trap. JSON receipts and
compressed raw build/witness logs are beside this report. No physical-device,
Android, SDK58 or publication claim follows.

Decision: Expo >=57.0.22 <58 is supported when core >=57.0.23 <58 is present.
The fix does not require Expo 57.0.30 runtime. Starters retain their newer pins.
CocoaPods was absent on this host; installed it with Homebrew's portable Ruby
and GEM_HOME/CP_HOME_DIR confined to the scratch directory. The first automatic
system-Ruby install attempt was stopped before continuing with the isolated setup.

## Regression controls

Actual Wave14 0.4.30 tarballs from ~/sb4-loop/dist/0.4.30 were installed into
this worktree's ignored target/reg-baseline. The guide fixture call on the
persona-only web starter throws E_INPUT containing E_AUTH; missing dist throws
ENOENT. Both expected failures are retained in reg-baseline-r1-p20.log.gz.
Candidate focused Rust catalog suite: 14 passed. Fixture loader: 5 passed.
Focused proof lifecycle tests: 5 passed. Existing upgrade/history plus initial
PM contract tests: 21 passed. Full guide Rust suite: 125 passed.

Mac affected files initially ran against system Chrome and had three unrelated
browser-close deadline failures. Repeating with Playwright 1.55.1's pinned
Chromium in the scratch directory passed all 29 tests; catalog suite passed 14.
Later qualification and final verification are recorded in WORKSTREAM-REPORT.md.
