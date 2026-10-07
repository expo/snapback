# Indexes — E_QUARRY_AMBIGUOUS

E_QUARRY_AMBIGUOUS means a read matches several indexes.
Name the key columns for a point, or write `tasks where .ownerId = viewer
first 20 by .at after c` for a page. Same-column indexes need explicit `by`.

Named equalities covering a total unique key read one row and check any extra
columns there: `t[key = x, col = y]` returns null on a mismatch, and
`exists t[key = x, col = y]` returns false. Named equalities covering no
unique key plan an ordinary authorized scan.
Positional keys select identity for `id`/same-table references, otherwise one
declared unique key accepting the types in order. Ambiguous types need named
keys. Generated planning indexes never participate.
An explicit `by <authoredIndex>` keeps its existing point or prefix meaning.
