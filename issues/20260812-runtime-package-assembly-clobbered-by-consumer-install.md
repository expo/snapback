# Runtime package assembly clobbered while linked into a consumer app

**Status:** Open
**Severity:** P2
**Systems:** snapback-runtime-darwin-arm64, packaging, dev loop
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-12
**Related:** Aurora `llp/0003-peer-repo-dependencies.decision.md`

## Problem

While Aurora consumed this workspace through `link:`/`file:` dependencies
(2026-08-12, base commit `d6fc55d7f97798591ec68d3490c489375ae840dc`), the
assembled contents of `packages/snapback-runtime-darwin-arm64` (the `admin/`
snapshot and `runtime-readiness.json` seal) disappeared during a consumer-side
`bun install` cycle, after which `snapback dev` refused with
`SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` / `admin-console-drift`. The exact
trigger was not isolated [inferred: bun running a lifecycle script such as
`prepack` (`prepare-runtime.mjs`) against the linked package, which removes
assembled outputs before failing the clean-release attestation on a
contributor-source binary, leaving the package stripped].

Recovery that worked: `node prepare-runtime.mjs --source-test-staging` inside
the package (accepting the packaged-store qualification warning), which
restored `admin/` and the seal.

## Acceptance criteria

- Reproduce or rule out consumer `bun install` running this package's
  lifecycle scripts through a `file:`/`link:` dependency.
- `prepare-runtime.mjs` must not destroy an existing valid assembly when its
  preconditions fail — validate first, then swap.
- The refusal's `repairCommand` should name a command that succeeds for a
  contributor-source tree (today it points at `scripts/bootstrap-ibex-runtime`,
  which does not restore the admin snapshot by itself).
