# Local source closure can reinstall stale same-path tarball bytes

**Status:** Resolved
**Date:** 2026-08-06
**Systems:** Local package closure, Bun, Expo fixtures
**Related:** LLP 0176 development/packaging,
`scripts/install-local-snapback-packages.mjs`
**Fix commit:** pending landing by the orchestrator

## Reproduction

Run the local closure installer, change `@expo/snapback-client` source without
changing its package version, then rerun the installer. The helper packed a
new `client.tgz` and reported its new SHA-256, but `bun.lock` still identified
the prior bytes at that same path. Bun left the old client in `node_modules`,
so the simulator repeated a defect whose source had already been fixed.

## Resolution

Helper-owned closure tarballs now carry their packed-content SHA-256 in their
filenames. The helper retains the prior lockfile-addressed tarballs until Bun
successfully adopts the new dependency specifiers, then removes predecessor
and provisional files. The closure test pins per-package filename/digest
agreement, frozen reinstall, and post-install directory cleanup.

The Air exercised a real source rotation after this change: the Expo package
path changed, Bun resolved four local packages and rewrote the lock, the
installed provider contained the new code, and only the four current
digest-named tarballs remained. The final simulator run passed.
