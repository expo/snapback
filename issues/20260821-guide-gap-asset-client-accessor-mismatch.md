# guide-gap: assets guide uses an accessor the published client does not expose

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 5
**Confidence:** 5
**Systems:** Assets, Guide, Client integration, Packaging
**Date:** 2026-08-21
**Governing:** LLP 0044 client upload surface, LLP 0061
**Evidence:** Messtimate published-0.1.24 diary; `guide/backend/assets.md`

## Problem

The minimal-path example in `guide/backend/assets.md` tells authors to call:

```js
client.assets.start({ upload: defaults.profiles.avatar, file })
```

The same page later states the actual published contract: a raw
`SnapbackClient` has no `assets` accessor and must be wrapped with
`createAssetClient(client)`. The client package confirms that shape. This is a
present-tense internal contradiction, not only a stale 0.1.24 report, and it
caused a failed proof run.

The Expo/React provider may project an asset owner into its prepared binding,
but that does not make `client.assets` a property on the framework-neutral
client used by this example.

## Required change

- Choose one public shape for the minimal framework-neutral example.
- If the package contract remains `createAssetClient(client)`, correct every
  raw-client example and add an import that compiles from packed packages.
- If a first-class `.assets` facade is preferred, add it as an intentional API
  change with type/export parity rather than documenting a property that is not
  present.
- Add a Guide snippet check that typechecks or executes the exact example
  against the packed public package shape.
- Add retrieval aliases for the observed wrong spelling so an author who
  searches `client.assets.start` reaches the correction.

## Acceptance

- No current Guide page both uses and denies the same accessor.
- The minimal asset example passes from a fresh packed scaffold without source
  inspection.
- A drift test fails if the documented accessor and published package surface
  diverge again.

