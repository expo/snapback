# guide-gap: live 0.1.10 external Expo vector cannot run its generated app

**Status:** Open — 0.1.11 closes the initial vector; successor fixes and the
release-leak repair remain unpublished
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Packaging, Runtime, Expo, Code generation, Guide, Release exports
**Date:** 2026-08-06
**Related:** LLP 0176 §G4, LLP 0181 E3/E4,
`issues/closed/20260803-first-npm-latest-promotion.md`,
`demos/expo-golden-path-fixture/receipts/20260806-g4-external-summary.md`

## Summary

The LLP 0176 G4 quarry used a clean external Expo 57 repository with only the
live public 0.1.10 packages and no source path, override, or monorepo edge.
Codegen succeeded, but both the iOS-simulator Air and Android-emulator mini
failed before Metro:

```text
SNAPBACK_CAPABILITY_UNSUPPORTED: target does not support required capability single_table_v1
```

The generated 0.1.10 descriptor requires that capability. The qualified public
runtime is release commit `b6afed6ef3eedd7be18e845e31b953da438ddc5a`; the
runtime activation repair landed later at
`f2b79cc6d457a5fbdad45427957ab2d328e4428c` and is not published. This is a
coherent-vector defect, not a consumer configuration error.

The same proof found five adjacent external-path defects:

1. Public `@expo/snapback-expo@0.1.10` has no ImagePicker source adapter or
   provider registration, while the guide tells callers to pass the picker
   asset directly. The source repair landed later at
   `47b4a59ace9a0638a71cba69ee31c9ce9d4c8303`; the direct call also fails the
   published TypeScript type.
2. The guide states registry constraints but gives no complete public install
   command. `snapback new` scaffolds a whole project, so adding the conventional
   backend to an already-created Expo root requires an undocumented sibling
   scaffold/copy decision.
3. A blank Expo scaffold's broad TypeScript include reaches generated Contract
   `.ts` projections that import undocumented `@exact/contract/exports`; the
   published React template avoids this by narrowing its source include.
4. Both release Hermes bundles retain
   `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` and
   `/_snapback/expo/v1/bootstrap`. No concrete bearer or origin leaked, but G4
   requires the development endpoint shape absent from the release artifact.
5. `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` is immediately intelligible at
   runtime but has no exact match in public-guide search.

## Disposition

Do not patch the external proof with checkout bytes: that would destroy the
distribution evidence. Main already contains the runtime capability and Expo
picker repairs, but they remain **fixed on main / awaiting release**. This G4
worktree fixes the stale ImagePicker recipe link, exposes the 0.1.10 caveat and
exact identity diagnostic, and adds a retrieval regression seed; those guide
changes still await the user's landing and a later packaged guide. The paved
registry scaffold/install path and broad generated-source TypeScript boundary
remain open. The release export must either tree-shake the supervised carrier
or use a release-only entry that cannot retain its endpoint vocabulary.

## 0.1.11 rerun — 2026-08-06

The byte-verified live 0.1.11 vector closes the original runtime-capability,
ImagePicker adapter/type, and exact diagnostic-search findings. The external
Air reached `G4_IOS_PASS`. The mini reached `G4_ANDROID_PASS` only after a
transparent adb wrapper normalized current adb's selected-device transport
label; the raw published supervisor rejected its own installed reverse rules.
The registry path therefore remains a G4 FAIL, not a conditional pass.

The rerun found three additional distribution defects, each split into a
focused ticket:

- [`20260806-guide-gap-external-residue-portability.md`](./20260806-guide-gap-external-residue-portability.md)
  — an undocumented host-pinned sibling restore lock crossed hosts and also
  entered the first EAS stage.
- [`20260806-expo-adb-reverse-transport-label.md`](./20260806-expo-adb-reverse-transport-label.md)
  — `adb -s ... reverse --list` reports `host-16`, not the selected serial.
- [`20260806-expo-config-plugin-eas-root-export.md`](./20260806-expo-config-plugin-eas-root-export.md)
  — EAS CLI cannot resolve the documented 0.1.11 package-root plugin entry;
  the public `./app.plugin` subpath works.

The source worktree repairs those three and adds focused tests, but no
registry byte changed. Both 0.1.11 Hermes exports still contain one bootstrap
path constant, one supervisor-origin environment symbol, one `localhost`, and
one `10.0.2.2` host literal per OS, so the existing release-leak item remains
open. The ruled ceremony reached
`m1 = 112/7/4` and `m2 = 112/7/4`; the dated 0.1.11 receipts retain the exact
timing and bakeoff asymmetry.

## Acceptance

- Publish one coherent package vector containing the `single_table_v1`
  runtime activation and Expo picker adapter.
- From an empty external Expo repository, follow one documented registry
  install/scaffold flow with no file path or override.
- Type-check direct `commands.send({ image: picked })` without consumer casts
  or an undocumented Exact dependency.
- Reach `G4_IOS_PASS` and `G4_ANDROID_PASS` over loopback/port-forward only,
  with the G4 receipts still explicitly not claiming LLP 0064 until a physical
  device path exists.
- Make release exports free of supervisor origin/bootstrap endpoint symbols
  and secret material.
- Make the exact binding-identity diagnostic searchable in the public guide.
- Rerun the frozen ceremony measurement, then close this ticket with the
  successor release and G4 receipts.
