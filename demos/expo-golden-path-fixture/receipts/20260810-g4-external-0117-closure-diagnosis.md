# LLP 0176 G4 external 0.1.17 — closure, exports, EAS, and diagnosis receipt — 2026-08-10

## Registry provenance

The external quarry is `/Users/ccheever/projects/snapback-g4-external-0117`, a
separate Git root created empty at `t0`. Neither the 0.1.11 quarry
(`snapback-g4-external`) nor the 0.1.16 quarry (`snapback-g4-external-0116`)
was read, reused, or mutated; both remain retained read-only evidence.

The app, `<quarry>/snapback-g4-chat`, was produced entirely by
`npm create snapback-app` from the published `expo-chat` template. The resolved
`bun.lock` holds exactly:

```text
@expo/snapback-cli@0.1.17
@expo/snapback-client@0.1.17
@expo/snapback-codegen@0.1.17
@expo/snapback-contract@0.1.17
@expo/snapback-expo@0.1.17
@expo/snapback-react@0.1.17
@expo/snapback-runtime-darwin-arm64@0.1.17
@expo/snapback-runtime-linux-x64@0.1.17
```

with **zero** `file:`, `link:`, or `workspace:` specifiers and no
`overrides`, `resolutions`, or `workspaces` key in the manifest. Contract is
present only as the client/codegen packages' own edge, as the guide requires.

The consumed vector is npm `latest` = 0.1.17 from source identity
`0e6bf1842ab291f2e68416fbf40bd2e6debb4290`, retained ledger
`~/snapback-release-ledgers/fastpath-ledger-0.1.17-0e6bf1842a.json`.

**The 0.1.16 blocking regression is repaired in the published bytes.** The
installed `@expo/snapback-runtime-darwin-arm64@0.1.17` carries
`bin/packaged-store-qualification.receipt.json` (2,377 bytes) alongside its
binary, and the receipt's `binaryIdentity` is bound to this exact build —
`crateVersion 0.1.0`, `gitCommit 0e6bf1842ab291f2e68416fbf40bd2e6debb4290`,
`gitDirty false`, `buildProfile release`, `buildDistribution public-package` —
not copied from 0.1.15. Both platform supervisors advertised `single_table_v1`
and started the generated backend. This receipt consumes that provenance and
does not reopen it.

## Metro closure from app plus public node_modules — PASS

Two release-shape exports with source maps completed from the app plus public
`node_modules`:

```sh
npx expo export --platform ios --output-dir dist-g4-ios-0117 --source-maps --clear
npx expo export --platform android --output-dir dist-g4-android-0117 --source-maps --clear
```

| OS | Sources | `node_modules` | App/generated | Metro virtual |
| --- | ---: | ---: | ---: | ---: |
| iOS | 675 | 663 | 12 | 1 |
| Android | 673 | 661 | 12 | 1 |

The twelve non-package sources are two Metro polyfills
(`polyfill:external-require`, `polyfill:assets-registry`), `App.tsx`, six `src/`
screens and helpers, and the three generated modules —
`snapback/generated/app.mjs`, `api.mjs`, and the content-addressed
`app.binding.51aed21bbef0afd3b2cfb8e8d4e424b94bfd876ce5653e102519d0277a46e826.mjs`.
Every `sources` entry is project-relative: across both maps there are **zero**
occurrences of `/Users/`, **zero** parent reach-backs (`..`), **zero**
`snapback-g0-js` references, and no non-generated Snapback source file. Metro
closure from the app plus public `node_modules` is **PASS**.

Release Hermes bundles:

| OS | Size | SHA-256 |
| --- | ---: | --- |
| iOS | 3,229,300 B | `7e977d8199d3b77c7fad5a17dbac1e5425212a1698ce645dbec80f45f5289a0f` |
| Android | 3,233,120 B | `6a2fa2fd498536591c21aa1d532d00126e7c6abb43bf6065657149628213cc79` |

## Release-shape development leakage — re-proved on 0.1.17 bytes

The 0.1.16 receipt discharged this measurement for the first time. It is
**re-run here against freshly built 0.1.17 HBC output rather than inherited**,
because the vector changed. `/usr/bin/grep -aF` occurrence counts:

```text
=== ios: dist-g4-ios-0117/_expo/static/js/ios/AppEntry-d71633b44923cf572fab2a038a8f1768.hbc
bytes: 3229300
7e977d8199d3b77c7fad5a17dbac1e5425212a1698ce645dbec80f45f5289a0f
  /_snapback/expo/v1/bootstrap               0
  EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN     0
  localhost                                  1
  10.0.2.2                                   0
  __SNAPBACK_EXPO_SUPERVISOR_ORIGIN__        0
  [::1]                                      0
  sbs_                                       0
  http://127.0.0.1                           0
  exp://127.0.0.1                            0
=== android: dist-g4-android-0117/_expo/static/js/android/AppEntry-ca49b3c657413fed8ea30c11b2cbe970.hbc
bytes: 3233120
6a2fa2fd498536591c21aa1d532d00126e7c6abb43bf6065657149628213cc79
  /_snapback/expo/v1/bootstrap               0
  EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN     0
  localhost                                  1
  10.0.2.2                                   0
  __SNAPBACK_EXPO_SUPERVISOR_ORIGIN__        0
  [::1]                                      0
  sbs_                                       0
  http://127.0.0.1                           0
  exp://127.0.0.1                            0
```

Three of the four G4 symbols are absent outright on both platforms, along with
`__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__` and `[::1]`. No bearer prefix and no
complete development origin appears anywhere.

### The surviving `localhost`, attributed by a fresh control export

The 0.1.16 attribution is **not inherited**. A bare `create-expo-app`
blank-TypeScript app with **no Snapback dependency at all** was scaffolded in
this same quarry (`control-bare/`, confirmed to contain zero `@expo/snapback`
entries in its manifest) and exported the same way. Its 1,422,683-byte bundle
contains:

```text
  /_snapback/expo/v1/bootstrap               0
  EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN     0
  localhost                                  1     (byte offset 189652)
  10.0.2.2                                   0
  [::1]                                      0
  sbs_                                       0
```

Exactly one `localhost` and zero of everything else. **Snapback's presence does
not change the count.** The sibling-literal argument also still holds: both
Snapback sites that could emit the literal sit inside
`process.env.NODE_ENV !== 'production'` guards, and the other literals in those
same expressions (`[::1]`, `10.0.2.2`) are absent from these bundles — a branch
cannot contribute one of its string literals and not the others.

Read literally as "all four absent", the arm is 3 of 4. Read as the guarantee it
exists to enforce — no supervised-development endpoint vocabulary survives into
a release artifact — it **passes**, now on two independently built vectors.

## EAS stage-only archive inspection — PASS

```sh
node <checkout>/demos/_kit/eas-stage-build.mjs . --stage-only
```

staged **88 files / 0.69 MiB**, excluding `node_modules`, `.expo`, `.git`,
`dist`, `.snapback`, and `.snapback.snapback.restore.lock`. Independent
inspection of the staged directory confirmed the absence of `node_modules`,
`.git`, `.snapback`, `.expo`, every `dist-g4-*` export directory, and the
`control-bare/` control app; found zero `*.snapback.restore.lock` files; and
found zero `file:`, `link:`, or `/Users/` paths in the staged manifest or lock.
The stage contains the app entry/config, the `src/` screens, the authored and
generated `snapback/` backend, `eas.json`, and the package manifest plus
registry lock — app and registry inputs only.

## EAS project linking — PASS on the package-root plugin spelling

The app config carries the documented package-root spelling,
`"plugins": ["@expo/snapback-expo"]`, exactly as the template ships it and with
no `./app.plugin` subpath workaround.

```text
$ npx eas-cli@latest init --non-interactive --force
Using default account ccheever for non-interactive and force mode
✔ Project successfully linked (ID: a1c8b1e0-b2e7-43d9-9e14-2cbbd81ab0fd) (modified app.json)
```

`npx eas-cli@latest config --platform ios --profile development
--non-interactive` then resolved the full app config through EAS CLI's own
resolver and showed the Snapback config plugin having run — the injected
`extra.snapback.integrationReceipt` names
`{"name": "@expo/snapback-expo", "version": "0.1.17"}` and the descriptor
identity
`sha256:6ed2f2d3268c120b2fc4990350a6205b17fcaad9064983c439aed4db715c44b0`.

`eas.json` was authored for this arm (a minimal `development` profile) and is
the only hand-edited file in the whole run; it is post-`m2` work and is
deliberately not folded into the frozen `F = 0` milestone vector.

**No paid EAS build was started.** The 2026-08-06 author sitting authorized
exactly one real build per OS and both were already spent on the 0.1.11 quarry —
iOS simulator development client
[`be6971f1-8de1-4796-b1b0-a601aed741bd`](https://expo.dev/accounts/ccheever/projects/snapback-g4-external/builds/be6971f1-8de1-4796-b1b0-a601aed741bd)
and Android internal development client
[`c87157f4-2f95-401e-bb34-b956e01f29c9`](https://expo.dev/accounts/ccheever/projects/snapback-g4-external/builds/c87157f4-2f95-401e-bb34-b956e01f29c9).
Those are cited, not repeated. The frozen ceremony's boundary is stage-only, so
no per-version build was demanded and no spend conflict arose.

## Diagnosis probes — one PASS, one still failing

### Binding-identity mismatch — PASS

```text
$ npx snapback guide "SNAPBACK_APP_BINDING_IDENTITY_MISMATCH"
SNAPBACK_APP_BINDING_IDENTITY_MISMATCH — diagnostic
application
Guide: /_snapback/guide/clients/react-expo.md#diagnose-a-binding-identity-mismatch
```

1 s, and the anchor is **correct** — a section that exists and is about exactly
this refusal. The 0.1.10 discoverability defect and its 0.1.11 repair both hold
on the published 0.1.17 vector.

### Capability refusal — the 0.1.16 finding still bites, verbatim

```text
$ npx snapback guide "SNAPBACK_CAPABILITY_UNSUPPORTED"
SNAPBACK_CAPABILITY_UNSUPPORTED — diagnostic
capabilities
Guide: /_snapback/guide/backend/streamed-actions.md#read-the-refusal-codes
Emitting sites:
- packages/snapback-codegen/index.mjs:1381:12
- packages/snapback-codegen/index.mjs:1423:16
- src/auth/mode.rs:483:27
…
- src/manifest.rs:13576:18
```

- **Speed: good.** 1 s warm.
- **Destination: still wrong.** `backend/streamed-actions.md#read-the-refusal-codes`
  opens "Stream diagnostics are structured and value-free…" and is about
  streamed-action refusal families. It says nothing about target capability
  advertisement. No guide page explains why a published runtime would refuse a
  capability its own codegen requires.
- **Leakage: still present.** The diagnostic lists monorepo source paths
  (`src/manifest.rs`, `packages/snapback-codegen/index.mjs`) to an external
  consumer who has no checkout.

This is the consumer-diagnosability remainder of the runtime-receipt ticket,
retested and **still open**. It is materially less urgent than it was at
0.1.16 — the refusal it fails to explain no longer fires on the paved path —
but the guide gap is unchanged.

## Retested tickets — disposition

| Open ticket from the 0.1.16 run | Retested at 0.1.17 |
| --- | --- |
| [Guide's fresh-app command resolves to an unrelated package](../../../issues/20260809-guide-gap-npx-snapback-new-resolves-wrong-package.md) | **Still bites, verbatim.** `npx --yes snapback new … --template expo-chat` still fails with `npm error could not determine executable to run`, 1 s after `t0`+19 s. It cost this run its first author decision. |
| [Template `.gitignore` omits the restore lock](../../../issues/20260809-expo-chat-template-gitignore-restore-lock.md) | **Still bites.** The scaffolded `.gitignore` is `.snapback/`, `.expo/`, `dist/`, `node_modules/`, `snapback/generated/*`, `!snapback/generated/artifacts.json` — no `*.snapback.restore.lock`. Exposure stayed theoretical here because the transports used explicit excludes and the EAS helper excludes it. |
| [Cold-boot arm dev-path vs release-path](../../../issues/20260809-g4-cold-boot-arm-dev-vs-release-path.md) | **Not settled; new information added.** See the [iOS receipt](./20260810-g4-external-0117-ios-simulator.md). The dev path was measured and did not produce a retained render; the supervisor-fully-down variant is unmeasurable under Expo Go because killing the supervisor also kills Metro. |
| [Runtime packages omit the store-qualification receipt](../../../issues/20260809-runtime-package-missing-store-qualification-receipt.md) | **Blocking half CLOSED** — the receipt ships and is identity-bound. **Diagnosability half still open**, as above. |

## One new, minor observation

The published `expo-chat` template's `package.json` declares `^0.1.16` roots
while the closure it ships in is `0.1.17`. Caret resolution on a `0.1.x` range
selects `0.1.17`, so the lock is coherent and nothing broke — every installed
Snapback package is `0.1.17`. But the template's declared pins are not refreshed
by the promotion lane, so they drift one closure behind. This is cosmetic today
and would stop being cosmetic at a `0.2.0` boundary, where `^0.1.16` would no
longer reach the current closure.

## Quarry retention

Following the 0.1.11 durability lesson, the commitless quarry is archived
off-machine; the archive identity is recorded in the
[summary receipt](./20260810-g4-external-0117-summary.md). The source directory
was not modified by archiving. The archive is a durability measure, not evidence
promotion; the tracked receipts in this directory remain the citable record.
