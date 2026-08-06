# Expo golden-path fixture

This is the minimal LLP 0176 G1 fixture: one Sessions-mode backend, one live
query, one ordinary mutation, and one Expo screen booted by
`<SnapbackExpoProvider app={app}>` without a URL prop.

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

The screen automatically sends one mutation after the seeded live query is
ready, then renders `G1_IOS_PASS` or `G1_ANDROID_PASS` only after that row
returns through the live query. It also emits structured `SNAPBACK_G1_EVENT`
console markers for a simulator/emulator log receipt.

The dated real-device evidence is under [`receipts/`](./receipts/).
