---
title: "Recipe: hidden hands"
id: recipes.hidden-hands
order: 2
audience: agent-first
capabilities: [auth.scoped-queries, auth.invalidation-barrier, auth.authorized-leases]
authorities: [llp/0053-authorization-invalidation.rfc.md, llp/0059-session-projection-and-client-barrier.spec.md, demos/card-game/snapback/functions.mjs, demos/card-game/tests/acceptance/authority-scope.mjs]
examples: [demos/card-game]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-03
reviewed-authorities-digest: sha256:43d4e382c66e7bf80e560ee5956322fc91b488556aee9e1ecfa503c180d0ce86
---

# Recipe: hidden hands

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Per-principal secrecy over shared data: a card game where every player
queries the same `myHand` function and sees only their own cards — live,
across logout, and honestly offline. The working reference is
`demos/card-game`, and every claim here is asserted by its acceptance
suite (which runs in the local proof).

Prerequisite: sessions-mode auth —
[sessions and principals](../auth/sessions-and-principals.md). For the complete
grant/invalidation/lease contract behind this recipe, use
[protecting data](../auth/protecting-data.md).

## One query, disjoint worlds

Each player signs in (email code → session) and calls the same query with
no owner argument. The query's explicit
`eq('ownerId', authUserId())` predicate compares rows with the
server-derived session principal:

```js source=demos/card-game/snapback/functions.mjs
  filter: [
    eq('ownerId', authUserId()),
    eq('gameId', arg('gameId')),
  ],
```

For JS live queries, `authScopeField` can additionally declare the principal
field to the live matcher; it never substitutes for the ownership predicate.

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
  const [adaResult, graceResult] = await Promise.all([
    ada.client.query('myHand', { args: { gameId } }),
    grace.client.query('myHand', { args: { gameId } }),
  ]);
```

The suite then asserts the two result sets are disjoint — no card leaks
across principals, finite or live.

## Logout blanks yours, only yours

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
  await ada.client.authLogout();
  assert.deepEqual(adaSurface.boundary.current('hand'), []);
  assert.deepEqual(
    graceSurface.boundary.current('hand').map(({ card }) => card),
    ['king-clubs', 'ten-diamonds'],
  );
```

The invalidation barrier is per-principal and immediate on live
boundaries (LLP 0053).

## Offline retention ends at the lease deadline, exactly

With a client store, an authorized retained query survives a cold process
start while the server is down — readable, marked `stale` — until the
signed lease's client deadline, after which store validation deletes the
hidden rows before any fallback could serve them:

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
  const offlineSurface = await trackSurface(coldGraceOptions);
  assert.equal(offlineSurface.retained(), true);
  assert.equal(offlineSurface.connection(), 'stale');
```

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
  const expiredState = await coldGraceStore.snapshot();
  assert.equal(expiredState.retained[retainedQueryKey], undefined);
  assert.equal(expiredState.queryAuthorization[retainedQueryKey]?.lease, null);
```

## Anti-patterns

- **Do not filter secrets client-side.** Sending the whole game state and
  hiding other hands in the UI is not secrecy; the scoping must be the
  server's.
- **Do not cache authorized rows outside the client store.** The store is
  what enforces the lease deadline; a side cache outlives authorization.
- **Do not pass the player as a query argument.** The server derives the
  principal; an owner argument is spoofable and is rejected in sessions
  mode.
