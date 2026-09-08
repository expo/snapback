# Live query

Commits intersecting a query trace make it live. Bound scans. Cursor indexes
end in `id`; pass `cursor ?` to `after`, with `null` for page one.

```q
query thread(conversationId: conversations, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  return messages[conversationId] after c last 50
```

`complete` and `capped` carry `next: Cursor | null`. Pass the opaque token back
for the next page; it is bound to table/index/order and must not be inspected or
constructed. Through aliases, shapes, and conditional branches, `next` follows
the page returned. Reset it to `null` when switching index or order.

`client.subscribe(api.messages.thread, args, listener)` emits query responses
or refusals. Transport `live`/`stale` never replaces the certified outcome.

`client.observe` shares one immutable snapshot with headless and React.
`useQuery` returns it: `data`; certified `receipt` (`outcome`, `source`, `seq`,
`next`); `freshness`; local prediction/retention/catch-up facts; and refusal.
`status` (`loading`, `ready`, `unavailable`) and `reason` are derived. Effective
local commits reevaluate once; bookkeeping stays silent. Resets load; transport
state does not replace the certified outcome.

For coherent list/count/preview, use one named query such as
`deliveries.conversationView`. Only a partial receipt, even without data,
enables independently observed history; that history supplies no count or
preview. Complete/capped composite data supplies all three and detaches the
fallback. Denial, refusal and account reset cannot enable it; `status` grants
no authority.

Use `{ items: spec }` with `useQuery`/`observe`. Declare `spec` once with
`snapback2/client`'s `defineItems(query, { table, select, order, create, update,
remove })`; object results also name `rows`. `select` returns an original row
or null. Chat's typed `shared/thread.ts` binds each operation to its target;
only its post recipe uses `ids[0]`.

Items have stable `key`, selected `data`, submitted `draft` while a create is
pending, `predicted`, and FIFO `pending` actions. Drafts have no server time.
Row evidence resolves indicators; receipt/status and durable history stay intact.

One SSE connection carries up to 256 query/channel subscriptions per client,
including HTTP/1.1. Adding/closing one leaves peers active. Unmount unused
components; CSS hiding keeps queries active. Close the client with its scope.
Reconnect re-delivers query state, not ephemeral channel events.

Keep newest-first subscriptions at `c: null`; fetch older pages separately with
`next`, preserving scope/state/freshness. History reads do not move the live head.
`drain: true` in `client.subscribe`/`useQuery` follows an ascending append log
(`after c first N`, N <=50), emitting each page then watching its tail. Unsupported
returned shapes refuse E_OFFLINE_RESUME, `reason: "unsupported-log"`. Ordinary
descending queries stay valid. See offline.

## Channels

`channel name(args):` declares ephemeral events with `publish` and `subscribe`
rules and `ttl Ns`. Use channels for transient signals such as typing;
subscriptions carry events, not durable rows or replayable history.
A heartbeat table is a workaround for recent activity such as foreground use.
Its lag is the heartbeat interval plus the expiry delay; disconnects are seen late.
Do not gate delivery on it: use durable receipts and a delayed unacknowledged check.

## Connected

`connected` is a read-only virtual table: `exists connected[p]` tests a
principal's live connection; `#connected[p]`
counts authenticated SSE transports (including `--as`), once per transport,
regardless of subscriptions. Pass one nonoptional principal (`viewer` for self).
Do not declare this built-in in the schema. Query/mutation
programs may read it; rules/maintains must use durable facts instead.
Each read charges one probe and touches `_connected` at that principal. One
immutable snapshot per program run covers every read. Connect/close is visible to the next
execute; live reruns wait up to 1 s to coalesce. Revocation closes session streams;
silent partitions surface on failed writes with no latency guarantee. Offline
reads are `hydrating` and never predicted, even with a cache. Connection is no
foreground/idle or delivery guarantee and adds no channel/subscriber broadcast.

## Unicode word-prefix search

`wordPrefixes` is an engine-maintained nonunique index component over one or
more bounded text columns. Put ordinary scope columns before it and ordinary
ordering columns after it. A query must equality-bind every scope column and
the search component; it cannot use the index for point reads, rules, writes,
or maintained aggregates.

The chat template declares
`by bySearch: conversationId, wordPrefixes(body), at, id` on `messages` and
binds it through this named query:

```q
query search(term: text <=128, c: cursor ?):
  page = merge messages after c last 20 by bySearch:
    [m.conversationId, term] for m in memberships[viewer] first 50 by byPrincipalConversation
  return page
```

The pinned Unicode 17 contract is NFC, simple case fold, then NFC. Whitespace
and Unicode punctuation separate words; accents remain significant. The term
must normalize to exactly one word: zero words match nothing and multiple words
are refused. The membership merge returns one page/cursor. Its held twin uses
the same index and reports `held`, `partial`, or `capped`, never complete server search.

Normalized words stay index-internal; no `words()` function. `tokens(text)`
extracts mentions.
