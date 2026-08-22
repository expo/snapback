# Retrieval eval run — 2026-08-21 — case 74

**Intent:** Provider auth rebuild
**Fixture:** fresh `gpt-5.6-sol` Codex context; read-only; the intent phrase
below was the complete submitted prompt, with repository `AGENTS.md` as the
sole project steer.
**Verdict:** PASS — routed to `guide/recipes/provider-lifecycle.md` on tool
call 8 and used the documented blocked states plus teardown-before-rebuild
without polling, timeout, or predecessor connection rebind.

## Actual prompt

````text
I need a provider adapter pattern that can rebuild stream on auth without a timeout.
````

## Actual tool trace

1. Read `skills/llp-orient/SKILL.md`.
2. Searched the checkout with the provider/auth/stream/timeout vocabulary.
3. Surveyed the repository structure and provider-bearing packages.
4. Inspected the branch history and narrowed the provider-lifecycle search.
5. Read `skills/snapback-authoring/SKILL.md`.
6. Read `guide/start/mental-model.md` and located the Guide CLI.
7. Ran the bounded Guide query; it refused because this checkout had no
   qualified release runtime.
8. Followed the checked-in route and read
   `guide/recipes/provider-lifecycle.md` directly.

## Final response (verbatim)

````text
Use an event-driven, owner-scoped state machine—no timer or client polling.

```ts
async function reconcile(snapshot: ProviderSnapshot) {
  if (
    snapshot.status === "blocked" &&
    ["authentication-required", "authentication-not-settled"]
      .includes(snapshot.reason)
  ) {
    await retirePredecessor();
    return; // wait for the next provider snapshot
  }

  const key = tupleKey({
    app,
    storagePartition,
    origin,
    authority: snapshot.settledAuthority,
  });

  if (active?.key === key) return;

  await retirePredecessor();       // subscriptions first, then manager
  if (snapshot !== latestSnapshot) return;

  active = startFreshManager({
    key,
    connectionId: readableConnectionId(key),
    authority: snapshot.settledAuthority,
  });                              // fresh snapshot-with-subscribe
}
```

Lifecycle rules:

- Keep one manager above all query cells for each `(app, storage partition, origin, settled authority)` tuple.
- `authentication-required`: remain idle; open no protected transport.
- `authentication-not-settled` with `transitionOwner: "auth-coordinator"`: dispose predecessor work and wait for the next provider snapshot.
- Settled successor authority: create a new manager and fresh subscription. Never rebind the predecessor session connection.
- Ordinary transport loss under unchanged authority: let Snapback’s bounded reconnect/resubscribe machinery recover it; don’t rebuild the provider.
- Teardown order: cell listeners → logical subscriptions → provider/registry → owned client. Call `dispose()` explicitly; use `settled()` only to await cleanup completion.
- Keep update callbacks non-reentrant; schedule additional lifecycle work at a microtask/effect boundary.

The complete local-target recipe is [provider-lifecycle.md](/Users/ccheever/projects/snapback-worktrees/sbs-20260820/g7-provider-lifecycle/guide/recipes/provider-lifecycle.md).
````
