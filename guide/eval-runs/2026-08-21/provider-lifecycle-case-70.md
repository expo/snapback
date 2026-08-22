# Retrieval eval run — 2026-08-21 — case 70

**Intent:** Provider connection lifecycle
**Fixture:** fresh `gpt-5.6-sol` Codex context; read-only; the intent phrase
below was the complete submitted prompt, with repository `AGENTS.md` as the
sole project steer.
**Verdict:** PASS — routed to `guide/recipes/provider-lifecycle.md` on tool
call 6 and returned manager-scoped ownership, settled-authority gating,
owner-scoped inspection, zero-resource teardown, and the qualitative budget
boundary.

## Actual prompt

````text
My Contract provider creates a connection per subscription; N cells imply N transport connections and teardown leaks timers.
````

## Actual tool trace

1. Read `skills/llp-orient/SKILL.md`.
2. Searched the checkout for Contract-provider subscription vocabulary.
3. Read `skills/snapback-authoring/SKILL.md`.
4. Read `guide/start/mental-model.md` and checked for the Guide CLI.
5. Searched `guide/index.md`, `guide/capabilities.md`, and
   `guide/retrieval-eval.md` with the intent vocabulary.
6. Read `guide/recipes/provider-lifecycle.md`.

## Final response (verbatim)

````text
Move connection ownership above the Contract cells:

- Create one manager per `(application, storage partition, server origin, settled authority)` tuple.
- Mint its stable `connectionId` once. Every cell uses that same manager and connection label.
- Key upstream stores by canonical `(provider, query, authority, args)`. Refcount identical queries; distinct queries become distinct logical subscriptions on the shared transport.
- Keep separate managers for clients A and B—never pool across custody contexts.
- While authority is blocked or unsettled, start no transport. On authority replacement, fully dispose predecessor subscriptions before opening the successor.
- Update callbacks should only publish snapshots; schedule lifecycle changes outside the callback.
- Teardown in order: release cell listeners → dispose zero-ref subscriptions → dispose provider registries/scopes → `await client.close()` if the adapter owns the client.

Inspect each client/provider pair with provider `inspection()` plus `client.localResourceInspection([connectionId])`. After delivery, each client should report one active connection and its logical subscription count. After teardown, require zero connections, subscriptions, socket demand, timers, and listeners.

There is currently no approved numeric provider-lifecycle budget to enforce. The present bounds are qualitative: one connection label per manager tuple, refcounted canonical stores, inspectable fan-out, and zero resources after teardown. LLP 0295 D0.5 owns future numeric limits; don’t treat the six-cell example—or another app measurement—as a platform threshold.

The governing recipe is [provider-lifecycle.md](/Users/ccheever/projects/snapback-worktrees/sbs-20260820/g7-provider-lifecycle/guide/recipes/provider-lifecycle.md).
````
