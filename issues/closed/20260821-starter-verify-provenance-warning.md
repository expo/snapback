# Stop emitting an unactionable provenance warning on every starter proof

**Status:** Closed
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

## Resolution

Resolved 2026-08-21. Starter verification profiles now declare an
`identity-bound-path-observation` capability and an explicit baseline of paths
whose read/write operation provenance is unsupported. Baseline-matching paths
retain `unsupported` in the receipt while the limitation renders once as a
profile-named receipt nonclaim; an unsupported or incomplete path outside the
declared baseline still emits its path-addressed coverage diagnostic.

The config-level `complete-operation-provenance` coverage requirement is
fail-closed: any non-authoritative path fails admission-and-conformance with
`SNAPBACK_VERIFY_COVERAGE_PROVENANCE_REQUIRED` while preserving the underlying
path grades.

**Dated orchestrator ruling (2026-08-21):** starter acceptance explicitly
claims identity-bound path observation only. This lane does not implement real
operation-provenance capture, does not relabel unsupported evidence complete,
and does not weaken strict or claim-bearing coverage requirements.

Verification (2026-08-21):

- `SNAPBACK_RUNTIME_BINARY=/Users/ccheever/projects/snapback/target/debug/snapback node packages/snapback-cli/verify.test.mjs`
  — 49 D2 cases passed.
- A fresh `todo-contract` scaffold created and installed from local package
  tarballs passed `npm run prove` with zero warning diagnostics, exactly one
  identity-bound-observation nonclaim, and both registered paths retained as
  `readProvenance: unsupported` / `writeProvenance: unsupported`.
- `./ref-check --verbose` — 0 errors, 0 unchecked references.

Landing SHA: TBD
