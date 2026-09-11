# Snapback 2 Expo arm (lane E1): carrier follow-ups from the third review round

**Status:** Open — three of five findings remain (2026-09-11)
**Priority:** P2
**Systems:** snapback2 client (`packages/snapback2/src/store/{sqlite,sqlite-node,sqlite-expo,sqlite-driver}.ts`, `packages/compiler/tsconfig.json`)
**Date:** 2026-09-04
**Related:** LLP 1013 revision (d) §3–§5; reviews `e1-r3-{muse,grok,astra}.md` (the lane's third and last round)

## Findings

1. **Node identity misses hardlink and bind-mount aliases** (Muse T2): `realpath` collapses
   symlinks, `.`, and `..`; two hardlinks to one inode still differ. Derive the identity from
   the file's device and inode after open (`fstat`) where the platform allows.
2. **Expo identity normalizes only the edges** (Muse T3): interior spellings of the directory
   (`sub/../x.db`) still diverge; normalize the path fully before composing the identity.
3. **The Expo COMMIT-rollback proof shows non-poisoning, not rollback** (Muse T4): the SDK owns
   BEGIN/COMMIT/ROLLBACK; the conformance run in the witness app (lane E2) must assert a
   failed transaction left no row.
4. **A Node ROLLBACK failure can still poison the connection** (Muse T5): if ROLLBACK itself
   fails to release, the next `BEGIN IMMEDIATE` fails; document the recovery (close and reopen
   the driver) or perform it.
5. **The compiler's Expo stubs remain package-wide** (Muse T6, grok, astra): the path mapping
   applies to the whole compiler package; the new test guards only current sources. Scope the
   mapping to the files that need it.

## Reconciliation — 2026-09-11

Current source resolves two findings: Expo now accepts only a plain database basename,
so item 2's interior aliases are refused rather than normalized; and the compiler
`tsconfig.json` no longer carries package-wide Expo path mappings, resolving item 5.

Items 1, 3, and 4 remain. Node identity is still `realpathSync(path)` rather than
device/inode identity. The portable device conformance deliberately ends the body with
`ROLLBACK`; it proves a failed following COMMIT leaves no row and the next transaction
succeeds, but explicitly is not a real SDK COMMIT failure. Node still catches and
ignores a failed `ROLLBACK`, leaving connection recovery undefined.

Next acceptance: a hardlink/bind alias test where supported; an actual pinned Expo SDK
COMMIT failure with no row plus a successful next transaction; and a Node rollback-failure
test demonstrating close/reopen or another documented recovery.
