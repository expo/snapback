# Guide gap: Contract UI needs a callable-query composition pattern

**Status:** Resolved (2026-08-03)
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

## Resolution (2026-08-03)

Absorbed in the guide triage pass. `guide/clients/contract-adapter.md` gained
"Call a paged query from a Contract screen": callable page pairs are not
Contract data links — the paved composition is a host/client control invoking
the generated references beside the compiled Contract surface. The section
transcludes the Team Chat host control
(`demos/team-chat/surfaces/contract/main.ts`, exercised by
`demos/team-chat/tests/acceptance/contract-browser.mjs`), covering loading,
terminal (`cursor === null`), refusal (rejection path clears accumulated
rows), and disposal (`disposed` gate on both settlement paths), plus the
seat-revocation live-query pairing. `guide/backend/standard-patterns.md` links
the composition from its callable-only paragraph, and the
`backend.standard-patterns` capability row now carries the `callable
pagination` keyword and the contract-adapter page link.
