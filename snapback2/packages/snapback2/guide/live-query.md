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
