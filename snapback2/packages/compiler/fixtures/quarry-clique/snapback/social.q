-- Clique profiles, posts, feeds, follows, and likes regression surface.

shape authorCard = { displayName, handle }

mutation createProfile(displayName: text <=50, handle: text <=20):
  return insert users { principal: viewer, displayName, handle, followerCount: 0, followingCount: 0 }

mutation updateProfile(displayName: text <=50, handle: text <=20, bio: text <=200 ?, location: text <=50 ?, link: text <=200 ?):
  me = users[principal = viewer]! else NO_PROFILE
  update users[principal = viewer] { displayName, handle, bio, location, link }
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
  insert posts { id: pid, author: viewer, body, at: t, likeCount: 0, replyCount: 0, repostCount: 0 }
  insert feedItems { actor: viewer, post: pid, kind: 'post', origAuthor: viewer, at: t, ord }
  p = posts[pid]! else IMPOSSIBLE
  return p { id, at }

mutation createReply(parent: posts, body: text <=500):
  par = posts[parent]! else PARENT_NOT_FOUND
  pid = new
  t = now
  insert posts { id: pid, author: viewer, body, parent, at: t, likeCount: 0, replyCount: 0, repostCount: 0 }
  update posts[parent] { replyCount: .replyCount + 1 }
  p = posts[pid]! else IMPOSSIBLE
  return p { id, at }

mutation toggleLike(p: posts):
  post = posts[p]! else POST_NOT_FOUND
  match likes[viewer, p]:
    some l:
      delete likes[l.id]
      update posts[p] { likeCount: .likeCount - 1 }
      return false
    none:
      insert likes { user: viewer, post: p, at: now }
      update posts[p] { likeCount: .likeCount + 1 }
      return true

mutation toggleRepost(p: posts, ord: int):
  post = posts[p]! else POST_NOT_FOUND
  require post.parent = null else CANNOT_REPOST_REPLY
  match feedItems[actor = viewer, post = p, kind = 'repost']:
    some f:
      delete feedItems[f.id]
      update posts[p] { repostCount: .repostCount - 1 }
      return false
    none:
      insert feedItems { actor: viewer, post: p, kind: 'repost', origAuthor: post.author, at: now, ord }
      update posts[p] { repostCount: .repostCount + 1 }
      return true

mutation toggleFollow(u: users):
  other = users[u]! else USER_NOT_FOUND
  require other.principal != viewer else SELF_FOLLOW
  match follows[viewer, u]:
    some f:
      delete follows[f.id]
      update users[u] { followerCount: .followerCount - 1 }
      update users[principal = viewer] { followingCount: .followingCount - 1 }
      return false
    none:
      insert follows { follower: viewer, followee: u, followed: other.principal, at: now }
      update users[u] { followerCount: .followerCount + 1 }
      update users[principal = viewer] { followingCount: .followingCount + 1 }
      return true

query globalFeed(cursorOrd: int ?, cursorId: feedItems ?):
  return feedItems[] after (cursorOrd, cursorId) first 20 by byOrd {
    id, kind, at, ord, actor, post,
    reposter: users[principal = .actor] authorCard,
    item: .post {
      id, author, body, parent, at, likeCount, replyCount, repostCount,
      authorProfile: users[principal = .author] authorCard,
    },
  }

-- The Following feed merges the viewer's lane with up to 50 followed actors.
query followingFeed(cursorOrd: int ?, cursorId: feedItems ?):
  page = merge feedItems after (cursorOrd, cursorId) first 20 by byActorOrd:
    [viewer]
    [f.followed] for f in follows[viewer] first 50 by byFollower
  return page {
    id, kind, at, ord, actor, post,
    reposter: users[principal = .actor] authorCard,
    item: .post {
      id, author, body, parent, at, likeCount, replyCount, repostCount,
      authorProfile: users[principal = .author] authorCard,
    },
  }

query thread(p: posts):
  post = posts[p]! else POST_NOT_FOUND
  return post {
    *,
    authorProfile: users[principal = .author] authorCard,
    replies: posts[parent = p] first 50 by byParent {
      *,
      authorProfile: users[principal = .author] authorCard,
    },
  }

query myFollowing():
  return follows[follower = viewer] first 100 by byFollower { followee, at }

query myLikes():
  return likes[user = viewer] first 200 by byUserPost { post }

query myFeedMarks():
  return feedItems[actor = viewer] first 200 by byActor { post, kind }
