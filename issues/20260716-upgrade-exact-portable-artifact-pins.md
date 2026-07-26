# Upgrade required demo surfaces to portable Exact artifacts

**Status:** Blocked
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
