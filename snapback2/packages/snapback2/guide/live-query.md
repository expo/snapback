# Live query

Bound scans. Cursor indexes end in `id`; pass `cursor ?` to `after`,
with `null` for page one.

`complete`/`capped` carry opaque `next: Cursor | null`, bound to table/index/order.
Pass it back; never inspect or construct it. A record may hold one cursor page
beside count/fixed preview; aliases and shapes preserve it. Competing cursor
pages have no continuation. Reset on index/order changes.

`client.subscribe(api.messages.thread, args, listener)` emits responses/refusals.
`client.observe`/`useQuery` share an immutable snapshot: `data`, certified
`receipt` (`outcome`, `source`, `seq`, `next`), `freshness`, local
prediction/retention/catch-up facts, and refusal. Derived `status` is `loading`,
`ready`, or `unavailable`, with `reason`. Local commits reevaluate once;
bookkeeping is silent. Resets load; transport preserves the certified outcome.

One query for list/count/preview; add history:
`withHistory(items, { items: threadItems, args: q => ({ ...q, c: null }) })`.
`itemsFrom === "query"` narrows `data` to the complete composite; readable
fallback is `history`, else `drafts`. Its `history` snapshot exists iff the
composite is partial; never denial/refusal/reset. Retained mixed or purged
projections are partial: rows give no count/preview. History cursors belong to
that query; a usable composite detaches history.

Declare `{ items: spec }` for `useQuery`/`observe` with `snapback2/client`'s
`defineItems(query, { table, select, order, create, update, remove })`; record
results also name `rows`. `select` returns an original row or null. Actions name
`target: mutationTarget(op, "messages")`; submit that target to
`useMutation`/`client.mutation` too. Choices are typed; addresses are certified.
Ambiguous or changed-program targets stay intent-only.

Items expose stable `key`, selected `data`, submitted `draft` during create,
`predicted`, and FIFO `pending` actions. Drafts have no server time. Row evidence
settles indicators; receipt/status and durable history stay intact.

One SSE connection holds up to 256 query/channel subscriptions, including
HTTP/1.1. Closing one leaves peers active; CSS hiding keeps queries active.
Unmount unused components; close the client with its scope.

Keep newest-first subscriptions at `c: null`; fetch history with `next`, preserving
scope/state/freshness. `drain: true` in `subscribe`/`useQuery` pages then watches
an ascending append log (`after c first N`, N <=50). Unsupported shapes refuse
E_OFFLINE_RESUME, `reason: "unsupported-log"`. Descending queries stay valid. See offline.

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

`value` is a closed, nonempty record of argument types; no asset/bytes/cursor fields,
even nested. Omitted optionals become null; wrong/extra fields refuse.
`ttl` is integer seconds, 1–30.

`useChannel(api.typing, { conversationId })` returns `entries`, `status`
(`loading | ready | unavailable`), `set({ typing: true })` and `clear()`.
Each handle owns one entry: `key`, server-derived `from`, typed `value`, `expiresAt`.
Set replaces value and renews TTL; clear removes it. Presence renews explicitly.

`client.channel(ref, args)` opens on `subscribe(listener)` or `set(value)`;
read `getSnapshot()`. Observation `close()` detaches a listener; handle `close()`
ends the connection. React cleans up; cold clear opens nothing. Snapshots arrive
immediately, coalesce, and restart fresh on reconnect without republishing.
Loss clears client state; disconnect/expiry/revocation/restart remove state.
No history, queries or offline queue.

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

## Unicode word-prefix search

`wordPrefixes` is a maintained nonunique bounded text index, after scope and before
ordering. Equality-bind scope/search; no point reads, rules, writes or maintains.

`messages` declares `by bySearch: conversationId, wordPrefixes(body), at, id`:

```q
query search(term: text <=128, c: cursor ?):
  page = merge messages after c last 20 by bySearch:
    [m.conversationId, term] for m in memberships[viewer] first 50 by byPrincipalConversation
  return page
```

Unicode 17 applies NFC, simple case fold, then NFC; whitespace and Unicode
punctuation split words. Accents matter. The term must normalize to exactly one word:
zero words match nothing; multiple words refuse. The merge returns one page/cursor.
Its held twin uses
the same index and reports `held`, `partial`, or `capped`, never complete server search.

`tokens(text)` extracts mentions; search words stay internal.
