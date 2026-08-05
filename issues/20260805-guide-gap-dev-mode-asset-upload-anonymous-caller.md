# guide-gap: dev-mode asset uploads always 403 past the create step, and public-immutable delivery is not actually pasteable cross-origin

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** Assets, Auth (dev mode), Guide, React/Expo client
**Date:** 2026-08-05
**Governing:** LLP 0044 (asset storage pipeline)
**Related:** `guide/backend/assets.md`, `guide/auth/sessions-and-principals.md`

## Summary

Built while wiring image messages for `demos/messaging-snapback`. Two related
findings that the guide does not currently make legible before you hit them:

### 1. Every `defineAssetUpload` intent 403s on its second request in dev mode, regardless of `auth: 'public'` vs `'authenticated'`

`guide/backend/assets.md` documents one caveat: "Authenticated intents need
sessions custody... An intent with `auth: 'authenticated'` therefore requires
a real signed-in session in the browser." This reads as if `auth: 'public'`
sidesteps the problem. It does not.

The mechanism (confirmed by reading `src/local.rs::asset_attempt_for_caller`
and `src/assets.rs`'s attach-authorization check): every asset op after
creation (`TUS PATCH`, finalize, `ctx.assets.attach`) requires the request's
resolved caller principal to *equal* the `owner_principal` recorded on the
attempt/asset at creation time (from the upload intent's `authorize()`
result). But `packages/snapback-client/assets.mjs`'s `#custodyHeaders` always
resolves the caller as **anonymous** over plain dev-mode HTTP — this part
*is* documented ("dev-lane HTTP asset requests resolve anonymous"). What is
not stated: since `caller` is `None` and `owner_principal` is a required
non-optional `String`, the comparison `caller.as_deref() != Some(owner)` is
**unconditionally true** for every possible owner value. There is no
`owner` an `authorize()` handler can return that makes a plain anonymous
dev-mode HTTP upload complete — not for `auth: 'public'`, not for
`auth: 'authenticated'`, regardless of session state, because there is no
session at all on this lane.

The only paved way to complete an asset upload in dev mode (confirmed
working) is through an identity that resolves to `DevImpersonation`, i.e.
`snapback assets put ... --user <handle>` (the CLI's admin-impersonated
host-ops path), never the ordinary `SnapbackClient`/`createAssetClient` HTTP
surface a React/Expo app uses. Concretely, this means: **an interactive Expo
app running against a dev-mode server with no real session can never
complete an in-app image upload**, even when `useSnapbackAssetUpload` is
wired exactly per the guide. The guide's browser caveat should say this
plainly and generalize it to native (Expo/React Native) clients too, not
just "browser + authenticated."

Repro: `demos/messaging-snapback/snapback/functions.mjs`'s `messageImageUpload`
intent, `demos/messaging-snapback/tests/acceptance/headless.mjs`'s "a real
image upload attaches" check (which now uses the CLI workaround and passes)
and `demos/messaging-snapback/src/app/conversation/[id].tsx`'s in-app photo
picker (which surfaces the honest `SNAPBACK_ASSET_TRANSFER_FAILED` 403 to the
user when tried against the dev server).

### 2. `public-immutable` delivery is not cross-origin embeddable despite being documented as "pasteable"

`guide/backend/assets.md` states public-immutable/private-signed delivery is
"pasteable: the URL is the entire authority, so a plain `<img src>`, a CDN
pull, or a link pasted into an email fetches with no Snapback headers."

In practice every response (verified via `curl -sD -`) carries
`cross-origin-resource-policy: same-origin`, applied uniformly whenever
`response_sensitivity == StaticPublic` (`src/server.rs` ~line 8841), with no
apparent carve-out for asset delivery routes. A browser refuses to load such
a URL in an `<img>` tag from a different origin
(`net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`, reproduced against Chrome
loading `demos/messaging-snapback`'s Expo web preview on `:8099` against the
backend on `:4421`). Direct navigation to the URL (top-level, not embedded)
still works, and same-origin embedding works, so this is specifically a
cross-origin-embed regression against the documented "pasteable...CDN pull"
claim.

## Impact on this build

`demos/messaging-snapback`'s seeded and in-app-sent image messages fetch and
verify correctly server-side (curl, headless test), but the Expo web dev
preview (a different origin from the backend) shows a broken/placeholder
image for them. On a native client (iOS/Android `expo-image`, not a browser
`<img>`) this specific CORP restriction would not apply the same way, but
that is untested here given the remaining time budget — noted as an open
question rather than a claim.

## Suggested fix shape

- `guide/backend/assets.md`: state plainly, near the top of "Upload and
  attach," that dev-mode (no active session) can never complete a
  multi-step asset upload over the plain client HTTP surface, for **any**
  auth mode — only CLI/host-ops impersonation (`--user`) or a real session
  can. Cross-reference this from the React/Expo client pages too, not just
  the browser-relay section.
- Either narrow the "pasteable" claim to same-origin/direct-navigation only,
  or make `public-immutable` (and `private-signed`) delivery routes exempt
  from the blanket `StaticPublic` CORP header so the documented claim holds.
