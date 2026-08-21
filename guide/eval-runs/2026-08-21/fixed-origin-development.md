# Retrieval eval run — 2026-08-21 — fixed-origin development (case 59)

**Fixture:** fresh `gpt-5.6-sol` Codex context, read-only in the LLP 0295
lane worktree, with `AGENTS.md` as the repository steer and case 59's exact
diary vocabulary: “attach Expo web to an already-running --port server,”
“snapback dev will not pin 42080,” the five refusal shapes, and
“managed-runtime port wrapper.”

**Corrected verdict: ROUTING PASS; ORIGINAL OPERATIONAL PASS SUPERSEDED.**
`guide/recipes/fixed-origin-development.md` was loaded on tool call 3 of 5,
within the 15-call budget, so the probe remains valid retrieval evidence. Its
plan correctly chose `snapback start --port 42080` as listener owner and
`snapback dev --attach --ready-file` as the hot-load owner, rejected raw
`SnapbackExpoProvider` overrides, and routed the future unified lifecycle to
LLP 0295 D0.1/W1.

The original operational verdict was incomplete: it presented separately
owned Expo/Metro as a complete split without requiring a verified
loopback-only listener, and it did not order carrier refresh after fixed-server
shutdown. Retained Diary 0104 evidence shows the supervisor correctly expected
Metro on 56515 while the custom command opened `*:48001`. After the safety
rewrite, `node scripts/check-retrieval-eval.mjs --check` routes every corrected
case-59 term to the recipe and enforces both guidance fences. This correction
does not claim a second cold-agent run; the original transcript is retained
below.

## Original agent tool transcript

1. Read the Snapback authoring skill selected by the repository steer.
2. Queried `guide/` with the exact refusal and workaround vocabulary.
3. Loaded `guide/recipes/fixed-origin-development.md`.
4. Loaded the linked low-level provider section in
   `guide/clients/react-expo.md`.
5. Loaded the Vite/dev-loop material in
   `guide/getting-started/the-authoring-loop.md`, then produced the now-
   superseded split-ownership plan and anti-pattern check.
