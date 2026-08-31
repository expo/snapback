-- Clique — profiles, posts, feeds, follows, likes

-- Profile row is keyed by the identity principal (id: viewer), so
-- users[viewer] is the viewer's own profile and reference columns compare
-- directly against viewer in rules.
mutation createProfile(displayName: text <=50, handle: text <=20) -> users:
  +users { id: viewer, displayName, handle, followerCount: 0, followingCount: 0 }

mutation updateProfile(displayName: text <=50, handle: text <=20, bio: text <=200 ?, location: text <=50 ?, link: text <=200 ?) -> users:
  me = users[viewer]! else NO_PROFILE
  ~users[viewer] { displayName, handle, bio, location, link }
  users[viewer]

query me():
  users[viewer]

query profile(u: users):
  users[u]

query profileByHandle(handle: text <=20):
  users[handle = handle]

query listUsers():
  users[] first 50 by byHandle

-- Pre-mint ids with `new`: the platform's insert result carries a re-minted
-- id (store keeps the written id, the returned row does not), so `p.id`
-- after an insert is poisoned. Re-read by the pre-minted id to return data.
mutation createPost(body: text <=500, ord: int) -> posts:
  pid = new
  t = now
  +posts { id: pid, author: viewer, body, at: t, likeCount: 0, replyCount: 0, repostCount: 0 }
  +feedItems { actor: viewer, post: pid, kind: 'post', origAuthor: viewer, at: t, ord }
  p = posts[pid]! else IMPOSSIBLE
  p { id, at }

mutation createReply(parent: posts, body: text <=500) -> posts:
  par = posts[parent]! else PARENT_NOT_FOUND
  pid = new
  t = now
  +posts { id: pid, author: viewer, body, parent, at: t, likeCount: 0, replyCount: 0, repostCount: 0 }
  ~posts[parent] { replyCount: .replyCount + 1 }
  p = posts[pid]! else IMPOSSIBLE
  p { id, at }

mutation toggleLike(p: posts) -> bool:
  post = posts[p]! else POST_NOT_FOUND
  match likes[viewer, p]:
    some l:
      -likes[l.id]
      ~posts[p] { likeCount: .likeCount - 1 }
      false
    none:
      +likes { user: viewer, post: p, at: now }
      ~posts[p] { likeCount: .likeCount + 1 }
      true

mutation toggleRepost(p: posts, ord: int) -> bool:
  post = posts[p]! else POST_NOT_FOUND
  -- absence idiom: a predicate over an absent value is false, so
  -- `post.parent = post.parent` is true exactly when parent is present.
  require not (post.parent = post.parent) else CANNOT_REPOST_REPLY
  match feedItems[actor = viewer, post = p, kind = 'repost']:
    some f:
      -feedItems[f.id]
      ~posts[p] { repostCount: .repostCount - 1 }
      false
    none:
      +feedItems { actor: viewer, post: p, kind: 'repost', origAuthor: post.author, at: now, ord }
      ~posts[p] { repostCount: .repostCount + 1 }
      true

mutation toggleFollow(u: users) -> bool:
  require u != viewer else SELF_FOLLOW
  other = users[u]! else USER_NOT_FOUND
  match follows[viewer, u]:
    some f:
      -follows[f.id]
      ~users[u] { followerCount: .followerCount - 1 }
      ~users[viewer] { followingCount: .followingCount - 1 }
      false
    none:
      +follows { follower: viewer, followee: u, at: now }
      ~users[u] { followerCount: .followerCount + 1 }
      ~users[viewer] { followingCount: .followingCount + 1 }
      true

query globalFeed():
  feedItems[] first 20 by byOrd {
      id, kind, at, ord, actor, post,
      reposter: .actor { displayName, handle },
      item: .post {
        id, author, body, parent, at, likeCount, replyCount, repostCount,
        authorProfile: .author { displayName, handle },
      },
    }

query globalFeedBefore(cursor: int):
  feedItems[] after cursor first 20 by byOrd {
      id, kind, at, ord, actor, post,
      reposter: .actor { displayName, handle },
      item: .post {
        id, author, body, parent, at, likeCount, replyCount, repostCount,
        authorProfile: .author { displayName, handle },
      },
    }

-- One lane of the Following feed (also the profile post list): a user's
-- originals + reposts. The Following feed is a bounded client-side merge
-- over lanes (viewer + followees) because the compiler refuses both
-- merge(...) and maintained feed rows.
query laneFeed(u: users):
  feedItems[u] first 20 by byActorOrd {
      id, kind, at, ord, actor, post,
      reposter: .actor { displayName, handle },
      item: .post {
        id, author, body, parent, at, likeCount, replyCount, repostCount,
        authorProfile: .author { displayName, handle },
      },
    }

query laneFeedBefore(u: users, cursor: int):
  feedItems[u] after cursor first 20 by byActorOrd {
      id, kind, at, ord, actor, post,
      reposter: .actor { displayName, handle },
      item: .post {
        id, author, body, parent, at, likeCount, replyCount, repostCount,
        authorProfile: .author { displayName, handle },
      },
    }

query thread(p: posts):
  post = posts[p]! else POST_NOT_FOUND
  post {
    *,
    authorProfile: .author { displayName, handle },
    replies: posts[parent = p] first 50 by byParent {
      *,
      authorProfile: .author { displayName, handle },
    },
  }

query myFollowing():
  follows[follower = viewer] first 100 by byFollower { followee, at }

query myLikes():
  likes[user = viewer] first 200 by byUserPost { post }

query myFeedMarks():
  feedItems[actor = viewer] first 200 by byActor { post, kind }
