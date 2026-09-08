# Snapback 2 compiler checks compare object prototypes under Bun 1.4

**Status:** Open
**Date:** 2026-09-08
**Systems:** compiler test runner, toolchain compatibility

The apartment M1's Bun 1.4.0 fails two compiler checks because the actual
tagged result has a null-prototype field dictionary and the expected literal
has `Object.prototype`:

- `direct Quarry normalizes whole-unit decimal fallbacks once and preserves optional absence`
- `direct Quarry fn scopes are hygienic, module-local, pure, and row-ref typed`

Both failures reproduce on the untouched architecture lane `ab8b225e6a`,
as well as the client-item candidate `a5bf9fcdc`. The same two candidate checks
pass under Bun 1.3.12 on the Office M1. Final client-item qualification uses
that same Bun executable in a private tool directory on the apartment M1;
it does not replace the machine's installation or change these assertions.

Evidence: `/tmp/snapback-client-items-canonical.log` on `100.72.251.34`,
plus direct execution of the two registered checks in
`/Users/ccheever/lanes/sixverify/snapback2/packages/compiler` on that host.
The failure prints identical tagged field values with only the dictionary
prototype differing. This reproduces an inherited runner compatibility
failure, not a changed compiler value or a passing Bun 1.4 qualification.

Resolve the intended equality contract for these compiler-value tests, using
the existing canonical tagged-value comparison if prototypes are irrelevant.
Preserve integer, ID, optional-absence and nested-value assertions. Qualify
the full compiler suite on the intended supported Bun versions; do not alter
production row provenance merely to satisfy a fixture prototype.
