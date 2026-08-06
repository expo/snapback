# Published closure fences out the offline-retention contract the guide teaches

**Status:** Open — needs Charlie's ruling on what ships
**Impact:** 5
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Packaging, Local persistent store, Guide, Agent experience
**Date:** 2026-08-06
**Governing:** LLP 0041, LLP 0166
**Related:** Diary 0065; `demos/rematch-bakeoff/snapback/build-log.md`;
`guide/sync/offline-and-retention.md`

## Problem

An external consumer on `@expo/snapback-*@0.1.10` declaring
`authorityIndependent: true` is refused: the capability requires
`single_table_v1`, which the published runtime rejects as an
experimental/GAP surface ("public packages remain structured GAPs"). The
guide teaches platform-retained offline as the paved path, and it is
Snapback's largest competitive differentiator (Diary 0058 scored offline
94 vs 62) — but no npm consumer can reach it. The rematch bakeoff's cold
agent shipped an app-level cache instead, structurally identical to the
Convex arm's workaround, collapsing the offline scoring edge to 66 vs 62
(Diary 0065).

## Ask (author ruling)

Either (a) promote `single_table_v1`/the retention contract into the
published closure at the next release — LLP 0166's activation state and
the agent-safe acceptance tail govern readiness; or (b) fence the guide's
offline pages for the published-consumer audience (the `since:`/
`unreleased:` machinery from `guide/conventions.md` — but note this is a
capability gate, not a version vintage, so it may need a new fence
flavor). Option (a) is what the benchmark needs; option (b) is the honest
interim. Until one lands, every external bakeoff will re-pay this
discovery and re-forfeit the dimension.
