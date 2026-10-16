# Rules — E_RULE

`insert` and `insert ... if absent` return E_RULE when the insert rule denies
the viewer. A unique clash with a hidden row returns E_RULE for either insert
form. For a readable secondary unique clash without a custom refusal, ordinary
insert returns E_UNIQUE naming the declared key, while `insert ... if absent`
succeeds with null. If the update rule denies an update or upsert-patch, it
returns E_RULE for a readable target and NOT_FOUND for an unreadable target. A
valid update or upsert-patch admitted by the update rule can change a hidden
row; if the resulting row remains hidden, it returns null. Without a custom
unique refusal, an update or upsert-patch with a secondary unique clash returns
NOT_FOUND if its target is unreadable, E_RULE if only the colliding row is
unreadable, and E_UNIQUE naming the declared key if both are readable. For rule
denial, an update condition or a secondary unique clash on an unreadable target,
NOT_FOUND carries no row, index, column or branch detail. A missing update
target or an incomplete upsert insert patch returns NOT_FOUND. An update
condition on an unreadable target returns NOT_FOUND even if it would match; on a
readable target, a false condition returns E_CONFLICT with a read-rule
`current`. Delete returns NOT_FOUND for a missing id or an unreadable refused target, and E_RULE for a readable row whose delete rule refuses. Reading a
hidden row returns null. Use a write admitted by its rule; NOT_FOUND on an
update or upsert-patch does not prove absence.

A read denied by a table's rule answers as an empty page, not a refusal,
and a client cannot tell it apart from an empty readable page — by design,
so that a hidden row cannot be probed. For access UI, use a membership query
the viewer may read, such as a conversation lookup readable by its members:
a member gets the conversation even when its message page is empty.
An explicit `require … else CODE` still refuses with the program's code.

Require decides intent; each write passes its table rules. Jobs run as
system. See: guide rule-recipes update-images. Under `dev`, `snapback4 why recent` prints each refusal and parked job:
operation, code, request/job ID, Unix time, and the refusing clause with its
site. Replays and uninstrumented paths say `cause not instrumented`. Records describe only
the named request/job.
Visibility filtering is not recorded. Inspect `snapback4 why TABLE` for rules
and residency. Unknown empty answers are silent and unrecorded by default;
`dev --trace-empty` records them locally without console notices.
`snapback4 why EMPTY_READ` gives rule, coverage and horizon investigation commands.

Console repeats print counted one-second windows; `guide refusals` explains.

With several live instances select `why recent --instance ID` (optionally
`--store ID`). Owner-only `.snapback4/dev-refusals/<storeId>/<instance>.json`
retains 32 records. Stopped/mismatched streams are rejected. The asynchronous
32-slot queue reports `dropped` on recovery; `why recent` refuses older
snapshots while newer refusal evidence is pending or dropped.
Query sites belong to the reader's generation; capture exhaustion points to
`read through`. No arguments or row values are recorded, no HTTP endpoint
exposes evidence, and production `serve` does not collect it. Caller bytes
remain unchanged.
