---
title: "Recipe: browser sign-in and reload custody"
id: recipes.browser-auth
order: 5
audience: agent-first
capabilities: [auth.sessions, auth.external-identity-broker, auth.browser-session-custody, auth.scoped-queries, auth.invalidation-barrier]
authorities: [llp/0057-auth-provider-protocol.spec.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0060-hosted-auth-security.rfc.md, llp/0151-first-party-identity-integrations.rfc.md, packages/snapback-client/index.mjs, packages/snapback-contract/auth-coordinator.mjs, demos/browser-auth/snapback/schema.mjs, demos/browser-auth/snapback/functions.mjs, demos/browser-auth/server/gateway.mjs, demos/browser-auth/surfaces/web/main.mjs, demos/browser-auth/tests/acceptance/browser-auth.mjs]
examples: [demos/browser-auth, demos/pointing-room/surfaces/contract, demos/file-drop/vite.config.ts]
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

## Get the sign-in code in local development

For a non-React Contract/Vite surface, use a **serve-only dev mailbox relay**.
The Vite process reads the ready-file carriers server-side; page code never
does. Pointing Room accepts explicit environment carriers for harnesses or
reads the owner-only files named by the ready descriptor:

```ts source=demos/pointing-room/surfaces/contract/vite.config.ts
function localMailboxCredentials(): { adminToken: string; impersonation: string } | null {
  const explicitAdmin = process.env.SNAPBACK_POINTING_ADMIN_TOKEN?.trim();
  const explicitImpersonation = process.env.SNAPBACK_POINTING_IMPERSONATION_CAPABILITY?.trim();
  if (explicitAdmin && explicitImpersonation) {
    return { adminToken: explicitAdmin, impersonation: explicitImpersonation };
  }
  const readyFile = process.env.SNAPBACK_POINTING_READY_FILE;
  if (!readyFile) return null;
  const descriptor = JSON.parse(readFileSync(readyFile, 'utf8')) as {
    adminTokenFile: string;
    impersonationCapabilityFile: string;
  };
  return {
    adminToken: readFileSync(descriptor.adminTokenFile, 'utf8').trim(),
    impersonation: readFileSync(descriptor.impersonationCapabilityFile, 'utf8').trim(),
  };
}
```

The plugin applies only to `vite serve`, recognizes one relay route, calls only
the gated mailbox endpoint, disables caching, and passes every other request to
the next middleware. It is not an arbitrary Snapback proxy:

```ts source=demos/pointing-room/surfaces/contract/vite.config.ts
// The local provider has no mail delivery. This serve-only middleware keeps
// the admin and impersonation carriers in the Vite process and relays only the
// one-time code to the browser. It never proxies arbitrary Snapback routes.
const pointingRoomMailbox = {
  name: 'pointing-room-local-mailbox',
  apply: 'serve' as const,
  configureServer(server: { middlewares: { use: Function } }) {
    server.middlewares.use(async (
      request: { url?: string },
      response: {
        statusCode: number;
        setHeader(name: string, value: string): void;
        end(body: string): void;
      },
      next: () => void,
    ) => {
      if (!request.url?.startsWith('/__pointing-mailbox')) return next();
      const challengeId = new URL(request.url, 'http://pointing-room.local')
        .searchParams.get('challengeId');
      const credentials = localMailboxCredentials();
      if (!challengeId) {
        response.statusCode = 400;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        return response.end(JSON.stringify({ error: 'missing challengeId' }));
      }
      if (!credentials) {
        response.statusCode = 503;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        return response.end(JSON.stringify({
          error: 'local mailbox credentials unavailable',
          recovery: 'set SNAPBACK_POINTING_READY_FILE or both SNAPBACK_POINTING_ADMIN_TOKEN and SNAPBACK_POINTING_IMPERSONATION_CAPABILITY',
        }));
      }
      const mailbox = await fetch(
        `${snapbackTarget}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(challengeId)}`,
        {
          headers: {
            'x-snapback-admin-token': credentials.adminToken,
            'x-snapback-impersonation-capability': credentials.impersonation,
          },
        },
      );
      response.statusCode = mailbox.status;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      return response.end(await mailbox.text());
    });
  },
};
```

The browser half remains the ordinary public flow: request a challenge, fetch
the relayed one-time code, and exchange it into coordinator-owned custody.

```ts source=demos/pointing-room/surfaces/contract/main.ts
async function signIn(client: SnapbackClient, email: string) {
  const challenge = await client.authRequestCode(email);
  const mailboxResponse = await fetch(
    `/__pointing-mailbox?challengeId=${encodeURIComponent(challenge.challengeId)}`,
  );
  if (!mailboxResponse.ok) {
    throw new Error(`local sign-in mailbox refused (${mailboxResponse.status}): ${await mailboxResponse.text()}`);
  }
  const mailbox = await mailboxResponse.json() as { code: string };
  return await client.authExchange({ challengeId: challenge.challengeId, code: mailbox.code });
}
```

The browser receives only the one-time code. The admin token, impersonation
capability, mailbox reader, and any private backend origin must never enter
`define`, `import.meta.env`, page code, the bundle, or logs. Pointing Room's
ordinary app-data origin is separately browser-reachable; that does not make a
private relay origin safe to publish. The React-side sibling is
[`demos/file-drop/vite.config.ts`](repo:demos/file-drop/vite.config.ts); the
custody rule is framework-independent.

This relay is a local dev fixture, not production challenge delivery. Replace
it with the admitted provider/delivery path when one exists; do not deploy the
Vite middleware as an auth service.

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

## Recover browser custody after a dev reset

Resetting the local Snapback store rotates its authorization-stream
incarnation and removes its sessions. A browser profile may still hold the old
bearer in IndexedDB, but the first-party client now recovers automatically; the
app should not delete the custody database or reconstruct the client itself.

The recovery is deliberately narrower than “401 means logout”:

1. the stale bearer receives a terminal `carrier` refusal, which by itself
   preserves durable custody;
2. the client makes one bearerless `GET /auth/session` probe;
3. only a valid settled anonymous handshake whose
   `authorizationStreamIncarnation` differs from stored custody may enter the
   coordinator barrier; and
4. the standard quiesce, blank, durable clear, settle, and resume sequence
   reopens the app directly on the observed anonymous incarnation.

This also repairs a cold-reload coordinator whose initial resume failed closed,
so anonymous-eligible operations such as `health()`, `authRequestCode()`, and
logout can proceed without app-side custody surgery. A concurrent tab that has
already signed in wins the coordinator's exact durable comparison; the stale
tab cannot blank or replace it.

The incarnation difference is the security predicate. A network intermediary
can strip an `Authorization` header and provoke a refusal, but cannot fabricate
the origin's valid anonymous handshake at a new incarnation. A failed probe or
a same-incarnation anonymous response therefore leaves custody untouched.
Unsupported partial deletion that removes session rows while preserving the
stream incarnation does not use this recovery path; use the supported reset or
declared-restore workflow, which rotates the incarnation, instead of weakening
the witness.

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
- Do not recover a dev reset with `indexedDB.deleteDatabase(...)`; it is
  database-scoped rather than app-scoped and bypasses the coordinator barrier.
- Do not put mailbox/admin/impersonation material in browser code or logs.
- Do not expose the mailbox as a generic proxy or publish its private backend
  origin through Vite environment replacement.
- Do not use memory custody and claim reload persistence.
- Do not label this local fixture hosted, OIDC-complete, or production-ready.
