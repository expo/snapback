# Guide gap: Contract UI needs a callable-query composition pattern

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 4
**Confidence:** 5
**Systems:** Guide, Contract adapter, Standard patterns
**Date:** 2026-08-01
**Governing:** LLP 0061, LLP 0100

The Team Chat LLP 0100 adoption needs a complete Contract UI for generated
`firstRoomMessagePage` / `nextRoomMessagePage` queries. The Contract guide
explains generated live-query and mutation links, and the standard-pattern
guide correctly says page pairs are callable-only, but neither page shows the
intended composition when a Contract product screen needs a callable query.

The demo therefore keeps its live room and actions in compiled Contract while
a small host control invokes the generated page references through the
ordinary Snapback client. That is honest and executable, but an author should
not have to infer this boundary from package APIs.

## Acceptance

- the Contract guide states whether callable queries belong in Contract data
  links or in a host/client control;
- it gives one CI-verified generated-reference example with loading, terminal,
  refusal, and disposal behavior; and
- the capability index links the example from callable keyset pagination.
