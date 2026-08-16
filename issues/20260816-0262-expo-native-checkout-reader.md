# Add the first-party Expo native checkout reader

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 2
**Confidence:** 5
**Systems:** React/Expo, Local server lifecycle, Developer experience, Security, Auth, Packaging
**Date:** 2026-08-16
**Governing:** LLP 0262 D2, LLP 0262 D5
**Related:** `packages/snapback-cli/expo-dev.mjs`,
`packages/snapback-expo/supervised-environment.mjs`

## Problem

LLP 0262 D2 assigns packaged native Expo targets a one-shot,
startup-nonce-bound dev-identity checkout delivered through native launch
channels. Stage-1 lane C landed and tests the supervisor-side protocol: nonce
issuance and startup binding, the native-only redemption endpoint, one-shot
consumption, rotation invalidation, bootstrap secrecy, web-origin refusal, and
iOS/Android launch-command construction.

Two independent reviews found that the app-side carrier is not implemented.
`SIMCTL_CHILD_*` values and `adb shell am start --es` extras do not reach Expo
JavaScript by themselves; Expo inlines only `EXPO_PUBLIC_*` process values, and
nothing currently installs the documented `globalThis` checkout hooks. The
default launcher also targets Expo Go, which cannot host a custom native
reader. Treating the current command construction as a working end-to-end
carrier would therefore be an infeasible claim.

Lane C has been rescaled honestly: ordinary supervised sessions remain the
unconditional path, while checkout issuance and the native launcher are
default-off behind an explicit protocol opt-in/test hook. The supervisor-side
protocol and one-shot redemption remain landed and fully tested behind that
opt-in.

## Required implementation

Build a first-party development-client native module and config plugin that:

- reads `ProcessInfo.processInfo.environment` on iOS and the launch `Intent`
  extras on Android;
- installs the value into the documented `globalThis` checkout hook before
  application JavaScript boots;
- never copies the nonce into `EXPO_PUBLIC_*`, served Metro modules, durable
  config, logs, or browser-readable bootstrap state;
- launches the application's own development-client bundle identifier and
  Android component, not Expo Go; and
- handles backend rotation by accepting a fresh native delivery for the new
  startup nonce without reusing checkout state from the prior boot.

## Witnesses

Retain real end-to-end receipts for every supported LLP 0262 D2 NATIVE row:

1. iOS simulator: native launch environment → pre-JS hook → one-shot redeem →
   dev-identity-capable client.
2. Android emulator: launch `Intent` extra → pre-JS hook → one-shot redeem.
3. Android physical device over USB with the exact per-serial `adb reverse`
   route and launch extra.
4. Negative witnesses showing Expo web and tunneled raw HTTP cannot redeem the
   nonce, plus replay and post-rotation refusal.

Simulator/emulator command-unit tests are not substitutes for these live
witnesses. If USB hardware is unavailable, the Android USB row remains an
explicit nonclaim rather than being inferred from emulator behavior.

## Rollout constraint

LLP 0262 D5 stage-2 enforcement cannot include the packaged Expo NATIVE row
until this reader, own-bundle launch path, and the real simulator/emulator/USB
witnesses land. The already-landed supervisor protocol may continue to evolve
behind its explicit opt-in, but it does not satisfy the D2 carrier row alone.

