# EAS qualified receipts are rejected by the real-publication validator

**Status:** Open — P0, blocks npm candidate publication
**Opened:** 2026-08-05
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Severity:** P0
**Systems:** Packaging, CI, Publication authority
**Related:** LLP 0041, LLP 0113,
`issues/20260801-staging-lane-90min-is-structural-waste.md`,
`issues/20260803-first-npm-latest-promotion.md`,
`issues/20260805-0134-npm-promotion-route-undefined.md`

## First-production-use finding

The qualified EAS staging workflow completed successfully for version `0.1.9`
at exact source `4c8245a1a05e4f5f724771e7557f9a583bac2410`:

- workflow run `019fd366-7f4c-7998-a1ff-1c4382ac338d`;
- both source-bound runtime builds, nine-package assembly, both staged
  cold-install proofs, and final retention reported `SUCCESS`;
- retained release artifact id `019fd37a-6f5e-76d9-9d80-18b0767d123a`,
  downloaded archive SHA-256
  `feea37839dfd2e426eab0b1376886fe8972a86af20d98c6b166a348e77249b81`;
- qualified ledger file SHA-256
  `f1501bd223eea5f69366624177e6c2530d900657ebc820d7c6e1940bab0b41cd`,
  with self-digest
  `8a4a171700087032bab5cf780f3769678d9ba9a219583e955d5fdd8c46ed8b29`;
- macOS staged-receipt SHA-256
  `99f491e231109c37492d419366275cfc21577774598395ad10c6a7e9e7f0db6f`;
  Linux staged-receipt SHA-256
  `464fed1f7ad6c5ace22805bdc58abf9284c21e240017e27de7af3cd289ff7b80`.

The repository's production-path validators admit the qualified ledger and
all nine retained tarballs. They reject the retained platform receipts before
any npm mutation:

```text
TypeError: receipt GitHub proof must be an object
```

Both receipts truthfully contain:

```text
githubProof: null
machine.runnerEnvironment: "eas-hosted"
machine.separatelyProvisionedCleanMachine: false
```

`validateQualifiedPlatformReceipts` instead calls
`validatePublicationReceiptProvenance` with expected workflow
`qualified-package-staging.yml` and requires a GitHub-hosted runner, a
non-null GitHub Actions proof object, and
`separatelyProvisionedCleanMachine: true`. `snapback-publish.mjs --publish`
unconditionally runs that validator, so the only artifacts emitted by the
current qualified workflow cannot be consumed by the real-publication lane.

## Attribution

The receipt consumer and GitHub provenance hardening landed in `153a9d1665`
and `543231040d`. The staging workflow later moved from GitHub Actions to EAS
in `4de409ab7` and its follow-through through `b22841b0e`, but the producer /
consumer provenance contract did not move with it. The timing ticket's stated
exit says the EAS lane produces identical qualified receipts; first production
use demonstrates that they are not authority-equivalent at the publication
boundary.

This is publication-proof machinery debt, not package correctness and not a
PUSH-01 or F0a correctness failure. No receipt field was rewritten and no
GitHub identity was imputed to an EAS run.

## Required resolution

Choose and implement the publication-proof substrate under LLP 0041/0113:

1. retain EAS for build/assembly but run the two authoritative staged proofs
   in the expected GitHub-hosted workflow, binding the transported EAS
   tarballs and exact source; or
2. define an EAS-hosted provenance object and validation path with an
   independently verifiable workflow/run identity and the same clean-machine,
   source, operation, and artifact bindings.

Do not resolve this by setting `separatelyProvisionedCleanMachine` true,
inventing `githubProof`, or weakening `validateQualifiedPlatformReceipts`.
Update the producer, consumer, workflow inventory, tests, and the governing
LLP in one landing, then rerun qualified staging and consume the retained
artifacts through the unchanged real-publish command.
