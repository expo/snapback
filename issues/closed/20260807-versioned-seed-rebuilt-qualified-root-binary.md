# Versioned-seed conformance rebuilt the qualified root binary

**Status:** Closed — fixed forward 2026-08-07
**Opened:** 2026-08-07
**Systems:** Local proof, Versioned seeds, Runtime identity, Acceptance harness
**Related:** LLP 0031, LLP 0109 §16.6, GitHub Actions run `31150398178`, PR #18

## Failure

The exact-head KEEP-GOING proof reported seven failed gates:
`versioned-seed-conformance` passed all 20 mandatory behavioral rows but
refused its revision binding, then asset conformance, both app-CLI journeys,
the two Todo headless suites, and four of six workout apps rejected the root
binary as dirty and exhausted their honest 90-second source-link fallback.

## Attribution

The revision-binding whole-tree dirty probe landed in `f508b50923`; the suite's
unconditional root `cargo build` landed in `6e080ca2fb`. They predated the
runtime-input-scoped identity definition and the later staged package carrier.
On a clean developer checkout their disagreement was ambiently masked.

## Resolution

The dispatcher now derives commit and dirty state through the shared
`readCheckoutRuntimeIdentity` runtime-input scope. When `SNAPBACK_BINARY`
selects the proof's already built, staged, and qualified carrier, the suite
verifies that path exists and does not rebuild the unrelated root target. Its
standalone path still performs the source build it owns.

Static inventory coverage refuses both regressions before native acceptance:
the dispatcher cannot restore a whole-tree status probe, and the suite's Cargo
build must remain inside its no-explicit-binary branch. Revision binding,
readiness receipts, source fallback, and the complete LLP 0109 matrix all stay
fail-closed.
