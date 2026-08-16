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
- `evidence/`: one timestamp/run-id directory per execution, containing JSONL,
  Markdown receipts, build receipts, host/device logs, and milestone screenshots.

The app long-polls the host director, executes one command at a time, and posts
events and correlated results. Public evidence includes custody revision,
authority epoch, phase, principal id, and an in-process SHA-256 of the bearer.
Each bearer and recovery code is one-shot reported over a separate endpoint
into the director's in-memory leakage set; those literals are never retained
in events, results, logs, or receipts. The host adds every run password to the
same set and scans every run artifact before writing the final verdict.

## Run

From the repository root:

```sh
SNAPBACK_RUNTIME_BINARY=/path/to/snapback \
  node demos/native-custody-probes/harness/run-ios.mjs \
  --udid <available-simulator-udid> \
  --server-port 4298 \
  --director-port 18771 \
  --iterations 15 \
  --ios-extension-evidence /path/to/supervisor-native-refusal-evidence.txt
```

```sh
SNAPBACK_RUNTIME_BINARY=/path/to/snapback \
  node demos/native-custody-probes/harness/run-android.mjs \
  --avd Medium_Phone_API_36.1 \
  --server-port 4299 \
  --director-port 18772 \
  --metro-port 8081 \
  --iterations 15
```

Both runners discover an existing target when an explicit identifier is
omitted. iOS accepts `--derived-data` and `--app-path`; Android accepts
`--serial`, `--adb`, `--emulator`, and `--apk`. `--skip-build` reuses the
resolved `.app` or APK only when an earlier per-run build receipt binds its
current SHA-256; otherwise the runner refuses. It still generates the backend,
installs JavaScript dependencies, starts the backend, and (for Android debug)
starts Metro. Leakage scanning is mandatory and always runs; the dead
`--leakage-scan` flag has been removed because it never changed that behavior.

The iOS fresh-install precondition resets the selected simulator keychain.
Pass `--preserve-keychain` only when the target is already known clean. The
post-journey uninstall/reinstall does not reset it, which is the behavior P5
measures. Android P5 claims only uninstall-clears-data. `bmgr` backup/restore
(LLP 0263 A-9) and device-to-device transfer remain explicitly not claimed.

Android P2 uses only a verified SIGKILL: the host tries debug-app `run-as`
and plain `kill -9`, requires a successful command, observes the exact PID
absent via `adb shell ps`, and only then uses force-stop as cleanup. The
distinct force-stop-mid-write arm (LLP 0263 A-3) remains not claimed.
Each iteration selects the first entered write that does not already have a
matching completion and records either `interrupted-before-commit` (the
predecessor restored) or `committed-before-restore` (the successor restored).
P2 is complete only when at least one iteration demonstrates each class;
otherwise the receipt is `INCOMPLETE` and names the missing class.

## Native custody integration

The witness imports the first-party custody package directly and injects its
`owner-key-v1` adapter through app-client's explicit advanced
`{ kind: 'expo-native', authCustodyStorage }` evidence seam. The package is
also listed in the app's Expo `plugins` array so the Android backup exclusions
are applied. Ordinary provider resolution remains capability-refused until the
per-OS Phase 2 evidence flips it.

Android debug builds expose `testHooks.corruptCiphertext(ownerKey)` for the
AEAD probe. It persists a byte-flipped AES-GCM payload, discards the per-key
DataStore instance, and requires the next read to recreate the store and reach
the real `AEADBadTagException` corruption classification. The static
`expo.modules.snapbackcustody.NativeCustodyProbeHooks.attemptSecondaryProcessIo(Context)`
hook covers the `android:process=":probe"` single-runtime refusal and reports
that the guarded real-read arm performed no I/O. Production builds refuse both
hooks.

This codegen revision emits the non-secret `authBootstrap` policy but has no
source declaration for `auth.application-bootstrap.v1`. `app/probe-app.ts`
adds that required capability at the provider descriptor layer without
changing generated identities; the director offers the same capability.

iOS v1 deliberately has no extension target. Without
`--ios-extension-evidence`, P4 is `INCOMPLETE` and the overall result is the
qualified `PASS (P4-iOS INCOMPLETE: extension refusal not exercised)`. A
supervisor-supplied evidence file must contain the exact
`SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED` code; its bytes are copied into
the isolated run, scanned, and SHA-256-bound in the receipt before P4 can pass.
