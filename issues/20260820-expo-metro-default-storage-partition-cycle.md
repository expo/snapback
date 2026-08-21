# Expo package cycle crashes Metro at `DEFAULT_AUTH_STORAGE_PARTITION`

**Status:** Open
**Opened:** 2026-08-20
**Systems:** Expo client, Packaging, Metro, Auth custody
**Related:** LLP 0277 P17; LLP 0295; Diary 0101

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
