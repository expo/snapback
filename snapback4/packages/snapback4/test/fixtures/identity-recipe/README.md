# B1a actual-provider qualification fixture

This fixture uses ordinary generated actions and the one supervised `dev`
process. It adds no callback or backend listener. Its fixed development
configuration is the parent-provisioned Keycloak 26.7.4 realm:

- issuer `http://127.0.0.1:38971/realms/sb4-b1a-20260917`
- confidential client `snapback4-b1a`, code flow only, S256 required
- frontend callback `http://127.0.0.1:38972/auth/callback`
- frontend origin `http://127.0.0.1:38972`

Copy the `snapback/` directory into a disposable application, install this
workspace package, supply `OIDC_CLIENT_SECRET` to `snapback4 dev`, and run
`check` before `dev`. The browser first creates a real guest session, creates
and retains at least 32 random bytes as its binding secret, sends only
`base64url(SHA-256(binding))` to `beginOidc`, and navigates to the returned
authorization URL. The frontend callback then POSTs `{ code, state, binding,
error: null, iss }` to `completeOidc` with that same guest session, preserving
the RFC 9207 `iss` response parameter when present. It adopts only
the returned standard `Session`.

Do not commit or print the client secret, binding, authorization code, provider
tokens, or returned session. This repository has no supplied provider secret,
so the fixture is intentionally not claimed as run. Google qualification is
also credentials-pending. The deterministic signed provider in
`test/identity.test.mjs` is a protocol double, not actual-provider evidence.
