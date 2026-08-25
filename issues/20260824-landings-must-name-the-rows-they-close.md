# Landings must name the rows they close

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Systems:** Process
**Date:** 2026-08-24
**Related:** `issues/20260824-liveness-row-bucket-assignment.md`, LLP 0303, LLP 0283

## The problem

The programme is tracked as "N of 96 rows landed", where the 96 are the independent surfaces in
`issues/20260824-liveness-row-bucket-assignment.md`. That number cannot currently be computed.

The OAuth consent lane landed eleven commits (`312ffc059..71dc8d565`). Searching all eleven commit
messages and bodies for row identifiers returns **nothing** — no `F###`, no `C###`. The work is real
and the commits are well written, but nothing ties them to the inventory the programme is measured
against.

The best available proxy is indirect: counting call sites of the shared derivation predicate
`require_agent_grant_management_session` on `main` gives **7**, up from **4** before that landing —
so roughly three more subjects are now derived. That is an inference from a helper's popularity, not
a measurement, and it will stop working the moment a lane derives through a different predicate.

## Why it matters

Three separate counts have been published in this programme and corrected: "137 liveness-only rows"
which was 134, "47 of 68 P2 rows planned" which was 34 at row granularity, and an in-session claim of
"3 of 96 landed" whose relationship to the OAuth landing is now unclear. Each correction came from
someone recounting by hand.

An unmeasurable completion metric is worse than a pessimistic one: it makes "are we converging"
unanswerable, which is the question the whole programme is steered by.

## What to do

**Every landing names the rows it closes, in the commit message, using the identifiers from the
bucket assignment.** A trailer is enough:

```
Closes-rows: F170, F171, F172, F173
```

And where a landing does *not* close a row it touches — because it hardens a fixture, fixes drift, or
partially derives — say that too:

```
Touches-rows: F149 (fixture only; derivation unchanged)
```

This costs a line per landing and makes the count a `git log` query instead of an archaeology
exercise. It also forces the author to state which row they believe they closed, which is exactly
the claim a reviewer should be checking.

## Retrospective

The rows closed by the OAuth landing should be reconstructed and recorded, either as an amendment to
the bucket assignment or as a note here. Until that is done, this document is the honest statement of
the count: **the number of landed rows is not precisely known**, and the credible range is small —
the three landed before the OAuth lane plus whatever that lane closed.
