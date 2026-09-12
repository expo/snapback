query followingFeed(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 500 by byFollower
  return page { post: ., author: profiles[.author] { id, displayName, handle, avatar } }

query followingHeads(c: cursor ?):
  heads = merge postHeads after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 1000 by byFollower
  return heads { post: posts[.post] }

mutation publishPost(body: text <=500):
  (_period, rem) = divmod(now, 60000)
  period = now - rem
  insert digestPeriodChanges { period }
  post = insert posts { author: viewer, body, period, at: now }
  insert postHeads { post: post.id, author: viewer, at: post.at }
  return post

mutation editPost(postId: posts, body: text <=500):
  post = posts[postId] ! else NOT_FOUND
  update posts[post] { body }
  return posts[post]

mutation removePost(postId: posts):
  post = posts[postId] ! else NOT_FOUND
  insert digestPeriodChanges { period: post.period }
  head = postHeads[postId] by byPost
  if head != null:
    delete postHeads[head]
  delete posts[post]
  return null

mutation setFollowing(followed: principal, following: bool):
  (_period, rem) = divmod(now, 60000)
  period = now - rem
  followerTarget = digestTargets[viewer] by byTarget
  if followerTarget = null:
    insert digestTargets { target: viewer }
  followedTarget = digestTargets[followed] by byTarget
  if followedTarget = null:
    insert digestTargets { target: followed }
  edge = follows[viewer, followed] by byFollowerFollowed
  if following:
    if edge = null:
      insert follows { follower: viewer, followed, period, digestEligible: true }
      insert digestRecipientChanges { target: viewer }
  else:
    if edge != null:
      delete follows[edge]
      insert digestRecipientChanges { target: viewer }
  return null

query searchScopes(c: cursor ?):
  return memberships[viewer] after c first 100 by byPrincipalConversation { conversation: .conversationId }

query conversationMessageSearch(conversation: conversations, term: text <=128, c: cursor ?):
  return messages[conversation, term] after c last 1 by bySearch
