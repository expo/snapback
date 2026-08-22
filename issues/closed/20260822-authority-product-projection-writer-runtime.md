# Implement generated authority product projection at the writer seam

**Status:** Closed — 2026-08-22
**Opened:** 2026-08-22
**Systems:** Membership authority, storage, code generation, host runtime, CLI
**Governing:** LLP 0056; LLP 0240 D0.4; LLP 0295 W4
**Related:** `issues/closed/20260821-private-authority-product-roster-decision.md`

## Scope

Implement the selected platform-generated authority projection: profile
declaration and validation, full-provenance activation, writer-seam row-image
capture, history/incarnation reads, bounded recipient snapshots, activation
horizon/backfill, migration comparison, and the closed three-class outcome
matrix.

## Acceptance

- Projection declarations cannot duplicate authority axes or D3 roster-visible
  fields and require `provenance: "full"`; historical authority axes follow
  `roster.visible`, and private incarnation ids remain host-only.
- Every membership writer class reaches same-transaction row-image capture;
  same-role changes are no-write idempotent successes and leave/rejoin creates
  distinct incarnations.
- Generated D1 history/incarnation reads preserve `list` and `myRole`, admit
  before cursor handling, and expose an envelope-level history horizon.
- Recipient snapshots are bound to exact generated sending operations and
  declared product-row sinks, freeze active principals without returning them
  to handler JavaScript, and refuse above the declared ceiling (max 1,024).
- `snapback authority plan` compares an app mirror without exposing values;
  confirmed backfill moves the horizon only with
  `authorization-facts-only` coverage.
- The generated manifest pins every absent/idempotent branch to one of the
  three accepted outcome classes.

## Resolution

Implemented in the authority profile code generator, membership writer plans,
SQLite writer seam, engine host glue, handler bootstrap, manifest validation,
and authority CLI. Focused storage fixtures cover activation, idempotent
backfill, writer transitions, horizon facts, recipient ceilings, and
incarnation semantics, pending-invite omission, roster-axis redaction, and the
privileged seed path; codegen fixtures cover every corrected outcome class.
The 2026-08-22 blocking-review fix also classified/copied both projection
tables through fork mint and added a projection-bearing fork smoke test.
