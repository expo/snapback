# Upgrade required demo surfaces to portable Exact artifacts

**Status:** Resolved (2026-07-30)
**Impact:** 4
**Urgency:** 2
**Ease:** 1
**Confidence:** 5
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Upgrade required demo surfaces to portable Exact artifacts” shows the issue materially affects a supported product or engineering path; it can wait behind current correctness blockers, while delivery is a dependency-heavy, multi-stage program, with a direct reproduction or current implementation proof.
**Progress:** Done
**Severity:** P2
**Systems:** Exact integration, Required demo surfaces, Generated artifacts, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** ENG-24452, ENG-25004, LLP 0015
**Marker:** build-integrity

The canonical proof currently allowlists both required Contract web surfaces
from artifact-path hygiene because their locked Exact suites predate the 0.1.5
portable-artifact fixes:

- `demos/all-aboard/surfaces/contract` pins `@exact/contract` 0.1.4.
- `demos/cursors-web/surfaces/contract` pins `@exact/contract` 0.1.2.

Rebuilding either surface can therefore embed absolute checkout paths in
production Contract IR, sourcemaps, or native module tables. The gate reports
the skip instead of failing until the lock-owned suite is upgraded.

**Done when:**

- Upgrade each surface's complete lockstep Exact suite to 0.1.5 or newer and
  refresh its frozen lockfile.
- Rebuild and review both tracked production `dist/` trees, including hashed
  asset replacement and native/static manifests.
- Confirm `scripts/check-required-surface-builds.mjs` produces no uncommitted
  diff on a clean checkout.
- Confirm `scripts/check-artifact-path-hygiene.mjs` scans both surfaces and
  reports no absolute-path finding or skip.
- Remove the obsolete pre-portability allowlist versions once no maintained
  surface depends on them, and keep the rollback regression covered.

## Blocker and evidence

This work remains blocked, but the blocker moved on 2026-07-26. The public npm
registry now carries a coherent `0.1.6` suite for every package these surfaces
consume directly:

- `@ccheever/exact-contract`
- `@ccheever/exact-core`
- `@ccheever/exact-devtools`
- `@ccheever/exact-renderer`
- `@ccheever/exact-router`

Both surface manifests were temporarily pinned to that registry suite, their
locks were regenerated, and `bun install --frozen-lockfile` completed without
changes in each surface. The required production builds nevertheless exposed
an incompatibility inside the published suite:

- All Aboard first required the expected source migration for Exact 0.1.6's
  pager grammar: each `pager` now needs a stable scalar `value=` identity.
  After supplying `station.id` and `board.hero.id`, the build advanced and
  failed because `@exact/router@0.1.6/src/contract.ts` imports
  `defineCapability`, `onFlush`, `registerNativeContractKeyBinding`, `signal`,
  and other symbols from `@exact/contract/runtime`, while
  `@exact/devtools@0.1.6` redirects that client import to
  `@exact/contract/runtime/production`. The published
  `@exact/contract@0.1.6` production entry does not export those symbols.
- Cursors Web failed at the same production-runtime boundary:
  `main.ts` imports `getContractDataflowSnapshot` from
  `@exact/contract/runtime` for its acceptance/debug facts, but the redirected
  `@exact/contract@0.1.6` production entry does not export it.

The reproductions were:

```text
node scripts/check-required-surface-builds.mjs
[MISSING_EXPORT] "defineCapability" is not exported by
node_modules/@exact/contract/src/runtime/production.ts
...
[required-surface-builds] FAIL: all-aboard/contract: production build failed

bun run --cwd demos/cursors-web/surfaces/contract build
[MISSING_EXPORT] "getContractDataflowSnapshot" is not exported by
node_modules/@exact/contract/src/runtime/production.ts
```

This is not an incoherent lock or an ambient-checkout resolution: all five
installed All Aboard packages and all three installed Cursors packages reported
version `0.1.6` from the surfaces' own `node_modules` trees. A Snapback-local
alias to the full runtime, a compatibility shim, a local tarball, or hand-edited
`dist/` would bypass the Exact production-runtime boundary and violate LLP
0015's published-package, lock-owned acceptance rule. The attempted pins,
locks, pager edits, and generated-output changes were therefore reverted, and
the pre-portability allowlist remains necessary.

The original publication blocker was verified on 2026-07-16 and 2026-07-17,
when the registry still stopped at `0.1.4`. Exact `0.1.6` removed that
availability blocker on 2026-07-25, but cannot satisfy the production-build
acceptance above.

## Safe resume steps

1. Fix the Exact production-runtime/package boundary, add a registry-package
   integration test that production-builds an external `exactContractWeb`
   surface using `@exact/router/contract`, and publish the fix as one coherent
   suite newer than `0.1.6`. The release must also provide a supported path for
   Cursors' production acceptance facts (a production-safe observability seam
   or an explicit dev-only split).
2. Verify the corrected release from the public npm registry; do not validate
   this ticket with an ambient Exact checkout or local package override.
3. Pin every direct `@exact/*` alias in both surface `package.json` files to
   that same suite version and regenerate each `bun.lock` from the registry.
4. Apply the pager `value=` migration required by the corrected suite, migrate
   Cursors' dataflow acceptance facts if the release uses a new supported seam,
   and run `bun install --frozen-lockfile` in each surface.
5. Rebuild both production `dist/` trees and review the hashed assets,
   sourcemaps, and native/static manifests.
6. Run `node scripts/check-required-surface-builds.mjs` and then
   `node scripts/check-artifact-path-hygiene.mjs`; both surfaces must be scanned
   without findings or skips.
7. Only after both pins are upgraded, delete the pre-portability allowlist,
   replace its skip regression with a rollback-fails regression, update the
   affected demo diaries, and close this ticket with the proof results.

## Resolution (2026-07-30)

The blocker cleared: ENG-25463 published a coherent Exact `0.1.7` suite to the
public npm registry on 2026-07-27 whose production runtime entry exports the
symbols the 0.1.6 attempt found missing (`defineCapability`, `onFlush`,
`signal`, `registerNativeContractKeyBinding`). `getContractDataflowSnapshot`
is deliberately NOT in the production entry; the supported pattern (exact repo
`docs/contract-web-paved-road.md`) is a dev-only observer module behind an
`import.meta.env.DEV` dynamic import.

Executed per the safe resume steps, registry-only (no local tarballs, no
source aliases, per LLP 0015's published-package acceptance rule):

- Pinned all direct `@exact/*` aliases in both surface manifests to
  `@ccheever/*@0.1.7` and regenerated each `bun.lock` from the public
  registry; `bun install --frozen-lockfile` verifies clean in both surfaces
  and the locks carry no `file:` specs.
- Applied the 0.1.7 pager `value=` migration in All Aboard
  (`value=station.id` on the station header pager, `value=board.hero.id` on
  the hero pager). The surface's `test:types` and `test:url-open` suites pass.
- Split Cursors' `getContractDataflowSnapshot` acceptance facts into
  `contract-dataflow-observer.ts`, loaded behind `import.meta.env.DEV` per the
  documented pattern. Verified: the dev server resolves the observer to the
  full runtime (acceptance `channels()`/`receipts()` preserved) and the
  production bundle contains zero occurrences of the symbol.
- Rebuilt both production `dist/` trees; the tracked cursors-web dist was
  reviewed and is byte-stable across rebuilds (identical hashed asset name on
  consecutive builds). All 157 cursors sourcemap `sources` are relative;
  neither dist contains any absolute checkout path (`rg` for `/Users/`,
  `/home/`, tmp/var roots, and the worktree root: no matches). The Exact-side
  ENG-24452/ENG-25004 normalization is real in 0.1.7.
- `node scripts/check-required-surface-builds.mjs`:
  REQUIRED-SURFACE-BUILDS PASS (both surfaces, registry installs).
- `node scripts/check-artifact-path-hygiene.mjs`: both surfaces scanned, no
  finding, no skip — ARTIFACT-PATH-HYGIENE PASS.
- Deleted the pre-portability allowlist
  (`PRE_PORTABLE_ARTIFACT_EXACT_CONTRACT_VERSIONS` and the skip path) from
  `scripts/check-artifact-path-hygiene.mjs`; every dist tree on disk is now
  scanned unconditionally. `tests/artifact_path_hygiene_v0.mjs` replaces the
  skip regression with a rollback-fails regression: a surface rolled back to
  a 0.1.0–0.1.4 pin with a leaky dist produces findings, never a skip.

One gate correction surfaced by the first honest full scan: the
`windows-drive-root` marker matched escaped source text embedded in 0.1.7's
bundles — `case N:\n` (literal backslash-n in stringified source) and the
regex source `[\s:"]` serialized as `[\\s:\"]` both begin
`<letter>:<backslash>` without being paths. These were verified false
positives (the same bytes are identical across checkouts and disclose no
host path). The marker now requires a real path segment plus a second
separator (`D:\a\exact\...` still matches; escape sequences do not), with
regression tests for both classes. This is a marker-precision fix, not an
allowlist: genuine leaks in any scanned artifact still fail the gate.

Diary entries: `diaries/0008-all-aboard.diary.md` and
`diaries/0007-cursors-web.diary.md` (2026-07-30). Fresh-worktree note for
future runs: the surface builds consume the demos' ignored codegen caches;
regenerate with `SNAPBACK_OUTBOUND_ACTIONS=1 node
packages/snapback-codegen/index.mjs demos/all-aboard/snapback` and
`node packages/snapback-codegen/index.mjs demos/cursors-web/snapback` if
`SNAPBACK_CODEGEN_CACHE_INVALID` appears.
