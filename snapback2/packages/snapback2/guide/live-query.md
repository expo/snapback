# Live query

`useQuery(api.messages.inbox, {})` returns `data | undefined`, `status`
(`loading | ready | unavailable`), `reason`, `next` (cursor or null), and
`partial` (true when declared history supplies items). Missing and null first-page cursors are equivalent, including in item
bindings. `client.observe(op, args)` offers the same snapshot through
`getSnapshot()` and `subscribe(notify)`. Pass `{ live: false }` for one read.

`useMutation(op)` returns `{ run, inFlight, last, can }`. `run(args)` and
`client.mutation(op, args)` always resolve `committed | queued | rejected`.
A rejection includes `Refusal`: `code`, `family`, `message`, optional `rewrite`,
`guide`, `site`, `rule`, `retryable`, `reason`. A failed `require … else CODE`
has family `rule` and that code; transport has family `transport`, code
`E_TRANSPORT`, `retryable: true`. `client.query` also resolves on failure, with
`state: "refused"` and those fields. Hooks clear `last` on account or op change.
Import `ResultOf<typeof op>` and `ArgsOf<typeof op>` from `snapback2/client`.

For array results, `usePage(op, args, options?)` from `snapback2/react` or
`snapback2/react-native` returns `{ items, pages, loadMore, hasMore, status, reason }`.
Omit the cursor from args; its name is `c`, or `options.cursor`. Each page is live, keyed by the previous `next`. Changed boundaries rebind
later pages; changed args reset them.

Bound scans. Cursor indexes end in `id`; pass `cursor ?` to `after`. Return
one cursor page beside count/preview; competing pages have no continuation.
`next` is opaque and bound to table/index/order: pass it back unchanged.

Declare items with `defineItems(query, { table, select, order, create, update,
remove })`; record results also name `rows`. `select` returns an original row
or null. Actions name `target: mutationTarget(op, "messages")`; submit that
target to `useMutation` too. Items have stable `key`, selected `data`, submitted `draft`, `predicted`, and
FIFO `pending` actions. Drafts have no server time.

Add fallback with `withHistory(items, { items: threadItems, args: q => q })`.
Unusable composite `data` is undefined: history rows grant no count or preview.
A usable composite releases history. Denial/refusal/reset never opens it.

Opt in to the truthful axes when needed: `receipt` (`state`, `source`, `seq`,
`next`), `freshness`, `local`, `refusal`, `history`, `itemsFrom`. The receipt
stays the observed query's; history owns its own receipt. Row evidence settles item indicators.

One SSE connection holds up to 256 query/channel subscriptions. Unmount unused
components; CSS hiding keeps them active. `{ drain: true }` on `observe`/`useQuery`
pages then tails an ascending append log (`after c first N`, N <=50).
Unsupported shapes refuse E_OFFLINE_RESUME. See offline.

## Channels

`channel name(args):` declares typed latest state scoped by its arguments.

```q
channel typing(conversationId: conversations):
  value: { typing: bool }
  publish <- exists memberships[conversationId, viewer]
  subscribe <- exists memberships[conversationId, viewer]
  ttl 4s
```

`value` is a closed nonempty record; no asset/bytes/cursor fields. `ttl`: 1–30
integer seconds. `useChannel(api.typing, args)` returns
`entries`, `status`, `set(value)`, `clear()`. Each entry has `key`, server-derived
`from`, `value`, `expiresAt`. Renew explicitly. `client.channel` opens on
`subscribe` or `set`; `close` releases it. Reconnect starts fresh. No offline queue.

## Connected

`connected` is a read-only virtual table: `exists connected[p]` tests connection;
`#connected[p]` counts authenticated SSE transports. Pass a nonoptional principal.
Rules/maintains use durable facts. Offline reads are hydrating. No delivery guarantee.

## Unicode word-prefix search

`wordPrefixes` is a maintained bounded text index, after scope and before order.
Equality-bind scope/search. Unicode 17 NFC/simple case fold/NFC applies;
whitespace and punctuation split words; accents matter. Zero words match nothing;
multiple words refuse. The twin reports held/partial/capped, never complete search.
