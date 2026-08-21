# Retrieval eval run — 2026-08-21 — membership roster projection (case 69)

**Fixture:** fresh `gpt-5.6-sol` Codex context, read-only in the LLP 0295
lane worktree, with `AGENTS.md` as the repository steer and the diary's
private-backing-row, roster, join-date, and recipient-snapshot vocabulary.

**Verdict: PASS.** `guide/recipes/membership-roster-projection.md` was loaded
and used in 4 of 15 tool calls. The plan kept generated membership private as
authority, maintained an idempotent `(conversationId, principal)` product
projection for current presentation, and wrote immutable send-time recipient
history. It covered create/join/leave/removal/promotion drift checks and did
not authorize from or expose the projection/backing-row id.

## Agent tool transcript

1. Read `AGENTS.md`.
2. Ran bounded literal Guide searches for recipient snapshot, backing rows,
   join date, and roster.
3. Resolved the converging route to the membership-roster recipe.
4. Read only that page and applied its idempotency/drift rubric.
