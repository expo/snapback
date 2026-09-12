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

mutation publishPost(body: text <=500, period: time):
  insert digestPeriodChanges { period, value: 1 }
  post = insert posts { author: viewer, body, period, at: now }
  insert postHeads { post: post.id, author: viewer, at: post.at }
  return post

mutation editPost(postId: posts, body: text <=500):
  post = posts[postId] ! else NOT_FOUND
  update posts[post] { body }
  return posts[post]

mutation removePost(postId: posts):
  post = posts[postId] ! else NOT_FOUND
  insert digestPeriodChanges { period: post.period, value: 1 }
  head = postHeads[postId] by byPost
  if head != null:
    delete postHeads[head]
  delete posts[post]
  return null

mutation setFollowing(followed: principal, following: bool, period: time ?, digestEligible: bool ?):
  edge = follows[viewer, followed] by byFollowerFollowed
  if following:
    if edge = null:
      insert follows { follower: viewer, followed, period, digestEligible }
  else:
    if edge != null:
      delete follows[edge]
  insert digestRecipientChanges { target: viewer, value: 1 }
  insert digestRecipientChanges { target: followed, value: 1 }
  return null

query searchScopes(c: cursor ?):
  return memberships[viewer] after c first 100 by byPrincipalConversation { conversation: .conversationId }

query conversationMessageSearch(conversation: conversations, term: text <=128, c: cursor ?):
  return messages[conversation, term] after c last 1 by bySearch
