# LLP 0176 G4 external 0.1.10 closure and diagnosis receipt — 2026-08-06

## Registry-only closure

The retained git repository at
`/Users/ccheever/projects/snapback-g4-external` was created outside the
Snapback monorepo. Its lock has these direct Snapback dependencies:

```text
@expo/snapback-cli      ^0.1.10
@expo/snapback-codegen  ^0.1.10
@expo/snapback-expo     ^0.1.10
@expo/snapback-react    ^0.1.10
```

The installed transitive closure adds public
`@expo/snapback-client`, `@expo/snapback-contract`, and the two platform
runtime packages, all exactly 0.1.10 and all resolved from
`https://registry.npmjs.org/`. A lock scan found zero `file:`, `workspace:`,
`link:`, `snapback-g0-js`, or `/Users/ccheever/projects/snapback` occurrences.
The app deliberately did not add Contract directly, following the guide.

`npx snapback generate snapback --json` succeeded with no diagnostic and
emitted one descriptor with the `conversation` surface, the `send` command,
Sessions mode, three seed rows, and the required capability
`single_table_v1`.

## Metro resolution and export leak check

Both release-shape exports completed from the external app despite the runtime
startup blocker:

```sh
npx expo export --platform ios --output-dir dist-ios
npx expo export --platform android --output-dir dist-android
npx expo export --platform ios --output-dir dist-inspect \
  --no-bytecode --source-maps external
```

The iOS inspection map contained 653 sources. Every Snapback source was either
`/node_modules/@expo/snapback-*` or `/snapback/generated/*`; none named a
monorepo checkout or external absolute host path. The public Expo closure
included `index.mjs`, `app-binding.mjs`, `provider.mjs`, and
`supervised-environment.mjs`, but no picker `asset-source` module. Thus Metro
closure resolution from app plus `node_modules` is **proved**, and the missing
picker adapter is independently visible in the bundled source inventory.

The stronger no-dev-leak requirement **failed**. A precise local
`/usr/bin/grep -a` over each release Hermes bundle found one occurrence each
of:

```text
/_snapback/expo/v1/bootstrap
EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN
```

No bearer value, `sbs_` token, concrete `127.0.0.1`/`localhost` port,
monorepo path, or external-repository path appeared in either release bundle.
The no-bytecode diagnostic export additionally contained one generic
`http://localhost:8081` Metro asset source. The requirement was absence of
supervisor origins/bearers/dev endpoints, so absence of concrete credentials
does not turn these retained development symbols into a pass.

## EAS stage-only inspection

From the external repository, the requested helper ran in stage-only mode:

```sh
node /Users/ccheever/projects/snapback-g0-js/demos/_kit/eas-stage-build.mjs . \
  --stage-only --exclude .snapback --exclude dist-ios \
  --exclude dist-android --exclude dist-inspect
```

It staged 47 files / 0.87 MiB at
`/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/snapback-eas-snapback-g4-external-G2iFHG`.
The retained stage contains only the Expo app sources/assets and repository
notes, `package.json`/the registry lock, and the authored plus generated
Snapback backend. It contains no `.git`, `.snapback`, `node_modules`, export
output, source tarball, local override, or monorepo content.

Stage-only deliberately does not install dependencies or include public npm
tarball bytes. Its package manifest and lock make the staged app cold-install
public packages only. The absolute helper path is the user-requested
inspection harness, not a path embedded in the staged app.

No paid EAS build was run. A real build awaits the author's explicit go; this
receipt makes no EAS-build or published release-artifact claim beyond the
local Expo exports above.

## Deliberate diagnosis probe

The retained public-package-only probe is
`/Users/ccheever/projects/snapback-g4-external/evidence/diagnosis-probe.mjs`.
It supplied the generated app to public `admitAppBindingV1` but deliberately
replaced the binding's descriptor identity with all zeroes.

- Start: 2026-08-06 12:32:15 PDT.
- Structured refusal: 2 ms.
- Code: `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`.
- Message: `AppBinding identities do not match the imported AppDescriptor`.
- Public-doc diagnosis finished: 2026-08-06 12:32:45 PDT, **30 seconds**.

The code and message made the fault immediately identifiable. However,
`npx snapback guide SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` and
`npx snapback guide AppBinding` returned no exact match; the broader
`npx snapback guide binding` returned the relevant React Expo and surface
sections among 66 results. The probe therefore passes diagnosis clarity but
finds a public-guide exact-code discoverability gap.
