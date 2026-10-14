# Reads — N_NEVER_COMPLETE

An **analyzer limitation** means the admitted ranges cannot certify this shape;
it does not assert that rows are missing. **Truly partial absence evidence**
means the declared authority leaves an access source unobservable, so absence
cannot be proved through that source. The note prints the verified complete
form, or exact scope pins with their narrowing consequence. A copied parent
repair includes its write check and backfill; an index alone does not repair
a hidden witness.

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

A title lookup does not prove uniqueness; add `unique` only when the product
requires it. For a synced id-dependent rule, the note may add `held` to the
same query. Use that only for a device-only lookup: it preserves predicate,
order and duplicates, but needs acquired coverage and has no server fallback.

Rewrites name the missing equality, its parent read, or one query per party
(guide indexes, "Private lists"). A readable row-independent grant
(`exists staff[viewer]`) or pinned disjunct decides the page once; `check` is
silent after its `require` or inside its `if`. Several readers get one proven
complete `if` arm per grant or decided disjunct, then the remaining party.

Owner-or-membership with one row-dependent component and a total unique point
merges, including target `.id` or a readable-parent point
(`exists offers[.offer, baker = viewer]`). `unique parent, principal` bounds
witnesses per target, not a viewer's memberships: discovery is metered and
publishes neither rows nor cursor if cut. A note suggests `cap N by ...` only
as an exact repair; it is a hard write/adoption limit. Hidden, ambiguous,
multi-hop or physically unsupported probes receive no cap suggestion.

An incomplete page: the default `test.cases.jsonl` expectation passes
either answer (`"expect": "capped"` pins it; run it as a grant holder to expect
`complete`). A client treats `complete: false` as "there may be more", not an error.

An `exists` over such a scan answers `true` (still `complete: false`) when a
readable row matches; with none the server has no answer (`loading`), never
`false`, since hidden rows could match. Pin the deciding column to get `false`;
in a mutation the form is `E_STRUCTURAL_FANOUT`.
