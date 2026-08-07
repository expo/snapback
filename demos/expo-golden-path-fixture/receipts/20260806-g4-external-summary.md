# LLP 0176 G4 external distribution attempt against live 0.1.10 — 2026-08-06

## Verdict

G4 **does not pass** against the live public 0.1.10 vector. The external
repository is clean and registry-only; generation, Metro closure, local Expo
exports, and EAS stage-only inspection work. Both platform runs stop before
Metro because the public generated descriptor requires `single_table_v1` and
the public runtime rejects that capability. The published Expo facade also
lacks the documented ImagePicker adapter, and release bundles retain two
supervised-development symbols.

This proof consumes the 0.1.10 publication provenance exactly as closed by
[`issues/closed/20260803-first-npm-latest-promotion.md`](../../../issues/closed/20260803-first-npm-latest-promotion.md):
ten public tarballs on npm `latest`, byte-identical to the retained
`fastpath-ledger-0.1.10-b6afed6ef3.json`, with the same LLP 0041
pre-consumer fast-path disposition as 0.1.9. Client bundle metrology was green
on main before this run. This receipt cites that close-out and does not
re-litigate it.

## Install and scaffold path

1. Created and `git init`-ed
   `/Users/ccheever/projects/snapback-g4-external` outside this monorepo.
2. Ran `npx create-expo-app@latest . --template blank-typescript --yes`, which
   selected Expo 57.0.11, React 19.2.3, and React Native 0.86.2.
3. Installed public packages by name only:
   `@expo/snapback-cli@0.1.10`, `@expo/snapback-codegen@0.1.10`,
   `@expo/snapback-react@0.1.10`, `@expo/snapback-expo@0.1.10`, and
   `expo-image-picker` through `npx expo install`. Contract remained
   transitive, as the guide requires.
4. `snapback new` only creates a whole project and will not add a backend to an
   existing Expo root. The published `react` template was therefore generated
   in a clean sibling evidence directory and its conventional `snapback/`
   child copied into the external app before authoring the conversation
   backend and screen.
5. Generated one app descriptor and ran `snapback dev --expo` from the
   registry-only install on each fleet host.

The guide supplied the component model and registry constraints, but not a
complete external registry install command or a one-command way to add the
backend to an existing Expo app. Those deviations count as findings rather
than hidden setup.

## Frozen metric and measured result

The counting rule was frozen before the external directory existed in
[`20260806-g4-external-metric-frozen.md`](./20260806-g4-external-metric-frozen.md)
and is labeled **proposed metric, author sign-off pending**.

| Point | Commands `C` | hand-edited files `F` | decisions `D` | `A` | Wall clock |
| --- | ---: | ---: | ---: | ---: | --- |
| First public-runtime blocker | 73 | 6 | 3 | 82 | approximately 11 minutes after `t0` |
| `m1`: first rendered live query | not reached | — | — | — | not reached |
| `m2`: committed and rendered image send | not reached | — | — | — | not reached |

The six files were schema, functions, seed, `app.json`, `App.tsx`, and
`tsconfig.json`. The decisions were the undocumented package set, the sibling
full-project scaffold workaround, and narrowing TypeScript away from generated
Contract source files that otherwise require undocumented
`@exact/contract/exports`. The complete recountable sequence remains in the
external repository's `G4-ACTION-LEDGER.md`.

No `C/F/D` vector can be synthesized for Diaries 0058/0059/0060. Diary 0058's
full-app lanes were 26m03s Snapback versus 11m15s Convex and included debugging,
proofs, bundle/offline work, and tickets rather than these milestones. Diary
0059 supplies line counts and two paid EAS successes but no time or command
log. Diary 0060 supplies roughly 15–20+ minute orchestration-agent spans, not
app authoring. G4 failed before `m1` at roughly the duration of Diary 0058's
entire Convex lane; that comparison is directional only, not like-for-like.

## Guarantees ledger

| Guarantee | Result against public 0.1.10 |
| --- | --- |
| Settled Sessions auth | Present in authored schema and generated descriptor; provider adoption not proved because startup failed. |
| Loopback-only listeners | No dev listeners were created before failure; a successful carrier was not proved. |
| Typed contracts and one descriptor | Generation proved one typed surface/command descriptor; direct ImagePicker typing and generated Contract-source compilation failed. |
| Retained cold boot | Missing; no first current query existed. |
| Truthful command residue | Missing; the command could not run. |

## Platform, closure, and diagnosis results

| Gate | Result |
| --- | --- |
| iOS simulator | **FAIL**, no `G4_IOS_PASS`: pre-Metro `single_table_v1` refusal. [Receipt](./20260806-g4-external-ios-simulator.md). |
| Android emulator | **FAIL**, no `G4_ANDROID_PASS`: identical refusal under Node 24.18.0. [Receipt](./20260806-g4-external-android-emulator.md). |
| Metro closure | **PASS**: 653-source inspection map; Snapback sources only from app-generated files and public `node_modules`. |
| EAS stage-only | **PASS** for staging: 47 files / 0.87 MiB, app plus registry manifest/lock and generated backend only. No paid EAS build. |
| Release-shape dev leakage | **FAIL**: no bearer or concrete origin, but both HBC bundles retain `/_snapback/expo/v1/bootstrap` and `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN`. |
| Diagnosis probe | Structured wrong-identity refusal in 2 ms; developer diagnosis in 30 s. Exact diagnostic code absent from public-guide search. |

Closure and diagnosis detail is in
[`20260806-g4-external-closure-and-diagnosis.md`](./20260806-g4-external-closure-and-diagnosis.md).

## Defects and release boundary

The umbrella finding is
[`issues/20260806-guide-gap-g4-live-0110-external-vector.md`](../../../issues/20260806-guide-gap-g4-live-0110-external-vector.md).

- `single_table_v1`: source fix landed on main at `f2b79cc6d457a5fbdad45427957ab2d328e4428c`
  but is absent from public 0.1.10.
- Expo picker adapter: source fix landed on main at
  `47b4a59ace9a0638a71cba69ee31c9ce9d4c8303` but is absent from public
  0.1.10. The published package has neither its module nor provider
  registration; the documented direct picker call also fails TypeScript.
- Fixed in this worktree: the source guide now warns that public 0.1.10 is not
  a usable external baseline, points to the typed ImagePicker command recipe,
  documents `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`, and carries a retrieval
  regression seed. Those source-guide fixes are not in 0.1.10's embedded
  guide.
- Still open: a paved external registry scaffold/install command, the broad
  Expo TypeScript include reaching Exact-only generated source, and removal of
  supervised-development symbols from release exports.

Because the two runtime fixes are unpublished, G4 cannot be repaired or rerun
green against the registry as-is. It awaits the next coherent public release.

## Explicit nonclaims and retained evidence

This receipt makes **no LLP 0064 claim**: the only platform evidence is an iOS
simulator and Android emulator, and no physical-device path exists. It makes
no real EAS-build claim (the paid build awaits author approval), no published
package release-artifact claim beyond local `expo export`, and no G4 pass
claim. The external repository and its local evidence copies remain intact;
task-owned fleet simulators/emulators, reverse rules, listeners, adb daemon,
and remote temp directories were removed.
