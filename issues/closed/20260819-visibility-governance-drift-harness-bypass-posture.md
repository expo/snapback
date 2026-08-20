# Visibility-governance drift harness bypass posture

**Status:** Resolved 2026-08-19
**Date:** 2026-08-19
**Systems:** Visibility governance, proof harness
**Source:** residual split from the retired module-ownership health signature

## Problem

`tests/drift_prone_gates_v0.mjs` exercises the compatibility spelling
`SNAPBACK_DRIFT_GATES_BYPASS=1`, while the synchronous LLP 0234
visibility-governance push class refuses that spelling. The old combined
module-ownership ticket could not close without losing this independent
concern.

## Acceptance

- The drift harness and the synchronous visibility-governance class agree on
  whether the compatibility bypass is observable, refused, or ignored.
- The choice is recorded under LLP 0234 and covered by an integration test.
- No relaxation is inferred from the retirement of the unrelated
  module-ownership gate.

## Resolution

The chosen posture is **observable**. The exact legacy spelling
`SNAPBACK_DRIFT_GATES_BYPASS=1` remains accepted and loud, matching
`CLAUDE.md`. In the frozen-record drift runner it retains its compatibility
behavior (redundant on an ordinary deferred push). In the independent LLP 0234
synchronous class it emits
`[visibility-governance] COMPATIBILITY BYPASS OBSERVED ... synchronous visibility governance remains enforced`
and then runs the unchanged predecessor comparison. The spelling is therefore
not visibility-governance authority and cannot skip or weaken a widening
check. Non-exact values refuse in both classes.

LLP 0234 D3 and its acceptance section now record that distinction and state
that retirement of the unrelated module-ownership gate changes no visibility-
governance authority rule. The pre-push hook comment carries the same contract.

Coverage:

- The codegen governance test supplies the exact compatibility spelling to a
  same-update widening and requires the underlying
  `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_SELF_APPROVAL` refusal, while also
  asserting that the spelling was logged. It separately rejects a non-exact
  value.
- `tests/drift_prone_gates_v0.mjs` performs a real committed `git push` through
  the tracked hook and requires, in one output, both the visibility class's
  observable/non-authorizing message and the drift runner's loud compatibility
  bypass message.

