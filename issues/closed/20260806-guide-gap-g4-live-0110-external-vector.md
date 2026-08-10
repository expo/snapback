# guide-gap: live 0.1.10 external Expo vector cannot run its generated app

**Status:** Resolved 2026-08-10 — the 0.1.17 G4 external re-rerun reached both
frozen milestones on both platforms; see the closing section at the end
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

- [`closed/20260806-guide-gap-external-residue-portability.md`](./closed/20260806-guide-gap-external-residue-portability.md)
  — an undocumented host-pinned sibling restore lock crossed hosts and also
  entered the first EAS stage.
- [`closed/20260806-expo-adb-reverse-transport-label.md`](./closed/20260806-expo-adb-reverse-transport-label.md)
  — `adb -s ... reverse --list` reports `host-16`, not the selected serial.
- [`closed/20260806-expo-config-plugin-eas-root-export.md`](./closed/20260806-expo-config-plugin-eas-root-export.md)
  — EAS CLI cannot resolve the documented 0.1.11 package-root plugin entry;
  the public `./app.plugin` subpath works.

The source worktree repairs those three and adds focused tests, but no
registry byte changed. Both 0.1.11 Hermes exports still contain one bootstrap
path constant, one supervisor-origin environment symbol, one `localhost`, and
one `10.0.2.2` host literal per OS, so the existing release-leak item remains
open. The ruled ceremony reached
`m1 = 112/7/4` and `m2 = 112/7/4`; the dated 0.1.11 receipts retain the exact
timing and bakeoff asymmetry.

## Guide absorption — 2026-08-07

The guide-gap half of this ticket is absorbed (verified against main
`f4d4d8c18`); the remaining acceptance items are release engineering, so the
ticket stays open. What the guide now covers:

- `guide/clients/react-expo.md` documents the complete public
  `npx expo install` command with the coherent `^0.1.11` vector, the sibling
  `snapback new --template react` scaffold-and-copy flow (named as a known
  limitation, not a hidden `snapback init`), the external tsconfig include
  boundary — now naming the literal `@exact/contract/exports` specifier so
  the blank-scaffold tsc failure greps — the "Published 0.1.11 boundary"
  banner (runtime-capability/ImagePicker repairs in 0.1.11; adb `host-16`
  transport-label refusal via `SNAPBACK_EXPO_ADB_REVERSE_FAILED`; the EAS
  `"@expo/snapback-expo/app.plugin"` subpath spelling; release exports still
  retaining supervised endpoint vocabulary), the
  `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` diagnosis section, and the
  restore-lock/`.snapback/` ignore rule.
- `guide/retrieval-eval.md` seed 8 pins the binding-identity diagnostic
  search so the discoverability fix cannot silently regress.

Still open here (not docs): publish one successor package vector carrying
the adb transport-label repair and the CommonJS config-plugin root, rerun the
frozen ceremony, then close with the successor G4 receipts. The three split
tickets track their own repairs. The release-export vocabulary source repair
landed 2026-08-07 (below); its registry bytes ship with the successor
publication.

## Release-export vocabulary repair — 2026-08-07

The source repair for the release-leak arm is on main. Mechanism: every
vocabulary-bearing branch of the supervised carrier is now gated behind a
literal inline `process.env.NODE_ENV !== 'production'` test — the canonical
shape Metro's production transform (inline plugin + constant-folding plugin,
applied to every module when `dev === false`, before dependency collection
and Hermes compilation) prunes, the same mechanism that strips React's
development code from release bundles. Gated sites:

- `packages/snapback-expo/supervised-environment.mjs`: the
  `SUPERVISED_EXCHANGE_PATH` literal, the supervisor-origin runtime lookup
  (`globalThis.__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__` and
  `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN`), and the device-local host check
  (`localhost`/`[::1]`/`10.0.2.2`/127.x).
- `packages/snapback-expo/app-binding.mjs`: the loopback/emulator host
  helpers feeding only the supervised-dev validation arm.

Production semantics: the supervised environment is inert in release bundles
— `resolveBinding` fails with the existing coded
`SNAPBACK_APP_BINDING_UNAVAILABLE`, and an explicit `exchangeOrigin` fails
with `SNAPBACK_EXPO_BOOTSTRAP_ORIGIN_INVALID` — matching LLP 0181's rule that
the provider refuses supervised-dev bindings under the production condition
(dated amendment added to LLP 0181 §Package contract). Development behavior
is byte-for-byte unchanged (`NODE_ENV` is unset/`development` there).

Verification (all executed 2026-08-07):

- Committed executable proof
  `packages/snapback-expo/release-export-vocabulary.test.mjs` (wired into the
  package test chain and the test inventory): esbuild-bundles the package
  entry (`packages: 'external'`, exactly the package's own release graph) and
  asserts the four G4 symbols plus `__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__`,
  `[::1]`, and the 127.x regex are absent under production defines (minified
  and constant-folded-only profiles) and that all four G4 symbols are present
  under development defines.
- One-off Metro-mechanism evidence run against the real plugins
  (`metro-transform-plugins@0.84.4`, the Expo 57 / RN 0.86 family): applying
  `inlinePlugin` + `constantFoldingPlugin` with `dev: false` to both gated
  files leaves all five symbols absent; the same transform over the pre-fix
  `HEAD` source retains all four G4 symbols, and the fixed source under a dev
  transform retains them — the measurement discriminates in both directions.
  Recipe: babel `transformSync` with
  `[[inlinePlugin, {dev:false, platform:'ios', inlinePlatform:true}], [constantFoldingPlugin, …]]`.
- Caveat recorded honestly: a bundler that performs no constant folding at
  all retains the branches (verified: esbuild with no minify flags). Metro's
  production pipeline always applies these plugins, but the byte-level
  confirmation on real `expo export` HBC output — the receipts' original
  strings-scan measurement — remains for the successor-release G4 rerun,
  which this arm's acceptance already awaits.

## Publication state — 2026-08-09 (still open; the rerun is what closes it)

Four successor closures now exist and every repair this ticket was waiting on
is in published registry bytes. The ticket stays open because its remaining
acceptance is a live external measurement, not a byte fact.

| Repair | Commit | First published | Verified in 0.1.15 |
| --- | --- | --- | --- |
| adb transport-label-tolerant reverse verify | `a951074e4` | 0.1.12 | `@expo/snapback-cli@0.1.15` `expo-dev.mjs` reads the row's first column as a transport label and verifies the device/host port pairs |
| CommonJS config-plugin package root | `a951074e4` | 0.1.12 | `@expo/snapback-expo@0.1.15` exports `"." → { "require": "./app.plugin.js", "import": "./index.mjs" }` |
| Portable-residue guide rule and stage exclusions | `a951074e4` | 0.1.12 | the 0.1.12 closure corpus (`fad3d53922`) carries the `.snapback/` + `*.snapback.restore.lock` rules |
| Release-export supervised-vocabulary prune | `c5a18506d` | 0.1.13 | `@expo/snapback-expo@0.1.15` gates five sites in `supervised-environment.mjs` and two in `app-binding.mjs` behind `process.env.NODE_ENV` |

The three split tickets are therefore closed
([residue](./closed/20260806-guide-gap-external-residue-portability.md),
[adb label](./closed/20260806-expo-adb-reverse-transport-label.md),
[EAS root export](./closed/20260806-expo-config-plugin-eas-root-export.md)),
each with its resolving commit and first-published version. Their live-rerun
halves were not carried over into those closes; they are the acceptance bullets
below.

What is still unproved, and only a rerun can prove:

- the raw published Android supervisor reaching readiness on the mini with no
  adb wrapper;
- noninteractive EAS project linking against the bare package-root spelling;
- a byte-level strings scan of real `expo export` HBC output showing the four
  supervised-vocabulary symbols absent — the prune repair's own verification
  note deferred exactly this measurement to the successor release;
- cold retained relaunch with the backend paused; and
- the remeasured frozen OQ5 ceremony vector.

The rerun and the 0.1.16 cut it consumes are claimed in
[`20260809-g4-rerun-lane-plan.md`](./20260809-g4-rerun-lane-plan.md). Do not
start either lane without editing that ticket first.

## 0.1.16 rerun — 2026-08-09 — still open, and the blocker moved

The fresh-quarry rerun against live 0.1.16 ran and **failed earlier than the
0.1.11 rerun did**. Full receipts:
[summary](../demos/expo-golden-path-fixture/receipts/20260809-g4-external-0116-summary.md),
[iOS](../demos/expo-golden-path-fixture/receipts/20260809-g4-external-0116-ios-simulator.md),
[Android](../demos/expo-golden-path-fixture/receipts/20260809-g4-external-0116-android-emulator.md),
[closure/exports/EAS/diagnosis](../demos/expo-golden-path-fixture/receipts/20260809-g4-external-0116-closure-diagnosis.md).

What this ticket's five unproved items did:

| Unproved item | 0.1.16 result |
| --- | --- |
| Raw published Android supervisor reaching readiness with no adb wrapper | **Still unproved** — the run never reached the adb stage. The repair is confirmed only by inspecting published bytes against live `host-16 tcp:4287 tcp:4287` output. |
| Noninteractive EAS linking on the bare package-root spelling | **CLOSED** — `eas init --non-interactive --force` created and linked `@ccheever/snapback-chat` with `"plugins": ["@expo/snapback-expo"]`. |
| Byte-level strings scan of real `expo export` HBC output | **CLOSED on attribution** — `/_snapback/expo/v1/bootstrap`, `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN`, and `10.0.2.2` all absent on both platforms; the single surviving `localhost` is present in an identical count in a Snapback-free control export. |
| Cold retained relaunch with the backend paused | **Still unproved and untestable** — nothing booted. The dev-path/release-path scoping question is routed to LLP 0181's owner in [`20260809-g4-cold-boot-arm-dev-vs-release-path.md`](./20260809-g4-cold-boot-arm-dev-vs-release-path.md). |
| Remeasured frozen OQ5 vector | **Measured to the blocker only** — `C/F/D = 50/0/2` about 5–7 minutes after `t0`; `m1` and `m2` not reached. |

Every 0.1.11 **authoring** finding in this ticket's summary is now absorbed by
the published `expo-chat` template: the missing complete install command, the
sibling scaffold-and-copy ceremony, the broad TypeScript include, and the
missing store registration all disappear. `npm create snapback-app` reaches a
generated, type-checking Sessions chat app in 1 m 29 s with **zero** hand-edited
files.

The ticket stays open because a **new blocking packaging regression** replaced
the old blockers: the published 0.1.16 runtime packages omit
`bin/packaged-store-qualification.receipt.json`, so the public-package runtime
cannot advertise `single_table_v1` and no generated app starts — the same
`SNAPBACK_CAPABILITY_UNSUPPORTED` class of failure this ticket was originally
opened for at 0.1.10. It is tracked in
[`20260809-runtime-package-missing-store-qualification-receipt.md`](./20260809-runtime-package-missing-store-qualification-receipt.md),
with two smaller consumer defects in
[`20260809-guide-gap-npx-snapback-new-resolves-wrong-package.md`](./20260809-guide-gap-npx-snapback-new-resolves-wrong-package.md)
and
[`20260809-expo-chat-template-gitignore-restore-lock.md`](./20260809-expo-chat-template-gitignore-restore-lock.md).

Close this ticket when a successor closure starts a generated app and the
retained quarry
(`~/snapback-release-ledgers/g4-external-0116-quarry-20260809.tar.gz`) reruns
the ceremony to `m1` and `m2`.

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

## 0.1.17 re-rerun — 2026-08-10 — **CLOSED**

The successor closure starts a generated app and the frozen ceremony reached
both milestones. Against this ticket's own five unproved items:

| Unproved item | 0.1.17 result |
| --- | --- |
| Raw published Android supervisor reaching readiness with no adb wrapper | **PROVED** — 3 reverse rules installed, verified, and reclaimed against real `host-16` output, no wrapper on `PATH` |
| Noninteractive EAS linking on the bare package-root spelling | **Remains closed** — reconfirmed on 0.1.17 |
| Byte-level strings scan of real `expo export` HBC output | **Remains closed on attribution** — re-run on freshly built 0.1.17 bytes with a fresh Snapback-free control export, not inherited from 0.1.16 |
| Cold retained relaunch with the backend paused | **Still not proved** — cold relaunch stayed at boot `starting` for over two minutes and rendered only after resume, reproducing 0.1.11 exactly. Tracked in [the scoping ticket](./20260809-g4-cold-boot-arm-dev-vs-release-path.md), which stays open. |
| Remeasured frozen OQ5 vector | **Measured to both milestones** — `m1 = 14/0/3` at 8 m 22 s, `m2 = 22/0/3` at 15 m 11 s after `t0`, `F = 0` |

Against this ticket's acceptance list: one coherent vector carries the runtime
activation and picker adapter; one documented registry flow reached a running
app from an empty directory with no file path or override; the direct
`commands.send({ image })` type-checks with no consumer cast (`tsc --noEmit`
clean); both `G4_IOS_PASS` and `G4_ANDROID_PASS` were reached over
loopback/port-forward only with the LLP 0064 nonclaim held; release exports are
free of supervisor origin/bootstrap vocabulary and of secret material; and the
binding-identity diagnostic resolves to a correct public-guide anchor in 1 s.

**Closing this ticket.** Its remaining live descendants are tracked separately
and are not folded in here: the cold-boot scoping question, the guide's
fresh-app command, the template `.gitignore`, and the capability-refusal
diagnosability gap.

Receipts:
[summary](../demos/expo-golden-path-fixture/receipts/20260810-g4-external-0117-summary.md),
[iOS](../demos/expo-golden-path-fixture/receipts/20260810-g4-external-0117-ios-simulator.md),
[Android](../demos/expo-golden-path-fixture/receipts/20260810-g4-external-0117-android-emulator.md),
[closure/exports/EAS/diagnosis](../demos/expo-golden-path-fixture/receipts/20260810-g4-external-0117-closure-diagnosis.md).
