# Browser auth recipe

This registered demo is the smallest executable local composition for a
browser app that already has external identities and app-owned user rows. It
proves this path:

1. an app-owned trusted server verifies a hermetic signed assertion;
2. immutable `(issuer, subject)` selects the app user;
3. a server-only session binds the Snapback principal to that app user;
4. the browser receives a one-use email-code exchange, never an admin or
   impersonation capability;
5. `AuthCoordinator` owns the bearer in IndexedDB;
6. protected data resolves only through `ctx.auth.userId`; and
7. logout revokes and clears custody before a signed-out reload.

Run it with a qualified local runtime and Chrome:

```sh
cd demos/browser-auth
SNAPBACK_RUNTIME_BINARY=/path/to/snapback bun run prove
```

The sibling password surface removes the trusted assertion/mailbox bridge and
uses only `authPasswordSignup`, `authPasswordSignIn`, `authLogout`, and the
shipped IndexedDB custody adapter. Its real-Chrome witness signs up, reloads,
logs out, signs in, and reloads again while asserting that neither reload
repeats issuance:

```sh
node packages/snapback-codegen/index.mjs demos/browser-auth/snapback
cd demos/browser-auth
bun install --frozen-lockfile
SNAPBACK_RUNTIME_BINARY=../../target/debug/snapback volta run --node 24.18.0 node tests/acceptance/password-auth.mjs
```

This command requires a Chrome/Chromium process that can reach CDP. A browser
binary merely being installed is not evidence: the witness fails if Chrome
exits before the controlled CDP profile is ready.

The identity fixture is deliberately not called OIDC. Draft LLP 0151 requires
substantially more for a first-party provider adapter: discovery/JWKS policy,
PKCE and state, mix-up defense, sender-constrained completion-code redemption,
adversarial fixtures, provider-owned configuration, and both deployment-arm
acceptance. Its production path also uses app-owned provider credentials, not
a shared broker. Replace `server/external-assertion.mjs` with the app's real
server-side verifier; do not move verification or secrets into the browser.

The bridge still depends on the local email-code capture mailbox. Snapback has
no production mail adapter and no admitted hosted browser-auth target, so this
demo is product-shaped authoring evidence, not production-ready auth.

Not claiming: a shared identity broker, hosted authentication, production
challenge delivery, email-v1 activation while the fresh catalog still reports
`username-v1`, or sender-constrained browser custody.
