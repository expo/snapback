# Fast-path release fails SNAPBACK_FASTPATH_DIRTY_TREE when run from the shared primary checkout

**Status:** Closed 2026-08-12 — this commit
**Opened:** 2026-08-11
**Found by:** model-sweep supervision session (Fable), reviewing
`release-0120-stage.log` after the author asked whether 0.1.20 had shipped.

## What happened

A 0.1.20 fast-path release was staged from
`/Users/ccheever/projects/snapback` at 2026-08-11 06:02 local
(`release-0120-stage.log`, left untracked in the repo root). The run got all
the way through Ibex bootstrap and handler-VM runtime qualification
(`SNAPBACK_IBEX_RUNTIME_LINK_OK`), then the publish step refused:

```
{"ok":false,"diagnostics":[{"code":"SNAPBACK_FASTPATH_DIRTY_TREE",
  "severity":"error","subsystem":"publish",
  "message":"fast-path release requires a clean source tree"}]}
```

0.1.20 was never published. 0.1.19 later shipped the same morning
(16:06Z) via the qualified path and is the current `latest` +
qualified pin.

## Why this recurs

The gate is correct — releases must not embed uncommitted state. The trap is
operational: the primary checkout is shared by many concurrent live sessions
and is effectively **always** dirty (untracked logs, in-flight lane files),
so any fast-path release attempted there burns the full bootstrap +
qualification wall (~minutes) before dying at the last gate. The
comparator-profile seal already learned this lesson: red runs need a clean
worktree + release build, not the primary checkout.

## Proposed fix (either is enough)

1. **Fail fast:** check tree cleanliness *first*, before bootstrap and
   runtime qualification, so a dirty-tree refusal costs seconds, not the
   full staging wall.
2. **Pave the clean path:** have the fast-path release script provision its
   own ephemeral clean worktree/clone at the target commit (mirroring the
   comparator seal recipe) instead of trusting the invoking checkout, and
   document that in the release runbook.

Also: the stray `release-0120-stage.log` in the repo root should be removed
or relocated by whoever retries the release (it is untracked; not touched by
the filer to avoid clobbering an in-flight retry).

## Pointers

- `release-0120-stage.log` (repo root, untracked, 2026-08-11 06:02)
- Publication posture: LLP 0041; qualification cadence: LLP 0189
- Comparator seal recipe (clean-worktree precedent): memory
  `comparator-profile-seal-recipe`

## Resolution (2026-08-12, this commit)

Both proposed fixes landed in `scripts/snapback-fastpath-release.mjs` and
LLP 0041 §Isolated worktrees (2026-08-12):

- `preflight` / exported `assertCleanTree` inspect cleanliness and HEAD in
  seconds. Wrappers must call this before any Ibex bootstrap.
- `stage`/`release` default to `--isolate-worktree`: they re-exec from an
  ephemeral detached worktree at `$TMPDIR/snapback-fastpath-*` so a dirty
  shared checkout is the paved path, not a refusal.
- `--no-isolate-worktree` still fails in the first check with
  `SNAPBACK_FASTPATH_DIRTY_TREE` and does not spawn publish/qualify.

`release-0120-stage.log` was not in this worktree and was left untouched.
0.1.20 later shipped via the qualified ceremony (LLP 0041 §0.1.20); this
closes the operational trap for the next fast-path cut.
