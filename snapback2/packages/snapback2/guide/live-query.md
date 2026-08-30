# Live query

A query is live because its authoritative read trace intersects a commit, not
because the author declares an invalidation list. Bound every scan:

```ts
export const thread = query({ conversationId: t.ref(conversations) }, ({ db, ctx, args }) => {
  db.require(
    db.exists(memberships.byConversationPrincipal, [args.conversationId, ctx.viewer]),
    "MEMBERSHIP_REQUIRED",
  );
  return db.scan(messages.byConvTime, [args.conversationId], { order: "desc", take: 50 });
});
```

Subscribe through `client.subscribe(api.messages.thread, args, listener)`.
Each SSE data frame is a query response or refusal. Connection `live`/`stale`
facts belong to the client and never replace `complete`/`capped`/`denied`.
