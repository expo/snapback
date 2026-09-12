# Fan-out and complete reads

`E_STRUCTURAL_FANOUT` needs a complete loop/argument/schema bound. A `cap`
limits rows and prices writes; do not cap followers merely to certify.
Use `merge` for feeds, caps for bounded groups and job chunks for uncapped
passes. Synchronous fan-out over uncapped populations is unsupported.
`check --cost` explains row widths and repeated reads.

## Following

500 follows plus self; equal prefixes deduplicate. Page fewer rows, not fewer
people.

```q
query followingFeed(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 500 by byFollower
  return page { post: ., author: profiles[.author] { id, displayName, handle, avatar } }
```

For 1,000 follows, merge immutable post heads, then point-read posts.
Publish/remove post and head atomically; edits retain the head.

## Search grouped by chat

Page every membership, including empty matches. Groups follow membership
index order through all 1,000 chats.

```q
query searchGroups(term: text <=128, membershipCursor: cursor ?):
  page = memberships[viewer] after membershipCursor first 10 by byPrincipalConversation
  return page {
    membershipId: .id,
    conversation: conversations[.conversationId],
    matches: messages[.conversationId, term] last 1 by bySearch,
  }
```

Outer `next` advances on empty matches; each yield has its own receipt:

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

Expand nonempty groups with a separate message cursor, initially null. Reset
both on term changes; current membership rules apply.

```q
query searchChat(conversationId: conversations, term: text <=128, messageCursor: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return messages[conversationId, term] after messageCursor last 20 by bySearch
```

For global time order, copy `guide/recipes/global-message-search.ts`.
The bound `snapback2/global-search-pager` captures term, cursors and issues.
Recreate on term/membership changes; never mount 1,000 live shapes.
Scope/message snapshots exclude concurrent changes.

## Rich history

`observePages`/`usePage` and `loadMore()` rebuild changed boundaries;
pages keep separate snapshots.

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

Bounds qualify this schema: reactions and membership are capped at 50.
See `guide pagination` for source changes and offline continuation.

## Scheduled totals

Jobs resume across snapshots and bypass viewer rules (`guide job`).
Validate eligibility at emission or preserve it through every contributing
mutation; a cached partial sum cannot prove authorization/expiry.
