# Guide gap: a simple React asset app is not one-command paved

**Status:** Resolved (2026-08-02)
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Guide, Assets, React client, Vite relay, Codegen, Developer experience
**Found by:** Snapdrop demo (`demos/file-drop`)
**Date:** 2026-08-02
**Governing:** LLP 0041, LLP 0044, LLP 0061

## Problem

Following `guide/index.md`, the React authoring loop, and the Assets page does
not currently produce a working browser upload app through the documented
single `snapback dev ... --client-command vite` path:

1. `@expo/snapback-vite`'s explicit app-route allowlist omits the complete
   `/assets/*` route family, so `useSnapbackAssetUpload` receives
   `SNAPBACK_DEV_PROXY_ROUTE_REFUSED` on `POST /assets/attempts`.
2. The asset client deliberately resolves dev-mode HTTP asset requests as
   anonymous because its DTO/TUS carrier has no dev body-authority member.
   Passing `userId` to the task does not authenticate it. The Assets guide's
   minimal path does not say that a browser app must currently use sessions
   custody (or an operator-only host-op path).
3. Codegen emits the explicit upload reference at runtime as
   `api.photoUpload`, but omits it from `GeneratedApi` in `api.d.ts`. A strict
   React app needs a local type bridge for the documented hook call.

Snapdrop works around (1) with a local Vite proxy, (2) with sessions plus a
trusted-local server-side mailbox helper, and (3) with a narrow type bridge.
Those are honest and executable, but they are far beyond the ceremony implied
by the guide's minimal example.

## Acceptance

- the first-party Vite relay admits exactly the author-facing asset routes
  required by the generated asset client while continuing to refuse system
  and admin routes;
- the React template or Assets guide supplies a browser-safe sessions demo
  path and explicitly distinguishes it from the dev-mode host-op asset lane;
- explicit and derived upload references have generated TypeScript types
  accepted directly by `useSnapbackAssetUpload`;
- a clean scaffold can implement upload → typed attach → live row → browser
  rendition with no app-owned proxy or generated-reference cast; and
- the complete path is a CI-verified browser example linked from
  `guide/backend/assets.md` and the capability index.

## Resolution (2026-08-02)

All five acceptance items landed together:

1. **Relay:** `packages/snapback-vite/allowlist.mjs` forwards the complete
   author-facing `/assets/*` family — attempts
   (create/inspect/cancel/finalize), the TUS resource (HEAD/PATCH/DELETE),
   records (inspect/delete/bytes/signed-url issuance), and the signed and
   public delivery lanes — all AppData rows of `core_route_registrations()`
   (LLP 0031 dated amendment 2026-07-31). System and admin routes stay
   refused; the matrix in `packages/snapback-vite/package.test.mjs` covers
   both directions, and LLP 0030 §Proxy surface carries the dated update.
2. **Sessions guidance:** `guide/backend/assets.md` gained a "Browser apps:
   the paved React + Vite path" section that states the dev-anonymous fact
   (a task `userId` does not authenticate an authenticated intent; sessions
   custody is the browser path) and distinguishes it from the CLI/host-op
   `--user` lane, with the trusted-local mailbox seam documented and
   cross-linked to the sessions guide.
3. **Types:** `packages/snapback-codegen` emits explicit and derived upload
   references as typed `AssetUploadReference` members of `GeneratedApi` and
   types the `defaults.<table>.<field>` subtree
   (`GeneratedAssetUploadDefaults`); `useSnapbackAssetUpload({ upload:
   api.photoUpload })` typechecks with no cast
   (`asset-upload-authoring.test.mjs` asserts the declaration surface; all
   committed generated artifacts regenerated).
4. **Clean scaffold:** `demos/file-drop` deleted its `/__snapdrop` proxy and
   type bridge; upload → typed attach → live row → browser rendition runs
   entirely over the stock `/__snapback` relay (strict `tsc --noEmit` in the
   proof).
5. **CI-verified example:** `demos/file-drop/tests/acceptance/browser-relay.mjs`
   (kit sessions server + programmatic Vite on ephemeral ports, 7/7 checks)
   runs from `scripts/verify-local-proof`, and is linked from
   `guide/backend/assets.md` and the `backend.assets` capability-index row.

Diary entry: `diaries/0051-snapdrop-file-upload.diary.md` (2026-08-02).

