# Publish gate cannot accept any receipt the current staging lane can produce

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Packaging, Deployment, Testing
**Date:** 2026-08-06
**Related:** LLP 0041 (publish machinery), commit 4de409ab7 (staging moved to
EAS), `issues/20260806-qualified-publish-eas-provenance-blocker.md` (filed
independently the same day — same defect, should be merged with this one),
`issues/20260803-first-npm-latest-promotion.md`

## Summary

Found by today's promotion-machinery audit: the publish gate cannot accept
any receipt the current staging lane can produce.

- `validatePublicationReceiptProvenance`
  (`scripts/snapback-publish-core.mjs:1457-1461` call site, `:579`,
  `:587-591`) requires `receipt.githubProof` to be a complete object with
  `workflowRef ===
  'expo/snapback/.github/workflows/qualified-package-staging.yml@<ref>'`
  and `machine.runnerEnvironment === 'github-hosted'`.
- That GitHub workflow no longer exists: commit 4de409ab7 deleted
  `.github/workflows/qualified-package-staging.yml` and moved staging to
  `.eas/workflows/qualified-package-staging.yml`, whose jobs set
  `RUNNER_ENVIRONMENT=eas-hosted` (lines 246, 286).
- On EAS runners `GITHUB_ACTIONS` is unset, so the cold-install receipt
  records `githubProof: null`
  (`scripts/snapback-package-cold-install.mjs:2898-2917`).
- Net: every future ceremony publish refuses with
  `receipt GitHub proof must be an object`. Until fixed, only the LLP 0041
  fast-path can release.

## Ask

Either widen the provenance validator to admit a first-class EAS provenance
shape — workflow ref, EAS run/build identity, and a clean-machine assertion
appropriate to EAS runners, with its own dated LLP 0041 note — or restore a
GitHub-hosted staging lane that can mint the provenance the validator
demands. Merge with
`issues/20260806-qualified-publish-eas-provenance-blocker.md`, which reached
the same conclusion via `validateQualifiedPlatformReceipts`.
