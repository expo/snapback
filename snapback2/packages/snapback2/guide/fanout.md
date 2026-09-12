# Fan-out

`E_STRUCTURAL_FANOUT` requires a complete bound from your loop, argument, or
schema `cap`; caps reject rows. Use read merge/jobs for uncapped scope.

## Hub envelopes

| refusal | preserving form |
| --- | --- |
| 1,000-follow feed | narrow heads + 20 point reads |
| 1,000-chat search | every scope + shipped head pager |
| 50 rich rows | paged rich rows + raw page of 50 |
| whole digest | maintained cells + chunk job |
| 100-row backfill | 25-row chunks through `done` |

## 1,000-follow feed

Write/delete post and head atomically; edits leave the head unchanged.

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

1,001 lanes/20 rows cost output 48,752; closure 2,024,488; heap 1,605,760;
steps 50,180. Page wider rows; keep every lane.

## Search every chat

Page memberships; fetch one head per chat.

```q
query searchScopes(c: cursor ?):
  return memberships[viewer] after c first 100 by byPrincipalConversation { conversation: .conversation }

query conversationMessageSearch(conversation: conversations, term: text <=128, c: cursor ?):
  return messages[conversation, term] after c last 1 by bySearch
```

Copy `node_modules/snapback2/dist/guide/recipes/global-message-search.ts`.
It binds both queries and exact `(at,id)` ordering through the public pager,
including bounded pages, issues, and captured terms. Recreate it when the term
or memberships change; do not mount 1,000 live shapes.
`snapback2 new chat` supplies the write/revocation rules; reads apply current
membership. Separate snapshots cover the discovered directory, not concurrent
membership changes.

## Rich rows and jobs

Keep raw history at 50; page rich rows (often 10). `next` reaches every row;
the reads are separate snapshots (`guide pagination`).

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

Jobs continue through the table; literals bound one commit, not population.
