# Retrieval eval run — 2026-08-21 — activity presence (case 62)

**Fixture:** fresh `gpt-5.6-sol` Codex context, read-only in the LLP 0295
lane worktree, with `AGENTS.md` as the repository steer and the diary's
`useSurface`, Supabase `track`, bound-value, heartbeat, and timer vocabulary.

**Verdict: PASS.** `guide/recipes/activity-presence.md` was loaded and used in
7 of 15 tool calls. The answer chose `useSnapbackActivityPresence`, `touch()`
on activity, `withdraw()` on clear/send, provider-owned renewal, and TTL only
as a crash backstop. It rejected a continuously truthy typing binding, a
second app timer, and TTL-only ordinary withdrawal.

## Agent tool transcript

1. Read `AGENTS.md`.
2. Read `guide/index.md`.
3. Ran a bounded vocabulary lookup in the index.
4. Read `guide/recipes/activity-presence.md`.
5. Tried the unavailable installed exact-symbol lookup.
6. Confirmed the route with bounded non-generated Guide grep.
7. Read the linked bounded ephemeral/typing sections and applied the rubric.
