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

A lookup by title does not prove that title unique. Do not add a uniqueness
constraint unless the product requires it, or pin an id you do not have.
For a synced table whose read rule depends on its id, the note can print the
same complete query declaration with `held` added. Paste it over that query
only if device-only lookup fits the screen: its predicate, order and duplicate
matches stay the same, but it requires acquired coverage and has no server
fallback. Otherwise keep the server query and its incomplete absence verdict.

Its rewrite renders the pin as code: the equality to add, the parent read that
supplies it, or one query per party when pins cannot merge (guide indexes,
"Private lists"). A
row-independent grant (`exists staff[viewer]`) whose row its holder may read
decides the page once for that holder, as does a disjunct the pins decide
(`exists boards[.board, owner = viewer]` under `.board = b`) whose row its
holder may read; `check` is silent after `require` or inside `if` of either.

For several readers the printed form has one `if` arm per grant, one per
disjunct the pins decide (`if exists cats[cat, owner = viewer]:` under `.cat
= cat`), then the remaining party pinned, or one query per party; it prints
only if proven to return the rule's rows; every arm is complete.

An incomplete page: the default `test.cases.jsonl` expectation passes
either answer (`"expect": "capped"` pins it; run it as a grant holder to expect
`complete`). A client treats `complete: false` as "there may be more", not an error.

An `exists` over such a scan answers `true` (still `complete: false`) when a
readable row matches; with none the server has no answer (`loading`), never
`false`, since hidden rows could match. Pin the deciding column to get `false`;
in a mutation the form is `E_STRUCTURAL_FANOUT`.
