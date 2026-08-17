<!-- Generated auth section flat projection by scripts/generate-guide-manifest.mjs. Never hand-edit. -->

---

<!-- snapback-guide-source: guide/auth/sessions-and-principals.md -->
---
title: Sessions and principals
id: auth.sessions-and-principals
order: 1
audience: agent-first
capabilities: [auth.sessions, auth.browser-session-custody, auth.scoped-queries]
authorities: [llp/0039-auth-vertical-slice.rfc.md, llp/0057-auth-provider-protocol.spec.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0151-first-party-identity-integrations.rfc.md, llp/0172-explicit-function-authorization.rfc.md, llp/0262-dev-identity-custody-capability.rfc.md, packages/snapback-codegen/index.mjs, src/admin.rs, src/auth/mode.rs, src/auth/provider.rs, src/dev_identity.rs, src/host_ops.rs, src/server.rs, src/cli.rs, packages/snapback-cli/expo-dev.mjs, packages/snapback-client/index.mjs, packages/snapback-client/index.d.mts, packages/snapback-client/auth-identity-types.fixture.ts, packages/snapback-client/unrecognized-authority-recovery.test.mjs, packages/snapback-contract/index.mjs, packages/snapback-vite/lifecycle.mjs, packages/snapback-vite/proxy.mjs, demos/_kit/as-user.mjs, demos/_kit/server-process.mjs, demos/browser-auth/surfaces/web/main.mjs, demos/browser-auth/tests/acceptance/browser-auth.mjs, demos/card-game/snapback/functions.mjs, demos/card-game/tests/acceptance/authority-scope.mjs]
examples: [demos/browser-auth, demos/card-game, demos/party-wall, packages/snapback-client/auth-identity-types.fixture.ts]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-16
reviewed-authorities-digest: sha256:2ac1a38c4cdf294b94a69fe2733378017375a3c2ac6171aaa140926868346199
---

# Sessions and principals

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./targets.md).

The one idea (LLP 0039): **the server derives who you are; the client never
asserts it.** In sessions mode, `ctx.auth` comes only from a server-minted
session resolved at one invocation gate covering every entry path — HTTP,
WebSocket, everything. Everything this page teaches is witnessed by
`demos/card-game/tests/acceptance/authority-scope.mjs`, which runs in the
local proof.

Auth mode is per-app schema config
(`auth: { mode: 'dev' | 'sessions' }` in `defineSchema` — see
[your first backend](../getting-started/your-first-backend.md)). `dev` mode
is the trusted-local convenience where tests pass `userId:` directly;
`sessions` is the real thing below.

That dev-mode assertion now has a per-boot `sbdev_` custody capability,
separate from sessions, admin tokens, and impersonation. The ready descriptor
names its owner-only sidecar in `devIdentityCapabilityFile`; direct/headless
clients and the demo kit read it, managed Vite stamps it behind the same-origin
relay, external dev hosts receive `SNAPBACK_DEV_IDENTITY_FILE`, and supervised
native Expo redeems a one-shot launch nonce. Stage 1 verifies any capability
that is presented but still accepts an absent one with a single server warning
per boot. Missing capability becomes a refusal only at LLP 0262's enforce
stage, after every supported carrier has an acceptance witness; none of this
adds a second gate to admin-token-gated `function.run` or `auth.mintSession`.

## Choose each function's auth requirement

Every user-authored function in a sessions-mode app should explicitly set one
of these requirements:

| `auth` value | Invocation rule |
| --- | --- |
| `'public'` | Anonymous and user-bearing callers are admitted after any presented credential is validated. This declaration does not by itself prove the function is authority-independent. |
| `'optional-user'` | Anonymous and user-bearing callers are admitted, and the handler may deliberately vary behavior when a resolved user exists. |
| `'authenticated'` | Snapback refuses the invocation before the handler runs unless authority contains a resolved user. |

During the compatibility warning phase, omission still emits the legacy
effective requirement `optional-user`, but codegen reports one
`SNAPBACK_AUTH_REQUIREMENT_IMPLICIT` warning per omitted sessions function.
Fix it by adding the intended `auth: 'public'`, `auth: 'optional-user'`, or
`auth: 'authenticated'` field to the function definition; do not treat the
legacy value as an authored choice. Dev-mode functions retain omission as a
trusted-local compatibility convenience and do not produce this warning.

An `authenticated` action cannot be a cron target because scheduled system
authority has no resolved user. Choosing `public` or `optional-user` makes the
cron target compatible with system authority, but does not make it
internal-only or prevent client invocation.

## Provision sessions artifacts explicitly

The legacy `ensureApp({ schema, functions, seed })` request is a settled-dev
compatibility form, not a sessions provisioning authority. Give the client an
admin token and select the closed provision variant:

```js fragment reason="generated manifests and seed are app inputs"
const client = new SnapbackClient(baseUrl, { adminToken });
await client.ensureApp({
  intent: 'provision',
  requestedMode: 'sessions',
  schema,
  functions,
  seed,
});
```

This remains `AdminWrite` and non-production-profile gated before hash
comparison or effects. Staging a fresh `dev → sessions` deployment closes app
data until restart; provisioning an already-settled sessions deployment is
idempotent but still crosses the same authorization gate. Do not hand-write a
`fetch('/app/ensure', ...)` substitute.

For tests and headless suites there is a one-boot form that skips the
provision-then-restart dance entirely: the server-lifecycle kit accepts
the generated startup artifacts directly, so the process comes up already
settled in sessions mode with the impersonation capability captured for
mailbox reads:

```js fragment reason="paths and artifacts are app inputs"
const server = await startServer({
  startupArtifacts,                 // the generated sessions artifacts
  captureImpersonationCapability: true,
});
```

This is the form the acceptance suites use (`demos/_kit/server-process.mjs`);
prefer it over provision-plus-restart whenever the suite owns the server
process.

## Sign in: email code → session credential

The client requests a code and exchanges it. In tests, the shared `asUser`
helper owns that complete loop, including the admin-gated mailbox read:

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
async function mintSession(server, appId, email, clientStoreId) {
  return asUser(server, appId, email, { clientStoreId });
}
```

The result exposes `client`, the public `session`, `userId`, and an idempotent
`dispose`, plus the coordinator and custody state needed by lower-level tests.
From then on the client carries the session credential; `AuthCoordinator`
(from `@expo/snapback-contract`) owns custody, refresh, and the logout barrier.

For a browser/Vite surface in local development, keep the privileged mailbox
read in a serve-only dev-server relay while the browser performs
`authRequestCode` → relay fetch → `authExchange`. The complete non-React
pattern is [get the sign-in code in local development](../recipes/browser-auth.md#get-the-sign-in-code-in-local-development).

The shipped provider has no production mail adapter yet. For a local native
app whose identity front door lives in trusted server code, use the sanctioned
[external identity-broker seam](./native-apps.md): the broker invokes the
gated non-production session-mint host operation and the first-party client
adopts the resulting bearer with exact protocol offers. Neither path is a
hosted-production auth claim.

## Sign in: email + password

The local target also exposes first-class password credentials. Use
`POST /auth/password/signup` with `{ email, password }` to create a principal,
and `POST /auth/password/signin` with the same closed shape thereafter. Both
return the ordinary credential response used by `/auth/exchange`; the session
provider is `local-password`, including on later refreshes. Signup additionally
returns the one-time recovery codes. Store them at that moment: they cannot be
read back.

Password change is session-authenticated. A password session rotates with
`{ currentPassword, newPassword }`. An email-code session can set its first
password only with `{ currentPassword: null, newPassword, stepUp }`, where the
step-up challenge was minted for that exact email identity and operation. The
server never accepts a caller-supplied `userId`.

Recovery codes are the production-shaped recovery path. Send `{ email, code }`
to `POST /auth/recovery/consume`; success consumes that code, revokes the old
session family, mints a local-password session, and returns a replacement code
set exactly once. A local-password session can proactively replace its codes
with `POST /auth/recovery/rotate` and an empty `{}` body.

`POST /auth/password/reset` is deliberately **capture-mailbox only**. It
consumes an email-code challenge and changes a password only when the
email-code and local-password identities already belong to the same principal.
Production refuses with `SNAPBACK_AUTH_PASSWORD_RESET_UNAVAILABLE`; it is not a
stand-in for mail delivery. Production signup is likewise reported unready in
`authProgramReadiness.passwordProvider` and refuses with
`SNAPBACK_AUTH_PASSWORD_SIGNUP_UNAVAILABLE` until blind-accept delivery exists.

### Mint a local session from a trusted server

The paved local operation is
`snapback session mint --email <address> --ready-file <path>`. A trusted broker
that cannot invoke the CLI may call the same host operation over HTTP. The
canonical [exact request, response, authority, and refusal contract](../operating/host-ops.md#mint-a-session-over-http)
lives with the host-ops surface so its shapes have one home. Adopt the returned
bearer through the first-party external-session custody path instead of
inventing another auth carrier. Keep both header values and the returned token
in trusted server custody. Never run this request in browser/native application
code, bake its secrets into a bundle, or treat the non-production gate as
hosted identity.

Two more session routes are shipped and deliberately narrow.
`POST /auth/step-up/request` mints a five-minute, operation-bound
re-authentication challenge for authority-creating consent (approving an
agent grant can demand one via `SNAPBACK_AUTH_STEP_UP_REQUIRED`); its code
delivery shares the mailbox boundary above — on a deployment profile without
the capture mailbox there is no delivery path until LLP 0045's mail adapter
exists, and the request refuses with
`SNAPBACK_AUTH_STEP_UP_DELIVERY_UNAVAILABLE`. `POST /auth/family-alarm` is
the opaque, revoke-only alarm for a bearer you believe leaked: it revokes the
still-live session behind the presented bearer's token family and returns a
deliberately delayed, uniform, empty response, so it cannot be used to probe
which bearers are live.

## Mint test personas: the complete local recipe

A sessions-mode acceptance suite needs two or more genuine principals. The
mailbox above is admin-gated **and** impersonation-gated; both carriers are
required, and both are local-only. Call `asUser(server, appId, email, opts)`
once per persona, passing a distinct `clientStoreId` in `opts`. It creates
isolated coordinator custody and a fresh client:

```js source=demos/_kit/as-user.mjs
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state: custodyState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(server.baseUrl, {
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    // Multi-user acceptance scenarios intentionally hold several clients for
    // one origin at once. Persistence is not part of this identity helper's
    // contract; callers proving retained/outbox behavior inject their own
    // isolated store through clientOptions.
    rqsStore: null,
    ...clientOptions,
    authCoordinator: coordinator,
    clientStoreId,
  });
```

It then performs the complete code-request, mailbox-read, and exchange loop:

```js source=demos/_kit/as-user.mjs
    const requested = await client.authRequestCode(email);
    const mailboxResponse = await fetchImpl(
      `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
      {
        headers: {
          'x-snapback-admin-token': server.adminToken,
          'x-snapback-impersonation-capability': server.impersonationCapability,
        },
      },
    );
    const mailbox = await mailboxResponse.json();
    assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
    const credential = await client.authExchange({
      challengeId: requested.challengeId,
      code: mailbox.code,
    });
    return Object.assign(identity, {
      credential,
      session: credential.session,
      userId: credential.session.userId,
    });
```

The two carriers, exactly:

| Carrier | Header | Where it comes from |
| --- | --- | --- |
| Admin token | `x-snapback-admin-token` | the dev server's admin token |
| Impersonation capability | `x-snapback-impersonation-capability` | the sibling file named by the ready file's `impersonationCapabilityFile` (always `<ready-file>.impersonation`) |

The ready descriptor itself carries only that mechanically validated sibling
*path*, never the capability bytes: consumers accept the path only when it
exactly equals `<ready-file>.impersonation`, then read the `sbic_…` value from
that owner-only file (`src/host_ops.rs`; the kit's
`readSpawnedImpersonationCapability` in `demos/_kit/server-process.mjs` is the
reference reader). There is no `impersonation` field inside `dev.ready.json`.
The server-lifecycle kit's `captureImpersonationCapability: true` does this
read for you and exposes the value as `server.impersonationCapability`.

`SNAPBACK_AUTH_IMPERSONATION_REQUIRED` means the second header is missing.
Call the helper once per email; the returned `userId` (also available as
`credential.session.userId`) is the server-issued principal id.

**Custody boundaries.** The mailbox route, the admin token, and the
impersonation capability are local-test material. None may enter browser or
native bundles, committed fixtures, or logs. A production deployment refuses
the route outright — the recipe is a test path, not an auth design.

An already-authenticated **headless** client (one that obtained a bearer some
other way, such as an identity broker) is constructed with
`createExternalSessionClient(baseUrl, { bearerToken })`; a bare
`authClientProtocol: 1` construction without declared custody is refused.

## A browser app under sessions today

There is no production email delivery yet, so a real end user in a browser
cannot receive a sign-in code from the shipped provider — "email-code login,
React web" has no self-serve path today. The mailbox recipe above is
local-test material (admin- and impersonation-gated; never in a browser
bundle). What a web author actually does today is one of these:

- **Dev mode** (`auth: { mode: 'dev' }`) for the authoring loop — trusted
  client-passed `userId`, no sign-in UI at all. Browser requests may carry
  that selector from the Snapback listener's own origin or an exact loopback
  origin listed in `SNAPBACK_DEV_AUTH_ORIGINS` (comma-separated); another
  localhost port is refused with `SNAPBACK_AUTH_DEV_ORIGIN_REFUSED`. The
  supervised Expo loop registers its Metro origin automatically, and the
  standard Vite composition uses the same-origin `/__snapback` relay. Curl,
  tests, and server-side clients that send no `Origin` retain the existing
  trusted-local behavior.
- **Test/dev personas** for acceptance suites and Vite surfaces — the privileged
  mailbox read stays in the suite harness or the
  [serve-only dev mailbox relay](../recipes/browser-auth.md#get-the-sign-in-code-in-local-development).
  Page code may request and exchange the one-time code, but never receives the
  admin or impersonation carriers.
- **The trusted-server seam** for a product-shaped flow — a server-side
  component authenticates the user through its own front door. For a browser,
  prefer staging a one-use challenge/code that the ordinary `authExchange`
  path adopts into `AuthCoordinator`; the executable
  [browser sign-in recipe](../recipes/browser-auth.md) demonstrates it. A
  direct external bearer uses separate headless custody and is not the same
  reload-persistent browser composition.
- **The supervised Expo dev loop's web carrier** — `snapback dev --expo`
  auto-mints an ordinary session for the Expo web app through its
  loopback-only bootstrap exchange
  ([supervised loop on Expo web](../clients/react-expo.md#run-the-supervised-loop-on-expo-web)).

Whichever entry path delivers the credential, a browser client under sessions
constructs an `AuthCoordinator` (from `@expo/snapback-contract`) and passes it
as `authCoordinator:`; the coordinator owns custody, refresh, and the logout
barrier. Use the shipped IndexedDB adapter for a browser that must survive a
full reload:

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

`createMemoryAuthCustodyStorage()` is volatile and appropriate for tests or a
document-lifetime flow. It can survive an SPA route change because the same
JavaScript process remains alive, but not a full-page reload. The registered
browser recipe reconstructs the page in real Chrome and asserts that neither
the bootstrap nor `/auth/exchange` count advances while the protected identity
returns from IndexedDB.

The recipe remains local and partial. It does not turn its signed-assertion
fixture into Draft LLP 0151's generic OIDC/first-party provider contract and
does not claim production delivery or hosted auth.

## Read public data anonymously

<!-- since: 0.1.9 -->

A sessions-mode app often has a public surface — an event preview, a shared
link — that must read *without* a signed-in principal. Bare clients are
refused (`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED`) because the v1 profile
requires declared custody. The paved path declares **anonymous-public**
custody, which sends the protocol offer with no credential:

```js source=packages/snapback-client/app-data.test.mjs
    const anonymous = new SnapbackClient(baseUrl, { custody: 'anonymous-public', adminToken: null });
```

The custody is mutually exclusive with browser, agent, and external-bearer
custody: passing a bearer alongside it throws rather than silently
downgrading, so no caller-selected identity can be smuggled through the
anonymous path. Anonymous clients read `public` queries only; protected
queries refuse exactly as they do for a signed-out browser.

For a non-session **admin/inspection** client against a sessions-mode server,
pass both options together. `authClientProtocol: 1` satisfies the server's
protocol-offer gate; without it the server refuses
`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED`. `custody: 'anonymous-public'`
satisfies the client constructor; `authClientProtocol: 1` alone throws a
custody `TypeError`. Each refusal names one half; this is the complete pair:

```js source=packages/snapback-client/app-data.test.mjs
    const inspection = new SnapbackClient(baseUrl, {
      authClientProtocol: 1,
      custody: 'anonymous-public',
    });
```

The admin token from `SNAPBACK_ADMIN_TOKEN` or the `adminToken` option rides
alongside this custody on admin routes. Anonymous-public custody does not strip
it unless you pass `adminToken: null`.

## Reset invalidates sessions and reissues principals

`app.reset` advances the auth boundary. Two consequences an author hits
immediately:

- **Existing sessions stop working.** Any bearer minted before the reset
  fails with `SNAPBACK_AUTH_REQUIRED`. Mint personas *after* the reset.
- **Reminted identities are new principals.** The same local email resolves
  to a *different* server-issued `userId` after a reset. Principal ids are
  therefore never stable fixture values: a seeded row naming a pre-reset id
  points at an identity that no longer exists.

Under the
[supervised Expo dev loop](../clients/react-expo.md#run-the-supervised-expo-development-loop),
`snapback reset --dev-fresh` performs the
reset and supervisor re-mint as one command; standalone dev targets receive a
verification mint before the command reports readiness.

So do not seed membership or ownership rows with captured principal ids in
sessions mode. Seed the *resources*, then have each authenticated persona
join through the declared membership surface —
`ctx.membership.<declaration>.bootstrap(...)` for the first owner, then
owner-authorized insertion for the rest (see
[scoped roles](./scoped-roles.md)). The server owns both the resource ids and
the principal ids, which is what makes the fixture deterministic in the only
sense that survives a reset.

Dev-mode principals are different: they are client-asserted and stable across
resets, which is why the dev authoring loop can seed them directly. Do not
carry that habit into sessions mode.

## Queries are scoped by the server, not by arguments

A protected query takes **no owner argument**. Its filter compares the stored
owner field with `authUserId()`, which the server resolves from the session:

```js source=demos/card-game/snapback/functions.mjs
  filter: [
    eq('ownerId', authUserId()),
    eq('gameId', arg('gameId')),
  ],
```

That predicate is the security boundary. For JS live queries,
`authScopeField` additionally declares which result field represents the
principal so invalidation and retained-result bookkeeping can reason about
disjoint subscriptions. It is a declaration, never an authorization
mechanism, and it does not inject an ownership filter. The paired
`eq(field, authUserId())` filter is the gate. Codegen warns with
`SNAPBACK_AUTH_SCOPE_FIELD_WITHOUT_CALLER_PREDICATE` when a declarative plan
does not carry that pairing (and for handler-backed declarations whose gate is
opaque to plan analysis). Two signed-in users see disjoint results over the
same query:

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
  const [adaResult, graceResult] = await Promise.all([
    ada.client.query('myHand', { args: { gameId } }),
    grace.client.query('myHand', { args: { gameId } }),
  ]);
  assert.deepEqual(adaResult.rows.map(({ card }) => card), ['ace-spades', 'queen-hearts']);
  assert.deepEqual(graceResult.rows.map(({ card }) => card), ['king-clubs', 'ten-diamonds']);
```

Trying to smuggle identity through the request body is rejected with a
stable code — assert on it, don't work around it:
`SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED`.

> **Coming from Convex/Supabase?** See
> [Protected live CRUD, end to end](../recipes/coming-from-convex-and-supabase.md#protected-live-crud)
> for the complete worked slice — including why `authScopeField` is not an
> injected filter, unlike Convex's automatic `useQuery` reactivity or a
> Supabase RLS policy.

## Logout is a barrier, not a suggestion

Logging out blanks that principal's live boundaries immediately; other
principals' subscriptions are untouched:

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
  await ada.client.authLogout();
  assert.deepEqual(adaSurface.boundary.current('hand'), []);
```

Offline retention of authorized data is honest too — retained rows survive
a cold boot only until the signed lease's exact deadline; see the
[hidden hands recipe](../recipes/hidden-hands.md) for the paved sequence and
[protecting data](./protecting-data.md) for connection grants, invalidation,
retry, and lease mechanics.

## Ask who I am (am I signed in)

<!-- since: 0.1.20 -->

After boot or restore, the blessed whoami / **am I signed in** read is
`currentAuthorizationScope()`. Do not walk `AuthCoordinator` prototypes or
treat `authSession()` as identity.

```ts source=packages/snapback-client/auth-identity-types.fixture.ts
async function askWhoIAm(client: SnapbackClient) {
  const scope = await client.currentAuthorizationScope();
  const signedIn = scope.principalScope.userId !== null;
  const userId = scope.principalScope.userId;
  const authMode = scope.principalScope.authMode;
  const descriptor = await client.currentAuthorityDescriptor();
  const session = await client.authSession();
  const mode = session.activeMode;
  const handshakeAuthenticated = session.authority.isAuthenticated;
  return { signedIn, userId, authMode, descriptor, mode, handshakeAuthenticated };
}
```

`principalScope.userId` is the server-issued principal when a sessions
caller is authenticated, and `null` when the client is anonymous or signed
out. `principalScope.authMode` is `'sessions'` or `'dev'`. In dev mode the
optional `{ devUserId }` argument is the trusted-local impersonation the
scope reports; sessions mode ignores it and uses the server-resolved
principal. `signedIn` is `principalScope.userId !== null`.

`currentAuthorityDescriptor()` is the same call's authority-instance half
(generation + instance id) without the principal scope. Use it for the
queue/instance axis, not the user id.

`authSession()` is the mode/authority handshake projection (`activeMode`,
`modeState`, `authority.kind` / `isAuthenticated`). It is how the client
learns the server's settled mode — not the app-level whoami. Reading
`session.authority.userId` is that same handshake projection; prefer
`currentAuthorizationScope().principalScope.userId`.

`AuthCoordinator.settledView()` is the coordinator's lower-level custody
capture (epoch, authority key, and the coordinator's own `anonymous` |
`session` authority). Apps should not enumerate it. The client methods
above wait for coordinator settle internally.

**Restored / settled semantics**, witnessed by
`packages/snapback-client/unrecognized-authority-recovery.test.mjs` and
`demos/card-game/tests/acceptance/authority-scope.mjs`:

- After `authExchange` (or the test `asUser` mint),
  `currentAuthorizationScope().principalScope.userId` is the
  server-issued principal and matches `credential.session.userId`.
- The same methods work after a new process reconstructs the client with
  the same coordinator storage: the first `authSession()` /
  `currentAuthorizationScope()` waits for coordinator settle and returns
  the restored principal when the bearer is still recognized.
- After a store reset the server witnesses as a different-incarnation
  anonymous handshake, `authSession({ force: true })` recovers custody to
  anonymous and `currentAuthorizationScope().principalScope.userId` is
  `null`.
- `authRefresh` keeps the same `authorityDescriptor`; a newly minted
  session for the same user keeps `principalScope.userId` and rotates
  `authorityDescriptor.authorityInstanceId`.

These methods exist on the published 0.1.20+ runtime. Precise TypeScript
declarations for the identity accessors land with this change; a consumer
of the 0.1.20 `.d.mts` may still not see them on `SnapbackClient` until
the next published closure.

## Ask the server what auth is actually on

Don't guess from docs — the capability manifest's runtime facts carry
`authProgramReadiness` (a per-facet boolean projection: provider core,
shared invocation gate, connection binding, authorization invalidation,
authorized leases, session activation readiness, ...) plus the active
`AuthMode`. `GET /inspect` (public projection) and the admin inspect carry
it; teach your tooling to read it. This is the boundary rule this guide
itself follows: an auth behavior is teachable only when it has an
acceptance witness or shows as ready here.

Local agent principals and scoped grants (LLP 0055) — pairing, scoped-token
app invocation, and the headless `AgentAuthorityFence` — are
shipped on the local target and have their own page (agent *creation* has no
user-reachable surface yet; credentials come from harness provisioning):
[agent principals and scoped grants](./agent-principals.md). The
[capability index](../capabilities.md) carries the row with its route
witnesses. For the shipped local role-per-resource surface, continue to
[scoped roles and memberships](./scoped-roles.md).

## Anti-patterns

- **Do not assert identity from the client** — no `userId` in bodies, no
  owner arguments on protected queries. The server derives it or the
  request is rejected.
- **Do not build auth UI against unwitnessed surface.** Check
  `authProgramReadiness` / the capability index instead of assuming a
  route's existence means its behavior is on.
- **Do not treat retained offline data as unconditionally readable** — the
  lease deadline is exact and enforced client-side too.
- **Do not treat `authSession()` as whoami.** It is the mode/authority
  handshake projection. Ask `currentAuthorizationScope()`.
- **Do not enumerate `coordinator.settledView()` or
  `session.authority.userId` as the app identity read.** `settledView`
  stays the coordinator's internal projection.

---

<!-- snapback-guide-source: guide/auth/app-identity-binding.md -->
---
title: Bind a principal to your app's user identity
id: auth.app-identity-binding
order: 2
audience: agent-first
capabilities: [auth.sessions, auth.external-identity-broker]
authorities: [llp/0039-auth-vertical-slice.rfc.md, llp/0057-auth-provider-protocol.spec.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0096-auth-profiles-for-protocol-clients.spec.md, llp/0151-first-party-identity-integrations.rfc.md, llp/0183-zerobugs-quality-surface.rfc.md, llp/0214-snapback-identity-core.spec.md, llp/0226-identity-architecture.decision.md, packages/snapback-client/index.mjs, packages/snapback-codegen/ctx.d.mts, src/auth/invocation.rs, src/storage/auth_identity.rs, src/cli.rs, demos/browser-auth/server/gateway.mjs, demos/browser-auth/snapback/schema.mjs, demos/browser-auth/snapback/functions.mjs, demos/browser-auth/tests/acceptance/browser-auth.mjs, demos/zerobugs/control/snapback/schema.mjs, demos/zerobugs/control/snapback/functions.mjs]
examples: [demos/browser-auth, demos/zerobugs/control]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-16
reviewed-authorities-digest: sha256:f2306d9477abd4af9d9e81a0fd94f5a9f71f3280544cb4626ea2b93c669116f6
---

# Bind a principal to your app's user identity

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./targets.md).

Almost every app ported onto Snapback already has its own user identity: a
`users` table with a `sourceUserID` from an OAuth provider, roles, a display
name, rows that point at it. Snapback gives you a different thing —
`ctx.auth.userId`, a **server-minted principal id**. Making an existing app
work means building the join between them: a principal↔app-user table, and a
trustworthy way to populate it.

This page is that recipe. It is the first thing a port needs and the easiest
thing to get wrong, because the obvious approach — a mutation that takes the
app's user id as an argument and binds it to the caller's principal — is a
complete authentication bypass.

## Claims can inform behavior; they cannot populate a binding yet

A real catalog-backed session now exposes a deeply frozen
`ctx.auth.claims`. It contains only the identity that authenticated this
session plus active, applicable assurance records. Email, phone, and username
use their catalog-canonical value; OIDC and other federated identities expose
their exact provider/issuer/subject and omit mutable profile values. Anonymous,
dev-impersonated, admin, system, and agent authority do not receive claims.

This makes read-only in-handler inspection possible, but does not make an
ordinary `bindMe(...)` mutation safe. Snapback does not yet invoke the sealed
verified-provisioning writer described by LLP 0214 §§5.3–5.5. A
`verifiedProvisioning` identity-binding declaration currently installs the
write seal only: ordinary buffered writes and every HostPlan/IR write form fail
with `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`. Codegen also rejects the sealed
table as a declared handler, generated data-resource/data-transaction write
target, maintained-projection output, or non-empty versioned-seed target. Runtime
rechecks buffered batches, HostPlan writes, declarative seed installation, and
both projection rebuild and same-transaction maintenance. Schema migration and
destructive reset remain separately authorized operator lifecycle operations;
neither is an application binding writer.

> **The future sealed writer may use claims to select the app row once. The
> durable binding key will still be `ctx.auth.userId`.** Email is mutable, and
> an issuer/subject pair belongs to the auth substrate; neither replaces the
> principal in steady-state app reads or writes.

Never accept a claims object, email, subject, or app-user id from the client as
proof. Those are selection inputs under caller control.

## Define the binding table

Whichever way you populate it, the table itself is the same shape: one row
per principal, uniquely indexed on **every** side so the mapping cannot fan
out. The Zerobugs control's declaration:

```js source=demos/zerobugs/control/snapback/schema.mjs
export const identityBinding = defineTable({
  principal: v.principal(),
  userID: v.id('user'),
  sourceUserID: v.string(),
})
  .index('by_principal', ['principal'], { unique: true })
  .index('by_user', ['userID'], { unique: true })
  .index('by_source_user_id', ['sourceUserID'], { unique: true });
```

Three unique indexes, not one. `by_principal` stops a principal owning two
app identities; `by_user` and `by_source_user_id` stop one app identity being
claimed by two principals. The storage constraint is the backstop that
survives a bug in the handler logic — see
[declare structural uniqueness](../backend/mutations.md#declare-structural-uniqueness).

Keep the physical reference (`v.id('user')`) *and* the external id
(`sourceUserID`) as separate fields: the typed id is what private rows join
on, and the external string is what a provider lookup or an audit trail needs.

Do not declare this table under `verifiedProvisioning` and then try to write it
from an application handler: the declaration seals the table, but there is no
host-invoked inside writer yet. Until that platform lane lands, use Pattern A
or the acceptance-only Pattern B below on an undeclared table, with their
trusted-writer and reachability constraints intact.

After creation, every protected handler resolves only
`principal → binding → app row`; it does not repeat a claim lookup.

## Resolve the principal in every protected handler

Once the row exists, no handler ever accepts a caller-supplied identity again.
Every private read and write starts by resolving principal → binding → app
row, and re-verifies the binding still names the same row it did at write
time:

```js source=demos/zerobugs/control/snapback/functions.mjs
export async function requireSourceUser(ctx) {
  requireFixtureSession(ctx);
  const principal = ctx.auth.userId;
  const binding = await ctx.db
    .query('identityBinding')
    .withIndex('by_principal')
    .eq('principal', principal)
    .first();
  if (!binding) {
    throw new Error('session principal is not bound to a source user');
  }
  const user = await ctx.db.get('user', binding.userID);
  if (
    !user
    || user.id !== binding.sourceUserID
    || (user.role !== 'crew' && user.role !== 'user')
  ) {
    throw new Error('session principal has an invalid source user binding');
  }
  return user;
}
```

(`requireFixtureSession(ctx)` is the Zerobugs control's own fixture gate — it
just refuses an unauthenticated `ctx` before fixture work; your port omits it
and relies on `auth: 'authenticated'` plus the binding resolution below.)

Roles come from the resolved app row, never from a mint argument or a request
body:

```js source=demos/zerobugs/control/snapback/functions.mjs
export async function requireCrew(ctx) {
  const user = await requireSourceUser(ctx);
  if (user.role !== 'crew') {
    throw new Error('source user is not authorized');
  }
  return user;
}
```

Expose the caller's own binding as a query taking **no arguments** — the
absence of an identity selector is the point, and it is worth asserting in a
test that the generated args schema is empty:

```js source=demos/zerobugs/control/snapback/functions.mjs
export const acceptanceActorBindingSelf = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['identityBinding', 'user'],
  result: results.records(v.object({
    principal: v.string(),
    sourceUserID: v.string(),
    userID: v.id('user'),
    role: v.string(),
  })),
  handler: async (ctx) => {
    const user = await requireSourceUser(ctx);
    return [{
      principal: ctx.auth.userId,
      sourceUserID: user.id,
      userID: user._id,
      role: user.role,
    }];
  },
});
```

If your app also uses [scoped roles](./scoped-roles.md) or `authScopeField`
query scoping, those compare against the **principal**, not the app user row.
Store the principal on rows you want scoped by the declarative surface, and
use the binding for everything that must reach the app's own user record.

## Pattern A — still conforming: bind in trusted server code

This is the strongest executable shape today, not a hosted-production claim.
Snapback's local external-identity seam uses a trusted server-side component
that authenticates the user through your existing front door
(OAuth, your own login), calls the `auth.mintSession` host operation for that
verified identity, and hands the resulting bearer back to that same user.

The broker is the only place that holds all three facts at once — the
verified external identity, the app user row it maps to, and the principal
`auth.mintSession` just returned. So the broker is where the binding row gets
written, before the bearer is released:

This pattern currently uses an ordinary, deliberately non-public mutation, so
its binding table must not be declared as a `verifiedProvisioning`
identity-binding table. That declaration would correctly seal the write.

```js fragment reason="broker-side shape; the mint host-op authorities and the adopt-bearer half are the subject of auth/native-apps.md"
// Trusted server-side broker (never in an app bundle):
const verified = await myIdentityProvider.verify(request);      // your front door
const appUser = await myUsers.findBySubject(verified.subject);  // your user row
const minted = await hostOps.auth.mintSession({ email: verified.email });
const session = createExternalSessionClient(baseUrl, { bearerToken: minted.token });

// Only now — knowing both sides — write the binding under privileged authority,
// then release the bearer to this user and nobody else.
await session.mutate(api.bindVerifiedIdentity, {
  args: { issuer: verified.issuer, subject: verified.subject },
});
return { bearerToken: minted.token };
```

Two properties make this safe, and both are load-bearing:

- **The binding mutation is privileged, not public.** It is invoked with the
  broker's authority, is idempotent per principal, and refuses a principal or
  app user that is already bound. It must not be reachable from an ordinary
  client session; if your app has a public gateway or function allowlist,
  leave it out of the allowlist (see the omission technique below).
- **The bearer is released only to the authenticated caller.** A generic
  "mint a session for this email" endpoint with no front door is the same
  bypass in a different place.

The client then adopts the bearer with
`createExternalSessionClient(baseUrl, { bearerToken })` and carries it
normally; rotation goes through `replaceBearerToken`. Both halves are covered
in [authenticate a native app](./native-apps.md).

For a browser that needs durable coordinator custody, do not stop at that
external-bearer client. The registered
[browser sign-in and reload recipe](../recipes/browser-auth.md) stages a
one-use challenge/code and lets ordinary `authExchange` move the bearer into
`AuthCoordinator`'s IndexedDB record. It proves the private binder's gateway
omission, full-page restoration without another exchange, logout revocation,
and cross-subject protected-data isolation in real Chrome.

**Honest boundary:** `auth.mintSession` is a dev/test/demo host operation
requiring the admin token, the process-bound impersonation capability, and
active sessions mode. From a terminal, the paved spelling of the same
operation is `snapback session mint --email <email> --ready-file <ready-file>`.
LLP 0045's production email delivery adapter is unbuilt
and the Cloudflare arm exposes no sessions routes, so this page does not claim
hosted production identity. The *pattern* is the production shape; the
current mint mechanism is local.

## Pattern B — acceptance harness: a frozen actor map

An acceptance suite has a different problem. It needs several real principals
bound to specific fixture users so it can assert per-actor visibility, and
principal ids are freshly minted every run — so nothing can be seeded. But the
suite also has something a product does not: a **frozen fixture**, whose exact
user population is known in advance.

The Zerobugs control uses that to build a bootstrap that is safe *because*
it is closed. Five properties, all of them necessary:

1. **A frozen actor map.** The mutation's argument is an actor *name* from a
   closed set (`'creator'`, `'crew-admin'`, …), not a source user id. It
   selects one member of a hard-coded map; anything else refuses.
2. **A complete-fixture precondition.** Binding refuses unless exactly the
   frozen fixture is loaded — the right user count, the right ids, the right
   roles, the completion sentinel present.
3. **One-to-one refusal on both sides.**
4. **Set closure.** After the last actor is bound, the mutation refuses
   permanently.
5. **Gateway omission.** The bootstrap operations are absent from the app's
   function allowlist, so they are reachable only over the direct client the
   harness drives — never over the product's HTTP surface.

```js source=demos/zerobugs/control/snapback/functions.mjs
    const principal = ctx.auth.userId;
    const existingPrincipal = await ctx.db
      .query('identityBinding')
      .withIndex('by_principal')
      .eq('principal', principal)
      .first();
    if (existingPrincipal) {
      throw new Error('session principal is already bound');
    }

    const existingBindings = await ctx.db.query('identityBinding').take(6).collect();
    if (existingBindings.length >= 5) {
      throw new Error('actor binding is closed after the frozen actor set is complete');
    }

    const [existingUser, existingSource] = await Promise.all([
      ctx.db
        .query('identityBinding')
        .withIndex('by_user')
        .eq('userID', sourceUser._id)
        .first(),
      ctx.db
        .query('identityBinding')
        .withIndex('by_source_user_id')
        .eq('sourceUserID', sourceUser.id)
        .first(),
    ]);
    if (existingUser || existingSource) {
      throw new Error('source user is already bound');
    }
```

The suite drives it by minting one session per actor (see
[mint test personas](./sessions-and-principals.md#mint-test-personas-the-complete-local-recipe)),
calling the binding mutation once per persona, and then proving the mapping
by reading `acceptanceActorBindingSelf` back. A rerun against an
already-bound instance must observe the refusal and then prove the existing
row is the same one-to-one mapping — that is what makes the harness idempotent
without weakening the refusal.

The same closure technique gates the fixture loader itself; see
[loading large deterministic fixtures](../testing/large-fixtures.md#gate-the-loader-in-a-sessions-app).

**This is a harness pattern, not a product answer.** Its safety comes
entirely from the frozen fixture and the closed actor set. Do not lift it
into an application: without those, the actor argument is a caller-selected
identity again.

**Evidence:** the control's binding surface is exercised by its own
`bun run test:lane2` (runtime-independent witnesses) and `test:lane2:live`
(a seven-actor live gate), and by the retained ZB gate receipts under
[`demos/zerobugs/evidence`](repo:demos/zerobugs/evidence). It is not part of
the repository's CI proof; treat the snippets as a reviewed reference
implementation whose behavior is receipt-witnessed at a point in time.

## Reset reissues principals; it does not reissue app rows

`app.reset` advances the auth boundary: existing bearers stop working and the
same email remints to a **different** `userId`
([reset invalidates sessions](./sessions-and-principals.md#reset-invalidates-sessions-and-reissues-principals)).
Your app user rows, if they are seeded, survive. So every binding row is stale
after a reset and must be rebuilt.

Two rules follow:

- **Never seed a binding row with a captured principal id.** Seed the app
  users; bind after the reset, once real principals exist.
- **Order the bootstrap: reset → load fixture → mint principals → bind.**
  The dependency is circular by nature (the fixture creates the users a later
  binding maps to), which is exactly why the loader and the binder each carry
  their own closure sentinel.

## Current boundary

The local target now supplies verified read-only claims and a complete
ordinary-write seal for declared identity-binding tables. It does **not** yet
supply the host-invoked writer inside that seal. Pattern A and the frozen
Pattern B remain the executable conforming choices because they arrange for a
trusted writer to hold both sides before releasing or using the principal;
their tables remain undeclared until the host writer exists. Draft LLP 0151
separately owns future provider identity/lifecycle and hosted-target work; this
app-level join does not pretend to implement it.

## Anti-patterns

- **Do not accept an app user id as a mutation argument and bind it to the
  caller's principal.** That is the bypass this whole page exists to prevent;
  the caller controls the argument.
- **Do not write a `verifiedProvisioning` handler today.** Its declared
  identity-binding table is sealed against ordinary handlers, and the
  host-invoked inside writer remains an open platform ask.
- **Do not derive the app identity from anything the client sends** — not an
  email in the body, not a header, not a JWT the client hands you. If the
  handler did not mint it, the handler cannot verify it.
- **Do not index only `by_principal`.** Without unique indexes on the app-user
  and external-id sides, one app identity can be bound by two principals.
- **Do not seed binding rows.** Principal ids are minted per run and reissued
  by reset; a seeded binding points at an identity that no longer exists.
- **Do not leave the bootstrap binding mutation in your public function
  allowlist.** Reachability from an ordinary client session turns a closed
  bootstrap back into an identity-selection API.
- **Do not read app roles from the session.** Resolve the binding and read
  the role off the app row.

---

<!-- snapback-guide-source: guide/auth/passwords.md -->
---
title: Email and password
id: auth.passwords
order: 2
audience: agent-first
capabilities: [auth.passwords, auth.sessions, auth.browser-session-custody, auth.application-bootstrap-native-custody]
authorities: [llp/0227-password-credential-auth.rfc.md, llp/0214-snapback-identity-core.spec.md, llp/0215-effect-budgets.spec.md, llp/0011-auth-and-permissions.rfc.md, llp/0057-auth-provider-protocol.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0064-native-client-surfaces.rfc.md, llp/0238-explicit-client-lifecycles.rfc.md, llp/0258-first-party-application-auth-bootstrap.rfc.md, src/auth/provider.rs, src/auth/runtime.rs, src/auth/wire.rs, src/contract_types.rs, src/storage/auth_identity.rs, src/server.rs, src/cli.rs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-client/app-client.mjs, packages/snapback-client/app-client.test.mjs, packages/snapback-client/index.mjs, packages/snapback-client/password-auth.test.mjs, packages/snapback-react/auth-bootstrap.test.mjs, packages/snapback-react/index.mjs, packages/snapback-expo/provider-auth-bootstrap.test.mjs, packages/snapback-expo/provider.mjs, packages/snapback-admin-client/index.mjs]
examples: [packages/snapback-cli/templates/react, packages/snapback-cli/templates/expo-chat, tests/fixtures/application-auth/browser-explicit/application, demos/browser-auth]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-16
reviewed-authorities-digest: sha256:1d0ef691c71c6e84568069a4adeb495c7139f83d28d71e97180eb21177908ebf
---

# Email and password

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./targets.md).

Password login is a credential class on the ordinary
[sessions surface](./sessions-and-principals.md). A successful signin runs the
same session-creation core as an email-code exchange and returns the same
credential response. There is **no parallel identity system, no parallel token,
and no separate session shape** — one principal, several credentials.

This is the first sign-in method a browser app can offer end users without a
mail adapter. Email-code login still has no self-serve production path (no
delivery), so if you need a real user to sign themselves in today, this is it.

<!-- since: 0.1.21 -->
## Declare email identifiers before activation

Choose the password identifier in the app's `defineAuth` program and pass that
program to `defineSchema(..., { auth: { mode: 'sessions' }, authProgram })`.
Use `identifier: 'email'` for the email-v1 canonicalizer:

```js source=packages/snapback-cli/templates/react/snapback/schema.mjs
const authProgram = defineAuth({
  version: 1,
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
    },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});
```

Codegen derives the non-secret `app.authBootstrap` policy from that normalized
auth program and adds `auth.application-bootstrap.v1` to the generated app's
required capabilities. Do not hand-author either fact. Binding admission
intersects the generated password mechanism with the target's
`auth.passwords` capability before credential UI can issue network work. The
React template's static acceptance check pins both generated facts:

```js source=packages/snapback-cli/templates/react/acceptance.static.mjs
assert.equal(descriptor.authBootstrap.format, 'snapback.application-auth-bootstrap.v1');
assert(descriptor.capabilities.required.includes('auth.application-bootstrap.v1'));
```

`identifier: 'username'` selects username-v1. An app with no declared password
mechanism keeps the existing username-v1 default. The choice is stored in
catalog v4 at the first sessions activation and is immutable afterward;
codegen/startup refuses a later contradictory declaration with
`SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_IMMUTABLE` instead of reinterpreting
existing identities.

The default password minimum is 12 decoded UTF-8 bytes. To choose a different
app-wide minimum, set `minimumLength` on the password mechanism:

```js fragment reason="policy-only excerpt from the defineAuth password mechanism shown above"
password: {
  kind: 'password',
  identifier: 'email',
  provider: 'builtIn',
  recovery: 'recoveryCodes',
  minimumLength: 8,
}
```

The declaration is a safe integer from 8 through 128; every password
mechanism in one program must resolve to the same value or codegen refuses
`SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_CONFLICT`. The maximum remains 1,024
UTF-8 bytes, and common-password screening still applies. Omit the field to
keep 12. This is a startup policy, so restart the backend after changing it. An
invalid declaration refuses codegen/startup with
`SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_INVALID`; an entered password that
misses the active policy refuses with `SNAPBACK_AUTH_PASSWORD_POLICY`, whose
redacted details name the active minimum, maximum, default, and `defineAuth
mechanisms.<name>.minimumLength` configuration path.

<!-- since: 0.1.23 -->
## Sign up, then sign in

For an ordinary React application, construct one application client from the
generated `app` and the admitted environment binding, then give that owner to
`SnapbackProvider`. The clean browser Explicit fixture is runnable first-party
source; its host supplies the admitted binding and platform:

```js source=tests/fixtures/application-auth/browser-explicit/application/App.mjs
import React from 'react';
import { createSnapbackAppClient } from '@expo/snapback-client';
import {
  SnapbackProvider,
  useSnapbackAuth,
  useSnapbackCurrentPrincipal,
} from '@expo/snapback-react';

import { app } from './snapback/generated/app.mjs';
import { createAuthPanel } from '../../shared/auth-panel.mjs';

const AuthPanel = createAuthPanel({
  useAuth: useSnapbackAuth,
  useCurrentPrincipal: useSnapbackCurrentPrincipal,
});

export async function createApplication({ binding, platform, now, onSnapshot }) {
  const appClient = await createSnapbackAppClient({ app, binding, platform, now });
  return Object.freeze({
    app,
    appClient,
    element: React.createElement(
      SnapbackProvider,
      {
        appClient,
        fallback: (state) => React.createElement(
          'pre',
          { 'data-fixture': 'boot' },
          JSON.stringify(state),
        ),
      },
      React.createElement(AuthPanel, { onSnapshot }),
    ),
  });
}

export { app };
```

`fallback` owns construction states. When children render, the bootstrap is
`ready`: binding, custody, client, and authority synchronization have settled.
`ready` does **not** mean signed in. A cold password-only app still settles a
server-witnessed anonymous principal so the entry form is reachable; generated
`anonymousPublic` controls anonymous app-data access, not whether boot can
finish.

Inside the provider, use the canonical facade and principal projection. The
template clears any previous recovery projection before every operation, then
keeps the signup result only long enough to render its one-time codes:

```tsx source=packages/snapback-cli/templates/react/src/App.tsx
export function App() {
  const auth = useSnapbackAuth();
  const principal = useSnapbackCurrentPrincipal();
  const workspace = useSnapbackQueries(workspaceQueries);
  const createTodo = useSnapbackMutation(api.createTodo);
  const connection = useSnapbackConnection();
  const [email, setEmail] = useState('person@example.com');
  const [password, setPassword] = useState('replace-this-password');
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);
  const todos = workspace.queries.todos.status === 'ready'
    || workspace.queries.todos.status === 'refreshing'
    ? workspace.queries.todos.data
    : [];

  const signUp = async () => {
    setRecoveryCodes(null);
    const result = await auth.signUpWithPassword({ email, password });
    setRecoveryCodes(result.recoveryCodes);
  };
  const signIn = async () => {
    setRecoveryCodes(null);
    await auth.signInWithPassword({ email, password });
  };
  const signOut = async () => {
    setRecoveryCodes(null);
    await auth.signOut();
  };
```

Render all five `CurrentPrincipalSnapshot` states distinctly: `loading`,
`anonymous`, `authenticated`, `refreshing`, and `blocked`. Only the
`authenticated` arm has a current `userId`. The template's account UI also
makes the recovery handoff explicit:

```tsx source=packages/snapback-cli/templates/react/src/App.tsx
        {recoveryCodes ? (
          <aside>
            <strong>Save these recovery codes now. They are shown once.</strong>
            <pre>{recoveryCodes.join('\n')}</pre>
          </aside>
        ) : null}
```

The application must hand those codes to the user for separate safe custody
at signup. They are not session credentials: do not put them in the app
client, general persistence, logs, analytics, diagnostics, or a later account
screen. Snapback cannot read them back. Clear the projection when the user
leaves the handoff or starts another auth action. Recovery consumption and
rotation each return a new one-time set and require the same handling; see
[Recovery codes are the recovery path](#recovery-codes-are-the-recovery-path).

The complete ordinary sequence is:

1. Wait for provider `ready`; `useSnapbackCurrentPrincipal()` reports the
   settled anonymous arm.
2. Call `auth.signUpWithPassword`. Save the returned recovery codes now; the
   principal projection becomes `authenticated` only after coordinator
   adoption and its barrier settle.
3. On a full browser reload, construct the same app client again. Browser and
   Expo web use IndexedDB plus Web Locks, so the owner restores the settled
   principal without another signup or sign-in. `dispose()` only releases the
   process projection; it does not sign out or delete durable custody.
4. Call `auth.signOut()`. The provider blanks predecessor protected state,
   revokes the session, settles anonymous custody, and only then publishes the
   anonymous principal.
5. Call `auth.signInWithPassword` for the existing account. Sign-in returns
   the ordinary credential projection, not recovery codes.
6. To switch users, sign out first, replace the form identity, then sign in or
   sign up. Entry while an application-entered or restored principal is still
   authenticated refuses with a typed `signOut` remediation; there is no
   implicit latest-user-wins switch.

The browser restoration path is package-tested against a fresh application
client over the same durable custody record:

```js source=packages/snapback-client/app-client.test.mjs
    restored = await createSnapbackAppClient(input);
    assert.equal(restored.auth.currentPrincipal().status, 'authenticated');
    assert.equal(
      restored.auth.currentPrincipal().provider,
      null,
      'restoration does not fabricate the provider availability key as issuance provenance',
    );
    assert.equal(restored.bootstrapState().authoritySource, 'durable-restored');
```

### Use the same owner through Expo

An Expo application passes only the generated `app` to the ordinary provider.
When that descriptor carries the generated bootstrap policy and required
capability, `SnapbackExpoProvider` resolves the environment and delegates to
the same application-client owner; its `useSnapbackAuth` and
`useSnapbackCurrentPrincipal` exports project the same contracts. The current
`expo-chat` template keeps this composition at the root:

```tsx source=packages/snapback-cli/templates/expo-chat/App.tsx
export default function App() {
  const [thread, setThread] = useState<Thread | null>(null);
  return (
    <SnapbackExpoProvider app={app} fallback={(state: ExpoBootState) => <BootFallback state={state} />}>
      <TestPersonaProvider>
        <AccountEntry />
        {thread
          ? <ChatScreen conversationId={thread.id} title={thread.title} onBack={() => setThread(null)} />
          : <InboxScreen onOpen={(id, title) => setThread({ id, title })} />}
      </TestPersonaProvider>
    </SnapbackExpoProvider>
  );
}
```

**Expo web** selects the shipped browser IndexedDB/Web Locks carrier and has
the same durable reload restoration as React web. **Both native OS paths are
source-current at the exact iOS/Android + `single-runtime` tuples, but the
package closure remains UNPUBLISHED** behind
[the custody first-publish gate](repo:issues/20260816-custody-first-publish-gate.md);
neither path falls back to memory. The iOS receipt proves only the share-sheet extension kind. Its
built/embedded Notification Service Extension remains a nonclaim because
simulator `simctl push` cannot invoke that service stage. The disposable
cross-platform `expo-chat` template
therefore keeps `custody: 'volatile-explicit'`: it can exercise
signup/sign-in/sign-out but cannot claim process-death restoration or supported
relaunch. Read [Authenticate a native app](./native-apps.md) for the native
broker and custody threat boundary, and [Targets](./targets.md) before making
any hosted or production claim.

### Keep custom identity brokers on the advanced seam

If the app already has an external identity front door, custom gateway, or
application-owned identity binding, keep that explicit composition on the
[browser sign-in and reload custody recipe](../recipes/browser-auth.md). That
recipe deliberately owns a trusted broker, `AuthCoordinator`, and one-use
exchange; it is not a second spelling for the first-party password journey.
The ordinary and advanced owners cannot share one app/storage partition.

### Use the low-level methods only in advanced compositions

The underlying client methods remain available for custom shells and tests.
`authPasswordSignup` mints an ordinary session and adopts it into an
application-supplied `AuthCoordinator`, exactly as `authExchange` does. You
need no admin token, no impersonation capability, and no `auth.mintSession`.

```js source=packages/snapback-client/password-auth.test.mjs
    const result = await fixture.client.authPasswordSignup({
      email: 'person@example.com',
      password: PASSWORD,
    });
    assert.equal(result.session.userId, USER);
    assert.equal(fixture.coordinator.authority.userId, USER);
    assert.equal(Object.hasOwn(result, 'token'), false);
```

`authPasswordSignIn` takes the same `{ email, password }` and returns the same
shape. After either, the client holds an ordinary session: protected queries,
refresh, the logout barrier, and reload restoration all behave exactly as they
do after an email-code exchange.

Both methods require an `AuthCoordinator` and an anonymous predecessor — they
create a fresh authority, so they adopt through the same anonymous-issuance
path `authExchange` uses. The bearer is never returned to your code; the
coordinator owns it. An ordinary React or Expo app should not construct that
coordinator itself; use the application-client/provider journey above.

## The exact session shape

Two different shapes carry the user id, at two layers. Both are real; use the
one for the layer you are at.

**On the wire**, `POST /auth/password/signin` returns the LLP 0057 composed
credential response — the same five fields as `/auth/exchange`:

```text
{
  "tokenType": "Bearer",
  "token": "…",
  "refreshAfter": 604800000,
  "session": {
    "id": "…",
    "userId": "usr_…",          ← the server-issued principal
    "provider": "local-password",
    "createdAt": 0,
    "expiresAt": 0,
    "absoluteExpiresAt": 0
  },
  "authorityDescriptor": { "descriptorVersion": 1, "authorityInstanceId": "aut_…", "sessionGeneration": 1 }
}
```

**In the client**, the session projection nests authority, and
`session.authority.userId` is the principal:

```text
session.authority.userId        ← principal id, client-side projection
session.authority.isAuthenticated
credential.session.userId       ← the same principal, wire response
```

`session.provider` reports `local-password` at mint **and on every later
refresh**, so a session's credential class stays legible for its whole life.

Signup additionally returns `recoveryCodes` — the only response that carries a
sixth field. Everything else stays byte-shape-identical to `/auth/exchange`.

## Recovery codes are the recovery path

Signup returns eight one-time recovery codes. **They are shown exactly once**
and are not readable again — not through the admin console, not through any
route. Store them at signup or lose them.

- `authRecoveryConsume({ email, code })` mints a session and automatically
  replaces the whole set. A consumed code cannot be reused.
- `authRecoveryRotate()` replaces the set for an authenticated principal —
  use it after suspected disclosure.

Recovery codes never enter coordinator custody, the public credential
projection, or error diagnostics.

## Changing a password

`authPasswordChange({ currentPassword, newPassword })` requires both an
authenticated session **and** the current password — a stolen bearer alone
cannot rotate a credential.

Change is a **same-authority rotation**, not a new login: it rotates the acting
session's bearer, keeps the authority instance id, and revokes the user's
*other* sessions. A session belonging to a different user is untouched. Because
the authority is preserved, the client adopts it through the same rotation path
refresh uses.

`authPasswordSet({ newPassword, stepUp })` adds a first password to a principal
that has none. It additionally requires a fresh operation-bound step-up
challenge naming the principal's own verified `email-code` identity — acquire it
with `POST /auth/request-code` against that address.

## From the CLI

Passwords are accepted on stdin and **never** on the command line, in any
profile — so they never reach process listings or shell history.

```sh
printf '%s' "$PASSWORD" | snapback auth password signup \
  --url http://127.0.0.1:4000 --email person@example.com --password-stdin

printf '%s' "$PASSWORD" | snapback auth password signin \
  --url http://127.0.0.1:4000 --email person@example.com --password-stdin
```

`--password-fd N` and the `SNAPBACK_PASSWORD` environment variable are accepted
**only** under dev and test profiles, and refused elsewhere with a typed code.
`snapback auth password change` reads the session token first, then the current
and new passwords, from stdin in that order.

These verbs need no admin token and no impersonation capability. They are the
product front door, not an operator impersonation path — unlike
`snapback session mint`.

## What a failed signin tells an attacker: nothing

Wrong password, unknown identifier, and locked-out all answer the **same**
`SNAPBACK_AUTH_CREDENTIAL_INVALID` with the same status, body, headers, and
timing envelope. A signin against an address with no account still performs a
full key-derivation against a dummy hash so the cost is uniform.

Lock state is deliberately **invisible on the wire**. A visible lock would
itself be an oracle: a real account's counter resets when its owner signs in
while a missing address's never does, so lock behavior would diverge across
histories and disclose successful-authentication activity. Lock existence,
threshold, and expiry are observable only through the authenticated admin
projection and `authProgramReadiness`.

<!-- since: 0.1.21 -->
An operator can call `admin.passwordAttempt(email)`. Its AdminRead response
contains the declared `failureThreshold`, `failureWindowMs`, and
`lockDurationMs`, plus either `attempt: null` or the canonical identifier,
window start, failed count, lock deadline, and current `locked` bit. It never
contains the password hash. The corresponding AdminWrite
`snapback auth password unlock` verb deletes that ledger row early.

Declared v1 posture — **every threshold is a profile parameter, not a fixed
constant**, so acceptance suites and benchmark envelopes can raise them:

| | Default |
| --- | --- |
| Consecutive failures before lock | 10 |
| Lock duration | 15 minutes |
| Failure window (sub-threshold decay) | 15 minutes |
| Password length | 12–1024 UTF-8 bytes by default; declare `minimumLength` from 8–128 |
| Argon2id | m=19456 KiB, t=2, p=1 |

An operator can clear a lock early with the AdminWrite unlock verb; otherwise
the lock expires on its own with no intervention.

## Capability boundaries — read before shipping

These are not shipped, and Snapback says so rather than pretending:

- **Production signup is not blind-accept.** On local/dev/test, signing up with
  an address that already has an account refuses with a distinguishable code —
  a deliberate, documented enumeration oracle on the trusted local target.
  Blind-accept needs mail delivery to notify the real owner, so
  `authProgramReadiness` reports production signup **unready** rather than
  faking it.
- **Mail-delivered password reset does not exist.**
  `POST /auth/password/reset` works only against the local capture mailbox and
  refuses outside that profile. Real reset waits on the LLP 0045 mail adapter.
  Recovery codes are the self-serve path in the meantime.
- **Reset is same-principal only.** The address's `email-code` identity and its
  password identity must belong to the same principal. A password-only account,
  an email-code-only account, and the two-principal squat state all refuse
  uniformly — transferring a squatter's credential to someone who later proves
  the address is exactly the hijack this contains.
- **A password never proves you own the email address.** It proves control of
  the account whose login name is that string. Only an email-code exchange
  proves address ownership, and the two claims are separate identity rows in
  separate provider namespaces. A password identity can never satisfy an
  email-code lookup.
- **Catalog v4 is required.** A store created by an older runtime keeps working
  for everything else and reports the password provider unready — it does not
  fail. There is no silent migration.
- **Sender-constrained custody is refused, not downgraded.** When
  sender-constrained credentials are active, password methods refuse with a
  typed error rather than quietly falling back to bearer-only custody.

## Anti-patterns

- **Do not construct `AuthCoordinator` or call an authority-adoption method in
  an ordinary React/Expo app.** The generated application client and provider
  own that composition; the explicit seam is for custom brokers and shells.
- **Do not discard, log, analyze, or silently persist signup recovery codes.**
  Present the one-time projection immediately and hand custody to the user.
- **Do not implement user switch as sign-in over an authenticated principal.**
  Sign out, wait for settled anonymous, then enter the successor account.
- **Do not infer Expo-native restoration from browser or Expo-web evidence.**
  The source-current iOS and Android `single-runtime` arms have separate
  Phase-2 receipts and both remain unpublished behind the
  [custody first-publish gate](repo:issues/20260816-custody-first-publish-gate.md). The iOS extension evidence
  is share-sheet-kind-only; NSE/`simctl push` remains a nonclaim.
- **Do not generalize this local bearer journey into hosted or
  sender-constrained auth.** Check [Targets](./targets.md) first.

---

<!-- snapback-guide-source: guide/auth/native-apps.md -->
---
title: Authenticate a native app
id: auth.native-apps
order: 3
audience: agent-first
capabilities: [auth.external-identity-broker]
authorities: [llp/0024-agent-operating-surface.spec.md, llp/0045-notifications-outbox.rfc.md, llp/0057-auth-provider-protocol.spec.md, llp/0064-native-client-surfaces.rfc.md, llp/0096-auth-profiles-for-protocol-clients.spec.md, llp/0181-zero-configuration-expo.rfc.md, packages/snapback-client/index.mjs, packages/snapback-expo/supervised-environment.mjs, src/cli.rs, clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift]
examples: []
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:82893b993434042d00d895244476e58ba7c0cca1643a3d0cc695ee2e9e22eb6e
---

# Authenticate a native app

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./targets.md).

Snapback supports two native session-entry shapes on the local target:

1. a reachable email-code delivery surface drives `/auth/request-code` and
   `/auth/exchange`; or
2. a trusted server-side identity broker authenticates the user through its
   own front door, invokes `auth.mintSession`, and returns the resulting
   Snapback session bearer to that user.

The second shape is the sanctioned bridge for native development and demos
whose identity system is outside Snapback. It is no longer necessary to
hand-write a second Snapback protocol client after the bearer is issued:
JavaScript uses `createExternalSessionClient(baseUrl, { bearerToken })`, while
Swift sets `Configuration.sessionBearer`.

**Expo apps in local development rarely need to hand-build either shape**:
the supervised dev loop (`snapback dev --expo`) already auto-mints an
ordinary session through its loopback-only
`GET /_snapback/expo/v1/bootstrap` exchange under `SnapbackExpoProvider` —
see [the supervised Expo development loop](../clients/react-expo.md#run-the-supervised-expo-development-loop)
before wiring a broker by hand.

## Keep the broker server-side

`auth.mintSession` is a host operation available only in dev/test/demo. It
requires all three independent authorities: the ordinary AdminWrite token, the
process-bound impersonation capability, and active sessions mode. The broker
must live in the trusted server deployment that can hold those authorities.
It authenticates the external user, maps that identity to the email passed to
the host operation, and releases the returned bearer only to that same user.

From a terminal, the paved spelling of the same operation is
`snapback session mint --email <email> --ready-file <ready-file>` (or
`--url` plus the admin token, reading the impersonation capability from
stdin): it attaches the same authorities from the readiness descriptor
instead of you assembling the host-op request by hand.

For a broker that must use HTTP, the canonical
[exact `auth.mintSession` request, response, and refusal shape](../operating/host-ops.md#mint-a-session-over-http)
lives in the host-ops guide.

Never put the admin token, impersonation capability, ready-file, or mailbox
reader in a browser or native bundle. Never expose a generic “mint for email”
endpoint without the broker's own user authentication and abuse controls.

## Carry the adopted bearer

An external bearer is ordinary protocol-client custody, not
`AuthCoordinator` browser custody and not sender-constrained custody. The
client must offer `auth/rr`; auth-scoped live work must additionally offer
`auth/live`, create an authorization namespace, process invalidation snapshots,
and acknowledge them after apply. The first-party JS factory and Swift client
do this.

A browser that must restore sign-in after a full-page reload needs a different
last mile: stage a one-use challenge/code and call ordinary `authExchange` on a
client backed by `createIndexedDbAuthCustodyStorage()`. See the executable
[browser sign-in and reload recipe](../recipes/browser-auth.md). Returning an
external bearer to page state or `createExternalSessionClient` does not become
`AuthCoordinator` custody merely because the caller is a browser.

Replacing or clearing a bearer is an authority transition. In JavaScript use
`await client.replaceBearerToken(nextBearer)` (or `null` to clear): it releases
protected live-query demand, blanks predecessor rows, retires old grants and
transports, and only then fresh-subscribes under the successor. The synchronous
`setBearerToken` method refuses a changed value because it cannot provide that
barrier. A broker that rotates credentials supplies the replacement bearer
explicitly; the external-bearer seam does not silently assume refresh
ownership.

A transition that completes settles — including a downgrade. When the server
answers a handle's successor fresh-subscribe with an authorization refusal
(for example `SNAPBACK_AUTH_PERMISSION_DENIED`), the transition still
resolves; the denial lands on that handle as the frozen
`handle.authorizationDenial` fact (`{ code, message, atMs }`), is delivered to
`onUpdate` observers as an `authorization_denied` update, and renders as the
`error` query state under the React provider. The denied handle stays parked:
the next authority transition (for example rotating back to the original
bearer) fresh-subscribes it and clears the fact — no process restart. Genuine
lifecycle breakage during a transition (transport loss, broken callbacks)
still rejects with an `AggregateError`.

## Know the production boundary

The shipped email provider's capture mailbox and `auth.mintSession` are
non-production only. LLP 0045's production delivery adapter remains unbuilt,
and the Cloudflare arm exposes no sessions routes. This page therefore does
not claim hosted production native auth.

On a sender-constrained deployment, a generic native bearer is also
insufficient: LLP 0077 defines browser WebCrypto custody only, and native
Secure Enclave/Keystore proof transport remains a named design gap.

## Anti-patterns

- Do not fetch the process-local mailbox from a phone.
- Do not ship broker/admin authority in the app.
- Do not describe an external bearer as sender constrained.
- Do not infer hosted support from the local broker seam.

---

<!-- snapback-guide-source: guide/auth/protecting-data.md -->
---
title: Protecting live and retained data
id: auth.protecting-data
order: 4
audience: agent-first
capabilities: [auth.table-visibility, auth.invalidation-barrier, auth.authorized-leases, authority.profile.v1]
authorities: [llp/0053-authorization-invalidation.rfc.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0231-entity-and-permissioning-recommendation.rfc.md, llp/0240-application-authority-profiles.rfc.md, src/auth/invalidation.rs, src/auth/mode.rs, src/auth/service_fence.rs, src/local.rs, src/local/authorization_acceptance.rs, src/manifest.rs, src/runtime.rs, src/server.rs, demos/_kit/tests/auth-invalidation-client.mjs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-codegen/codegen-summary.mjs, packages/snapback-client/index.mjs, packages/snapback-contract/authorized-lease.mjs]
examples: [demos/card-game, demos/card-game/snapback/schema.mjs, demos/pointing-room, demos/pointing-room/snapback/functions.mjs, demos/pointing-room/tests/acceptance/disclosure-invariant.mjs, demos/_kit/tests/auth-invalidation-client.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:3c291b748e3c46bd38618b661c1bd3ffd8c9125564eaf140621017774539867e
---

# Protecting live and retained data

> **Local target only.** These guarantees are witnessed on the canonical
> Ibex/SQLite target. Hosted auth is not available; see
> [target honesty](./targets.md).

Start with [sessions and principals](./sessions-and-principals.md) to sign in
and scope a query, or the [hidden-hands recipe](../recipes/hidden-hands.md) for
the shortest end-to-end example. This page is the systematic reference for
what happens after private data becomes live or retained.

<!-- since: 0.1.19 -->

## Declare who can read each table

Add one `.visibility(...)` declaration to each `defineTable(...)` chain. The
closed choices are `{ kind: 'public-read' }`, `{ kind: 'owner', field }`,
`{ kind: 'membership', declaration, resourceField, roles }`, and one bounded
top-level `anyOf([...])` over owner and membership arms. There is no
`public()` helper: use the literal public-read record so intentionally public
data stays explicit and greppable.

Card-game declares the hidden-hand boundary on the table itself:

```js source=demos/card-game/snapback/schema.mjs
    .visibility({ kind: 'owner', field: 'ownerId' })
```

The owner field must exist. A membership declaration must resolve to a
`.membership(...)` declaration. On a child governed table,
`resourceField` must exist as a required `v.id(...)` of that membership's
resource table. On that resource table itself, use `resourceField: '_id'` so
the row's system id is the membership resource. Every named role must be in
that declaration's non-pending role vocabulary.
Public-read is a policy decision, not a development fallback.

Use the two bindings together for a private resource and its direct children:

```js fragment reason="membership declaration fields are application-specific; this shows the shipped resource and child visibility bindings"
conversations: defineTable({ title: v.string() }).visibility({
  kind: 'membership',
  declaration: conversationMembers,
  resourceField: '_id',
  roles: ['member', 'admin'],
}),
messages: defineTable({
  conversationId: v.id('conversations'),
  body: v.string(),
}).visibility({
  kind: 'membership',
  declaration: conversationMembers,
  resourceField: 'conversationId',
  roles: ['member', 'admin'],
}),
```

That declaration removes repeated handler checks for direct reads: ordinary
plans and ordinary `ctx.db` calls automatically admit members and hide the same
rows from strangers. Keep the roster private and use `ctx.permissions` for
imperative authorization questions.

Use `anyOf` for the common “owner or relationship” row boundary:

```js fragment reason="bounded relationship visibility declaration"
followingFeedEntries: defineTable({
  authorPrincipalId: v.principal(),
  authorProfileId: v.id('profiles'),
  body: v.string(),
}).visibility(anyOf([
  owner('authorPrincipalId'),
  {
    kind: 'membership',
    declaration: followings,
    resourceField: 'authorProfileId',
    roles: ['following'],
  },
]))
```

The disjunction has 2–8 distinct arms, preserves authored order, and cannot
nest. `public-read` is not an arm: it would make the entire boundary public.
The compiler carries this exact predicate into generated query plans. Storage
evaluates the arms as one grouped OR, then ANDs authored query filters. A
membership-containing policy records all membership dependencies and uses the
conservative live-replace lane on relationship insert or delete. Anonymous
callers satisfy neither arm. All restricted table policies are deliberately
ineligible for authority-independent RQS digests.

Model a follow graph as a dedicated resource-scoped membership projection,
for example `(follower principal, followed profile, 'following')`. The owner
arm includes an author's own rows without inventing a persisted self-follow
edge. Keep the projection focused on authorization facts; do not use a public
roster query as the feed boundary.

This release is the warn phase. A table without the declaration still
generates, but codegen reports `SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT` with
one reviewer-gated remediation per policy kind and a guide pointer. Invalid
declared policies fail generation with stable `SNAPBACK_TABLE_VISIBILITY_*`
codes. The reference registry lists the complete family; the cross-reference
checks most useful while adopting it are
`SNAPBACK_TABLE_VISIBILITY_OWNER_FIELD_UNKNOWN`,
`SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_DECLARATION_UNKNOWN`,
`SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_ROLE_UNKNOWN`, and
`SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_UNKNOWN`. The generated schema
manifest and `artifacts.json` summary project declared and implicit tables for
review.

`.visibility(...)` and `.assetSharing(...)` are independent declarations.
Declaring one does not declare, infer, or conflict with the other. Table policy
composes into generated direct query/live-query plans, relational root and
joined sources, bounded parent and child sources, every snapshot-batch node,
and ordinary handler `ctx.db` reads. Surface-local relational/bounded
visibility remains an additional conjunct: a row must pass both. Search has
its own separately composed visibility declaration. Class-M field masking,
writes, and egress remain separate boundaries. If a future read-surface class
cannot carry the table policy, codegen refuses it with
`SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE`.

### Authorize first, then elevate the exact handler read

Named JavaScript queries and mutations are trusted server code, but ordinary
`ctx.db` is intentionally caller-scoped. If a handler forgets an authorization
check, owner or membership visibility still hides the row.

<!-- since: 0.1.23 -->

For the ordinary group case where the resource id is already a typed argument,
put an authority-profile predicate on the definition; codegen emits the same
captured role evaluation ahead of the handler for Explicit and Familiar code:

```js fragment reason="declarative authority-profile admission for a named live handler"
export const conversationMessages = defineJsLiveQuery({
  auth: 'authenticated',
  args: { conversationId: v.id('conversations') },
  reads: ['messages'],
  membership: [conversationMembers.hasRole(
    membershipResource.arg('conversationId'),
    'member',
  )],
  handler: async (ctx, args) =>
    ctx.db.query('messages').withIndex('byConversation')
      .eq('conversationId', args.conversationId).take(50).collect(),
});
```

Denied reads blank to `[]`; denied mutations are terminal. The negative lookup
is captured, so membership removal reauthorizes live delivery. The predicate
requires an LLP 0240 authority profile and a direct nominal resource argument.

When a handler instead must derive the resource through protected rows for its
authorization decision, first use the host-owned permission declaration, then
select `ctx.db.elevated` at the read that requires trusted authority:

```js fragment reason="permission check before explicit elevated handler reads"
export const getMessageWithQuote = defineJsQuery({
  args: { conversationId: v.id('conversations'), messageId: v.id('messages') },
  reads: ['conversationMembers', 'messages'],
  async handler(ctx, args) {
    await ctx.permissions.conversationMembers.requireRole(
      args.conversationId,
      'member',
      'admin',
    );

    const message = await ctx.db.elevated.get('messages', args.messageId);
    if (!message || message.conversationId !== args.conversationId) return null;

    const quoted = message.quotedMessageId
      ? await ctx.db.elevated.get('messages', message.quotedMessageId)
      : null;
    if (quoted && quoted.conversationId !== args.conversationId) return null;
    return { message, quoted };
  },
});
```

The permission check and every resource comparison are load-bearing.
`requireRole` derives the effective principal on the host and returns no roster
data. The post-read comparisons prevent an authorized conversation id plus an
unrelated message or quote id from becoming an object-reference bypass. Caller
arguments never select elevated authority.

Elevated reads bypass only table row visibility. They keep the same bounds,
snapshot captures, OCC validation, and media deprojection as `ctx.db`; they do
not bypass field masking, write policy, membership writer rules, asset access,
or result/egress checks. The closed surface is `get`, `getMany`, `uniqueMany`,
and `query`; there are no elevated write members. It is available only to named
queries and mutations. Actions and generated/direct query plans cannot use it.

Use declarative membership visibility whenever the governed row directly names
the membership resource, including the resource table's `_id` self-resource
case. Multi-hop authorization is still deliberately undeclarable: for example,
a receipt that names a message while membership is keyed by the message's
conversation cannot express that join in the visibility grammar. Either
denormalize the conversation id onto the receipt and maintain that invariant,
or use the sanctioned multi-hop handler pattern in **every** named function:

1. If the resource id is already an argument, call the declaration-bound
   `ctx.permissions` check first. If only a child id exists, make one bounded
   elevated read to derive the resource id, then perform the permission check
   immediately and return no data before it succeeds.
2. Resolve only the remaining protected facts with bounded elevated reads.
3. Validate every resolved row—including nested quotes or parents—belongs to
   the authorized resource; never trust an id merely because it came from
   another stored row.
4. Add negative identity tests proving both a non-member and an authorized
   resource id paired with a foreign row id are refused or hidden.

Do not centralize only the happy path while leaving one live query, receipt
mutation, or quote lookup unchecked. This repetition remains intentional for
multi-hop relations; direct resource arguments should use the declarative
authority-profile admission above.

## Declare field masking that still lives in a JS handler

An opaque `defineJsQuery` or `defineJsLiveQuery` that returns every row but
conceals selected result fields can add `fieldBoundary: { fields: ['value'],
condition: 'round is revealed or the caller owns the vote' }`. `fields` must
be a non-empty unique list, `condition` must be a non-empty free-text claim,
and codegen refuses a named field absent from a checkable effective result
contract. The stable refusal family is `SNAPBACK_FIELD_BOUNDARY_SPEC_INVALID`,
`SNAPBACK_FIELD_BOUNDARY_FIELDS_INVALID`,
`SNAPBACK_FIELD_BOUNDARY_CONDITION_INVALID`, and
`SNAPBACK_FIELD_BOUNDARY_FIELD_UNKNOWN`.

This is explicitly **handler-enforced, not proven**. It does not compose a
field policy into the data plan, withhold raw values from the handler, prove
noninterference, or detect masking code that omitted the declaration. The
generated `artifacts.json` summary lists every declaration under
`fieldBoundaries`, and codegen's text summary labels each one
`handler-enforced (not proven)`. Keep a two-principal acceptance test beside
the declaration: one principal must observe the concealed form while the
entitled principal observes the value, then both must observe the value after
the disclosure condition changes. Pointing Room's `liveTally` is the worked
case. This residual exists until LLP 0231's class-M sibling supplies an
enforced field-masking grammar.

## Check the negotiated capability, not route existence

`authProgramReadiness` in inspect reports separate build/runtime facts:
provider core, the shared invocation gate, staged mode, connection binding,
two-phase revocation, `AuthCoordinator`, authorization invalidation, authority
descriptors, authorized leases, and derived session-activation readiness.

The authenticated `client.authSession()` projection then reports what this
exact connection may use:

- `availability.onlineRequestResponse`;
- `availability.authScopedLive`, including the required invalidation protocol;
- `availability.retainedReads`, requiring invalidation **and** authorized
  leases; and
- `availability.queuedReplay`, requiring authority descriptors.

In sessions mode, an auth-scoped live subscription is admitted only when both
server and client negotiate `authInvalidationProtocol: 1`. Retained reads also
require `authorizedLeaseProtocol: 1`. A route present behind an unavailable
facet is not a supported capability.

Configure `SnapbackClient` with `authInvalidationProtocol: 1`; the client then
offers `x-snapback-auth-invalidation-protocol: 1` on finite live requests and
includes `authInvalidationProtocol: 1` when it opens a connection. A clean-room
HTTP client must send those same values itself. If Snapback answers
`SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED`, add the missing offer or
reopen a stale connection with it before retrying.

## Connection grants bind live work to authority

The string your app supplies as `connectionId` is a logical sharing label. On
open, Snapback returns a granted id, a secret connection token, and the exact
authorization-invalidation expectation. The snippet below is the kit test's
**mock server fixture** answering an open — it models the wire shape a real
server returns, not application code you write:

```js source=demos/_kit/tests/auth-invalidation-client.mjs
      return response({
        connectionId: 'granted-auth',
        connectionToken: 'sct_auth',
        ephemeralExpiryProtocol: 1,
        wireVersion: 'snapback.v1',
        authorizationInvalidation: {
          protocolVersion: 1,
          issuerId,
          connectionGeneration: 2,
          authorization,
          versionStream: 'stream-A',
        },
      });
```

That grant is authority, not a bearer-shaped routing convenience. It is bound
to one anonymous authorization stream, one exact session generation, or one
scoped service-principal authority plus its exact token/deadline carrier. The
service form keeps the durable resolved authority separate from the token and
its service-publication fence, so ending one token cannot widen or silently
rebind the grant. Every live subscribe/resume, outbox drain, ephemeral act, and
publication validates the grant token and binding at its final effect fence.
HTTP sends the token in `x-snapback-connection-token`; browser WebSockets use
the negotiated `snapback.connection-token.*` subprotocol.

Every auth-scoped live subscribe also carries this closed
`authorizationNamespace` identity:

```js fragment reason="closed wire shape for clean-room client authors"
{
  clientStoreId: 'durable-store-id',
  queryKey: 'canonical-query-and-arguments',
  queryInstanceId: 1,
}
```

`clientStoreId` identifies the durable client store, `queryKey` is the
client's canonical query-plus-arguments key, and `queryInstanceId` is a
positive counter distinguishing successive materializations of that key.
`SnapbackClient` creates this object for its live-query path. Clean-room
clients must persist and advance the identity with their store rather than
minting all three fields per request. Omitting it is refused as
`SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED`.

An auth transition clears cached grants and reconnects under a fresh grant.
Never persist, copy between clients, log, or manually reuse a connection
token. Let one `SnapbackClient` multiplex consumers that intentionally share a
logical connection label.

## Authorization change is a persistent obligation

Logout is one visible case, but the barrier also covers permission or
membership changes, coarse authorization-version advances, activation/reset
boundaries, and protected ephemeral-room authority changes. A change that may
shrink a result raises a revisioned obligation against the exact live/query
scope.

The reachable-client sequence is:

1. The client receives the obligation and synchronously applies its maximum
   disposition—normally `quarantine`, sometimes terminal `delete`.
2. Live rows blank; retained reads block; optimistic/outbox custody for that
   scope suspends. Ordinary live frames cannot repopulate it.
3. The server resolves with a fresh satisfying snapshot or trusted terminal
   denial tied to the same scope/revision/witness.
4. The client atomically commits the disposition, snapshot or tombstone,
   queue/store resolution, and local boundary.
5. Only after that commit does it acknowledge the opaque resolution token.

Within one authenticated authorization-stream incarnation, a strictly greater
authorization epoch is the current obligation, not a stale subscribe
expectation. The client advances that exact fence before applying the
resolution. A lower epoch or different incarnation/version stream remains
stale and requires the normal replacement bootstrap.

The kit test pins the order:

```js source=demos/_kit/tests/auth-invalidation-client.mjs
  assert.deepEqual(order.slice(0, 3), [
    'queue-apply:1',
    'queue-resolve:1',
    'ack:ack_1',
  ]);
```

A lost delivery is safe because obligations are level-triggered state, not
one-shot events: connection open, subscribe/resume, drains, and heartbeats
re-project unresolved work. A stale acknowledgement re-quarantines; a duplicate
successful acknowledgement is idempotent. A queue/store failure leaves the
boundary blank and stale until the exact obligation re-fires with valid proof.

Protected ephemeral rooms use the same principle: affected sinks quiesce before
the authorization-changing commit becomes visible, then fresh room
reauthorization either admits the successor generation or revokes it.

## Retry is bounded and explicit

Automatic satisfying resnapshot attempts are bounded. Exhaustion leaves the
scope quarantined; reconnect or subscribe does not reset the episode. The
`POST /live/authorization-invalidation/manual-retry` operation is an
authority-checked recovery control that requires the current connection,
scope, and a fresh idempotency id. It is not an ordinary UI retry button and
cannot replace an episode before automatic attempts are exhausted.

Use normal client/barrier recovery first. Operator or acceptance tooling should
invoke manual retry only for a surfaced unresolved episode, keep the same
current authority, and treat capacity, clock-rollback, stale-scope, and denial
diagnostics as fail-closed outcomes.

## Authorized leases bound unreachable honest clients

An offline client cannot receive an obligation. Therefore every readable
auth-scoped retained snapshot needs a server-issued `AuthorizedLease`, bound to
the exact principal, authorization version, app/data version stream, active
artifacts, client store, query key, and query-instance id.

`authorizedLeaseProtocol: 1` advertises that the session can use this optional
protocol; it does not make every query retainable. The canonical client calls
the lease endpoint only when the generated live-query reference carries its
explicit protected-retention class. A non-retainable query remains an ordinary
online live query even when the same client offers lease support.

Lease acquisition is one full revalidation, not a heartbeat:

1. The client durably reserves a fresh `leaseRequestId` and records the request
   start against its clock high-water.
2. `authorizedLeaseQuery` performs the full query. At one server commit-order
   boundary, Snapback proves the app-data head, authority, active artifacts,
   and absence of a pending invalidation obligation.
3. The response carries the snapshot and lease together. The client validates
   its closed shape/bindings and atomically commits rows, witness, exact lease
   bytes/hash, and derived deadline before render.

```js source=packages/snapback-client/index.mjs
    return this.#req('POST', `/query/${encodeURIComponent(name)}/authorized-lease`, {
      args,
      auth: SnapbackClient.auth(userId),
      read_set: readSet,
      leaseRequestId,
      clientStoreId: namespace.clientStoreId,
      queryKey: namespace.queryKey,
      queryInstanceId: namespace.queryInstanceId,
      ...(generation === null ? {} : { expectedGeneration: generation }),
    }, undefined, { expectedAuthorityCapture: authorityCapture });
```

V1 defaults to 24 hours and has a 24-hour hard maximum; configuration may only
shorten it. Session/provider expiries clamp the server deadline. The client
derives its deadline from the request-start clock plus the server-issued
duration, so network delay shortens validity rather than extending it.

Heartbeat, delta delivery, reconnect, acknowledgement, mutation, session
refresh, or presenting an old lease never renews it. Renewal is another full
query and atomic proof. At or beyond the exact client deadline—or on clock
rollback, malformed/missing lease, mismatched identity/witness/instance, stale
activation, or invalid request reservation—the store commits delete-before-read
for that query instance.

The server verifies the lease MAC because only it owns the key. The client
validates structure and bindings and hashes the exact bytes for custody
corruption detection; it cannot cryptographically authenticate a server MAC.

## Understand the threat boundary

The lease bounds an honest device that is temporarily unreachable. It is not
anti-tamper: a hostile client can alter its clock or read bytes it already owns.
If adversarial-client access to retained private bytes is in scope, do not
enable retained reads. A legitimate revocation may remain visible to an honest
offline device until its lease deadline; that is the explicit local-first
product tradeoff.

## Anti-patterns

- **Do not handle invalidation as an edge event.** Preserve the obligation
  until committed resolution and acknowledgement.
- **Do not ACK before the boundary/store commit.** Delivery is not discharge.
- **Do not render quarantined rows or allow ordinary frames to refill them.**
- **Do not treat reconnect as manual retry or lease renewal.**
- **Do not cache authorized rows outside the lease-enforcing client store.**
- **Do not infer hosted guarantees from the local readiness projection.**
- **Do not treat `.assetSharing(...)` as a table visibility declaration.**
- **Do not use public-read merely to silence the implicit-visibility warning.**

---

<!-- snapback-guide-source: guide/auth/scoped-roles.md -->
---
title: Scoped roles and memberships
id: auth.scoped-roles
order: 5
audience: agent-first
capabilities: [auth.scoped-roles, authority.profile.v1]
authorities: [llp/0056-scoped-roles-and-memberships.rfc.md, llp/0100-membership-addressed-operations-and-pages.rfc.md, llp/0240-application-authority-profiles.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, src/manifest.rs, src/membership_rules.rs, src/runtime.rs, src/storage.rs, demos/rbac/tests/acceptance/rbac.mjs, demos/shindig/snapback/schema.mjs, demos/shindig/snapback/functions.mjs, tests/membership_principal_addressed_v0.rs]
examples: [demos/rbac, demos/shindig, demos/team-chat, packages/snapback-codegen/rbac-authoring.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-16
reviewed-authorities-digest: sha256:25bdca3cfd5d6843c705816a3e529fe5bb7cfa6cb279772af41580c6f53b1eaa
---

# Scoped roles and memberships

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./targets.md).

Snapback models authorization roles as rows with a system-recognized shape:
principal, optional resource, and role. The roster stays live app data, while
the host owns the transition checks, query semi-join, denial, invalidation, and
provenance. Roles are not copied into session claims.

The shipped v1 lane is for online queries, live queries, and mutations. It does
not yet make membership-gated results retainable offline, emit incremental
semi-join deltas, or support hosted targets.

## Privacy posture and reachable operations

Membership backing rows are private to ordinary handlers and synchronization:
application code cannot query them, ask whether one exists, or obtain their
row ids, and `insert` returns `null`. A qualified `authorityProfile()` adds a
different, narrow surface: active members may use its generated bounded roster
projection and principal-addressed transition operations. The host reveals
only `roster.visible` fields and returns typed transition receipts, never a
membership row id or generic table access.

| Operation under the private v1 posture | Reachable app path |
| --- | --- |
| create a resource plus its first holder | `bootstrap(...)` (resource scope) |
| add self or another principal | declared `insert` transition; returns no row id |
| accept/decline/change/remove the caller's own seat | `setSelfRole`, `removeSelf`, or `patchSelf` |
| remove another principal (kick) | `removePrincipal(resource, principal)` — requires the explicit `principalAddressedWrites` opt-in (below) |
| administrator changes/patches another existing seat | foreclosed: requires a private row id |
| read/list/sync the roster or test another seat's existence | foreclosed: use `memberOf`/`hasRole` semi-joins, `requireRole`, or the caller's own `_snapback.myMemberships` |
| profile-backed invite/change/remove | generated `api.<profile>.invite`, `changeRole`, or `remove`, when the transition matrix admits it |
| profile-backed owner change | generated `transferOwner`; atomic promotion plus caller demotion |
| profile-backed roster read | generated paginated `list` and caller-only `myRole`; no generic roster read |

Without an authority profile, keep invitations in an ordinary app-data table
whose privacy policy fits the product, or use a membership `pendingRole` that
the invitee can finish through a self-addressed transition. A profiled
membership instead generates `invite` and `join` when those exact other-insert
and pending-to-active self transitions exist. Neither path exposes a private
membership row id.

## Declare one roster for an application resource

The RBAC demo uses one application row as the resource scope. Its membership
table is simultaneously the product roster and the authority relation:

```js source=demos/rbac/snapback/schema.mjs
export const appMembers = defineTable({
  appId: v.id('applications'),
  userId: v.principal(),
  role: v.string(),
}).visibility({ kind: 'owner', field: 'userId' }).membership({
  id: 'appAccess',
  principal: 'userId',
  resource: 'appId',
  role: 'role',
  roles: ['owner', 'admin', 'member'],
  pendingRoles: ['invited'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['owner', 'admin'], target: 'other', to: ['invited'] },
    { op: 'setRole', by: ['self'], target: 'self', from: ['invited'], to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['invited', 'admin', 'member'] },
    { op: 'setRole', by: ['owner'], target: 'other', from: ['admin', 'member'], to: ['admin', 'member'] },
    { op: 'remove', by: ['owner'], target: 'other', from: ['invited', 'admin', 'member'] },
    { op: 'remove', by: ['admin'], target: 'other', from: ['invited', 'member'] },
  ],
}).authorityProfile({
  name: 'appAccess',
  hierarchy: {
    owner: ['admin', 'member'],
    admin: ['member'],
    member: [],
  },
  roster: { visible: ['userId', 'role'] },
});
```

The transition grammar is closed. Each operation declares its allowed caller
class, self/other target, old/new roles, and—for inserts or patches—extra
fields. Unknown keys, undeclared roles, unreachable combinations, and empty
role sets fail artifact generation or activation. Runtime evaluation derives
the principal and current membership inside the write transaction; the caller
cannot supply either fact as authority.

For a role per resource, add a required resource field typed with the nominal
table id. `v.id('events')` is not interchangeable with another string-shaped
id:

```js source=packages/snapback-codegen/rbac-authoring.test.mjs
export const eventMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
  joinedAt: v.integer(),
}).membership({
  id: 'eventMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['host', 'guest'],
  pendingRoles: ['invited'],
  bootstrapRole: 'host',
  lastHolder: { protect: 'host' },
  incidental: ['joinedAt'],
  provenance: 'full',
  transitions: [],
}).visibility({ kind: 'owner', field: 'userId' });
```

Codegen derives `resourceTable` from that validator and carries the nominal
type into the function artifact. An argument or row-field helper bound to
`Id<'organizations'>` is rejected before publication when the declaration
requires `Id<'events'>`.

<!-- since: 0.1.21 -->

## Reuse one role hierarchy in queries and table visibility

Decorate an existing resource-scoped membership with
`.authorityProfile(...)` when product roles form a finite hierarchy. The
profile is a codegen facade: the membership table remains the only roster and
authority store, and every write still uses the LLP 0056 transition seam.

```js fragment reason="AuthorityProfileV1 authoring shape; lowering, refusal codes, projection identity, and generation rotation are exercised in packages/snapback-codegen/rbac-authoring.test.mjs"
export const roomMembers = defineTable({
  roomId: v.id('rooms'),
  userId: v.principal(),
  role: v.string(),
  displayName: v.optional(v.string()),
}).membership({
  id: 'roomAccess',
  principal: 'userId',
  resource: 'roomId',
  role: 'role',
  roles: ['owner', 'admin', 'member'],
  pendingRoles: ['invited'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['owner'], target: 'other', to: ['invited'] },
    { op: 'setRole', by: ['self'], target: 'self', from: ['invited'], to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['admin', 'member', 'invited'] },
    { op: 'setRole', by: ['owner'], target: 'other', from: ['admin', 'member'], to: ['admin', 'member'] },
    { op: 'remove', by: ['owner'], target: 'other', from: ['admin', 'member', 'invited'] },
  ],
}).authorityProfile({
  name: 'roomAccess',
  hierarchy: {
    owner: ['admin', 'member'],
    admin: ['member'],
    member: [],
  },
  roster: { visible: ['userId', 'role', 'displayName'] },
}).visibility({ kind: 'owner', field: 'userId' });
```

Chain the profile after `membership()`. Its `name` must equal the explicitly
pinned membership `id`. The scope must be a required `v.id(resourceTable)`,
the principal a required `v.principal()`, and the role a required `v.string()`
whose active and pending values are the closed `roles`/`pendingRoles`
vocabularies. `owner` must be an active role and the exact
`bootstrapRole`/`lastHolder.protect` role. Do not author the reserved
`_membership_pk` or `_membership_reverse` indexes; membership owns their
true-unique principal/scope and resource-leading holder lookup shapes.

The hierarchy names active roles only. Codegen computes its transitive closure
and writes literal role sets into the existing membership predicate and table
visibility IR. In the example, a predicate asking for `member` admits
`member`, `admin`, and `owner`; `invited` remains pending and gains no active
role implication. The resulting `AuthorityProfileV1` references the canonical
membership-predicate and table-visibility identities and records the scope,
lattice, owner invariant, authorization-event fields, bounded indexes,
subject derivation, and conservative coarse-global wake universe.

Functions with profile-backed membership predicates, profile-backed table
visibility, or declared writes to the membership table carry that profile's
`{ id, generation }` authorization dependence. Changing the role field,
hierarchy, or transition matrix rotates the generation and dependent function
identity; unrelated functions keep their existing identity. A broadening or
incomparable visibility edit still requires LLP 0234's remotely-prior,
content-bound approval and exact-set ratchet—generation rotation records the
change but does not approve it.

<!-- since: 0.1.23 -->

The qualified local, app-table-owned profile composes with ordinary table
visibility, named handler admission, and a transition-derived generated
namespace. Every profile has the live references `api.roomAccess.list` and
`api.roomAccess.myRole`. Depending on the closed membership transitions,
codegen also emits only the supported subset of `invite`, `join`, `leave`,
`changeRole`, and `remove`. `transferOwner` is present whenever the profile has
an active non-owner role and demotes the caller to active `admin` when present,
otherwise to the first active non-owner role in declared hierarchy order, so a
`lastHolder`-protected owner cannot be stranded merely because the lattice
lacks `admin`; owner-only profiles omit it because no valid caller successor
exists. It is the only generated operation that can change an owner.

`list` takes `{ scopeId, page?: { after?, limit? } }`. It returns a bounded
page projected to exactly `roster.visible`; the normal query response carries
the next AEAD-sealed `sbpc2` cursor. The encrypted cursor keeps the private
role/principal/row boundary unreadable while binding the app, declaration,
scope, ordering, profile generation, caller authority, and active artifacts.
It cannot be moved between scopes, callers, orderings, generations, or
deployments. `myRole` takes `{ scopeId }`
and returns the caller's `{ role, status }` row. Admission happens before
cursor parsing: an outsider receives the invariant role denial and cannot use
malformed or copied cursors as an existence oracle.

Generated mutations take public scope/principal/role values and resolve any
private row identity in the host-owned transaction. They return `null` as the
handler value. Once the transaction commits, the mutation settlement includes
`authorityTransitions`: one receipt per changed subject with public
predecessor/successor role and status, subject, scope, and invalidation
disposition. `transferOwner` produces two receipts from one atomic commit.
Preview and failed/refused attempts never fabricate committed receipts.

The `generatedAuthorityOperation` marker is currently trusted as deployment
content; activation does not yet recompute it from the synthesized operation
implementation. That verification is the open
[marker-activation hardening ticket](repo:issues/20260816-generated-authority-op-marker-activation-verification.md).

The generated profile facade never projects a raw membership row or its `_id`.
That is a boundary of the generated operations, not a blanket `ctx.db` denial:
authored reads remain governed by the table's required explicit visibility
policy. Team Chat's reconciled post-LLP-0264 witness declares it on the new,
restricted `roomMembersV2` table while retaining installed v1 policy records
inert; the RBAC demo composes membership visibility from the same profile IR.

These generated references still ride the ordinary client surface, so
`useSnapbackQuery(api.roomAccess.list, { scopeId, page })` and
`useSnapbackMutation(api.roomAccess.invite)` remain valid. React also ships a
dedicated package-generic convenience layer inferred from the generated
profile object; Expo re-exports the same hooks:

```tsx fragment reason="generated authority profile names and component state vary by application"
import {
  useSnapbackAuthorityMutation,
  useSnapbackAuthorityMutationStatus,
  useSnapbackAuthorityMyRole,
  useSnapbackAuthorityRoster,
} from '@expo/snapback-react';

const roster = useSnapbackAuthorityRoster(api.roomAccess, roomId, { limit: 50 });
const myRole = useSnapbackAuthorityMyRole(api.roomAccess, roomId);
const changeRole = useSnapbackAuthorityMutation(api.roomAccess.changeRole);
const queued = useSnapbackAuthorityMutationStatus(queuedMutationId);

const loadNextPage = () => roster.loadMore();
const makeMember = async () => {
  const dispatch = await changeRole({ scopeId: roomId, principal, role: 'member' });
  if (dispatch.status === 'settled') console.log(dispatch.authorityTransitions);
};

return <Roster rows={roster.data ?? []} onLoadMore={loadNextPage} onMakeMember={makeMember} />;
```

The roster retains the LLP 0238 query-state arms and adds `cursor`, `hasMore`,
`loadingInitial`, `loadingMore`, `pageError`, `loadMore()`, and `reset()`. Calls
belong in event handlers, never render. A continuation failure leaves loaded
rows visible and appears in `pageError`; only first-page failure uses the query
error arm. The hook never parses a continuation. A scope, current-principal,
session-generation, generated-reference-generation, or live first-page publish
drops all retained pages before the next request.
`SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID` also returns
`{ status: 'reset', reason: 'cursor-invalid' }` from `loadMore()` and reacquires
page one instead of entering the query error arm. `myRole` projects the live
zero-or-one row as a nullable value while preserving the generated closed role
union.

Authority mutation dispatch follows the ordinary `settled | queued`
vocabulary. The settled arm retains `authorityTransitions`; queued work is
observed through `useSnapbackAuthorityMutationStatus`, whose `settled`
disposition carries the same receipts and whose `failed.failure.code` is the
stable refusal code. Immediate refusals reject as `SnapbackDiagnosticError`.

Composition with membership-visible search or asset sharing fails generation with
`SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_COMPOSITION_CLASS`; hosted targets fail
with `SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_TARGET`.

### Admit a named handler once

When a named query or mutation already receives the membership resource as a
nominally typed argument, attach the same declaration-bound predicate to its
definition. This is available in both the Explicit and Familiar profiles:

```js fragment reason="authority-profile handler admission over a direct resource argument"
export const messages = defineJsLiveQuery({
  auth: 'authenticated',
  args: { roomId: v.id('rooms') },
  reads: ['messages'],
  membership: [
    roomMembers.hasRole(membershipResource.arg('roomId'), 'member'),
  ],
  handler: async (ctx, args) =>
    ctx.db.query('messages').withIndex('byRoom').eq('roomId', args.roomId).take(50).collect(),
});
```

Codegen closes `member` through the profile hierarchy, adds the membership
table to the captured read set, and emits the role check before the opaque
handler. A denied row-set query or live query returns `[]`; codegen refuses
scalar/document results and `results.records(...)` contracts whose `minItems`
is greater than zero because those shapes cannot represent a blank denial. A
denied mutation is a terminal `SNAPBACK_AUTH_PERMISSION_DENIED` and cannot be
caught by handler code. Multiple predicates are an AND. Authored handlers
therefore do not call `requireRole` for this direct-argument group pattern.

The predicate must name an `authorityProfile()`, must use
`membershipResource.arg(...)` with the declaration's exact resource-id type,
and cannot use a row-field reference. Multi-hop authorization still uses the
sanctioned permission-check plus bounded `ctx.db.elevated` sequence described
in [Protecting live and retained data](./protecting-data.md).

## Gate a query with the declaration

Use helpers on the exported membership table, never a global role string.
`memberOf()` admits any non-pending role; `hasRole(resource, ...roles)` admits
only the named roles, including a pending role when explicitly named.

When table visibility already references the profile, an ordinary query needs
only its resource filter; codegen composes the membership semi-join from the
same profile IR:

```js source=demos/rbac/snapback/functions.mjs
export const listAnnouncements = defineLiveQuery({
  auth: 'authenticated',
  table: 'announcements',
  args: { appId: v.id('applications') },
  filter: [eq('appId', arg('appId'))],
  order: [asc('_createdAt')],
});
```

For resource scope, pass exactly one of
`membershipResource.arg('eventId')` or
`membershipResource.rowField('eventId')`. The predicate is an authoritative
membership semi-join, not an optimistic client expression. It records an
ordinary captured database dependency even when no membership row exists, so
joining can wake a previously empty live result.

That dependency also means a membership-filtered query cannot declare
`authorityIndependent: true`. Codegen rejects the combination before writing
artifacts; public routing does not make a roster-dependent result invariant
across principals.

Membership tables are private authorization backing in v1. There is no
application-returning `ctx.permissions.*.get()` and a normal query cannot use
the roster as an existence oracle.

### Build a per-user resource feed

For a home screen such as “my events,” prefer table visibility on the resource
itself when active members should see the resource rows:

```js fragment reason="resource and membership fields vary by application"
events: defineTable({ title: v.string() }).visibility({
  kind: 'membership',
  declaration: eventMembers,
  resourceField: '_id',
  roles: ['host', 'cohost', 'guest'],
}),
```

The `_id` spelling belongs to table `.visibility(...)`; it is still not a
valid `membershipResource.rowField('_id')` query operand. Ordinary direct/live
plans and ordinary handler `ctx.db` reads compose the table policy, so the
resource table can now be the active-member feed without exposing the private
roster.

Keep a separate ordinary app-data feed row when the UI must also represent
pending invitations, non-member discovery, or a denormalized card shape that
is intentionally different from the protected resource. Key that row by both
the resource id and user id, copy only the display fields the card needs, and
query it by the server-derived `authUserId()`.

Shindig uses this shape for its `invites` table. The same row represents the
host's own feed entry, a pending invitation, or an RSVP, while the private
`eventMembers` table remains the authority source:

```js source=demos/shindig/snapback/functions.mjs
export const myFeed = defineLiveQuery({
  table: 'invites',
  args: {},
  filter: [eq('userId', authUserId())],
  order: [asc('eventStartsAt')],
  index: 'by_user',
});
```

Create or update the feed row in the same mutation workflow that changes the
product-visible invitation or membership state. Ordinary `ctx.db` writes may
accompany the mutation's one generated membership command, so the feed and
authority transition can commit atomically. Treat the copied fields as a
maintained projection for presentation, never as an authorization decision;
all protected reads still use the membership declaration.

## Check a role inside a transaction

For a direct resource argument, prefer named handler admission. Codegen emits
the terminal role prelude from the profile's closed lattice before app code:

```js source=demos/rbac/snapback/functions.mjs
export const postAnnouncement = defineJsMutation({
  auth: 'authenticated',
  args: { appId: v.id('applications'), message: v.string() },
  source: 'handlers.mjs',
  exportName: 'postAnnouncement',
  membership: [appMembers.hasRole(membershipResource.arg('appId'), 'member')],
  writes: ['announcements'],
  result: results.value(v.id('announcements')),
});
```

A failed check is always `SNAPBACK_AUTH_PERMISSION_DENIED` with invariant
public details `{ kind: 'role' }`. It reveals neither whether the resource nor
membership exists. The denial is host-owned and remains terminal even if app
JavaScript catches the thrown error. Multi-hop cases may still call
`ctx.permissions.<declaration>.requireRole(resource, ...roles)` inside a query
or mutation transaction. Actions have no transactional read set, so
`ctx.permissions` is deliberately unavailable there.

## Choose between filtering and denying

The two gates above give an outsider **different observable outcomes**, and
the choice is a product decision, not an implementation detail:

| Idiom | Outsider sees | Use when |
| --- | --- | --- |
| Declarative `membership:` on a query (see [Gate a query with the declaration](#gate-a-query-with-the-declaration)) | an empty result, indistinguishable from "nothing here yet" | the surface is a list or feed that should simply be empty for non-members |
| `ctx.permissions.<declaration>.requireRole(...)` in a handler | `SNAPBACK_AUTH_PERMISSION_DENIED` | the caller is acting on a specific resource and a silent no-op would be a lie |

Neither discloses data: the declarative filter never returns rows the caller
may not see, and the denial carries invariant public details. What differs is
what a probing outsider can *confirm* — a denial confirms the operation
exists and was refused, an empty result confirms nothing — and what the UI
must do: an empty list renders naturally, whereas a swallowed denial on a
write path silently loses the user's work.

Pick per surface, and be deliberate when converting one to the other: moving
a read from a declarative query into a handler that calls `requireRole`
changes the outsider contract even though both are secure.

## Change membership through generated methods

Only mutation handlers receive `ctx.membership`. Its `insert`, id-addressed
`setRole`/`remove`/`patch`, and self-addressed
`setSelfRole`/`removeSelf`/`patchSelf` methods submit a host-owned command
evaluated against the declaration:

```js fragment reason="base membership declaration and product fields vary by application"
await ctx.membership.roomMembers.insert({
  roomId: args.roomId,
  userId: ctx.auth.userId,
  role: 'member',
});
```

App code does not need the private roster row id for its own transitions. App
scope omits the resource argument; resource scope passes its branded resource
id:

```js fragment reason="base membership declaration and resource names vary by application"
await ctx.membership.roomMembers.setSelfRole(args.roomId, 'member');
await ctx.membership.roomMembers.removeSelf(args.roomId);
```

The host resolves only the effective principal's row, returns no id, and then
runs the same declared transition matrix. A missing own row is
`SNAPBACK_MEMBERSHIP_SELF_NOT_FOUND`; no helper reveals whether anyone else has
a row. The base id-addressed forms are not an administrator authoring path for
the private v1 roster; only a trusted migration/import context can already hold
such an id. For a profiled roster, use the generated principal-addressed
`changeRole` and `remove` references described above—the host resolves the row
privately and the same transition planner remains authoritative.

Generic `ctx.db` and HostPlan writes to a membership table fail with
`SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED`; handler convention is not the security
boundary. Mark any function that can create durable authority with
`authorityCreating: true`. That marker becomes part of delegated-agent consent
and requires full membership provenance.

A resource declaration with `bootstrapRole` also gets
`ctx.membership.<declaration>.bootstrap(resourceValues, initialMembers?)`. It
returns the fresh, branded resource id and atomically inserts the resource and a
membership that seats the server-derived effective principal in the bootstrap
role. The optional list creates up to 64 additional seats in that same commit.
Omit the resource field from each list item; the host injects the fresh id. A
`lastHolder` declaration relies on this path: creating the protected resource
without its initial eligible holder is refused.

```js fragment reason="atomic resource and initial membership roster creation"
const conversationId = await ctx.membership.conversationMembers.bootstrap(
  { title: args.title },
  args.invitees.map((userId) => ({ userId, role: 'member' })),
);
```

The creator seat is not caller-selectable. Every additional principal must be
unique, differ from the creator, use a declared role, and match an ordinary
`insert` transition with the creator's bootstrap role as caller and the new
seat as `other`. The host checks every row before committing. One unauthorized
role, duplicate principal, ineligible protected holder, uncovered field, or
65th initial member refuses the entire resource and roster; nothing commits.
Seats in the list never authorize later seats in the same list.
Malformed or over-limit lists report
`SNAPBACK_MEMBERSHIP_BOOTSTRAP_INITIAL_MEMBERS_INVALID`; a repeated creator or
member reports `SNAPBACK_MEMBERSHIP_BOOTSTRAP_DUPLICATE_PRINCIPAL`; supplying
the host-bound resource field reports
`SNAPBACK_MEMBERSHIP_BOOTSTRAP_RESOURCE_UNEXPECTED`. Transition and vocabulary
failures retain their ordinary membership refusal codes.

A JavaScript mutation dedicated to creator-only bootstrap may set
`authorityCreating: false` even though its declared writes include the resource
and membership tables. Without an initial roster bootstrap cannot name a
different principal, so a delegated agent seats its effective user rather than
itself. Supplying any initial member names another principal and requires
`authorityCreating: true`; generation derives that marker and an author cannot
clear it. The runtime still rejects every ordinary membership operation from an
unconsented wrapper.

The generated TypeScript surface brands principals and resource ids, emits
closed role unions and insert/patch values, exposes `GeneratedPermissions` to
queries and mutations, and exposes `GeneratedMembership` only to mutations.
For authority profiles it additionally types the nested operation references,
projected `ctx.authority.<profile>.list`/`myRole` reads, profile mutation
helpers, and durable `AuthorityTransitionReceiptV1` settlements.

### One generated membership command per mutation

V1 admits exactly one generated membership command in a mutation. A single
`bootstrap()` counts as that command even when the host atomically creates the
resource, creator seat, and a bounded transition-checked initial roster.
Calling another
`bootstrap()`, `insert()`, `setRole()`, self-addressed transition, or other
generated membership method in the same handler fails the whole mutation with
`SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED`; none of its buffered writes commit.

Ordinary `ctx.db` writes may accompany that one command. Use the optional
initial roster when creating one group and all initial seats must be atomic. A
setup flow that creates several membership-backed resources still uses
separately authorized mutations with application-visible setup state or stable
business keys for idempotence. Do not catch the batch refusal and pretend an
earlier command committed.

## Remove another principal with `removePrincipal` (explicit opt-in)

Principal-addressed removal (LLP 0100) is the one other-targeted membership
write reachable from app code, and it is closed by default. A declaration
opts in explicitly, and activation requires at least one **total**
other-principal removal transition — `from` omitted, so the transition
covers every declared and pending target role (per-role coverage would let
removal success/refusal read back a hidden role):

```js fragment reason="authoring shape; runtime witnesses live in tests/membership_principal_addressed_v0.rs"
.membership({
  // existing fields...
  principalAddressedWrites: { remove: true },
  transitions: [
    // Total: `from` omitted covers every declared and pending role.
    { op: 'remove', by: ['owner'], target: 'other' },
  ],
})
```

Generation refuses `remove: false`, unknown option fields, a declaration
with only partial (`from`-bearing) other-removes, pending or `none` carrier
caller classes, and — under `lastHolder` — any carrier caller class other
than the protected role (an admitted caller is then itself a protected
holder, so removing the target can never empty the protected set; the
commit-stage `lastHolder` check still runs but cannot become an oracle).

The generated command takes the public address, never a roster id:

```js fragment reason="handler shape; the same call is exercised end to end by tests/membership_principal_addressed_v0.rs"
async ownerRemove(ctx, args) {
  const result = await ctx.membership.roomMembers.removePrincipal(
    args.roomId, args.targetPrincipal);
  // Companion writes commit on BOTH branches — see the obligation below.
  await ctx.db.insert('auditTrail', { roomId: args.roomId, kind: 'kick' });
  return result; // always null
}
```

What the command discloses is deliberately narrow:

- The result is **always `null`** — present target removed or absent pair
  proved, byte-identically. It never returns `removed`, `missing`, a role,
  a row id, or a count. A well-formed principal that names no user takes
  the absent branch: argument validation is shape-only.
- An unauthorized caller gets the invariant
  `SNAPBACK_MEMBERSHIP_TRANSITION_DENIED` **before any target lookup**, and
  the denial is identical whether the target exists or not.
- Targeting yourself is the typed misuse
  `SNAPBACK_MEMBERSHIP_TARGET_SELF`; self-removal remains `removeSelf`.
- The one accepted observable for **authorized** callers: a present-target
  removal is an authorization event (the global version advances; the
  removed member's protected queries blank and their
  `_snapback.myMemberships` seat drops at that cut), while the absent
  no-op advances nothing.

**Companion writes must be branch-insensitive.** The mutation's ordinary
`ctx.db` writes commit on both the present and the absent branch — the
application cannot observe which branch ran. A companion write that
decrements a member count or appends a "removed" feed event on the
assumption the target was present corrupts product state on the no-op.
Write companions that are correct in both branches (an attempt log, an
idempotent display patch), or derive display state from a query instead.

## Keep the authorization composition seams aligned

An authorized live effect is valid only while all of these captured facts
still describe the same operation:

- **coordinator epoch** — which authenticated authority generation owns the client;
- **queue generation** — which durable outbox generation may replay;
- **artifact identity** — the schema/function bundle whose declarations were checked;
- **principal scope** — effective user or scoped service-principal tuple;
- **descriptor** — the exact query/mutation plus args and authorization dependence;
- **query lease** — the live subscription generation allowed to receive rows.

Treat the set as one composition boundary. A principal/token/grant transition
must close or blank the old query lease before a successor publishes; queued
work must compare both its authority capture and store generation; generated
descriptors must match the active artifact hashes. The Contract adapter and
packaged client perform these comparisons. App code should not cache a roster
answer, splice a new bearer into an old client, or reuse a live handle across a
coordinator transition.

## Anti-patterns

- **Do not store roles in session claims.** Membership rows are the current
  authority; copying them creates stale credentials.
- **Do not accept a plain string where `v.id(table)` is required.** Preserve
  the nominal resource binding through arguments and row fields.
- **Do not query or sync the roster to make an authorization decision.** Use a
  declaration-bound predicate or `ctx.permissions.requireRole`.
- **Do not use the private roster as a “my resources” feed.** Put membership
  visibility on the resource table with `resourceField: '_id'`; maintain a
  separate per-user app-data feed only when the product needs pending or
  denormalized rows that are not the protected resource itself.
- **Do not design administrator promotion/removal around private membership
  row ids.** V1 intentionally does not make those ids reachable. Use the
  transition-derived authority-profile operations when the declaration admits
  them; otherwise use app-data invitations plus a self transition or choose a
  flow that does not require administrator mutation of a private seat.
- **Do not create an app-data roster-id mirror just to leave or accept.** Use
  the declaration's self-addressed write methods.
- **Do not write membership rows through `ctx.db` or a generic HostPlan.** Use
  mutation-only generated membership methods and declare every transition.
- **Do not issue multiple generated membership commands in one mutation.** V1
  permits one. For one new resource, pass a bounded initial roster to
  `bootstrap(resourceValues, initialMembers?)`; for multiple resources or
  post-creation transitions, use idempotent separately authorized mutations.
- **Do not create a `lastHolder`-protected resource with `ctx.db.insert`.** Use
  the declaration's atomic `bootstrap()` method.
- **Do not use `ctx.permissions` in an action or retain a role-gated result
  offline.** Neither has the transactional/lease proof required by v1.
- **Do not mirror a profiled membership into a second product roster.** The
  app-owned membership table is both product roster and authority relation.
- **Do not infer unsupported operations from `authorityProfile()`.** A missing
  membership transition means the corresponding mutation reference is absent,
  not a runtime no-op. Search sharing, asset sharing, hosted profiles, and
  protected offline retention are still outside this surface.

---

<!-- snapback-guide-source: guide/auth/agent-principals.md -->
---
title: Agent principals and scoped grants
id: auth.agent-principals
order: 6
audience: agent-first
capabilities: [auth.agent-principals, auth.agent-registration]
authorities: [llp/0055-agent-principals-and-scoped-grants.rfc.md, packages/snapback-client/agent-authority.mjs, packages/snapback-app-cli/auth.mjs, packages/snapback-app-cli/package.test.mjs, packages/snapback-app-cli/auth.test.mjs, src/server.rs]
examples: [packages/snapback-app-cli/package.test.mjs, packages/snapback-app-cli/auth.test.mjs, demos/_kit/tests/auth-handshake.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:4b8a139980b6dd9eaa3f142ff8a2ac66e6c116ddb3bd92c13383ad1ba4f4af54
---

# Agent principals and scoped grants

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./targets.md).

An agent is a service principal with its own credential. It does not borrow a
human session bearer. A grant gives that principal a closed set of function
scopes, and each short-lived scoped token names the agent credential,
credential generation, grant, and token carrier. The server still applies
ordinary auth requirements, row scoping, and
[roles](./scoped-roles.md); a token never bypasses those gates.

## Register an agent

Registration is an explicit sessions-mode schema policy. Omission is
`disabled`; an app must choose `open` or `invited`:

```js fragment reason="show the closed nested policy without coupling this page to an app schema"
auth: {
  mode: 'sessions',
  agents: { mode: 'open' },
}
```

With `open`, call `POST /auth/agents/register` without an Authorization header.
The closed body accepts optional `displayName` and `operatorContact`. The
response returns `{ credentialId, userId, generation, credential }`; generation
is `1` and `credential` is the initial `sbac_` secret. Principal, stable
identity, and credential are committed atomically. The secret is returned once,
so move it directly into credential custody and never put it in source, logs,
generated artifacts, or model output.

```sh
curl -X POST "$SNAPBACK_URL/auth/agents/register" \
  -H 'content-type: application/json' \
  -H 'x-snapback-auth-client-protocol: 1' \
  --data '{"displayName":"Build agent"}'
```

With `invitedBy: 'users'`, a signed-in human first requests an
`agentInvitation` step-up challenge through `POST /auth/step-up/request`, then
submits that proof to `POST /auth/agent-invitations`. The returned `sbagi_`
creation invitation is single-use. Pass it as `invitation` to
`POST /auth/agents/register`; registration consumes it in the same transaction
and records the minting user as the agent owner. A bearer alone cannot mint an
invitation, and the user has at most ten live unconsumed invitations.

`invitedBy: 'operators'` remains declarable so policy is forward-compatible,
but S0 has no host-operation minting twin and codegen emits
`SNAPBACK_AUTH_AGENT_ONBOARDING_PROD_UNAVAILABLE`. Also still absent are the
registration template, agent listing/deletion, owner-issued replacement
credentials, recovery, approval-link ceremony, OAuth facade, and `/api/v1/*`
exposure. Self-service rotation and revocation remain available after an agent
has registered. The app CLI consumes an existing `sbac_` credential and does
not call registration for you.

## Pair a registered agent

Pairing delegates a user's authority without letting the agent name or
enumerate users:

1. A signed-in user calls `POST /auth/pairing-codes` and conveys the short-lived
   code out of band.
2. The agent calls `POST /auth/agents/pair` with `credential`,
   `pairingRequestId`, `pairingCode`, and the exact `requestedScopes`.
3. The user inspects `GET /auth/grant-requests` and approves or denies the
   pending request. Approval displays the agent, provenance, scopes, expiry,
   and owner-assumption disclosure.
4. The agent polls `POST /auth/agents/token` with its credential and
   `pairingRequestId`. `SNAPBACK_AUTH_GRANT_PENDING` means wait; the
   non-enumerating `SNAPBACK_AUTH_GRANT_INVALID` means stop.

The token response contains `tokenId`, `grantId`, server-resolved
`actorUserId`/`effectiveUserId`, `credentialId`, `credentialGeneration`,
absolute expiry, server-relative `expiresInMs`, canonical scopes, and the
bearer. Schedule from `expiresInMs`; do not compare a client clock with the
server's absolute timestamp. Re-polling an approved request rotates the first
token; it does not retrieve old plaintext.

## Choose scopes deliberately

An explicit function scope binds a stable function id, kind, manifest basis,
and whether the function can create authority. A tier scope such as
`{ tier: "query" }` follows the current manifest and therefore includes later
queries. Prefer explicit function scopes when deployment must not silently
expand reach. `authorityCreating` operations never join a tier implicitly.

Delegated grants expire, at most 90 days. Renewal is a new consent. Autonomous
grants come only from the app's registration template on production-like
postures; the local operator mint exists for development and testing, not as a
production escape hatch.

## Fence token custody before doing work

Construct `AgentAuthorityFence` from the token response plus the registered
agent actor id, then pass it to `SnapbackClient` as `agentAuthority`. The client
probes `/auth/session`, verifies the exact service-principal descriptor, and
only publishes results while the captured credential-generation/grant/token
carrier is still current. Use filesystem custody for a long-running Node agent;
use the volatile fence only for a bounded process.

Never return or serialize the bearer as an operation result. Rotation uses
`replaceAgentCredential(...)`; revocation or terminal auth loss synchronously
cuts publication and either retires the carrier or deletes the durable grant
tuple according to the server's classified disposition.

For a bounded command, call `POST /auth/agents/token/release` with the exact
scoped token in its closed body when work settles. It returns an empty 204,
accepts an already-released retained token for lost-response retry, and ends
only that carrier. It never accepts an Authorization header. This release is
not durable grant revocation.

The app CLI's version-1 profile stores the target/app/grant and complete
durable authority tuple plus an absolute credential file reference or named
environment reference. It stores neither the durable credential nor a scoped
token. The CLI re-attests the token receipt against that tuple on every mint,
uses the target-advertised per-grant cap for cross-process admission, and
reserves two cap slots for watch/renewal. Agent credential transport is
literal-loopback-only and non-redirecting.

## Revoke and verify

An agent can use `/auth/agents/revoke-self` and `/auth/agents/rotate` for its own
credential lifecycle. A signed-in grantor manages grants through
`/auth/grants`; operator-only lifecycle actions stay on the host-operations
plane. After a mutation, verify through a query or live snapshot under the same
fenced authority. The packaged acceptance witness in
`packages/snapback-app-cli/package.test.mjs` exercises discovery, pairing,
scoped custody, mutation, subscription, and verification without exposing the
token in its returned result.

## Anti-patterns

- Do not put an admin token into an app agent; host operations and app data are
  separate authority planes.
- Do not let an agent choose an effective user id in a request body.
- Do not treat a tier grant as deployment-pinned.
- Do not persist bearer plaintext in the durable custody ledger or print it in
  diagnostics.
- Do not use `expiresAtMs` and a local wall clock as renewal authority; use the
  server-relative lifetime.
- Do not treat exact token release as grant revocation.
- Do not retry `SNAPBACK_AUTH_GRANT_INVALID` as if it were pending.

---

<!-- snapback-guide-source: guide/auth/logical-transfer.md -->
---
title: Move auth identities without moving authority
id: auth.logical-transfer
order: 7
audience: agent-first
capabilities: [auth.logical-transfer]
authorities: [llp/0055-agent-principals-and-scoped-grants.rfc.md, llp/0057-auth-provider-protocol.spec.md, src/auth/logical_transfer.rs, src/storage/auth_logical_transfer.rs, src/cli.rs, schemas/auth.logical-export.v1.schema.json]
examples: [src/storage/auth_logical_transfer.rs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-11
reviewed-authorities-digest: sha256:177cfb52b773143139cf8fa071c37532617458dbdf2dded321ac76a74b4d4da8
---

# Move auth identities without moving authority

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./targets.md).

These CLI verbs are **contributor-source** today: they exist in the source
`snapback` binary and are not yet part of a published `@expo/snapback-*`
closure. Build from source to use them.

Use logical auth transfer when another store should recognize the same human
and agent principals but must not inherit their ability to act. It is an
identity-and-recovery transfer, not a backup. For a byte-faithful store copy or
disaster recovery, use [back up, copy, and move a store](../operating/backup-and-copy.md).

## Export stable identity facts

Stop the source server, then write a new artifact:

```sh
snapback auth export \
  --db .snapback/source.sqlite3 \
  --output auth-logical.json
```

The command requires an exact auth catalog (version 2, 3, or 4), takes the database
instance lock, reads one SQLite snapshot, and refuses to overwrite an existing
output path. Fresh catalogs use version 4; exact version-2 and version-3 catalogs
remain supported without migration. The format is
`snapback.auth-logical-export.v1`, and its `authCatalogVersion` records the
source version. Version 4 additionally records its immutable
`passwordIdentifierMode`; import refuses a target with a contradictory mode.
Every row set is deterministically sorted and validated against the generated
`schemas/auth.logical-export.v1.schema.json` shape.

Format 1 can reconstruct the current email-code, local-password, and
agent-credential identity descriptors exactly. Export refuses disabled links
or any other v3 descriptor rather than guessing at kind, issuer, canonical
value, or enabled state; import applies the same fail-closed mapping rule for a
v3 target.

The artifact includes:

| Included fact | Why it travels |
| --- | --- |
| Human and agent user ids and creation times | Preserve stable principal identity. |
| Principal kind, display name, and operator contact | Preserve the agent's presentation. |
| Registration provenance | Preserve how the agent originated after invitations are gone. |
| Deactivation timestamp | A disabled agent stays disabled. |
| Owner user id | Preserve the owned-agent recovery relationship. |
| Identities, provider, canonical subject, and verification time | Preserve stable provider and agent-credential identity facts. |
| Every `_auth_scope_bases` tombstone | Prevent removed-and-readded function scopes from reviving old consent. |

It has no representable field for any spendable, secret, or consent-pending
authority. In particular, it excludes:

- sessions and session-token tombstones;
- verification challenges, digests, and the capture mailbox;
- credential hashes and credential generations;
- password-attempt and lockout state;
- grants, scoped-token hashes, and durable grant carriers;
- creation or recovery invitations and pairing requests;
- auth keyring bytes, integration/OAuth carrier state, rehearsal authority,
  and sender-proof replay state.

Treat the artifact as private identity data even though it cannot authenticate
a caller: canonical addresses, display names, operator contacts, and
registration provenance can still be sensitive.

## Import into a fresh auth catalog

Prepare the destination through the same app's normal sessions-mode activation,
so its database already contains an exact auth catalog but no principal or
credential rows. Fresh destinations use version 4; exact version-2 and
version-3 destinations remain supported without migration. Activation may
already have seeded the app's `_auth_scope_bases`; import accepts those schema
facts only when every seeded row exactly matches the incoming artifact. Stop
that server, then import:

```sh
snapback auth import \
  --from auth-logical.json \
  --db .snapback/destination.sqlite3
```

Import rejects malformed JSON, missing or unknown fields, unsupported format
or catalog versions, unsorted or duplicate ids, identity collisions,
non-canonical email subjects, orphan ownership/identity rows, and any target
that already contains auth-catalog, auth-retry/throttle/rehearsal,
integration/OAuth, or sender-proof carrier rows. It never merges.

All user, identity, ownership, deactivation, and scope-basis rows commit in one
transaction. That transaction also changes the destination authorization
incarnation and clears retained authorization retry state plus every authorized
lease reservation. A refusal or crash before commit leaves the destination
unchanged.

The result reports imported and owned/unowned/deactivated counts and explicitly
reports zero minted sessions, credentials, and grants. The source
authorization incarnation is not imported.

## Recover deliberately after import

Import preserves `ownerUserId`, so an owned agent retains the metadata needed
for owner-authorized re-credentialing on every profile. Import itself never
mints that replacement. The current contributor surface still lacks the
owner-issued replacement-credential command described on
[agent principals](./agent-principals.md), so do not mistake preserved recovery
eligibility for an immediately usable credential.

An unowned imported agent has no production recovery carrier and therefore
lands dormant on `prod`. Development/test/demo may use the separately gated
operator recovery surface when that carrier is available; production must not
turn import into operator impersonation. A deactivated agent remains
ineligible everywhere.

## Anti-patterns

- Do not call logical transfer a backup: it intentionally cannot preserve a
  working login, session, credential, grant, or keyring.
- Do not copy credential or token tables alongside the artifact to “help” an
  imported agent reconnect; that defeats the no-resurrection boundary.
- Do not import into a catalog with even one existing principal or retained
  auth carrier. Choose a fresh target instead of inventing merge semantics.
- Do not delete `_auth_scope_bases` from the artifact. Tombstones are what keep
  old consent dead when a function id returns.
- Do not reactivate a deactivated imported agent merely because its identity
  transferred successfully.

---

<!-- snapback-guide-source: guide/auth/targets.md -->
---
title: Targets — what each one claims
id: auth.targets
order: 7
audience: agent-first
capabilities: [auth.target-honesty, auth.sender-constrained-browser]
authorities: [llp/0060-hosted-auth-security.rfc.md, llp/0072-trusted-single-tenant-control-plane.rfc.md, llp/0077-sender-constrained-browser-auth.spec.md, llp/0002-canonical-local-target.decision.md, llp/0014-cloudflare-strategy.rfc.md, llp/0262-dev-identity-custody-capability.rfc.md, src/admin.rs, src/cli.rs, src/dev_identity.rs, src/host_ops_contract.rs, src/server.rs, packages/snapback-vite/lifecycle.mjs, packages/snapback-vite/proxy.mjs, packages/snapback-client/hosted-browser.mjs, README.md]
examples: [packages/snapback-client/hosted-browser.test.mjs, packages/snapback-client/sender-transport.test.mjs, tests/sender_proof_cross_language.rs]
status: current
targets: [all]
maturity: partial
reviewed: 2026-08-16
reviewed-authorities-digest: sha256:f98678eb61296e546f6705fc3d9fa99ede1c16217906a95ccd8ca5a66708d741
---

# Targets — what each one claims

Snapback is deliberately honest about which guarantees belong to which
execution target. Guide pages carry `targets:` frontmatter for exactly this
reason; this page is the map those banners point to.

## Local (Ibex + SQLite) — the canonical dev/test target

The full local server (LLP 0002) is where every guide technique on a
`targets: [local]` page holds: server-authoritative mutations with one
commit version and read-set validation, live queries over the durable lane,
ephemeral realtime, and local sessions-mode auth with server-derived
principals, connection-bound live grants, auth-invalidation barriers, and
signed authorized-lease offline retention. The systematic local contract is
[protecting live and retained data](./protecting-data.md).

**What the local target deliberately does NOT claim** (LLP 0060; the
README's must-not-claim posture): these are local-target guarantees, not
hosted-auth readiness. The local target reports no target-owned external
TLS, no trusted effective-source derivation, no shared authentication
throttle, no multi-replica invalidation, and no sender-constrained browser
credential. Hosted auth is honestly **disabled** on the local bearer
target rather than half-claimed.

### A public tunnel does not make the loopback server production-ready

Profile derivation sees the server's actual bind address, not the URL that a
reverse proxy advertises. A server listening on `127.0.0.1` remains in the
development profile when ngrok, Cloudflare Tunnel, Tailscale Funnel, SSH, or
another proxy exposes it publicly. The tunnel does not add trusted effective
source derivation, TLS ownership, shared throttling, or hosted credential
custody, and Snapback cannot infer those properties from forwarded headers.

Setting `SNAPBACK_PROFILE=prod` is not a repair. The explicit production
profile fails closed when the hosted prerequisites are absent and may refuse
the local-only provisioning and impersonation operations the app needs. Treat
a tunnelled loopback server as an unsupported public exposure: use it only in
a controlled development context, never as a production deployment recipe.

Client-asserted dev identity now has a separate per-boot `sbdev_` custody
capability ([LLP 0262 D1](repo:llp/0262-dev-identity-custody-capability.rfc.md#d1-the-dev-identity-capability)).
The mint follows the admin-token anchor ladder: `<db>.dev-identity` for a
file-backed database, otherwise `<ready-file>.dev-identity`, otherwise a
per-process value disclosed once on the operator TTY. A file is overwritten
each boot, unlinked on clean shutdown, and advertised as
`devIdentityCapabilityFile`; production never mints and refuses startup when
its resolved sidecar is present. Direct clients present the value in
`x-snapback-dev-identity` (never `Authorization`), while the managed Vite relay
stamps it server-side so browser code never sees the bearer. This is rollout
stage 1: a presented malformed or mismatched capability is refused with the
generic `SNAPBACK_DEV_IDENTITY_REFUSED`, but an absent capability is still
accepted and produces only the first capability-less-dev-assertion warning of
that boot. Enforcement waits for LLP 0262 D5's acceptance witness across every
supported carrier; the current stage does not make a tunnel a supported public
deployment.

Declare reachability with the closed
`SNAPBACK_EXPOSURE={fronted,direct}` vocabulary. Empty or unset is unset;
`direct` is behaviorally identical to unset. `fronted` with an
unset `SNAPBACK_PROFILE` selects full production semantics, so no dev
capability is minted and dev identity is unavailable. `fronted` with an
explicit non-production profile retains that profile and capability but prints
the exposure warning; production remains production. Any other nonempty value
fails closed as `fronted` and prints one startup warning naming the value. For
the [LLP 0036 SSH-tunnel posture](repo:llp/0036-app-secrets-and-config.rfc.md),
declare `fronted` and use credentialed surfaces. A credential-holding dev host
fronted in turn (for example tunneled Vite) can still stamp for strangers; LLP
0262 records that residual rather than treating the capability as public-front
authentication. `--allow-insecure-dev-auth` still means only dev auth over a
plaintext non-loopback bind; it neither declares a front nor substitutes for
the capability.

## Cloudflare — the hosted proof, as far as it is real

The Cloudflare target (LLP 0014/0040/0049) is a working proof — the All
Aboard demo runs live on it with Durable Objects storage, deploy-time
secrets, gated action egress, and settled idle-to-zero evidence. It is a
narrow proof, not a paved product target: treat any technique on a page
without `cloudflare` in its `targets:` as unverified there, and treat
hosted auth as absent until LLP 0060's contract is implemented and
witnessed. Deployment, secret, egress, hibernation, and non-claim details are
in [deploying the Cloudflare proof](../deploying/cloudflare.md).

## Single-instance container/VM — selected, not yet available

LLP 0072 selects `single-instance-container-vm.v1` as the first target that
must satisfy the complete trusted single-tenant profile. The target-neutral
release, plan, lifecycle, backup, rollback, restore, log, inspection, and audit
contracts exist and pass a deterministic non-remote driver. No provider,
account, region, public origin, remote storage, or external audit sink has yet
passed the qualification drill. Therefore the profile is **partial** and no
server may report `trusted-single-tenant-app-complete.v1`.

The package contains a future hosted app-browser entrypoint:
`HostedBrowserSnapbackClient` from
`@expo/snapback-client/hosted-browser`. Its constructor requires coordinator-owned
custody, accepts only HTTPS, and exposes no bearer, admin-token, or
agent-authority option. The implementation generates a non-extractable P-256
key, binds issuance and refresh to it, signs protected HTTP and WebSocket
requests, rotates server nonces, and rejects replay. Sender sessions and grants
use legacy-rejecting v2 syntax; unknown carriers receive keyed stateless cover
nonces; a bounded key-bound tombstone recovers a committed logout whose
response was lost; and the socket queue releases only after the first
in-band successor-nonce frame. Cross-language, pre-body, custody-recovery,
challenge-retry, refresh, grant-route-matrix, and real WebSocket tests exercise
those facts.

This is implementation evidence, not an authoring technique on a live target.
Do not use the generic `SnapbackClient` direct-bearer constructor as a
production-browser substitute. A concrete adapter must first authenticate the
public origin and admission producer, pass the complete negative/pressure
matrix, produce the monotone replay-epoch floor outside the application backup
set, and execute the remote LLP 0072/0077 drill.

## How to check instead of trusting prose

A running server states its own capabilities: `GET /inspect` carries the
capability manifest with runtime facts including `authProgramReadiness`
and the active auth mode. When a page's claim and a server's report
disagree, the server is right and the page has drifted — file a guide gap
(see [conventions](../conventions.md)).

## Anti-patterns

- **Do not generalize a local guarantee into a hosted claim.** The gap is
  the product's honesty boundary, and this guide inherits it mechanically.
- **Do not ship a browser bearer credential to real users on the local
  target and call it auth.** That configuration exists for local
  development; LLP 0060 documents why it must not be marketed as more.
