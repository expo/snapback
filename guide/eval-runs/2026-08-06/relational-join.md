# Retrieval eval run — 2026-08-06 — conversation-list membership join (seed case 4)

**Protocol:** guide/retrieval-eval.md (LLP 0061 §5; seed case added by LLP
0187 T7 / LLP 0186 W2 from the 3/3 replicated `defineRelationalQuery`
bakeoff miss).
**Fixture:** fresh Claude subagent with no inherited conversation context,
cold in the Snapback worktree checkout at `42218ccae` (immediately after the
routing sweep landed), instructed to read `AGENTS.md` first and then plan
(read-only) "show a user's conversation list (a membership join)".
**Run:** `guide/index.md` at tool use 2, `guide/backend/relational-queries.md`
at tool use 3, capability index at tool use 4 — well inside the ~15-use
budget. Nine tool uses total.

## Rubric

- **(a) Loads the relevant guide page within ~15 tool uses: PASS.**
  `backend/relational-queries.md` at tool use 3; the index's map named the
  feature (including "conversation-membership" verbatim) at tool use 2.
- **(b) Plans with the paved technique: PASS.** The plan is
  `defineRelationalQuery` (root `conversationMembers` ⋈ unique conversation
  key) or `defineMaintainedProjection` + declarative `defineLiveQuery` for
  the recency-ordered variant, with `scoped-roles.md`'s feed-vs-roster split
  and the local-target-only caveat carried honestly. It also correctly named
  the honest boundary: v1 cannot order the plain relational variant by
  recency, which is what pushes the design to the maintained projection.
- **(c) Avoids the named anti-patterns: PASS.** A hand-written
  `defineJsLiveQuery` join was explicitly considered and rejected, citing
  both `relational-queries.md` and `live-queries.md`'s check-relational-first
  pointers; manual fan-out, private-roster feeds, and client-side merges
  were likewise rejected with page citations. The JS fallback was reserved
  for exactly the declared v1 gaps (aggregation, >2 sources, self-joins —
  LLP 0177).

**Verdict: PASS.** The exact 3/3 bakeoff miss (dropping straight to
`defineJsLiveQuery` for a plain membership join) did not reproduce.

## Agent tool transcript

1. Read `AGENTS.md` — steered to the guide.
2. Read `guide/index.md` — map named relational queries, including
   conversation-membership shapes.
3. Read `guide/backend/relational-queries.md`.
4. Grep of `guide/capabilities.md` for conversation/membership/relational —
   confirmed `backend.relational-queries` plus the adjacent
   `backend.standard-patterns` and `auth.scoped-roles` rows.
5. Read `guide/backend/standard-patterns.md`.
6. Read `guide/auth/scoped-roles.md`.
7. Read `guide/realtime/live-queries.md` (first 120 lines).
8. Grep of `demos/competitive-checkpoint/snapback/functions.mjs` for the
   shipped relational fixtures the guide excerpts.
9. Grep of `demos/competitive-checkpoint/snapback/schema.mjs` for join-key
   declarations.
