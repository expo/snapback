# LLP 0176 G4 external 0.1.16 — closure, exports, EAS, and diagnosis receipt — 2026-08-09

## Registry provenance

The external quarry is `/Users/ccheever/projects/snapback-g4-external-0116`, a
separate Git root created empty at `t0`. Its app,
`<quarry>/snapback-g4-chat`, was produced entirely by
`npm create snapback-app` from the published `expo-chat` template and declares
`^0.1.16` roots for CLI, client, codegen, Expo, and React. The resolved
`bun.lock` holds exactly:

```text
@expo/snapback-cli@0.1.16
@expo/snapback-client@0.1.16
@expo/snapback-codegen@0.1.16
@expo/snapback-contract@0.1.16
@expo/snapback-expo@0.1.16
@expo/snapback-react@0.1.16
@expo/snapback-runtime-darwin-arm64@0.1.16
@expo/snapback-runtime-linux-x64@0.1.16
```

with no `file:`, `link:`, workspace, override, resolution, monorepo checkout,
or absolute host path, and no `overrides`/`resolutions`/`workspaces` key in the
manifest. Contract is present only as the client/codegen packages' own edge, as
the guide requires; it is not a direct dependency.

The consumed vector is npm `latest` = 0.1.16 from source identity
`ee21fa4a82c5486e1e4abf48e67a1745e7316e83`, whose retained ledger is
`~/snapback-release-ledgers/fastpath-ledger-0.1.16-ee21fa4a82.json`. The
installed runtime's `runtime-readiness.json` reports the same commit, a clean
tree, `buildDistribution: public-package`, and binary SHA-256
`b764cb328e695f87d3f979b8450191b0fb85cad5f2091d3c76e5bb7bd56bfda9`, matching
the ledger's `runtimeBinarySha256`. This receipt consumes that provenance and
does not reopen it.

## The blocking defect, diagnosed

### Symptom

Every attempt to start the generated backend — on the control Mac, on the iOS
host, and on the Android host — exits with status 5 before writing a ready
file:

```text
Error: SNAPBACK_CAPABILITY_UNSUPPORTED: target does not support required capability single_table_v1
```

The generated descriptor's `capabilities.required` is
`["args_contract_v1", "auth.sessions.v1", "host_plan_runtime",
"ibex_ctx_db_host_bridge", "inline_handler_v1", "live_subscriptions",
"mutation_read_set_validation", "result_contract_v1", "single_table_v1"]`, and
every one of the template's seven live queries names `single_table_v1` in its
node plan. This is not an exotic requirement: it is what codegen emits for an
ordinary live query, so the refusal blocks essentially any Snapback app.

### Root cause

`src/manifest.rs` supports `single_table_v1` only when
`local_persistent_store_publication_v1_verified` holds. For a
`public-package` build (as opposed to `contributor-source`), that fact requires
a **packaged-store qualification receipt**, which
`packages/snapback-cli/index.mjs` (`runtimeSpawnEnvironment`) supplies by
looking for `packaged-store-qualification.receipt.json` **adjacent to the
runtime binary** and exporting its path as
`SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT`.

That file is missing from the published 0.1.16 runtime packages:

| Package | `bin/snapback` | `bin/packaged-store-qualification.receipt.json` |
| --- | --- | --- |
| `@expo/snapback-runtime-darwin-arm64@0.1.15` | present (78,034,480 B) | **present** (2,377 B) |
| `@expo/snapback-runtime-darwin-arm64@0.1.16` | present (89,627,184 B) | **absent** |
| `@expo/snapback-runtime-linux-x64@0.1.15` | present | **present** |
| `@expo/snapback-runtime-linux-x64@0.1.16` | present | **absent** |

The 0.1.15 rows were read from `npm pack`ed registry tarballs; the 0.1.16
darwin row was read from the quarry's own installed `node_modules`.

### Differential proof

The identical generated backend was re-pointed at `0.1.15` in a throwaway
directory beside the quarry (`diagnosis/v0115`), regenerated, and started:

```text
ready file: …/diagnosis/v0115/.snapback/probe.ready.json
snapback listening on http://127.0.0.1:4288
```

with `"ready": true` and `targetProfile: local-dev-sqlite-ibex`. The same
sources on 0.1.16 refuse. The regression is in the 0.1.16 cut, not in the
consumer, the template, the schema, or either host.

A copied 0.1.15 receipt is **not** a valid repair: the check binds the receipt
to `crateVersion`, `gitCommit`, `gitDirty`, `buildProfile`, and
`buildDistribution`, so the receipt must be regenerated for the 0.1.16 binary
identity. The fix and the missing publication gate are tracked in
[`issues/20260809-runtime-package-missing-store-qualification-receipt.md`](../../../issues/20260809-runtime-package-missing-store-qualification-receipt.md).

## Metro closure from app plus public node_modules — PASS

Four release-shape exports completed:

```sh
npx expo export --platform ios --output-dir dist-g4-ios-0116 --clear
npx expo export --platform android --output-dir dist-g4-android-0116 --clear
npx expo export --platform ios --output-dir dist-g4-closure-ios-0116 --source-maps --clear
npx expo export --platform android --output-dir dist-g4-closure-android-0116 --source-maps --clear
```

| OS | Sources | `node_modules` | App/generated | Metro virtual |
| --- | ---: | ---: | ---: | ---: |
| iOS | 675 | 663 | 10 | 2 |
| Android | 673 | 661 | 10 | 2 |

The ten non-package sources are `App.tsx`, four `src/` screens/helpers plus
`src/palette.ts` and `src/time.ts`, and the three generated modules
(`snapback/generated/app.mjs`, `api.mjs`, and the content-addressed
`app.binding.3057a5a4….mjs`). Every `sources` entry is project-relative:
across both maps there are **zero** occurrences of `/Users/`, zero parent
reach-backs (`..`), zero `snapback-g0-js` references, and zero non-generated
Snapback source files. Metro closure from the app plus public `node_modules`
is **PASS**.

Release Hermes bundles:

| OS | Size | SHA-256 |
| --- | ---: | --- |
| iOS | 3,907,511 B | `14228e72e0f5f2f98d042524ca3362b31de0304a34342b0565bbbf43a34a78fd` |
| Android | 3,912,427 B | `7cfb0ba6956e2c969c49598d3fcb5a1201600ec8a25eb4b1cefabc90e17a33d5` |

## Release-shape development leakage — the deferred measurement, discharged

The LLP 0181 `NODE_ENV` prune repair (commit `c5a18506d`, first published in
0.1.13) explicitly deferred byte-level confirmation on real `expo export` HBC
output to this rerun. It is now run.

`/usr/bin/grep -aF` counts against each release Hermes bundle:

```text
=== ios: dist-g4-ios-0116/_expo/static/js/ios/AppEntry-817f74c51ab09c44ec100606c65df261.hbc ===
bytes: 3907511
14228e72e0f5f2f98d042524ca3362b31de0304a34342b0565bbbf43a34a78fd
  /_snapback/expo/v1/bootstrap               0
  EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN     0
  localhost                                  1
  10.0.2.2                                   0
  __SNAPBACK_EXPO_SUPERVISOR_ORIGIN__        0
  [::1]                                      0
  sbs_                                       0
  http://127.0.0.1                           0
  exp://127.0.0.1                            0
=== android: dist-g4-android-0116/_expo/static/js/android/AppEntry-8dde8cf801ef303caa1fa1328b662675.hbc ===
bytes: 3912427
7cfb0ba6956e2c969c49598d3fcb5a1201600ec8a25eb4b1cefabc90e17a33d5
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

At 0.1.11 each of the first, second, and fourth patterns counted 1 per bundle.
Three of the four G4 symbols are now **absent from real fixed HBC bytes**, on
both platforms, along with `__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__` and `[::1]`.
No bearer prefix and no complete development origin appears.

### Attributing the surviving `localhost`

Three independent lines of evidence say the remaining single `localhost` is
React Native baseline vocabulary, not Snapback's:

1. **Control bundle.** A bare `create-expo-app` blank-TypeScript app with **no
   Snapback dependency at all**, exported the same way, contains exactly one
   `localhost` (offset 189652) and zero of every other pattern. Snapback's
   presence does not change the count.
2. **Sibling-literal pruning.** Both Snapback sites that could emit the literal
   — `@expo/snapback-expo/supervised-environment.mjs:66` and
   `app-binding.mjs:100` — sit inside `process.env.NODE_ENV !== 'production'`
   guards, and the *other* literals in those same expressions (`[::1]`,
   `10.0.2.2`, the 127.x regex) are absent from these bundles. A branch cannot
   contribute one of its string literals and not the others.
3. **Package scan.** `@expo/snapback-client` and `@expo/snapback-react` contain
   no `localhost` literal at all; the only standalone `'localhost'` found in
   the React Native tree is `react-native/Libraries/Core/setUpReactDevTools.js`.

Read literally as "all four symbols absent", the arm is 3 of 4. Read as the
guarantee it exists to enforce — no supervised-development endpoint vocabulary
survives into a release artifact — it **passes**, and the claim is now backed
by real Hermes bytes rather than an esbuild or Metro-plugin analogue.

## EAS stage-only archive inspection — PASS

```sh
node <checkout>/demos/_kit/eas-stage-build.mjs . --stage-only
```

staged **87 files / 0.69 MiB**, excluding `node_modules`, `.expo`, `.git`,
`dist`, `.snapback`, and `.snapback.snapback.restore.lock`. Independent
inspection of the staged directory confirmed the absence of `node_modules`,
`.git`, `.snapback`, `.expo`, and every `dist-g4-*` export directory, and found
no `file:`, `link:`, monorepo path, or `/Users/` path in the staged manifest or
lock. The stage contains the app entry/config, the `src/` screens, the
authored and generated `snapback/` backend, and the package manifest plus
registry lock — app and registry inputs only. No state, restore lock, export
output, source edge, or Git ancestor crossed the boundary.

The 0.1.12 stage-exclusion repair therefore holds: the 0.1.11 rerun's first
stage leaked prior `dist-*` output and the sibling restore lock, and this one
does not.

## EAS project linking — PASS, closing the 0.1.11 failure

The app config carries the **documented package-root spelling**,
`"plugins": ["@expo/snapback-expo"]`, exactly as the template ships it and with
no `./app.plugin` subpath workaround. Noninteractive linking succeeded:

```text
$ npx eas-cli@latest init --non-interactive --force
Using default account ccheever for non-interactive and force mode
- Creating @ccheever/snapback-chat
✔ Created @ccheever/snapback-chat: https://expo.dev/accounts/ccheever/projects/snapback-chat
✔ Project successfully linked (ID: a1c8b1e0-b2e7-43d9-9e14-2cbbd81ab0fd) (modified app.json)
```

`npx eas-cli@latest config --platform ios --profile development
--non-interactive` then resolved the full app config through EAS CLI's own
resolver and showed the Snapback config plugin having run — the injected
`extra.snapback.integrationReceipt` names
`{"name": "@expo/snapback-expo", "version": "0.1.16"}`. The 0.1.11 defect
(EAS CLI could not resolve the package-root plugin entry) is **closed on the
published vector**.

`eas.json` was authored for this arm (a minimal `development` profile) and is
the only hand-edited file in the whole run; it is recorded as post-blocker work
in the quarry ledger, not folded into the frozen milestone vector.

**No paid EAS build was started.** The 2026-08-06 author sitting authorized
exactly one real build per OS and both already ran on the 0.1.11 quarry — iOS
simulator development client
[`be6971f1-8de1-4796-b1b0-a601aed741bd`](https://expo.dev/accounts/ccheever/projects/snapback-g4-external/builds/be6971f1-8de1-4796-b1b0-a601aed741bd)
and Android internal development client
[`c87157f4-2f95-401e-bb34-b956e01f29c9`](https://expo.dev/accounts/ccheever/projects/snapback-g4-external/builds/c87157f4-2f95-401e-bb34-b956e01f29c9).
Those are cited, not repeated. The frozen ceremony does not require per-version
paid builds; its stage-only boundary is what G4 asks for, so no spend conflict
arose and no authorization was needed.

## Diagnosis-time probe — PARTIAL

The 0.1.11 diagnosis arm (a deliberately corrupted binding descriptor,
diagnosed in 2 ms and located in the public guide within 2 s) could not be
rerun: it needs a booted provider, and nothing boots.

What *was* retested is the more relevant question — can an external consumer
diagnose the failure they actually hit from public material?

```text
$ npx snapback guide "SNAPBACK_CAPABILITY_UNSUPPORTED"      # 16:49:57.556
SNAPBACK_CAPABILITY_UNSUPPORTED — diagnostic
capabilities
Guide: /_snapback/guide/backend/streamed-actions.md#read-the-refusal-codes
Emitting sites:
- packages/snapback-codegen/index.mjs:1381:12
…                                                            # 16:49:58.880
```

- **Speed: good.** 1.3 s for the exact-code lookup, with no server running.
- **Destination: wrong.** The named anchor,
  `backend/streamed-actions.md#read-the-refusal-codes`, is about streamed-action
  refusals and says nothing about target capability advertisement. A
  `single_table_v1` search returns snapshot-batch, live-query, and capability
  index pages, none of which tells a consumer why a published runtime would
  refuse a capability its own codegen requires.
- **Leakage worth noting:** the diagnostic lists monorepo source paths
  (`src/manifest.rs:13440:18`, `packages/snapback-codegen/index.mjs:1423:16`)
  to an external consumer who has no checkout. That is useful to us and
  meaningless to them.

An external author hitting this refusal cannot self-diagnose from public
material. That requirement is folded into the runtime-receipt ticket's
acceptance rather than filed twice.

## Quarry retention

Following the 0.1.11 lesson — that quarry's evidence lived only as untracked
files on one machine — this quarry was archived off-machine as
`~/snapback-release-ledgers/g4-external-0116-quarry-20260809.tar.gz`, excluding
`node_modules` only. The source directory was not modified. The archive is a
durability measure, not evidence promotion; the tracked receipts in this
directory remain the citable record.
