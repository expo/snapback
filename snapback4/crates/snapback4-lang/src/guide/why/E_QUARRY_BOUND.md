# Bounds — E_QUARRY_BOUND

E_QUARRY_BOUND means a boundless prefix is not valid in this position: no
schema cap covers the group, its cap exceeds the examined ceiling, or a
meter-bounded query prefix has a non-uniform read rule. Declare `cap N by cols`
on the table if that is the intended group limit, then read `t where .group = group`, or
page with `first N` and a cursor. For a non-uniform prefix, the rewrite also
names the index columns to pin, as N_NEVER_COMPLETE does. A returned seek page still writes
its page size. Descending reads keep `last N`.

A boundless domain read uses the schema cap in ascending order, even in
nested shapes and mutation loops. A cap above the examined ceiling requires
explicit pagination for a returned page. `first N` remains an ordinary page;
`last N` remains the descending spelling.
