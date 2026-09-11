# Snapback 2 React starter shows ordinary media as text placeholders

**Status:** Open
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 React chat starter thread and asset presentation
**Related:** LLP 1006.001, LLP 1018.008

## Evidence and impact

At `b47337b26`, [React Thread](../snapback2/packages/snapback2/templates/chat/react/src/Thread.tsx)
uses `[photo]` and `[clip]` as body fallbacks. It mounts `AssetImage` only for
`oncePhoto`; ordinary `photo` and `clip` records have no renderer. In contrast,
[Expo Thread](../snapback2/packages/snapback2/templates/chat/expo/src/screens/Thread.tsx)
already uses `AssetImage` and `AssetVideo` for those ordinary records.

The backend and public React asset components support these values. The missing
template wiring hides that capability. This is source evidence, not a new
playback or upload test result.

## Requested outcome and acceptance

- Render ordinary photo and clip records with the existing public React asset
  components, including accessible text and loading/refusal presentation.
- Demonstrate an authorized ordinary photo and video in a mounted thread,
  including an uploaded record returned through the current query surface.
- Preserve once-photo click-to-open behavior, account-bound openings, and
  removal/revocation handling. Never eagerly consume a once-only asset or
  construct an unauthenticated raw asset URL to render ordinary media.
- Offline held/unavailable bytes follow the existing asset contract. Keep
  Expo's existing ordinary-media path working and update the affected diary.

This adds no formats, native player, composer upload feature, or authorization
mechanism. The separate durable once-photo descriptor report remains in the
[0.0.21 findings](./20260910-snapback2-clique-0021-findings.md).

## Resolution — 2026-09-11

**Status:** Closed. The React thread renders ordinary `photo` records with
`AssetImage` and `clip` records with `AssetVideo` through
`react/src/MessageMedia.tsx`; the `[photo]`/`[clip]` placeholders are gone. The photo
has `alt="Photo"` and a caption: "Loading photo…", "Photo not downloaded" while offline
or when its bytes cannot be reached (an offline byte read refuses as a transport
error), or "Photo unavailable" after a refusal the server made or a decode error. The
video has `aria-label="Video"`, native controls and the same "Video not
downloaded"/"Video unavailable" distinction; a clip opened offline says "Video not
downloaded" even though its player, whose URL is minted over the network, reports no
failure. Media that failed, or began loading without a connection, tries again when
the connection returns, at most three times per mount; media that already loaded, or a
slow load that began online, is left alone. Both are keyed by account and asset, so
state never carries across viewers. Web `AssetImage` gained the `onRefusal` callback
the React Native component already had. The once-photo click gate and account-scoped
openings are unchanged, no raw asset URL is constructed, and Expo's renderer is
untouched.

Evidence (`chat-screens-owner.test.ts`): "React Thread renders ordinary photos and
clips with accessible loading and refusal states" sends a real JPEG and MP4, sees the
photo bytes and the player, shows "Photo unavailable" for a second viewer whose byte
fetch is refused, and shows the first account's photo loading again afterwards; the
offline photo and offline clip tests mount from held data offline and see the network
request made after reconnecting; the unreachable-bytes test answers 503 to every byte
request and bounds that photo's requests. The silent clip mint failure belongs in the
SDK (`useAssetUrl` drops it). This work was first built on a branch whose search,
status and recovery changes were superseded by `75a67c92c`; only this ticket and the
refused-edit ticket were ported onto the page-resource Thread (Diary 0119).
