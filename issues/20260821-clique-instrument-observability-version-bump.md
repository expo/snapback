# Ship the coordinated Clique instrument-observability version bump

**Status:** Open
**Opened:** 2026-08-21
**Systems:** Benchmarks, Clique UI kit, Choreography, Run records, Agent
experience, Testing
**Governing:** LLP 0281 W2/W3/W5-W8; LLP 0201; LLP 0295 W6
**Related:** `issues/20260815-clique-choreography-typing-observation-boundary.md`;
`issues/20260809-per-milestone-token-metering.md`;
`issues/20260820-matrix-lane-skill-routing-context-budget.md`

## Problem

The frozen instrument still cannot drive or observe media composition,
semantic receipt transitions, sender-avatar identity, or membership lifecycle.
It also permits late suite-status linkage failures, broad text selectors,
shared-page poisoning, and repeated rediscovery of layout assumptions. These
defects create correction loops and can steer product design toward fixing the
measurement artifact.

LLP 0281 intentionally batches the observable UI/driver changes into one
versioned kit and choreography migration so the freeze cost is paid once.

## Scope

- Add structural media picker/attachment vocabulary and two-client media
  delivery checks.
- Add semantic receipt, avatar-identity, group aggregate, and member
  add/remove/promote/leave vocabulary and drivers.
- Require first-line outcome classification: application, Snapback/platform,
  external provider/setup, or instrument.
- Refuse runner startup when required suite-status linkage or setup identity is
  absent.
- Replace text-regex matches with structural selectors where available and
  isolate assertion retries so one poisoned route/page does not manufacture
  unrelated timeouts.
- Make profile-navigation and heading/layout obligations explicit in the kit
  or choreography contract.
- Record qualified-binary versus wrapper identity, packed/prepack closure,
  declared toolchain, host load, and API interruption as structured setup
  fields.
- Generate the mechanical run/diary aggregates from one structured record
  while retaining qualitative narrative separately.

The typing-boundary ticket remains its own corruption-class repair; this bump
depends on its disposition and carries its migrated observation boundary.
Per-milestone token metering and context routing remain their own tickets but
must be schema-compatible with this version.

## Implementation update — 2026-08-23 (LLP 0295 R2 start blockers)

The R2-gating observability slice is implemented in this change. No measured
R2 cell has started:

- The social-messenger extension remains `extensionVersion: 2` and gains
  optional additive, hash-linked per-milestone fields for the closed semantic
  action taxonomy/dispositions, failure-to-recovery carrier/attribution/outcome
  projections, restart/reseed counts, suite/choreography assertion attempts and
  wait wall, host-load samples/breaches, and API-interruption windows. The
  validator checks aggregate equalities and contamination/linkage consistency.
- `suiteStatusLinkage` hash-binds the input plus retained suite receipts.
  Choreography now refuses a missing input or a missing selected-segment entry
  before credentials, Playwright import, receipt creation, or browser startup.
- The instrument is bumped to `social-messenger@0.3.3-m8` / choreography
  `0.3.3-m8`; UI remains `0.3.1-m8` and schema remains `0.3.0-m8`. The frozen
  manifest now pins both record schemas, their validator, and the unchanged W2
  metering directory so the coordinated bump cannot discard landed metering.
- The migration note and static choreography-to-`CONTRACT.md` vocabulary check
  ship with the bump. Old version-2 records and retained `0.3.2-m8` metering
  receipts remain valid.

Verification at the implementation boundary: metering `17/17`, lane
setup/schema `10/10`, choreography calibration green including both startup
refusals, and the frozen twelve-cell R2 `validate-plan.mjs` green from its
preregistered `sbs/0295-r2-rerun` worktree. `./ref-check --verbose` is green
with 0 errors and 0 unchecked references.

This ticket remains open: the broader LLP 0281 media/receipt/avatar/membership,
selector-isolation/layout, setup-identity, and generated-report acceptance is
outside this R2 start-blocking slice and is not claimed complete here.

## Acceptance

One versioned kit/choreography release carries a migration note and static
vocabulary check. A clean control lane can drive every newly required behavior,
classify every forced failure on the first line, and retry one failed assertion
without rerunning unaffected checks. Missing setup/linkage refuses before the
authoring clock. LLP 0281's recurring structural skips are either required and
observable or explicitly retained as scoped nonclaims—never silent optional
folklore.
