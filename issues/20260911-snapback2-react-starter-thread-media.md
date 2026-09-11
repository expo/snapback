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
[0.0.21 findings](./closed/20260910-snapback2-clique-0021-findings.md).
