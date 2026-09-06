# Live query

A query is live because its authoritative read trace intersects a commit, not
because the author declares an invalidation list. Bound every scan:

For paging, every cursor index ends in intrinsic `id`. Declare a `cursor ?`
argument and pass it to Quarry's forward-only `after` clause; `null` means the
first page.

```ts
export const thread = query({ conversationId: t.ref(conversations) }, ({ db, ctx, args }) => {
  db.require(
    db.exists(memberships.byConversationPrincipal, [args.conversationId, ctx.viewer]),
    "MEMBERSHIP_REQUIRED",
  );
  return db.scan(messages.byConvTime, [args.conversationId], { order: "desc", take: 50 });
});
```

`complete` and `capped` receipts carry `next: Cursor | null`. Pass that opaque
token back as the cursor argument for the next page. It represents the last
returned row, is bound to the table/index/order, and must not be inspected or
constructed by application code.

Subscribe through `client.subscribe(api.messages.thread, args, listener)`.
Each SSE data frame is a query response or refusal. Connection `live`/`stale`
facts belong to the client and never replace `complete`/`capped`/`denied`.

The client shares one SSE connection across its query and channel subscriptions,
including on the local HTTP/1.1 server. Adding or closing a subscription does
not restart the others. Close unused subscriptions (or unmount their React
components); hiding a component with CSS keeps its queries active. Each client
supports up to 256 subscriptions. Close the client when its application scope
ends. Reconnect re-delivers query state; ephemeral channel events are not replayed.

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
choose what to expose; rules and maintains cannot read it. It counts authenticated
SSE transports (including personas via `--as`), once per transport regardless of query/channel subscriptions,
from identity establishment until stream close; revocation cuts that session's
streams. A silent partition is detected on a failed write, with no latency
guarantee. Each read charges one probe and touches `_connected` at that principal.
Each program sees one immutable snapshot per program run. Connect/close is
visible to the next execute; live reruns wait up to 1 s to coalesce changes. Offline,
a program reading `connected` is `hydrating` and never predicted, even with a
cached answer. Connections say nothing about foreground/idle state or delivery
guarantees; this adds no channel kind or subscriber-set broadcast.
