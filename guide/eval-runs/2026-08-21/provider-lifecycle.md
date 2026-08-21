# Retrieval eval run — 2026-08-21 — provider lifecycle (cases 70, 73–74)

**Fixture:** fresh `gpt-5.6-sol` Codex context, read-only in the LLP 0295
lane worktree, with `AGENTS.md` as the repository steer and the exact
"one connection per query", "too many websockets", "connection pool",
"provider adapter pattern", and "rebuild stream on auth" vocabulary. The
probe could use Guide indexes/routes and routed pages only; source, LLPs, and
the issue ticket were excluded.

**Verdict: PASS.** `guide/recipes/provider-lifecycle.md` was loaded and used
in 6 of 15 tool calls. The plan gave each of two clients one tuple-owned
manager and stable connection label, multiplexed/refcounted logical
subscriptions, blocked-state branching on `transitionOwner:
"auth-coordinator"` with no timeout, predecessor teardown before fresh
successor subscribe, complete-snapshot deduplication, manager-owned transport
retry, and explicit provider/client teardown. It combined provider inspection
with `localResourceInspection()` into owner rows, required zero resources after
teardown, and left numeric connection/subscription thresholds to LLP 0295
D0.5.

## Agent tool transcript

1. Read the Snapback authoring skill selected by `AGENTS.md`.
2. Loaded `guide/index.md`.
3. Tried the documented `snapback guide <query>` route; the executable was not
   on that probe's path.
4. Searched `guide/capabilities.md` with the exact lifecycle vocabulary.
5. Used a bounded search across `guide/index.md` and
   `guide/capabilities.md`, which routed to the provider-lifecycle recipe.
6. Loaded `guide/recipes/provider-lifecycle.md` and completed both rubrics.
