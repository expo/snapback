# Retrieval eval run — 2026-08-21 — provider lifecycle (case 70)

**Fixture:** fresh `gpt-5.6-sol` Codex context, read-only in the LLP 0295
lane worktree, with `AGENTS.md` as the repository steer and the diary's
N-cells/N-connections, lifecycle-budget, and teardown-leak vocabulary.

**Verdict: PASS.** `guide/recipes/provider-lifecycle.md` was loaded and used
in 8 of 15 tool calls. The plan gave one stable provider connection identity,
multiplexed/refcounted consumers, explicit handle/scope disposal, final
`client.close()`, and post-close `localResourceInspection()` assertions. It
correctly described today's budget as qualitative and left numeric limits to
the pending Phase 0 decision.

## Agent tool transcript

1. Read `AGENTS.md`.
2. Read the Snapback authoring skill.
3. Read `guide/index.md`.
4. Read the no-template mental model.
5. Tried the unavailable installed Guide lookup.
6. Used bounded non-generated Guide vocabulary search.
7. Read `guide/recipes/provider-lifecycle.md`.
8. Extracted its bounded lifecycle, inspection, budget, and anti-pattern rows.
