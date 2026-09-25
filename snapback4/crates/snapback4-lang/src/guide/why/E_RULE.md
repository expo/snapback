# Rules — E_RULE

`insert` and `insert ... if absent` return E_RULE when the insert rule denies
the viewer. A unique clash with a hidden row returns E_RULE for either insert
form. For a readable secondary unique clash without a custom refusal, ordinary
insert returns E_CONSTRAINT naming the index, while `insert ... if absent`
succeeds with null. If the update rule denies an update or upsert-patch, it
returns E_RULE for a readable target and NOT_FOUND for an unreadable target. A
valid update or upsert-patch admitted by the update rule can change a hidden
row; if the resulting row remains hidden, it returns null. Without a custom
unique refusal, an update or upsert-patch with a secondary unique clash returns
NOT_FOUND if its target is unreadable, E_RULE if only the colliding row is
unreadable, and E_CONSTRAINT naming the index if both are readable. For rule
denial, an update condition or a secondary unique clash on an unreadable target,
NOT_FOUND carries no row, index, column or branch detail. A missing update
target or an incomplete upsert insert patch returns NOT_FOUND. An update
condition on an unreadable target returns NOT_FOUND even if it would match; on a
readable target, a false condition returns E_CONFLICT with a read-rule
`current`. Delete returns NOT_FOUND for a missing id, and E_RULE if an existing
row's delete rule refuses, whether that row is readable or hidden. Reading a
hidden row returns null. Use a write admitted by its rule; NOT_FOUND on an
update or upsert-patch does not prove absence.

A read denied by a table's rule answers as an empty page, not a refusal,
and a client cannot tell it apart from an empty readable page — by design,
so that a hidden row cannot be probed. For access UI, use a membership query
the viewer may read, such as a conversation lookup readable by its members:
a member gets the conversation even when its message page is empty.
An explicit `require … else CODE` still refuses with the program's code.
