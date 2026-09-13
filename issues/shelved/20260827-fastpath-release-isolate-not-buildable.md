# Fast-path release ceremony: the isolated worktree is not a buildable tree

**Status:** Open
**Systems:** Packaging, Distribution, Release tooling
**Date:** 2026-08-27
**Related:** LLP 0041 (`#isolated-worktrees-2026-08-12`, `#fast-path`), LLP 0233,
LLP 0288, `issues/shelved/20260803-linux-hermes-release-carrier-gap.md`,
`issues/shelved/20260824-published-claim-requalification-debt.md`

## Symptom

`scripts/snapback-fastpath-release.mjs stage --version <v>` cannot stage a
release. It provisions an isolated `git worktree add --detach` in `$TMPDIR`
(LLP 0041 — never build against the shared, routinely-dirty primary tree), then
runs `snapback-publish.mjs` against it — but that isolate is a **bare source
checkout that is not buildable**, so staging fails. The staging artifacts under
`~/snapback-staging` stop at `0.1.24`, consistent with this path having been
non-functional since around the time the isolate step was introduced
(2026-08-12). This is what blocked cutting `0.1.28` on 2026-08-27.

## Three cascading gaps in `provisionIsolatedWorktree`

1. **No dependencies (FIXED in this landing).** The isolate lives outside the
   primary tree, so it cannot resolve `node_modules` upward. Pass-1 staging runs
   workspace node scripts that import third-party packages (e.g. `ajv` from
   `scripts/symbol-lifecycle.mjs`) and died with
   `ERR_MODULE_NOT_FOUND` → `SNAPBACK_FASTPATH_PASS1_FAILED`. **Fix landed:**
   `provisionIsolatedWorktree` now runs `bun install --frozen-lockfile` in the
   isolate after the clean-check (`node_modules` is gitignored, so it does not
   dirty the verified checkout).

2. **No release binary (OPEN).** With deps present, staging next refuses:
   `SNAPBACK_PUBLISH_REFUSED` / `SNAPBACK_RUNTIME_BINARY_MISSING: release binary
   is missing at <isolate>/target/release/snapback; run
   scripts/bootstrap-ibex-runtime and cargo build --release`.
   `snapback-publish.mjs` **expects a pre-built release binary and never builds
   one**; the isolate has no `target/`.

3. **Hermes cannot be provisioned in the isolate (OPEN — the hard one).** The
   obvious fix for (2) — build the binary in the isolate — fails at the first
   step: `scripts/bootstrap-ibex-runtime` in the `/tmp` isolate returns
   `SNAPBACK_IBEX_SUBMODULE_INIT_FAILED` (`git submodule update --init --recursive
   -- vendor/ibex` fails; network/credentials in the non-interactive context).
   The ceremony's throwaway-`/tmp`-worktree design is in direct conflict with the
   Hermes runtime's `vendor/ibex` submodule requirement.

## The linux leg is separate

`stagePass` runs the host (darwin-arm64) store qualification locally and returns
the `linux-x64` qualification as a **remote command** for the operator to run on
a Linux x64 host (the Minisforum in the fleet). That leg — and the Linux Hermes
release carrier it depends on — is tracked in
`issues/shelved/20260803-linux-hermes-release-carrier-gap.md`.

## Wanted

Make the isolated worktree a fully buildable tree, or revisit the isolate design
given the Hermes requirement:

- Provision `vendor/ibex`/Hermes into the isolate **without a live submodule
  fetch** — e.g. copy the prepared artifacts from `SNAPBACK_IBEX_CHECKOUT`
  (`ios/Frameworks`, `tools/hermes`) into the isolate, or add a
  `bootstrap-ibex-runtime` path that consumes prepared artifacts and skips
  `git submodule update --init` when the objects are unavailable.
- Build `target/release/snapback` in the isolate (bootstrap + `cargo build
  --release`) as part of provisioning, or have `snapback-publish.mjs` build it.
- Validate the full `stage → release → publish` flow end-to-end (both platform
  receipts, holding tag, dry-run pass-2, published-closure smoke) before the next
  release, and record the canonical operator procedure — none is currently
  documented, and neither the maintainer nor an orchestrating agent could
  reconstruct how recent releases (0.1.25–0.1.27) were actually cut.

## Impact

`0.1.28` (which carries the ws-devloop lifecycle-authority security fix,
`cbf4fc7fa`) cannot be cut through this ceremony until (2) and (3) are resolved.
The security fix is already on `main`; only the npm publication is blocked.
