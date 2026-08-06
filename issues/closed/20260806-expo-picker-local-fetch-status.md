# Expo picker local-resource fetch was rejected on status 0

- Status: Resolved 2026-08-06
- Date: 2026-08-06
- Area: `@expo/snapback-expo`, LLP 0181 E2
- Kind: receipt-found defect

## Problem

The Expo command asset adapter required `response.ok !== false` after reading
an ImagePicker URI through `expo/fetch`. A real Android Expo Go picker returned
a copied `file://` URI whose local-resource response exposed a valid `blob()`
but used the non-HTTP status 0 / `ok: false` shape. The adapter refused the
command during `preparing` before any upload attempt.

The established Expo asset recipe treats native-byte conversion rather than
HTTP success as the local-resource boundary. The receipt loop then exposed
three more defects on that same boundary: a React Native Blob slice without
`arrayBuffer()`, binary TUS bodies crossing the legacy global fetch, and Expo
57's Android `file://` interceptor returning a genuine 404 whose 14-byte body
was the literal text `File not found`. A command diagnostic projection also
dropped the child message that made the last failure actionable.

## Acceptance

- `content://`, `ph://`, and `file://` remain the only accepted picker schemes.
- A native local-resource response with status 0 and a valid Blob converts.
- The Expo provider registers `expo/fetch` on the existing asset client so
  React Native never has to encode TUS `Uint8Array` bodies through its legacy
  global fetch implementation.
- Selected bytes become an immutable structural Blob whose slices retain
  `arrayBuffer()` independently of React Native's legacy Blob store.
- A genuine Android picker-cache 404 falls back narrowly to
  `expo-file-system`'s local `File.bytes()` reader; it is never uploaded as
  response text.
- A missing or throwing `blob()` still refuses locally with
  `SNAPBACK_EXPO_ASSET_URI_UNREADABLE`.
- The Android and iOS G3 platform receipts prove real picked images through the
  corrected adapter.

## Resolution

`createExpoAssetSourceAdapter` now accepts status-0 local responses when a byte
reader is present, prefers `bytes()`/`arrayBuffer()`, freezes a repeatably
slice-readable structural source, and uses `expo-file-system` only for the
Android `file://` 404 case. The provider registers `expo/fetch` on the existing
asset client, so checksum/TUS work and ordinary-session custody remain with
the canonical LLP 0044 task. Command failure projection preserves the child
diagnostic message.

Recorded `content://`, `ph://`, and `file://` fixtures cover conversion,
status 0, unsupported schemes, unreadable sources, and the Android cache
fallback. The final Android Photo Picker selected 30,670 bytes and the final
iOS Photos picker selected 46,093 bytes; both commands reached `committed`,
rendered their delivery URL, and closed with no residue. Evidence is in the
dated G3 receipts under `demos/expo-golden-path-fixture/receipts/`.
