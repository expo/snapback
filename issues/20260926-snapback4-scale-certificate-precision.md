# Snapback 4: the scale certificate over-charges in six shapes (precision, not soundness)

- **Opened:** 2026-09-26, from Grok's review of the scale certificate's round 7
  (`sc-r7.grok`, READY WITH CHANGES), after 0.4.3's round 8.
- **Area:** `crates/snapback4/src/scale.rs`, `scale/display.rs`.
- **Severity:** Low. In each case the certificate charges work that never runs,
  or states a weaker bound. None claims a constant that grows.

## The shapes

1. **Sequential facts inside a branch.** `leaves` does not walk a nested body in
   order, so a branch whose statements leave one after another under different
   presence facts is judged able to fall through.
2. **No variant scan, no exit analysis.** `fact` is `None` unless some scan is a
   planner variant, so `if assignee != null: if assignee != null: require false
   … ; return t first 2 by .at` then `return []` charges the dead scan.
   Gate variant recording on `has_variants`, not leaving.
3. **Refusals that always refuse, other than `false`, `=` and `!=`.** `require
   1 > 2`, `require 1 < 1`, `require not true`, and a presence `require` that the
   facts in force contradict (`require assignee != null` inside `if assignee =
   null`) are not exits.
4. **`not (x = null)` and conjunctions.** `presence` matches only `Eq`/`Ne` and
   search. `if not (assignee = null)` and `if assignee != null and status !=
   null` (lowered through a bool temp) state no fact.
5. **A dead search clears a live lane bound.** Code walked by `never` still sets
   `lanes = None` for a word prefix: a merge of 4 lanes followed by a dead
   `matching` reads meter-bounded lanes. Set it only when reachable.
6. **A job that returns before its sweep** still lists the sweep in
   `whole_job`. Record a page loop only when the walk reaches it.

A decided test's `else` arm is also untested: requiring both branches there
survives the variant tests. Grok's review has the repros.
