# Affected-proof selector omits the public umbrella package README

**Status:** Open
**Impact:** 2
**Urgency:** 4
**Ease:** 5
**Confidence:** 5
**Systems:** CI, Affected proof selection, Packaging
**Date:** 2026-08-15
**Governing:** LLP 0189 D-1/D-2; LLP 0041 §0.1.21 and §0.1.22
**Related:** `issues/closed/20260814-umbrella-first-publish-gate.md`

## Problem

Both the push and scheduled `local-proof` runs at `main`
`a93a11235f94ac40077c8f8f3c6d420f40a9bde7`
([push](https://github.com/expo/snapback/actions/runs/31918029861),
[scheduled](https://github.com/expo/snapback/actions/runs/31918612068)) fail
`affected-selector-fixtures`.

`tests/local_proof_selection_v0.mjs` derives the expected README inventory
from every non-private package under `packages/`. That inventory includes:

```text
packages/snapback-umbrella/README.md
```

The authored `published-package-readmes` rule in
`scripts/local-proof-selection-policy.v1.json` omits that path. The package is
not hypothetical or private: LLP 0041 records its qualified first publication
in 0.1.21 and its inclusion in the 0.1.22 twelve-package closure.

The mismatch makes every affected proof that exercises the selector fixture
red even when the changed files are unrelated.

## Desired outcome

Reconcile the selector policy with the canonical public-package inventory.
The narrow repair is to add the umbrella README to the reviewed path rule; a
derived inventory is acceptable only if it preserves the policy's explicit,
reviewable fail-closed authority rather than silently broadening selection.

## Acceptance

- `node --test tests/local_proof_selection_v0.mjs` passes.
- `packages/snapback-umbrella/README.md` selects the same fast README funnel
  and JavaScript setup as the other public package READMEs.
- Private-package READMEs continue to fail closed into the complete inventory.
- Adding another public package without reconciling the selector remains a
  non-vacuous test failure.

## Resolution (2026-08-15)

Added `packages/snapback-umbrella/README.md` to the `published-package-readmes`
rule in `scripts/local-proof-selection-policy.v1.json` (the narrow reviewed-path
repair; the rule stays an explicit fail-closed inventory rather than a derived
one). Verified `node --test tests/local_proof_selection_v0.mjs`: 16 pass, 0 fail.
The umbrella README now selects the same package-readme funnel as the other
public package READMEs; private-package READMEs keep failing closed into the
complete inventory, and the fixture still fails non-vacuously when a new public
package is added without reconciling the selector.
