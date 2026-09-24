# snapback4-expo 0.4.0 — phase 1 native qualification

Prepared from `4af0ef82f9306140200fbfd5a52cfe95abcd6345` in the fresh worktree
`/Users/ccheever/projects/snapback-pub-040`, branch `sb4-intent/publish-040`.
Version/source commit: `8d52f3ea88989f38c7cae781beab9d1a62112ad8`. All requested steps passed.
No npm publication command or CLI publication script was run.
The complete publication suite and installed CLI consumer proof remain phase 2 work.

## Results and timings

1. Aligned snapback4, snapback4-darwin-arm64, its optional dependency, the Cargo
   workspace and all six lockfile entries, and snapback4-expo at 0.4.0. Updated
   the Bun workspace lock entries. Committed as `8d52f3ea88`; elapsed wall time
   from version edit through commit: 7.224 s. The frozen install and
   the existing `version_is_the_workspace_version` test passed (one test).
2. `cargo build` passed in 16.973 s. `bash scripts/build-xcframework.sh` passed
   in 79.837 s with arm64 device and simulator slices. Object metadata is at or
   below the declared iOS 16.4 minimum; see `xcframework-deployment.json`.
3. Generated the client package and chat API, then built chat-expo Release in
   65.349 s including initial prebuild and CocoaPods. Zero errors, three
   warnings. CocoaPods first ran after the framework existed and installed
   Snapback4Expo 0.4.0; no repeat pod installation was needed. The Release app
   targets iOS 16.4 and bundles the origin `http://127.0.0.1:44440`.
   The linked simulator archive matches the rebuilt archive byte for byte.
4. Created a dedicated iPhone 17 Pro simulator on iOS 26.5:
   `83D9B076-D3E5-4045-AD0A-17AF5DBC137A`. `witness/expo.mjs` drove this
   worktree's `target/debug/snapback4` via `SNAPBACK4_BIN`, port 44440.
   Offline with `--prime` passed in 8.958 s. Restart with
   `--prime --relaunch` passed in 12.158 s. Both manifests exit 0, and all
   recorded artifact sizes and SHA-256 hashes were reverified. The app's
   receipts establish cold offline history, two ordered pending writes,
   their survival across the restart, and ordered settlement after reconnect.
   The simulator is retained and shut down after qualification.
5. Recorded all seven xcframework file hashes in `qualified.json`, then ran
   `npm pack --json --pack-destination ../../target/expo-0.4.0` from
   `packages/snapback4-expo`. Pack: 0.916 s; verification: 0.048 s. All 17
   packed files match the qualified package source. The tarball remains at
   `/Users/ccheever/projects/snapback-pub-040/snapback4/target/expo-0.4.0/snapback4-expo-0.4.0.tgz` (4,809,589 bytes).
6. The journal and this evidence directory are committed on the named branch;
   the final commit identifier and commit timing are reported in the handoff.

No qualification attempt failed; there was no retry or weakened assertion.
Individual command records contain exact start/end timestamps, arguments,
working directories, exit codes and log paths. Durations overlap where the
version test and simulator preparation ran concurrently.

| Command | Exit | Seconds |
| --- | ---: | ---: |
| `bun-install` | 0 | 0.778 |
| `bun-install-after-bump` | 0 | 0.069 |
| `version-commit` | 0 | 0.081 |
| `cargo-build` | 0 | 16.973 |
| `xcframework-build` | 0 | 79.837 |
| `wasm-build` | 0 | 20.752 |
| `client-package-build` | 0 | 0.971 |
| `chat-backend-check` | 0 | 0.015 |
| `expo-release-build` | 0 | 65.349 |
| `version-mismatch-test` | 0 | 55.763 |
| `simulator-prepare` | 0 | 33.657 |
| `native-witness` | 0 | 23.981 |
| `npm-pack` | 0 | 0.916 |
| `pack-verification` | 0 | 0.048 |

The package build's prerequisite WASM was 1,745,078 B raw / 485,461 B gzip,
below the unchanged 486,000 B budget. This is not a new web qualification claim.

## Qualified bytes

Tarball integrity:
`sha512-yH1Ho6zhujUsi7uyF5iawUk2DaunFE9ewCrVenR8lHDGmWLTFs2plKhaDEuzKz59+WMIK7GXL3dHZToeoUau+Q==`

Tarball SHA-256:
`8790bc92759c58c47a2662260502c11b8a88c56659360045c23121ff5f5bd8e1`

Every xcframework file SHA-256, relative to `packages/snapback4-expo/`:

| File | SHA-256 |
| --- | --- |
| `ios/Snapback4Device.xcframework/Info.plist` | `7356f52904a89e04d6e32abafe6d521d97fd5b413de85b330bd608e58da805e4` |
| `ios/Snapback4Device.xcframework/ios-arm64/Headers/module.modulemap` | `da9d1aaa9f3574cc0f0bc917a680c3574b954dd6f85b3c6d68d33be720cb3329` |
| `ios/Snapback4Device.xcframework/ios-arm64/Headers/snapback4.h` | `5873cb92ec509aa199d52004da888f57545d1d0b148aad929649d89a17e9f5ab` |
| `ios/Snapback4Device.xcframework/ios-arm64/libsnapback4_device.a` | `972d05ece4565e63ff64b48285d1c6abb90eb631026fafe5a948ce4ae2af56e5` |
| `ios/Snapback4Device.xcframework/ios-arm64-simulator/Headers/module.modulemap` | `da9d1aaa9f3574cc0f0bc917a680c3574b954dd6f85b3c6d68d33be720cb3329` |
| `ios/Snapback4Device.xcframework/ios-arm64-simulator/Headers/snapback4.h` | `5873cb92ec509aa199d52004da888f57545d1d0b148aad929649d89a17e9f5ab` |
| `ios/Snapback4Device.xcframework/ios-arm64-simulator/libsnapback4_device.a` | `735cf95fcc2b9b115d193b496dd5ccfbf6b90e45dc48af822b29456e056eb4b7` |

Git source-tree object IDs from the committed source used for both slices:

- `HEAD:snapback4/crates/snapback4-device`: `708272bad68589c64517f4a15063bfa1eee16bf1`
- `HEAD:snapback4/crates/snapback4-core`: `f1149e8831365b5102d53b3c49227c2798941214`

`app-build.json` binds the Release executable, embedded JavaScript and Info.plist.
`cli.json` binds the worktree CLI. `linked-native-archive.json` and
`native-link-evidence.log` bind the app's linker input to the rebuilt simulator
slice. Generated binaries and native projects remain outside Git; the packed
archive is retained under the worktree's ignored `target/` for the next phase.

## Governing context

Scope: publication versions, native packaging, and the installed Release witness.
[LLP 3000 §7](../../../llp/3000-snapback4.explainer.md#7-decisions-during-execution)
requires the native iOS minimum to match the podspec.
[LLP 3000.007 §20.10](../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#2010-a-published-simulator-witness-s30)
binds simulator selection, owned processes and artifact/receipt collection.
[LLP 3000.013 §8](../../../llp/3000.013-quarry-states-intent.rfc.md#8-increments)
identifies 0.4.0 as the integrated intent release. These LLPs are in `llp/current/`.
The current `guide witness` card was read from the newly built CLI and is saved
as `guide-witness.txt`. No source behavior or design changed; the journal is
appended with this qualification. No further LLP handoff is needed.

This proof covers the two app-owned simulator scenarios, not physical devices,
all network paths, media/search scenarios, or the publication suite. The device
and core trees were unmodified throughout the native builds and witness.
