# Live query

`useQuery(api.messages.inbox, {})` returns `data | undefined`, `status`
(`loading | ready | unavailable`), `reason`, `items`, `next` (cursor/null), and
`partial` (history supplies items). Null/missing declared cursors share keys and
item bindings; callbacks receive the declared cursor as `null`. `client.observe(op, args)` exposes
that snapshot via `getSnapshot()`/`subscribe(notify)`. `{ live: false }` reads once.

`useMutation(op)` returns `{ run, inFlight, last, can }`. `run(args)` and
`client.mutation` resolve `committed | queued | rejected`, never throw.
Rejections carry one `Refusal`: `code`, `family`, `message`, optional `rewrite`,
`guide`, `site`, `rule`, `retryable`, `reason`. `require … else CODE` gives family
`rule` and that code. Transport gives family `transport`, code `E_TRANSPORT`,
`retryable: true`. `client.query` resolves failure as `state: "refused"` with
those fields. Invalid wire data (`op/E_WIRE_SHAPE`), cancellation
(`client/E_ABORTED`), closed clients (`owner/E_CLIENT_CLOSED`), and unexpected
client failures (`client/E_CLIENT`) are non-retryable. Inspect invalid data
before retrying: a write may have committed. `last` clears on account/op change. `ResultOf<Op>`/`ArgsOf<Op>`
are exported from `snapback2/client`.

`usePage(op, args, options?)` returns
`{ items, pages, loadMore, hasMore, status, reason }` for arrays.
Omit `c` (or `options.cursor`) from args. Each page is live by previous `next`;
new args reset pages. Keep cursors unchanged.

`defineItems(query, { table, select, order, create, update, remove })` binds
items; composites name `rows`. `select` returns an original row or null.
Actions use `target: mutationTarget(op, "messages")`.
Items: `key`, `data`, `draft`, `predicted`, FIFO `pending`.
`withHistory(items, { items: threadItems, args: q => q })` adds fallback:
unusable composite `data` is undefined; history grants no scalar authority.
Usable composites, denial/refusal/reset release history.

Opt-in: `receipt` (`state`, `source`, `seq`, `next`), `freshness`, `local`,
`refusal`, `history`, `itemsFrom`. Each query keeps its receipt.

`{ drain: true }` on `observe`/`useQuery` pages then tails an ascending append log
(`after c first N`, N <=50). Unsupported shapes refuse E_OFFLINE_RESUME.

## Channels

`channel name(args):` declares typed latest state.
Recent heartbeats are a workaround for recent activity: lag is the
heartbeat interval plus the expiry delay; disconnects are seen late.
Do not gate delivery on heartbeats; use durable receipts.

```q
channel typing(conversationId: conversations):
  value: { typing: bool }
  publish <- exists memberships[conversationId, viewer]
  subscribe <- exists memberships[conversationId, viewer]
  ttl 4s
```

`value`: closed record without assets/bytes/cursors. `ttl`: 1–30 s.
`useChannel` returns `entries`, `status`, `set`, `clear`; entries have `key`,
`from`, `value`, `expiresAt`. Renew explicitly. `client.channel`
opens on `subscribe`/`set`; `close` releases it. Reconnect starts fresh.
`set`/`clear` resolve `{ ok: true }` or `{ state: "refused", ...Refusal }`,
including connection loss. Lease/closed/version refusals require a ready/new
handle; writes never replay.

## Connected

`connected` is a read-only virtual table: `exists connected[p]` tests connection;
`#connected[p]` counts SSE transports (including `--as`). Pass a nonoptional
principal. Reads share one immutable snapshot per program run. Connect/close
affects the next execute; live reruns wait up to 1 s. Rules use durable facts.
Offline: `hydrating` and never predicted.

## Unicode word-prefix search

Declare `by bySearch: conversationId, wordPrefixes(body), at, id`:

```q
query search(term: text <=128, c: cursor ?):
  page = merge messages after c last 20 by bySearch:
    [m.conversationId, term] for m in memberships[viewer] first 50 by byPrincipalConversation
  return page
```

Unicode 17 NFC/simple case fold/NFC; accents matter. The term must normalize to exactly one word.
Zero words match nothing; multiple words refuse. Its held twin uses
the same index: held/partial/capped.
