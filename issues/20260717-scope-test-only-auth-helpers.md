# Scope test-only auth helpers out of production builds

**Status:** Fixed — canonical proof pending
**Severity:** P3
**Systems:** Auth, Ephemeral rooms, Build hygiene, Testing
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0043; LLP 0053; LLP 0059
**Marker:** dead-code, cfg-test, warnings

`RoomAuthorityRegistry::prepare` and
`LocalSnapback::invoke_mutation_recording_with_authority_descriptor_and_acknowledgements`
are closed test seams: every caller is itself compiled only for Rust tests, but
the helpers were still present in ordinary library builds. `cargo check` thus
reported both as dead code, obscuring new build warnings during review.

Both helpers should carry the same `cfg(test)` boundary as their callers. This
does not remove a public product API—the mutation helper is only `pub(crate)`—
and keeps the exact broad-room and descriptor-before-ACK regressions intact.

**Done when:**

- Both helpers compile only for Rust test targets.
- Their existing tests still pass.
- `cargo check --all-targets` and the canonical local proof are warning-free.

## Resolution

The two closed helpers now inherit the test-only compilation boundary already
held by every caller. Canonical proof is pending.
