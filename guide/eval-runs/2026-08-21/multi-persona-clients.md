# Retrieval eval run — 2026-08-21 — multi-persona clients (case 60)

**Fixture:** fresh `gpt-5.6-sol` Codex context, read-only in the LLP 0295
lane worktree, with `AGENTS.md` as the repository steer and the diary intent:
run several Node actors without sharing persisted auth.

**Verdict: PASS.** `guide/recipes/multi-persona-clients.md` was loaded and
used within 11 of 15 tool calls. The plan assigned one stable
`storagePartition` per actor/worker, restored the same partition across that
actor's restart, and asserted
`currentAuthorizationScope().principalScope.userId` before protected work. It
did not share the default partition, rotate partitions per request, or infer
identity from a session request alone.

## Agent tool transcript

1. Read `AGENTS.md`.
2. Read the Snapback authoring skill.
3. Read the no-template start packet.
4. Queried the Guide with the Node persona/storage-partition vocabulary.
5. Loaded `guide/recipes/multi-persona-clients.md`.
6. Followed its headless-client link.
7. Located `storagePartition` in the generated client reference.
8. Located `currentAuthorizationScope()` in the generated reference.
9. Checked the bounded app-client acceptance witness.
10. Built the restart/isolation proof plan.
11. Ran the anti-pattern rubric.
