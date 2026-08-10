# competitive-checkpoint generated manifests untracked, breaking the effect-ceiling gate (main red gate)

**Status:** Resolved 2026-08-10
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

## Resolution

The materialized-manifest option is implemented. Current HEAD had since moved
all three demos named by the Rust gate to review-manifest-only custody, so a
fresh-tree run first reproduced the failure for competitive-checkpoint and,
after only that pair was restored, exposed the same absence for todo-v2.

`codegen.policy.json` now declares `schema.manifest.json` and
`functions.manifest.json` as consumer-committed projections for
competitive-checkpoint, todo-v2, and todo; `.gitignore` admits those six
files; and codegen regenerated the review manifests with matching custody and
hashes. Competitive-checkpoint regeneration used
`SNAPBACK_OUTBOUND_ACTIONS=1` as required.

The exact fresh-tree gate moved from 0 passed / 1 failed to 1 passed / 0
failed (2,492 filtered out). It reads the committed projections directly and
therefore no longer depends on a populated `.snapback/codegen-cache`.

## Resolution — 2026-08-10

Materialized-manifest option implemented: the schema/functions manifests for
competitive-checkpoint (and the todo/todo-v2 siblings the same gate reads)
are committed, with codegen.policy.json updated so the artifact policy owns
them. `generated_demo_manifests_pass_the_effect_ceiling_subset_check` passes
on a tree with NO codegen cache present (the fresh-clone case that was red).
