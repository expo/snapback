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

## Acceptance

One versioned kit/choreography release carries a migration note and static
vocabulary check. A clean control lane can drive every newly required behavior,
classify every forced failure on the first line, and retry one failed assertion
without rerunning unaffected checks. Missing setup/linkage refuses before the
authoring clock. LLP 0281's recurring structural skips are either required and
observable or explicitly retained as scoped nonclaims—never silent optional
folklore.
