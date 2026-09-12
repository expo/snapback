# The shipped hub search form costs one certified request per membership per search

**Status:** Open
**Priority:** P1
**Date:** 2026-09-11
**Systems:** Snapback 2 `snapback2/global-search-pager`, `guide fanout` "Search every chat", `dist/guide/recipes/global-message-search.ts`; LLP 1023.001; LLP 1019 `deliver`; LLP 1012 "Indexed held search"
**Related:** [closed/20260911-snapback2-hub-scale-certified-query-envelopes.md](./closed/20260911-snapback2-hub-scale-certified-query-envelopes.md) (`49f504f8b5`); [LLP 1023.001](../llp/1023.001-hub-scale-certified-reads.plan.md); [0.0.25 run](../benchmarks/runs/2026-09-11-snapback2-0025-clique-linux/README.md)

## Symptom

`49f504f8b5` closed the hub-scale envelope ticket by shipping a legal form for
global message search: page the viewer's whole membership directory, issue one
certified `last 1` search per conversation, and merge the heads in the client
(`createGlobalSearchPager`, `concurrency: 16`, `maxScopes: 1000`). For the
brief's hub user (`u0001`, 100 groups plus 900 DMs) a fresh search is therefore
about 1,010 certified requests (ten scope pages plus one head per
conversation) in 16-wide rounds, and every later `next()` page refills lanes
with more requests. The 0.0.25 builder's hand-rolled version of the same shape
is the "paged per-chat requests" cost in its final report; a hub search took
on the order of ten seconds on localhost. On a real network at 50 ms round
trips the shipped form needs roughly three seconds before the first page can
render, per term.

This form is complete and truthful, and it is the form a cold builder will now
copy. It is also the cost the scorer's "queries and live 76" and "scale 78"
were pointing at. Two things follow:

1. **LLP 1023.001 §C and the close disagree.** The plan says "no ... client-side
   N-way merge is selected in this program" and "do not mount one live query for
   every chat or fetch the corpus into JavaScript", while the close ships a
   client N-way merge of heads as the documented form. The in-flight 1023 lane
   executes the shipped grouped-search consumer verbatim and keeps the ticket
   open only for the digest gap. One of the two documents should say plainly
   that the pager is the interim complete composition, and record its request
   cost as the remaining scale gap rather than as success.
2. **The one-lane form is unexplored.** The viewer's authorized messages
   across all conversations are already one uniform visible scope: LLP 1019's
   `deliver` derives a per-recipient log whose rows all belong to the viewer.
   A search index on that log keyed `(recipient, term-prefix, at, id)` would
   make hub search `deliveries[viewer, term] last 20 by bySearch`, one
   certified lane with no hidden runs, which is the documented escape for the
   capped-scan shape. The price moves to the write side: index rows per
   recipient per word per message, bounded by the `deliver` audience cap.
   Nobody has priced that trade against the current `cap` and fan-out
   certificates, nor the cheaper variant (an unindexed reverse-time scan over
   the viewer's delivered rows with an honest `capped` continuation).

## Requested outcome

- Record the per-search request count and measured wall time of the shipped
  form on the frozen hub fixture in the fanout card or the 1023.001
  implementation record, so the cost is visible where the recipe is taught.
- Reconcile 1023.001 §C with the close: name the pager as the interim shipped
  composition and the one-lane form as the open capability gap.
- Write the one-lane design as its own RFC (LLP 1024 or a 1023 child) with the
  write-side certificate priced on the Clique fixture: per-send index rows for
  a 50-member group at typical message length, storage growth over 100,015
  messages, and whether the existing search-index build (the 2026-09-06
  Unicode word-prefix exception) extends to a derived table without a second
  index kind. It must not widen held-search authority beyond the viewer's own
  delivered rows and must keep `NOT-DOING.md`'s one data language.

## Acceptance

- A hub-user search for a term matching only in the last membership slice
  returns its first page in a bounded, recorded number of certified requests
  that does not grow with membership count, or the RFC records why that is not
  achievable within current ceilings and the pager is documented as the paved
  form with its cost.
- No frozen benchmark input changes; the 500-follow feed and existing
  per-chat search keep their current certificates.
