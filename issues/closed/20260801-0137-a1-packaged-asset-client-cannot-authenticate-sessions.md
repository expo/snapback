# A1 sweep: packaged SnapbackAssetClient sends no bearer or protocol offer (sessions-mode uploads impossible)

**Opened:** 2026-08-01
**Systems:** Client integration, Assets
**Related:** LLP 0137 (A1 arm), LLP 0044, demos/improvement-sweep/arms/a1-snapback-web/findings/0137-a1-f3-packaged-asset-client-cannot-authenticate-sessions.json

`@expo/snapback-client/assets` builds its own fetches (attempt create, TUS
HEAD/PATCH, finalize) with only `content-type` plus optional
`x-snapback-dev-user`; it never carries the wrapped client's bearer or the
`x-snapback-auth-client-protocol` offer. On a sessions-mode server every
upload fails at attempt creation with
`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` — the guide's "framework-neutral
upload task" is dev-mode-only in practice. The server lifecycle is fine: the
A1 arm drove the same attempt/TUS/finalize with authenticated raw requests
and reached `ready`.

Fix shape: route asset-client requests through the wrapped client's
authenticated transport, keep dev-user custody for dev mode, and add a
sessions-mode packaged-closure upload conformance test.

---

**RESOLVED 2026-08-01 (fix-wave α1) — fixed in source; packaged
staleness tracked separately.** The source defect this ticket describes
is fixed on main: attach admissions thread through all served-path
dry-run seams (cb608f7b, landed 2e73c1cd), the pasteable delivery lanes
are implemented with the header exemption (f9679cf4), and the asset
client carries sessions bearer custody + the protocol offer (0aba0280,
landed 5cba02cf). Verified today by tests/acceptance/
asset-conformance-v1.mjs: ok=true, 18/18 including handlerAttachCommits,
pasteableDeliveryHeaderless, and the sessions-custody legs. What remains
is that packaged 0.1.7 predates these landings — the staged/published
closure refresh is Lane α milestone 2 of the fix wave (see the α2
handoff/receipt recorded there).
