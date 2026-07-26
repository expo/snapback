# Gate-matrix `category` decides adjudication but is never validated

**Status:** Resolved (2026-07-26)
**Severity:** P2
**Systems:** Competitive checkpoint, Acceptance testing, Instruments
**Author:** Claude (Opus 5), directed by Charlie Cheever
**Date:** 2026-07-25
**Related:** LLP 0074, LLP 0075; PR #4 (`984b6a06`);
`demos/competitive-checkpoint/acceptance/instruments/gate-matrix.v0.mjs`
**Program:** issues/20260723-llp0075-checkpoint-program.md (pre-timed-run program index)
**Marker:** competitive-checkpoint, gate-matrix, llp-0075

`evaluateGateReceipt` splits gate failures on the exact string literal
`'arm-specific-authoring'` (gate-matrix.v0.mjs:119-120) to produce two
independent verdicts, `productCompletenessPass` and
`armSpecificConstraintsPass`. `adjudicateCheckpoint` in `scoring.v0.mjs` then
turns `productCompletenessPass === false` into a `reprioritize` outcome on
`product-completeness` — a checkpoint-level decision.

`validateGateMatrix` validates everything else about a gate — closed key set,
id shape, required arms, N/A arms, `expectedOutcome`, non-empty `requirement`
prose — but never validates `category`. `assertClosedKeys` only rejects
*unknown* keys, so `category` is not even required to be present.

Demonstrated against the shipped `gate-matrix.candidate.v0.json` (36 gates, 3
of them `arm-specific-authoring`), failing one arm-specific gate:

    as-shipped        validateGateMatrix=ACCEPTED  productCompletenessPass=true   armSpecificConstraintsPass=false
    category typo'd   validateGateMatrix=ACCEPTED  productCompletenessPass=false  armSpecificConstraintsPass=true
    category deleted  validateGateMatrix=ACCEPTED  productCompletenessPass=false  armSpecificConstraintsPass=true

Both mutations are accepted by the validator and both flip the checkpoint
verdict. The dangerous direction is the mirror image of the case above: a
genuine product gate mislabeled `arm-specific-authoring` is excused from
product completeness entirely, so a real product failure adjudicates as
`continue`. The matrix is a candidate artifact that will be edited by hand
before ratification, which is exactly when a category typo is introduced.

## Proposed fix

1. Add a closed category enum (`product`, `stream`, `negative-authorization`,
   `hosted-lifecycle`, `cleanup`, `compatibility`, `arm-specific-authoring` —
   the seven the shipped matrix uses) and require `category` on every gate in
   `validateGateMatrix`.
2. Add `gate-matrix.test.mjs` cases asserting an unknown category and a missing
   category are both rejected.
3. Regenerate `gate-matrix-lock.candidate.v0.json`, which pins the instrument
   bytes.

## Secondary finding in the same function

`evaluateGateReceipt` lists `runId` in its closed key set but never validates
it, while `capsuleSha256` alongside it is digest-checked. Worth constraining to
the same identifier shape the other instruments use.

## Resolution

`validateGateMatrix` now requires every gate category to be one of the seven
enumerated candidate categories. Direct regressions prove that both a missing
category and an unknown category fail validation before they can alter the
product-versus-arm-specific adjudication split.

`evaluateGateReceipt` now also requires `runId` to be a string in the shared
stable-identifier shape; missing and non-string cases have direct regressions.
The complete candidate instrument suite passes. The refreshed candidate gate
matrix lock is sha256
`ea293bfc18d9fac4e2389f8aa4b9b0f59aef75734b269685a38c4dc7f3e328d1`.
It remains unratified and authorizes no timed run.
