# App CLI auth test expects `/auth/agents/token` but the packaged flow now calls `/auth/session`

**Status:** Open
**Impact:** 2
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** App CLI, Auth, Package tests
**Date:** 2026-08-15
**Related:** `packages/snapback-app-cli/auth.test.mjs:221`
**Found while:** Supervised 2026-08-15 ticket-fix run (jspack lane baseline verification)

## Problem

`node auth.test.mjs` in `packages/snapback-app-cli` fails deterministically at
clean `main` `a93a11235` (verified in an untouched worktree with a fresh
`bun install`):

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  actual:   [ '/auth/session', '/auth/agents/token/release' ]
  expected: [ '/auth/agents/token', '/auth/agents/token/release' ]
    at auth.test.mjs:221
```

The packaged CLI's auth journey now reaches the backend through
`/auth/session` where the test's recorded route inventory still expects
`/auth/agents/token`. This most plausibly drifted with the 2026-08-14/15 auth
lifecycle landings (`1043bbcc6` explicit handler read authority,
`c1ba845aa` client/provider lifecycle serialization) that did not update this
frozen expectation.

## Desired outcome

Decide at the semantic owner whether the packaged agent journey is supposed to
mint through the session route now (update the frozen inventory and any
adjacent custody assertions) or whether the agent-token route regressed
(restore it). Do not just edit the expectation to match observed behavior
without pinning the intended route contract.

## Acceptance

- `bun run test` in `packages/snapback-app-cli` passes from a fresh clone.
- The intended auth route for the packaged agent journey is asserted
  explicitly, with a comment or LLP reference naming the governing decision.
