# Snapback 2 web asset URL minting fails silently, leaving an ordinary clip blank

**Status:** Open
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 React asset components (`useAssetUrl`, `AssetVideo`), carrier minting
**Related:** LLP 1012, LLP 1006, [React starter media](./closed/20260911-snapback2-react-starter-thread-media.md)

## Evidence and impact

An ordinary `AssetVideo` plays from a carrier URL minted by
`client.assetUrl(asset, { carrier: true })`, which posts to `/api/auth/asset-session`.
`useAssetUrl` in `snapback2/packages/snapback2/src/react-core.tsx` ends its effect with
`.catch(() => undefined)`, so a failed mint (offline, a dropped network, or a refused or
failing session request) never resolves a URL and never reaches `onRefusal`. The
`<video>` has no `src` and fires no `error`, so an application cannot tell a slow mint
from a failed one.

This is source-confirmed through the React chat starter's `MessageMedia.tsx`, which
works around the offline case by retrying media that began loading without a
connection when the connection returns. A mint that fails while the client still
believes it is connected leaves a blank player with no caption until the component
remounts. A source review of that starter found the gap; it was not reproduced in a
browser.

## Requested outcome and acceptance

- Report a mint failure to `AssetVideo`'s `onRefusal` (and to other `useAssetUrl`
  consumers) with its refusal family instead of dropping it.
- Re-mint when the failing condition changes, for example when the connection returns,
  or document that the caller owns retry.
- Cover offline, transport and session-refusal mints in package tests, then delete the
  starter's retry workaround.
