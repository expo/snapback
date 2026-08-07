# Expo golden-path fixture

This fixture began as LLP 0176 G1's minimal no-URL Expo app and now also hosts
G2's conversation-surface exit proof. The current screen boots with
`<SnapbackExpoProvider app={app}>`, opens the Engine Room thread, and consumes
`app.surfaces.conversation` through the north-star `useSurface` shape. On a
device-platform run it publishes scoped typing presence, sends text, reacts to
the returned message, waits for both echoes through the surface, and renders
`G2_IOS_PASS` or `G2_ANDROID_PASS`. Back navigation still exposes the complete
conversation-list and thread comparison UI.

From the repository root, materialize the local package closure and generated
application artifacts:

```sh
node scripts/install-local-snapback-packages.mjs demos/expo-golden-path-fixture
bun --cwd demos/expo-golden-path-fixture run generate
```

Then run the supervised loop from the fixture directory with a fresh database.
For iOS:

```sh
node ../../packages/snapback-cli/cli.mjs dev snapback \
  --expo --expo-dir . --expo-platform ios \
  --db .snapback/g2-ios.sqlite3 \
  --ready-file .snapback/g2-ios.ready.json \
  --email g2-ios@snapback.test
```

For Android, with one emulator already booted and `adb` available on `PATH`:

```sh
node ../../packages/snapback-cli/cli.mjs dev snapback \
  --expo --expo-dir . --expo-platform android \
  --db .snapback/g2-android.sqlite3 \
  --ready-file .snapback/g2-android.ready.json \
  --email g2-android@snapback.test
```

Those commands remain the supervised launch shape. G1's dated marker receipts
are unchanged historical evidence; the current screen emits structured
`SNAPBACK_G2_EVENT` facts and the G2 marker for its platform. The completed
device-platform receipts are
[`20260806-g2-ios-simulator.md`](./receipts/20260806-g2-ios-simulator.md) and
[`20260806-g2-android-emulator.md`](./receipts/20260806-g2-android-emulator.md).

For opportunistic physical-device qualification, use the explicitly non-receipt
[`physical-device-online-checklist.md`](./receipts/physical-device-online-checklist.md).
The Android USB supervisor mechanism is ready for that live run; no device was
run for its landing. The iOS section records the current typed blocker rather
than treating `iproxy`'s host-to-device direction as the required reverse
forward. Do not cite the checklist itself as an LLP 0064 receipt.

For the G2 headless checkpoint, use an explicitly qualified runtime binary:

```sh
SNAPBACK_RUNTIME_BINARY=/path/to/snapback bun run test:g2
bun run typecheck
```

`test:g2` regenerates the fixture and exercises current surface data, bound
mutation arguments, one canonical query-store/subscription owner, one canonical
presence-store/room owner, capability refusal, the process-cold retained path,
and an all-zero resource vector after disposal. It passes 5/5. The append-only
falsification and repair record is
[`20260806-g2-falsification-baseline.md`](./receipts/20260806-g2-falsification-baseline.md).
