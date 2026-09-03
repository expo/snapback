-- Clique profiles, posts, feeds, follows, and likes regression surface.

mutation createProfile(displayName: text <=50, handle: text <=20):
  return +users { principal: viewer, displayName, handle, followerCount: 0, followingCount: 0 }

mutation updateProfile(displayName: text <=50, handle: text <=20, bio: text <=200 ?, location: text <=50 ?, link: text <=200 ?):
  me = users[principal = viewer]! else NO_PROFILE
  ~users[principal = viewer] { displayName, handle, bio, location, link }
  return users[me.id] by byId

query me():
  return users[principal = viewer]

query profile(u: users):
  return users[u]

query profileByHandle(handle: text <=20):
  return users[handle = handle]

query listUsers():
  return users[] first 50 by byHandlePage

-- IDs remain pre-minted so the sibling feedItems write can refer to the post.
mutation createPost(body: text <=500, ord: int):
  pid = new
  t = now
  +posts { id: pid, author: viewer, body, at: t, likeCount: 0, replyCount: 0, repostCount: 0 }
  +feedItems { actor: viewer, post: pid, kind: 'post', origAuthor: viewer, at: t, ord }
  p = posts[pid]! else IMPOSSIBLE
  return p { id, at }

mutation createReply(parent: posts, body: text <=500):
  par = posts[parent]! else PARENT_NOT_FOUND
  pid = new
  t = now
  +posts { id: pid, author: viewer, body, parent, at: t, likeCount: 0, replyCount: 0, repostCount: 0 }
  ~posts[parent] { replyCount: .replyCount + 1 }
  p = posts[pid]! else IMPOSSIBLE
  return p { id, at }

mutation toggleLike(p: posts):
  post = posts[p]! else POST_NOT_FOUND
  match likes[viewer, p]:
    some l:
      -likes[l.id]
      ~posts[p] { likeCount: .likeCount - 1 }
      return false
    none:
      +likes { user: viewer, post: p, at: now }
      ~posts[p] { likeCount: .likeCount + 1 }
      return true

mutation toggleRepost(p: posts, ord: int):
  post = posts[p]! else POST_NOT_FOUND
  -- Preserve the old fixture's absence workaround: guarded equality is false
  -- for an absent optional parent and true when the parent is present.
  require not (post.parent = post.parent) else CANNOT_REPOST_REPLY
  match feedItems[actor = viewer, post = p, kind = 'repost']:
    some f:
      -feedItems[f.id]
      ~posts[p] { repostCount: .repostCount - 1 }
      return false
    none:
      +feedItems { actor: viewer, post: p, kind: 'repost', origAuthor: post.author, at: now, ord }
      ~posts[p] { repostCount: .repostCount + 1 }
      return true

mutation toggleFollow(u: users):
  other = users[u]! else USER_NOT_FOUND
  require other.principal != viewer else SELF_FOLLOW
  match follows[viewer, u]:
    some f:
      -follows[f.id]
      ~users[u] { followerCount: .followerCount - 1 }
      ~users[principal = viewer] { followingCount: .followingCount - 1 }
      return false
    none:
      +follows { follower: viewer, followee: u, at: now }
      ~users[u] { followerCount: .followerCount + 1 }
      ~users[principal = viewer] { followingCount: .followingCount + 1 }
      return true

query globalFeed():
  return feedItems[] first 20 by byOrd {
    id, kind, at, ord, actor, post,
    reposter: users[principal = .actor] { displayName, handle },
    item: .post {
      id, author, body, parent, at, likeCount, replyCount, repostCount,
      authorProfile: users[principal = .author] { displayName, handle },
    },
  }

query globalFeedBefore(cursorOrd: int, cursorId: feedItems):
  return feedItems[] after (cursorOrd, cursorId) first 20 by byOrd {
    id, kind, at, ord, actor, post,
    reposter: users[principal = .actor] { displayName, handle },
    item: .post {
      id, author, body, parent, at, likeCount, replyCount, repostCount,
      authorProfile: users[principal = .author] { displayName, handle },
    },
  }

-- One lane of the Following feed. The app still merges these bounded lanes
-- client-side because Quarry intentionally has no merge primitive.
query laneFeed(u: users):
  actor = users[u]! else USER_NOT_FOUND
  return feedItems[actor.principal] first 20 by byActorOrd {
    id, kind, at, ord, actor, post,
    reposter: users[principal = .actor] { displayName, handle },
    item: .post {
      id, author, body, parent, at, likeCount, replyCount, repostCount,
      authorProfile: users[principal = .author] { displayName, handle },
    },
  }

query laneFeedBefore(u: users, cursorOrd: int, cursorId: feedItems):
  actor = users[u]! else USER_NOT_FOUND
  return feedItems[actor.principal] after (cursorOrd, cursorId) first 20 by byActorOrd {
    id, kind, at, ord, actor, post,
    reposter: users[principal = .actor] { displayName, handle },
    item: .post {
      id, author, body, parent, at, likeCount, replyCount, repostCount,
      authorProfile: users[principal = .author] { displayName, handle },
    },
  }

query thread(p: posts):
  post = posts[p]! else POST_NOT_FOUND
  return post {
    *,
    authorProfile: users[principal = .author] { displayName, handle },
    replies: posts[parent = p] first 50 by byParent {
      *,
      authorProfile: users[principal = .author] { displayName, handle },
    },
  }

query myFollowing():
  return follows[follower = viewer] first 100 by byFollower { followee, at }

query myLikes():
  return likes[user = viewer] first 200 by byUserPost { post }

query myFeedMarks():
  return feedItems[actor = viewer] first 200 by byActor { post, kind }
