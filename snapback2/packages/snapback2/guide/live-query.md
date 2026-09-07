# Live query

A commit intersecting a query's read trace makes it live. Bound every scan.
Cursor indexes end in intrinsic `id`; pass a `cursor ?` argument to `after`.
`null` means page one.

```ts
export const thread = query({ conversationId: t.ref(conversations) }, ({ db, ctx, args }) => {
  db.require(
    db.exists(memberships.byConversationPrincipal, [args.conversationId, ctx.viewer]),
    "MEMBERSHIP_REQUIRED",
  );
  return db.scan(messages.byConvTime, [args.conversationId], { order: "desc", take: 50 });
});
```

`complete` and `capped` carry `next: Cursor | null`. Pass the opaque token back
for the next page; it is bound to table/index/order and must not be inspected or
constructed. Through aliases, shapes, and conditional branches, `next` follows
the page returned. Reset it to `null` when switching index or order.

Subscribe through `client.subscribe(api.messages.thread, args, listener)`.
Each SSE data frame is a query response or refusal. Connection `live`/`stale`
facts belong to the client and never replace `complete`/`capped`/`denied`.

`client.observe` lazily shares one immutable snapshot with raw and React.
Effective local commits (prediction, settlement, coverage, authority) reevaluate
once; bookkeeping stays silent. Resets publish `hydrating`; `{live:false}` never
follows revisions.

When a screen needs a list, count, and preview coherently, return all three from
one named query and mount that same ref and arguments in each consumer. A
partial composite stays one partial value. If separate held history is useful as
a fallback, hide its count and preview until the composite is usable.

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
A heartbeat table remains a workaround for recent activity such as foreground use
when `connected` is not enough; its lag is the heartbeat interval plus the expiry
delay; disconnects are seen late. Do not gate delivery solely on it: use durable receipts and a delayed
check for an unacknowledged message.

## Connected

`connected` is a read-only virtual table: `exists connected[p]` tests whether
principal `p` has a live connection; `#connected[p]` counts connections. Pass one
nonoptional principal (for yourself, `viewer`) in a query or mutation. Programs
choose what to expose; rules and maintains cannot read it. Do not declare this
built-in in your schema. For a rule refusal, move the named probe into a program
and keep the rule based on durable facts. It counts authenticated
SSE transports (including personas via `--as`), once per transport regardless of query/channel subscriptions,
from identity establishment until stream close; revocation cuts that session's
streams. A silent partition is detected on a failed write, with no latency
guarantee. Each read charges one probe and touches `_connected` at that principal.
Each program sees one immutable snapshot per program run. Connect/close is
visible to the next execute; live reruns wait up to 1 s to coalesce changes. Offline,
a program reading `connected` is `hydrating` and never predicted, even with a
cached answer. Connections say nothing about foreground/idle state or delivery
guarantees; this adds no channel kind or subscriber-set broadcast.

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
are refused. The example searches every bounded conversation visible through
the membership merge and returns one page with one cursor. Its held twin uses
the same index and reports `held`, `partial`, or `capped` rather than presenting
downloaded results as complete server search.

The normalized word list is index-internal; Quarry has no public `words()`
value function. `tokens(text)` remains the separate mention extractor.
