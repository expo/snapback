# Pagination: `after`, `first`, `last`

`first` is ascending; `last` is descending.

`after` follows scan order: `after c` with `c: cursor ?`; `null` starts page one.
Pass `next` unchanged. It encodes table/index/order, typed suffix, and last returned row. `E_INPUT` rejects noncanonical arguments before
execution and scope mismatches before the selected page or merge discovery.
Tokens cross sites; indexes end in `id` or are unique.

An `if`/`else` can return a range or merge through aliases and shapes.
`next` follows that return, never an auxiliary read; shapes may omit index
columns. Reset `c` when changing index/order. Non-page and local `partial`
results have no continuation.

One cursor-bearing page nested in a record supplies root `next`; fixed arrays
do not. Objects/nested pages cannot drain; drains require a direct ascending append page.
Missing count authority makes the record partial (chat `conversationView`).

See `guide quarry` for related topics.
