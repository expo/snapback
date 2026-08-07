---
title: Sessions and principals
id: auth.sessions-and-principals
order: 1
audience: agent-first
capabilities: [auth.sessions, auth.scoped-queries]
authorities: [llp/0039-auth-vertical-slice.rfc.md, llp/0057-auth-provider-protocol.spec.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0172-explicit-function-authorization.rfc.md, packages/snapback-codegen/index.mjs, src/auth/mode.rs, packages/snapback-client/index.mjs, demos/card-game/snapback/functions.mjs, demos/card-game/tests/acceptance/authority-scope.mjs]
examples: [demos/card-game]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-03
reviewed-commit: c442237dedd412d1fe66a85c7a0ed463eba1e013
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

The client requests a code and exchanges it. In tests, the code is read
from the server's admin-gated mailbox:

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
  const requested = await client.authRequestCode(email);
```

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
  const credential = await client.authExchange({
    challengeId: requested.challengeId,
    code: mailbox.code,
  });
```

From then on the client carries the session credential; `AuthCoordinator`
(from `@expo/snapback-contract`) owns custody, refresh, and the logout barrier
for surface-based clients.

The shipped provider has no production mail adapter yet. For a local native
app whose identity front door lives in trusted server code, use the sanctioned
[external identity-broker seam](./native-apps.md): the broker invokes the
gated non-production session-mint host operation and the first-party client
adopts the resulting bearer with exact protocol offers. Neither path is a
hosted-production auth claim.

## Mint test personas: the complete local recipe

A sessions-mode acceptance suite needs two or more genuine principals. The
mailbox above is admin-gated **and** impersonation-gated; both carriers are
required, and both are local-only. The complete loop — client construction,
code request, mailbox read, exchange — is:

```js source=demos/party-wall/tests/acceptance/headless.mjs
    const client = new SnapbackClient(server.baseUrl, {
      authCoordinator: coordinator,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      authorizedLeaseProtocol: 1,
      clientStoreId: `pw-${email.split('@')[0]}`,
    });
    const requested = await client.authRequestCode(email);
    const mailboxResponse = await fetch(
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
```

The two carriers, exactly:

| Carrier | Header | Where it comes from |
| --- | --- | --- |
| Admin token | `x-snapback-admin-token` | the dev server's admin token |
| Impersonation capability | `x-snapback-impersonation-capability` | the `impersonation` field of the server's `dev.ready.json` startup sidecar |

`SNAPBACK_AUTH_IMPERSONATION_REQUIRED` means the second header is missing.
Call each persona's loop once per email; the returned
`credential.session.userId` is the server-issued principal id.

**Custody boundaries.** The mailbox route, the admin token, and the
impersonation capability are local-test material. None may enter browser or
native bundles, committed fixtures, or logs. A production deployment refuses
the route outright — the recipe is a test path, not an auth design.

An already-authenticated **headless** client (one that obtained a bearer some
other way, such as an identity broker) is constructed with
`createExternalSessionClient(baseUrl, { bearerToken })`; a bare
`authClientProtocol: 1` construction without declared custody is refused.

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

## Reset invalidates sessions and reissues principals

`app.reset` advances the auth boundary. Two consequences an author hits
immediately:

- **Existing sessions stop working.** Any bearer minted before the reset
  fails with `SNAPBACK_AUTH_REQUIRED`. Mint personas *after* the reset.
- **Reminted identities are new principals.** The same local email resolves
  to a *different* server-issued `userId` after a reset. Principal ids are
  therefore never stable fixture values: a seeded row naming a pre-reset id
  points at an identity that no longer exists.

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
principal so the live matcher can reason about disjoint subscriptions; it does
not inject an ownership filter. Two signed-in users see disjoint results over
the same query:

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

## Ask the server what auth is actually on

Don't guess from docs — the capability manifest's runtime facts carry
`authProgramReadiness` (a per-facet boolean projection: provider core,
shared invocation gate, connection binding, authorization invalidation,
authorized leases, session activation readiness, ...) plus the active
`AuthMode`. `GET /inspect` (public projection) and the admin inspect carry
it; teach your tooling to read it. This is the boundary rule this guide
itself follows: an auth behavior is teachable only when it has an
acceptance witness or shows as ready here.

Local agent principals and scoped grants (LLP 0055) — registration, pairing,
scoped-token app invocation, and the headless `AgentAuthorityFence` — are
shipped on the local target and have their own page:
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
