# Retrieval eval run — 2026-08-21 — auth-transition writes (case 61)

**Fixture:** fresh `gpt-5.6-sol` Codex context, read-only in the LLP 0295
lane worktree, with `AGENTS.md` as the repository steer and the exact
`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` diary intent.

**Verdict: PASS.** `guide/recipes/auth-transition-writes.md` and its headless
authority anchor were loaded in 12 of 15 tool calls. The plan kept queueable
background intent pending until authority settlement, fenced `queue: false`
foreground gestures, and allowed at most one bounded same-principal retry. It
did not present a local barrier as a server refusal or replay predecessor work
under a successor.

## Agent tool transcript

1. Read `AGENTS.md`.
2. Read the Snapback authoring skill.
3. Read `guide/start/mental-model.md`.
4. Tried the unavailable installed `snapback guide` command.
5. Located the repository CLI entry.
6. Tried the library entry and observed no CLI output.
7. Repeated with JSON to confirm the entry mismatch.
8. Identified `packages/snapback-cli/cli.mjs` as the executable.
9. Queried the exact diagnostic; it returned the paved anchors.
10. Located the headless authority section.
11. Read that bounded section.
12. Read `guide/recipes/auth-transition-writes.md` and produced the plan.
