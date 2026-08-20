# `drift_prone_gates_v0` standing-claims assertion text is stale

**Status:** Open
**Filed:** 2026-08-19
**Severity:** Low — test assertion text, not a gate weakness
**Systems:** Verification, proof harness
**Related:** `ed06d2b4b`, `89be2563b`

## Finding

`tests/drift_prone_gates_v0.mjs` has one failing standing-battery assertion. The test
expects a message matching `/known publication anchor\(s\).*zero standing claims/`, but the
implementation reports:

```text
SNAPBACK_DRIFT_GATE_INVALID: publication roots omitted known anchor(s): detached/known-publication.anchor.json
```

The fixture places the anchor under `detached/`, which is not in
`PUBLICATION_ROOT_CANDIDATES`, so the omitted-known-anchor check fires before the
zero-standing-claims path the assertion was written for
(`scripts/drift-prone-gates.mjs:1791-1801`, `:1903`).

**The implementation still fail-closes.** Only the assertion text is stale: the
implementation message landed in `ed06d2b4b` (2026-08-18) and the test regex dates from
`89be2563b` (2026-08-17).

## Provenance

Surfaced while reviewing an unrelated gate change. Both independent reviewers (codex
`gpt-5.6-sol` and grok-4.6) determined it is pre-existing and not caused by that change, so
it is filed rather than folded into it.

## Acceptance

- Either the fixture places the anchor under a real publication root so the intended
  zero-standing-claims path is exercised, or the assertion is updated to the message the
  implementation actually emits for this fixture — whichever preserves the property the test
  was written to prove. Decide which property that is before editing either side.
- The omitted-known-anchor fail-closed behavior is not weakened.
