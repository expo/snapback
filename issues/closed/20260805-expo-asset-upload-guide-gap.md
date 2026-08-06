# Expo authenticated asset upload guide gap

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 4
**Confidence:** 5
**Systems:** Guide, Assets, Expo client, Auth
**Date:** 2026-08-05

## Problem

While building `demos/tandem-expo-bakeoff`, a public typed upload intent passed
codegen and reservation but the subsequent anonymous TUS transfer failed 403.
The upload authorizer returned an application owner id, but anonymous transfer
authority could not satisfy that ownership relationship. The asset guide shows
authenticated upload examples and the native auth guide documents the broker
seam, but the public-upload ownership constraint is not stated where an Expo
author is likely to make this choice.

The same integration needed to turn an Expo ImagePicker native URI into the
blob-like body accepted by `useSnapbackAssetUpload`. The working bridge uses
`expo/fetch` to read the URI and passes the resulting `Blob` into `start`, then
awaits the task's `done` receipt. I did not find a guide recipe that showed this
end-to-end native path or the concrete ready/error result handling.

## Additional example: Relay Room

`demos/relay-room-bakeoff/snapback-expo` independently implemented the same
native authoring shape: `ImagePicker` URI → `fetch(...).blob()` →
`useSnapbackAssetUpload.start(...)`, with declared filename/content type,
progress UI, ready-state attachment, and failed/rejected diagnostics. Its
provider also had no authenticated native session—only a clearly labeled test
persona—so the application could not supply the owner authority declared by
its authenticated upload intent.

The backend image lifecycle was proven separately with an operator upload and
typed attachment, but the ordinary Expo path was not end-to-end provable under
that dev setup. This second app reinforces that a copyable recipe must cover
both halves together: the native URI/blob bridge and real session custody. A
blob-only recipe still strands the author at authorization; an auth-only page
still leaves the native body conversion and task lifecycle implicit.

Evidence: `demos/relay-room-bakeoff/snapback-expo/src/screens/chat-screen.tsx`,
`demos/relay-room-bakeoff/snapback-expo/snapback/functions.mjs`, and
`diaries/0058-relay-room-expo-backend-bakeoff.diary.md`.

## Acceptance

- The assets or Expo guide states whether an upload with application-owned
  assets can be public and explains the expected transfer authority.
- A failing public/owned design is rejected during codegen or reservation when
  it can be known there, rather than reaching a generic transfer 403.
- The Expo guide includes a CI-verified ImagePicker URI → `expo/fetch` → Blob →
  `useSnapbackAssetUpload` recipe.
- The recipe covers progress, the completed task receipt, typed attachment,
  and authenticated native session setup without putting admin or
  impersonation capability in the app bundle.

## Related

- `diaries/0059-tandem-expo-messaging-bakeoff.diary.md`
- `diaries/0058-relay-room-expo-backend-bakeoff.diary.md`
- LLP 0044 typed assets
- LLP 0064 Expo Online surface

## Resolution note — guide half (2026-08-05)

`guide/backend/assets.md` now states the owner-principal constraint before the
upload flow, distinguishes public attempt/delivery policy from anonymous
transfer authority, and provides a source-transcluded Expo recipe covering
ImagePicker metadata, `expo/fetch` Blob conversion,
`useSnapbackAssetUpload.start`, byte progress, `task.done`, ready/error
handling, and typed `ctx.assets.attach`. It also shows real session custody via
the shipped `snapback session mint --email` wrapper and a trusted broker that
returns only the ordinary bearer. `guide/index.md`, the capability aliases,
and `guide/clients/react-expo.md` cross-index the recipe.

This ticket remains open for the separate product-side acceptance item: when
the public/owned contradiction is knowable earlier, codegen or reservation
should reject it before a generic transfer 403.

## Resolution note — product half (2026-08-06)

The server now refuses unsatisfiable owner custody at reservation time in
`asset_attempt_create`, before it runs the generated authorizer or creates
attempt/asset state. The stable refusal code is
`SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE`; it explains that every attempt
records the authorizer-declared owner and that transfer, resume, finalize, and
attach must present that owner's resolved authority, then points to ordinary
session custody or operator impersonation as the paved fixes.

Codegen cannot prove this contradiction. The authorizer output contract is
closed to exactly `{ owner: <non-empty principal> }`, so every intent declares
an owner; whether the caller can match it depends on runtime custody rather
than the intent declaration. In particular, an `auth: 'public'` intent called
with session custody is legitimate.

## Closed

2026-08-06: All four acceptance items are met — the assets guide states the
owner-principal constraint and expected transfer authority (guide half,
2026-08-05), the server now refuses the unsatisfiable anonymous/owned design
at reservation with `SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE` before any
transfer starts (product half, above), and the CI-verified ImagePicker →
`expo/fetch` → Blob → `useSnapbackAssetUpload` recipe with real session
custody landed with the guide half. Verified by the asset unit suite
(including the new anonymous-custody refusal test) on a clean fleet checkout.
