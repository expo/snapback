query followingFeed(c: cursor ?):
  heads = merge postHeads after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 1000 by byFollower
  return heads { post: posts[.post] }

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

query searchScopes(c: cursor ?):
  return memberships[viewer] after c first 100 by byPrincipalConversation { conversation: .conversation }

query conversationMessageSearch(conversation: conversations, term: text <=128, c: cursor ?):
  return messages[conversation, term] after c last 1 by bySearch
