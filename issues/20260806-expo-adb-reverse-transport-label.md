# Expo supervisor rejects current adb reverse transport labels

**Status:** Open — source repair landed on main (`a951074e4`, 2026-08-07); only a
successor published release (a closure newer than 0.1.11) remains
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Expo CLI, Android routing, Packaging
**Date:** 2026-08-06
**Related:** LLP 0176 §G4, LLP 0181,
`issues/20260806-guide-gap-g4-live-0110-external-vector.md`

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
