# Retrieval eval run — 2026-08-21 — fixed-origin development (case 59)

**Fixture:** fresh `gpt-5.6-sol` Codex context, read-only in the LLP 0295
lane worktree, with `AGENTS.md` as the repository steer and the diary intent:
make a Vite/Expo app use a fixed Snapback origin during development without
starting a second server.

**Verdict: PASS.** `guide/recipes/fixed-origin-development.md` was loaded and
used within 9 of the 15 permitted tool calls. The plan chose one managed
`snapback start`, its ready file as the origin/session carrier, and
`snapback dev --attach`; Vite used attach mode and Expo used the virtual
binding. It rejected a raw provider URL override, dual server supervisors,
and a guessed bearer.

## Agent tool transcript

1. Read `AGENTS.md`.
2. Read the Snapback authoring skill.
3. Read the no-template start packet.
4. Queried the Guide with the fixed-origin/attach diary vocabulary.
5. Loaded `guide/recipes/fixed-origin-development.md`.
6. Loaded the linked authoring-loop section.
7. Loaded the linked React/Expo binding section.
8. Checked the bounded Vite template witness named by the page.
9. Produced the one-owner attach plan and anti-pattern check.
