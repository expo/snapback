# `deriveSampleMetrics` admits any unknown `sample-finished.outcome` as valid

**Status:** Resolved (2026-07-26)
**Severity:** P2
**Systems:** Competitive checkpoint, Acceptance testing, Instruments
**Author:** Claude (Opus 5), directed by Charlie Cheever
**Date:** 2026-07-25
**Related:** LLP 0074, LLP 0075; PR #4 (`984b6a06`);
`demos/competitive-checkpoint/acceptance/instruments/metric-events.v0.mjs`
**Program:** issues/20260723-llp0075-checkpoint-program.md (pre-timed-run program index)
**Marker:** competitive-checkpoint, metric-events, llp-0075

`metric-events.v0.mjs` opens by declaring its own contract: "Raw events remain
the authority; this module rejects ambiguous ledgers instead of guessing." It
validates event kinds, classifications, milestones, monotonic ordering, command
pairing, and token counts against closed sets — but the one field that decides
whether a timed sample counts is checked with a single equality test:

    const invalid = sampleFinished.outcome === 'instrument-invalid';   // line 179

`metric-events.candidate.v0.schema.json` constrains `outcome` to the enum
`["valid", "instrument-invalid"]`. The module does not. Any string outside the
enum — including a case variant of the invalidating value — silently derives
`valid: true`:

    outcome sent: INSTRUMENT-INVALID
    deriveSampleMetrics -> valid: true | instrumentFailures: 0

A sample an operator marked instrument-invalid is then eligible for the
seven-valid-samples set that `scoring.v0.mjs` medians and bootstraps, which is
the number the competitive claim rests on. This is precisely the "guessing"
the header disclaims.

`instruments.test.mjs` compiles the schema with Ajv and asserts both the schema
and the module accept the good fixture and reject the malformed one — but the
two run as independent checks on shared fixtures. Nothing binds the module to
the schema, and nothing in the repository schema-validates a receipt before
handing it to `deriveSampleMetrics`; the module is the only runtime authority
on the collection path.

## Proposed fix

1. Reject any `sample-finished.outcome` outside `{valid, instrument-invalid}`
   in `deriveSampleMetrics`, with the same `TypeError` discipline the rest of
   the module uses.
2. While there: `command-started` accepts an absent or non-string `commandId`
   and a non-boolean `authored` (lines 110-118, 196-200). Constrain both to the
   shapes the schema already declares.
3. Add an `instruments.test.mjs` case asserting an out-of-enum outcome throws,
   rather than only asserting the schema rejects it.
4. Regenerate `instrument-lock.candidate.v0.json`.

## Ratification note

The instrument is still candidate and no timed sample has been collected, so no
published number is affected. It must land before samples are taken.

## Resolution

`deriveSampleMetrics` now fails closed unless `sample-finished.outcome` is
exactly `valid` or `instrument-invalid`. It also requires every
`command-started.commandId` to be a string in the shared stable-identifier
shape and requires `authored` to be boolean; receipt and agent-session
identifiers use the same strict string check rather than regular-expression
coercion.

Direct regressions prove that an unknown outcome, missing command ID,
non-string command ID, and non-boolean authored marker are each rejected by
both the JSON schema and the runtime projection. The complete candidate
instrument suite passes. The refreshed candidate instrument lock is sha256
`e4019f498d8cbc19962121a960a082b5657d80735ba0c377da5fb2d673b75cd9`.
It remains unratified and authorizes no timed run.
