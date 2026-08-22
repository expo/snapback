# Retrieval eval run — 2026-08-21 — case 73

**Intent:** Provider WebSocket fan-out
**Fixture:** fresh `gpt-5.6-sol` Codex context; read-only; the intent phrase
below was the complete submitted prompt, with repository `AGENTS.md` as the
sole project steer.
**Verdict:** PASS — loaded `guide/recipes/provider-lifecycle.md` on tool call
7 of 11, rejected a traditional/process-global pool, and identified the
N-cells/one-transport regression route.

## Actual prompt

````text
My adapter opens one connection per query and now has too many websockets. Should I add a connection pool?
````

## Actual tool trace

1. Read `skills/llp-orient/SKILL.md`.
2. Searched the LLP, Guide, crate, and package trees with connection-pool and
   WebSocket vocabulary.
3. Counted the governing files and read the first root-LLP chunk.
4. Read the second root-LLP chunk.
5. Read the third root-LLP chunk.
6. Read the final root-LLP chunk.
7. Read `guide/recipes/provider-lifecycle.md` with the relevant LLP 0095/0295
   excerpts.
8. Located manager, inspection, and N-cells witnesses in the client and React
   sources.
9. Read the manager and regression-fixture excerpts.
10. Read line-numbered excerpts from the recipe, LLP 0095, client manager, and
    React regression fixture.
11. Read the D0.5 decision ticket and LLP 0278 budget excerpt.

The routed Guide page was first loaded by tool call 7.

## Final response (verbatim)

````text
No—use a shared connection manager, not a traditional connection pool.

- Create the `SnapbackClient` and manager once above all query cells.
- Reuse one stable `connectionId` per `(app, storage partition, server origin, settled authority)`.
- Multiplex distinct logical subscriptions over that WebSocket; refcount identical canonical queries.
- Keep different users or storage partitions separate.
- On auth replacement, dispose the old subscriptions before opening the successor connection.
- On teardown, release listeners, subscriptions, provider scopes, and the owned client.

Snapback already caches one `LiveStreamManager` per `connectionId` in [index.mjs](/Users/ccheever/projects/snapback-worktrees/sbs-20260820/g7-provider-lifecycle/packages/snapback-client/index.mjs:13201). The regression fixture proves six provider cells produce six subscriptions but exactly one WebSocket, then zero resources after disposal: [package.test.mjs](/Users/ccheever/projects/snapback-worktrees/sbs-20260820/g7-provider-lifecycle/packages/snapback-react/package.test.mjs:1690).

The governing recipe is [provider-lifecycle.md](/Users/ccheever/projects/snapback-worktrees/sbs-20260820/g7-provider-lifecycle/guide/recipes/provider-lifecycle.md:22), under LLP 0095’s manager-scoped ownership contract. Current numeric subscription budgets are provisional; the important invariant is one transport per manager-owned tuple, not one per query. No doc changes or LLP handoff are needed.
````
