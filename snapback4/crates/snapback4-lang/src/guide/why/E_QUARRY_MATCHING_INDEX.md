# Search — E_QUARRY_MATCHING_INDEX

E_QUARRY_MATCHING_INDEX means the named index is declared, but cannot serve
this `matching` read. This is an index compatibility error, not an unresolved
name or an invalid cursor.

A plain unique index supplies its column order to the search planner when
named scope keys sit inside its leading prefix; omitting keys orders by the
whole index. Other plain indexes have no words key.
For in-chat search, declare `search body`, pin the conversation, and use
`by byConversationOrdinal` for `unique byConversationOrdinal: conversation, ordinal`, or order by columns:
`messages[conversation = chat] matching needle last 20 by .ordinal after next`.
The planner supplies `(conversation, words(body), ordinal, id)`. Keep the
unique conversation/ordinal index for history and receipts. A refused unique
index prefix names the missing leading column and offers no rewrite.

A computed index without a words key cannot serve `matching` either. It is
not a plain index; no automatic column-order rewrite is offered, because
replacing its computed key with a source column could change the order.

If the index already has words after N columns, pass exactly those prefix
columns as scope keys. Alternatively, express the scope with named equalities
and order by columns so the planner selects a compatible search index.

See `snapback4 guide search` for the complete conversation search recipe and
offline completeness rules. Keep the same conversation and needle while
paging; reset the cursor when either changes.
