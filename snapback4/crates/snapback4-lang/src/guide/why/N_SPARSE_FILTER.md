# Reads — N_SPARSE_FILTER

A `where` that pins no index prefix is a residual filter: the scan walks the
index and tests each row, so a page whose matches are rare can spend the row
meter on rejected rows and come back short with `complete: false`. It is a
note, not an error; small tables and deliberate scans can keep it. Narrow the
read in one of these ways:

- pin a column: `where .owner = owner` (or a key, `tasks[owner]`), so the
  scan starts at the matching rows;
- order by the filtered column, `by .col`, so the matches are adjacent;
- drop a `where` that every row passes, such as `.ward != null` on a required
  column or a check the read rule already makes;
- for a count or a total, read a `view` instead of filtering rows.

A residual predicate may reject many rows. Narrow the read; for a social
timeline, the planned `home` in `guide feeds` can fail closed with
`complete: false` and no `next`. Materialized Following can adopt retained
sources.

Finite ranked windows enumerate inclusive UTC buckets:
`bucket(lower) ..= bucket(upper)`. The exact endpoint comparisons still
filter every row. A missing finite upper bound stays a metered residual scan;
N_SPARSE_FILTER suggests `and .at <= now` when that is the intended window.
Paging by a maintained order key such as `.likeCount` is not a snapshot:
changes can move rows across a saved position. Restart to see the new order.
Value lanes deduplicate values; each lane keeps its source rule. Null never
becomes an index pin. When a membership list includes null, one ordinary
filtered lane reads the null-valued rows under the same rule.
A keyed `exists` inside `where` probes one authorized row per candidate;
when its discovery prefix cannot decide the other table's read rule, the
planner retains those probes and the certificate names the skipped rows.
A cut during discovery or while any lane head is unknown is incomplete and
has no cursor. A full page never certifies a prefix of an unfinished lane list.

Finite ranked windows use inclusive UTC buckets from the lower through the
upper bound. Exact endpoints still filter rows. An `in` predicate over a list
or a read's column opens one ruled scan per distinct non-null value; a null
value adds one authorized null-filtered scan for a nullable column. Unknown
or cut discovery cannot certify the page. Use `check --cost` to inspect these
plans. Unknown widths print `lanes ≤ meter`; the author writes no lane list.
