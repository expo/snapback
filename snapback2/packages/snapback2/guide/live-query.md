# Live query

`useQuery(api.messages.inbox, {})` returns `data | undefined`, `status`
(`loading | ready | unavailable`), `reason`, bound `items`, `next` (cursor or
null), and `partial` (declared history supplies items). Omitted and null cursors
are equivalent in queries and item bindings. `client.observe(op, args)` exposes
that snapshot via `getSnapshot()`/`subscribe(notify)`. `{ live: false }` reads once.

`useMutation(op)` returns `{ run, inFlight, last, can }`. `run(args)` and
`client.mutation` resolve `committed | queued | rejected`, never throw.
Rejections carry one `Refusal`: `code`, `family`, `message`, optional `rewrite`,
`guide`, `site`, `rule`, `retryable`, `reason`. `require … else CODE` gives family
`rule` and that code. Transport gives family `transport`, code `E_TRANSPORT`,
`retryable: true`. `client.query` resolves failure as `state: "refused"` with
those fields. `last` clears on account/op change. `ResultOf<Op>`/`ArgsOf<Op>`
are exported from `snapback2/client`.

`usePage(op, args, options?)` for arrays returns
`{ items, pages, loadMore, hasMore, status, reason }` on React and native.
Omit the cursor from args: its name is `c`, or `options.cursor`. Each page is
live, keyed by the previous `next`; new boundaries rebind later pages,
new args reset pages. Return cursors unchanged.

`defineItems(query, { table, select, order, create, update, remove })` binds
items; composites name `rows`. `select` returns an original row or null.
Actions name `target: mutationTarget(op, "messages")`; use it in `useMutation`.
Items: `key`, `data`, `draft`, `predicted`, FIFO `pending`.
`withHistory(items, { items: threadItems, args: q => q })` adds fallback:
unusable composite `data` is undefined; history grants no count or preview.
Composites release history; denial/refusal/reset closes it.

Opt-in truthful axes: `receipt` (`state`, `source`, `seq`, `next`), `freshness`,
`local`, `refusal`, `history`, `itemsFrom`. Each query keeps its own receipt;
row evidence settles item indicators. Return one cursor page
beside count/preview; competing pages have no continuation.

One SSE holds 256 query/channel subscriptions.
`{ drain: true }` on `observe`/`useQuery` pages then tails an ascending append log
(`after c first N`, N <=50). Unsupported shapes refuse E_OFFLINE_RESUME.

## Channels

`channel name(args):` declares typed latest state scoped by its arguments.
A heartbeat table is a workaround for durable recent activity. Its lag is the
heartbeat interval plus the expiry delay; disconnects are seen late.
Do not gate delivery on it: use durable receipts.

```q
channel typing(conversationId: conversations):
  value: { typing: bool }
  publish <- exists memberships[conversationId, viewer]
  subscribe <- exists memberships[conversationId, viewer]
  ttl 4s
```

`value`: closed record, no asset/bytes/cursor. `ttl`: 1–30 seconds.
`useChannel` returns `entries`, `status`, `set`, `clear`; entries have `key`,
server-derived `from`, `value`, `expiresAt`. Renew explicitly. `client.channel`
opens on `subscribe`/`set`; `close` releases it. Reconnect starts fresh.

## Connected

`connected` is a read-only virtual table: `exists connected[p]` tests connection;
`#connected[p]` counts SSE transports (including `--as`). Pass a nonoptional
principal. Reads share one immutable snapshot per program run. Connect/close
affects the next execute; live reruns wait up to 1 s. Rules use durable facts.
Offline: `hydrating` and never predicted. No foreground or delivery guarantee.

## Unicode word-prefix search

Declare `by bySearch: conversationId, wordPrefixes(body), at, id`:

```q
query search(term: text <=128, c: cursor ?):
  page = merge messages after c last 20 by bySearch:
    [m.conversationId, term] for m in memberships[viewer] first 50 by byPrincipalConversation
  return page
```

Unicode 17 NFC/simple case fold/NFC; punctuation/whitespace split words;
accents matter. The term must normalize to exactly one word: zero words match
nothing; multiple words refuse. Its held twin uses
the same index: held/partial/capped, never complete server search.
