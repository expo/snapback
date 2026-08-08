---
title: "Recipe: browser sign-in and reload custody"
id: recipes.browser-auth
order: 5
audience: agent-first
capabilities: [auth.sessions, auth.external-identity-broker, auth.browser-session-custody, auth.scoped-queries, auth.invalidation-barrier]
authorities: [llp/0057-auth-provider-protocol.spec.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0060-hosted-auth-security.rfc.md, llp/0151-first-party-identity-integrations.rfc.md, demos/browser-auth/snapback/schema.mjs, demos/browser-auth/snapback/functions.mjs, demos/browser-auth/server/gateway.mjs, demos/browser-auth/surfaces/web/main.mjs, demos/browser-auth/tests/acceptance/browser-auth.mjs]
examples: [demos/browser-auth]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-commit: 2c6b3d38cbf2ba197cfb0390aaddba1ce107e4e0
---

# Recipe: browser sign-in and reload custody

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use this recipe when a browser app already has an identity front door and
app-owned user rows. The registered [`browser-auth` demo](repo:demos/browser-auth)
proves the complete local composition in real Chrome:

1. an app-owned trusted server verifies an external assertion;
2. immutable `(issuer, subject)` selects the app user;
3. the server binds the resulting Snapback principal before releasing a
   one-use browser exchange;
4. `AuthCoordinator` stores the bearer in IndexedDB;
5. a full reload restores the protected user without another exchange; and
6. logout blanks protected data, revokes the session, and leaves reload
   anonymous.

This is a **product-shaped local recipe**, not hosted or production-ready
authentication. Its signed-assertion identity provider and capture mailbox are
hermetic fixtures. Draft LLP 0151's first-party provider and completion
protocol are larger unimplemented surfaces, described under
[the boundary](#know-exactly-where-this-stops).

## Bind the immutable identity, not email

Provider email and display name can change. The durable external identity key
is `(issuer, subject)`, and every side of the app-level join is unique:

```js source=demos/browser-auth/snapback/schema.mjs
  identityBindings: defineTable({
    principal: v.principal(),
    appUserId: v.id('appUsers'),
    externalIssuer: v.string(),
    externalSubject: v.string(),
  })
    .index('by_principal', ['principal'], { unique: true })
    .index('by_app_user', ['appUserId'], { unique: true })
    .index('by_external_identity', ['externalIssuer', 'externalSubject'], { unique: true }),
```

The trusted server verifies the assertion first, derives a stable opaque local
email from issuer + subject for the shipped email-code provider, and invokes
the private binder through a direct server-side client. It stages a second,
one-use challenge/code for the browser. The browser never receives the admin
token, impersonation capability, mailbox reader, provider assertion, private
backend origin, or a bearer in a redirect URL.

Do not expose the binder merely because `/mutation/{name}` is generally an app
route. The demo's app gateway uses an exact method + route allowlist:

```js source=demos/browser-auth/server/gateway.mjs
const PUBLIC_ROUTES = Object.freeze(new Set([
  'GET /auth/session',
  'POST /auth/exchange',
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /query/viewer',
]));
```

Both `brokerBindPrincipal` and its closed fixture setup mutation are absent.
The acceptance suite requests them through the public origin and requires an
allowlist refusal before Snapback sees the request.

For the rationale and the frozen-fixture alternative, read
[bind a principal to your app's user identity](../auth/app-identity-binding.md).

## Let the server-derived principal select protected data

The protected query takes no user, email, issuer, or subject argument. It
starts at `ctx.auth.userId`, follows the private binding, and returns exactly
that app user's row:

```js source=demos/browser-auth/snapback/functions.mjs
export const viewer = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['appUsers', 'identityBindings'],
  result: results.records(v.object({
    principal: v.principal(),
    externalIssuer: v.string(),
    externalSubject: v.string(),
    displayName: v.string(),
    privateNote: v.string(),
  }), { minItems: 1, maxItems: 1 }),
  handler: async (ctx) => {
    const { appUser, binding } = await requireBoundUser(ctx);
    return [{
      principal: ctx.auth.userId,
      externalIssuer: binding.externalIssuer,
      externalSubject: binding.externalSubject,
      displayName: appUser.displayName,
      privateNote: appUser.privateNote,
    }];
  },
});
```

This is application-level identity binding. It does not replace the future
platform-owned `_auth_identities` lifecycle in Draft LLP 0151.

## Put browser custody in IndexedDB

Construct exactly one coordinator with the generated app id and the shipped
IndexedDB adapter, then pass it to the client:

```js source=demos/browser-auth/surfaces/web/main.mjs
export const authCoordinator = new AuthCoordinator({
  appId: APP_ID,
  storage: createIndexedDbAuthCustodyStorage(),
});

export const client = new SnapbackClient('/__snapback', {
  authCoordinator,
  authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1,
  authorizedLeaseProtocol: 1,
  clientStoreId: 'browser-auth-recipe-web',
  rqsStore: null,
});
```

`createMemoryAuthCustodyStorage()` is useful for headless tests and
document-lifetime flows, but it cannot prove browser reload custody. A SPA
route change does not reconstruct the JavaScript process; use a true page
reload as the distinguishing acceptance check.

The callback redirects to `/?login=complete`. Only that boot consumes the
one-use challenge/code and calls `authExchange`; it then removes the marker
from browser history. An ordinary reload finds no bootstrap and lets the
coordinator restore its settled session from IndexedDB. The acceptance suite
asserts that neither the bootstrap-consumption count nor `/auth/exchange`
count advances on reload.

Bearer-v1 IndexedDB custody survives reload, but page JavaScript can still use
the credential. It is not XSS-resistant or sender constrained — see
[target claims](../auth/targets.md).

## Treat logout as a visibility barrier

Remove app-visible protected state before awaiting logout, then let
`authLogout()` perform the coordinator's revocation transition. The acceptance
gateway deliberately holds the `/auth/logout` request while Chrome proves the
private row is absent. After release it requires anonymous durable custody,
protected-query refusal, and an anonymous full reload.

Do not implement logout by deleting an app variable or IndexedDB row yourself.
That skips server revocation and the coordinator barrier.

## Run the witness

```sh
cd demos/browser-auth
SNAPBACK_RUNTIME_BINARY=/path/to/qualified/snapback bun run prove
```

The witness also changes the fixture email and requires the same principal and
app-user binding, then signs in a second subject and proves it cannot see the
first user's private note.

## Know exactly where this stops

The recipe deliberately does **not** claim:

- a shared broker or broker-issued identity namespace;
- a generic OIDC adapter or any first-party Google/Apple/GitHub/Expo provider;
- Draft LLP 0151's discovery, JWKS rotation, PKCE/state/mix-up, sender-
  constrained completion-code, provider config/secrets, and two-arm matrix;
- production challenge delivery — the local capture mailbox is
  admin + impersonation gated; or
- an admitted hosted auth target.

Draft LLP 0151 chooses app-owned provider credentials as the paved production
direction and keeps a shared Google relay preview-only and conditional. A real
provider integration must wait for that RFC's implementing completion/lifecycle
specs; do not generalize this fixture into those contracts.

## Anti-patterns

- Do not expose the private binding mutation through the browser app gateway.
- Do not key identity by email or auto-link across providers by matching email.
- Do not return a broker-minted bearer to browser app state and call it
  coordinator custody.
- Do not put mailbox/admin/impersonation material in browser code or logs.
- Do not use memory custody and claim reload persistence.
- Do not label this local fixture hosted, OIDC-complete, or production-ready.
