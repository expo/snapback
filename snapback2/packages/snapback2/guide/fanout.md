# Fan-out

`E_STRUCTURAL_FANOUT` needs a complete bound. Caps reject excess rows;
use merge/jobs for uncapped scope.

## 1,000-follow feed

Publish/remove post+head atomically; edits retain the head.

```q
table postHeads:
  post: posts
  author: principal
  at: time
  unique byPost: post
  by byAuthorTime: author, at, id
  immutable post, author, at
  public
  insert <- .author = viewer
  delete <- .author = viewer
```

```q
query followingFeed(c: cursor ?):
  heads = merge postHeads after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 1000 by byFollower
  return heads { post: posts[.post] }
```

```q
mutation publishPost(body: text <=500, period: int):
  post = insert posts { author: viewer, body, period, at: now }
  insert postHeads { post: post.id, author: viewer, at: post.at }
  return post

mutation editPost(postId: posts, body: text <=500):
  post = posts[postId] ! else NOT_FOUND
  update posts[post] { body }
  return posts[post]

mutation removePost(postId: posts):
  post = posts[postId] ! else NOT_FOUND
  head = postHeads[postId] by byPost
  if head != null:
    delete postHeads[head]
  delete posts[post]
  return null
```

1,001 lanes × 20: output 48,752; closure 2,024,488; heap 1,605,760;
steps 50,180. Page wider rows across every lane.

## Search every chat

```q
query searchScopes(c: cursor ?):
  return memberships[viewer] after c first 100 by byPrincipalConversation { conversation: .conversation }

query conversationMessageSearch(conversation: conversations, term: text <=128, c: cursor ?):
  return messages[conversation, term] after c last 1 by bySearch
```

Copy `node_modules/snapback2/dist/guide/recipes/global-message-search.ts`:
opaque cursors, `(at,id)` scalar order, pages/issues. Recreate on term/membership
changes. Current-member reads have separate snapshots; never mount 1,000 live shapes.

This interim client N-way merge costs scope pages + one head per chat + refills.
Frozen Clique hub: 1,000 chats, 100,015 messages; `busy` matches only the final
scope slice. First 20: **1,030 HTTP queries, 669/616 ms localhost** (EPYC,
0.0.25, concurrency 16); absent term: 1,010/576 ms. Later pages refill.
Counts grow with memberships; one-lane search remains open (LLP 1024).

## Rich rows and jobs

Page all raw history at 50 and rich rows at 10; snapshots are separate
(`guide pagination`).

```q
job digestPass(period: int):
  chunk f in follows first 50 by byId:
    n = periodPosts[f.followed, period]
    account = digests[f.follower, period] by byTargetPeriod
    if account != null:
      update digests[account] { newPostsInFollowing: account.newPostsInFollowing + n }
```

```q
job directoryBackfill():
  chunk entry in directory first 25 by byId:
    update directory[entry] { normalized: entry.handle }
```

Jobs cover the table; literals bound a commit, not population.
