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

## Resolution (2026-09-26)

Fixed on `sb4-intent/scale-precision`: the certificate's walk now returns
whether a body leaves and judges every condition as a three-valued `Test`
(known, an argument's presence, or unknown; `not`, `and`, `or`) under the facts
in force (LLP 3000.013 §14.4). Each shape has a test in
`crates/snapback4/tests/scale_variants.rs`:

1. `facts_hold_in_order_inside_a_branch`
2. `every_program_finds_what_never_runs`
3. `a_refusal_leaves_where_its_test_fails`
4. `not_and_and_or_state_presence_facts`
5. `code_that_never_runs_keeps_the_lane_bound`
6. `a_sweep_the_job_never_reaches_is_not_the_whole_job`

The decided `else` has `a_decided_test_runs_only_its_matching_branch`.
`a_binding_holds_its_test_only_where_the_walk_knows_it` guards the new
flow-sensitive bindings. 23 mutants were killed.
