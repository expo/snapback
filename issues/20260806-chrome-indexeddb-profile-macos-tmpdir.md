# Chrome IndexedDB can fail in the kit's default macOS temp profile

**Status:** Open
**Severity:** P2
**Systems:** Acceptance testing, Browser kit, Chrome, IndexedDB, macOS
**Date:** 2026-08-06
**Related:** LLP 0015, `demos/_kit/chrome-process.mjs`, `demos/zerobugs/control/tests/acceptance/lane6b-live.mts`

## Problem

The Lane 6b Zerobugs supervising run launched Chrome successfully through
`launchChromeCdp`, but Chrome's IndexedDB initialization failed with:

`UnknownError: Internal error opening backing store`

The kit's default `tempRoot` is `os.tmpdir()`. On the affected macOS host that
is `/var/folders/.../T` (canonically `/private/var/folders/.../T`), not literal
`/tmp`. Supplying an otherwise equivalent short profile under `/tmp` made the
same application and Chrome process work. The current evidence establishes a
path-dependent interaction under the supervising shell, but not whether the
cause is path length, filesystem/sandbox policy, symlink spelling, or another
Chrome profile constraint.

The Zerobugs harness now passes `tempRoot: '/tmp'` while leaving profile
creation, Chrome process-tree ownership, and deletion to the shared kit. It
also retains an explicit `ZERBUGS_CHROME_PROFILE` override. This is a scoped
workaround, not a kit-wide diagnosis; other real-Chrome/IndexedDB harnesses
still use the default.

## Done when

- Reproduce or refute the failure with a small real-Chrome IndexedDB probe
  across the kit default, its realpath spelling, and literal `/tmp` under the
  same supervising shell.
- Record the exact Chrome/macOS/path identities and whether path length,
  symlink spelling, permissions, or filesystem attributes explain the result.
- If the default is broadly unsafe, update the shared kit with a portable
  short-profile policy and retain its process-tree-before-profile-deletion
  invariant; otherwise improve the startup/runtime diagnostic and document
  the required caller override.
- Run at least one existing IndexedDB acceptance harness and the Chrome
  lifecycle unit suite against the chosen resolution.
