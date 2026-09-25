# Reads — N_NO_CURSOR

A page a query returns without
a cursor cannot be continued: an unfiltered page with more rows reads
`complete: false` with no `next` (N_NO_CURSOR); declare `c: cursor ?` and
page with `after c`, or use a narrower key, such as
`chatDeliveries where .messageId = messageId` without a page clause when a
declared cap bounds that message's acknowledgements. A matching set can
declare `cap 50 by conversationId` on the table
then read the whole group: `t where .conversationId = conversationId`, if 50 is the intended group limit
and no existing cap already bounds that group. Unscoped pages and pages
whose existing cap exceeds their bound or the meter still need continuation.
A cap refuses writes beyond its limit: it is a data constraint, not a hint.
A single-group page omits this note only when its bound
covers the group cap and that cap fits the default 8,192-row examined ceiling.
Other metered work and authorization can still make an answer incomplete;
a per-lane cap does not bound a merge. Inspect `Read.cut`: `meter` means narrow
the read or continue with `next`, `words` means narrow the search term, and null
does not establish completeness. For `complete: false` with `cut: null`, render
"Results may be incomplete", even when empty. Loopback dev's online client
includes `Read.meter` by default: examine `examined`, `indexEntries`, `probes`
and `cut` on the returned answer. Local device reads have no meter; `serve`
never returns these development counters.
