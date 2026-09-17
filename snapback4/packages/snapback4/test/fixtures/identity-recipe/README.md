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

`qualify.mjs` is a credentials-gated actual-provider witness for this exact
fixture. Run it with Node 24 while the generated app is live, setting
`SNAPBACK4_OIDC_QUALIFICATION_CONFIG` to an outside-repository mode-0600 JSON
file and, if needed, `SNAPBACK4_URL`. It drives Keycloak's browser login form
and code flow without starting a callback listener; it never uses a password
grant and emits no credential, code, binding or session value. It also proves
the returned Session on an ordinary generated query, logs that token out, and
checks that revoked/unrelated guest authority cannot collect the completed
action result.

Do not commit or print the client secret, binding, authorization code, provider
tokens, or returned session. No provider credential is stored in this
repository; the dated Journal records the local external-credential witness,
which a downstream checkout does not inherit. Google qualification remains
credentials-pending. The deterministic signed provider in
`test/identity.test.mjs` is a protocol double, not actual-provider evidence.

The prior actual-provider record used the published 0.2.26 engine and qualifies
only the B1a healthy path described above. That engine predates the bound
session-mint wire and must not be used to run a B1c flow: it may silently take
the legacy unbound mint path. B1c actual repaired-engine HTTP, lost-response
and crash qualification is pending in the parent integration lane. Google
credentials remain absent, so Google, production HTTPS and a real browser are
also unqualified. Verification/recovery and the organizations-and-invitations
recipe remain later identity work; this fixture is not full Identity/B.
