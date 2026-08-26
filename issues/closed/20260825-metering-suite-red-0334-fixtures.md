# Metering suite red after 0.3.4-m8: stale 0.3.3 fixtures + source-closure mismatches

**Status:** Resolved
**Opened:** 2026-08-25
**Systems:** Benchmarks, Metering
**Related:** `97a5fba1c` (instrument 0.3.4-m8 landing),
`issues/20260821-clique-instrument-observability-version-bump.md`

## Problem

After the `social-messenger@0.3.4-m8` instrument landing (`97a5fba1c`), the
metering test suite under `benchmarks/tools/social-messenger/metering/test/`
is red: 52/85 passing in a clean worktree at `c56cb359e`. Observed failure
classes from the capstone preparation round:

- retained `0.3.3-m8` fixtures rejected by the `0.3.4`-pinned
  controller/validator (fixture pins were not migrated with the bump);
- source-closure mismatches;
- local sandbox `ps` denial (environmental — discount when triaging, but
  confirm which failures remain outside a sandbox).

The E4 landing verified focused metering tests (2/2) plus the instrument
self-test, not this full suite — the fixture debt shipped silently.

## Wanted

Migrate or dual-pin the metering test fixtures for `0.3.4-m8` (retained
`0.3.3` records must stay valid **as** `0.3.3` records per the boundary-v2
rules — the tests should assert both directions), reconcile the
source-closure expectations, and re-run the full suite green outside a
sandbox. Fix-forward; does not gate the manual-shape capstone run.

## Resolution (2026-08-25)

Fixtures migrated to `0.3.4-m8` with both-direction retention assertions:
retained `0.3.3-m8` fixtures validate as implicit-v1 records (`setup`
optional, v2 refused) and current-pin fixtures require
`typingObservationBoundaryVersion: v2` with validator refusal on mismatch.
The current-pin migration now preserves the driver-stamped record-base v2
boundary, limits receipt boundary stamps to the M3 typing assertion and M3
summary, and carries the setup identity emitted by current choreography in
every summary. Its complete native-replay fabrication coverage includes the
wall-cap and joined driver-start mutations as well as tokens, phases,
orientation, charging, and eligibility.
The `meteringRoot` source-closure digest was reconciled (independently
recomputed by the orchestrator with the canonical directory-digest
algorithm) for the original 85-test migration. That suite was 85/85 outside
the sandbox; the review fix adds the restored current-pin replay case, whose
focused execution passes, and requires the orchestrator to re-reconcile the
digest before the new 86-test full-suite result can be recorded. The remaining
in-lane non-digest failures are proven sandbox `ps`-probe denials, not product
state.
