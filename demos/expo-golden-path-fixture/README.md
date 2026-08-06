# Expo golden-path fixture

This fixture began as LLP 0176 G1's minimal no-URL Expo app and now also hosts
G2's Relay Room conversation-surface falsification checkpoint. The current
screen boots with `<SnapbackExpoProvider app={app}>`, shows a conversation list
and message thread, and consumes `app.surfaces.conversation` through
`useSurface`. The dated G1 simulator/emulator evidence remains under
[`receipts/`](./receipts/).

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
  --db .snapback/g1-ios.sqlite3 \
  --ready-file .snapback/g1-ios.ready.json \
  --email g1-ios@snapback.test
```

For Android, with one emulator already booted and `adb` available on `PATH`:

```sh
node ../../packages/snapback-cli/cli.mjs dev snapback \
  --expo --expo-dir . --expo-platform android \
  --db .snapback/g1-android.sqlite3 \
  --ready-file .snapback/g1-android.ready.json \
  --email g1-android@snapback.test
```

Those commands remain the supervised launch shape. The dated G1 receipts were
captured when the fixture screen automatically sent one mutation and emitted
`G1_IOS_PASS`/`G1_ANDROID_PASS` plus structured `SNAPBACK_G1_EVENT` markers.
The current G2 comparison screen does not reproduce those historical markers;
the retained G1 simulator/emulator evidence is under [`receipts/`](./receipts/).

For the G2 headless checkpoint, use an explicitly qualified runtime binary:

```sh
SNAPBACK_RUNTIME_BINARY=/path/to/snapback bun run test:g2
bun run typecheck
```

`test:g2` regenerates the fixture and exercises current surface data, bound
mutation arguments, canonical subscription ownership, capability refusal, and
the process-cold offline path. Its cold-offline check is deliberately a
negative witness: the test suite is green when it reproduces the current
descriptor-mode refusal. The G2 checkpoint itself is therefore **FAIL**, not
PASS; see
[`20260806-g2-falsification-baseline.md`](./receipts/20260806-g2-falsification-baseline.md).
