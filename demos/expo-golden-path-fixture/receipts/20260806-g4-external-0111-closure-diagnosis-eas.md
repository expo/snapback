# LLP 0176 G4 external 0.1.11 — closure, diagnosis, and EAS receipt — 2026-08-06

## Registry and promotion provenance

The retained external repository is
`/Users/ccheever/projects/snapback-g4-external`, a separate Git root. Its
direct Snapback dependencies are public `^0.1.11` roots for CLI, client,
codegen, Expo, and React. The installed closure resolves client, codegen,
Contract, Expo, React, and the Darwin runtime at exactly 0.1.11; platform
optional runtime selection remains package-manager owned. A manifest/lock scan
found no `file:`, `link:`, workspace, override, resolution, monorepo checkout,
or external absolute path.

This proof consumes the ten-name live 0.1.11 promotion under the same LLP 0041
fast-path disposition already closed for 0.1.10. The reconciled close-out is
[`../../../issues/closed/20260803-first-npm-latest-promotion.md`](../../../issues/closed/20260803-first-npm-latest-promotion.md):
the retained ledger is
`~/snapback-release-ledgers/fastpath-ledger-0.1.11-281eb17c78.json`, npm bytes
were verified, and the package source identity is
`281eb17c785f5ca82185fd34ad5de8049e852bf5`. The four later tip commits were
proof-fixture repairs that do not ship in the package set. G4 cites that
provenance and does not re-litigate it.

## Metro closure from app plus public node_modules

Four local release-shape exports completed:

```sh
npx expo export --platform ios --output-dir dist-g4-ios-0111 --clear
npx expo export --platform android --output-dir dist-g4-android-0111 --clear
npx expo export --platform ios --output-dir dist-g4-closure-ios-0111 \
  --source-maps --clear
npx expo export --platform android --output-dir dist-g4-closure-android-0111 \
  --source-maps --clear
```

The iOS source map has 666 sources: 660 under `/node_modules`, four external
app/generated modules, and two Metro virtual polyfills. Android has 664:
658, four, and two respectively. Inspection of the `sources` arrays found no
absolute host path, parent reach-back, `snapback-g0-js`, or non-generated
Snapback source. Metro closure from the app plus public `node_modules` is
**PASS**.

Release Hermes bundles:

| OS | Size | SHA-256 |
| --- | ---: | --- |
| iOS | 3.6 MiB | `2c95cc17d49dcaeae21115e29294357a82b5b7b9e8c07cf44387d139c66aef3c` |
| Android | 3.6 MiB | `3eea0618eda3c57abfac765eae9bb00783078f6119a59e7a953566b107583403` |

## Release-shape development leakage — FAIL

The required local `/usr/bin/grep -aF` recheck found the same 0.1.10 symbols
in each 0.1.11 HBC bundle:

| Pattern | iOS | Android |
| --- | ---: | ---: |
| `/_snapback/expo/v1/bootstrap` | 1 | 1 |
| `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` | 1 | 1 |
| complete `http://127.0.0.1` or `exp://127.0.0.1` origin | 0 | 0 |
| `localhost` host literal | 1 | 1 |
| `10.0.2.2` Android-emulator host literal | 1 | 1 |
| `sbs_` bearer/token prefix | 0 | 0 |

Each bundle also contains two generic `Bearer ` header-format strings; no
credential value or `sbs_` material is present. The two development host
literals remain even without a complete URL. G4 requires the supervisor and
development-endpoint vocabulary itself absent, so the no-dev-leak arm remains
**FAIL**.
The existing umbrella ticket stays open; fixing this export shape was
explicitly out of scope for tonight's rerun.

## EAS stage-only archive inspection

The first requested stage showed that prior `dist-*` output and Snapback's
local state/sibling restore lock were not excluded by default. The source helper
was repaired and unit-pinned, then stage-only reran:

```sh
node /Users/ccheever/projects/snapback-g0-js/demos/_kit/eas-stage-build.mjs . \
  --stage-only \
  --exclude evidence --exclude G4-ACTION-LEDGER.md \
  --exclude .claude --exclude AGENTS.md --exclude CLAUDE.md --exclude LICENSE
```

The final stage contained 42 files / 0.87 MiB at
`.../snapback-eas-snapback-g4-external-kCdJmh`: app entry/config/assets,
package manifest plus public registry lock, and authored/generated `snapback/`
backend only. It had no Git ancestor, `node_modules`, Expo/Snapback state,
restore lock, export output, evidence, local package edge, or monorepo path.
Stage-only intentionally does not install package bytes; the registry lock is
the only dependency input. The inspected temp stage was removed after this
receipt was written.

## Authorized real EAS development-client builds — PASS

The author authorized exactly one iOS and one Android development-client build.
The existing EAS session was present as `ccheever`; no credential recovery was
attempted. `expo-dev-client` was installed through `npx expo install`, the
external app received its own bundle/package identifiers and EAS project
`7183485f-a8f5-4cdd-a0ac-aa5683b67c24`, and `.easignore` held the same small
archive boundary. Both uploads were 582 KB.

The documented 0.1.11 plugin root failed EAS CLI resolution. Switching only
the app config to the package's already-public
`@expo/snapback-expo/app.plugin` export allowed noninteractive linking/builds;
no package file was changed.

| OS | Result | Build / fingerprint | Artifact |
| --- | --- | --- | --- |
| iOS simulator dev client | FINISHED, 2026-08-07 00:48:37Z (3m45s) | [`be6971f1-8de1-4796-b1b0-a601aed741bd`](https://expo.dev/accounts/ccheever/projects/snapback-g4-external/builds/be6971f1-8de1-4796-b1b0-a601aed741bd), `4421787ac8728f31e1524c4c903f13c6aac9dece` | [simulator `.tar.gz`](https://expo.dev/artifacts/eas/_oQ6gpzu-CODOU43nIg-I-RNg-437BFSJXzIYsQcuJk.tar.gz) |
| Android internal dev client | FINISHED, 2026-08-07 00:53:22Z (6m23s) | [`c87157f4-2f95-401e-bb34-b956e01f29c9`](https://expo.dev/accounts/ccheever/projects/snapback-g4-external/builds/c87157f4-2f95-401e-bb34-b956e01f29c9), `8a64c6fa76dade40ad329490641247d2a09e4779` | [Android `.apk`](https://expo.dev/artifacts/eas/wFy1sLayuRjcpj54rMqyZaAFOObBcWPVk6rvEe8Htqw.apk) |

These are real EAS **development-client build artifacts**. The iOS artifact is
simulator-only. Neither artifact was run on a physical device, and neither is
a production/store release artifact or an LLP 0064 receipt.

The EAS root-export defect and source-only repair are tracked in
[`../../../issues/closed/20260806-expo-config-plugin-eas-root-export.md`](../../../issues/closed/20260806-expo-config-plugin-eas-root-export.md).

## Deliberate diagnosis-time probe — PASS

`evidence/diagnosis-probe.mjs` deliberately replaced the binding descriptor
identity with zeroes while keeping the public 0.1.11 app and admission API.

- Start: 2026-08-06 17:42:25 PDT.
- Structured diagnostic: 2 ms.
- Code: `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`.
- Message: `AppBinding identities do not match the imported AppDescriptor`.
- Exact-code search and `AppBinding` search both returned
  `clients/react-expo.md#diagnose-a-binding-identity-mismatch`.
- Whole public-doc diagnosis sequence: 2 seconds, finishing 17:42:27 PDT.

This closes the 0.1.10 exact-code discoverability finding. No private source
or monorepo search was needed to identify the deliberate fault.
