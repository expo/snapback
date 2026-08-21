# Stop emitting an unactionable provenance warning on every starter proof

**Status:** Open
**Impact:** 3
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Verification, Diagnostics, Templates, Agent experience
**Date:** 2026-08-21
**Governing:** LLP 0146 D1/D2; LLP 0275 P4/P6
**Evidence:** Messtimate published-0.1.24 diary; current
`packages/snapback-cli/verify.mjs::unsupportedConformance`

## Problem

The starter-acceptance adapter synthesizes `readProvenance: 'unsupported'` and
`writeProvenance: 'unsupported'` for every registered path. A successful
starter proof consequently emits coverage-provenance warnings that the author
cannot repair in app code. Repeating an unavoidable warning on every green run
trains users and agents to ignore the warning channel, reducing the value of
real coverage diagnostics.

`unsupported` is an honest evidence fact and must not be relabeled complete.
The defect is presentation and ownership: an invariant limitation is rendered
like a per-run application problem.

## Required change

- Decide whether starter acceptance should capture real operation provenance or
  explicitly claim only identity-bound path observation.
- Until complete provenance exists, render the limitation once as a profile
  capability/nonclaim rather than an actionable warning on every passing path.
- Keep strict/claim-bearing modes fail-closed when complete provenance is
  required.
- Ensure a newly introduced incomplete/unsupported path still differs visibly
  from the profile's declared baseline.

## Acceptance

- A stock packed starter's green `prove` run contains no warning the author
  cannot act on.
- The receipt still records the honest provenance grade and never upgrades
  unsupported evidence to complete.
- Strict coverage claims fail when the selected profile cannot supply the
  required provenance.

