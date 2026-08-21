# Retrieval eval run — 2026-08-21 — fixed-origin development (case 59)

**Fixture:** fresh `gpt-5.6-sol` Codex context, read-only in the LLP 0295
lane worktree, with `AGENTS.md` as the repository steer and case 59's exact
diary vocabulary: “attach Expo web to an already-running --port server,”
“snapback dev will not pin 42080,” the five refusal shapes, and
“managed-runtime port wrapper.”

**Verdict: PASS.** `guide/recipes/fixed-origin-development.md` was loaded and
used on tool call 3 of 5, within the 15-call budget. The plan chose
`snapback start --port 42080` as listener owner and
`snapback dev --attach --ready-file` as the hot-load owner. It correctly
stated that attached regeneration does not rewrite the Sessions startup
carrier; Vite uses `virtual:snapback/dev`, while separately owned Expo/Metro
uses the lower-level `SnapbackProvider` composition. It rejected a raw
`SnapbackExpoProvider` origin override, dual supervisors, and a fictional
`snapback dev --port` flag, and routed the future unified lifecycle to LLP
0295 D0.1/W1.

## Agent tool transcript

1. Read the Snapback authoring skill selected by the repository steer.
2. Queried `guide/` with the exact refusal and workaround vocabulary.
3. Loaded `guide/recipes/fixed-origin-development.md`.
4. Loaded the linked low-level provider section in
   `guide/clients/react-expo.md`.
5. Loaded the Vite/dev-loop material in
   `guide/getting-started/the-authoring-loop.md`, then produced the current
   split-ownership plan and anti-pattern check.
