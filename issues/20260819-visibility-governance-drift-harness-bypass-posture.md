# Visibility-governance drift harness bypass posture

**Status:** Open
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
