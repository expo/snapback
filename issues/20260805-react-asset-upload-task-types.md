# React asset upload hook returns `unknown` instead of the existing task types

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 5
**Confidence:** 5
**Systems:** React client, Assets, TypeScript
**Date:** 2026-08-05
**Governing:** LLP 0044 (client upload surface)
**Related:** LLP 0176; `packages/snapback-react/index.d.mts`; `packages/snapback-client/assets.d.mts`; Diary 0059

## Problem

`@expo/snapback-client` already declares `AssetFileLike`,
`AssetUploadTask`, and `AssetTaskSnapshot`. The React declaration independently
spells a weaker file shape and returns `unknown` from the operations that
project the same task:

```ts
start(...): unknown;
resumePersisted(...): unknown;
cancel(...): Promise<unknown>;
retry(): Promise<unknown>;
```

The Tandem Expo messaging adapter therefore had to cast the result of
`useSnapbackAssetUpload(...).start(...)` before it could await `task.done`.
This is a declaration defect, not an unsettled product decision: the headless
client already exposes the concrete runtime contract and LLP 0044 specifies
the task lifecycle.

## Fix shape

- Reuse or re-export the client package's `AssetFileLike`,
  `AssetUploadTask`, and `AssetTaskSnapshot` types rather than maintaining a
  weaker React-only copy.
- Declare `start` as returning `AssetUploadTask`.
- Declare `resumePersisted` as returning `AssetUploadTask | null`.
- Declare `cancel` as returning `Promise<AssetTaskSnapshot>` and `retry` as
  returning `Promise<AssetUploadTask>`.
- Check the runtime projection against those declarations; do not fix only the
  `.d.mts` file if its actual return values differ.

## Acceptance

- A strict TypeScript fixture calls `start`, subscribes to the task, awaits
  `task.done`, and inspects the typed snapshot with no cast.
- A strict fixture handles the nullable `resumePersisted` result.
- `cancel` and `retry` have the same result types as the underlying
  `SnapbackAssetClient` task.
- The package declaration/build tests prevent the React and client task types
  from drifting independently.
