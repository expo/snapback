# Qualified `--publish` path structurally unrunnable: receipt validator demands a deleted GitHub workflow

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Packaging, Deployment, Testing
**Date:** 2026-08-06
**Related:** LLP 0041 (publish machinery), LLP 0111 (release ledgers),
`issues/20260803-first-npm-latest-promotion.md` (found during its preflight)

## Summary

The real-publish path of `scripts/snapback-publish.mjs` cannot accept the
receipts the qualified staging lane actually produces:

- `validateQualifiedPlatformReceipts`
  (`scripts/snapback-publish-core.mjs:1449-1476`) requires provenance from
  `expo/snapback/.github/workflows/qualified-package-staging.yml` with
  `machine.runnerEnvironment === 'github-hosted'`, non-null GitHub run
  identifiers, and `machine.separatelyProvisionedCleanMachine === true`.
- That GitHub workflow was deleted when staging moved to EAS
  (`.eas/workflows/qualified-package-staging.yml`). On EAS,
  `GITHUB_ACTIONS` is unset, so
  `scripts/snapback-package-cold-install.mjs:2898-2916` records
  `githubProof: null` and `separatelyProvisionedCleanMachine: false`.
- Net: no receipt any current infrastructure can mint satisfies the
  validator. This is presumably why 0.1.8 went fast-path; 0.1.9 is going
  fast-path for the same reason (LLP 0041's standing pre-consumer ruling).

## Ask

Teach the cold-install receipt an EAS-hosted provenance shape (workflow
ref, EAS run/build IDs, clean-machine assertion appropriate to EAS
runners) and teach `validatePublicationReceiptProvenance` to accept
either provenance family — or re-point `expectedWorkflow` at the EAS
workflow with equivalent identity binding. Until then, every promotion is
forced onto the fast path and the qualified ceremony exists only on
paper.
