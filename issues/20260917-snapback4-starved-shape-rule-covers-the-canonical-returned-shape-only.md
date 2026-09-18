# Snapback 4: the starved-shape rule (drop the row, `next` before it) applies to the canonical `return <read> { … }` only — every other returned-shape program still shows a row it could not finish

Status: Open
Priority: P3 (a wrong-but-honest answer in non-canonical returned-shape programs; the card's form is covered)
Date: 2026-09-17
Systems: `snapback4-lang` `bind/program.rs` (the returned-shape mark), `snapback4-core` `engine/pages.rs` (`Plan.shapes` from the mark), `engine/shaping.rs`, `engine/runner.rs` (`Return`'s shape-owned position)
Observed version: lane W13h as landed (LLP 3000.007 §20.22.7); descoped after six blind rounds
Evidence status: the non-canonical forms are pinned by tests asserting today's behaviour (`crates/snapback4-sim/tests/common/shape_pages.rs`, shared by both device stores)

## Problem

W13h's rule — a row whose returned shape the meter starved is not on the page; `next` positions before it — is
applied only to a loop the binder marks as the query's returned shape expression: `return <read> { … }` with the
read inline or bound to a variable defined once and used nowhere else. That is the card's grouped-search form and
the merge drain. Any other program that returns a shaped page — the shape assigned to a variable and returned
later, returned inside a record, chosen by a conditional, carried through a loop, pushed into a collector, or
built in a helper — keeps the pre-W13h behaviour: a starved shape stays on the page, empty or partial, and `next`
positions after it; the page is `complete: false, cut: 'meter'` (honest about itself, wrong about that row).

Why: four blind rechecks of a *static* ownership analysis (which returned value carries the shaped page, which
carries its raw source) each found a program in which it rewound a returned raw page or lost its owner, and the
fourth found it could fail to terminate on a finite helper composition. The analysis was removed (LLP 3000.007
§20.22.7; `llp/reviews/3000.007-w13h-implementation.*`).

## What to decide (author's ruling)

1. **Leave it.** The card's form is covered; the wart survives only in forms the cards do not show; `check` could
   note a returned shape that is not in the canonical form ("a starved preview stays on the page here").
2. **A runtime ownership rule.** The runner knows, at `Return`, which collector it is returning (by value identity
   or a collector id carried in the `Value`), so it can decide the rewind from what was actually returned rather
   than from a static origin analysis: rewind only when the returned value *is* the shaped collector and contains
   no row of the raw page by identity. No planner analysis, no non-termination, no ownership tables. Cost: a
   collector id (or a row-identity check) on the returned value; a design and review round.

Recommendation: (2), designed with a blind review before it is built — the six rounds are the evidence that a
static rule cannot be made both complete and terminating cheaply, and that the runtime already holds the fact
the rule needs.
