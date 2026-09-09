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

`{messages,count,preview}` is one outcome without root continuation; nested
bounded arrays are not drainable. Missing count authority makes the whole record
partial (chat `conversationView`).

See `guide quarry` for related topics.
