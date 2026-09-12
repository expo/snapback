# Fan-out and complete reads

A mutation's `for` must cover a capped prefix completely
(`E_STRUCTURAL_FANOUT`). Its number comes from your loop, argument or schema,
not a platform limit. A `cap` refuses excess rows and prices every write by
that cap. Never cap followers just to certify a loop.

Use `merge` for following feeds, `cap` for genuinely limited group membership,
and a job's `chunk` for a complete pass over an uncapped population. There is
no synchronous per-write fan-out over an uncappable population.
`check --cost` explains the actual row widths and repeated reads.

## Following

All 500 follows plus self participate; equal runtime prefixes deduplicate.
A smaller discovery bound omits people. Changing the message page size preserves
reachability only when its opaque continuation is followed.

```q
query followingFeed(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 500 by byFollower
  return page { post: ., author: profiles[.author] { id, displayName, handle, avatar } }
```

## Search grouped by chat

Page memberships, including those with no matches. This reaches a match in the
last of 1,000 memberships without maintaining 1,000 live subscriptions or
merging messages on the client. Groups follow membership index order; this is
not a global message-time ranking.

```q
query searchGroups(term: text <=128, membershipCursor: cursor ?):
  page = memberships[viewer] after membershipCursor first 10 by byPrincipalConversation
  return page {
    membershipId: .id,
    conversation: conversations[.conversationId],
    matches: messages[.conversationId, term] last 1 by bySearch,
  }
```

The outer page's `next` continues memberships. Keep it even when every
`matches` list is empty. This executable consumer yields the original
snapshots; it creates no aggregate receipt or shared snapshot.

```js
async function* groupedSearch(client, term) {
  let membershipCursor = null;
  do {
    const page = await client.query(api.messages.searchGroups, { term, membershipCursor });
    if (page.state !== "complete" && page.state !== "capped") {
      throw new Error("Search continuation is unavailable");
    }
    yield page;
    membershipCursor = page.next;
  } while (membershipCursor !== null);
}
```

Render nonempty groups from each yielded page. Expanding a group uses a separate
message cursor, starting at null; the preview's cursor is not the membership
cursor. Reset both when changing the term. Current membership rules still apply.

```q
query searchChat(conversationId: conversations, term: text <=128, messageCursor: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return messages[conversationId, term] after messageCursor last 20 by bySearch
```

## Rich history

A small page can keep every enrichment and reach busy history. Use the binding
below with `observePages` or `usePage`; `loadMore()` follows valid links and
rebuilds a changed boundary. Independent pages retain their own snapshots.

```q
query richThread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  page = messages[conversationId] after c last 5 by byConvTime
  return page {
    message: .,
    author: profiles[.authorId],
    quote: messages[.quoteId],
    reactions: reactions[.id] first 50 by byMessage,
    receipts: deliveriesReceipts[.id] first 50 by byRow { recipient, received },
  }
```

```js
const richItems = defineItems(api.messages.richThread, {
  table: "messages", select: row => row.message,
});
const history = client.observePages(api.messages.richThread,
  { conversationId }, { items: richItems });
```

These field widths and page sizes are a tested schema envelope, not universal
limits. Reactions and receipts require their complete per-message population
to fit the declared bounds; the fixture caps reactions and chat membership at 50.
See `guide pagination` for source changes and offline continuation.

## Scheduled totals

Jobs process the whole population in resumable chunks; see `guide job`.
A chunk can accumulate contributions, but a cached total alone cannot prove
final authorization or expiry. System jobs bypass viewer rules and chunks
observe different snapshots. Before emitting per-user totals, validate current
eligibility in that transaction or preserve it through every contributing
mutation. Never describe a partial sum as the completed digest.
