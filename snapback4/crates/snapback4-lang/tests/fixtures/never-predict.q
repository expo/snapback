-- 0.2.16 insights/social schema reduced to the three changed mutations.
table posts:
  authorId: principal
  parentId: id ?
  at: time
  public 'posts'
  insert <- .authorId = viewer
  sync public last 1000 by byId
table likes:
  postId: posts
  principal: principal
  unique byPostPrincipal: postId, principal
  public 'likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 1000 by byId
maintain likeCounts: count likes by postId
  read <- allow
  online only
table insightFacts:
  ownerId: principal
  actorId: principal
  sourceId: id
  kind: enum('post', 'like', 'reply', 'repost', 'follow')
  day: int
  period: int
  at: time
  unique bySourceKind: sourceId, kind
  by byOwnerKindAt: ownerId, kind, at, id
  immutable ownerId, actorId, sourceId, kind, day, period, at
  public 'Public engagement facts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  online only
fn recordFact(sourceId: id, ownerId: principal, actorId: principal, kind: enum('post', 'like', 'reply', 'repost', 'follow'), at: time):
  insert insightFacts { sourceId, ownerId, actorId, kind, at, day: (at - 0) / 86400000, period: (at - 0) / 120000 } if absent
  return null
fn removeFact(sourceId: id, kind: enum('post', 'like', 'reply', 'repost', 'follow')):
  if exists insightFacts[sourceId, kind]:
    delete insightFacts[sourceId, kind]
  return null
table rankedPosts:
  postId: posts
  authorId: principal
  score: int
  at: time
  expiresAt: time ?
  unique byPost: postId
  by byScore: score, at, postId, id
  by byExpiry: expiresAt
  immutable postId, authorId, at, expiresAt
  public 'Current 24-hour original-post ranking'
  insert <- .authorId = viewer
  update <- allow
  expire at .expiresAt
  online only
fn rankPost(p: posts):
  if p.parentId = null and p.at > now - 86400000:
    upsert rankedPosts[postId = p.id] { authorId: p.authorId, score: likeCounts[p.id], at: p.at, expiresAt: p.at + 86400000 }
  return null
mutation createPost(postId: id):
  p = insert posts { id: postId, authorId: viewer, at: now }
  recordFact(p.id, viewer, viewer, 'post', now)
  rankPost(p)
mutation like(postId: posts, state: bool):
  p = posts[id = postId] ! else POST_NOT_FOUND
  if state:
    l = insert likes { postId, principal: viewer } if absent
    if l != null:
      recordFact(l.id, p.authorId, viewer, 'like', now)
  else:
    if exists likes[postId, viewer]:
      removeFact(likes[postId, viewer].id ! else LIKE_MISSING, 'like')
      delete likes[postId, viewer]
  rankPost(p)
mutation repost(postId: posts, state: bool):
  if state:
    recordFact(postId, viewer, viewer, 'repost', now)
  else:
    removeFact(postId, 'repost')
