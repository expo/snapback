# Live query

A query is live because its authoritative read trace intersects a commit, not
because the author declares an invalidation list. Bound every scan:

```ts
export const thread = query({ conversationId: t.id() }, ({ db, args }) =>
  db.scan(messages.byConvTime, [args.conversationId], { order: "desc", take: 50 }),
);
```

Subscribe through `client.subscribe(api.messages.thread, args, listener)`.
Each SSE data frame is a query response or refusal. Connection `live`/`stale`
facts belong to the client and never replace `complete`/`capped`/`denied`.
