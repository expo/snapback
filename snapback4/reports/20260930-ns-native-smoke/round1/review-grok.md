I'll review lane NS round 0 against the report and the diff from `2cb2b5f141` to `3f59b23d2c`, starting with the review instructions and the claimed native-smoke behavior.The request is a lane review with a fixed verdict, not a generic branch review. I'll read the report and the repo's review rules before checking the diff.The source change is a focused set of witness, init, and guide files. I'll read the simulator, smoke, and port logic next, then check the report's receipts against it.Auto-compacting conversation (81% full)...
Conversation compacted.
The review is still open. I’ll finish the receipt and documentation-budget checks, then write the verdict. No files will be changed.**READY WITH CHANGES.** Automatic selection does not shut down, erase, or boot a simulator it did not just create, and the report’s timings match the retained receipts. The paved `npm run native:smoke` path is not race-free on its free port, and both package READMEs still quote an older measurement for that command.

This is a read of `2cb2b5f141`..`3f59b23d2c` plus the lane receipts. No files were changed and nothing was pushed. The fake-`xcrun` driver tests are `#[cfg(target_os = "macos")]` in `snapback4/crates/snapback4/tests/witness.rs`, so they were not executed on this Linux host. No Xcode build and no suite run was started. `full-suite.exit` is `1`, as the report says.

## Findings

**1. Medium. The build-mode free port is not race-free.** `witness ios --build` with no `--port` sets the port to `0` (`witness.rs`). `reserve` binds `127.0.0.1:0`, so the kernel hands out an ephemeral port. That listener is held across `prepare_app`, then dropped. `start_backend` binds it again and drops the listener before spawning `dev`. The driver comment in `tests/witness.rs` already says a just-probed ephemeral port can be taken by an outbound connection before `dev` binds; the tests avoid that range (`30000`–`44999`) and the new default walks into it. Failure stays closed: nothing else is killed, and the run errors with “choose a free `--port`” or “dev exited”. The origin is already baked into the Release bundle, so the recovery is another full build. An explicit `--port`, including the installed-app default `4400`, does not use the ephemeral allocator.

**2. Medium. The package READMEs cite timings these receipts do not support.** `packages/snapback4/README.md` (about lines 83–88) and `packages/snapback4-expo/README.md` (about lines 87–92) still say five warm runs measured **159.841 s median / 197.562 s p95** and that cold preparation was about six minutes, in the same breath as `npm run native:smoke`. This lane’s receipts are different. The guide’s “about 3 minutes warm” is slower than the new sample and the report calls it guidance, not a promise. Scope claims match the code: generic smoke does not call `mutate`, guest sign-in runs only when `smokeSegment() === "prime"` and the account is signed out, and the cards say pending-write replay needs an application scenario.

**3. Low. Several booted smoke devices are not ordered by runtime version, and the created phone is whatever simctl lists last.** Reuse walks `devices` as a `BTreeMap` (`serde_json` 1.0.151, no `preserve_order`). Among booted, available, prefix-named devices, the lexicographically first iOS runtime key wins, so a booted `iOS-18-…` device is chosen over a booted `iOS-27-…` device. The fake fixture never builds that case. Creation still uses the newest available iOS runtime by numeric version. The device type is the last supported iPhone in `simctl list devicetypes`. The qualified device in `simulator-cleanup.json` is `com.apple.CoreSimulator.SimDeviceType.iPhone-11`. That is an iOS simulator, not a wrong platform. The docs claim the newest runtime, not the newest phone.

**4. Low. `check` runs before the project lease and can exit 2.** `prepare` creates or reuses the simulator, takes the simulator lock, then calls `check`. If there is no `snapback/schema.q`, `project_or_exit` prints one line and `process::exit(2)`, so this path is not the witness `0`/`1` wrapper. Two `--build` runs that each create a device can both enter `check` / `write_generated` before either holds `.snapback4-witness/owner.lock`. Two runs that selected the same device do not: the second fails with “leaving it untouched” and does not erase or shut it down.

## Simulator choice

Automatic selection will not shut down, erase, or delete. The only `simctl` mutations in this path are `create`, `boot`, and `bootstatus` on the UDID just returned by `create`, plus later `install` and `terminate` of the owned app after a PID check. A replaced PID is left running.

It will use a simulator this process did not create when that device is already `Booted`, `isAvailable` is true, the name starts with the prefix (`snapback4-smoke-`, or `SNAPBACK4_SMOKE_DEVICE_PREFIX` if it is a name ending in `-`), and the devices-map key is an available `com.apple.CoreSimulator.SimRuntime.iOS-…` runtime. A shutdown, booting, or unavailable prefix device is skipped, not booted. `mini-verify-iphone` and a near-miss such as `other-snapback4-smoke-not-ours` are not selected. An iPad is not created; one would be reused only if it were already booted under the prefix. The qualified runs created `sb4-ns-1790751789343-32355` (`9B126451-3726-4571-A8C8-F1C334B35ECC`, iOS 27.0) and the three warms and the social run reused it. The lane, not the command, deleted that device.

Two concurrent runs that do not see a booted prefix device each create `prefix + unix-ms + pid`. They do not erase each other. Sharing one booted device is serialized by the simulator lock.

## Resources

Artifact directories are fail-closed. The default is `artifacts/native-smoke/<unix-ms>-<pid>`. `reserve_artifacts` uses `create_new` on `<segment>-ios-reserved` and refuses if any output name already exists. The concurrent driver test expects one winner and `E_WITNESS_ARTIFACT` for the loser. Cleanup kills the command’s own preparation process group, `rsync --delete`s only into `.snapback4-witness/snapshot` (and excludes `/ios` when the project has no `ios/`), and does not remove simulators or artifact directories it did not reserve. The lock file is created inside the selected simulator’s data directory. That is a write, not a wipe.

## Failure modes

Missing `xcrun` or an empty available-iOS runtime list becomes one `E_WITNESS_PLATFORM` line telling the user to install Xcode and an iOS runtime, optionally setting `DEVELOPER_DIR`. Tool stderr is discarded. `run` returns 1, and that code does not add “see snapback4 guide witness”. The same sentence is used for every other non-timeout `simctl list` failure, so a different simctl error is mislabeled as a missing Xcode. Linux fails earlier with “witness ios requires macOS…”, also one platform line and exit 1. Preparation failures thrown from `prepare.mjs` can keep the Node stack, because the Rust side slices stderr from `E_WITNESS_` through the rest of the text. Child `xcodebuild` / `pod` / Expo processes get an allowlist plus a private `HOME` and an origin-hashed `TMPDIR`, not the ambient environment.

## Honesty and budgets

| Sample | Receipt seconds | Status | 1-minute load min / median / max | Origin port | Simulator |
| --- | ---: | ---: | --- | ---: | --- |
| qualified-cold | 221.724 | 0 | 3.61 / 18.24 / 61.41 | 60797 | created |
| qualified-warm-1 | 84.566 | 0 | 4.89 / 5.67 / 7.22 | 61097 | reused |
| qualified-warm-2 | 82.009 | 0 | 4.32 / 4.90 / 5.39 | 61154 | reused |
| qualified-warm-3 | 83.511 | 0 | 3.21 / 3.68 / 6.13 | 61210 | reused |
| social-qualified | 186.191 | 0 | 14.62 / 23.47 / 47.52 | 61265 | reused |

Warm median of those three is 83.511 s. CocoaPods 93.174 s versus 13.775 / 11.143 / 11.639 s, Xcode 43.915 s versus 28.914 / 29.375 / 29.274 s, and the plain samples each have 82 compile lines. JavaScript hashes differ. Host file matches the M5 Pro, 18 cores, 64 GiB, Xcode 27.0 (27A266a), Node 24.18.0, npm 11.16.0, CocoaPods 1.17.0.

`client.md` is 114 lines and 1,198 words, the same size as the base. `witness.md` is 399 lines (3,362 words, up 3). `packages/snapback4/README.md` is 300 lines. `docs-budget.json` was not raised. The new test caps are `<= 114` and `<= 399`, met at the cap. Starter READMEs are checked for the required phrases, not a separate line budget.

## Regression

`witness ios --build … --smoke --udid … --port … --artifacts …` still targets that already-booted UDID, that port, and that directory, and it does not create a simulator. The new check is that the device’s runtime identifier is on the available iOS list. Every `--build`, including this explicit form, now runs `check` first and may rewrite generated files. Omitting `--udid` no longer means “the one booted simulator”; that break is documented and applies to installed-app mode too. Omitting `--port` on `--build` is the ephemeral-port change above. Omitting `--artifacts` is newly legal.
