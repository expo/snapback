# Live query

`useQuery(api.messages.inbox, {})`: `data | undefined`, `status`
(`loading | ready | unavailable`), `reason`, `items`, `next` (cursor/null),
`partial` (history). After metadata resolves, absent/null declared cursors
share identity; item/history callbacks get `null`.
Preparation failure refuses; re-observe to retry. Other `c: null` stays data.
`client.observe`: `getSnapshot()`/`subscribe(notify)`; `{ live: false }` reads once.

`useMutation(op)`: `{ run, inFlight, last, can }`. `run(args)` and
`client.mutation` resolve `committed | queued | rejected`, never throw.
`Refusal`: `code`, `family`, `message`; optional `rewrite`, `guide`, `site`,
`rule`, `retryable`, `reason`. `require … else CODE` gives family `rule`, that
code, `rule: CODE` and its authored `site`, live and replayed; authored
`conflict` stays a rule rejection. `client.query` resolves failures as `refused`.
Transport/body loss: `transport/E_TRANSPORT`, `retryable: true`.
Cancellation, including body reads: `client/E_ABORTED`. Invalid JSON/wire data:
`op/E_WIRE_SHAPE`. Closed: `owner/E_CLIENT_CLOSED`; unexpected local failure:
`client/E_CLIENT`. These are non-retryable. Mutation calls without durable admission
never resubmit automatically; lost/invalid responses may follow a commit.
`client.query()` retries retryable transport failures with backoff, up to three attempts.
One-shot `observe`/`useQuery` can keep retrying retryable refusals; live observes
reconnect through SSE with fresh snapshots, never Last-Event-ID replay.
Same op/canonical args share one subscription across hooks.
Each client allows 256 live shapes; child 257 refuses `E_OWNER_BUSY`,
`site: client.subscribe`, preserving existing children. Use one list/composite
query with row receipts/reactions; avoid per-row queries and polling
reconciliation for ordinary live delivery.
Queued writes replay after `online()` (`guide offline`). `last` clears on
account/op change. `ResultOf<Op>`/`ArgsOf<Op>`: `snapback2/client`.

`usePage(op, args, options?)` / lazy `client.observePages` returns
`{ items, pages, loadMore, hasMore, status, reason }` for arrays.
Omit `c` (or `options.cursor`). Pages stay live by previous `next`; args reset pages. Keep cursors unchanged.
`hasMore` means a continuation is currently proved, not that a partial has
exhausted server data. Check `pages`/`reason`: a queued prediction can temporarily
make a computed offline page partial without `next`, even for another operation.
Do not invent offsets or reuse an old cursor on changed data.
With `{ items }`, `items` keeps row/draft types; `head.data` owns the primary
summary. `pages` contains original snapshots, with no combined receipt.
Declared history uses its own cursors; `itemsFrom` identifies the active
source. See `guide pagination` for ordering and handover.

`defineItems(query, { table, select, order, create, update, remove })` binds
items. Declare it outside render; composites name `rows`. `select` returns
an original row or null; omit for row sources. Wrappers need it; name `table`.
Actions: `target: mutationTarget(op, "messages")`.
Items: `key`, `data`, `draft`, `predicted`, FIFO `pending`.
`withHistory(items, { items: threadItems, args: q => q })` adds fallback:
Unusable `data` is undefined; history grants no scalar authority.
Usable composites, denial/refusal/reset release history.

Opt-in: `receipt` (`state`, `source`, `seq`, `next`), `freshness`, `local`,
`refusal`, `history`, `itemsFrom`.

`{ drain: true }` on `observe`/`useQuery` pages then tails an ascending append log
(`after c first N`, N <=50). Other shapes refuse E_OFFLINE_RESUME.

## Load and refresh

Insights uses the provider's `useSnapbackClient()`; `paint` updates the screen.
A request counter fences overlapping/UTC-rollover answers. No hook refresh API:

```js
await client.ready;
let request = 0;
const key = () => JSON.stringify([client.snapshot.authGeneration, client.snapshot.generation]);
let identity = key();
const off = client.subscribeStatus(() => {
  if (identity !== key()) {
    identity = key(); request++;
    paint({ state: "unavailable" });
  }
});
async function refresh() {
  const mine = ++request;
  paint({ state: "refreshing" });
  if (client.snapshot.auth.state === "hydrating" && client.snapshot.connection !== "offline")
    await client.auth.me().catch(() => {});
  const result = await client.query(api.insights.screen, {});
  if (mine !== request || (result.state === "refused" && result.code === "E_AUTH_SUPERSEDED")) return "obsolete";
  paint(result);
  return result;
}
function cancel() { request++; paint({ state: "unavailable" }); }
function close() { request++; off(); }
await refresh();
```

Pull-to-refresh calls `refresh()`; unmount calls `close()`. `cancel()` ends
UI interest, not transport or durable work. Render `refused` as an error,
`live: false` as held/offline, and absent data as unavailable.
Auth confirmation precedes a connected cold read; query still reports held/refused on failure.

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

`connected[p]` counts authenticated SSE transports, including personas;
`exists connected[p]` tests presence. Pass a nonoptional principal, e.g.
`viewer`. Programs may read it; rules/maintains use durable facts.
Each read costs one probe and touches `_connected` at that principal;
one run shares an immutable snapshot. Connect/close affects the next execute;
live reruns coalesce for up to 1 s.
Session revocation closes streams. Silent partitions appear on failed writes,
without a latency guarantee. Offline: `hydrating`, never predicted.
Connection promises neither foreground/idle nor delivery/subscriber status.

For delivery acknowledgements, watch a private indexed `first 1` pending
receipt query. Acknowledge that exact row; deletion advances the queue.
Authorize cleanup by the receipt so unsend/expiry cannot strand it.
Do not use a capped message page as a queue: rerenders repeat acknowledgements,
and full-page lengths stop changing. Open-thread read acknowledgement needs
the viewer's certified unread value **and pending-read identity**: equal counts
or timestamp ties can hide intervening messages. Include mutation readiness in
the effect dependencies so a watcher mounted before its grant can start later.

## Unicode word-prefix search

Declare `by bySearch: conversationId, wordPrefixes(body), at, id`:

```q
query search(term: text <=128, c: cursor ?):
  page = merge messages after c last 20 by bySearch:
    [m.conversationId, term] for m in memberships[viewer] first 50 by byPrincipalConversation
  return page
```

Unicode 17 NFC/simple case fold/NFC; accents matter. The term must normalize to exactly one word.
Zero words match nothing; multiple refuse. The twin uses that index: held/partial/capped.
