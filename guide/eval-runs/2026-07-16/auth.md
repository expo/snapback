# Retrieval eval run — 2026-07-16 — intent 3 (auth scoping)

**Protocol:** guide/retrieval-eval.md (LLP 0061 §5).
**Fixture:** fresh Codex subagent with no conversation context, cold in the
Snapback checkout at `2a372af`, instructed to read `AGENTS.md` first and
then plan “Scope a query so each signed-in user only sees their own rows”
(read-only; no writes).
**Run:** the sessions/scoping page was loaded at tool use 6 and the hidden-hands
recipe at use 9, within the ~15-use retrieval budget. The agent continued to
verify the executable definition and acceptance witness.

## Rubric

- **(a) Loads the relevant guide page(s) within ~15 tool uses: PASS.**
  `guide/index.md` was loaded at tool use 4,
  `guide/capabilities.md` at 5,
  `guide/auth/sessions-and-principals.md` at 6, and
  `guide/recipes/hidden-hands.md` at 9.
- **(b) Plans with the paved technique: PASS.** The plan enables sessions,
  stores an owner field with an owner-first index, requires authenticated
  invocation, filters with server-derived `authUserId()`, stamps the same
  server-derived owner on writes, and proves two-session isolation plus forged
  body-auth rejection.
- **(c) Avoids the named anti-patterns: PASS.** It explicitly rejects
  client-supplied owner/user arguments, client-side private-row filtering,
  caller-selected write ownership, `authScopeField` without an ownership
  predicate, non-lease-aware authorized caches, and hosted generalization.

**Verdict: PASS.**

The run found one prose defect while still selecting the correct paved road:
the existing pages overstated `authScopeField` as the mechanism that filters
rows. Source inspection showed that the card-game witness uses
`eq('ownerId', authUserId())`; `authScopeField` is an explicit
live-matcher/disjointness declaration, not an injected security predicate.
That wording was corrected in the same change as this evidence.

## Agent tool transcript

1. Read `AGENTS.md`.
2. Read the complete LLP-orient instructions.
3. Read root LLP 0000.
4. Loaded `guide/index.md`.
5. Loaded `guide/capabilities.md`; found shipped local
   `auth.sessions` and `auth.scoped-queries`.
6. Loaded `guide/auth/sessions-and-principals.md`.
7. Searched cited code/LLPs for `myHand`, `authScopeField`,
   `authUserId`, and spoofing diagnostics.
8. Read the card-game function/schema witness and codegen tests.
9. Loaded `guide/recipes/hidden-hands.md`.
10. Loaded `guide/auth/targets.md`.
11. Located governing LLP headings and references.
12. Read relevant LLP 0039 and LLP 0053 sections.
13. Read query-definition types and Rust consumers of `authScopeField`.
14. Enumerated non-test `authScopeField` uses.
15. Located card-game acceptance assertions.
16. Read the exact two-session isolation and forged-body rejection proof;
    confirmed a clean worktree.

## Agent plan (retained)

1. Configure the schema for `auth: { mode: 'sessions' }`.
2. Give each protected row an ownership field and owner-first index.
3. Define an authenticated query whose server-side filter includes
   `eq('ownerId', authUserId())` plus its ordinary arguments.
4. Server-stamp `ownerId: authUserId()` in mutations; accept no owner
   identity from arguments.
5. Acceptance-test two independent sessions against the same query and assert
   disjoint results. Assert forged body auth fails with
   `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED`.
6. For live/retainable queries, add logout blanking and authorized-lease
   evidence. Inspect active auth mode/readiness before relying on the surface.

Anti-patterns named by the agent: owner/user arguments or body auth,
client-side secrecy filtering, caller-selected ownership, `authScopeField`
as a substitute for a predicate, unauthorized caching, and hosted claims.
