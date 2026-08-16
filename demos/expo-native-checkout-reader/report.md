# Expo native dev-identity checkout witness report

Implementation is present; live native receipts are pending. Run these commands
from the repository root on the orchestrator host (never from the agent
sandbox).

## Prepare the runtime and witness dependencies

```sh
scripts/bootstrap-ibex-runtime
cd demos/expo-native-checkout-reader/app
bun install --frozen-lockfile
```

## iOS simulator

Boot the intended simulator in the orchestrator environment, then:

```sh
bun run build:ios
xcrun simctl install booted ../.state/ios-derived-data/Build/Products/Debug-iphonesimulator/SnapbackCheckoutWitness.app
SNAPBACK_RUNTIME_BINARY="$PWD/../../../target/debug/snapback" node ../scripts/run-witness.mjs --platform ios
```

The run writes separate JSON rows for the iOS native reader, fresh-launch
rotation replacement, the narrow server-side browser-Origin redemption
refusal, tunneled bootstrap secret isolation, replay refusal, and refusal of an
unspent checkout after backend rotation. It does not emit the full Expo web
isolation row described below.

## Android emulator

```sh
bun run build:android
adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk
SNAPBACK_RUNTIME_BINARY="$PWD/../../../target/debug/snapback" node ../scripts/run-witness.mjs --platform android --android-serial emulator-5554
```

## Android physical USB device

Use the exact serial reported by `adb devices -l`; TCP/IP-connected adb is not
admitted by the supervisor.

```sh
adb -s <USB_SERIAL> install -r android/app/build/outputs/apk/debug/app-debug.apk
SNAPBACK_RUNTIME_BINARY="$PWD/../../../target/debug/snapback" node ../scripts/run-witness.mjs --platform android --android-serial <USB_SERIAL>
```

The Android run summary records the selected serial and whether the supervisor
classified it as `emulator` or `usb`; the supervisor installs and verifies the
three exact per-serial `adb reverse` routes, while the harness owns one separate
per-serial reverse route for its value-free receipt sink.

## Rows awaiting live orchestrator runs

- iOS simulator native reader and rotation replacement.
- Android emulator native reader and rotation replacement.
- Android physical USB native reader and rotation replacement (explicit
  nonclaim until hardware is available).
- Replay refusal, unspent post-rotation refusal, the narrow server-side
  browser-Origin redemption refusal, and tunneled bootstrap secret isolation
  alongside each native run.
- Full Expo web isolation remains explicitly pending: it requires the real Expo
  web bundle running in a browser context. The Node `fetch` Origin-gate probe is
  retained only as `browser-origin-redemption-refusal` and is not that row.

## Verification run for this implementation

The following are the verbatim JS/static verification commands run for this
change:

```sh
node packages/snapback-expo-dev-identity/install.test.mjs
node packages/snapback-expo-dev-identity/config-plugin.test.mjs
node packages/snapback-expo/supervised-environment.test.mjs
node packages/snapback-expo/provider-auth-bootstrap.test.mjs
node packages/snapback-cli/expo-dev-identity-checkout.test.mjs
node packages/snapback-cli/dev-cli-diagnostics.test.mjs
node node_modules/typescript/bin/tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext packages/snapback-expo-dev-identity/index.d.mts packages/snapback-expo-dev-identity/install.d.mts packages/snapback-expo-dev-identity/config-plugin.d.mts

cd packages/snapback-expo
env SNAPBACK_CLIENT_RQS_STORE=off /Users/ccheever/.volta/tools/image/node/24.18.0/bin/node --no-experimental-webstorage ../../scripts/ensure-workspace-hoist.mjs
for test_file in app-binding.test.mjs asset-source.test.mjs config-plugin.test.mjs provider.test.mjs provider-auth-bootstrap.test.mjs supervised-environment.test.mjs supervised-offline-fallback.test.mjs release-export-vocabulary.test.mjs activity-presence.test.mjs package.test.mjs package-closure.test.mjs; do env SNAPBACK_CLIENT_RQS_STORE=off /Users/ccheever/.volta/tools/image/node/24.18.0/bin/node --no-experimental-webstorage "$test_file" || exit 1; done
/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node ../../node_modules/typescript/bin/tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler types.fixture.ts
cd ../..

git ls-files --modified --others --exclude-standard -- '*.mjs' | while IFS= read -r source_file; do node --check "$source_file" || exit 1; done
./ref-check --verbose
node scripts/check-package-test-inventory.mjs
```

Result: PASS. The Expo package's JS tests and strict type fixture passed under
the repository-supported Node 24 runtime; the ambient Node 25 runtime exposes
an invalid built-in `localStorage` without `--no-experimental-webstorage`.
`ref-check` reported 272 LLP documents, 5,753 references, and zero errors or
unchecked references. The package inventory reports 301 declared test files.

Static witness preparation also passed: Snapback generation completed without
warnings, Expo prebuilt both native targets, and autolinking resolved the iOS
module/app-delegate subscriber plus the Android module/lifecycle package. No
native build, simulator, emulator, USB launch, or live receipt was attempted in
the sandbox.

Two additional repository-wide diagnostics remain inherited and unrelated to
this implementation: `node scripts/check-inventories.mjs` reports missing
generated Guide/demo inputs plus stale diagnostics projections, and
`node scripts/check-package-export-types.mjs` reports the existing
`@expo/snapback-codegen/visibility-governance` export without a `types`
condition.
