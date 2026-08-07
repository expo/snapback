# Qualified `--publish` path structurally unrunnable: receipt validator demands a deleted GitHub workflow

**Status:** Closed
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Packaging, Deployment, Testing
**Date:** 2026-08-06
**Related:** LLP 0041 (publish machinery), LLP 0111 (release ledgers),
`issues/20260803-first-npm-latest-promotion.md` (found during its preflight),
`issues/closed/20260805-eas-qualified-receipts-rejected-by-publish-validator.md`
(the consolidated-duplicate first-production report, with the retained 0.1.9
staging receipts and run identifiers this fix was designed against)

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

## Resolution

Closed 2026-08-07. The cold-install receipt now mints a complete EAS-hosted
provenance family only on an EAS cloud runner with all bound build, project,
commit, and workflow identities present. Qualified staging accepts either the
existing GitHub family or the new EAS family with exact proof/machine binding;
all other publication-proof callers remain GitHub-only by default. The EAS
workflow injects its filename and run id into both staged-proof jobs, and the
Node test corpus covers both happy paths, incomplete/local minting, mutual
exclusion, identity/workflow/runner/commit drift, and the GitHub-only default.

Evidence base: the first-production 0.1.9 staging run recorded in
`issues/closed/20260805-eas-qualified-receipts-rejected-by-publish-validator.md`
(workflow run `019fd366-7f4c-7998-a1ff-1c4382ac338d`) confirms
`RUNNER_ENVIRONMENT: eas-hosted` reaches the receipt on real EAS runners, and
its run identifiers are UUID-shaped as the validator now requires. Residual
verification owed to the next qualified staging run: that `EAS_BUILD`,
`EAS_BUILD_RUNNER`, `EAS_BUILD_ID`, `EAS_BUILD_PROJECT_ID`, and
`EAS_BUILD_GIT_COMMIT_HASH` are all populated in these generic workflow jobs
and that `${{ workflow.filename }}` interpolates to the bare filename. If any
identity input is absent the minter deliberately records no half-proof
(`easProof: null`, clean-machine false), so a gap surfaces as a refused
receipt naming the missing binding, not as a silently accepted one. 0.1.10
through 0.1.12 still shipped fast-path; the first post-fix qualified staging
rerun is the definitive end-to-end proof.
