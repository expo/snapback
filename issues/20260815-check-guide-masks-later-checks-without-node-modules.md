# `check-guide.mjs` aborts on a missing dependency and masks every later check, causing lanes to misattribute their own reds

**Filed:** 2026-08-15 · **Source:** supervised multi-lane ticket-fix run
(clique-0121 sweep follow-ups) · **Systems:** Guide tooling, Proof/CI

## Problem

`node scripts/check-guide.mjs` runs its sub-checks in sequence and stops
reporting at the first hard failure. In a checkout without `node_modules`
installed, `control-catalog Guide projection check` dies with

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ajv' imported from
  /Users/ccheever/projects/snapback/scripts/generate-control-catalog.mjs
```

and the run ends there. The diagnostics-registry, symbol-registry, and
guide-manifest checks never execute, so their state is unknown — but the output
reads as a complete failure list.

That produces a specific, repeatable failure mode for anyone working in a fresh
worktree: **a lane cannot tell an inherited red from one it just introduced.**

Observed twice in one run, in both directions:

1. A lane that edited `packages/snapback-client/index.mjs` reported the stale
   diagnostics/symbol registries as "unrelated checkout-generated state." They
   were not unrelated — they were stale *because of that lane's own edit*, and
   the lane could not see it because `main`'s comparison run aborted earlier and
   never reached those checks. Landing it would have shipped an introduced red.
2. Two other lanes reported `check-guide` and `check-inventories` as
   "repository-wide gates still red." Those were the missing gitignored demo
   artifacts (`demos/competitive-checkpoint/...`, `demos/todo-v2/...`), not
   their changes; both passed once the artifacts existed.

The A/B that actually resolves this — run the check at the lane's base commit
and at its head *in the same worktree with the same `node_modules`* — is not
obvious, and nothing in the output suggests it is necessary.

## Suggested fix

1. Do not abort the run on a sub-check's failure. Run every sub-check, collect
   results, and report the complete set with a clear per-check status. A missing
   dependency should be reported as `SKIPPED (dependency unavailable)` distinct
   from `FAILED`, so a masked check is never mistaken for a passing one.
2. Fail fast and explicitly on the environment precondition instead: if
   `node_modules` is absent or a required package cannot resolve, say so once at
   the top with the install command, rather than surfacing it as a mid-list
   projection error.
3. Consider making the demo-artifact precondition explicit too. `check-guide`
   already prints good repair hints for the missing `competitive-checkpoint` /
   `todo-v2` files; state plainly that these are *preconditions*, not content
   failures, so an agent does not attribute them to its own diff.

## Why this matters

Every fresh worktree hits this, and the repo's landing policy (LLP 0232)
turns on exactly this distinction — inherited reds proceed, introduced content
reds block. A gate that cannot distinguish them pushes that judgement onto each
agent, and at least one agent in this run got it wrong in the direction that
would have landed a regression.
