# Lane N — round-one review fixes

All six supplied Astra/Grok findings are addressed. This round supersedes the
initial native evidence in the parent directory; the earlier manifests remain
unchanged as historical evidence. No independent re-review verdict is claimed.

## Changes and regressions

| Finding | Files and resulting behavior | Regression |
| --- | --- | --- |
| Restart can accept a pre-barrier tail | `packages/snapback4-expo/src/smoke.ts`, `crates/snapback4/src/verbs/witness.rs`, `verbs/witness/smoke.rs`: pass `barrierSeq` at launch and require watermark ≥ that sequence in both validators. Restart receipts retain that threshold. | Prime 7 / persisted 8 / barrier 9 fails until 9 arrives; Rust independently rejects 8. The fake simulator commits a tail after prime and verifies the exact barrier passed in its launch configuration. |
| Native crash after success | `verbs/witness.rs`, `verbs/witness/smoke.rs`: successful smoke segments require the owned PID to exist at deliberate termination. Failure cleanup and deeper scenarios keep their prior cleanup behavior. | The fake simulator emits successful `done`, then deletes the PID. The driver returns `E_WITNESS_APP` and records restart failed despite its success receipt. |
| First client latched during restoration | `packages/snapback4/src/app.ts`, `local.ts`, Expo `smoke.ts`: announce only a published app client; notify host teardown synchronously on close; follow the latest attachment under one witness step and discard obsolete in-flight samples without failure receipts. | A persisted session one hour from expiry refreshes; a competing rotation while construction finishes forces `RestorationChanged` and a second client. The closed candidate never reaches the hook, only the published replacement completes smoke. A separate mock test replaces an in-flight sample. |
| Counts sampled before the render pause | Expo `smoke.ts`: reread `witness_state` after the pause and repeat readiness, identity, offline counts and restart barrier assertions before receipt. | A prime snapshot incorporates a page landing during the pause. Changed offline counts, store identity or generation during that pause fail. Mock replies are copies, so shared object mutation cannot fake a fresh read. |
| Untested generation mismatch | `packages/snapback4/test/native-smoke.test.mjs` | Change only generation and require an identity refusal. |
| Weak optional-argument selector fixture | `packages/snapback4/test/native-smoke.test.mjs` | Required argument uses actual `{ "Ref": { "table": "conversations" } }` JSON; that query must not run. |

The mock driver and assertions live in
`crates/snapback4/tests/fixtures/witness-simctl.py` and
`crates/snapback4/tests/witness.rs`. The real session/SQLite regression is in
`packages/snapback4/test/app.test.mjs`. The witness card and LLP
3000.011.005.000 now describe the exact barrier, process liveness, final state
read and client publication boundary. `JOURNAL.md` records the round.

Every regression was checked by temporarily restoring the faulty behavior.
[Mutation results](./mutation-checks.json) record eight rejected mutations:
prime-only validation in JS and Rust, accepting a disappeared PID, first-client
latching, notifying an unpublished candidate, omitting the final snapshot,
ignoring generation, and accepting every object as an optional argument.
All mutations were reverted before the final checks and native builds.

## Native evidence

| Run | Result | Duration |
| --- | --- | --- |
| [Positive manifest](./pass/smoke-ios-run.json) | exit 0; prime/offline/restart passed | 8.523 s |
| [Broken manifest](./broken/smoke-ios-run.json) | expected exit 1; offline failed; restart not run | 5.831 s |

The positive run retains counts `conversations: 1`, `memberships: 1`,
`messageCounts: 1`, `messages: 3`, `profiles: 1`. Offline `inbox` is ready with
one complete, non-fresh result. All error arrays are empty. Prime watermark
is 1; restart records **watermark 2 and barrierSeq 2**, matching the driver's
`syncBarrier.seq`. All three successful processes reached deliberate
termination. The offline screenshot shows the real chat screen and retained
three-message history.

The broken build uses the unchanged [negative-control patch](../broken-build.patch):
throw `Lane N deliberate offline start failure` at offline JS startup. Its
fatal error is in the receipt. The patch was removed after building; it is
absent from the committed app source. Both runs use ordinary
`createApp`/`AppProvider`, without the app-specific runner mounted.

The dedicated iPhone 17 Pro simulator was
`92367552-2B65-40D8-9697-E0C33793F72C`, iOS 26.4, on the actual M5 / macOS
27.0 / Xcode 27.0 host. It was shut down and deleted after both runs. No
Simulator.app was opened. The unchanged native framework was hash-checked
against the initial qualification; the modified JS and CLI were rebuilt.
[Qualification](./qualification.json) records source/driver/framework hashes
and simulator cleanup. Each manifest binds its installed executable and JS
bundle plus every retained screenshot, video, receipt file and device log.
All retained artifact hashes were recomputed successfully.

## Commands and results

From `snapback4/`, with the pinned toolchain and one build job:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$HOME/.bun/bin:$HOME/.cargo/bin:/opt/homebrew/bin:$PATH
export CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
export SNAPBACK4_RUST_TEST_PROCESSES=1 RUST_TEST_THREADS=1 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1
export CI=1 EXPO_NO_TELEMETRY=1
bun run --cwd packages/snapback4 build
node --test --test-concurrency=1 packages/snapback4/test/app.test.mjs packages/snapback4/test/native-smoke.test.mjs packages/snapback4/test/witness.test.mjs packages/snapback4/test/react.test.mjs
cargo test -p snapback4 smoke --bin snapback4
cargo test -p snapback4 --test witness -- --test-threads=1
cargo test -p snapback4-lang --test guide
bun run --cwd packages/snapback4 typecheck
bun run --cwd apps/chat-expo typecheck
node scripts/docs-budget.mjs
../ref-check --root .. --verbose
```

All passed: **66 JS tests**, **22 driver tests**, **2 smoke unit tests**,
**57 guide tests**, both typechecks, docs budget (295/300 README lines),
reference validation (505 documents, 9,236 refs, no errors/unchecked refs),
and whitespace/source budgets. [Structured results](./verification.json)
retain these totals. The complete `scripts/test.sh` was not repeated this
round; the parent report retains its initial nonzero result and successful
focused reruns. No full-suite-green claim is made.

```sh
UDID=$(xcrun simctl create 'Snapback4 Lane N Round 1' com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro com.apple.CoreSimulator.SimRuntime.iOS-26-4)
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
export EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:4448
(cd apps/chat-expo && xcodebuild -workspace ios/Snapback4chat.xcworkspace -scheme Snapback4chat -configuration Release -sdk iphonesimulator -destination "id=$UDID" -derivedDataPath ios/build-smoke -jobs 1 build)
xcrun simctl install "$UDID" apps/chat-expo/ios/build-smoke/Build/Products/Release-iphonesimulator/Snapback4chat.app
python3 reports/20260924-native-smoke/seed.py "$UDID"
(cd apps/chat && ../../target/debug/snapback4 witness ios --smoke --bundle-id dev.snapback4.chat --udid "$UDID" --artifacts ../../reports/20260924-native-smoke/round1/pass --port 4448)
# Apply the repository-relative negative-control patch, then repeat the
# identical Release build above and restore the patch before installing it.
git -C .. apply snapback4/reports/20260924-native-smoke/broken-build.patch
# Repeat xcodebuild above, then:
git -C .. apply -R snapback4/reports/20260924-native-smoke/broken-build.patch
xcrun simctl install "$UDID" apps/chat-expo/ios/build-smoke/Build/Products/Release-iphonesimulator/Snapback4chat.app
(cd apps/chat && ../../target/debug/snapback4 witness ios --smoke --bundle-id dev.snapback4.chat --udid "$UDID" --artifacts ../../reports/20260924-native-smoke/round1/broken --port 4448)
# Expected exit 1, then:
xcrun simctl shutdown "$UDID"
xcrun simctl delete "$UDID"
```

The previous lane-owned `.snapback4` backend was preserved in a temporary
archive before reseeding a fresh fixture; the seed script expects one guest.
Artifact directories are reserved; reproductions must choose fresh names.
Long commands ran under the same 40 GiB disk watchdog. No cutoff fired;
observed space during the builds was about 72 GiB. Builds remained serial.
The first version of the restoration test asserted inside the construction
hook, which made its intentional mutation failure hang during cleanup; its
assertions now run after restoration, and the final mutation failed cleanly
with two attachments instead of one.

There is no remaining failure in the supplied review scope. Physical devices,
Android and deeper application behavior remain outside this smoke evidence.
Package versions remain inherited 0.4.0 for supervisor integration. Nothing
was published. As in the original round, branch delivery uses command-local
`git -c core.hooksPath=/dev/null push ghssh HEAD:refs/heads/sb4-native/n-smoke`
under the explicit Snapback 4 fence; no persistent hook setting is changed.
