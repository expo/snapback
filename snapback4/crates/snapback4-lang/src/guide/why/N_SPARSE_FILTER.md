# Feeds — N_SPARSE_FILTER

| Code | Meaning and next step |
|---|---|
| E_VIEW_FEED_SHAPE | The projection or viewer predicate is unsupported. Use the activity and Following views above |
| E_TIMELINE_SHAPE | The sources do not fit Following. Keep three distinct public sources, full sync and owner rules |
| E_TIMELINE_FOLLOWS | The edge key is invalid. Declare the immutable unique follower/followed pair |
| E_TIMELINE_FILTER | Selection is not stable. Make selection columns immutable; use `.parentId = null and not .removed` |
| E_TIMELINE_REMOVAL | Removal must be one-way. Insert false, change only false → true and retain the original card |
| E_TIMELINE_READ | The read is not one viewer's newest-first page. Read `following last 20 by .at after c`, then shape the rows |
| E_TIMELINE_OWNED | Derived rows belong to the engine. Write posts, reposts or follows |
| E_TIMELINE_SERVER | The mutation needs server-only state. Queue it without predicted rows |
| E_TIMELINE_ACTIVATE | Dev adopts automatically. Deploy needs `--allow-feed-adoption`, with copy/lock estimates; limit 5,000,000 copies. Start now, no refill; use fresh names or planned `home` in `guide feeds` |
| E_TIMELINE_REDEFINE | A materialized declaration changed or experimental reconstruction remains. Original ids are post ids; repost ids require their slots and edge-admission history is not retained. Remove the view and deploy, then add the new definition with a fresh name, or use the planned `home` query in `guide feeds`; use the matching engine for a 0.3 store |
| E_TIMELINE_IMPORT | Import cannot reconstruct delivery history. Use application mutations or a trusted complete restore |
| FEED_POST_NOT_FOUND | A new repost needs a live original. Refresh the source |
| FEED_EVENT_REMOVED | A removed event cannot be resurrected. Use a fresh event id |
| FEED_CANNOT_FOLLOW_SELF | Self-follow is refused. Own events already appear without it |
| E_RULE | A non-owner `remove` is refused; remove only your own post |
| N_SPARSE_FILTER | A residual predicate may reject many rows. Narrow the read; the planned `home` in `guide feeds` can fail closed with `complete: false` and no `next`. Materialized Following can adopt retained sources |

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
