---
title: Sessions and principals
id: auth.sessions-and-principals
order: 1
audience: agent-first
capabilities: [auth.sessions, auth.browser-session-custody, auth.scoped-queries]
authorities: [llp/0039-auth-vertical-slice.rfc.md, llp/0057-auth-provider-protocol.spec.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0151-first-party-identity-integrations.rfc.md, llp/0172-explicit-function-authorization.rfc.md, packages/snapback-codegen/index.mjs, src/admin.rs, src/auth/mode.rs, src/auth/provider.rs, src/host_ops.rs, src/server.rs, src/cli.rs, packages/snapback-cli/expo-dev.mjs, packages/snapback-client/index.mjs, packages/snapback-client/index.d.mts, packages/snapback-client/auth-identity-types.fixture.ts, packages/snapback-client/unrecognized-authority-recovery.test.mjs, packages/snapback-contract/index.mjs, demos/_kit/as-user.mjs, demos/_kit/server-process.mjs, demos/browser-auth/surfaces/web/main.mjs, demos/browser-auth/tests/acceptance/browser-auth.mjs, demos/card-game/snapback/functions.mjs, demos/card-game/tests/acceptance/authority-scope.mjs]
examples: [demos/browser-auth, demos/card-game, demos/party-wall, packages/snapback-client/auth-identity-types.fixture.ts]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-12
reviewed-authorities-digest: sha256:189be9d1f43cb5a1c125e943a28c129db1294d9ad11d46f7f38bffa43c6e2d8d
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
