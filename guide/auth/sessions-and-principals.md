---
title: Sessions and principals
id: auth.sessions-and-principals
order: 1
audience: agent-first
capabilities: [auth.sessions, auth.scoped-queries]
authorities: [llp/0039-auth-vertical-slice.rfc.md, llp/0057-auth-provider-protocol.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, src/auth/mode.rs, demos/card-game/snapback/functions.mjs, demos/card-game/tests/acceptance/authority-scope.mjs]
examples: [demos/card-game]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-16
reviewed-commit: fcd12ea756ce97a39065bff2f2eeb7b4983e2ff3
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

## Sign in: email code → session credential

The client requests a code and exchanges it. In tests, the code is read
from the server's admin-gated mailbox (a real mail sender fills that role
outside tests):

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
(from `@snapback/contract`) owns custody, refresh, and the logout barrier
for surface-based clients.

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

**Partial and still an explicit guide gap:** local agent principals and scoped
grants (LLP 0055) now have real registration/grant routes, scoped-token app
invocation, the headless `AgentAuthorityFence`, and several terminal lifecycle
paths. The RFC's owner invitation/re-credentialing/revoke-all and logical
export/import work is not complete, so this guide does not present the slice as
a finished end-to-end auth product. The [capability index](../capabilities.md)
keeps it as an owned GAP until a dedicated page can teach the exact supported
subset. For the shipped local role-per-resource surface, continue to
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
