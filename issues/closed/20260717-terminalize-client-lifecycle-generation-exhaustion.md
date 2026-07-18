# Terminalize client lifecycle generation exhaustion

**Status:** Closed
**Severity:** P1
**Systems:** Contract adapter, Auth transitions, Live queries, Ephemeral overlays
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0034; LLP 0059 §Cross-context ownership
**Marker:** overflow, aba, client, auth, live-query, generation

Several client-side async invalidation fences use unchecked JavaScript-number
increments: single- and multi-surface `resumeGeneration`, ephemeral
`socketLossEpoch`, and swappable ephemeral-wiring `generation`. Once number
precision is exhausted, distinct lifecycle cuts compare equal. A stale resume,
subscribe, or predecessor callback can then pass the generation check that is
supposed to prevent publication after quiesce, reconnect, or auth replacement.

These counters are process-local, but they guard app-visible authority-bound
state and therefore must fail closed rather than reuse an identity.

**Done when:**

- Every lifecycle generation uses one checked allocator with a stable typed
  exhaustion diagnostic.
- Exhaustion synchronously blanks/detaches the affected surface and permanently
  prevents predecessor callbacks or async resumes from publishing; it cannot
  strand a barrier half-open.
- Disposal remains idempotent at the terminal value and never needs another
  generation allocation.
- Deterministic maximum-value tests cover single/multi authority resume,
  socket-loss resubscribe, and swappable ephemeral predecessor callbacks.
- Focused contract/client suites and the canonical proof pass.

## Resolution

Implemented 2026-07-17. `@snapback/contract` now advances single/multi resume,
ephemeral socket-loss, and swappable-wiring identities through one checked
allocator. Exhaustion emits the stable typed
`SNAPBACK_CONTRACT_LIFECYCLE_GENERATION_EXHAUSTED` diagnostic with an owning
axis, synchronously blanks and detaches the affected surface, settles a
cancelled resume timer, and permanently gates equal-terminal predecessor work.
Terminal socket-loss cleanup dispatches an exact room unsubscribe both at the
cut and after any late in-flight registration resolves. Dispose is
single-flight and does not allocate a lifecycle identity.

Deterministic near-maximum coverage lives in
`packages/snapback-contract/lifecycle-generation-exhaustion.test.mjs`: it
retains single/multi resume timers, an in-flight socket-loss resubscribe, and a
hostile swappable predecessor callback across the terminal cut. Focused adapter
and ephemeral regressions, package inventory, guide checks, reference checks,
and the package suite pass. The branch's full Rust library and `local_v0`
integration suites also passed.
