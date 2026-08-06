# Clean clone cannot rotate tracked local-source package records

**Status:** Resolved
**Date:** 2026-08-06
**Systems:** Local package closure, Bun, Expo fixtures
**Related:** LLP 0176 development/packaging,
`scripts/install-local-snapback-packages.mjs`,
`demos/expo-golden-path-fixture/receipts/20260806-g1-android-emulator.md`
**Fix commit:** pending landing by the orchestrator

## Reproduction

Clone current main without ignored files and run:

```sh
node scripts/install-local-snapback-packages.mjs \
  demos/expo-golden-path-fixture --no-cache
```

The tracked fixture manifest and `bun.lock` named older content-addressed
Snapback tarballs. Those tarballs are correctly ignored and therefore absent
from a clean clone. The helper packed current tarballs and updated the
manifest, but Bun consulted the predecessor package records first and failed
`ENOENT extracting tarball` before it could reconcile the new paths.

The prior retention logic handled repeated installs in one checkout because
the predecessor bytes still existed. The iOS receipt's rsync transport also
carried those ignored bytes, masking the clean-clone case.

## Resolution

Before invoking Bun, the helper now recognizes only its own
`.snapback/local-source-packages` specifiers and rotates those paths in the
existing lock. For each rotated internal package record it reconstructs the
current dependency/peer metadata and SHA-512 integrity from the newly packed
archive. Registry pins and every unrelated package record stay byte-for-byte
unchanged, so Bun validates the existing graph instead of discarding and
regenerating it.

The closure regression now models a fresh clone by replacing all four local
specifiers with absent predecessor digests, deleting `node_modules` and all
ignored tarballs, and rerunning against an unreachable registry. It asserts:

- no `Ignoring lockfile`, parse failure, or root-resolution fallback;
- current paths and archive SHA-512 values in all four package records;
- every unrelated package record unchanged; and
- a subsequent frozen-lockfile reinstall succeeds.

The real fleet-mini clean clone then installed the closure with Bun 1.3.12
without registry-graph regeneration and completed the Android receipt.
