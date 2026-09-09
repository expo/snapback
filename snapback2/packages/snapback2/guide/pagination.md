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

A receipt-backed capped owner page keeps its whole opaque continuation when a
durable local refresh is partial only because it cannot reconstruct computed
projection fields. The client never attaches that cursor to the partial twin
result, or preserves it across queued work or invalidation.

One cursor-bearing page nested in a record supplies root `next`; fixed arrays
do not. Objects/nested pages cannot drain; drains require a direct ascending append page.
Missing count authority makes the record partial (chat `conversationView`).

See `guide quarry` for related topics.
