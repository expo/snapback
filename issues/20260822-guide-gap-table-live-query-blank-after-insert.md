# guide-gap: table live queries can go empty after a same-table insert

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 4
**Systems:** Guide, Live queries, React/Expo, Codegen
**Date:** 2026-08-22
**Governing:** LLP 0008; LLP 0061
**Evidence:** Diary 0106 M2/M3; Clique local-main Grok Explicit on
`b70caf19ea`

## Problem

A handwritten table live query filtered by `eq('_id', …)` or by parent id
can publish **no rows** immediately after a successful insert into the same
table. The mutation settles, related counters can increment, and the
subscribed point/list query then renders empty (Clique: thread screen
stuck on “Loading thread…”; later, DM bubbles missing until the query
became JS).

JS live queries that re-run the handler on writes restored the rows. The
start packet and live-query Guide page do not say that table incremental
deltas and JS replace semantics diverge this way, or when to pick JS.

This is distinct from Familiar six-subscription contention
(`issues/20260820-familiar-live-subscription-contention.md`) and from the
closed owner-visibility-exit delta leak
(`issues/closed/20260812-live-delta-owner-visibility-exit-skipped.md`).

## Required change

- Document, with a failing-then-fixed example, that a table live query on
  `eq('_id')` / parent-id after a same-table insert may go empty, and that
  `defineJsLiveQuery` re-runs and keeps the row.
- Name the selection rule in the queries / live-queries pages and in
  `snapback guide` aliases (`blank after insert`, `Loading thread`,
  `live_delta empty`).
- If this is a matcher/delta defect rather than intended physics, fix the
  incrementalizer so a just-inserted matching row cannot disappear from an
  already-subscribed point query; keep the Guide warning until that fix
  ships.

## Acceptance

- A cold agent following the Guide for a point live query plus insert does
  not have to discover JS live queries by watching the UI go blank.
- A minimized reproduction either fails a product test (if defect) or is
  cited as the documented JS-vs-table recipe (if intended).
