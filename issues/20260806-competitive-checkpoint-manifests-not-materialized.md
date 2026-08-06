# competitive-checkpoint generated manifests untracked, breaking the effect-ceiling gate (main red gate)

**Status:** Open
**Severity:** P2
**Systems:** Demos, Codegen, Testing
**Date:** 2026-08-06
**Related:** LLP 0010; `src/local.rs`
(`generated_demo_manifests_pass_the_effect_ceiling_subset_check`);
`demos/competitive-checkpoint/snapback/generated/`

## Problem

`cargo test --lib generated_demo_manifests_pass_the_effect_ceiling_subset_check`
fails on any fresh checkout of current `main` (observed at 8cd50fc8d and at
e8bbfa2b2):

```
read demos/competitive-checkpoint/snapback/generated/schema.manifest.json:
No such file or directory
```

The test hard-codes three demos (`competitive-checkpoint`, `todo-v2`, `todo`)
and reads their materialized `schema.manifest.json` / `functions.manifest.json`
directly. `todo`/`todo-v2` track those files; competitive-checkpoint now
tracks only `api.d.ts`/`api.mjs`/`artifacts.json`, with the manifests living
in the ignored codegen cache (left this way by the recent carrier-refresh
churn, e.g. 1eb88cc4c). Any environment that has not run codegen for that
demo — including CI-style fresh checkouts — fails the gate. Found while
verifying an unrelated storage fix.

## Fix shape

Either re-commit the materialized manifests for competitive-checkpoint (match
the todo/todo-v2 convention the test assumes), or make the test resolve
through `artifacts.json` cache selection the way `demos/_kit/generated-artifacts.mjs`
does — one authority, not both.
