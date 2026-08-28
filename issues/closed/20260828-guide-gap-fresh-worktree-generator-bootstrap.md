# guide-gap: the fresh-worktree generator bootstrap is documented where nobody looks for it

**Status:** Closed
**Filed:** 2026-08-28
**Resolved:** 2026-08-28
**Systems:** Developer experience, Agent experience, Code generation, Guide
**Found by:** LLP 0326.000 Stage 0 implementation, in a fresh `git worktree`

## Observation

Running `node scripts/generate-guide-manifest.mjs` in a **fresh worktree** fails
twice, in sequence, before it can succeed:

1. **No `node_modules`.** The manifest generator shells out to
   `scripts/generate-symbol-registry.mjs`, which dies with a raw Node error:

   ```
   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'typescript'
     imported from .../scripts/generate-symbol-registry.mjs
   ```

   The fix is `bun install --frozen-lockfile`. **The error does not say so.**

2. **No materialized demo artifacts.** Once deps are installed, the manifest
   refuses with `examples path does not exist:
   demos/competitive-checkpoint/snapback/generated/...`. Those paths are
   gitignored regenerable caches, absent in any worktree where nobody has run
   codegen yet.

   This second error **does** name its own fix — "run
   `./scripts/check-generated-artifacts` first" — which is exactly right and is
   the model the first error should follow.

## This is not a missing fact

The needed sequence is already written down, correctly, in
[`guide/conventions.md`](../../guide/conventions.md) ("Running the checks in a
fresh tree"):

> In a fresh tree, run `bun install --frozen-lockfile`, then
> `scripts/check-generated-artifacts` (node-only; regenerates every committed
> backend and verifies the committed review manifests) …

So the guide is right. The problem is that nothing routes you there from the
place you actually fail.

- `AGENTS.md` introduces `guide/conventions.md` as covering "frontmatter,
  snippet classes, freshness" — which reads like authoring/formatting rules,
  not environment bootstrap. An agent looking for "why won't the generator run
  in my new worktree" has no reason to open it.
- `AGENTS.md` *does* document the Rust-side bootstrap
  (`scripts/bootstrap-ibex-runtime`) in detail, including its full
  `SNAPBACK_*` diagnostic-code list. There is no equivalent line for the
  JS/generator side, so the asymmetry reads as "there is no JS bootstrap."
- The `ERR_MODULE_NOT_FOUND` surfaces from a subprocess two levels down. It is
  not swallowed — `generate-guide-manifest.mjs` uses `stdio: 'inherit'` — but
  it arrives with no repository context attached.

## Cost when it bites

Measured on 2026-08-28 in a clean worktree off `origin/main`: two failed runs
(~60s each, since the diagnostics generator runs to completion before the
symbol registry is reached), plus manual subprocess bisection to find a cause
that one sentence would have given. Then `bun install` (3.5s) and
`scripts/check-generated-artifacts` (141s) and it works.

The wasted part is the diagnosis, not the runtime.

## Suggested fixes, cheapest first

1. **Make the first error name its fix**, the way the second one already does.
   A missing-dependency guard in `scripts/generate-symbol-registry.mjs` (or in
   `generate-guide-manifest.mjs` before it shells out) that prints
   `run bun install --frozen-lockfile` costs a few lines and closes most of
   the gap.
2. **Add one line to `AGENTS.md`** next to the `bootstrap-ibex-runtime`
   paragraph: a fresh worktree needs `bun install --frozen-lockfile` and
   `scripts/check-generated-artifacts` before the guide generators will run,
   pointing at `guide/conventions.md`.
3. Optionally, widen the `AGENTS.md` description of `guide/conventions.md` so
   its bootstrap content is discoverable from its summary.

Fix 1 alone would have prevented this entirely.

## Note

Not a regression and not urgent — nothing is broken, and the documentation is
correct. Filed because the same wall is waiting for every fresh worktree and
every new agent session, and because one of the two errors already demonstrates
the fix for the other.

## Resolution

`scripts/generate-guide-manifest.mjs` now refuses before spawning the
diagnostics or symbol registries when `typescript` or `ajv` cannot resolve,
printing `[guide-manifest] environment precondition: required packages
unavailable: typescript, ajv; run bun install --frozen-lockfile`. Direct
invocation of `scripts/generate-symbol-registry.mjs` uses the same named
install instead of a raw `ERR_MODULE_NOT_FOUND`. `AGENTS.md` names the
JS/generator bootstrap next to `scripts/bootstrap-ibex-runtime` and mentions
the fresh-tree sequence in the `guide/conventions.md` summary.

Related: `issues/closed/20260815-check-guide-masks-later-checks-without-node-modules.md`
gave `check-guide.mjs` this precondition; the writer path did not inherit it.
