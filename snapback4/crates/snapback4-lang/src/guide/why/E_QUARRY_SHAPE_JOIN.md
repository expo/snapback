# Shapes — E_QUARRY_SHAPE_JOIN

An object spread's wildcard follows field order; when shaping an existing row shape,
explicit computed fields win over its wildcard. E_QUARRY_SHAPE_JOIN refuses
joining different row kinds, or a row-derived value and a non-row value,
at the conditional, assignment, return or collection that combines them.
Spread both row arms before joining, or build both arms with the same shape
and kind. The rule also applies inside objects and collections, even when the
result is only read by field. Identical kinds keep their existing behavior. Null adds absence to the same
kind; it does not introduce a competing wildcard rule. Resetting a collector
to `[]` keeps it empty, including inside a loop; a later append can establish
its row kind again. A nonempty unknown value cannot join a row.

Only simple conditionals or two-value reassignments of row locals or row
reads get pasteable repairs, with nullability and lazy evaluation preserved.
Reassignment edits require adjacent assignments (the second may be guarded),
with no intervening use of the reassigned local.
Coalescing, nested field conflicts, containers and helper returns instead
name the conflicting kinds and field path and explain how to make them
agree. These explanations do not suggest source edits.
