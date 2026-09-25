# Reads — N_SEEK

N_SEEK is advice for an older explicit-index read whose residual filter can
seek. For a new read, write `messages where .roomId = roomId and .at >= start
first 20 by .at after c`; the planner makes that comparison a seek.

Unpaged aggregates infer a range seek only when its endpoint is already
present and cannot fail. Bounds requiring a short-circuit guard remain row
filters. A named id pin keeps its single-row access path and filters.

Inside `where`, an ordering comparison (`<`, `<=`, `>`, `>=`) with a nullable
column of that row is false when the column is null. `.due < now` therefore
selects overdue tasks without a guard or a default. On the first order key it
is a seek when its endpoint is already present and cannot fail; a nullable
upper-only seek starts exclusively above null. `= null`
and `!= null` keep their ordinary meaning. Optional arguments and locals,
and comparisons outside `where`, still need a presence guard.
An endpoint behind a guard, such as `d != 0 and .due > 10 / d` or
`x != null and .due < x` for optional `x`, stays in the residual predicate,
even with `by .due`. The guard runs before that comparison. Present literals,
`now`, required parameters and arithmetic proven not to overflow can seek.
Parenthesized predicates also work before a named shape.
