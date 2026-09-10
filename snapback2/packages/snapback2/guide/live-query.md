# Live query

`useQuery(api.messages.inbox, {})`: `data | undefined`, `status`
(`loading | ready | unavailable`), `reason`, `items`, `next` (cursor/null),
`partial` (history). Once metadata resolves, missing/null declared cursors
share identity; item/history callbacks get `null`.
Preparation failure refuses; observe again to retry. Unrelated `c: null` stays data.
`client.observe`: `getSnapshot()`/`subscribe(notify)`; `{ live: false }` reads once.

`useMutation(op)`: `{ run, inFlight, last, can }`. `run(args)` and
`client.mutation` resolve `committed | queued | rejected`, never throw.
`Refusal`: `code`, `family`, `message`; optional `rewrite`, `guide`, `site`,
`rule`, `retryable`, `reason`. `require … else CODE` gives family `rule`, that
code, `rule: CODE` and its authored `site`, live and replayed; authored
`conflict` stays a rule rejection. `client.query` resolves failures as `refused`.
Transport/body loss: `transport/E_TRANSPORT`, `retryable: true`.
Cancellation, including during body reads: `client/E_ABORTED`. Malformed JSON and invalid
wire data: `op/E_WIRE_SHAPE`. Closed: `owner/E_CLIENT_CLOSED`; unexpected local
failure: `client/E_CLIENT`. These are non-retryable. Mutation calls without durable admission
never resubmit automatically; a lost/invalid response may follow a commit.
`client.query()` retries retryable transport failures with backoff, up to three attempts.
One-shot `observe`/`useQuery` can keep retrying retryable refusals; live observes
reconnect through SSE.
Queued writes replay after `online()` (`guide offline`). `last` clears on
account/op change. `ResultOf<Op>`/`ArgsOf<Op>`: `snapback2/client`.

`usePage(op, args, options?)` returns
`{ items, pages, loadMore, hasMore, status, reason }` for arrays.
Omit `c` (or `options.cursor`). Pages stay live by previous `next`; args reset pages. Keep cursors unchanged.
`hasMore` means a continuation is currently proved, not that a partial has
exhausted server data. Check `pages`/`reason`: a queued prediction can temporarily
make a computed offline page partial without `next`, even for another operation.
Do not invent offsets or reuse an old cursor on changed data.

`defineItems(query, { table, select, order, create, update, remove })` binds
items; composites name `rows`. `select` returns an original row or null.
Actions: `target: mutationTarget(op, "messages")`.
Items: `key`, `data`, `draft`, `predicted`, FIFO `pending`.
`withHistory(items, { items: threadItems, args: q => q })` adds fallback:
Unusable `data` is undefined; history grants no scalar authority.
Usable composites, denial/refusal/reset release history.

Opt-in: `receipt` (`state`, `source`, `seq`, `next`), `freshness`, `local`,
`refusal`, `history`, `itemsFrom`.

`{ drain: true }` on `observe`/`useQuery` pages then tails an ascending append log
(`after c first N`, N <=50). Other shapes refuse E_OFFLINE_RESUME.

## Channels

`channel name(args):` declares typed latest state.
For recent activity, heartbeats are a workaround: lag is the heartbeat interval plus the expiry; disconnects are seen late.
Do not gate delivery on heartbeats; use durable receipts.

```q
channel typing(conversationId: conversations):
  value: { typing: bool }
  publish <- exists memberships[conversationId, viewer]
  subscribe <- exists memberships[conversationId, viewer]
  ttl 4s
```

`value`: closed record, no assets/bytes/cursors. `ttl`: 1–30 s.
`useChannel` returns `entries`, `status`, `set`, `clear`; entries have `key`,
`from`, `value`, `expiresAt`. Renew explicitly. `client.channel` opens on `subscribe`/`set`; `close` releases it.
Reconnect starts fresh.
`set`/`clear` resolve `{ ok: true }` or `{ state: "refused", ...Refusal }`,
including connection loss. Lease/closed/version refusals require a ready/new
handle; writes never replay.

## Connected

`connected` is a read-only virtual table: `exists connected[p]` tests connection;
`connected[p]` counts authenticated SSE transports once each (including `--as`).
Pass a nonoptional principal (`viewer` for self).
Programs may read it; rules/maintains use durable facts. A read costs one probe,
touches `_connected` at that principal, and shares one immutable snapshot per program run.
Connect/close affects the next execute; live reruns wait up to 1 s to coalesce.
Revocation closes session streams; silent partitions surface on failed writes
with no latency guarantee. Offline reads are `hydrating` and never predicted.
Connection promises no foreground/idle or delivery guarantee or channel/subscriber broadcast.

For an application-level delivery acknowledgement loop, expose a private,
indexed `first 1` query over the viewer's pending receipt rows. A mounted
watcher acknowledges that exact row; its deletion advances the query to the
next row. Authorize cleanup from that private receipt; requiring its message
to remain present can strand the queue after unsend or expiry.
Do not rescan a capped message page as a work queue: unrelated
rerenders repeat every acknowledgement, and the page stops changing length at
its cap. Drive an open-thread read acknowledgement from a certified
viewer-specific unread value and latest activity identity instead: equal
counts can hide an intervening read/new-message cycle. The write's readiness belongs in the
effect dependency so a watcher mounted before its grant becomes ready later.

## Unicode word-prefix search

Declare `by bySearch: conversationId, wordPrefixes(body), at, id`:

```q
query search(term: text <=128, c: cursor ?):
  page = merge messages after c last 20 by bySearch:
    [m.conversationId, term] for m in memberships[viewer] first 50 by byPrincipalConversation
  return page
```

Unicode 17 NFC/simple case fold/NFC; accents matter. The term must normalize to exactly one word.
Zero words match nothing; multiple refuse. Its held twin uses
the same index: held/partial/capped.
