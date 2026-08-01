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
