# LLP 0176 G4 external 0.1.16 — Android emulator receipt — 2026-08-09

## Verdict and claim boundary

The raw registry-only Android supervisor arm is **FAIL**, for a different
reason than at 0.1.11. The 0.1.11 failure was the adb selected-device
transport label; this run never reached the adb stage at all, because the
published 0.1.16 runtime refuses the generated backend first:

```text
SNAPBACK_CAPABILITY_UNSUPPORTED: target does not support required capability single_table_v1
```

No wrapper of any kind was used, and none would have helped. This is Android
**emulator** evidence and is explicitly **NOT an LLP 0064 claim**. No physical
Android-device evidence path ran.

## Host, carrier, and public runtime

- Fleet host: mini at `ccheever@100.106.94.95`, macOS 26.6.1 — the same host
  as the 0.1.11 Android leg.
- Emulator: AVD `Medium_Phone_API_36.0`, Android 16 / API 36,
  `emulator-5554`, `product:sdk_gphone64_arm64`, `transport_id:1`.
- Cold install: `bun install --frozen-lockfile` from the public external lock,
  478 packages in 7.38 s, under Node 24.18.0 selected explicitly with
  `volta run --node 24.18.0` (the host default is Node 22).
- Packaged runtime: public `@expo/snapback-runtime-darwin-arm64@0.1.16`,
  release identity `ee21fa4a82c5486e1e4abf48e67a1745e7316e83`.

The external transport excluded `.git`, `node_modules`, `.snapback`, the
sibling restore lock, and export output.

## Raw public-supervisor run

The command used the public binary and selected the exact emulator, with no
wrapper on `PATH`:

```sh
volta run --node 24.18.0 npx snapback dev snapback \
  --expo --expo-dir . --expo-platform android \
  --android-serial emulator-5554 \
  --db .snapback/g4-android-0116.sqlite3 \
  --ready-file .snapback/g4-android-0116.ready.json \
  --email g4-android-0116@snapback.test --json
```

The retained stream is
[`20260809-g4-external-0116-android-supervisor.jsonl`](./20260809-g4-external-0116-android-supervisor.jsonl)
(SHA-256
`baded89c7d666593c810e42537c469eda410e8f442fef0dae90d299c9f58214e`). It
records:

- `starting`, platform `android`;
- `device-selected`, `{"serial":"emulator-5554","class":"emulator"}` — the
  selected-device identification itself is correct;
- `startup-failed`, `SNAPBACK_DEV_SERVER_START_FAILED`, `status: 5`, with the
  same `SNAPBACK_CAPABILITY_UNSUPPORTED` stderr.

The published supervisor starts the backend **before** installing adb reverse
rules (`packages/snapback-cli/expo-dev.mjs`: `starting` → `device-selected` →
backend events → port-forward planning). Because the backend never became
ready, zero reverse rules were installed, zero were verified, and the arm the
0.1.11 rerun failed was never reached.

## The 0.1.11 adb finding, retested as far as it can be

The 0.1.12 transport-label repair could not be executed end to end, so it was
tested as directly as the blocked run allows:

1. **Current adb still produces the problematic shape.** Installing one rule
   by hand against the same selected emulator:

   ```text
   $ adb -s emulator-5554 reverse tcp:4287 tcp:4287
   $ adb -s emulator-5554 reverse --list
   host-16 tcp:4287 tcp:4287
   ```

   The transport label is still `host-16`, not `emulator-5554`. The rule was
   removed again and `reverse --list` returned empty.

2. **The published 0.1.16 verification tolerates that shape.** The installed
   `@expo/snapback-cli@0.1.16` `expo-dev.mjs` parses a three-column row as
   `{ serial: plan.androidSerial, transport: fields[0], device: fields.at(-2),
   host: fields.at(-1) }` and matches on the device/host port pair, treating
   the first column as an opaque transport label. Applied to the observed row
   it yields `{serial: 'emulator-5554', device: 'tcp:4287', host: 'tcp:4287'}`,
   which satisfies the installed-rule check that 0.1.11 failed.

That is inspection of published bytes against real current-adb output, not a
live end-to-end proof. **The Android acceptance bullet — "the raw published
supervisor reaches Android readiness with no adb wrapper and reclaims all
three reverse rules" — remains unproved**, and stays open for the successor
rerun.

## What was and was not exercised

| Chain step | Result |
| --- | --- |
| Cold install from the public lock under Node 24 | PASS |
| Emulator boot, API 36 | PASS |
| Supervisor device selection (`emulator-5554`) | PASS |
| Backend readiness | **FAIL** |
| adb reverse installation / verification / reclamation | not reached |
| Metro / bootstrap, Expo Go launch | not reached |
| Provider, live query, picker, commit, render | not reached |

No screenshot exists: Expo Go was never launched and the emulator showed its
launcher throughout.

## Cleanup

`pkill -f "snapback dev"` matched nothing (the supervisor had already exited).
The hand-installed reverse rule was removed and verified absent before the
emulator was killed (`adb emu kill`, then `adb kill-server`). The app copy,
supervisor log, emulator log, installer log, `~/.maestro`, and the
run-scoped `~/g4-jdk` Temurin 21 installation were all removed. Independent
`pgrep` found no `qemu-system`, `emulator`, `adb`, or `snapback` process
remaining.
