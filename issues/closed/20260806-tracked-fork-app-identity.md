# Todo demo tracked a worktree-local fork app identity

**Status:** Resolved
**Opened:** 2026-08-06
**Resolved:** 2026-08-06
**Systems:** Demo fixtures, instance forks
**Related:** LLP 0158

Both todo fork acceptance gates refused with
`SNAPBACK_FORK_APP_BINDING_MISMATCH`. A scoped process/cwd inspection found no
Snapback process owned by this checkout. The tracked
`demos/todo/.snapback/instance-fork-app-identity.v1.json` instead embedded a
canonical root below `/private/tmp/snapback-llp0184-phase3-20260806`, making
every other checkout fail the intended app-binding guard.

## Resolution

The worktree-local runtime identity is no longer tracked, and
`**/.snapback/instance-fork-app-identity.v1.json` is ignored. Each checkout now
authors its own identity through the existing guarded runtime path.

Verification with Node 24.18.0:

- `demos/todo/tests/acceptance/forked-parent.mjs` — 4/4 passed
- `demos/todo/tests/acceptance/fork-parallel-dispositions.mjs` — 7/7 passed
