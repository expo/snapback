# Fan-out and complete reads

Mutation `for` covers a capped prefix (`E_STRUCTURAL_FANOUT`). The loop,
argument or schema sets its bound. `cap` refuses excess rows and prices each
write by that cap. Do not cap followers merely to certify a loop.

Use `merge` for following feeds, `cap` for genuinely limited group membership,
and a job's `chunk` for a complete pass over an uncapped population. There is
no synchronous per-write fan-out over an uncappable population.
`check --cost` explains the actual row widths and repeated reads.

## Following

All 500 follows plus self participate; equal prefixes deduplicate. Reducing
discovery omits people; reducing pages preserves continuation.

```q
query followingFeed(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 500 by byFollower
  return page { post: ., author: profiles[.author] { id, displayName, handle, avatar } }
```

For 1,000 follows, merge compact immutable post heads and point-read each
post. Publish/remove post and head atomically; edits retain the head.

## Search grouped by chat

Page all memberships, including empty matches. This reaches the last of
1,000 chats with bounded subscriptions. Groups follow membership index order,
without a global message-time ranking or client merge.

```q
query searchGroups(term: text <=128, membershipCursor: cursor ?):
  page = memberships[viewer] after membershipCursor first 10 by byPrincipalConversation
  return page {
    membershipId: .id,
    conversation: conversations[.conversationId],
    matches: messages[.conversationId, term] last 1 by bySearch,
  }
```

Outer `next` continues memberships even when all `matches` are empty. Each
yield retains its own snapshot and receipt:

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

Render nonempty groups. Expansion uses a separate message cursor starting at
null. Reset both cursors on term changes; current membership rules apply.

```q
query searchChat(conversationId: conversations, term: text <=128, messageCursor: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return messages[conversationId, term] after messageCursor last 20 by bySearch
```

For global message-time order, copy the packaged
`guide/recipes/global-message-search.ts`. It binds scope/message queries to
`snapback2/global-search-pager`, captures the term, and retains branded cursors
and per-scope issues. Recreate on term/membership changes; never mount 1,000
live shapes. Its scope/message snapshots exclude concurrent changes.

## Rich history

Keep enrichments in small pages. `observePages`/`usePage` and `loadMore()`
follow valid links and rebuild changed boundaries; pages keep separate snapshots.

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

These sizes qualify this schema only. Complete per-message reactions/receipts
must fit: the fixture caps reactions and membership at 50. See `guide pagination`
for source changes and offline continuation.

## Scheduled totals

Jobs walk the population in resumable chunks (`guide job`). System jobs
bypass viewer rules; chunks see different snapshots. Cached totals cannot
prove final authorization/expiry: validate eligibility when emitting, or
preserve it through every contributing mutation. A partial sum is not a digest.
