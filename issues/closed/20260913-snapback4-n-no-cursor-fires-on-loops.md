# Snapback 4: `N_NO_CURSOR` fires on `for … first N` in mutations and on `chunk` in jobs

**Status:** Closed
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

## Resolution — 2026-09-13

The note now follows returned query-page provenance through aliases, records,
branches and one-to-one shapes using the runtime's existing origin analysis.
Its diagnostic mode includes cursorless pages; the runtime continuation plan
retains its opaque-only mode. Consumed pages, scalar aggregates, mutation loops
and job chunks do not receive a caller-cursor rewrite. Notes deduplicate a
returned read site.

Two authored tests in
[chat.rs](../../snapback4/crates/snapback4-lang/tests/chat.rs) cover 25 positive
and negative program cases, including merge and nested return shapes. The
[feeds fixture](../../snapback4/crates/snapback4-sim/tests/clique.rs) now asserts
that all notes are absent; it passes. The Rust/TypeScript page-plan parity test
also passes, and the revised Interview sketch compiles with zero notes.
The complete suite passes 127 Rust, 94 client and 9 fixture tests.
Implementation: `9c61b0988e1965e71b5ee15e0d6c85ee116ca5c0`; independent read-only
review reported no material findings.

Final integrated verification: `50c8edfdc844c0530e4d548bd8e7b7500a26331c`;
the [suite-budget closure](./20260913-snapback4-blocking-suite-over-60-seconds.md)
records the two complete warm runs and independent review.

The compiled guide (JOURNAL 2026-09-13, "the guide is compiled") adds the
standing check: `crates/snapback4-sim/tests/clique.rs` reads the recipe from
the `feeds` card itself, and `crates/snapback4-lang/tests/guide.rs` compiles
every card's Quarry with no diagnostic and no note, so the note cannot
return to a card unseen.
