# Guide gap: incremental live deltas require a schema-derived result contract

**Status:** Open
**Systems:** Guide, Live queries, Result contracts
**Related:** LLP 0008, LLP 0061, LLP 0108; proof greening gate 15

## Problem

`guide/realtime/live-queries.md` says that analyzable unordered/filtered live
queries receive `live_delta`, and uses
`demos/_kit/tests/live-delta-e2e.mjs` as its executable example. It does not say
that production now admits that incremental lane only when the query carries
the exact schema-derived `Documents` result contract. A hand-built manifest
that follows the page's visible shape loads successfully but conservatively
receives `live_replace`.

The 2026-08-02 main-proof greening lane hit exactly that trap after `eda8f231`
correctly made result-contract authority load-bearing for raw-row delta
publication. The example itself had drifted and the guide offered no authoring
clue that connected the observed fallback to the missing contract.

## Exit

- Explain the schema-derived result-contract precondition in “What arrives:
  replace and delta,” including that codegen supplies it for ordinary authored
  queries and hand-built manifests must not invent a narrower descriptor.
- Keep the page's executable example and guide manifest fresh after its proof
  fixture is repaired.
- Add a capability-index note or explicit GAP row if the guide cannot yet
  explain/debug conservative replacement fallbacks completely.
