# Retrieval eval run — 2026-08-06 — Expo photo upload without login (seed case 7)

**Protocol:** guide/retrieval-eval.md (LLP 0061 §5; seed case added by LLP
0187 T7 / LLP 0186 W2 from the 3/3 bakeoff miss where the authorization rule
and the native URI→body recipe were documented apart and every arm hit the
same 403 wall).
**Fixture:** fresh Claude subagent with no inherited conversation context,
cold in the Snapback worktree checkout at `42218ccae`, instructed to read
`AGENTS.md` first and then plan (read-only) uploading a device-library photo
from an Expo app that has no login screen.
**Run:** `guide/index.md` at tool use 2, `guide/backend/assets.md` (the
unified recipe) at tool use 3, `guide/clients/react-expo.md` at tool use 4.
Seven tool uses total.

## Rubric

- **(a) Loads the relevant guide page within ~15 tool uses: PASS.**
  `backend/assets.md` at tool use 3; the react-expo page cross-referenced
  the same recipe at tool use 4; auth pages and the capability index
  followed by tool use 7.
- **(b) Plans with the paved technique: PASS.** `defineAssetUpload` with a
  server-side `authorize` owner, `v.assetRef` + `.assetSharing`,
  `ctx.assets.attach`, and the unified native path — ImagePicker →
  `expo/fetch` Blob → `useSnapbackAssetUpload.start` → `task.done` receipt —
  with session custody via the supervised `snapback dev --expo` mint or a
  trusted broker + `createExternalSessionClient`. **The owner-authorization
  rule was stated exactly:** every attempt records the non-optional owner
  principal, transfer/finalization/attachment compare it to the caller, and
  an anonymous request can never satisfy it in any intent auth mode — "no
  login screen" therefore means supervised/broker-minted session, not
  anonymous upload.
- **(c) Avoids the named anti-patterns: PASS.** Rejected hand-rolled
  multipart/TUS clients, `auth: 'public'`/`userId` smuggling as fake
  auth-less upload, base64-in-row storage, hand-written asset-id writes
  (`SNAPBACK_ASSET_REF_UNVERIFIED`), client-side EXIF stripping, and
  admin/impersonation capability in the app bundle — each with the page
  citation.

**Verdict: PASS.** The bakeoff's stranded-halves failure (blob bridge found
without the authorization rule, or vice versa) did not reproduce; one page
carried both halves and the agent surfaced the rule unprompted.

## Agent tool transcript

1. Read `AGENTS.md` — steered to the guide.
2. Read `guide/index.md` — map pointed at Assets, React Expo, and Auth.
3. Read `guide/backend/assets.md` (unified ImagePicker recipe).
4. Read `guide/clients/react-expo.md`.
5. Read `guide/auth/native-apps.md`.
6. Read `guide/auth/sessions-and-principals.md`.
7. Grep of `guide/capabilities.md` — `backend.assets` and
   `clients.react-expo` rows confirmed, no blocking GAP.
