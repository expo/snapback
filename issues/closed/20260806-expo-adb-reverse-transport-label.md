# Expo supervisor rejects current adb reverse transport labels

**Status:** Closed 2026-08-09 — repair `a951074e4`, first published in `0.1.12`,
verified present in the `0.1.15` registry bytes
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Expo CLI, Android routing, Packaging
**Date:** 2026-08-06
**Related:** LLP 0176 §G4, LLP 0181,
`../20260806-guide-gap-g4-live-0110-external-vector.md`

## Finding

On the fleet mini, current adb successfully installs each selected-emulator
reverse rule, but this scoped inventory:

```text
adb -s emulator-5554 reverse --list
host-16 tcp:4287 tcp:4287
```

uses a transport label in column one. Published
`@expo/snapback-cli@0.1.11` requires that column to equal `emulator-5554`,
reports `SNAPBACK_EXPO_ADB_REVERSE_FAILED`, rolls the rules back, and never
launches the app.

## Source repair in this worktree

`installAndroidPortForwarding` now treats the listing as belonging to the
already selected `adb -s <serial>` device and verifies its device/host port
pairs independently of the transport label. The forwarding test uses
`host-16` and still pins exact verify, rollback, idempotent removal, and
readiness behavior.

The external proof used a transparent adb wrapper only to complete app-level
image-send observation. Because the raw registry command fails, that marker
does not turn G4 into a pass.

## Acceptance

- The focused forwarding suite accepts both transport-token and legacy serial
  labels while still refusing a missing/mismatched rule.
- A successor public CLI reaches Android readiness on the mini without a
  wrapper and reclaims all three rules.

## 2026-08-07 landing note

The transport-label-tolerant verify repair described above landed on main in
`a951074e4` (the 0.1.11 G4 rerun landing). No published registry byte has
changed; this ticket closes when the next promoted closure ships the repair
and the G4 rerun reclaims the acceptance.

## Resolution (2026-08-09) — published in 0.1.12, verified in 0.1.15

**Resolving commit:** `a951074e47839c741663f4f496178c3c6c0738a2`
(2026-08-06 18:12 PDT).
**First published version:** `0.1.12`. That closure was built from revision
`fad3d53922e920d9cdc23a2b5b9cad84e3c872c0`
(`~/snapback-release-ledgers/fastpath-ledger-0.1.12-fad3d53922.json`), of which
`a951074e4` is an ancestor. Four successor closures now exist — 0.1.12, 0.1.13,
0.1.14, 0.1.15 — and `latest` is `0.1.15`
(`~/snapback-release-ledgers/fastpath-ledger-0.1.13-b975f003bc.json`,
`fastpath-ledger-0.1.15-d8d16068f0.json`; there is no retained fast-path ledger
file for 0.1.14, only `candidate-0.1.14/` and its publish logs).

**Registry spot-check (2026-08-09).** `npm pack @expo/snapback-cli@0.1.15` and
reading `expo-dev.mjs` from the tarball: the reverse-rule verification treats
the `adb -s <serial> reverse --list` output as already selected-device scoped
and reads the row's first column as a transport label rather than requiring it
to equal the serial. The published bytes carry the repair's own comment —
"`adb -s <serial> reverse --list` is already selected-device scoped. Current
adb can label each three-column row with a transport token" — and bind
`transport: fields[0]` while verifying the device/host port pairs.
`SNAPBACK_EXPO_ADB_REVERSE_FAILED` is retained for genuinely
missing/mismatched rules.

**What this close does not claim.** The second acceptance bullet — a successor
public CLI reaching Android readiness on the mini with no wrapper, reclaiming
all three rules — is a live two-host measurement, not a byte fact, and it has
not run. It is the LLP 0176 G4 rerun's acceptance and is tracked there
(`../20260806-guide-gap-g4-live-0110-external-vector.md`) and in the lane claim
(`../20260809-g4-rerun-lane-plan.md`), rather than being double-tracked here.
The first acceptance bullet — the focused forwarding suite accepting both label
forms while still refusing a missing rule — landed with `a951074e4`.
