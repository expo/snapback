# Expo golden-path fixture uses a DOM-only asset image component

**Status:** Resolved 2026-08-06
**Impact:** 4
**Urgency:** 5
**Ease:** 5
**Confidence:** 5
**Systems:** Expo fixture, Assets, React Native, LLP 0176 G3 receipts
**Date:** 2026-08-06
**Governing:** LLP 0044, LLP 0176, LLP 0181
**Related:** `demos/expo-golden-path-fixture/src/screens/chat-screen.tsx`,
`packages/snapback-react/index.mjs`

## Problem

The north-star React Native screen renders message images with
`SnapbackAssetImage`. That component is explicitly the web convenience arm and
returns a DOM `img`; its own source comment directs React Native consumers to
`useSnapbackAssetImage` plus their native `Image` component.

G2 never exercised an image row, so the misuse stayed latent. LLP 0176 G3 must
visibly render a real picked image through its Snapback delivery URL on iOS and
Android. The current component cannot provide honest native receipt evidence.

The first corrected device run exposed a second link in the same rendering
chain: `useSnapbackAssetImage` always projected the authenticated
`/assets/records/.../bytes/...` route even for a `public-immutable` record.
React Native's plain `Image` request carries no Snapback auth-client headers,
so the URL could be computed correctly while native delivery still failed.

## Acceptance

- The Expo screen consumes `useSnapbackAssetImage` and renders the resulting
  rendition URL through React Native `Image`.
- A native `onLoad` fact distinguishes pixels actually loaded from a URL merely
  being computed.
- The G3 proof marker does not pass until the committed image row is present and
  that native rendition load has occurred.
- Headless/type verification and both platform receipts pass.

## Resolution

The fixture now uses `useSnapbackAssetImage` plus React Native `Image`, and its
G3 join waits for native `onLoad`. The asset client gained a typed
`publicDeliveryUrl`, while the React hook selects one concrete ready rendition
and uses that pasteable route for `public-immutable`; private profiles keep the
strict route. The React asset tests cover that selection. Both final receipts
show the image pixels in the thread and record `image-delivery-rendered`
before their pass marker:

- `demos/expo-golden-path-fixture/receipts/20260806-g3-ios-simulator.md`
- `demos/expo-golden-path-fixture/receipts/20260806-g3-android-emulator.md`
