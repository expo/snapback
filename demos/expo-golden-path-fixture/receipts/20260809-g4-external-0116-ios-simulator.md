# LLP 0176 G4 external 0.1.16 — iOS simulator receipt — 2026-08-09

## Verdict and claim boundary

The external iOS arm is **FAIL**. No `G4_IOS_PASS` marker exists, and no app
screen was rendered: the published supervisor refused between device selection
and backend readiness, before Metro started and before Expo Go was launched.

```text
SNAPBACK_CAPABILITY_UNSUPPORTED: target does not support required capability single_table_v1
```

The app used only the public registry lock; no checkout package, source
override, `file:`, workspace, link, or monorepo path entered the host copy.
This is iOS **simulator** evidence and is explicitly **NOT an LLP 0064 claim**.
No physical-device path exists in this run.

## Host substitution

The 0.1.11 iOS host — the Air at `100.70.173.122` — was offline in Tailscale
for the entire session (last seen about an hour before the lane was claimed;
confirmed by three connection attempts and by `tailscale status`). The
substitution was recorded in the lane-plan ticket before any ceremony command
ran.

- Fleet host: apartment `Charlie's MacBook Pro (2)` at `100.72.251.34`,
  MacBookPro18,2, Apple M1 Max, 64 GB, macOS 26.6, Xcode 26.6.
- Simulator: `Snapback-G4-iOS-20260809`, iPhone 17, iOS **26.4** — the same
  runtime version the 0.1.11 Air run used — UDID
  `AF239F9E-A7DB-4CEB-9576-8312C4CBF1E9`.
- Cold install: `bun install --frozen-lockfile` from the external registry
  lock, 478 packages in 9.37 s under Node 24.18.0.
- Packaged runtime: public `@expo/snapback-runtime-darwin-arm64@0.1.16`,
  release identity `ee21fa4a82c5486e1e4abf48e67a1745e7316e83`, binary
  SHA-256 `b764cb328e695f87d3f979b8450191b0fb85cad5f2091d3c76e5bb7bd56bfda9`
  — byte-matching the retained 0.1.16 fast-path ledger.
- App copy: `/private/tmp/snapback-g4-ios-0116` during the run; removed during
  cleanup.

Node 24.18.0 (via Volta) and Maestro 2.8.0 were installed on this host before
`t0` to match the 0.1.11 hosts' pre-existing baseline; both are disclosed in
the quarry ledger and excluded from the action vector. Maestro was never used —
the run never reached an app screen. `~/.maestro` was removed during cleanup;
Volta and Node 24.18.0 were left in place as a durable fleet toolchain and are
recorded here rather than hidden.

## Argument-surface finding

The first supervisor invocation used `--ios-simulator <udid>` and was refused:

```json
{"code":"SNAPBACK_CLI_ARGUMENT_INVALID","message":"unexpected dev arguments: --ios-simulator AF239F9E-A7DB-4CEB-9576-8312C4CBF1E9"}
```

The published flag is `--ios-udid`. The refusal is correct, typed, and names
the exact offending argument; the operator error is recorded as an author
command in the ledger rather than edited out. The corrected invocation dropped
the flag entirely and let the supervisor select the single booted simulator,
which it did.

## The blocking run

```sh
CI=1 npx snapback dev snapback \
  --expo --expo-dir . --expo-platform ios \
  --db .snapback/g4-ios-0116.sqlite3 \
  --ready-file .snapback/g4-ios-0116.ready.json \
  --email g4-ios-0116@snapback.test --json
```

Launched 16:36:47 PDT; the retained stream is
[`20260809-g4-external-0116-ios-supervisor.jsonl`](./20260809-g4-external-0116-ios-supervisor.jsonl)
(SHA-256
`1d5d06e712bcf1291ff122b31bb7931a6bee3002c292cd10c4b87f78786683e8`). It records
exactly three states and then the terminal envelope:

- `starting`, platform `ios`;
- `device-selected`, `{"serial":null,"class":"simulator"}`;
- `startup-failed`, `SNAPBACK_DEV_SERVER_START_FAILED` — "Snapback exited
  before writing …`g4-ios-0116.ready.json`", `status: 5`, stderr
  `Error: SNAPBACK_CAPABILITY_UNSUPPORTED: target does not support required
  capability single_table_v1`.

No listener was created, no port was bound, no Metro process started, and Expo
Go was never launched. There is consequently no screenshot: the simulator
displayed its home screen throughout, and photographing that would assert
nothing.

## What was and was not exercised

| Chain step | Result |
| --- | --- |
| Cold install from the public lock | PASS |
| Simulator create/boot on iOS 26.4 | PASS |
| Proof image installed into the photo library | PASS — `xcrun simctl addmedia`, 131,545-byte PNG, SHA-256 `c1a427d7ca0573719b8575e6d87127eb11509371ca7a1a7d72b1a58d600cb064` |
| Supervisor device selection | PASS |
| Backend readiness | **FAIL** |
| Loopback listener enumeration | not reached |
| Metro / bootstrap | not reached |
| Settled Sessions provider boot | not reached |
| Live query render (`m1`) | not reached |
| Picker selection, committed send, delivery, render (`m2`) | not reached |
| Retained cold relaunch | not reached |
| Truthful residue probe | not reached |

The root cause is packaging, not this host: the identical app refuses on the
control Mac and on the Android host, and the identical app boots on 0.1.15.
See the [closure and diagnosis receipt](./20260809-g4-external-0116-closure-diagnosis.md)
and
[`issues/20260809-runtime-package-missing-store-qualification-receipt.md`](../../../issues/20260809-runtime-package-missing-store-qualification-receipt.md).

## Cleanup

The supervisor had already exited; `pkill -f "snapback dev"` matched nothing.
The dedicated simulator was shut down and deleted, and the app copy, proof
image, supervisor log, installer log, and `~/.maestro` were removed.
Independent checks found no `snapback` process and no listener on the task
ports.
