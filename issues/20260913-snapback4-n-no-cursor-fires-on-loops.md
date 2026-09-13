# Snapback 4: `N_NO_CURSOR` fires on `for … first N` in mutations and on `chunk` in jobs

**Status:** Open
**Priority:** P3
**Date:** 2026-09-13
**Systems:** `snapback4/crates/snapback4-lang` (the `N_NO_CURSOR` note), the `feeds` guide card
**Author:** Claude Fable 5.1 (LLP 3000.004)

The `N_NO_CURSOR` note is meant for a query that returns a page with no
cursor to continue it. It also fires on two loops that are not pages a
caller continues:

- a `for f in follows[viewer] first 200 by byFollowed:` inside a mutation
  ("mutation createPost returns a page of 200 follows rows with no cursor");
- a job's `chunk w in fanouts first 5 by byId:` ("job fanOut returns a page
  of 5 fanouts rows with no cursor"), where the chunk *is* the cursor: one
  page per commit, resumed by the engine.

Repro at 0.1.14: put the `feeds` card's recipe (the `FEED` constant in
`crates/snapback4-sim/tests/clique.rs`) in a scratch project's
`snapback/schema.q` and run `snapback4 check` — `ok … 2 notes`, both
`N_NO_CURSOR`, with rewrites that would make a mutation and a job take a
`c: cursor ?` argument. LLP 3000.004 §5's sketch gets one on its `rescore`
job. The test asserts only on diagnostics and `N_WIDE_MERGE`, so the notes
pass unseen.

Fix: the note should consider a scan's position — the page a query
*returns* — not every bounded scan in a program; a `for` body and a `chunk`
are bounded by their `first N` and need no continuation. The card should
compile with zero notes and the test should assert it.
