# Guide gap: incremental live deltas require a schema-derived result contract

**Status:** Closed
**Resolved:** 2026-08-02
**Systems:** Guide, Live queries, Result contracts
**Related:** LLP 0008, LLP 0061, LLP 0108; proof greening gate 15

## Problem

`guide/realtime/live-queries.md` said that analyzable unordered/filtered live
queries receive `live_delta`, and used
`demos/_kit/tests/live-delta-e2e.mjs` as its executable example. It did not say
that production admits that incremental lane only when the query carries the
exact schema-derived `Documents` result contract. A hand-built manifest that
followed the page's visible shape loaded successfully but conservatively
received `live_replace`.

The 2026-08-02 main-proof greening lane hit exactly that trap after `eda8f231`
correctly made result-contract authority load-bearing for raw-row delta
publication. The example itself had drifted and the guide offered no authoring
clue that connected the observed fallback to the missing contract.

## Resolution

Resolved on 2026-08-02. The executable fixture had already been repaired in
`754ced31` to derive its exact contract and hash through codegen. The Live
queries guide now names that contract as an incremental-publication
precondition, explains that ordinary authored queries receive it from codegen,
forbids hand-authored narrower descriptors, and gives the complete conservative
fallback checklist. Because the page now explains how to diagnose the fallback
without overstating support, no new capability-index GAP is needed. The guide's
generated manifest and flat projection were refreshed in the closing landing.

## Exit

- The schema-derived result-contract precondition is explicit in “What
  arrives: replace and delta.”
- The page's executable example and guide projections are fresh.
- The page explains the conservative replacement cases completely, so the
  existing witnessed `realtime.live-queries` capability row remains honest.
