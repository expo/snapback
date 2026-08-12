# Runtime package assembly clobbered while linked into a consumer app

**Status:** Resolved (2026-08-12)
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

## Resolution

Resolved 2026-08-12. The consumer-install trigger was ruled out empirically
with Bun 1.3.14 (the repository pins 1.3.12): an isolated package whose
`prepack` wrote a marker was installed through a registered `link:` dependency
(a symlink to the source directory), a `file:` directory dependency (a copied
directory), and a `file:` tarball dependency. All three installs succeeded and
no marker was written, including a second pass with the fixture listed in
`trustedDependencies`. Bun 1.3.14 does not accept a literal `link:<directory>`
specifier: relative and absolute path attempts refused installation; its
working linked-directory form is `bun link` registration plus
`link:<package-name>`. Thus there is no remaining inferred Bun lifecycle
mechanism.

The original attribution is corrected as well. Plain
`node prepare-runtime.mjs` against a contributor binary refuses at
`SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED` before touching assembly.
The destructive in-tree path was explicit
`node prepare-runtime.mjs --source-test-staging`: the old implementation could
remove the valid package before discovering a missing or source-mismatched
`admin-ui/dist` (and incorrectly allowed that flag to omit the console).

Both Darwin and Linux preparation now build every shipped entry under an
in-package staging root, run CV-2 and reopen the digest-recomputed package seal
there, then rename the four content entries and
`runtime-readiness.json` last. Rename-time backups restore the prior assembly
on an ordinary swap error; staging is cleaned on success and failure. The
source-test flag bypasses only public build identity, while only native
artifact staging may omit the admin snapshot. Darwin regressions prove a
qualification refusal and missing admin snapshot leave the prior seal valid;
the cross-host synthetic Linux regression proves missing-admin and
portability refusals do the same.

Finally, readiness refusals now carry explicit custody. Installed package
refusals name the exact `@expo/snapback-runtime-*` package to reinstall from
the consumer lockfile and omit the impossible in-package requalification
command. Source-checkout refusals point to the new executable
`scripts/assemble-runtime-package`, which refuses a dirty tree and performs
bootstrap, clean release build, locked admin install/build, and staged host
package assembly end to end.
