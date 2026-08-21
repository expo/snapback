# Expo package cycle crashes Metro at `DEFAULT_AUTH_STORAGE_PARTITION`

**Status:** Resolved 2026-08-21
**Opened:** 2026-08-20
**Systems:** Expo client, Packaging, Metro, Auth custody
**Related:** LLP 0277 P17; LLP 0295; Diary 0101
**Landing SHA:** 019039edc

## Problem

Under the Expo/Metro tuple used by the 0.1.24 matrix,
`@expo/snapback-expo` enters through `app-binding.mjs`, imports the app-client
entry, which reaches the package index, which re-exports
`DEFAULT_AUTH_STORAGE_PARTITION` from the not-yet-initialized app-client
module. Metro's CJS interop throws a temporal-dead-zone error before the app
renders. Importing `@expo/snapback-client` first happens to change evaluation
order and masks the defect.

## Requested repair

- Remove the initialization cycle or move the constant to a leaf module with
  no back-edge through a barrel.
- Add a clean external Expo/Metro bundle and first-render test that imports
  only the documented Expo entrypoint.
- Add a module-graph/package test preventing the cycle from returning.

## Exit

A clean scaffold reaches first render under Metro without an import-order
workaround.

## Resolution

`DEFAULT_AUTH_STORAGE_PARTITION` now lives in
`app-client-defaults.mjs`, a leaf with no import or barrel back-edge. Both the
client root and `app-client.mjs` export that leaf binding directly, and the
leaf runtime/type files are included in the published client package.

The package graph guard prevents the root from resolving the constant through
`app-client.mjs`, keeps the root and direct declaration exports paired with the
same leaf, and prevents the defaults leaf from acquiring imports. The external
Expo fixture installs a fully packed, materialized local Expo/client/React
closure outside the workspace, imports only the documented
`@expo/snapback-expo/app-binding` Snapback entrypoint, bundles it with Metro,
serves the export, and proves first render in a Chrome-family browser. No
client-first load-order import is present.

The generated Guide reference retains the public identity and spelling
`@expo/snapback-client#DEFAULT_AUTH_STORAGE_PARTITION`; no custody Guide import
path changes as part of this repair.

### Evidence

- Before repair, `node packages/snapback-client/app-client-module-graph.test.mjs`
  failed: `the root barrel must not resolve DEFAULT_AUTH_STORAGE_PARTITION
  through app-client.mjs`.
- The same graph test after repair — PASS; root and direct runtime/type exports
  resolve to the packed no-import leaf and both runtime values equal `default`.
- `node packages/snapback-client/app-client.test.mjs` — PASS, 40 tests.
- `node packages/snapback-client/package.test.mjs` — PASS.
- `node packages/snapback-client/export-parity.test.mjs` — PASS, 332 declared
  symbols across 39 export entries.
- `node packages/snapback-expo/metro-first-render.test.mjs` under Node 24.18.0
  and Bun 1.3.12 — PASS through packed external packages, Metro bundle, and
  first render.
- `node packages/snapback-expo/package-closure.test.mjs` under Node 24.18.0 and
  Bun 1.3.12 — PASS.
- Targeted strict TypeScript fixtures for app-client and Expo — PASS.
- `node scripts/check-package-test-inventory.mjs` — PASS, 314 declared test
  files.
- `./ref-check --verbose` — PASS, 5,994 refs in 11,240 files.
