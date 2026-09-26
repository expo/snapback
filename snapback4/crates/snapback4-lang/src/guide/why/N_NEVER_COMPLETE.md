# Reads — N_NEVER_COMPLETE

The first read examples use the language card's tables. A page's read rule is checked
once when the prefix decides it, else per row, and a page whose rule still depends
on a column the scan does not pin is never `complete` (N_NEVER_COMPLETE names
the missing equality columns and an existing compatible index when one is
available). Keep the current equality prefix when adding those pins; choosing
a conversation narrows the answer to that scope. This is author guidance,
not a `check --fix` repair, and it does not change the read rule. With a total unique `(chatKey, principal)`
key on t, `.principal = viewer or exists t[.chatKey, viewer]` is decided by
the chat alone because the row is its own witness, so a roster page pinned
by the chat is complete and no second table is needed. An aborting mutation
page costs one examined unit before its verdict, plus its rule probes on
both true and false verdicts; a true verdict then examines candidates.
A page verdict evaluated from its pinned prefix charges the rule's static probe count on either outcome, including probes skipped by `and`/`or` short-circuiting.
A point read reserves that same static allowance before its lookup, equally
for a readable row, a hidden row and a miss. If it cannot pay, authorization
has no verdict and the answer remains incomplete. A device's trusted held
row needs no authorization probes.
A read states its predicate, search text, page size, order and continuation:
`t where predicate matching q last 20 by .at after c`. Omit parts the read
does not need. `first` ascends; `last` descends; id breaks ties. Predicates run
after the source rule. Parenthesize a nested read with its own modifiers:
`exists (messages[roomId = .roomId] matching q)`. The named inner key binds
the outer row's room; inside a predicate, `.` denotes that predicate's row.
