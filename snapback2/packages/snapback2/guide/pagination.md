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
result, or preserves it across an active local overlay or invalidation.

One cursor-bearing page nested in a record supplies root `next`; fixed arrays
do not. Objects/nested pages cannot drain; drains require a direct ascending append page.
Missing count authority makes the record partial (chat `conversationView`).

`usePage(op, args, { items })` and `client.observePages` share one live page
resource. Pass the same `defineItems`/`withHistory` binding as `useQuery`.
Render `items`; read count/preview only from `head.data`. `pages` contains the
active source's original snapshots; it has no combined receipt or sequence.
`itemsFrom` is `query`, `history`, or `drafts`. History cannot supply a summary.

`loadMore()` follows the active tail's opaque `next`. Primary and history use
their own declared cursor names. A source change preserves requested depth,
rebuilds valid links, and releases inactive pages. A changed boundary discards
its suffix before replacement; the readable prefix stays visible. An
unavailable tail takes status precedence over loading. No cursor on a partial
page means unavailable continuation, not server exhaustion.

For `order: "reverse"`, the unique row sequence is reversed once across all
pages: raw `[9,8,7] [6,5,4] [3,2,1]` displays `[1,2,3,4,5,6,7,8,9]`. The first
selected whole item wins duplicate keys, retaining its own pending evidence.
Draft-only items across valid pages appear once in FIFO order after rows;
a selected row wins over its draft. Keep create membership about the product
scope, not `query.c == null`: page placement belongs to the resource.

See `guide quarry` for related topics.

The page resource's `status` describes acquisition, independently of `head.status`.
Render its permitted `items` while loading or unavailable: queued drafts remain
visible even when the eligible history query is still loading or cannot answer.
