# E_READ_THROUGH_SCAN

E_READ_THROUGH_SCAN refuses an unpinned aggregate scan. A read-through aggregate can enumerate groups only after pinning one complete
parent identity in its index prefix, with inherited parent authorization.
For `reactionTotals: count reactions by .message, .emoji`, shape a page of
messages with `{ *, totals: reactionTotals[message = .id] by .emoji }`.
Keep the message page's audience key, order, predicates and cursor. This
returns aggregate rows with `.value`; `reactionTotals[message, emoji]`
returns a scalar for one complete key. The maintains card compiles a
full page with per-emoji counts and caller state.

A source cap on that parent bounds the number of live groups. Otherwise use
`first N` and a cursor for the aggregate page too. Unpinned scans and explicit
aggregate read overrides remain refused. Each parent is authorized before
its groups are visited. An unknown device parent or source domain remains
unknown, never a zero count or a complete empty list.

Group enumeration uses the server's aggregate key index and falls back on a
device. Complete-key scalar reads can still recount fully held children locally.
