# Indexes — E_QUARRY_AMBIGUOUS

E_QUARRY_AMBIGUOUS means an older positional read matches several keys.
Name the key columns for a point, or write `tasks where .ownerId = viewer
first 20 by .at after c` for a page. Types validate a selected key; they do
not choose between keys.

Named equalities covering a total unique key read one row and check any extra
columns there: `t[key = x, col = y]` returns null on a mismatch, and
`exists t[key = x, col = y]` returns false. Named equalities covering no
unique key plan an ordinary authorized scan.
A positional key resolves only when exactly one declared unique key has its
arity. Types check that choice; they never choose between keys. If none or
several match, use named keys. Generated planning indexes never participate.
An explicit `by <authoredIndex>` keeps its existing point or prefix meaning.
