# Native custody probes

This demo is the LLP 0258 Phase 2 simulator/emulator evidence producer. It is
not a compatibility demo and it does not silently fall back to volatile or
SecureStore custody.

## Contents

- `snapback/`: sessions-auth backend with password entry, durable-required
  custody policy, a seeded row, and one authenticated live query.
- `app/`: Expo 57 / React Native 0.86 witness with committed iOS and Android
  native projects (`dev.snapback.custodyprobes`).
- `harness/`: dependency-free Node directors for iOS and Android.
- `evidence/`: generated JSONL, Markdown receipts, and milestone screenshots.

The app long-polls the host director, executes one command at a time, and posts
events and correlated results. Public evidence includes custody revision,
authority epoch, phase, and an in-process SHA-256 of the bearer. The bearer,
password, and recovery-code values are never returned to the host.

## Run

From the repository root:

```sh
SNAPBACK_RUNTIME_BINARY=/path/to/snapback \
  node demos/native-custody-probes/harness/run-ios.mjs \
  --udid <available-simulator-udid> \
  --server-port 4298 \
  --director-port 18771 \
  --iterations 15 \
  --leakage-scan
```

```sh
SNAPBACK_RUNTIME_BINARY=/path/to/snapback \
  node demos/native-custody-probes/harness/run-android.mjs \
  --avd Medium_Phone_API_36.1 \
  --server-port 4299 \
  --director-port 18772 \
  --metro-port 8081 \
  --iterations 15 \
  --leakage-scan
```

Both runners discover an existing target when an explicit identifier is
omitted. iOS accepts `--derived-data` and `--app-path`; Android accepts
`--serial`, `--adb`, `--emulator`, and `--apk`. `--skip-build` reuses the
resolved `.app` or APK but still generates the backend, installs JavaScript
dependencies, starts the backend, and (for Android debug) starts Metro.

The iOS fresh-install precondition resets the selected simulator keychain.
Pass `--preserve-keychain` only when the target is already known clean. The
post-journey uninstall/reinstall does not reset it, which is the behavior P5
measures. Android disables app backup and device transfer, then measures the
fresh reinstall result.

## Lane A integration

The custody package was not present when this lane was authored. The current
shim fails with `SNAPBACK_AUTH_CUSTODY_NATIVE_MODULE_UNAVAILABLE` rather than
producing counterfeit evidence.

When `packages/snapback-expo-custody` lands:

1. Add `"@expo/snapback-expo-custody":
   "file:../../../packages/snapback-expo-custody"` to `app/package.json`.
2. Replace `app/custody-module.ts` with the one-line re-export documented in
   that file. `app/custody-module.d.ts` records the API this lane compiled
   against.
3. Reconcile `app/native-platform.ts` with app-client's final admitted native
   kind/adapter key if Lane A chose a spelling other than
   `{ kind: 'expo-native', authCustodyStorage }`.
4. Expose the debug-only `testHooks.corruptCiphertext(ownerKey)` method needed
   for the Android AEAD probe. Raw-file corruption is intentionally absent.
5. Expose Android's debug-only static hook
   `expo.modules.snapbackcustody.NativeCustodyProbeHooks.attemptSecondaryProcessIo(Context)`.
   It must perform real custody I/O and return or throw the stable typed
   single-runtime refusal. The service runs under `android:process=":probe"`.

This codegen revision emits the non-secret `authBootstrap` policy but has no
source declaration for `auth.application-bootstrap.v1`. `app/probe-app.ts`
adds that required capability at the provider descriptor layer without
changing generated identities; the director offers the same capability.

iOS v1 deliberately has no extension target. `refusalProbe` records
`SNAPBACK_AUTH_CUSTODY_EXTENSION_NATIVE_UNIT_FALLBACK_REQUIRED`; the Phase 2
bundle must pair that receipt with Lane A's native-unit extension-context
refusal evidence.
