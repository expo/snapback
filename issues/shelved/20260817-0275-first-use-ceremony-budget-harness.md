# LLP 0275: retain and gate the first-use ceremony budget

Status: Open

Authority: Draft LLP 0275 D6/D7; related to LLP 0196, LLP 0198, Diary 0091,
and `issues/closed/20260817-react-template-typecheck-node-types.md`.

## Problem

The package cold-install suite proves several template facts, but the Bugboard
build still found a clean-scaffold TypeScript failure and a manual runtime
qualification step. Individual stage tests can stay green while the actual
first-use sequence accumulates platform-owned commands and repairs.

## Scope

- Add an out-of-repository packed-npm first-use run for supported templates.
- Record commands, manual platform prerequisites, application-policy
  declarations, duplicated derivable declarations, correction loops, and final
  receipt level in a stable machine artifact.
- Gate the exact advertised template sequence: scaffold, install, typecheck/
  build, supervised dev readiness, and one proof command.
- Retain the current Bugboard run as the before baseline and rerun the same
  brief after LLP 0275 rollout steps.
- Turn introduced template-owned ceremony or broken advertised commands into a
  release failure; use fix-forward tickets for explicitly baselined existing
  residue according to repository policy.

## Acceptance

- The harness runs from packed public-shape bytes without workspace hoisting,
  sibling checkouts, or preexisting app-local receipts.
- The React scaffold passes its own typecheck and build with no edits.
- `dev` owns generation/start/load/client readiness and `prove` owns every
  applicable readiness and registered-acceptance prerequisite.
- The report distinguishes security/application decisions from derivable facts,
  environment-integrity checks, and evidence declarations.
- A template cannot improve its score by dropping a runtime check, weakening a
  result contract, or changing a journey-proven receipt to
  `passed-without-acceptance`.
- The rerun publishes before/after manual declaration and command counts plus
  the unchanged guarantee/claim level.
