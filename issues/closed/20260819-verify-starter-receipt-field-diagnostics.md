# Report exact starter-receipt completeness failures

**Status:** Closed
**Impact:** 4
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** CLI, Verification, Templates, Diagnostics
**Date:** 2026-08-19
**Governing:** LLP 0146 D2, LLP 0275 D5, LLP 0294 W1

## Problem

`packages/snapback-cli/verify.mjs` reduces the
`snapback.starter-acceptance.v1` completeness contract to one boolean. A
receipt can report `status: "passed"`, exit 0, and execute every visible check
but still fail with:

> starter acceptance exited 0 or returned an incomplete receipt

One observed cause was renaming `operations.queryFunctionId` and
`operations.mutationFunctionId` to domain-specific keys. The diagnostic did
not name either missing path, forcing the author to read installed package
source and manually diff the receipt against the predicate.

## Required change

- Represent completeness validation as path-addressed checks rather than one
  short-circuit boolean.
- On failure, report the first actionable path and preferably the complete
  bounded set of invalid paths, each with expected and observed kind/state.
- Preserve stdout/stderr bounds and never echo application payload values.
- Distinguish process failure, missing receipt, malformed receipt, failed
  receipt, and incomplete passing receipt.
- Reconcile the fixed operation-key contract with LLP 0275 D5's
  generated-reference-backed path identity so domain renames become a stale
  registration remediation rather than a hidden structural requirement.

## Acceptance

- Omitting each required leaf independently produces a diagnostic naming that
  exact JSON path.
- Renaming both operation keys reports both missing canonical identities or the
  single stale-registration remediation selected by LLP 0275 D5.
- Exit 0 plus a passed-but-incomplete receipt does not present exit status or
  receipt status as the apparent failing fact.
- Existing timeout, output-limit, child-error, failed-check, cleanup, and
  identity-mismatch cases retain stable codes and bounded details.
- A fresh scaffold's valid receipt still passes unchanged.

## Resolution (2026-08-21)

Replaced the opaque completeness predicate with bounded path-addressed
validation. Diagnostics now distinguish process failure, missing receipt,
malformed receipt, failed receipt, and an incomplete passing receipt; invalid
paths carry expected and observed kind/state without receipt payload values.

For simultaneous operation-key renames, verification emits the single typed
stale-registration remediation required by LLP 0275 D5. It names the stale
canonical receipt paths and the new unclaimed operation paths without silently
claiming the replacements.

Added coverage for independently omitting every required leaf, both renamed
operation keys, all five outcomes, stable special-case codes, detail bounds,
multiple/truncated path failures, identity mismatch, cleanup failure, and an
unchanged valid receipt.

**Landing SHA:** fc2eb317f (with review-fix commits on the same push)
