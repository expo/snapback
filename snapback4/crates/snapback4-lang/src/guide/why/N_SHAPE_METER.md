# Reads — N_SHAPE_METER

N_SHAPE_METER means `check` found a query shape field whose candidate population can outgrow the
default 8,192-row examined meter. The note names the field, source location,
read site and any helper calls. A time window or equality on a non-unique key
does not bound how many rows it can contain. A raw `count` or `sum` needs the
whole domain, even when its answer is one number.

For an exact unread total, use a row-keyed maintained count:
`view unreadCounts: count messages by members m where ...`, then
`unreadCounts[.id]` in the inbox shape. `snapback4 guide views` has the complete
member predicate and its authorization and recount rules. For a preview, use
`first N`/`last N`; this changes a total into a page. Residual predicates and
non-uniform read rules can still examine arbitrarily many rejected candidates.
Or move the work into a separate query so an expensive decoration cannot
starve the returned row. A separate raw total still runs under its own meter.

This is a note, not a refusal: data may be small, branches may skip the read,
and runtime ceilings may differ. Declared caps fitting the default meter,
fully pinned total unique keys, maintained scalar lookups and ordinary bounded
pages and ordered column-extremum seeks do not trigger it. Shape fields are checked even in assigned shapes and
helpers; this advice does not change the narrower runtime returned-page rule.
It is not a cost certificate: silence does not price combined reads, nested
fanout, expiry cleanup, rule probes, steps, heap or output. The runtime remains
authoritative. A no-progress returned-page retry can refuse with
`E_SHAPE_EXCEEDS_METER`; other compositions retain their ordinary incomplete
read behavior.
