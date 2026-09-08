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

When a screen needs a list, count, and preview coherently, return all three from
one named query and mount that ref/arguments in each consumer. Chat's
`deliveries.conversationView` does this. A partial composite stays partial;
fallback held history must hide count/preview until it is usable.

Lists can pass `{ items: threadItems }` to `useQuery` or `client.observe`.
Chat's `shared/thread.ts` declares `defineItems(query, { table, select, order,
create, update, remove })` from `snapback2/client`. `select` returns an original
row or null; object results also supply `rows: view => view.messages`.
Create names `op`, `belongs(args, query)`, `key(intent)`, and `draft(args)`;
update/remove name `op` and `key(args)`. Only this recipe's first insert uses
`intent.ids[0]`; other mutations declare their own correspondence.

The added `items` have stable `key`, selected `data` or submitted `draft`,
`predicted`, and FIFO `pending` actions with labels and dismissal availability.
Drafts have no server time. The original receipt/status remain unchanged.
Evidence follows actual rows; a lookalike with the same ID cannot borrow it.

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
A heartbeat table can track foreground activity, delayed by its interval plus
expiry. Delivery still needs durable receipts and a delayed unacknowledged check.

## Connected

`exists connected[p]` tests a principal's live connection; `#connected[p]`
counts authenticated SSE transports (including `--as`), once per transport,
regardless of subscriptions. Pass one nonoptional principal (`viewer` for self).
This built-in is read-only: do not declare it in the schema. Query/mutation
programs may read it; rules/maintains must use durable facts instead.

Each read charges one probe and touches `_connected` at that principal. One
immutable snapshot covers a program run. Connect/close is visible to the next
execute; live reruns coalesce for up to 1 s. Revocation closes session streams;
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
are refused. The membership merge returns one page/cursor; its held twin uses the same index
and reports `held`, `partial`, or `capped`, never complete server search.

Normalized words stay index-internal; no `words()` function. `tokens(text)`
extracts mentions.
